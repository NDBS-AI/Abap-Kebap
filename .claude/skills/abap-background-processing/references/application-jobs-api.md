# Application Jobs — API deep dive

Application Jobs are the ABAP Cloud successor of "report + variant + SM36": schedulable, parameterized, monitorable background runs. Four artifacts cooperate:

```
ZCL_INVENTORY_JOB          class implementing IF_APJ_DT_EXEC_OBJECT + IF_APJ_RT_EXEC_OBJECT
ZINVENTORY_CATALOG (SAJC)  job catalog entry — points to the class, "the report"
ZINVENTORY_TEMPLATE (SAJT) job template — catalog entry + parameter values, "the variant";
                           the entity that is actually scheduled
Fiori "Application Jobs"   scheduling + monitoring app for administrators/end users
```

## IF_APJ_DT_EXEC_OBJECT — design time contract

One method: `get_parameters`. It plays the part of a classic report's selection screen — it declares which parameters the job supports and optionally returns default values used as fallback when a job is scheduled without values.

```abap
METHOD if_apj_dt_exec_object~get_parameters.
  " Parameter definitions
  et_parameter_def = VALUE #(
    ( selname        = 'INVENT'                          " parameter name (like SELNAME)
      kind           = if_apj_dt_exec_object=>parameter   " parameter kind
      datatype       = 'C'
      length         = 32
      param_text     = 'Inventory key'
      changeable_ind = abap_true ) ).

  " Default values (range-shaped: sign/option/low[/high])
  et_parameter_val = VALUE #(
    ( selname = 'INVENT'
      kind    = if_apj_dt_exec_object=>parameter
      sign    = 'I'
      option  = 'EQ'
      low     = default_inventory_uuid ) ).
ENDMETHOD.
```

Values are range-shaped (`sign` / `option` / `low` / `high`), so select-option semantics carry over from classic reports. The template parameter table type is `if_apj_dt_exec_object=>tt_templ_val`.

## IF_APJ_RT_EXEC_OBJECT — runtime contract

One method: `execute( it_parameters )` — the job's entry point, called by the framework in the background (`sy-batch = abap_true`). `it_parameters` (type `if_apj_rt_exec_object=>tt_templ_val`) contains the actual values, sourced in this priority:

1. passed directly to `cl_apj_rt_api=>schedule_job`,
2. from the selected job template,
3. fallback: defaults from `if_apj_dt_exec_object~get_parameters`.

Loop over `it_parameters`, dispatch on `selname`, and do the work. Signal content errors by raising `cx_apj_rt_content` (the sample wraps a caught `cx_bali_runtime` into it). The job may freely use EML including `COMMIT ENTITIES` — it runs in its own LUW, not inside anyone else's save sequence.

### The F9 debugging pattern

Application jobs cannot be debugged. The sample therefore also implements `if_oo_adt_classrun`:

- `main( )` builds representative parameter values and calls `if_apj_rt_exec_object~execute( )` directly — now breakpoints work (run class with F9 in ADT).
- Output helper checks `sy-batch`: `abap_true` → write to the application log; `abap_false` → write to the ADT console.

## Job catalog entry and job template

ADT object types (JSON-based editors, `abapLanguageVersion: cloudDevelopment`):

- **`SAJC`** — catalog entry: `className`, parameter list, parameter groups.
- **`SAJT`** — template: `catalogName` + `singleValueParameters` (and other value kinds).

A catalog entry can have multiple templates. Only templates can be scheduled in the Fiori *Application Jobs* app.

### Creating them programmatically — CL_APJ_DT_CREATE_CONTENT

The released design-time API, used by the sample's setup class so the demo is runnable right after import:

```abap
DATA(design_time_api) = cl_apj_dt_create_content=>get_instance( ).

TRY.
    design_time_api->create_job_cat_entry(
        iv_catalog_name       = 'ZINVENTORY_CATALOG'      " cl_apj_dt_create_content=>ty_catalog_name
        iv_class_name         = 'ZCL_INVENTORY_JOB'       " cl_apj_dt_create_content=>ty_class_name
        iv_text               = 'Inventory calculation'
        iv_catalog_entry_type = cl_apj_dt_create_content=>class_based
        iv_transport_request  = transport_request
        iv_package            = package_name ).

    design_time_api->create_job_template_entry(
        iv_template_name     = 'ZINVENTORY_TEMPLATE'      " cl_apj_dt_create_content=>ty_template_name
        iv_catalog_name      = 'ZINVENTORY_CATALOG'
        iv_text              = 'Inventory calculation'
        it_parameters        = template_parameters        " if_apj_dt_exec_object=>tt_templ_val
        iv_transport_request = transport_request
        iv_package           = package_name ).
  CATCH cx_apj_dt_content INTO DATA(design_time_error).
    " e.g. object already exists — inspect if_t100_message~t100key
ENDTRY.
```

The API also offers deletion and existence checks (per SAP Help "Creating a Job Catalog Entry and a Job Template via API": `delete_job_cat_entry`, `exists_job_template_entry`, and counterparts).

