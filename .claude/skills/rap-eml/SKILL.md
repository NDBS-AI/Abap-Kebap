---
name: rap-eml
description: Use when consuming, modifying, or testing RAP business objects from ABAP code with EML (Entity Manipulation Language) — MODIFY ENTITIES (CREATE, CREATE BY association, UPDATE, DELETE, EXECUTE action), READ ENTITIES (FIELDS WITH, ALL FIELDS WITH, BY association), COMMIT ENTITIES, ROLLBACK ENTITIES, GET PERMISSIONS, SET LOCKS, and the BDEF derived types behind them (TYPE TABLE FOR CREATE, TYPE RESPONSE FOR FAILED) with components %cid, %cid_ref, %key, %tky, %pky, %pid, %is_draft, %control, %element, %param, %msg, %fail, %target and constants like if_abap_behv=>mk-on. Trigger phrases include "read a RAP BO from code", "create an instance via EML", "%control", "%tky vs %key", "COMMIT ENTITIES failed", "sy-subrc after COMMIT ENTITIES", "IN LOCAL MODE", "AUTO FILL CID", "deep create with %cid_ref", "mapped failed reported", "MAPPING FROM ENTITY", "EML in ABAP Unit tests". Covers consumer-side EML and the additions that exist only inside behavior pools.
---

# EML — Entity Manipulation Language for RAP

## Overview

EML is the ABAP subset for accessing RAP business object data in the transactional buffer from ABAP code. Everything a Fiori app does through OData — create, read, update, delete, execute actions, commit — your ABAP code (consumers, batch jobs, tests, and the behavior pool itself) does through EML.

This skill is the deep dive on EML statements and BDEF derived types. For BO architecture (managed vs unmanaged, BDEF syntax, handler/saver classes, projections), see [rap-bo-modeling](../rap-bo-modeling/SKILL.md) — its short EML section points here.

**Core mental model:** EML never talks to the database directly. `MODIFY`/`READ` work on the *transactional buffer* during the *interaction phase*. Only `COMMIT ENTITIES` triggers the *save sequence* that persists. Communication is via internal tables with *BDEF derived types* whose `%` components (`%cid`, `%tky`, `%control`, ...) carry identity, field selection, and responses.

## Workflow

1. **Identify your role.** External consumer (class, test, batch job) → plain EML. Code inside the behavior pool → same EML plus `IN LOCAL MODE` and ABP-only types; feature controls/authorizations behave differently.
2. **Declare or derive the types.** Use `TYPE TABLE FOR <operation> <entity>` explicitly, or build everything inline with `VALUE #( ... )`. See [references/derived-types.md](references/derived-types.md).
3. **Issue MODIFY / READ.** Choose the field-selection form (`FIELDS ( ... ) WITH` sets `%control` for you; `FROM` requires you to set it). Bundle related operations in one long-form statement.
4. **Evaluate `mapped` / `failed` / `reported` immediately.** A `MODIFY` that fails does not raise an exception — failures land in `failed`, messages in `reported`.
5. **`COMMIT ENTITIES` and check `sy-subrc`.** Use `RESPONSE OF` to get per-BO failures. On failure: evaluate, then `ROLLBACK ENTITIES` if you want to continue in the same session.
6. **In tests,** isolate the BO with `cl_botd_txbufdbl_bo_test_env` (transactional buffer double) or `cl_botd_mockemlapi_bo_test_env` (mock the EML API) — see [abap-unit-tdd](../abap-unit-tdd/SKILL.md).

## RAP terms you need

| Term | Meaning |
|---|---|
| RAP BO instance | One concrete data set of an entity (a "row" of the BO) in the transactional buffer |
| Transactional buffer | In-memory storage for BO data during one SAP LUW; EML reads/writes it |
| Interaction phase | Handler methods run; data is created/changed in the buffer only; buffer may be temporarily inconsistent, the database never is |
| Save sequence | Triggered by `COMMIT ENTITIES`; early save phase (`finalize`, `check_before_save`, `cleanup_finalize` — can still return to interaction phase) then late save phase (`adjust_numbers`, `save`/`save_modified` — point of no return) then `cleanup` |
| RAP BO consumer | Whoever drives the BO: the OData/RAP transactional engine, or your ABAP code via EML |
| RAP BO provider | Managed framework and/or your behavior pool implementation |

## BDEF derived types — declaration forms

