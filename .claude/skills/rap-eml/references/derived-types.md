# BDEF Derived Types — Full Catalog

Deep-dive reference for the ABAP types derived from a CDS entity + its behavior definition (BDEF). These types are the operands of every EML statement and the parameters of every RAP handler/saver method. Source: SAP's ABAP cheat sheet "ABAP for RAP: Entity Manipulation Language" and the ABAP Keyword Documentation.

## Why they exist

Communication between RAP BO consumer and provider happens through "messenger tables" — internal tables whose types the ABAP runtime framework derives from the CDS entities and the BDEF. That guarantees type-safe access: you can only derive types for what the BDEF enables (no `create;` → no `TYPE TABLE FOR CREATE`).

Explore them in ADT: put the cursor on a handler method parameter or a declared variable and press F2.

## Declaration forms

| Syntax | Purpose |
|---|---|
| `TYPE TABLE FOR ...` | Internal tables — most EML operands and handler parameters |
| `TYPE STRUCTURE FOR ...` | Work areas / single rows; also some request/result parameters (e.g. permissions request) |
| `TYPE RESPONSE FOR ...` | The response containers `mapped`, `failed`, `reported` — deep structures with one `TYPE TABLE FOR ...` component per entity of the BO |
| `TYPE REQUEST FOR ...` | `REQUEST FOR CHANGE` / `REQUEST FOR DELETE` — importing parameters of `save_modified` in additional/unmanaged save; deep structures with instance keys/data per operation |

### Entity naming — short form, long form, associations

```abap
"Short form: name an entity of the composition tree directly
DATA lt_create_root  TYPE TABLE FOR CREATE zdemo_abap_rap_ro_m.    "root entity
DATA lt_update_child TYPE TABLE FOR UPDATE zdemo_abap_rap_ch_m.    "child entity

"Long form: root entity name + \\ + entity (alias if one is defined in the BDEF)
DATA lt_create_root_long  TYPE TABLE FOR CREATE zdemo_abap_rap_ro_m\\root.
DATA lt_update_child_long TYPE TABLE FOR UPDATE zdemo_abap_rap_ro_m\\child.

"Associations declared in the BDEF, prefixed \ (short and long form)
DATA lt_create_by_assoc      TYPE TABLE FOR CREATE zdemo_abap_rap_ro_m\_child.
DATA lt_create_by_assoc_long TYPE TABLE FOR CREATE zdemo_abap_rap_ro_m\\root\_child.
DATA lt_read_parent_import   TYPE TABLE FOR READ IMPORT zdemo_abap_rap_ch_m\_parent.
```

If the BDEF defines an alias for an entity, the long form must use the alias — the raw entity
name is not accepted there.

### Tabular types by operation

```abap
"Modify operations
DATA lt_create_tab TYPE TABLE FOR CREATE zdemo_abap_rap_ro_m.
DATA lt_update_tab TYPE TABLE FOR UPDATE zdemo_abap_rap_ro_m.
DATA lt_delete_tab TYPE TABLE FOR DELETE zdemo_abap_rap_ro_m.
DATA lt_cba_tab    TYPE TABLE FOR CREATE zdemo_abap_rap_ro_m\_child.   "create by association

"Actions (name after ~; RESULT type exists only if the BDEF action declares a result)
DATA lt_action_import TYPE TABLE FOR ACTION IMPORT zdemo_abap_rap_ro_m~multiply_by_2.
"DATA lt_action_result TYPE TABLE FOR ACTION RESULT zdemo_abap_rap_ro_m~some_action.

"Read operations
DATA lt_read_import TYPE TABLE FOR READ IMPORT zdemo_abap_rap_ro_m.
DATA lt_read_result TYPE TABLE FOR READ RESULT zdemo_abap_rap_ro_m.
DATA lt_rba_import  TYPE TABLE FOR READ IMPORT zdemo_abap_rap_ro_m\_child.
DATA lt_rba_result  TYPE TABLE FOR READ RESULT zdemo_abap_rap_ro_m\_child.
DATA lt_rba_link    TYPE TABLE FOR READ LINK zdemo_abap_rap_ro_m\_child.

"Locks
DATA lt_lock_keys TYPE TABLE FOR KEY OF zdemo_abap_rap_ro_m.

"Events (event handler method parameter; includes keys + %param if parameterized)
"TYPE TABLE FOR EVENT bdef~event_name

"Change info (managed BOs, only inside implementation classes, with WITH CHANGES)
"DATA lt_read_changes TYPE TABLE FOR READ CHANGES demo_rap_entity.
```