## CL_APJ_RT_API — scheduling and monitoring at runtime

Per SAP Help ("Maintaining Application Jobs Using an API") the runtime API lets you schedule, retrieve status of, cancel, and delete application jobs. All types come from the class: `ty_template_name`, `ty_start_info`, `tt_job_parameter_value`, `ty_job_parameter_value`, `ty_value_range`, `ty_jobname`, `ty_jobcount`, `ty_job_status`, `ty_job_status_text`.

### schedule_job

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
    " job_scheduling_error->bapimsg-message carries the underlying message
ENDTRY.
```

**Start-info caveats (from the SAP sample, verbatim intent):**

- `start_immediately = abap_true` **must not be used in on-premise systems** — it performs a `COMMIT WORK` internally, which dumps inside a RAP save sequence. Use `job_start_info-timestamp` (via `GET TIME STAMP FIELD`) instead.
- Periodic scheduling uses the class constants `cl_apj_rt_api=>period_minutes`, `period_hours`, `period_days`, `period_weeks`, `period_months` together with the start info (SAP Help: "Examples of Periodic Application Jobs").

### get_job_status

```abap
cl_apj_rt_api=>get_job_status(
  EXPORTING iv_jobname         = entity-JobName
            iv_jobcount        = entity-JobCount
  IMPORTING ev_job_status      = DATA(job_status)        " 'R' running, 'F' finished, 'A' aborted
            ev_job_status_text = DATA(job_status_text) ).
```

Raises `cx_apj_rt` when the job is unknown (the sample checks `t100key` msgid `APJ_RT` / msgno `003` and treats it as "no job yet").

### Restart support

For failed jobs (SAP Help: "Automatically Restarting an Application Job"): `cl_apj_rt_api=>restart_job` restarts programmatically, `cl_apj_rt_api=>is_explicit_restart` tells the running job whether the current execution is a restart, and `cl_apj_rt_api=>get_own_auto_restart_number` returns which automatic restart round is executing.

## Scheduling from a RAP business object — the full pattern

From the abap-platform-application-jobs sample:

1. **Action** (`calculateInventory`) does *not* schedule. It only sets a transient marker field (`ScheduleJob = abap_true`) via EML `UPDATE` — the interaction phase must stay commit-free.
2. **Saver class** `save_modified` filters `update-inventory` rows where `ScheduleJob = abap_true AND %control-ScheduleJob = if_abap_behv=>mk-on`, builds parameters, and calls `schedule_job`.
3. `ev_jobname` / `ev_jobcount` are persisted with a **direct SQL `UPDATE`** on the BO's database table — business data can no longer be modified via EML in the save phase.
4. Errors are appended to `reported-inventory` with `new_message( ... )` so the UI shows them.

Why not schedule in the interaction phase? The API call could trigger implicit database commits (as any remote call or draft save can), and a later validation might still fail — the BO would roll back but the job would already be scheduled. SAP's README notes a future API version will allow generating jobname/jobcount ahead of time to buffer during interaction and schedule during save.

### Showing job status in the Fiori UI

- **Virtual elements**: `JobStatus`, `JobStatusText`, `JobStatusCriticality` annotated with `@ObjectModel.virtualElementCalculatedBy` and computed in a class implementing `if_sadl_exit_calc_element_read` — `get_calculation_info` requests `JOBNAME` and `JOBCOUNT` as originals, `calculate` calls `get_job_status` per row and maps criticality (finished→3 green, aborted→1 red, running→2 orange).
- **Feature control**: the behavior handler's `get_instance_features` disables the scheduling action while a job is `'R'` (running) or the instance is a draft.

## Authorizations

- Creating catalog entry + template generates an **IAM app**; assign it to a business catalog and via a business role to every user who schedules the job (see [abap-authorization](../../abap-authorization/SKILL.md) for the IAM chain).
- Reading the job's application log requires authorization object **`S_APPL_LOG`** for the log object/subobject.

## Verified sources

- Creating a Job Catalog Entry and a Job Template: https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/949ba003345b476e99e46b920f41632d.html
- Creating a Job Catalog Entry and a Job Template via API: https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/e58737f463534a23bff0e9f21f7ee6d0.html
- Maintaining Application Jobs Using an API: https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/1491e6c075c04e7c9a485a2e24b82653.html
- Examples of Periodic Application Jobs: https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/232c4a8ff2d8422b93bc89151068b893.html
- Example Implementation Using IF_APJ_DT_EXEC_OBJECT / IF_APJ_RT_EXEC_OBJECT: https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/0abb3f205d4645ac82ef03bbf47b3427.html
- Setting up the Authorizations: https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/bb559a5a4b654996a167d72273f28542.html
- Automatically Restarting an Application Job: https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/5bb62cec33834c6eaa5b80e82b34e54a.html
- Sample repo: https://github.com/SAP-samples/abap-platform-application-jobs