Every EML operand and handler parameter is typed with a type *derived* from the CDS entity + BDEF. Only what the BDEF enables can be derived (no `delete;` in the BDEF → no `TYPE TABLE FOR DELETE`).

```abap
"Tabular types — the workhorses
DATA lt_create_instances   TYPE TABLE FOR CREATE zdemo_abap_rap_ro_m.
DATA lt_update_instances   TYPE TABLE FOR UPDATE zdemo_abap_rap_ro_m.
DATA lt_delete_instances   TYPE TABLE FOR DELETE zdemo_abap_rap_ro_m.
DATA lt_read_keys          TYPE TABLE FOR READ IMPORT zdemo_abap_rap_ro_m.
DATA lt_read_result        TYPE TABLE FOR READ RESULT zdemo_abap_rap_ro_m.
DATA lt_action_input       TYPE TABLE FOR ACTION IMPORT zdemo_abap_rap_ro_m~multiply_by_2.
"Only if the action declares `result` in the BDEF:
"DATA lt_action_result     TYPE TABLE FOR ACTION RESULT zdemo_abap_rap_ro_m~some_action.
DATA lt_create_by_assoc    TYPE TABLE FOR CREATE zdemo_abap_rap_ro_m\_child.
DATA lt_lock_keys          TYPE TABLE FOR KEY OF zdemo_abap_rap_ro_m.

"Structured types — work areas / single rows
DATA ls_create_row         TYPE STRUCTURE FOR CREATE zdemo_abap_rap_ro_m.
DATA ls_permission_request TYPE STRUCTURE FOR PERMISSIONS REQUEST zdemo_abap_rap_ro_m.

"Response types — deep structures with one table per entity
DATA lt_mapped_response    TYPE RESPONSE FOR MAPPED zdemo_abap_rap_ro_m.
DATA lt_failed_response    TYPE RESPONSE FOR FAILED zdemo_abap_rap_ro_m.
DATA lt_reported_response  TYPE RESPONSE FOR REPORTED zdemo_abap_rap_ro_m.
```

Naming forms: short form names an entity directly (`... FOR UPDATE zdemo_abap_rap_ch_m.`); long form is root + `\\` + entity (alias if one is defined): `... FOR UPDATE zdemo_abap_rap_ro_m\\child.`; associations are prefixed `\`: `... FOR CREATE zdemo_abap_rap_ro_m\_child.`

ABP-only types (usable only inside implementation classes): `FOR CHANGE`, `FOR DETERMINATION`, `FOR VALIDATION`, `FOR ... FEATURES`, `FOR ... AUTHORIZATION`, `REQUEST FOR CHANGE`, `REQUEST FOR DELETE`, `TABLE FOR READ CHANGES`.

Full catalog, `EARLY`/`LATE` variants, and the secondary table keys (`entity`, `cid`, `draft`, `pid`) of these tables: [references/derived-types.md](references/derived-types.md).

## The % component catalog

Components starting with `%` are RAP-specific; the rest are the entity's own key and data fields. Availability depends on the BDEF (draft, late numbering, actions).

| Component | What it is | When it is filled |
|---|---|---|
| `%cid` | Content ID (string) — preliminary, request-local identifier for a created instance | You fill it on every `CREATE` row (or use `AUTO FILL CID`); valid only within one EML request |
| `%cid_ref` | Reference to a `%cid` from the same request | You fill it on `UPDATE`/`DELETE`/`EXECUTE`/`CREATE BY` rows that target a just-created instance |
| `%key` | Component group: all primary key fields | Identifies persisted/known instances; holds preliminary keys in late numbering until `adjust_numbers` |
| `%is_draft` | Draft indicator (`ABP_BEHV_FLAG`) | Draft scenarios: `mk-on` = draft instance, `mk-off` = active instance |
| `%pid` | Preliminary ID (`ABP_BEHV_PID`) | Late numbering scenarios only |
| `%pky` | `%pid` + `%key` (late numbering) or just `%key` | Contexts where `%tky` is unavailable (certain actions) still offer `%pky` |
| `%tky` | Transactional key = `%key` + `%is_draft` (+ `%pid`) | **Use this everywhere you can** — it survives a later switch to draft/late numbering |
| `%data` | Component group: all key + data fields (contains `%key`) | Reading/writing instance data as a block |
| `%control` | One flag per field (`ABP_BEHV_FLAG`) | Marks which fields count in the request/response; `FIELDS ( ... ) WITH` fills it for you, `FROM` does not |
| `%element` | One flag per field, in `reported` rows | Marks which fields a message relates to (UI highlights them) |
| `%msg` | Message object | Fill in `reported` via `new_message( )` / `new_message_with_text( )` |
| `%fail` | Failure info, notably `%fail-cause` | Filled in `failed` rows; causes like `if_abap_behv=>cause-not_found`, `cause-locked` |
| `%op` | Which operation a `failed` row belongs to | Evaluate `%op-%create`, `%op-%update`, `%op-%delete`, `%op-%assoc-...`, `%op-%action-...` |
| `%action` | One flag per action | In `failed` rows (which action failed) and feature/permission results |
| `%assoc` | One flag per association | Create-by-association contexts, feature/permission results |
| `%param` | Action/function/event parameter data | Input rows of parameterized actions; **result rows of actions** (`RESULT` table rows = keys + `%param`); event payloads |
| `%target` | Table of child rows in create-by-association | Each `%target` row has its own `%cid` + child fields |
| `%global` | Marks a `reported` message as instance-independent | `%global = if_abap_behv=>mk-on` → message belongs to the entity, not one instance |

There is **no `%result` component** — action results travel in the `RESULT` operand's rows via `%param`. Full catalog with types, constants, and late-numbering extras (`%tmp`, `%pre`, `%field`, `%features`): [references/derived-types.md](references/derived-types.md).

## Constants — if_abap_behv

```abap
%control-field1 = if_abap_behv=>mk-on.      "mark field (also mk-off)
%fail-cause     = if_abap_behv=>cause-not_found.  "also: unspecific, locked, unauthorized, disabled, readonly, dependency, conflict
op = if_abap_behv=>op-m-create.             "dynamic EML: op-m-update, op-m-delete,
                                            "op-m-create_ba, op-r-read, op-r-read_ba