### Structured types

```abap
DATA ls_create_row TYPE STRUCTURE FOR CREATE zdemo_abap_rap_ro_m.
DATA ls_update_row TYPE STRUCTURE FOR UPDATE zdemo_abap_rap_ro_m.
TYPES ty_delete_row TYPE STRUCTURE FOR DELETE zdemo_abap_rap_ro_m.

"Permissions
DATA ls_permission_request TYPE STRUCTURE FOR PERMISSIONS REQUEST zdemo_abap_rap_ro_m.
```

### Response types (mapped / failed / reported)

`EARLY` (or nothing) refers to the interaction phase; `LATE` to the save phase (e.g. `adjust_numbers` in late numbering).

```abap
DATA lt_mapped_resp   TYPE RESPONSE FOR MAPPED zdemo_abap_rap_ro_m.
DATA lt_failed_resp   TYPE RESPONSE FOR FAILED zdemo_abap_rap_ro_m.
DATA lt_reported_resp TYPE RESPONSE FOR REPORTED zdemo_abap_rap_ro_m.
DATA lt_reported_resp_early TYPE RESPONSE FOR REPORTED EARLY zdemo_abap_rap_ro_m.  "same as above

DATA lt_mapped_late   TYPE RESPONSE FOR MAPPED LATE zdemo_abap_rap_ro_m.
DATA lt_failed_late   TYPE RESPONSE FOR FAILED LATE zdemo_abap_rap_ro_m.
DATA lt_reported_late TYPE RESPONSE FOR REPORTED LATE zdemo_abap_rap_ro_m.

"The RESPONSE FOR types are deep structures containing tables of these types:
DATA lt_mapped_tab TYPE TABLE FOR MAPPED zdemo_abap_rap_ro_m.        "also ... MAPPED EARLY / LATE
```

### Types restricted to implementation classes (behavior pools)

These can only be declared and used inside implementation classes:

- `TYPE ... FOR CHANGE`
- `TYPE TABLE FOR DETERMINATION bdef~det_name`
- `TYPE TABLE FOR VALIDATION bdef~val_name`
- `TYPE ... FOR ... FEATURES` (e.g. `STRUCTURE FOR GLOBAL FEATURES RESULT`)
- `TYPE ... FOR ... AUTHORIZATION`
- `TYPE REQUEST FOR CHANGE bdef` / `TYPE REQUEST FOR DELETE bdef` (importing parameters of `save_modified`)
- `TYPE TABLE FOR READ CHANGES` (with `READ ... WITH CHANGES`, managed BOs only)

### Typing your own method parameters

```abap
TYPES tt_create_tab_type TYPE TABLE FOR CREATE zdemo_abap_rap_ro_m.
METHODS process_new_instances IMPORTING it_new_instances TYPE tt_create_tab_type.
```

## The % components — complete catalog

All BDEF derived types combine the entity's own key/data fields (original types) with special components prefixed `%` (avoids name clashes). Some `%` components are *component groups* — named bundles of other columns. Availability depends on the BDEF: `%pid` only in late numbering, `%is_draft` only with draft, action components only for declared actions.

### Identity components

