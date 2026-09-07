---
name: rap-saves-and-numbering
description: "Use when a RAP business object's save handling or key assignment goes beyond the managed defaults — understanding what the managed runtime does in each phase of the RAP save sequence (finalize, check_before_save, adjust_numbers, save, cleanup), implementing a saver class, enhancing a managed BO with additional save (change documents, application log, business events), replacing persistence with unmanaged save and save_modified, implementing a fully unmanaged BO, or wrapping legacy APIs — wrap a BAPI in RAP, function modules that must not COMMIT WORK, bgPF handoff. Covers the complete numbering matrix: early vs late, internal vs external, managed UUID numbering, early numbering with FOR NUMBERING handlers, and late numbering with adjust_numbers, %pid, %tmp/%pre, and CONVERT KEY. Also the transactional phase rules — what is allowed or forbidden in the interaction phase, the early save phase, and the late save phase of a RAP transaction."
---

# RAP Saves and Numbering

## Overview

The deep dive behind [rap-bo-modeling](../rap-bo-modeling/SKILL.md)'s "Managed vs Unmanaged" and "Saver class" sections. That skill scaffolds a BO end-to-end; this one explains what actually happens when `COMMIT ENTITIES` fires — the save sequence method by method, which save variant to declare (`with additional save`, `with unmanaged save`, fully `unmanaged`), how primary keys get assigned (early/late × internal/external/managed), and how to wrap legacy BAPIs and function modules without breaking the SAP LUW.

**Core principle:** a RAP transaction has two phases. In the *interaction phase* the transactional buffer may be inconsistent — the database never is, because nothing is written yet. The *save sequence* (triggered by `COMMIT ENTITIES`, implicitly by the RAP runtime engine in Fiori/OData scenarios) is where consistency is enforced and persistence happens, in a fixed method order with strict rules about what each method may do. Everything in this skill follows from respecting that order.

## Workflow (decision guide)

