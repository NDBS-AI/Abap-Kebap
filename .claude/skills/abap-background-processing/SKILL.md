---
name: abap-background-processing
description: "Use when ABAP logic must run asynchronously or in the background in ABAP Cloud — choosing between the Background Processing Framework (bgPF), the Application Jobs API, and bgRFC; implementing bgPF operation classes with if_bgmc_op_single or if_bgmc_op_single_tx_uncontr and starting them via cl_bgmc_process_factory (controlled vs uncontrolled transactions, transactional vs queued); building application jobs with if_apj_dt_exec_object and if_apj_rt_exec_object plus job catalog entries and job templates; scheduling and monitoring jobs from code with cl_apj_rt_api, including from a RAP action's save phase; and writing or reading the Application Log via the BALI API (cl_bali_log, cl_bali_log_db, cl_bali_free_text_setter). Triggers include run this in the background, schedule an application job, job catalog entry, job template, bgPF, write to the application log, read the BAL log, asynchronous processing in RAP, and show job status in Fiori."
---

# ABAP Background Processing — bgPF, Application Jobs, Application Log

## Overview

A guide for running ABAP work outside the user's dialog in ABAP Cloud. Three released building blocks cover the space:

- **bgPF (Background Processing Framework)** — fire-and-forget asynchronous units of work started from code. Wraps the inbound bgRFC, executes operations transactionally with quality of service Exactly Once (EO), or Exactly Once In Order (EOIO) for queued processes. The natural partner of RAP: register a process during the save phase and it runs right after `COMMIT WORK`.
- **Application Jobs** — schedulable, parameterized, administrator-visible jobs. The cloud successor of "report + variant + SM36": a class implements `if_apj_dt_exec_object` (parameter definitions) and `if_apj_rt_exec_object` (execution), a *job catalog entry* points to the class, a *job template* makes it schedulable — in the Fiori *Application Jobs* app or from code via `cl_apj_rt_api`.
- **Application Log (BALI API)** — durable, viewable logging (`cl_bali_log`, `cl_bali_log_db`). Background code has no console; the application log is where its output goes, linked to the job log or displayed in your own Fiori app.

**Core principle:** pick the lightest vehicle that fits. Most "make this async" requirements inside a RAP BO need only bgPF. Reach for Application Jobs when a human schedules, monitors, or re-runs the work. In both cases, scheduling belongs in the **save phase** of the SAP LUW — never in the interaction phase (see [abap-sap-luw](../abap-sap-luw/SKILL.md)).

## Workflow

1. **Pick the vehicle** with the decision guide below (bgPF vs Application Jobs vs bgRFC).
2. **bgPF path:** choose the process type — *transactional* (EO, no ordering) or *queued* (EOIO, ordered) — and the transaction scenario — *controlled* (inside RAP, framework owns the LUW, `if_bgmc_op_single`) or *uncontrolled* (outside RAP or code that must `COMMIT WORK` itself, `if_bgmc_op_single_tx_uncontr`). Implement the operation class, start it via `cl_bgmc_process_factory` from your saver class, keep the process monitor string.
3. **Application Jobs path:** implement the job class (`if_apj_dt_exec_object` + `if_apj_rt_exec_object`, plus `if_oo_adt_classrun` for F9 testing), create the job catalog entry and job template (ADT editors or `cl_apj_dt_create_content`), then schedule — end users via the Fiori app, code via `cl_apj_rt_api=>schedule_job` in the additional save phase.
4. **Add logging:** create an application log object once (`cl_bali_object_handler`), write items with `cl_bali_log` + `cl_bali_free_text_setter`, persist with `cl_bali_log_db->save_log( assign_to_current_appl_job = abap_true )`.
5. **Close the loop to the UI:** persist `jobname`/`jobcount` (or the bgPF monitor string) on your entity, expose job status via virtual elements, and refresh the Fiori UI with a RAP event declared `for side effects` (see [rap-business-events-side-effects](../rap-business-events-side-effects/SKILL.md)).
6. **Test:** F9-run the job class interactively (`sy-batch` distinguishes console vs log output); bgPF processes have unit-test support (see references/bgpf-api.md).