| Component | Type | Meaning |
|---|---|---|
| `%cid` | `ABP_BEHV_CID` (string) | Content ID: unique, preliminary, request-local identifier for created instances. Fill it on every CREATE row even if unused, or use `AUTO FILL CID` (then no later `%cid_ref` reference is possible). Valid only within one EML request in the interaction phase. |
| `%cid_ref` | like `%cid` | Refers to a `%cid` of the same request — how UPDATE/DELETE/EXECUTE/CREATE BY rows target an instance whose key does not exist yet. |
| `%key` | component group | All primary key fields. In late numbering, holds the *preliminary* keys during the interaction phase. |
| `%is_draft` | `ABP_BEHV_FLAG` | Draft indicator: `mk-on` = draft instance, `mk-off` = active instance. Contained in `%tky`. |
| `%pid` | `ABP_BEHV_PID` | Preliminary ID, late numbering scenarios only. |
| `%pky` | component group | `%pid` + `%key` in late numbering; just `%key` otherwise. Contained in `%tky`. Some contexts (certain actions) offer `%pky` but not `%tky`. |
| `%tky` | component group | Transactional key: `%pky` + `%is_draft`, i.e. `%key` + `%is_draft` (+ `%pid`). The recommended identifier everywhere — in non-draft/non-late-numbering scenarios the extra components are simply blank, so code survives a later scenario switch. |
| `%pre` | component group | Late save phase (`adjust_numbers`): all preliminary identifiers = `%pid` + `%tmp`. |
| `%tmp` | component group | Late save phase: takes over the preliminary key values that `%key` held during the interaction phase (in `adjust_numbers`, `%key` is reused for the final keys in `mapped`). |

### Data and field-selection components

| Component | Meaning |
|---|---|
| `%data` | Component group: all primary key and data fields (contains `%key`). |
| `%control` | Structure with one `ABP_BEHV_FLAG` flag per key/data field. Consumers mark which fields the request should respect; providers mark which fields are returned/requested. `FIELDS ( ... ) WITH` fills it automatically; `FROM` requires explicit values. A field with `mk-off` is ignored on write and returned initial on read. Fields set back to an initial value (e.g. `abap_false`) need `mk-on` too — an unflagged value is ignored, so the change never lands and field-triggered determinations do not fire. |
| `%element` | Structure with one flag per field, used in `reported` rows to mark which fields a message relates to (`%element-fieldname = if_abap_behv=>mk-on` — a UI can highlight those inputs). |
| `%target` | In create-by-association rows: internal table of target (child) instances — each row with its own `%cid` plus the target's key and data fields. |
| `%param` | Parameter data: input rows of parameterized actions/functions, the per-instance payload in action **result** rows (RESULT table rows = instance keys + `%param`), and event payloads (`TYPE TABLE FOR EVENT` includes `%param` if the BDEF event has a parameter). |

There is **no `%result` component**. `RESULT` is a statement addition (READ, EXECUTE, GET PERMISSIONS); action results are transported as rows of keys + `%param`.

### Response components

| Component | Meaning |
|---|---|
| `%msg` | Message object in `reported` rows; create with `new_message( id = ... number = ... severity = ... )` (T100 message) or `new_message_with_text( ... )`. Readable via `if_t100_dyn_msg` / `m_severity`. |
| `%fail` | Failure info in `failed` rows, notably `%fail-cause` with `if_abap_behv=>cause-*` values (see constants below). |
| `%op` | Component group in `failed` rows identifying which operation failed: `%op-%create`, `%op-%update`, `%op-%delete`, `%op-%assoc-_child`, `%op-%action-multiply_by_2`, ... |
| `%action` | One flag per action — set in `failed` rows to mark the failing action; also appears in feature-control and permission results (e.g. `%features-%action-my_action`, `result-%action-Edit`). |
| `%assoc` | One flag per association — create-by-association enablement in control/feature/permission contexts and inside `%op`. |
| `%global` | In `reported`: `%global = if_abap_behv=>mk-on` marks a message as belonging to the entity as a whole, not to one instance (no instance key filled). |

### Permission / feature-control components