1. **Pick the implementation type and save variant first** — it shapes everything else:
   - New entity, you own the tables, default save is fine → `managed` (no saver class at all).
   - Managed save is fine but you must do *extra* work at save time (change documents, application log, raise business events, outbound handoff) → `managed with additional save`.
   - You own the tables but the framework must not write them (you call `CONVERT KEY` on another late-numbering BO, you need custom write logic) → `managed with unmanaged save` — framework buffer, your persistence.
   - Existing legacy API (BAPI / function-module suite) owns buffer *and* persistence → fully `unmanaged`.
   - See the [decision table](#choosing-a-strategy--decision-table) below.
2. **Pick numbering** using the [numbering matrix](#numbering--who-assigns-the-key-and-when): who provides the key (consumer, your code, framework) and when (interaction phase vs save sequence).
3. **Place every piece of logic in its legal phase.** Before calling anything external (BAPI, RFC, update FM, bgPF) from a handler or saver method, check the [phase rules](#phase-rules--what-is-allowed-where). Database modifications: late save only. `COMMIT WORK`: never (RAP owns the transaction).
4. **Implement the saver class** (`lsc_*`, inherits `cl_abap_behavior_saver`) redefining only the methods your scenario needs — `save_modified` for additional/unmanaged save, `adjust_numbers` only for late numbering, `save` only for fully unmanaged.
5. **Verify the consumer contract**: `mapped` filled for every created instance, `failed`/`reported` on errors, final keys retrievable after commit in late-numbering scenarios.

## The two phases of a RAP transaction

**Interaction phase** — handler methods (`lhc_*`, base `CL_ABAP_BEHAVIOR_HANDLER`) run. New instances are created in the transactional buffer, or persisted data is read into it. In a managed BO the framework provides and manages this buffer — CRUD works out of the box with only `create; update; delete;` in the BDEF (read works without any syntax). In an unmanaged BO *you* provide the buffer and implement every operation. Buffer state may be temporarily inconsistent; the database is untouched.

**Save sequence** — saver methods (`lsc_*`, base `CL_ABAP_BEHAVIOR_SAVER`) run in fixed order, split into:

- **Early save phase** (repeatable): brings all RAP BOs in the transaction to a consistent state. Failures here are legal — `sy-subrc = 4` after `COMMIT ENTITIES`, the transaction returns to the interaction phase, the user can fix and retry.
- **Late save phase** (point of no return): persists the buffer. You cannot return to the interaction phase — either the commit succeeds, or changes are rolled back and a runtime error occurs. Failures must be detected in the early phase, not here.

`COMMIT ENTITIES` implicitly triggers `COMMIT WORK` and enforces a local (or synchronous, never asynchronous) update. `ROLLBACK ENTITIES` clears the buffer by calling `cleanup` and implicitly triggers `ROLLBACK WORK`. Prefer `COMMIT ENTITIES` over plain `COMMIT WORK`: only `COMMIT ENTITIES` lets you return to the interaction phase on early-save errors, retrieve RAP responses, and convert keys in late-numbering scenarios. Full transaction integration details: [abap-sap-luw](../abap-sap-luw/SKILL.md).

## The save sequence, method by method

```abap
CLASS lsc_bdef DEFINITION INHERITING FROM cl_abap_behavior_saver.
  PROTECTED SECTION.
    "Early save phase ------------------------------------------------
    "1. Final calculations and data modifications involving all
    "   BOs in the current RAP transaction
    METHODS finalize          REDEFINITION.
    "2. Consistency checks on the transactional buffer
    METHODS check_before_save REDEFINITION.
    "   (on failure) roll back what finalize changed
    METHODS cleanup_finalize  REDEFINITION.

    "Late save phase -------------------------------------------------
    "3. Map preliminary IDs to final keys. Late numbering only.
    METHODS adjust_numbers    REDEFINITION.
    "4. Persist the transactional buffer to the database
    METHODS save              REDEFINITION.   "fully unmanaged
    "   (or save_modified in managed BOs with additional/unmanaged save)

    "5. Clear the transactional buffer, completing the sequence
    METHODS cleanup           REDEFINITION.
ENDCLASS.
```

| # | Method | Phase | Contract |
|---|---|---|---|
| 1 | `finalize` | early | Final calculations and data changes before saving. In managed BOs, determinations `on save` execute when this method is reached. EML against your own BO is still possible here — the buffer is still open. |
| 2 | `check_before_save` | early | Consistency checks on the transactional buffer. In managed BOs, validations `on save` execute here. Report problems via `failed`/`reported` — this is the last legal point to fail. |
| — | `cleanup_finalize` | early | Called only if a previous saver method failed: undo the changes `finalize` made, then the transaction returns to the interaction phase (`sy-subrc = 4`). |
| 3 | `adjust_numbers` | late | Late numbering only. Map preliminary identifiers (`%pid`, `%tmp`) to final keys in the `mapped` response parameter. No consumer interaction is possible any more — numbering here is internal by definition. |
| 4 | `save` / `save_modified` | late | Persist buffer state to the database with ABAP SQL. `save` in fully unmanaged BOs; `save_modified` in managed BOs `with additional save` / `with unmanaged save`. No failures expected here; if unavoidable, see the `CL_ABAP_BEHAVIOR_SAVER_FAILED` escape hatch below. On success the framework triggers the final database commit (implicit `COMMIT WORK`). `RAISE ENTITY EVENT` is recommended exactly here. |
| 5 | `cleanup` | after save | Clear the transactional buffer. Also called by `ROLLBACK ENTITIES`. |

Key saver-class facts (all from the EML cheat sheet):

- The saver class is implicitly `ABSTRACT` and `FINAL` — only the RAP runtime engine instantiates and calls it. Define it in the CCIMP include (*Local Types* tab) of the behavior pool.
- Saver methods (unlike handler methods) do **not** import RAP BO instance data — except `save_modified`'s `create`/`update`/`delete` parameters. Everything else must come from the transactional buffer, or be handed over from the interaction phase (e.g. via a class attribute on the global behavior pool class — the pattern the RAP610 workshop uses).
- Once the late save phase starts, you can no longer change your own BO's state via EML — the buffer is final. If save-time logic must write back into your *own* persistence (e.g. storing a key obtained via `CONVERT KEY`), you must own the write: use `with unmanaged save` and plain ABAP SQL in `save_modified`.

Full per-method contract, response parameters, and failure semantics: [references/save-sequence-contract.md](references/save-sequence-contract.md).

## Phase rules — what is allowed where

Condensed from the EML cheat sheet's data-consistency excursion (strict mode turns violations into runtime errors or static check findings):

| Operation | Interaction | Early save | Late save |
|---|---|---|---|
| Database modifications (own persistence) | no | no | **yes — only here** |
| DB commits via secondary connection (logs, traces, number ranges) | yes | yes | yes |
| DB commits via standard connection | yes | yes | no |
| sRFC / aRFC | yes | yes | no |
| Update function module (`IN UPDATE TASK`) | no | no | yes |
| bgRFC (`IN BACKGROUND UNIT`) | no | no | yes |
| tRFC / qRFC | never (obsolete) | never | never |
| `COMMIT WORK` / `ROLLBACK WORK` (RAP is transaction owner) | no | no | no |
| `RAISE ENTITY EVENT` | no | no | yes (in `save`/`save_modified`) |
| Dynpro processing, `CALL TRANSACTION`, `SUBMIT`, `RAISE EXCEPTION` | never | never | never |

Why database modifications only in the late save: in any earlier phase the data is potentially inconsistent, and writing would split the SAP LUW into multiple database transactions. `PERFORM ON COMMIT` is technically possible but signals improper RAP integration — prefer EML or procedure calls that do not contain a `COMMIT WORK`.

## Managed with additional save

The framework still saves to `persistent table`; your `save_modified` runs *in addition*, inside the same LUW — for change documents, application log writes, raising business events, or handing work to bgPF.

```abap
managed with additional save implementation in class zbp_r_salesorder unique;
strict ( 2 );
// variants:
//   managed with additional save with full data implementation in class ... unique;
//   define behavior for SomeEntity with additional save   "per entity instead of whole BO
```

- `save_modified` importing parameters: `create` and `update` typed `REQUEST FOR CHANGE`, `delete` typed `REQUEST FOR DELETE` — deep structures with internal tables of the instances to be created/updated/deleted.
- By default only key values and changed fields arrive. Add `with full data` to receive complete instance data and avoid extra reads.
- `and cleanup` (combinable with `with full data`) additionally requires redefining `cleanup`.
- `%control-<Field> = if_abap_behv=>mk-on` tells you which fields the consumer actually changed — the trigger condition for conditional logging.

```abap
CLASS lsc_zr_salesorder IMPLEMENTATION.
  METHOD save_modified.
    "Framework has handled persistence; add side work only.
    IF create-salesorder IS NOT INITIAL.
      RAISE ENTITY EVENT zr_salesorder~created
        FROM VALUE #( FOR <fs_created_order> IN create-salesorder
                      ( %key = VALUE #( SalesOrderUuid = <fs_created_order>-SalesOrderUuid ) ) ).
    ENDIF.
    LOOP AT update-salesorder INTO DATA(ls_changed_order)
         WHERE %control-OverallStatus = if_abap_behv=>mk-on.
      "write application log entry / change document for the status change
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
```

Change-document caveat: the classic change-document `write` API detects deltas between old and new values, so the persistence order matters — in the SAP reuse-services demo the change document is written *before* the row is persisted, which is why that demo uses `with unmanaged save` (you control the order) rather than additional save. See [examples/unmanaged-save-change-documents.abap](examples/unmanaged-save-change-documents.abap). For a declarative alternative, BDL also offers a `changedocuments` syntax (see the BDL cheat sheet).

**Change Document Solution API (released for ABAP Cloud) in brief:**

- You define a *Change Document Object* for the tables that represent the business object (per table: single vs multiple case); generating it produces the class `CL_<change document object name>_CHDO` (namespace-prefixed) with the `WRITE` method, plus `IF_CHDO_ENHANCEMENTS~AUTHORITY_CHECK` to implement for read authorization.
- `WRITE` creates the change document from old/new images: `objectid`, `udate`/`utime` (system time zone if the Fiori Reuse Library for Change Document Solution displays them), `username`, `object_change_indicator` (U/I/D), single-case work areas `o_<table>`/`n_<table>`, multiple-case tables `x<table>` (new) / `y<table>` (old) with per-table `upd_<table>` indicators (D/I/U/space). It exports the `changenumber` and raises `cx_chdo_write_error`; header data lands in table `CDHDR`.
- Read change documents with `cl_chdo_read_tools=>changedocument_read` (restrict by object ID range, date/time, user, change number); change document objects can themselves be created and generated via `if_chdo_object_tools_rel~create_and_generate_object`.
- Full parameter tables and samples: Change Document Solution docs (see References).

## Managed with unmanaged save

The framework keeps providing the transactional buffer, locking, and draft orchestration — but writes nothing. Your `save_modified` owns all persistence.

```abap
managed implementation in class zbp_r_onlineshop unique;
strict ( 2 );
with draft;

define behavior for ZR_OnlineShop alias OnlineShop
//persistent table zaonlineshop      "NOT allowed together with unmanaged save
draft table zdonlineshop
etag master LocalLastChangedAt
lock master total etag LastChangedAt
authorization master ( global )
with unmanaged save
{
  ...
  mapping for zaonlineshop control zaonlineshop_x corresponding
  { ... }
}
```

- `persistent table` must be removed — the framework would otherwise own the write.
- ADT quick assist (Ctrl+1 on `unmanaged`) generates the `lsc_*` saver class with `save_modified`.
- The `mapping for <table> control <x-structure>` block powers `MAPPING FROM ENTITY`: CDS element names convert to DDIC column names, and the x-structure (one `abap_boolean` per non-key field) mirrors `%control` in DDIC terms.

```abap
METHOD save_modified.
  DATA lt_new_orders TYPE STANDARD TABLE OF zaonlineshop.

  IF create-onlineshop IS NOT INITIAL.
    lt_new_orders = CORRESPONDING #( create-onlineshop MAPPING FROM ENTITY ).
    INSERT zaonlineshop FROM TABLE @lt_new_orders.
  ENDIF.

  IF update-onlineshop IS NOT INITIAL.
    "Variant A: %control-guarded single-column updates
    LOOP AT update-onlineshop INTO DATA(ls_changed_order)
         WHERE %control-OverallStatus = if_abap_behv=>mk-on.
      UPDATE zaonlineshop
        SET overall_status = @ls_changed_order-OverallStatus
        WHERE order_uuid = @ls_changed_order-OrderUuid.
    ENDLOOP.
    "Variant B: let SQL apply exactly the changed columns
    UPDATE zaonlineshop FROM TABLE @update-onlineshop
      INDICATORS SET STRUCTURE %control MAPPING FROM ENTITY.
  ENDIF.

  IF delete-onlineshop IS NOT INITIAL.
    LOOP AT delete-onlineshop INTO DATA(ls_order_to_delete).
      DELETE FROM zaonlineshop WHERE order_uuid = @ls_order_to_delete-OrderUuid.
    ENDLOOP.
  ENDIF.
ENDMETHOD.
```

Use exactly one of the two update variants — variant B (`INDICATORS SET STRUCTURE %control`) is the compact, complete form; variant A is for genuinely selective column logic.

## Fully unmanaged BOs — the implementation contract

You must implement (openSAP RAP course, week 4 — wrapping the `/DMO/FLIGHT_TRAVEL_*` legacy function modules):

| Method | Kind | Duty |
|---|---|---|
| `create FOR MODIFY IMPORTING entities FOR CREATE e` | handler | Write new instances into *your* buffer (here: the legacy API's buffer); assign internal keys if applicable; fill `mapped` (`%cid` → key) |
| `update FOR MODIFY IMPORTING entities FOR UPDATE e` | handler | Apply changed fields to the buffer, using the mapping + x-structure for BAPI-style calls |
| `delete FOR MODIFY IMPORTING keys FOR DELETE e` | handler | Remove from the buffer; fill `mapped` |
| `read FOR READ IMPORTING keys FOR READ e RESULT result` | handler | Read **from the buffer, not the database** — unsaved changes must be visible (etag checks depend on it) |
| `lock FOR LOCK IMPORTING keys FOR LOCK e` | handler | Enqueue via lock object (`cl_abap_lock_object_factory`); report foreign locks via `failed`/`reported` |
| `cba_<assoc> FOR MODIFY ... FOR CREATE e\_assoc` | handler | Create-by-association for child entities |
| `rba_<assoc> FOR READ ... LINK association_links` | handler | Read-by-association; fill `association_links`, `result` only if `result_requested = abap_true` |
| `save` | saver | Flush the buffer to the database (e.g. `CALL FUNCTION '/DMO/FLIGHT_TRAVEL_SAVE'.`) |
| `cleanup` | saver | Reset the buffer (legacy API's initialize call) |

The double-write discipline: every modify handler writes to the buffer *and* records the outcome in `mapped`/`failed`/`reported`; `save` performs the only database write. A create handler wrapping a legacy function module:

```abap
METHOD create.
  DATA lt_messages          TYPE /dmo/t_message.
  DATA ls_legacy_travel_in  TYPE /dmo/travel.
  DATA ls_legacy_travel_out TYPE /dmo/travel.

  LOOP AT entities ASSIGNING FIELD-SYMBOL(<fs_travel_to_create>).
    ls_legacy_travel_in = CORRESPONDING #( <fs_travel_to_create> MAPPING FROM ENTITY USING CONTROL ).

    CALL FUNCTION '/DMO/FLIGHT_TRAVEL_CREATE'   "writes to the legacy buffer, no COMMIT
      EXPORTING is_travel   = CORRESPONDING /dmo/s_travel_in( ls_legacy_travel_in )
      IMPORTING es_travel   = ls_legacy_travel_out
                et_messages = lt_messages.

    IF lt_messages IS INITIAL.
      APPEND VALUE #( %cid     = <fs_travel_to_create>-%cid
                      travelid = ls_legacy_travel_out-travel_id ) TO mapped-travel.
    ELSE.
      APPEND VALUE #( travelid = ls_legacy_travel_in-travel_id ) TO failed-travel.
      APPEND VALUE #( travelid = ls_legacy_travel_in-travel_id
                      %msg     = new_message( id       = lt_messages[ 1 ]-msgid
                                              number   = lt_messages[ 1 ]-msgno
                                              severity = CONV #( lt_messages[ 1 ]-msgty )
                                              v1       = lt_messages[ 1 ]-msgv1
                                              v2       = lt_messages[ 1 ]-msgv2
                                              v3       = lt_messages[ 1 ]-msgv3
                                              v4       = lt_messages[ 1 ]-msgv4 ) ) TO reported-travel.
    ENDIF.
  ENDLOOP.
ENDMETHOD.
```

`MAPPING FROM ENTITY USING CONTROL` additionally applies the x-structure so only consumer-provided fields reach the legacy API — the declarative replacement for hand-written BAPI x-structure filling. Locking and etag handling are also yours: `lock master` still appears in the BDEF, but the enqueue happens in your `lock` method.

## Numbering — who assigns the key, and when

Two independent axes — *when* the final key exists (early = interaction phase, late = save sequence) and *who* provides it (external = consumer, internal = provider). Default with no BDEF specification: **external early** numbering.

| | External (consumer provides) | Internal (provider provides) |
|---|---|---|
| **Early** (final key in interaction phase) | No BDEF clause. Key fields: `field ( mandatory : create, readonly : update )`. Consumer guarantees uniqueness — duplicates are rejected at save | **Managed**: `field ( numbering : managed )` — framework assigns a UUID; key must be a 16-character byte-like type (e.g. `sysuuid_x16`); mark it `readonly`. **Unmanaged early**: `early numbering` clause + `FOR NUMBERING` handler (managed BOs and unmanaged draft-enabled BOs); plain unmanaged BOs simply assign keys inside `create` |
| **Late** (final key in save sequence) | — (impossible: no consumer interaction in the late save phase) | `late numbering` clause + `adjust_numbers` saver method. Works for managed and unmanaged BOs; the numbering itself is always your code |

BDEF snippets per scenario:

```abap
// managed internal early (UUID)
field ( readonly, numbering : managed ) OrderUuid;

// external early (semantic key from the consumer)
field ( mandatory : create, readonly : update ) OrderId;

// unmanaged internal early — keys from your FOR NUMBERING handler
early numbering
{ field ( readonly ) TravelId; ... }

// late — keys assigned in adjust_numbers, shortly before the database save
late numbering
{ field ( readonly ) SalesOrderId; ... }
```

A `FOR NUMBERING` handler (early, unmanaged internal — RAP100 pattern, drawing from a number range):

```abap
METHODS earlynumbering_create FOR NUMBERING
  IMPORTING entities FOR CREATE Travel.

METHOD earlynumbering_create.
  "Idempotency first: instances that already carry a key go straight to mapped
  LOOP AT entities INTO DATA(ls_travel_with_key) WHERE TravelId IS NOT INITIAL.
    APPEND CORRESPONDING #( ls_travel_with_key ) TO mapped-travel.
  ENDLOOP.
  DATA(lt_travels_without_key) = entities.
  DELETE lt_travels_without_key WHERE TravelId IS NOT INITIAL.

  cl_numberrange_runtime=>number_get( EXPORTING nr_range_nr = '01'
                                                object      = '/DMO/TRV_M'
                                                quantity    = CONV #( lines( lt_travels_without_key ) )
                                      IMPORTING number            = DATA(lv_number_range_key)
                                                returned_quantity = DATA(lv_returned_quantity) ).
  DATA(lv_next_travel_id) = CONV /dmo/travel_id( lv_number_range_key - lv_returned_quantity ).

  LOOP AT lt_travels_without_key INTO DATA(ls_travel_to_number).
    lv_next_travel_id += 1.
    ls_travel_to_number-TravelId = lv_next_travel_id.
    APPEND VALUE #( %cid      = ls_travel_to_number-%cid
                    %key      = ls_travel_to_number-%key
                    %is_draft = ls_travel_to_number-%is_draft ) TO mapped-travel.
  ENDLOOP.
ENDMETHOD.
```

Note the number range draws on a secondary DB connection — that is why it is legal outside the late save phase. Uniqueness is *your* problem everywhere the framework does not number for you.

Full matrix with BDEF/handler pairings and draft nuances: [references/numbering-matrix.md](references/numbering-matrix.md).

## Late numbering in depth

In the interaction phase, created instances live under **preliminary identifiers**: a preliminary key in `%key` and/or a preliminary ID in `%pid` (type `ABP_BEHV_PID`, exists only in late-numbering scenarios). `%tky` contains both (plus `%is_draft`), which is why you should always address instances via `%tky`. `%pky` (= `%pid` + `%key`) exists for contexts where `%tky` is unavailable. (Full derived-type component reference: [rap-eml](../rap-eml/SKILL.md).)

When `adjust_numbers` is reached, the components shift roles:

- The preliminary key values from `%key` move to **`%tmp`**.
- `%pid` stays as is.
- **`%pre`** = `%pid` + `%tmp` — all preliminary identifiers.
- Your job: for every row of `mapped-<entity>`, map `%pre` (which must be unique in total) to the **final key in `%key`**.

Simplest possible implementation (cheat-sheet demo — the key field is a UUID type, so the `%pid` value itself can serve as final key):

```abap
METHOD adjust_numbers.
  LOOP AT mapped-calc ASSIGNING FIELD-SYMBOL(<fs_calculation>).
    <fs_calculation>-%key-id = <fs_calculation>-%pid.
  ENDLOOP.
ENDMETHOD.
```

Production shape — number range for the root, children resolving their parent's freshly assigned key through the association `LINK` table — in [examples/late-numbering-adjust-numbers.abap](examples/late-numbering-adjust-numbers.abap).

Consumers get final keys back through the `mapped` response of `COMMIT ENTITIES ... RESPONSE OF`, or by converting a remembered `%pid` with `CONVERT KEY OF bdef FROM ... TO ...` — which requires the final keys to exist, i.e. it runs after/inside the save sequence (the RAP610 workshop calls it inside its own `save_modified`, see the next section).

## Wrapping legacy APIs (BAPIs and function modules)

Three patterns, escalating by how much the legacy API cooperates:

**1. The legacy API manages a buffer and has a separate SAVE call, and never commits** → fully unmanaged BO. Handlers delegate to the buffer FMs, `save` calls the save FM, `cleanup` calls the init FM. Iron rule: **the wrapped API must not `COMMIT WORK`** — the RAP framework issues the one and only commit after `save` returns. An API that commits on its own splits the SAP LUW and breaks draft handling ([abap-sap-luw](../abap-sap-luw/SKILL.md)).

**2. You call another RAP BO (e.g. a released API like `I_PurchaseRequisitionTP`) from your action and must store its late-numbered key in your own tables** → `managed with unmanaged save` (RAP610 pattern):

- The action does the cross-BO EML `MODIFY ENTITIES OF i_purchaserequisitiontp ... MAPPED DATA(lt_mapped_pr)` and stashes `lt_mapped_pr` in a `CLASS-DATA` attribute of the global behavior pool class (`mt_mapped_pr TYPE RESPONSE FOR MAPPED i_purchaserequisitiontp`) — the sanctioned way to carry data from the interaction phase into the save sequence.
- The action also updates own fields via EML so the save sequence is guaranteed to run.
- In `save_modified`: `CONVERT KEY OF i_purchaserequisitiontp FROM <fs_mapped_row>-%pid TO DATA(ls_final_pr_key).` — then write the final key into your persistent table with plain SQL. This write into your own persistence is exactly why additional save is not enough here: the framework must not also write the row.

**3. The API demands its own commit/LUW (classic BAPI + `BAPI_TRANSACTION_COMMIT`, enqueue-heavy legacy transaction)** → do **not** call it in the RAP transaction at all. Decouple via **bgPF** (background processing framework): in `save_modified`/`save`, register an operation object and `save_for_execution( )` — the framework runs it in its own LUW after the RAP commit:

```abap
"inside save_modified — bgPF handoff (transactionally uncontrolled operation)
DATA(lo_background_process) = cl_bgmc_process_factory=>get_default( )->create( ).
lo_background_process->set_operation_tx_uncontrolled( follow_up_operation ).
lo_background_process->set_name( |Follow-up for { sales_order_id }| ).
lo_background_process->save_for_execution( ).
```

Setup, operation classes, and retry semantics: [abap-background-processing](../abap-background-processing/SKILL.md). Raising a business event (`RAISE ENTITY EVENT` in `save`/`save_modified`) is the other decoupling option — see [rap-business-events-side-effects](../rap-business-events-side-effects/SKILL.md).

**Escape hatch for unavoidable late failures:** if a wrapped API can fail in the late save phase (violating the rule that failures belong in the early phase), base the saver class on `CL_ABAP_BEHAVIOR_SAVER_FAILED` instead of `CL_ABAP_BEHAVIOR_SAVER`. It exposes response parameters the normal base class hides; after the failure `sy-subrc = 8` follows `COMMIT ENTITIES`, and the consumer must issue an explicit `ROLLBACK ENTITIES` before continuing.

## Choosing a strategy — decision table

| Situation | Declare | You implement |
|---|---|---|
| Greenfield entity, standard persistence | `managed` | Nothing save-related |
| Managed + change documents / app log / events / bgPF at save | `managed with additional save [with full data]` | `save_modified` (side work only) |
| Managed buffer, but you own the DB writes (CONVERT KEY write-back, custom SQL) | `managed with unmanaged save` (no `persistent table`) | `save_modified` (all persistence) |
| Legacy API owns buffer + persistence | `unmanaged` | create/update/delete/read/lock (+ cba/rba) handlers, `save`, `cleanup` |
| Keys: consumer supplies semantic key | external early (no clause) + `mandatory : create, readonly : update` | Uniqueness precheck if needed |
| Keys: framework UUID | `field ( numbering : managed )` + `readonly` | Nothing |
| Keys: your logic, visible immediately in the UI | `early numbering` | `FOR NUMBERING` handler |
| Keys: number range / final key only at save (gapless-ish, cross-entity) | `late numbering` | `adjust_numbers` |
| Save-time work needs its own LUW | any + bgPF | Operation class + registration in `save`/`save_modified` |

## Quick Reference

| Syntax / element | Meaning |
|---|---|
| `managed with additional save` | Framework saves; your `save_modified` adds side work in the same LUW |
| `managed with unmanaged save` | Framework buffer; your `save_modified` does all persistence; no `persistent table` allowed |
| `with full data` | Pass complete instance data (not just keys + changed fields) to `save_modified` |
| `and cleanup` | You must also redefine `cleanup` |
| `define behavior for E with additional save` | Save variant per entity instead of whole BO |
| `mapping for tab control xstruct corresponding` | Enables `MAPPING FROM ENTITY [USING CONTROL]` / `MAPPING TO ENTITY` |
| `UPDATE tab FROM TABLE @update-e INDICATORS SET STRUCTURE %control MAPPING FROM ENTITY` | Persist exactly the changed columns |
| `finalize` → `check_before_save` → [`cleanup_finalize`] | Early save phase (failures legal, `sy-subrc = 4`, back to interaction) |
| `adjust_numbers` → `save`/`save_modified` → `cleanup` | Late save phase (point of no return) |
| `field ( numbering : managed )` | Framework UUID key (16-char byte-like type) |
| `early numbering` | `FOR NUMBERING` handler assigns keys in the interaction phase |
| `late numbering` | `adjust_numbers` assigns final keys; `%pid`/`%tmp`/`%pre` until then |
| `%pid` / `%pky` / `%tmp` / `%pre` | Preliminary ID / `%pid`+`%key` / preliminary key in `adjust_numbers` / `%pid`+`%tmp` |
| `CONVERT KEY OF bdef FROM %pid TO key` | Preliminary → final key, once final keys exist |
| `CL_ABAP_BEHAVIOR_SAVER_FAILED` | Saver base class when late-save failures are unavoidable (`sy-subrc = 8`) |
| `RAISE ENTITY EVENT` | Only in `save`/`save_modified` |

## Common Mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| `COMMIT WORK` inside a wrapped BAPI/FM called from a handler or saver | Runtime error or shattered LUW; draft data half-committed | Wrap only commit-free APIs; APIs needing own commit go to bgPF after the RAP commit |
| Writing to your persistent table in a determination or action | Multiple DB transactions, broken SAP LUW, strict-mode runtime error | Buffer changes via EML in the interaction phase; DB writes only in `save`/`save_modified` |
| `persistent table` kept together with `with unmanaged save` | BDEF syntax error | Remove/comment the `persistent table` clause — you own persistence now |
| Additional save chosen, but the logic writes into the BO's own tables | Duplicate/conflicting writes with the framework save | Use `with unmanaged save` — that is the RAP610 rule for `CONVERT KEY` write-back |
| Updating all columns in `save_modified` regardless of `%control` | Untouched fields overwritten with initial values | Guard with `%control-<Field> = if_abap_behv=>mk-on` or use `INDICATORS SET STRUCTURE %control` |
| Expecting full instance data in `save_modified` by default | Empty non-key fields at save | Declare `with full data`, or read what you need before the late phase |
| Business validation in `save_modified` | Failure at the point of no return → runtime error | Fail in `check_before_save` (or validations `on save`); late failures only via `CL_ABAP_BEHAVIOR_SAVER_FAILED` + `ROLLBACK ENTITIES` |
| `read` handler of an unmanaged BO selects from the database | Stale reads; etag checks miss in-transaction changes | Read from the transactional buffer (legacy API read FM) |
| Late numbering, but `mapped` rows left without final `%key` | Instances unsavable / duplicate-key rejections | Map every `%pre` (unique in total) to a final `%key` in `adjust_numbers` |
| Assigning `wa-%tky = wa-%key` or copying `%tky` across entities | Syntax warnings now, breakage when draft/late numbering is added | Use `CORRESPONDING #( )` between different key component groups; direct assignment only for the same group of the same entity |
| Forgetting `mapped` in a `FOR NUMBERING` handler for instances that already have a key | Duplicate numbering on draft resume; non-idempotent creates | First pass instances with existing keys straight to `mapped`, then number the rest |
| Calling `CONVERT KEY` in the interaction phase | No final key exists yet | Call it in the save sequence (`save_modified`) or after `COMMIT ENTITIES` |

## References

- [references/save-sequence-contract.md](references/save-sequence-contract.md) — per-method save-sequence contract, phase rules, failure semantics
- [references/numbering-matrix.md](references/numbering-matrix.md) — full numbering matrix with BDEF + handler pairings
- [examples/late-numbering-adjust-numbers.abap](examples/late-numbering-adjust-numbers.abap) — number-range `adjust_numbers` for a root + child BO
- [examples/unmanaged-save-change-documents.abap](examples/unmanaged-save-change-documents.abap) — unmanaged save with change documents and bgPF handoff
- **Change Document Solution (concept, CDHDR, change flags):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/change-document-solution-741220a.md
- **Writing Change Documents (`CL_<cdo>_CHDO`→`WRITE` parameters):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/writing-change-documents-bf7a980.md
- **Reading Change Documents (`CL_CHDO_READ_TOOLS`):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/reading-change-documents-c34f02d.md
- **RAP Save Options (BDL):** https://help.sap.com/docs/abap-cloud/abap-rap/save-options
- **Additional Save:** https://help.sap.com/docs/abap-cloud/abap-rap/additional-save
- **Unmanaged Save:** https://help.sap.com/docs/abap-cloud/abap-rap/unmanaged-save
- **Numbering:** https://help.sap.com/docs/abap-cloud/abap-rap/numbering
- **Unmanaged Internal Late Numbering:** https://help.sap.com/docs/abap-cloud/abap-rap/unmanaged-internal-late-numbering
- **BO Implementation Types:** https://help.sap.com/docs/abap-cloud/abap-rap/business-object-implementation-types
- **General RAP BO Implementation Contract:** https://help.sap.com/docs/abap-cloud/abap-rap/general-rap-bo-implementation-contract
- **Controlled SAP LUW:** https://help.sap.com/docs/abap-cloud/abap-concepts/controlled-sap-luw
- **ABAP keyword docs — saver class:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabp_saver_class.htm
- **ABAP keyword docs — adjust_numbers:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abensaver_adjust_numbers.htm
- **ABAP keyword docs — BDL saving:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenbdl_saving.htm
- **EML cheat sheet (save sequence, consistency, %pid excursions):** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/08_EML_ABAP_for_RAP.md
- **BDL cheat sheet (header options, numbering):** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/36_RAP_Behavior_Definition_Language.md
- **RAP610 ex. 4 — unmanaged save + CONVERT KEY:** https://github.com/SAP-samples/abap-platform-rap-workshops/blob/main/rap6xx/rap610/exercises/ex4/README.md
- **openSAP RAP course wk4 — unmanaged BO wrapping /DMO/ FMs:** https://github.com/SAP-samples/abap-platform-rap-opensap/blob/main/week4/unit3.md
- **Reuse services demo (change docs, number range, bgPF in saver):** https://github.com/SAP-samples/abap-platform-reuse-services
- **Flight Reference Scenario (managed/unmanaged/draft branches):** https://github.com/SAP-samples/abap-platform-refscen-flight
- Linked skills: [rap-bo-modeling](../rap-bo-modeling/SKILL.md) (BO scaffolding — this skill is the deep dive behind its saver-class section), [rap-eml](../rap-eml/SKILL.md) (EML and BDEF derived types), [abap-sap-luw](../abap-sap-luw/SKILL.md), [abap-background-processing](../abap-background-processing/SKILL.md), [rap-business-events-side-effects](../rap-business-events-side-effects/SKILL.md)