### Decision guide — bgPF vs Application Jobs vs bgRFC

| Requirement | Pick |
|---|---|
| Offload a long-running step triggered by a RAP action; no user-facing scheduling | **bgPF** (transactional, controlled) |
| Same, but the code must issue its own `COMMIT WORK` (e.g. legacy API wrapper) | **bgPF** (transactional, uncontrolled) |
| Several background operations that must run in a defined order | **bgPF** (queued process, EOIO) |
| Recurring/periodic run, user-defined parameters, visible in a monitoring app | **Application Jobs** |
| Administrator must be able to restart / cancel / inspect the job log | **Application Jobs** |
| A background run started programmatically from a RAP BO, with status on the UI | **Application Jobs** scheduled via `cl_apj_rt_api` from the save phase |
| Outbound or out-in RFC queue scenarios, classic on-premise ABAP | **bgRFC** directly (classic ABAP; bgPF supports the inbound scenario only) |
| Anything asynchronous in ABAP for Cloud Development | **bgPF or Application Jobs** — bgPF wraps the inbound bgRFC for you; don't program bgRFC units yourself in ABAP Cloud |

bgPF and Application Jobs are not rivals: the bgPF sample recalculates one entity right after save; the Application Jobs sample runs the same calculation as a job so admins can see status, logs, and re-runs.

## bgPF — process types and transaction scenarios

Two orthogonal decisions:

| Process type | Quality of service | Started via |
|---|---|---|
| Transactional background process | Exactly Once (EO), no guaranteed order | `cl_bgmc_process_factory=>get_default( )` |
| Queued background process | Exactly Once In Order (EOIO) | `cl_bgmc_process_factory=>get_for_queue( iv_bg_processing_context = ... iv_queue = ... )` — requires your own *background processing context* object to avoid queue-name clashes |

| Transaction scenario | Operation interface | Who commits |
|---|---|---|
| Controlled (inside RAP) | `if_bgmc_op_single` | The framework — your `execute` uses EML, **no** `COMMIT WORK` / `COMMIT ENTITIES` |
| Uncontrolled (outside RAP, or code with own commits) | `if_bgmc_op_single_tx_uncontr` | Your code — commits allowed inside `execute` |

The operation class also implements `if_serializable_object` (its state — typically the entity key passed to the constructor — is serialized and shipped to the background task) and the framework's `if_bgmc_operation` interface.

## bgPF — the operation class

Modeled on `zbgpfcl_calc_inventory_006` from the SAP sample, Clean-ABAP-ified:

```abap
CLASS zcl_recalculate_inventory DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_serializable_object.        " state travels to the background task
    INTERFACES if_bgmc_operation.
    INTERFACES if_bgmc_op_single.             " controlled: framework owns the LUW
    INTERFACES if_bgmc_op_single_tx_uncontr.  " uncontrolled: own COMMIT WORK allowed

    TYPES: BEGIN OF inventory_key,
             uuid TYPE sysuuid_x16,
           END OF inventory_key.

    CLASS-METHODS start_in_background
      IMPORTING entity_key                    TYPE inventory_key
      RETURNING VALUE(process_monitor_string) TYPE string
      RAISING   cx_bgmc.

    METHODS constructor IMPORTING entity_key TYPE inventory_key.

  PRIVATE SECTION.
    DATA inventory_uuid TYPE sysuuid_x16.
ENDCLASS.

CLASS zcl_recalculate_inventory IMPLEMENTATION.
  METHOD constructor.
    inventory_uuid = entity_key-uuid.
  ENDMETHOD.

  METHOD start_in_background.
    DATA(process_monitor) = cl_bgmc_process_factory=>get_default(
        )->create(
        )->set_name( |Recalculate inventory|
        )->set_operation( NEW zcl_recalculate_inventory(
                              entity_key = VALUE #( uuid = entity_key-uuid ) )
        )->save_for_execution( ).
    process_monitor_string = process_monitor->to_string( ).
  ENDMETHOD.

  METHOD if_bgmc_op_single~execute.
    " Runs in its own LUW after the registering transaction committed.
    " Controlled scenario: EML only, no COMMIT — the framework commits.
    READ ENTITIES OF zr_inventorytp
      ENTITY Inventory
        ALL FIELDS WITH VALUE #( ( %is_draft = if_abap_behv=>mk-off
                                   %key-uuid = inventory_uuid ) )
      RESULT DATA(inventories)
      FAILED DATA(read_failed).

    MODIFY ENTITIES OF zr_inventorytp
      ENTITY Inventory
        UPDATE FIELDS ( Quantity )
        WITH VALUE #( FOR inventory IN inventories
                      ( %is_draft = if_abap_behv=>mk-off
                        uuid      = inventory-uuid
                        Quantity  = inventory-Quantity + 10 ) )
      REPORTED DATA(update_reported)
      FAILED   DATA(update_failed).
  ENDMETHOD.

  METHOD if_bgmc_op_single_tx_uncontr~execute.
    " Implement only when the uncontrolled variant is needed,
    " e.g. wrapped code that issues COMMIT WORK itself.
  ENDMETHOD.
ENDCLASS.
```

