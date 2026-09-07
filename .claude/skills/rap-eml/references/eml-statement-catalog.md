# EML Statement Catalog

Every EML statement with its short, long, and dynamic forms, plus the additions that exist only in behavior pools and the phase rules of a RAP transaction. Grounded in SAP's ABAP cheat sheet "ABAP for RAP: Entity Manipulation Language" and its executable examples. Derived-type details: [derived-types.md](derived-types.md).

## MODIFY — create, update, delete, execute

Modifying operations must be enabled in the BDEF (`create; update; delete; action ...;`). Read is the only operation that is always implicitly enabled.

### Short form — one entity

```abap
MODIFY ENTITY zdemo_abap_rap_ro_m
  CREATE FIELDS ( key_field field1 field2 ) WITH lt_create_tab
  MAPPED   lt_mapped_response
  FAILED   lt_failed_response
  REPORTED lt_reported_response.
```

### Long form — several operations, several entities of one BO

```abap
MODIFY ENTITIES OF zdemo_abap_rap_ro_m    "root entity name (= BDEF name)
  ENTITY root                             "entity (alias if defined)
    CREATE FIELDS ( key_field field1 field2 )
    WITH VALUE #( ( %cid = 'cid4' key_field = 4 field1 = 'G' field2 = 'H' )
                  ( %cid = 'cid5' key_field = 5 field1 = 'I' field2 = 'J' ) )
    UPDATE FIELDS ( field2 )
    WITH VALUE #( ( %cid_ref = 'cid4' field2 = 'Z' ) )
    DELETE FROM
    VALUE #( ( %cid_ref = 'cid5' )   "reference via content id
             ( key_field = 9 ) )     "reference via key
  MAPPED   DATA(lt_mapped_response)
  FAILED   DATA(lt_failed_response)
  REPORTED DATA(lt_reported_response).
```

### Field selection variants

| Variant | %control handling | Notes |
|---|---|---|
| `FIELDS ( f1 f2 ) WITH itab` | Listed fields → `mk-on`, others → `mk-off` automatically | Recommended default; unlisted field values are ignored |
| `FROM itab` | You must fill `%control` explicitly | Needed when different rows respect different fields |
| `CREATE AUTO FILL CID ...` | n/a (`%cid` auto-generated) | No later `%cid_ref` reference possible |
| `SET FIELDS WITH itab` | implicit | Has limitations and causes syntax warnings — prefer the two above |
| `DELETE FROM itab` | n/a | DELETE supports only `FROM`; rows contain only key / `%cid_ref` |

Short form of `VALUE` constructors for `%control`: assign `%control-field = mk-on` once, *outside* the row parentheses, to apply it to all following rows.

### Create by association (deep create)

```abap
MODIFY ENTITIES OF zdemo_abap_rap_ro_m
  ENTITY root
    CREATE FIELDS ( key_field field1 field2 ) WITH
      VALUE #( ( %cid = 'cid_parent' key_field = 9 field1 = 'q' field2 = 'r' ) )
    CREATE BY \_child
    FIELDS ( key_ch field_ch1 field_ch2 ) WITH
      VALUE #( ( %cid_ref = 'cid_parent'
                 %target  = VALUE #( ( %cid = 'cid_ch1' key_ch = 9  field_ch1 = 'a' field_ch2 = 99 )
                                     ( %cid = 'cid_ch2' key_ch = 10 field_ch1 = 'b' field_ch2 = 100 ) ) ) )
  MAPPED   DATA(lt_mapped_response)
  FAILED   DATA(lt_failed_response)
  REPORTED DATA(lt_reported_response).
```

`%cid_ref` may also be replaced by the parent's key when the parent already exists.

### Executing actions

```abap
MODIFY ENTITIES OF zdemo_abap_rap_ro_m
  ENTITY root
    EXECUTE multiply_by_2 FROM VALUE #( ( %cid_ref = 'cid_x2' )   "just-created instance
                                        ( key_field = 1 ) )       "existing instance
  MAPPED   DATA(lt_mapped_response)
  FAILED   DATA(lt_failed_response)
  REPORTED DATA(lt_reported_response).
```

- Parameterized action: input rows carry keys plus `%param`.
- Action with declared result: add `RESULT DATA(lt_action_result)` directly after the `EXECUTE ... FROM ...` clause; result rows carry keys plus `%param`.

### Dynamic form — several BOs in one statement