| Component | Meaning |
|---|---|
| `%create`, `%update`, `%delete` | Operation flags in a `PERMISSIONS REQUEST` structure (`mk-on` = "tell me about this operation") and operation-permission values in results (`perm-o` constants). |
| `%field` | One entry per field in permission requests/results — e.g. request `%field-field1 = mk-on`, result carries `perm-f` values such as read-only or mandatory. |
| `%features` | Feature-control result values (`fc-f` / `fc-o` constants), e.g. `%features-%action-my_action = if_abap_behv=>fc-o-disabled`. |

### Accessing grouped components — one value, many paths

Component groups nest (`%data` contains `%key`; `%tky` contains `%pky` contains `%key`), so the same key field is reachable through several paths. In `VALUE #( ... )` constructors, make sure each component gets **at most one** assignment:

```abap
DATA lt_update_tab TYPE TABLE FOR UPDATE zdemo_abap_rap_ro_m.
lt_update_tab = VALUE #( ( key_field = 1 ) ).

DATA(lv_direct_access)  = lt_update_tab[ 1 ]-key_field.
DATA(lv_via_key)        = lt_update_tab[ 1 ]-%key-key_field.
DATA(lv_via_tky)        = lt_update_tab[ 1 ]-%tky-key_field.
DATA(lv_via_tky_pky)    = lt_update_tab[ 1 ]-%tky-%pky-%key-key_field.
DATA(lv_via_data)       = lt_update_tab[ 1 ]-%data-key_field.
```

### Assigning key component groups safely

- Refer to whole keys via a component group (prefer `%tky`), not by listing individual key fields — and never assign a group *and* one of its contained keys in the same row.
- Type compatibility is **not** guaranteed when mixing groups (`row-%tky = row-%key`), when copying the same group across *different* entities (`root_row-%tky = child_row-%tky`), or when assigning self-built structures to key groups. Use `CORRESPONDING` there:

```abap
failed_row-%tky = CORRESPONDING #( source_row-%tky ).
```

- Between data objects of the *same* group of the *same* entity, direct assignment is correct and faster than `CORRESPONDING` (typical when filling `failed`/`reported` rows from a read result).

## Constants — interface IF_ABAP_BEHV

| Component type | Constant group | Used for |
|---|---|---|
| `ABP_BEHV_FLAG` | `if_abap_behv=>mk` (`mk-on` = `01`, `mk-off` = `00`) | Marking fields in modify/read requests: `%control`, `%element`, permission requests |
| `ABP_BEHV_FIELD_PERM` | `if_abap_behv=>perm-f` | Field permission results (mandatory, read-only, ...) |
| `ABP_BEHV_OP_PERM` | `if_abap_behv=>perm-o` | Operation permission results (operation enabled/disabled) |
| `ABP_BEHV_FIELD_CTRL` | `if_abap_behv=>fc-f` | Field feature-control results |
| `ABP_BEHV_OP_CTRL` | `if_abap_behv=>fc-o` | Operation feature-control results (e.g. `fc-o-disabled`) |
| `ABP_BEHV_AUTH` | `if_abap_behv=>auth` | Authorization results |
| `IF_ABAP_BEHV=>T_CHAR01` | `if_abap_behv=>op` | Dynamic EML: `op-m-create`, `op-m-update`, `op-m-delete`, `op-m-create_ba`, `op-r-read`, `op-r-read_ba` |
| `IF_ABAP_BEHV=>T_CHAR01` | `if_abap_behv=>cop` | Accumulated change info (`cop-create`, `cop-update`, `cop-recreate`, ...) with `READ ... WITH CHANGES` / draft additional save |

Failure causes for `%fail-cause` (values of `if_abap_behv=>cause-*`): `unspecific`, `not_found`, `locked`, `unauthorized`, `disabled`, `readonly`, `dependency`, `conflict`. Inspect `IF_ABAP_BEHV=>CAUSE` with F2 in ADT for the exact set on your release.

The constant groups for permissions/feature control are technically identical types; use the group that matches the context so the intent stays readable.