For the uncontrolled variant, register with `set_operation_tx_uncontrolled( ... )` instead of `set_operation( ... )`. Full API walk-through: [references/bgpf-api.md](references/bgpf-api.md). Full runnable class: [examples/bgpf_operation_class.abap](examples/bgpf_operation_class.abap).

## bgPF — starting the process from a RAP saver class

The sample triggers bgPF from `save_modified` of the saver class (`lsc_*`, see [rap-bo-modeling](../rap-bo-modeling/SKILL.md)) when an action set a marker field:

```abap
METHOD save_modified.
  LOOP AT update-inventory ASSIGNING FIELD-SYMBOL(<updated_inventory>)
       WHERE %control-BgpfStatus = if_abap_behv=>mk-on.

    TRY.
        DATA(process_monitor_string) = zcl_recalculate_inventory=>start_in_background(
            entity_key = VALUE #( uuid = <updated_inventory>-uuid ) ).
        " persist process_monitor_string on the entity's table for later state checks
      CATCH cx_bgmc INTO DATA(background_error).
        " report via reported-inventory; do not swallow silently
    ENDTRY.
  ENDLOOP.
ENDMETHOD.
```

The process is *registered* inside the current SAP LUW and *executed* immediately after the RAP framework's `COMMIT WORK` — if the save fails, no background process runs. To check the state later, re-instantiate the monitor from the persisted string with `cl_bgmc_process_factory=>create_monitor_from_string` and call `if_bgmc_process_monitor->get_state`.

When the background process finishes, it updates the entity via EML from a new LUW. Raise a RAP event declared `for side effects` in that second save so the Fiori UI refreshes the recalculated field:

```
// behavior definition (base BDEF)
event QuantityUpdated for side effects;

side effects
{
  event QuantityUpdated affects field ( Quantity );
}
```

```abap
" saver class, second save cycle (triggered by the bgPF operation's EML update)
IF <updated_inventory>-%control-Quantity = if_abap_behv=>mk-on.
  DATA(events_to_be_raised) = VALUE tt_quantity_updated_events(
      ( CORRESPONDING #( <updated_inventory> ) ) ).
  RAISE ENTITY EVENT zr_inventorytp~QuantityUpdated FROM events_to_be_raised.
ENDIF.
```

The projection BDEF must opt in with `use side effects;` at BO level and `use event QuantityUpdated;` at entity level, otherwise the UI never hears about it. Details on events and side effects live in [rap-business-events-side-effects](../rap-business-events-side-effects/SKILL.md).

## Application Jobs — the job class

A class becomes an application job by implementing two interfaces, one method each:

- `if_apj_dt_exec_object~get_parameters` — design time; the cloud replacement for a report's selection screen. Returns parameter *definitions* (`et_parameter_def`) and *default values* (`et_parameter_val`).
- `if_apj_rt_exec_object~execute( it_parameters )` — runtime; called by the framework when the job starts. Parameters arrive from the scheduling API call, the job template, or as fallback from `get_parameters` defaults.

Add `if_oo_adt_classrun` as an F9 test harness — background jobs cannot be debugged, so `main( )` calls `execute( )` with representative values, and a `sy-batch` switch routes output to the console interactively and to the application log in a real job run.