```abap
DATA lt_operations TYPE abp_behv_changes_tab.

lt_operations = VALUE #(
  ( op          = if_abap_behv=>op-m-create
    entity_name = 'ZDEMO_ABAP_RAP_RO_M'
    instances   = REF #( create_root_tab ) )
  ( op          = if_abap_behv=>op-m-create_ba
    entity_name = 'ZDEMO_ABAP_RAP_RO_M'
    sub_name    = '_CHILD'                       "association name, capital letters
    instances   = REF #( create_by_assoc_tab ) )
  ( op          = if_abap_behv=>op-m-update
    entity_name = 'ZDEMO_ABAP_RAP_CH_M'
    instances   = REF #( update_child_tab ) ) ).

MODIFY ENTITIES OPERATIONS lt_operations
  MAPPED   DATA(lt_mapped_response)
  FAILED   DATA(lt_failed_response)
  REPORTED DATA(lt_reported_response).
```

## READ

- `RESULT` is mandatory; reads return buffer state including unsaved changes; instances not yet buffered are loaded from the database (managed).
- Field selection: `FIELDS ( ... ) WITH`, `FROM` (explicit `%control`), or `ALL FIELDS WITH`.

```abap
"Long form, root entity
READ ENTITIES OF zdemo_abap_rap_ro_m
  ENTITY root
  ALL FIELDS WITH VALUE #( ( key_field = 1 ) ( key_field = 2 ) )
  RESULT   DATA(lt_instances)
  FAILED   DATA(lt_failed_read)
  REPORTED DATA(lt_reported_read).

"Read by association, parent → child, with key-pair links
READ ENTITIES OF zdemo_abap_rap_ro_m
  ENTITY root
  BY \_child
  ALL FIELDS WITH VALUE #( ( key_field = 1 ) )
  RESULT DATA(lt_children)
  LINK   DATA(lt_links).

"Child → parent works the same way via \_parent
```

### Dynamic READ

```abap
DATA lt_retrievals TYPE abp_behv_retrievals_tab.

lt_retrievals = VALUE #(
  ( op          = if_abap_behv=>op-r-read
    entity_name = 'ZDEMO_ABAP_RAP_RO_M'
    instances   = REF #( read_import_tab )      "TYPE TABLE FOR READ IMPORT
    results     = REF #( read_result_tab ) )    "TYPE TABLE FOR READ RESULT
  ( op          = if_abap_behv=>op-r-read_ba
    entity_name = 'ZDEMO_ABAP_RAP_RO_M'
    sub_name    = '_CHILD'
    full        = abap_true                     "retrieve all target instances
    instances   = REF #( rba_import_tab )
    results     = REF #( rba_result_tab )
    links       = REF #( rba_link_tab ) ) ).    "TYPE TABLE FOR READ LINK

READ ENTITIES OPERATIONS lt_retrievals.
```

### READ ... WITH CHANGES (change information)

- Returns accumulated change info for the current RAP transaction in component `%chg` (`if_abap_behv=>cop-create`, `cop-update`, `cop-recreate`, `cop-delete`). `%control` in the result marks changed fields only for `cop-create` / `cop-update` / `cop-recreate` — not for deletions.
- Restrictions: managed BOs only; implementation classes only; requires `IN LOCAL MODE`; not for read-by-association or functions.
- Result type: `TYPE TABLE FOR READ CHANGES`. Dynamic form: set `full = if_abap_behv=>typekind-result_chg` instead of `WITH CHANGES`.

```abap
READ ENTITY IN LOCAL MODE demo_rap_entity
  WITH CHANGES
  ALL FIELDS WITH CORRESPONDING #( keys )
  RESULT lt_read_changes
  FAILED failed.
```

## COMMIT ENTITIES

Triggers the RAP save sequence (early save phase → late save phase); implicitly includes `COMMIT WORK`. Forbidden inside behavior implementations. In natively supported scenarios (OData/Fiori) the RAP runtime engine commits automatically.

| Variant | Syntax | Notes |
|---|---|---|
| Short | `COMMIT ENTITIES.` | Always check `sy-subrc` afterwards |
| Short + responses | `COMMIT ENTITIES RESPONSES FAILED f REPORTED r.` | `f`/`r` of type `abp_behv_response_tab` |
| Long | `COMMIT ENTITIES RESPONSE OF root1 FAILED DATA(lt_failed_1) REPORTED DATA(lt_reported_1) RESPONSE OF root2 FAILED DATA(lt_failed_2) REPORTED DATA(lt_reported_2).` | Per-BO derived-type responses; root entities only |
| Dynamic | `COMMIT ENTITIES RESPONSES OF name_tab FAILED f REPORTED r.` | `name_tab` of type `abp_entity_name_tab` |
| Commit scope | `COMMIT ENTITIES BEGIN. ... CONVERT KEY OF bo FROM ... TO ... COMMIT ENTITIES END.` | Late numbering: convert preliminary to final keys |
| Simulation | `COMMIT ENTITIES IN SIMULATION MODE.` | Runs only the early save phase; no `COMMIT WORK`; nothing persisted — consistency dry run. Clear the buffer afterwards with `ROLLBACK ENTITIES` if needed |