```

`mk` is for marking fields (`%control`, `%element`); permission and feature-control results use dedicated constant groups (`perm-f`, `perm-o`, `fc-f`, `fc-o`, `auth`) — same technical type, use the matching group. Details in [references/derived-types.md](references/derived-types.md).

## MODIFY ENTITIES — create, update, delete, execute

Short form (one entity), `FIELDS ( ... ) WITH` sets `%control` automatically:

```abap
MODIFY ENTITY zdemo_abap_rap_ro_m
  CREATE FIELDS ( key_field field1 field2 )
  WITH VALUE #( ( %cid = 'create_1' key_field = 1 field1 = 'A' field2 = 'B' ) )
  MAPPED   DATA(lt_mapped_response)
  FAILED   DATA(lt_failed_response)
  REPORTED DATA(lt_reported_response).
```

Long form (`MODIFY ENTITIES OF <root>`) bundles several operations — on one entity or across entities of the same BO — in **one** statement; the response clauses come once, after all operations:

```abap
MODIFY ENTITIES OF zdemo_abap_rap_ro_m
  ENTITY root
    CREATE FIELDS ( key_field field1 field2 )
    WITH VALUE #( ( %cid = 'cid4' key_field = 4 field1 = 'G' field2 = 'H' ) )
    UPDATE FIELDS ( field2 )
    WITH VALUE #( ( %cid_ref = 'cid4' field2 = 'Z' ) )   "refer to the new instance
    DELETE FROM
    VALUE #( ( key_field = 9 ) )                          "or ( %cid_ref = ... )
    EXECUTE multiply_by_2 FROM
    VALUE #( ( %cid_ref = 'cid4' ) ( key_field = 1 ) )
  MAPPED   DATA(lt_mapped_response)
  FAILED   DATA(lt_failed_response)
  REPORTED DATA(lt_reported_response).