```abap
METHOD if_apj_dt_exec_object~get_parameters.
  et_parameter_def = VALUE #(
    ( selname        = 'INVENT'
      kind           = if_apj_dt_exec_object=>parameter
      datatype       = 'C'
      length         = 32
      param_text     = 'Inventory key'
      changeable_ind = abap_true ) ).

  et_parameter_val = VALUE #(
    ( selname = 'INVENT'
      kind    = if_apj_dt_exec_object=>parameter
      sign    = 'I'
      option  = 'EQ'
      low     = default_inventory_uuid ) ).
ENDMETHOD.
```

The complete pattern — job class with BALI logging, F9 harness, and EML update — is in [examples/application_job_class.abap](examples/application_job_class.abap).

## Application Jobs — catalog entry and template

Two design-time artifacts sit between the class and a schedulable job:

| Artifact | ADT object type | Role |
|---|---|---|
| Job catalog entry | `SAJC` (JSON editor) | Points to the job class; corresponds to the former report incl. selection parameters |
| Job template | `SAJT` (JSON editor) | References a catalog entry, pre-fills parameter values; the entity actually scheduled (a catalog entry can have many templates) |

Create them in ADT, or programmatically with the released design-time API `cl_apj_dt_create_content` — the sample's setup class does exactly this:

```abap
DATA(design_time_api) = cl_apj_dt_create_content=>get_instance( ).

design_time_api->create_job_cat_entry(
    iv_catalog_name       = 'ZINVENTORY_CATALOG'
    iv_class_name         = 'ZCL_INVENTORY_JOB'
    iv_text               = 'Inventory calculation'
    iv_catalog_entry_type = cl_apj_dt_create_content=>class_based
    iv_transport_request  = transport_request
    iv_package            = package_name ).

design_time_api->create_job_template_entry(
    iv_template_name     = 'ZINVENTORY_TEMPLATE'
    iv_catalog_name      = 'ZINVENTORY_CATALOG'
    iv_text              = 'Inventory calculation'
    it_parameters        = template_parameters   " if_apj_dt_exec_object=>tt_templ_val
    iv_transport_request = transport_request
    iv_package           = package_name ).
```

Errors raise `cx_apj_dt_content`. Creating catalog entry + template generates an IAM app that must be assigned to a business catalog and, via a role, to every user who schedules the job. See [references/application-jobs-api.md](references/application-jobs-api.md) for the full API surface (existence checks, deletion, authorizations).

## Application Jobs — scheduling and monitoring from code

Runtime API `cl_apj_rt_api` (all types come from the class itself: `ty_start_info`, `tt_job_parameter_value`, `ty_jobname`, `ty_jobcount`, ...):

```abap
DATA(job_start_info) = VALUE cl_apj_rt_api=>ty_start_info( start_immediately = abap_true ).
DATA(job_parameters) = VALUE cl_apj_rt_api=>tt_job_parameter_value(
    ( name    = 'INVENT'
      t_value = VALUE #( ( sign = 'I' option = 'EQ' low = inventory_uuid ) ) ) ).

TRY.
    cl_apj_rt_api=>schedule_job(
      EXPORTING iv_job_template_name   = 'ZINVENTORY_TEMPLATE'
                iv_job_text            = |Calculate inventory { product_id }|
                is_start_info          = job_start_info
                it_job_parameter_value = job_parameters
      IMPORTING ev_jobname             = DATA(job_name)
                ev_jobcount            = DATA(job_count) ).
  CATCH cx_apj_rt INTO DATA(job_scheduling_error).
    " handle / report
ENDTRY.
```

Caveats, all straight from the SAP sample:

- **On-premise systems: never set `start_immediately`** — it performs a `COMMIT WORK` internally and dumps inside the save sequence. Set `job_start_info-timestamp` instead.
- **From a RAP BO, schedule only in the additional save phase** (`save_modified`). `jobname`/`jobcount` exist only there, and business data can no longer be changed via EML at that point — persist them with a direct `UPDATE` on the BO's database table.
- Scheduling in the interaction phase risks implicit database commits (remote calls, draft saves) while a later validation can still fail — leaving a job scheduled for a business object that was never saved.

