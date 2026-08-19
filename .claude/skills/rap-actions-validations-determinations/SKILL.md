---
name: rap-actions-validations-determinations
description: "Use when declaring or implementing behavior inside a RAP behavior definition and its behavior pool — actions (instance, static, factory, internal, repeatable, with parameter or result), validations on save, determinations on modify / on save, determine actions, static and dynamic feature control, and prechecks. Covers the BDEF grammar and the matching handler signature and implementation for each — FOR MODIFY ... FOR ACTION with %param and RESULT, FOR VALIDATE ON SAVE with failed/reported and %element, FOR DETERMINE ON MODIFY / ON SAVE, FOR INSTANCE FEATURES / FOR GLOBAL FEATURES with if_abap_behv=>fc constants, FOR PRECHECK — plus the execution order across the interaction phase and save sequence, and how behavior surfaces in projection BDEFs. Triggers include add an action to my BO, factory action to copy an instance, action with a parameter, validation not firing, determination loop, on modify vs on save, disable an action dynamically, grey out the button, and precheck vs validation."
---

# RAP Actions, Validations, Determinations, Feature Control, and Prechecks

## Overview

The deep dive behind the behavior sections of [rap-bo-modeling](../rap-bo-modeling/SKILL.md). That skill scaffolds a whole BO; this one covers the five constructs that carry business logic inside the behavior definition:

| Construct | Problem it solves | Runs |
|---|---|---|
| Action | Consumer-triggered state change beyond CRUD ("accept", "copy", "apply discount") | Interaction phase, on request |
| Determination | Compute or default fields when data changes | Interaction phase (`on modify`) or save sequence (`on save`) |
| Validation | Reject inconsistent data before it is persisted | Save sequence (`on save` only) |
| Determine action | Execute selected on-save determinations + validations on request (e.g. "check now" from the UI) | On request |
| Feature control / precheck | Enable/disable operations, fields, actions per state; filter bad input before it reaches the buffer | Interaction phase |

Every construct is a **two-sided contract**: a declaration line in the BDEF and a handler method in the behavior pool with a signature that the BDEF dictates. Get either side wrong and the class does not compile — ADT's quick fix (Ctrl+1 on the BDEF line) generates the matching skeleton, so never hand-guess signatures.

All handler parameters are typed with BDEF derived types (`%tky`, `%param`, `%control`, ...) — the component semantics live in [rap-eml](../rap-eml/SKILL.md).

## Workflow

1. **Pick the construct** — use the table above; when two fit, prefer the one that runs latest (validation over precheck for consistency rules) or earliest (on-modify determination when the UI must see the value before save).
2. **Declare it in the BDEF** — grammar and every addition in [references/bdef-behavior-grammar.md](references/bdef-behavior-grammar.md).
3. **Generate the handler** — Ctrl+1 on the unimplemented BDEF line in ADT creates the `METHODS ... FOR ...` declaration and an empty implementation. Signature catalog: [references/handler-signatures.md](references/handler-signatures.md).
4. **Implement** — `READ ENTITIES ... IN LOCAL MODE` first (never trust `keys` to carry non-key fields), write back with `MODIFY ENTITIES ... IN LOCAL MODE`, and fill the response channels (`result`, `mapped`, `failed`, `reported`).
5. **Expose in the projection BDEF** — `use action ...`; an action you don't `use` is invisible to the service.
6. **Wire UI refresh** — a value computed in the backend does not repaint the UI by itself; add a `side effects` block ([rap-business-events-side-effects](../rap-business-events-side-effects/SKILL.md)).
7. **Test with EML** — `MODIFY ENTITIES ... EXECUTE`, then assert on `result`/`failed`/`reported` ([rap-eml](../rap-eml/SKILL.md)).

A complete BDEF + handler pair implementing everything below: [examples/zr_salesordertp.bdef](examples/zr_salesordertp.bdef) and [examples/zbp_zr_salesordertp.clas.locals_imp.abap](examples/zbp_zr_salesordertp.clas.locals_imp.abap).

