# RAP Handler Method Signatures — Complete Catalog

Implementation-side reference: every `METHODS ... FOR ...` declaration the BDEF constructs of
this skill require, with parameter types and available response channels. Declaration-side
counterpart: [bdef-behavior-grammar.md](bdef-behavior-grammar.md).

Grounded in SAP-samples/abap-cheat-sheets (`08_EML_ABAP_for_RAP.md`, `zbp_demo_abap_rap_*`),
the opensAP/rap100 Travel behavior pools, and the ABAP Keyword Documentation
(`abapmethods_for_rap_behv`, `abaphandler_meth_precheck`).

## Ground rules

- Handler classes are local classes (`lhc_*`) in the behavior pool's CCIMP include, inheriting
  from `cl_abap_behavior_handler` — implicitly `ABSTRACT` and `FINAL`.
- Method names are free (except a few predefined ones); parameter names are free too, the
  conventional names below come from ADT's generator.
- `IMPORTING` is implicit and may be omitted.
- Response parameters (`mapped`, `failed`, `reported`) are implicit CHANGING parameters with
  predefined names; which ones exist depends on the method kind.
- Never re-read a signature from memory — ADT quick fix (Ctrl+1 on the BDEF line) generates it.

## Actions

### Instance action (with and without result)

```abap
METHODS accept_order FOR MODIFY
  IMPORTING keys FOR ACTION Order~acceptOrder RESULT result.

METHODS write_log FOR MODIFY
  IMPORTING keys FOR ACTION Order~writeLog.
```

- `keys` type: `TYPE TABLE FOR ACTION IMPORT Order~acceptOrder` — rows carry `%tky` and, if a
  parameter is declared, `%param-<component>`.
- `result` type: `TYPE TABLE FOR ACTION RESULT Order~acceptOrder` — rows carry `%tky` +
  `%param` (the result payload, e.g. the full instance for `result [1] $self`).
- Channels: `result`, `failed-<entity>`, `reported-<entity>`.
- Mark the failing operation in `failed`/`reported` rows with
  `%action-acceptOrder = if_abap_behv=>mk-on` (or via `%op-%action-...` when inspecting a
  consumer-side failed row).

### Action with `result selective`

The handler additionally receives a `REQUEST` parameter that marks which result parts the
consumer asked for:

```abap
METHODS compute FOR MODIFY
  IMPORTING keys FOR ACTION Order~compute REQUEST requested_fields RESULT result.
```

### Static action

```abap
METHODS delete_all_completed FOR MODIFY
  IMPORTING keys FOR ACTION Order~deleteAllCompleted.
```

Same shape, but rows identify the call via `%cid` (no instance, hence no `%tky`).

### Factory action — no RESULT

```abap
METHODS copy_order FOR MODIFY
  IMPORTING keys FOR ACTION Order~copyOrder.
```

- `keys` rows: `%cid` (mandatory, one per instance to create), `%tky` of the source instance
  (instance-bound factory), and on draft BOs `%param-%is_draft`.
- Fill `mapped-<entity>` with the `MAPPED` output of your internal `MODIFY ... CREATE`.
- Channels: `mapped`, `failed`, `reported` — **never** `result`.

## Validations

```abap
METHODS validate_customer FOR VALIDATE ON SAVE
  IMPORTING keys FOR Order~validateCustomer.
```

- `keys` type: `TYPE TABLE FOR VALIDATION Order~validateCustomer` — keys only; `READ ENTITIES
  ... IN LOCAL MODE` for field values.
- Channels: `failed-<entity>` (rejects the save), `reported-<entity>`.
- `reported` row extras: `%msg`, `%element-<Field> = if_abap_behv=>mk-on` (highlight input
  field), `%state_area` (draft state-message group — append a row with only `%tky` +
  `%state_area` first to invalidate previous messages of that area).

## Determinations

```abap
METHODS set_initial_status FOR DETERMINE ON MODIFY
  IMPORTING keys FOR Order~setInitialStatus.

METHODS calculate_order_id FOR DETERMINE ON SAVE
  IMPORTING keys FOR Order~calculateOrderId.
```

- `keys` type: `TYPE TABLE FOR DETERMINATION Order~setInitialStatus` — keys only.
- Channels: `failed`, `reported` (a determination should rarely fail — prefer computing).
- Write changes back with `MODIFY ENTITIES ... IN LOCAL MODE` (`UPDATE FIELDS ( ... )` or
  `EXECUTE <internal action>`); when building rows manually, set
  `%control-<Field> = if_abap_behv=>mk-on` for each written field.

## Determine actions

No handler method. The framework executes the assigned on-save determinations and validations
(their handlers run). Triggered by side effects, by EML `MODIFY ... EXECUTE`, or — for
`Prepare` — implicitly by `Activate`.

## Feature control

### Instance features