## Secondary table keys of derived-type tables

Internal tables typed `TYPE TABLE FOR ...` are standard tables with an **empty primary key**, but they ship with predefined **sorted secondary keys**:

| Secondary key | Components |
|---|---|
| `entity` | `%key` |
| `cid` | `%cid` or `%cid_ref`; depending on the type also `%key`, `%pid` |
| `draft` | draft scenarios: `%is_draft`, possibly `%key`, `%pid` |
| `pid` | late numbering: `%pid`, possibly `%tmp`, `%key` |
| `id` | alias for `entity`, `draft`, or `pid` depending on context (check F2 in ADT) |

Specify the key explicitly in table expressions to avoid syntax warnings and linear scans:

```abap
DATA(ls_matched_row) = lt_create_tab[ KEY cid COMPONENTS %cid = `cid1`
                                                   %key = VALUE #( key_field = 1 ) ].
DATA(ls_entity_row)  = lt_create_tab[ KEY entity %key = VALUE #( key_field = 1 ) ].
```

## Type mapping for RAP

### BDEF `mapping for` block

Maps CDS element names to non-matching DDIC field names (mandatory when they differ, otherwise a syntax warning):

```
define behavior for ZDEMO_ABAP_RAP_DRAFT_M alias calculation
...
{
  ...
  mapping for zdemoabap corresponding
  {
    ID         = ID;
    CalcResult = calc_result;
  }
}
```

Variants include `corresponding` (fields with identical names are mapped implicitly — only deviating names need explicit entries) and `control` — see the ABAP Keyword Documentation topic ABENBDL_TYPE_MAPPING.

### CORRESPONDING additions for BDEF derived types

```abap
... CORRESPONDING #( ... MAPPING FROM ENTITY ) ...               "entity names → DB names
... CORRESPONDING #( ... MAPPING TO ENTITY ) ...                 "DB names → entity names
... CORRESPONDING #( ... USING CONTROL ) ...                     "copy only fields with %control = mk-on
... CORRESPONDING #( ... MAPPING FROM ENTITY USING CONTROL ) ...
... CORRESPONDING #( ... CHANGING CONTROL ) ...                  "derive %control from filled fields
```

- `USING CONTROL`: fields flagged `mk-off` in the source's `%control` are *not* copied — targets keep type-initial values.
- `CHANGING CONTROL`: builds a derived type from a plain structure and sets `%control` to `mk-on` for filled components, `mk-off` for initial ones.

### ABAP SQL with derived types

`INSERT`, `UPDATE`, `MODIFY`, `DELETE` accept derived-type work areas with `MAPPING FROM ENTITY`:

```abap
INSERT zdemo_abap_rapt1 FROM @ls_create_row MAPPING FROM ENTITY.
MODIFY zdemo_abap_rapt1 FROM @ls_create_row MAPPING FROM ENTITY.
DELETE zdemo_abap_rapt1 FROM @ls_create_row MAPPING FROM ENTITY.

"Update only the fields marked in %control:
UPDATE zdemo_abap_rapt1 FROM @ls_create_row
  INDICATORS SET STRUCTURE %control MAPPING FROM ENTITY.
```

This is the standard pattern in `save_modified` implementations (unmanaged/additional save) — see the saver section of [rap-bo-modeling](../../rap-bo-modeling/SKILL.md).

## Dynamic creation of derived types (RTTI)

```abap
DATA lr_table_ref TYPE REF TO data.

DATA(lo_table_type_descr) = cl_abap_tabledescr=>get_bdef_derived_type(
                           p_entity = 'ZDEMO_ABAP_RAP_RO_M'
                           p_kind   = abp_bdef_derived_type-create ).
CREATE DATA lr_table_ref TYPE HANDLE lo_table_type_descr.
```

`cl_abap_structdescr=>get_bdef_derived_type` does the same for structures; `get_base_type` on a type description object returns the underlying BDEF derived type or dictionary type.