## Actions — the full menu

```
action acceptOrder result [1] $self;                                 // instance action, returns the changed instance
action ( features : instance ) rejectOrder result [1] $self;         // dynamically dis-/enabled
action ( precheck ) applyDiscount parameter ZA_OrderDiscount
                                  result [1] $self;                  // input parameter + precheck
static action deleteAllCompleted;                                    // not bound to an instance
internal action recalculateTotalAmount;                              // callable only from inside the BO
repeatable action addLogEntry;                                       // may run n times on one instance per request
factory action copyOrder [1];                                        // creates instances; cardinality AFTER the name
static default factory action createFromTemplate [1];                // default factory for consuming frameworks
action act external 'PublicName';                                    // external alias in OData metadata
action ( authorization : update ) close;                             // delegate auth to update's check
action ( lock : none ) log;                                          // no exclusive lock for this action
save ( finalize ) action postToLedger;                               // callable only during the save sequence
```

Key rules:

- **Non-factory actions** modify existing instances. Cardinality belongs to the `result` clause: `result [0..1] | [1] | [0..*] | [1..*]`, and the result type is `$self` (same entity), `entity SomeCdsEntity`, or — with `deep result` — an abstract BDEF. `result selective [1] ...` returns only requested parts; the handler then gets an extra `REQUEST` importing parameter.
- **Factory actions** create instances. Cardinality sits directly after the name (`factory action copyOrder [1];`) and a `result` clause is **not allowed** — output travels through `mapped`.
- **Parameters**: flat `parameter SOME_ENTITY` takes a CDS abstract entity (or DDIC type); `deep parameter` / `deep table parameter` take an abstract BDEF defined `with hierarchy`. `{ default function GetDefaults...; }` can prefill parameter values on the UI.
- **`static`** actions relate to the entity, not an instance — input rows carry `%cid`, not `%tky`.
- **`internal`** actions are invisible to consumers — the standard target for determinations that delegate their calculation.

### Instance action with result

BDEF:

```
action ( features : instance ) acceptOrder result [1] $self;
```

Handler:

```abap
METHODS accept_order FOR MODIFY
  IMPORTING keys FOR ACTION Order~acceptOrder RESULT result.
```

```abap
METHOD accept_order.
  " 1. Change the state
  MODIFY ENTITIES OF zr_salesordertp IN LOCAL MODE
    ENTITY Order
      UPDATE FIELDS ( OverallStatus )
      WITH VALUE #( FOR order_key IN keys
                    ( %tky          = order_key-%tky
                      OverallStatus = order_status-accepted ) )
    FAILED failed
    REPORTED reported.

  " 2. Read the new state and return it — result rows are %tky + %param
  READ ENTITIES OF zr_salesordertp IN LOCAL MODE
    ENTITY Order
      ALL FIELDS WITH CORRESPONDING #( keys )
    RESULT DATA(orders).

  result = VALUE #( FOR order IN orders
                    ( %tky   = order-%tky
                      %param = order ) ).
ENDMETHOD.
```

### Action with input parameter

BDEF (`ZA_OrderDiscount` is a CDS **abstract entity** holding `discount_percent`):

```
action applyDiscount parameter ZA_OrderDiscount result [1] $self;
```

In the handler, each `keys` row carries `%param-<component>`. Validate the parameter, reject bad rows via `failed`/`reported`, and drop them before processing (rap100 `deductDiscount` pattern):

```abap
METHOD apply_discount.
  DATA(valid_keys) = keys.
  LOOP AT valid_keys ASSIGNING FIELD-SYMBOL(<order_key>)
       WHERE %param-discount_percent IS INITIAL
          OR %param-discount_percent > 100
          OR %param-discount_percent <= 0.
    APPEND VALUE #( %tky = <order_key>-%tky ) TO failed-order.
    APPEND VALUE #( %tky = <order_key>-%tky
                    %msg = new_message( id       = 'ZSALESORDER_MSG'
                                        number   = '004'
                                        severity = if_abap_behv_message=>severity-error ) )
           TO reported-order.
    DELETE valid_keys.
  ENDLOOP.
  CHECK valid_keys IS NOT INITIAL.
  " ... READ prices, apply %param-discount_percent, MODIFY, fill result ...
ENDMETHOD.
```