```abap
METHODS get_instance_features FOR INSTANCE FEATURES
  IMPORTING keys REQUEST requested_features FOR Order RESULT result.
```

- One method per entity — it serves **all** `features : instance` declarations of that entity.
- `keys`: instance keys (+ `%is_draft` on draft BOs).
- `requested_features`: which features the consumer asked for; components mirror the result
  row and carry `if_abap_behv=>mk-on/mk-off`. Guard expensive logic:
  `IF requested_features-%action-acceptOrder = if_abap_behv=>mk-on. ... ENDIF.`
- `result` type: `TYPE TABLE FOR INSTANCE FEATURES RESULT Order` (in newer syntax diagrams the
  row nests under `%features`; assignments like `result_line-%action-... = ...` and
  `%features-%action-... = ...` both appear in SAP samples). Row components:

| Component | Values | Controls |
|---|---|---|
| `%tky` | — | mandatory: which instance the row describes |
| `%field-<Name>` | `if_abap_behv=>fc-f-unrestricted`, `fc-f-read_only`, `fc-f-mandatory`, `fc-f-all` | field editability by state (`fc-f-all` = read-only and mandatory) |
| `%update`, `%delete` | `if_abap_behv=>fc-o-enabled`, `fc-o-disabled` | standard operations |
| `%action-<name>` | `fc-o-enabled` / `fc-o-disabled` | actions |
| `%assoc-<name>` | `fc-o-enabled` / `fc-o-disabled` | create-by-association |

Inspect `IF_ABAP_BEHV=>FC` with F2 in ADT for the complete value set on your release.

- Channels: `result`, `failed`, `reported`.
- Legacy spelling in older workshop material: `FOR FEATURES ... IMPORTING keys REQUEST
  requested_features FOR Travel RESULT result` — same semantics as `FOR INSTANCE FEATURES`.

### Global features

```abap
METHODS get_global_features FOR GLOBAL FEATURES
  IMPORTING REQUEST requested_features FOR Order RESULT result.
```

- No `keys`. `result` is a **structure** (`TYPE STRUCTURE FOR GLOBAL FEATURES RESULT Order`)
  with `%create`, `%update`, `%delete`, `%action-<name>` taking `fc-o-enabled/disabled`.

## Prechecks

```abap
" Standard operations
METHODS precheck_create FOR PRECHECK
  IMPORTING entities FOR CREATE Order.

METHODS precheck_update FOR PRECHECK
  IMPORTING entities FOR UPDATE Order.

" Create-by-association
METHODS precheck_cba_item FOR PRECHECK
  IMPORTING entities_cba FOR CREATE Order\_Item.

" Actions
METHODS precheck_apply_discount FOR PRECHECK
  IMPORTING keys FOR ACTION Order~applyDiscount.

" Several operations in one method
METHODS precheck FOR PRECHECK
  IMPORTING entities_create FOR CREATE Order
            entities_update FOR UPDATE Order.
```

- `entities` carries the **incoming request values including `%control`** — you see exactly
  what the consumer wants to write, before it hits the buffer.
- Implicit CHANGING: `failed`, `reported` only (no `mapped`); a row in `failed-<entity>`
  removes that instance from the modify request — the rest proceeds.
- A precheck must not modify data.
- EML with `IN LOCAL MODE` bypasses prechecks (as well as feature control and authorization).

## Related handler kinds (other skills)

```abap
" Authorization — see abap-authorization
METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
  IMPORTING REQUEST requested_authorizations FOR Order RESULT result.
METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
  IMPORTING keys REQUEST requested_authorizations FOR Order RESULT result.

" Numbering — see rap-saves-and-numbering
METHODS earlynumbering_create FOR NUMBERING
  IMPORTING entities FOR CREATE Order.

" Unmanaged CRUD, READ, LOCK — see rap-bo-modeling / rap-saves-and-numbering
METHODS create FOR MODIFY IMPORTING entities FOR CREATE Order.
METHODS read   FOR READ   IMPORTING keys FOR READ Order RESULT result.
METHODS lock   FOR LOCK   IMPORTING keys FOR LOCK Order.
```

## Response channels by method kind — summary

| Method kind | mapped | failed | reported | result |
|---|---|---|---|---|
| `FOR MODIFY ... FOR ACTION` (with result) | for factory/static-create | yes | yes | yes |
| `FOR MODIFY ... FOR ACTION` (factory) | **yes — the output** | yes | yes | no |
| `FOR VALIDATE ON SAVE` | no | yes — rejects save | yes | no |
| `FOR DETERMINE ON MODIFY / ON SAVE` | no | yes | yes | no |
| `FOR INSTANCE FEATURES` | no | yes | yes | yes (table) |
| `FOR GLOBAL FEATURES` | no | no | yes | yes (structure) |
| `FOR PRECHECK` | no | yes — drops rows from request | yes | no |