Poll status with `cl_apj_rt_api=>get_job_status( iv_jobname / iv_jobcount )`, which returns a status (`'R'` running, `'F'` finished, `'A'` aborted) and status text — the sample surfaces these in Fiori as virtual elements with criticality coloring. Periodic scheduling (`cl_apj_rt_api=>period_*` constants) and restart handling (`restart_job`, `is_explicit_restart`) are covered in [references/application-jobs-api.md](references/application-jobs-api.md).

## Application Log — the BALI API

Create the log object + subobject once (ADT object type `APLO`, or `cl_bali_object_handler=>get_instance( )->create_object( ... )`), then in the background code:

```abap
" 1. Create a log with a header: log object, subobject, free external ID
DATA(application_log) = cl_bali_log=>create_with_header(
    header = cl_bali_header_setter=>create( object      = 'ZINVENTORY_LOG'
                                            subobject   = 'ZINVENTORY_SUB'
                                            external_id = CONV #( inventory_uuid ) ) ).

" 2. Add items — free text up to 200 characters, with severity and detail level
DATA(log_item) = cl_bali_free_text_setter=>create(
    severity = if_bali_constants=>c_severity_status
    text     = |Job started for inventory { inventory_uuid }| ).
log_item->set_detail_level( '1' ).
application_log->add_item( item = log_item ).

" 3. Persist; assign_to_current_appl_job links it to the running job's log
cl_bali_log_db=>get_instance( )->save_log(
    log                         = application_log
    assign_to_current_appl_job = abap_true ).
```

Read a log back via its handle (`if_bali_log=>ty_handle`), e.g. to show it on a Fiori object page:

```abap
DATA(log) = cl_bali_log_db=>get_instance( )->load_log( handle           = log_handle
                                                       read_only_header = abap_true ).
LOOP AT log->get_all_items( ) INTO DATA(loaded_item).
  " loaded_item-log_item_number, loaded_item-item->severity,
  " loaded_item-item->timestamp, loaded_item-item->get_message_text( )
ENDLOOP.
```

The Application Jobs sample wraps this read in an unmanaged query (`if_rap_query_provider`) behind a custom entity keyed by `log_handle` + `log_item_number`, associates it to the BO root, and gets an application-log facet on the object page with zero UI development. Runtime errors raise `cx_bali_runtime`; reading logs requires authorization object `S_APPL_LOG` for the log object/subobject. Severity constants, exception messages (`cl_bali_message_setter` and friends), and the display pattern are detailed in [references/application-log-bali.md](references/application-log-bali.md).

## Transactional caveats — what runs in which LUW

| Code | LUW / phase | Rules |
|---|---|---|
| bgPF `save_for_execution` | The registering transaction (RAP save phase) | Process only becomes real when that LUW commits; rollback discards it |
| bgPF `if_bgmc_op_single~execute` (controlled) | Own, framework-managed LUW after the commit | EML allowed; **no** `COMMIT WORK`/`COMMIT ENTITIES`/rollback of your own |
| bgPF `if_bgmc_op_single_tx_uncontr~execute` (uncontrolled) | Own LUW, self-managed | Own commits allowed; you forgo the framework's transactional consistency guarantees |
| `cl_apj_rt_api=>schedule_job` | Additional save phase of the scheduling BO | Not in the interaction phase (implicit-commit risk); `jobname`/`jobcount` persisted by direct SQL, not EML |
| `if_apj_rt_exec_object~execute` | The job's own background LUW (`sy-batch = abap_true`) | May use EML incl. `COMMIT ENTITIES` — it is not inside anyone else's LUW |
| `cl_bali_log_db->save_log` | Caller's LUW | In a job, call with `assign_to_current_appl_job = abap_true` so the log attaches to the job |

The general LUW model (interaction phase vs save sequence, why implicit commits are dangerous) is the subject of [abap-sap-luw](../abap-sap-luw/SKILL.md).

## ABAP Cloud release status

**Verify current availability in ADT** — the *Released Objects* view shows release/deprecation status directly for your system version.