### Factory action — output via `mapped`, never `result`

BDEF:

```
factory action copyOrder [1];
```

Handler — **no `RESULT`** in the signature; the consumer supplies a `%cid` per new instance and you answer through `mapped` (rap100 `copyTravel` pattern):

```abap
METHODS copy_order FOR MODIFY
  IMPORTING keys FOR ACTION Order~copyOrder.
```

```abap
METHOD copy_order.
  DATA new_orders TYPE TABLE FOR CREATE zr_salesordertp.

  " Factory actions require a %cid per requested instance
  READ TABLE keys WITH KEY %cid = '' INTO DATA(key_without_cid).
  ASSERT key_without_cid IS INITIAL.

  READ ENTITIES OF zr_salesordertp IN LOCAL MODE
    ENTITY Order
      ALL FIELDS WITH CORRESPONDING #( keys )
    RESULT DATA(source_orders)
    FAILED failed.

  LOOP AT source_orders ASSIGNING FIELD-SYMBOL(<source_order>).
    APPEND VALUE #( %cid      = keys[ KEY entity %key = <source_order>-%key ]-%cid
                    %is_draft = keys[ KEY entity %key = <source_order>-%key ]-%param-%is_draft
                    %data     = CORRESPONDING #( <source_order> EXCEPT OrderId ) )
           TO new_orders ASSIGNING FIELD-SYMBOL(<new_order>).
    <new_order>-OverallStatus = order_status-open.
  ENDLOOP.

  MODIFY ENTITIES OF zr_salesordertp IN LOCAL MODE
    ENTITY Order
      CREATE FIELDS ( CustomerId OrderQuantity UnitPrice CurrencyCode OverallStatus )
      WITH new_orders
    MAPPED DATA(mapped_create).

  mapped-order = mapped_create-order.   " hand the new keys back to the framework
ENDMETHOD.
```