### sy-subrc after COMMIT ENTITIES

| Value | Meaning | You can... |
|---|---|---|
| 0 | Save sequence succeeded, database commit done | Continue |
| 4 | Failure in the **early** save phase (`finalize` / `check_before_save`) | Return to the interaction phase, fix data, retry |
| 8 | Failure in the **late** save phase (saver class based on `cl_abap_behavior_saver_failed`, e.g. BAPI call failed) | Continue only after an explicit `ROLLBACK ENTITIES`; otherwise the next RAP operation may dump |

### COMMIT ENTITIES vs COMMIT WORK in RAP

- `COMMIT WORK` also triggers the save sequence; on success the effect is identical.
- On errors in the save sequence, `COMMIT WORK` always ends in a runtime error, while `COMMIT ENTITIES` (early-save errors) returns control to you.
- Only `COMMIT ENTITIES` offers responses, key conversion, and simulation mode.
- `COMMIT ENTITIES` enforces a local (or synchronous) update — never asynchronous.
- `ROLLBACK ENTITIES` and `ROLLBACK WORK` are interchangeable in RAP (the former implicitly triggers the latter).

## ROLLBACK ENTITIES

```abap
ROLLBACK ENTITIES.
```

Rolls back all changes of the current RAP transaction: clears the transactional buffer (calls the `cleanup` saver method — self-implemented in unmanaged scenarios) and releases locks. Required after a late-save failure (`sy-subrc = 8`) before continuing.

## GET PERMISSIONS

Retrieves global/instance authorization and global/instance/static feature-control information.

```abap
DATA ls_permission_request TYPE STRUCTURE FOR PERMISSIONS REQUEST zdemo_abap_rap_ro_m.

ls_permission_request = VALUE #(
  %create          = if_abap_behv=>mk-on
  %update          = if_abap_behv=>mk-on
  %delete          = if_abap_behv=>mk-on
  %field-key_field = if_abap_behv=>mk-on
  %field-field1    = if_abap_behv=>mk-on ).

GET PERMISSIONS ONLY GLOBAL ENTITY zdemo_abap_rap_ro_m
  REQUEST ls_permission_request
  RESULT   DATA(ls_permission_result)
  FAILED   DATA(lt_failed_permissions)
  REPORTED DATA(lt_reported_permissions).
```

- `REQUEST` takes a *structure*, not a table.
- `ONLY GLOBAL` limits the result to global authorization plus global and static feature control; further only-clauses and instance variants exist (see ABAPGET_PERMISSIONS in the keyword documentation).
- Results carry `perm-o` / `perm-f` / `auth` constant values per operation/field.

## SET LOCKS

Exclusively locks RAP BO instances (enqueue) ahead of modification; the lock lasts until the RAP transaction ends.

```abap
DATA lt_lock_keys TYPE TABLE FOR KEY OF zdemo_abap_rap_ro_u.
lt_lock_keys = VALUE #( ( key_field = 1 ) ( key_field = 2 ) ).

"Short form — one entity
SET LOCKS ENTITY zdemo_abap_rap_ro_u
  FROM lt_lock_keys
  FAILED DATA(lt_failed_locks).

"Long form — multiple entities of one composition tree
SET LOCKS OF zdemo_abap_rap_ro_u
  ENTITY root  FROM VALUE #( ( key_field = 1 ) )
  ENTITY child FROM VALUE #( ( key_field = 2 ) )
  FAILED   DATA(lt_failed_tree_locks)
  REPORTED DATA(lt_reported_tree_locks).

"Dynamic form — multiple BOs
DATA(lt_lock_requests) = VALUE abp_behv_locks_tab(
  ( entity_name = 'ZDEMO_ABAP_RAP_RO_U' instances = REF #( root_keys ) )
  ( entity_name = 'ZDEMO_ABAP_RAP_CH_U' instances = REF #( child_keys ) ) ).

SET LOCKS lt_lock_requests
  FAILED   DATA(lt_failed_dynamic_locks)
  REPORTED DATA(lt_reported_dynamic_locks).
```