```

Key rules:
- `FIELDS ( f1 f2 ) WITH lt_itab` — listed fields get `%control = mk-on`, unlisted `mk-off` (their values are ignored). `FROM lt_itab` — you must fill `%control` yourself. `DELETE` allows only `FROM` (rows = key or `%cid_ref` only). Avoid `SET FIELDS WITH` (limitations, syntax warnings).
- `%cid` must be unique per request; fill it even when unused, or use `CREATE AUTO FILL CID` — but then you cannot reference the instance via `%cid_ref` later.
- In draft scenarios, create drafts with `%is_draft = if_abap_behv=>mk-on` in the rows.
- `MAPPED` returns `%cid` → key mapping for creates; there is no `MAPPED` for pure update/delete.
- Actions with a declared `result` add `RESULT DATA(...)` **directly after that `EXECUTE` clause**; rows contain the keys plus `%param`.

Deep create (root + children in one request) uses `CREATE BY \_assoc` with `%cid_ref` pointing at the parent's `%cid` and `%target` holding the child rows:

```abap
MODIFY ENTITIES OF zdemo_abap_rap_ro_m
  ENTITY root
    CREATE FIELDS ( key_field field1 ) WITH
      VALUE #( ( %cid = 'parent_1' key_field = 6 field1 = 'I' ) )
    CREATE BY \_child
    FIELDS ( key_ch field_ch1 ) WITH
      VALUE #( ( %cid_ref = 'parent_1'
                 %target = VALUE #( ( %cid = 'child_1' key_ch = 1 field_ch1 = 'aa' )
                                    ( %cid = 'child_2' key_ch = 2 field_ch1 = 'bb' ) ) ) )
  MAPPED   DATA(lt_mapped_response)
  FAILED   DATA(lt_failed_response)
  REPORTED DATA(lt_reported_response).
```

A dynamic form `MODIFY ENTITIES OPERATIONS op_tab` (type `abp_behv_changes_tab`, one row per operation with `op`, `entity_name`, `instances`, optional `sub_name`) handles multiple BOs in one statement — see [references/eml-statement-catalog.md](references/eml-statement-catalog.md).

## READ ENTITIES

Reads return the buffer state (including uncommitted changes); missing instances are loaded from the database into the buffer (managed). Read is always enabled — no BDEF notation needed. `RESULT` is mandatory.

```abap
READ ENTITIES OF zdemo_abap_rap_ro_m
  ENTITY root
  ALL FIELDS WITH VALUE #( ( key_field = 1 )    "TYPE TABLE FOR READ IMPORT: keys (+ %control)
                           ( key_field = 2 ) )
  RESULT   DATA(lt_active_instances)
  FAILED   DATA(lt_failed_read)
  REPORTED DATA(lt_reported_read).

"Read by association — works both directions (parent→child, child→parent)
READ ENTITIES OF zdemo_abap_rap_ro_m
  ENTITY root
  BY \_child
  ALL FIELDS WITH VALUE #( ( key_field = 1 ) )
  RESULT DATA(lt_child_instances)
  LINK   DATA(lt_key_links).       "optional: source/target key pairs
```

Field selection: `FIELDS ( f1 f2 ) WITH`, `FROM` (fill `%control` yourself), or `ALL FIELDS WITH`. Fields with `%control = mk-off` come back initial. Inside behavior pools, `READ ... IN LOCAL MODE ... WITH CHANGES` additionally returns `%chg` accumulated-change info (managed BOs only). Dynamic form: `READ ENTITIES OPERATIONS op_tab` (type `abp_behv_retrievals_tab`).

## Response parameters — what and in which order

| Parameter | Filled for | Content |
|---|---|---|
| `MAPPED` | Creating operations only | `%cid` (+ `%pid`) → key mapping per entity |
| `FAILED` | Any operation | Identifies instances that failed; `%fail-cause`, `%op`, `%action` say why/where |
| `REPORTED` | Any operation | Messages per entity: `%msg`, `%element-...`, `%global` |
| `RESULT` | READ and actions/functions with result | Instance data; for actions, keys + `%param` |

Order that matters: per-operation clauses (`RESULT`, `LINK`) follow their operation; the statement-level response clauses (`MAPPED`/`FAILED`/`REPORTED`) come once at the end, conventionally in that order. Retrieving them is optional syntax-wise — evaluating `failed` is not optional in any code you want to trust.

## COMMIT ENTITIES and the RAP LUW

```abap
COMMIT ENTITIES RESPONSE OF zdemo_abap_rap_ro_m
  FAILED   DATA(lt_failed_commit)
  REPORTED DATA(lt_reported_commit).

IF sy-subrc <> 0.
  "React: evaluate lt_failed_commit/lt_reported_commit; ROLLBACK ENTITIES to continue cleanly