| API / feature | Status |
|---|---|
| `if_bgmc_op_single`, `if_bgmc_op_single_tx_uncontr`, `cl_bgmc_process_factory`, `cx_bgmc` | Released for ABAP for Cloud Development; bgPF available in SAP BTP ABAP environment since 2308, in S/4HANA (private cloud/on-premise) as of release 2023 |
| `if_apj_dt_exec_object`, `if_apj_rt_exec_object`, `cl_apj_rt_api`, `cl_apj_dt_create_content`, `cx_apj_rt`, `cx_apj_dt_content` | Released application-jobs APIs; the sample runs on ABAP Platform 2021+, SAP BTP ABAP environment, and S/4HANA Cloud ABAP environment |
| `cl_bali_log`, `cl_bali_log_db`, `cl_bali_header_setter`, `cl_bali_free_text_setter`, `cl_bali_object_handler`, `if_bali_constants` | Released Application Log (BALI) API |
| RAP event-driven side effects (`event ... for side effects`) | SAP BTP ABAP environment and S/4HANA Cloud Public Edition; per the sample README, planned for on-premise/private cloud as of release 2025 |

Always confirm the API state in ADT's *Released Objects* view for your release — the workflow for that lives in [abap-cloud-development](../abap-cloud-development/SKILL.md).

## Quick Reference

| Task | API call |
|---|---|
| Start async work after RAP save (controlled) | `cl_bgmc_process_factory=>get_default( )->create( )->set_name( ... )->set_operation( ... )->save_for_execution( )` |
| Start async work with own commits (uncontrolled) | Same chain with `set_operation_tx_uncontrolled( ... )`; operation implements `if_bgmc_op_single_tx_uncontr` |
| Ordered background operations | `cl_bgmc_process_factory=>get_for_queue( iv_bg_processing_context = ... iv_queue = ... )` |
| Check bgPF process state later | Persist `monitor->to_string( )`; `create_monitor_from_string` + `get_state` |
| Define job parameters | `if_apj_dt_exec_object~get_parameters` → `et_parameter_def` / `et_parameter_val` |
| Job entry point | `if_apj_rt_exec_object~execute( it_parameters )` |
| Create catalog entry / template in code | `cl_apj_dt_create_content=>get_instance( )->create_job_cat_entry / create_job_template_entry` |
| Schedule a job | `cl_apj_rt_api=>schedule_job` → `ev_jobname`, `ev_jobcount` |
| Job status | `cl_apj_rt_api=>get_job_status` → `'R'` / `'F'` / `'A'` + text |
| Create a log | `cl_bali_log=>create_with_header( cl_bali_header_setter=>create( ... ) )` |
| Add a message | `cl_bali_free_text_setter=>create( severity = ... text = ... )` + `add_item` |
| Persist / attach to job log | `cl_bali_log_db=>get_instance( )->save_log( log = ... assign_to_current_appl_job = abap_true )` |
| Read a log | `cl_bali_log_db=>get_instance( )->load_log( handle = ... )` → `get_all_items( )` |

## Common Mistakes

| Wrong | Right |
|---|---|
| Calling `cl_apj_rt_api=>schedule_job` in the interaction phase (action/determination) | Set a marker field in the action; schedule in `save_modified` (additional/unmanaged save) |
| `job_start_info-start_immediately = abap_true` on an on-premise system | Use `job_start_info-timestamp` — `start_immediately` commits internally and dumps in the save sequence |
| Persisting `jobname`/`jobcount` via EML `MODIFY` in `save_modified` | Direct `UPDATE` on the BO's own database table — business data is frozen in the save phase |
| `COMMIT WORK` inside `if_bgmc_op_single~execute` | Controlled operations never commit; if commits are unavoidable, switch to `if_bgmc_op_single_tx_uncontr` + `set_operation_tx_uncontrolled` |
| bgPF operation class without `if_serializable_object` | Implement it — the operation instance (with its constructor-injected keys) is serialized for the background task |
| Empty `CATCH cx_bgmc.` / `CATCH cx_apj_rt.` blocks | Append a message to `reported-<entity>` (or re-raise) so the failure reaches the user |
| Trying to set a breakpoint in a running application job | Add `if_oo_adt_classrun`; `main( )` calls `execute( )` with defaults so you debug via F9 |
| Writing log items but never calling `save_log` | Persist with `cl_bali_log_db->save_log`; in a job pass `assign_to_current_appl_job = abap_true` |
| Raising a side-effect event but the UI never refreshes | Add `use side effects;` (BO level) and `use event <Name>;` (entity level) to the projection BDEF |
| Job status hardcoded from the last known value | Read it live via `cl_apj_rt_api=>get_job_status` in a virtual-element calculator (`if_sadl_exit_calc_element_read`) |
| Expecting end users to read logs without authorization | Reading requires `S_APPL_LOG` for the log object/subobject; scheduling requires the generated IAM app in the user's role |
| Using bare bgRFC units in ABAP for Cloud Development | Use bgPF (it wraps the inbound bgRFC); direct bgRFC programming is classic-ABAP territory |