Instances already locked by another user appear in `FAILED` with `%fail-cause = if_abap_behv=>cause-locked`.

## Additions available only in behavior pools

### IN LOCAL MODE

`MODIFY ... IN LOCAL MODE` / `READ ... IN LOCAL MODE` suppress feature controls, authorization checks, and prechecks. Canonical use: a field is `readonly` for consumers, but an action inside the BO must change it.

```abap
MODIFY ENTITIES OF zdemo_abap_rap_ro_m IN LOCAL MODE
  ENTITY root
  EXECUTE book FROM action_keys
  ...
```

ABP auxiliary classes (declared `FOR BEHAVIOR OF bdef`, listed in the BDEF via `auxiliary class ...`) may also use `IN LOCAL MODE` and the `PRIVILEGED` addition (EML without the standard authorization checks).

### MODIFY AUGMENTING (projection layer only)

Enriches/modifies requests arriving at a RAP projection BO before they reach the transactional buffer. Usable only in RAP BO providers; supports all standard operations and actions; **no response parameters**.

```abap
MODIFY AUGMENTING ENTITY some_bdef
  UPDATE FROM ...

"If augmentation adds instances not present in the original request,
"relate them for response routing (abp_behv_relating_tab):
MODIFY AUGMENTING ENTITY some_bdef
  UPDATE FROM ... RELATING TO original_instances BY relates_tab.
```

### RAISE ENTITY EVENT

Raises a RAP business event from a behavior pool, recommended in the `save`/`save_modified` saver methods. Covered in [rap-business-events-side-effects](../../rap-business-events-side-effects/SKILL.md) — not duplicated here.

## Allowed / forbidden per RAP transaction phase

Condensed from the RAP BO contract (strict mode turns violations into checks/runtime errors):

| Operation | Interaction phase | Early save | Late save |
|---|---|---|---|
| DB commit via secondary connection | yes | yes | yes |
| DB commit via standard connection (e.g. `WAIT`, external service call) | yes | yes | no |
| sRFC / aRFC | yes | yes | no |
| Database modifications | no | no | **yes — only here** |
| `CALL FUNCTION ... IN UPDATE TASK` | no | no | yes |
| bgRFC (`IN BACKGROUND UNIT`) | no | no | yes |
| `PERFORM ON COMMIT/ROLLBACK` | (avoid) | (avoid) | yes (signals poor RAP integration) |
| `COMMIT WORK` / `ROLLBACK WORK` | only as transaction owner (`cl_abap_tx`); never where RAP owns the transaction | same | same |
| Dynpro processing (`CALL SCREEN`, `MESSAGE` w/o `INTO`, `WRITE`, ...) | no | no | no |
| `CALL TRANSACTION` / `LEAVE TRANSACTION` | no | no | no |
| `RAISE EXCEPTION` out of the transaction | no | no | no |
| `SUBMIT` | no | no | no |
| `RAISE ENTITY EVENT` | no | no | yes |

`COMMIT ENTITIES` / `ROLLBACK ENTITIES` themselves are consumer-side statements — never inside behavior implementations.

## RAP-related system classes

| Class / feature | Purpose |
|---|---|
| `cl_abap_behavior_handler` | Base class of local handler classes (`lhc_*`) |
| `cl_abap_behavior_saver` | Base class of local saver classes (`lsc_*`) |
| `cl_abap_behavior_saver_failed` | Saver base class when late-save failures cannot be ruled out (enables extra response parameters; `sy-subrc = 8` on the consumer side) |
| `cl_abap_behavior_event_handler` | Base class for local consumption of RAP business events |
| `cl_botd_txbufdbl_bo_test_env` | ABAP Unit: transactional buffer test doubles |
| `cl_botd_mockemlapi_bo_test_env` | ABAP Unit: mock the EML API |
| `CREATE OBJECT ... FOR TESTING` | Instantiate RAP handler classes in unit tests |
| `cl_abap_tx` | Set transactional phases explicitly (controlled SAP LUW) |
| `cl_abap_behv_aux` | `get_current_phase`, `get_current_context` (in_local_mode, draft_activate, privileged, ...), `get_current_handler_kind` |
| `cl_abap_tabledescr=>get_bdef_derived_type` / `cl_abap_structdescr=>get_bdef_derived_type` | RTTI: create BDEF derived types dynamically |