ENDIF.
```

- `COMMIT ENTITIES` triggers the save sequence and implicitly includes `COMMIT WORK`. Always check `sy-subrc`: `0` success, `4` failure in the early save phase (you can return to the interaction phase), `8` failure in the late save phase (saver class based on `cl_abap_behavior_saver_failed`; continue only after an explicit `ROLLBACK ENTITIES`).
- Variants: short (`COMMIT ENTITIES.` / `... RESPONSES FAILED ... REPORTED ...` with `abp_behv_response_tab`), long (`RESPONSE OF <root> ...` per BO), dynamic (`RESPONSES OF name_tab`), commit scope (`COMMIT ENTITIES BEGIN ... CONVERT KEY OF ... COMMIT ENTITIES END.` for late numbering key conversion), and `COMMIT ENTITIES IN SIMULATION MODE` (runs only the early save phase, persists nothing — a consistency dry run; follow with `ROLLBACK ENTITIES` to clear the buffer).
- **Not allowed in behavior implementations:** `COMMIT ENTITIES` cannot be used inside handler/saver methods. Within a RAP transaction, database modifications belong only in the late save phase; `COMMIT WORK`/`ROLLBACK WORK`, `CALL TRANSACTION`, `SUBMIT`, dynpro statements, and `RAISE EXCEPTION` out of a RAP transaction are forbidden in behavior implementations. Full phase table in [references/eml-statement-catalog.md](references/eml-statement-catalog.md); LUW background in [abap-sap-luw](../abap-sap-luw/SKILL.md). Need to modify *and commit* another BO from inside a handler? Modify without commit (it joins the same LUW) by default; for an isolated immediate commit run the work in a `CL_ABAP_PARALLEL` task (own session, own LUW — [abap-parallel-processing](../abap-parallel-processing/SKILL.md)); for after-commit async use bgPF or a business event.
- Prefer `COMMIT ENTITIES` over `COMMIT WORK` in RAP: same happy path, but only `COMMIT ENTITIES` lets you retrieve responses, convert keys, simulate, and return to the interaction phase on early-save errors instead of dumping.

`ROLLBACK ENTITIES` discards all changes of the current RAP transaction: clears the transactional buffer (calls `cleanup`) and releases locks. It implicitly triggers `ROLLBACK WORK`.

## GET PERMISSIONS

Ask a BO what the current user/instance may do — global/instance authorization and feature control — e.g. to drive your own UI enablement:

```abap
DATA ls_permission_request TYPE STRUCTURE FOR PERMISSIONS REQUEST zdemo_abap_rap_ro_m.

ls_permission_request = VALUE #( %create       = if_abap_behv=>mk-on
                              %update       = if_abap_behv=>mk-on
                              %delete       = if_abap_behv=>mk-on
                              %field-field1 = if_abap_behv=>mk-on ).

GET PERMISSIONS ONLY GLOBAL ENTITY zdemo_abap_rap_ro_m
  REQUEST ls_permission_request
  RESULT   DATA(ls_permission_result)
  FAILED   DATA(lt_failed_permissions)
  REPORTED DATA(lt_reported_permissions).
```

Note the `REQUEST` operand is a *structure*, not a table. `ONLY GLOBAL` restricts to global authorization + global/static feature control; other only-clauses and instance variants exist.

## SET LOCKS

Explicitly acquire the exclusive (enqueue) locks for instances — normally the framework locks on modify, but `SET LOCKS` lets you lock up front. The lock lives until the RAP transaction ends (commit/rollback):

```abap
DATA lt_lock_keys TYPE TABLE FOR KEY OF zdemo_abap_rap_ro_u.
lt_lock_keys = VALUE #( ( key_field = 1 ) ( key_field = 2 ) ).

SET LOCKS ENTITY zdemo_abap_rap_ro_u
  FROM lt_lock_keys
  FAILED   DATA(lt_failed_locks)
  REPORTED DATA(lt_reported_locks).