(`%param-%is_draft` exists on draft-enabled BOs: the factory's implicit parameter saying whether to create the copy as a draft.)

### Filling `result` vs `mapped` vs `failed`

| Channel | Who fills it | Row shape |
|---|---|---|
| `result` (actions with `result` clause) | You, at the end of the action | `%tky` (or `%cid` for static actions) + `%param = <instance or result type>` |
| `mapped-<entity>` | Factory actions and `create` implementations | `%cid` + `%key` of the created instance |
| `failed-<entity>` | Anything that rejects an instance | `%tky` (+ `%fail-cause`, `%action-<name> = if_abap_behv=>mk-on` to mark the operation) |
| `reported-<entity>` | Messages for the consumer/UI | `%tky` + `%msg` + `%element-<Field> = if_abap_behv=>mk-on` |

## Validations

Validations run **only `on save`** and check consistency; they cannot change data. Trigger conditions: `create`, `update` (only in combination with `create`), `delete`, and `field f1, f2` (fires when those fields change during create/update). One matching trigger is enough.

```
validation validateCustomer on save { create; field CustomerId; }
validation validateQuantity on save { create; field OrderQuantity; }
```

```abap
METHODS validate_customer FOR VALIDATE ON SAVE
  IMPORTING keys FOR Order~validateCustomer.
```

```abap
METHOD validate_customer.
  READ ENTITIES OF zr_salesordertp IN LOCAL MODE
    ENTITY Order
      FIELDS ( CustomerId ) WITH CORRESPONDING #( keys )
    RESULT DATA(orders).

  LOOP AT orders INTO DATA(order).
    " Draft state-message hygiene: clear this validation's previous messages first
    APPEND VALUE #( %tky        = order-%tky
                    %state_area = 'VALIDATE_CUSTOMER' ) TO reported-order.

    IF order-CustomerId IS INITIAL.
      APPEND VALUE #( %tky = order-%tky ) TO failed-order.
      APPEND VALUE #( %tky                = order-%tky
                      %state_area         = 'VALIDATE_CUSTOMER'
                      %msg                = new_message( id       = 'ZSALESORDER_MSG'
                                                         number   = '001'
                                                         severity = if_abap_behv_message=>severity-error )
                      %element-CustomerId = if_abap_behv=>mk-on ) TO reported-order.
    ENDIF.
  ENDLOOP.
ENDMETHOD.
```

- An entry in `failed-<entity>` rejects the **entire transactional buffer** — all-or-nothing. Even clean instances are not saved until the inconsistency is fixed or rolled back.
- `%element-<Field> = if_abap_behv=>mk-on` highlights the offending input field on the UI.
- `%state_area` groups draft state messages: append a row with only `%tky` + `%state_area` to clear old messages of that area, then append the new error into the same area. Without this, stale messages stick to the draft.

## Determinations

Determinations **modify** instances when triggers fire. Two flavors:

| | `on modify` | `on save` |
|---|---|---|
| Runs | Immediately after the change lands in the transactional buffer | In the save sequence (during `finalize`) |
| Result visible to the user before save | Yes | No |
| Typical use | Defaults, computed fields the UI shows live | Final numbers (readable IDs), audit fields |
| Triggers | `create`, `update`, `delete`, `field ...` | `create`, `update` (only with `create`), `delete`, `field ...` |

```
determination setInitialStatus on modify { create; }
determination calculateTotalAmount on modify { field OrderQuantity, UnitPrice; }
determination calculateOrderId on save { create; }
```

```abap
METHODS calculate_total_amount FOR DETERMINE ON MODIFY
  IMPORTING keys FOR Order~calculateTotalAmount.
```

Execution order among several triggered determinations is **arbitrary** — never rely on one determination running before another.

### The self-trigger loop — and three grounded escapes

A determination triggered `on modify { field X; }` that writes field X re-fires itself. Avoid it with the patterns SAP's own samples use:

1. **Write a different field than you trigger on** — trigger on `OrderQuantity, UnitPrice`, write `TotalAmount` (ideally declared `field ( readonly )` so only the BO can touch it).
2. **Filter already-done work** so re-invocations become no-ops (rap100 `CalculateTravelID`):

```abap
METHOD calculate_order_id.
  READ ENTITIES OF zr_salesordertp IN LOCAL MODE
    ENTITY Order
      FIELDS ( OrderId ) WITH CORRESPONDING #( keys )
    RESULT DATA(orders).

  DELETE orders WHERE OrderId IS NOT INITIAL.   " nothing to do — prevents rework and loops
  CHECK orders IS NOT INITIAL.
  " ... SELECT MAX + MODIFY ... UPDATE FROM VALUE #( ... %control-OrderId = if_abap_behv=>mk-on ) ...
ENDMETHOD.
```

3. **Delegate to an internal action** — keeps the calculation reusable (callable from a determination *and* directly), and keeps the determination body trivial:

```abap
METHOD determine_total_amount.
  MODIFY ENTITIES OF zr_salesordertp IN LOCAL MODE
    ENTITY Order
      EXECUTE recalculateTotalAmount
      FROM CORRESPONDING #( keys )
    REPORTED DATA(execute_reported).
  reported = CORRESPONDING #( DEEP execute_reported ).
ENDMETHOD.
```

## Determine actions

A determine action bundles **on-save** determinations and validations for on-request execution — the "check my data now" button, or the standard draft `Prepare`:

```
determine action checkOrder
{
  determination ( always ) calculateOrderId;
  validation validateCustomer;
  validation validateQuantity;
}
```

- Only `on save` determinations/validations can be assigned — `on modify` ones cannot.
- By default each assigned item still honors its trigger conditions; `( always )` forces execution regardless.
- Execution order: **all determinations first, then all validations** — independent of declaration order.
- `draft determine action Prepare { ... }` is the draft-specific determine action; `Activate` runs `Prepare` implicitly, and `draft action Activate optimized;` skips re-running what already ran on unchanged data.
- The UI triggers determine actions through side effects — `determine action checkOrder executed on field CustomerId, field OrderQuantity affects messages;` — declared in the `side effects` block. Grammar and target options live in [rap-business-events-side-effects](../rap-business-events-side-effects/SKILL.md); from code, execute it like any action with EML `EXECUTE`.

## Feature control

### Static — pure BDEF, no code

```
field ( readonly ) OrderId, TotalAmount;
field ( mandatory : create, readonly : update ) OrderUuid;
update ( features : global );
delete ( authorization : update );
```

`readonly`, `mandatory`, `suppress` and their `:create` / `:update` variants are fixed at design time. Details in [rap-bo-modeling](../rap-bo-modeling/SKILL.md).

### Dynamic per instance — `features : instance`

Declare on fields, operations (`update`/`delete`, not `create`), or actions; implement once per entity in `FOR INSTANCE FEATURES`:

```
field ( features : instance ) DiscountPercent;
action ( features : instance ) acceptOrder result [1] $self;
```

```abap
METHODS get_instance_features FOR INSTANCE FEATURES
  IMPORTING keys REQUEST requested_features FOR Order RESULT result.
```

```abap
METHOD get_instance_features.
  READ ENTITIES OF zr_salesordertp IN LOCAL MODE
    ENTITY Order
      FIELDS ( OverallStatus ) WITH CORRESPONDING #( keys )
    RESULT DATA(orders)
    FAILED failed.

  result = VALUE #(
    FOR order IN orders
      LET accept_state = COND #( WHEN order-OverallStatus = order_status-accepted
                                 THEN if_abap_behv=>fc-o-disabled
                                 ELSE if_abap_behv=>fc-o-enabled )
      IN ( %tky                  = order-%tky
           %action-acceptOrder   = accept_state
           %field-DiscountPercent = COND #( WHEN order-OverallStatus = order_status-accepted
                                            THEN if_abap_behv=>fc-f-read_only
                                            ELSE if_abap_behv=>fc-f-unrestricted ) ) ).
ENDMETHOD.
```

Result-row conventions (see [references/handler-signatures.md](references/handler-signatures.md) for the full component list):

- Operations, actions, associations: `%update`, `%delete`, `%action-<name>`, `%assoc-<name>` take `if_abap_behv=>fc-o-enabled` / `fc-o-disabled`.
- Fields: `%field-<Name>` takes `if_abap_behv=>fc-f-unrestricted`, `fc-f-read_only`, `fc-f-mandatory`, or `fc-f-all` (read-only *and* mandatory) — check the value set of `IF_ABAP_BEHV=>FC` in ADT with F2 for further options on your release.
- `requested_features` tells you which features the consumer actually asked for (`%action-<name> = if_abap_behv=>mk-on`) — skip expensive reads for the rest.
- Older sources write `FOR FEATURES` / `FOR AUTHORIZATION`; the current spellings are `FOR INSTANCE FEATURES` / `FOR INSTANCE AUTHORIZATION` (authorization handlers are covered in [abap-authorization](../abap-authorization/SKILL.md)).

### Dynamic globally — `features : global`

State-independent switches (time windows, configuration, edition flags). No `keys`; the result is a **structure**, not a table:

```abap
METHODS get_global_features FOR GLOBAL FEATURES
  IMPORTING REQUEST requested_features FOR Order RESULT result.
```

```abap
METHOD get_global_features.
  result = VALUE #( %action-deleteAllCompleted =
                      COND #( WHEN is_archiving_window_open( )
                              THEN if_abap_behv=>fc-o-enabled
                              ELSE if_abap_behv=>fc-o-disabled ) ).
ENDMETHOD.
```

Note: `IN LOCAL MODE` (your own EML inside the BO) bypasses feature control, authorization checks, and prechecks — so a disabled action stays callable from your own handlers.

## Prechecks

A precheck runs **before** a modify request reaches the transactional buffer and filters out unwanted input — the instance rows you put into `failed` are removed from the request:

```
update ( precheck );
action ( precheck ) applyDiscount parameter ZA_OrderDiscount result [1] $self;
```

```abap
METHODS precheck_update FOR PRECHECK
  IMPORTING entities FOR UPDATE Order.

METHODS precheck_apply_discount FOR PRECHECK
  IMPORTING keys FOR ACTION Order~applyDiscount.
```

- Response channels are `failed` and `reported` only — there is **no `mapped`** and a precheck must not modify anything.
- For operations, `entities` carries the incoming values **including `%control`**, so you can check exactly what the consumer is trying to write — something a validation (which sees only the final buffer state) cannot distinguish.
- Prechecks can also be added at the **projection layer** (own behavior pool for the projection BDEF); a base-BO precheck is reused automatically by the projection.
- One method can serve several operations: `METHODS precheck FOR PRECHECK IMPORTING entities_create FOR CREATE Order entities_update FOR UPDATE Order.`

**Precheck vs validation:** precheck = per-request input filter in the interaction phase (bad rows silently dropped from the request, rest proceeds); validation = consistency gate at save time (any failure blocks the whole save). Use prechecks to keep garbage out of the buffer (e.g. key uniqueness in external numbering, forbidden field changes); use validations for business consistency of the final state.

## Execution order across a RAP transaction

```
INTERACTION PHASE (per modify request)
  1. Global authorization / global feature control
  2. Precheck                         → failed rows dropped from the request
  3. Instance feature control / instance authorization (for the touched operation)
  4. Operation executes               → transactional buffer changes
  5. Determinations ON MODIFY         → immediately after the buffer change
     (side effects may now trigger determine actions / UI reloads)

SAVE SEQUENCE (COMMIT ENTITIES — implicit for OData/Fiori)
  6. finalize                         → determinations ON SAVE run here
  7. check_before_save                → validations ON SAVE run here
     ── all clean? POINT OF NO RETURN ── else: back to interaction phase
  8. adjust_numbers                   → late numbering (final keys)
  9. save / save_modified             → persistence (+ additional save)
 10. cleanup                          → buffer cleared
```

Draft twist: `Prepare` executes its assigned on-save determinations/validations already during draft handling, so users see errors while editing, not at activation; `Activate optimized` avoids re-running them on unchanged data. Saver-side depth (finalize/check_before_save/adjust_numbers, unmanaged and additional save) lives in [rap-saves-and-numbering](../rap-saves-and-numbering/SKILL.md).

## Calling and committing another BO from an action

A frequent need: an action must create or update instances of a *different* BO. What you must NOT do: `COMMIT ENTITIES` (or `COMMIT WORK`) anywhere inside a handler or saver — in ABAP Cloud contexts this terminates with the `BEHAVIOR_ILLEGAL_STMT_IN_CALL` runtime error (see [abap-sap-luw](../abap-sap-luw/SKILL.md)). Three legal paths, in order of preference:

1. **Same LUW (default).** `MODIFY ENTITIES` of the other BO from the action handler *without* committing. The other BO's changes join the caller's RAP LUW; the framework commits both BOs together in one save sequence. Fully consistent: if the caller's transaction fails or rolls back, the other BO's changes are rolled back too.

```abap
METHOD approve FOR MODIFY IMPORTING approval_keys FOR ACTION travel~approve.
  " Joins the SAME RAP LUW — no COMMIT here, the framework commits both BOs together.
  MODIFY ENTITIES OF zr_auditlogtp IN LOCAL MODE
    ENTITY auditlogentry
      CREATE FIELDS ( description ) WITH audit_entries_for( approval_keys )
    MAPPED DATA(mapped_audit_entries)
    FAILED DATA(failed_audit_entries).
ENDMETHOD.
```

2. **Independent commit, now.** If the other BO must be persisted *regardless of the caller's fate* (e.g. an attempt log), hand the work to a **`CL_ABAP_PARALLEL`** worker: each task runs in its own aRFC session with its own SAP LUW, where `MODIFY ENTITIES` + `COMMIT ENTITIES` are legal. Caveat: the commit is independent — a later rollback of the calling RAP transaction will **not** undo it. See the RAP isolation pattern in [abap-parallel-processing](../abap-parallel-processing/SKILL.md).

3. **Async after commit.** If the work should only happen once the caller's transaction has committed, raise a business event or start a bgPF process from the save phase — [rap-business-events-side-effects](../rap-business-events-side-effects/SKILL.md), [abap-background-processing](../abap-background-processing/SKILL.md).

## Projection BDEFs — what surfaces, what doesn't

```
projection;
strict ( 2 );
use draft;

define behavior for ZC_SalesOrder alias Order
{
  use create;
  use update;
  use delete;

  use action Edit;
  use action Activate;
  use action Discard;
  use action Resume;
  use action Prepare;

  use action acceptOrder;      // not used = not exposed
  use action copyOrder;
  use association _Item { create; with draft; }
}
```

- Actions, functions, draft actions, and association operations must be **`use`d** to be visible; omitting one hides it from the service — the standard way to expose a subset.
- Validations and determinations are **not** `use`d — they belong to the base BO and always run, no matter which projection triggered the change.
- Feature control travels with the operations you `use`; a projection can also add its own prechecks (with its own behavior pool).
- `internal` actions can never surface in a projection.

## Quick Reference

| Construct | BDEF line | Handler signature (`METHODS ... `) | Response channels |
|---|---|---|---|
| Instance action | `action a result [1] $self;` | `FOR MODIFY IMPORTING keys FOR ACTION e~a RESULT result` | result, failed, reported |
| Action + parameter | `action a parameter ZA_P result [1] $self;` | same; rows carry `%param-<comp>` | result, failed, reported |
| Static action | `static action a;` | `FOR MODIFY IMPORTING keys FOR ACTION e~a` (rows: `%cid`, `%param`) | mapped*, failed, reported |
| Factory action | `factory action a [1];` | `FOR MODIFY IMPORTING keys FOR ACTION e~a` — **no RESULT** | mapped, failed, reported |
| Internal action | `internal action a;` | as its kind; callable only inside the BO | as its kind |
| Repeatable action | `repeatable action a;` | as instance action; multiple runs per instance/request | as instance action |
| Validation | `validation v on save { create; field F; }` | `FOR VALIDATE ON SAVE IMPORTING keys FOR e~v` | failed, reported |
| Determination (modify) | `determination d on modify { field F; }` | `FOR DETERMINE ON MODIFY IMPORTING keys FOR e~d` | failed, reported |
| Determination (save) | `determination d on save { create; }` | `FOR DETERMINE ON SAVE IMPORTING keys FOR e~d` | failed, reported |
| Determine action | `determine action da { determination d; validation v; }` | none — executes assigned items | (their channels) |
| Instance features | `( features : instance )` on field/op/action | `FOR INSTANCE FEATURES IMPORTING keys REQUEST requested_features FOR e RESULT result` | result, failed, reported |
| Global features | `( features : global )` | `FOR GLOBAL FEATURES IMPORTING REQUEST requested_features FOR e RESULT result` (result = structure) | result, reported |
| Precheck (operation) | `update ( precheck );` | `FOR PRECHECK IMPORTING entities FOR UPDATE e` | failed, reported |
| Precheck (action) | `action ( precheck ) a ...;` | `FOR PRECHECK IMPORTING keys FOR ACTION e~a` | failed, reported |

\* static actions that create instances report new keys via `mapped`; plain static actions often fill only `reported`.

## Common Mistakes

| Wrong | Right |
|---|---|
| `factory action copyOrder result [1] $self;` | Factory actions allow no result — `factory action copyOrder [1];`, return keys via `mapped-<entity>` |
| `action a [1] result $self;` | Cardinality belongs after `result` for non-factory actions: `action a result [1] $self;` |
| Declaring `result` in BDEF but no `RESULT result` in the METHODS (or vice versa) | Both sides must match — regenerate with ADT quick fix |
| Filling `result` rows with only `%param` | Each row needs the identity too: `( %tky = ...  %param = ... )` |
| Determination `on modify { field TotalAmount; }` that writes `TotalAmount` | Trigger on the inputs, write the output: `{ field OrderQuantity, UnitPrice; }` → write `TotalAmount` |
| Computing a save-relevant number `on modify` for "live" UX | The user sees stale values anyway after re-reads; final numbers (IDs, audit stamps) belong `on save` — and add `side effects` for live UX instead |
| Assigning an `on modify` determination to a determine action | Only `on save` determinations/validations are assignable |
| Validation that writes data via `MODIFY ENTITIES` | Validations check only; move the write into a determination or action |
| Forgetting the `%state_area` clear-row in a draft validation | Stale error messages stick to the draft — always append the clear row first |
| Testing an action's feature control with EML `IN LOCAL MODE` | `IN LOCAL MODE` bypasses feature control, authorization, and prechecks — test through the service or plain EML |
| `FOR FEATURES` result without `%tky` | Every instance-features result row needs `%tky`; without it the framework can't match the instance |
| Expecting a precheck failure to abort the whole request | Prechecks drop only the failed rows; the rest proceeds — use a validation for all-or-nothing semantics |
| Enabling an action in the projection that the base BDEF doesn't declare | Projections only `use` what exists below — declare in the base BDEF first |
| `COMMIT ENTITIES` inside an action handler to persist another BO | `BEHAVIOR_ILLEGAL_STMT_IN_CALL` dump — modify without commit (same LUW), isolate in a `CL_ABAP_PARALLEL` task, or go async via bgPF/events |

## References

- [references/bdef-behavior-grammar.md](references/bdef-behavior-grammar.md) — full BDL grammar: every action/validation/determination/feature/precheck addition
- [references/handler-signatures.md](references/handler-signatures.md) — every `METHODS ... FOR ...` signature with parameter types and response channels
- [examples/zr_salesordertp.bdef](examples/zr_salesordertp.bdef) + [examples/zbp_zr_salesordertp.clas.locals_imp.abap](examples/zbp_zr_salesordertp.clas.locals_imp.abap) — complete BDEF + handler pair
- **ABAP Keyword Documentation — RAP BDL** (actions, validations, determinations, feature control): https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENBDL.html
- **RAP BDL — action**: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENBDL_ACTION.html
- **RAP BDL — precheck**: https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/abenbdl_precheck.htm
- **RAP handler methods — METHODS, FOR**: https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/abapmethods_for_rap_behv.htm
- **FOR PRECHECK handler method**: https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/abaphandler_meth_precheck.htm
- **RAP dev guide — Operation Precheck**: https://help.sap.com/docs/abap-cloud/abap-rap/operation-precheck
- **RAP dev guide — Determinations**: https://help.sap.com/docs/abap-cloud/abap-rap/determinations
- **Saver methods finalize / check_before_save** (where on-save determinations/validations run): https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/abensaver_finalize.htm and https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/abensaver_check_before_save.htm
- **SAP-samples/abap-cheat-sheets** — `36_RAP_Behavior_Definition_Language.md`, `08_EML_ABAP_for_RAP.md`: https://github.com/SAP-samples/abap-cheat-sheets
- **SAP-samples/abap-platform-rap100** — exercises 4–7 (determinations, validations, actions, dynamic feature control): https://github.com/SAP-samples/abap-platform-rap100
- Linked skills: [rap-bo-modeling](../rap-bo-modeling/SKILL.md), [rap-eml](../rap-eml/SKILL.md), [rap-business-events-side-effects](../rap-business-events-side-effects/SKILL.md), [rap-saves-and-numbering](../rap-saves-and-numbering/SKILL.md), [abap-authorization](../abap-authorization/SKILL.md)