## References

- [references/bgpf-api.md](references/bgpf-api.md) — bgPF deep dive: interfaces, factory/builder chain, process monitor, queued processes, retries, unit testing
- [references/application-jobs-api.md](references/application-jobs-api.md) — Application Jobs deep dive: catalog/template artifacts, `if_apj_*` contracts, `cl_apj_rt_api` and `cl_apj_dt_create_content`, authorizations
- [references/application-log-bali.md](references/application-log-bali.md) — BALI deep dive: log objects, item setters, persistence, reading, Fiori display pattern
- [examples/bgpf_operation_class.abap](examples/bgpf_operation_class.abap) — complete bgPF operation class + saver-class trigger
- [examples/application_job_class.abap](examples/application_job_class.abap) — complete application job class with BALI logging and scheduling helper
- **Background Processing Framework (ABAP Development):** https://help.sap.com/docs/ABAP_Cloud/f2961be2bd3d403585563277e65d108f/e1fbe70d8dd54a2db2df3a208b2cb68e.html
- **Scenario: Transactional Controlled:** https://help.sap.com/docs/ABAP_Cloud/f2961be2bd3d403585563277e65d108f/348b168c2de14195a6a549a542601437.html
- **Scenario: Transactional Uncontrolled:** https://help.sap.com/docs/ABAP_Cloud/f2961be2bd3d403585563277e65d108f/31eea50903c642db9c3748afdbe28295.html
- **Implementing the Queued Background Process:** https://help.sap.com/docs/ABAP_Cloud/f2961be2bd3d403585563277e65d108f/3b01f875861a4c4397ae0324e8263227.html
- **Background Processing Framework (SAP BTP ABAP environment):** https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/0ad13bd0fafb46f08d3f5174d5fd01f9.html
- **Creating a Job Catalog Entry and a Job Template:** https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/949ba003345b476e99e46b920f41632d.html
- **Creating a Job Catalog Entry and a Job Template via API:** https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/e58737f463534a23bff0e9f21f7ee6d0.html
- **Maintaining Application Jobs Using an API:** https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/1491e6c075c04e7c9a485a2e24b82653.html
- **Example Implementation Using IF_APJ_DT_EXEC_OBJECT / IF_APJ_RT_EXEC_OBJECT:** https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/0abb3f205d4645ac82ef03bbf47b3427.html
- **Application Jobs — Setting up the Authorizations:** https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/bb559a5a4b654996a167d72273f28542.html
- **Create a New Application Log:** https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/f7c20f7b2fce4fbaba79ae0c5182d869.html
- **Writing Application Logs to the Database:** https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/d15d974dfca34671ae3b62ddf0baf8ae.html
- **Classes and Interfaces of the Application Log API:** https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/59023fcd95ec459d8259c1e2840b816a.html
- **SAP-samples/abap-platform-application-jobs** — application jobs from a RAP BO + Fiori app log display: https://github.com/SAP-samples/abap-platform-application-jobs
- **SAP-samples/abap-platform-bgpf-appl-log-events-side-effects** — bgPF + events + side effects: https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects
- Linked skills: [abap-sap-luw](../abap-sap-luw/SKILL.md), [abap-cloud-development](../abap-cloud-development/SKILL.md), [rap-bo-modeling](../rap-bo-modeling/SKILL.md), [rap-business-events-side-effects](../rap-business-events-side-effects/SKILL.md)