```

Failed rows carry `%fail-cause = if_abap_behv=>cause-locked` when someone else holds the lock. Long form (`SET LOCKS OF <root> ENTITY ... FROM ...`) locks across the composition tree; dynamic form takes `abp_behv_locks_tab`.

## EML inside behavior pools

- **`IN LOCAL MODE`** (`MODIFY ... IN LOCAL MODE`, `READ ... IN LOCAL MODE`): suppresses feature controls, authorization checks, and prechecks. Standard for the BO's own reads/writes — e.g. an action must update a field that is `readonly` for external consumers. Only available in behavior pools (and ABP auxiliary classes, which may also use `PRIVILEGED` to skip authorization checks).
- **Filling responses:** handler methods fill `failed-<entity>` / `reported-<entity>` (append `%tky` plus `%msg`, `%element`, `%fail-cause`); consumer-side EML *receives* them via `FAILED DATA(...)` / `REPORTED DATA(...)`. Same structures, opposite direction.
- **`MODIFY AUGMENTING ENTITY`** (+ `RELATING TO ... BY`): projection-layer-only variant to enrich incoming requests before buffering; no response parameters.
- **Business events:** raised in the save phase with `RAISE ENTITY EVENT` — see [rap-business-events-side-effects](../rap-business-events-side-effects/SKILL.md); not re-explained here.
- A behavior-pool EML tour (validation, determination, action result) is in [examples/eml_in_behavior_pool.abap](examples/eml_in_behavior_pool.abap).

## Type mapping — entity names vs database names

When CDS element names differ from DDIC field names, declare the mapping in the BDEF and let conversions use it:

```abap
"BDEF (BDL):        mapping for zdemoabap corresponding
"                   { CalcResult = calc_result; ... }

"CORRESPONDING additions for BDEF derived types:
new_rows = CORRESPONDING #( create-root MAPPING FROM ENTITY ).   "entity → DB names
entity_rows = CORRESPONDING #( db_rows MAPPING TO ENTITY ).      "DB → entity names
plain = CORRESPONDING #( derived USING CONTROL ).                "copy only %control=mk-on fields
derived = CORRESPONDING #( plain CHANGING CONTROL ).             "derive %control from filled fields

"ABAP SQL directly with derived types:
INSERT zdemo_abap_rapt1 FROM @create_row MAPPING FROM ENTITY.
UPDATE zdemo_abap_rapt1 FROM @create_row
  INDICATORS SET STRUCTURE %control MAPPING FROM ENTITY.         "update only marked fields
```

`MAPPING FROM ENTITY` also works on `MODIFY` and `DELETE`. Details and the `mapping for ... control` variant: [references/derived-types.md](references/derived-types.md).

## EML in ABAP Unit

Do not let tests hit real BOs. Two SAP test-double frameworks:

- `cl_botd_txbufdbl_bo_test_env` — replaces the transactional buffer with a double; your EML statements run for real against fake data.
- `cl_botd_mockemlapi_bo_test_env` — mocks the EML API itself; you script inputs/outputs per statement.
- `CREATE OBJECT ... FOR TESTING` instantiates RAP handler classes directly for unit-testing handler methods.

Setup patterns, `cl_cds_test_environment`, and assertion style: [abap-unit-tdd](../abap-unit-tdd/SKILL.md). A consumer-side EML flow you can adapt into a test is in [examples/eml_consumer_flow.abap](examples/eml_consumer_flow.abap).

## Quick Reference

| Task | Statement |
|---|---|
| Create instances | `MODIFY ENTITY bo CREATE FIELDS ( ... ) WITH lt_itab MAPPED m FAILED f REPORTED r.` |
| Create w/o caring about %cid | `... CREATE AUTO FILL CID FIELDS ( ... ) WITH ...` (no `%cid_ref` possible afterwards) |
| Create draft instance | row with `%is_draft = if_abap_behv=>mk-on` |
| Deep create | `CREATE ... WITH ... CREATE BY \_assoc FIELDS ( ... ) WITH` rows of `%cid_ref` + `%target` |
| Update | `MODIFY ENTITY bo UPDATE FIELDS ( ... ) WITH lt_itab FAILED f REPORTED r.` (identify via `%tky` or `%cid_ref`) |
| Delete | `MODIFY ENTITY bo DELETE FROM lt_itab ...` (keys or `%cid_ref` only) |
| Execute action | `MODIFY ENTITY bo EXECUTE act FROM lt_itab [RESULT res] ...` |
| Read | `READ ENTITY bo ALL FIELDS WITH lt_itab RESULT res FAILED f REPORTED r.` |
| Read via association | `READ ENTITIES OF root ENTITY e BY \_assoc ALL FIELDS WITH lt_itab RESULT res [LINK lnk].` |
| Persist | `COMMIT ENTITIES [RESPONSE OF root FAILED f REPORTED r].` then check `sy-subrc` (0/4/8) |
| Dry-run consistency check | `COMMIT ENTITIES IN SIMULATION MODE.` |
| Discard | `ROLLBACK ENTITIES.` |
| Check what's allowed | `GET PERMISSIONS [ONLY GLOBAL] ENTITY bo REQUEST req RESULT res ...` |
| Lock explicitly | `SET LOCKS ENTITY bo FROM key_tab FAILED f.` |
| BO's own access in ABP | `MODIFY/READ ... IN LOCAL MODE ...` |
| Derived type ↔ DB table | `CORRESPONDING #( ... MAPPING FROM ENTITY )`, `INSERT dbtab FROM @row MAPPING FROM ENTITY` |

## Common Mistakes

| Wrong | Right |
|---|---|
| `MODIFY ... CREATE FROM VALUE #( ( key_field = 1 field1 = 'A' ) )` — no `%control` filled, values silently ignored | With `FROM`, set `%control` per field; or use `CREATE FIELDS ( key_field field1 ) WITH ...` which fills `%control` for you |
| Omitting `%cid` on CREATE rows ("I don't need it") | Always fill `%cid` (unique per request) or use `AUTO FILL CID` — a missing content ID is a contract violation |
| Identifying instances with `%key` everywhere | Use `%tky` — it includes `%is_draft` and `%pid`, so enabling draft/late numbering later doesn't break every statement |
| `wa-%tky = wa-%key.` or copying `%tky` across different entities | Assign like to like; when types differ use `%tky = CORRESPONDING #( other-%tky )` |
| `MODIFY` then assuming data is on the database | Nothing persists before `COMMIT ENTITIES` — MODIFY only changes the transactional buffer |
| `COMMIT ENTITIES.` without checking anything | Check `sy-subrc` (4 = early save failed, 8 = late save failed) and use `RESPONSE OF ... FAILED ... REPORTED ...`; after a failure, `ROLLBACK ENTITIES` before continuing |
| `COMMIT WORK` inside RAP consumer code "because it's the same" | Only equivalent on success; on save-sequence errors `COMMIT WORK` dumps while `COMMIT ENTITIES` lets you react. Never commit inside behavior implementations |
| Expecting an update to fail loudly when the instance doesn't exist | Failures land in `failed` with `%fail-cause` (`not_found`, `locked`, `unspecific`, `dependency`) — evaluate it |
| Reading with `FIELDS ( field1 )` and wondering why `field2` is initial | Unlisted fields have `%control = mk-off` and are not returned; list them or use `ALL FIELDS WITH` |
| Handler code modifying its own BO without `IN LOCAL MODE` | Use `IN LOCAL MODE` for the BO's own reads/writes — otherwise read-only field controls and auth checks block legitimate internal changes |
| `INSERT dbtab FROM TABLE @derived_rows.` in a saver class | Derived types carry `%` components and entity names; convert with `CORRESPONDING ... MAPPING FROM ENTITY` or use `INSERT ... MAPPING FROM ENTITY` |
| Looking for a `%result` component to read an action result | It doesn't exist — declare `RESULT DATA(lt_res)` after `EXECUTE`; rows contain keys + `%param` |

## References

- [references/derived-types.md](references/derived-types.md) — full BDEF derived type + `%` component + constants catalog
- [references/eml-statement-catalog.md](references/eml-statement-catalog.md) — every EML statement with all forms and phase rules
- [examples/eml_consumer_flow.abap](examples/eml_consumer_flow.abap) — consumer-side EML lifecycle (create → read → action → commit → rollback)
- [examples/eml_in_behavior_pool.abap](examples/eml_in_behavior_pool.abap) — EML inside handler methods (IN LOCAL MODE, failed/reported, action result)
- **ABAP Keyword Documentation — EML:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abeneml.htm
- **BDEF derived types overview:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenrpm_derived_types.htm
- **Components of BDEF derived types:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapderived_types_comp.htm
- **MODIFY ENTITIES:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapmodify_entity_entities.htm
- **COMMIT ENTITIES:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapcommit_entities.htm
- **EML additions in behavior pools:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abeneml_in_abp.htm
- **SAP-samples/abap-cheat-sheets — 08 EML (ABAP for RAP):** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/08_EML_ABAP_for_RAP.md
- **RAP Development Guide:** https://help.sap.com/docs/abap-cloud/abap-rap/
- Linked skills: [rap-bo-modeling](../rap-bo-modeling/SKILL.md), [rap-business-events-side-effects](../rap-business-events-side-effects/SKILL.md), [abap-sap-luw](../abap-sap-luw/SKILL.md), [abap-unit-tdd](../abap-unit-tdd/SKILL.md)
