# RAP Side Effects — Deep Dive

Full syntax matrix and UI mechanics for RAP side effects. Companion to the main
[SKILL.md](../SKILL.md); business events are covered in
[business-events-reference.md](business-events-reference.md).

## What a side effect is

- RAP side effects define **interdependencies among RAP BO properties** that trigger a
  reload of affected properties in the user interface.
- They are **purely declarative** — no custom implementation exists or is required. The
  logic that changes the data lives elsewhere (determinations, actions, event producers);
  the side effect only tells the UI *what to re-read and when*.
- Multiple side effects are summarized within one block in curly brackets, separated by
  semicolons.

```
side effects
{
  <trigger> affects <target> [, <target> ...];
  ...
}
```

The block belongs in the entity behavior body of the **base** behavior definition; the
projection must opt in (see "Projection enablement" below).

## Triggers (left of `affects`)

| Trigger | Syntax | Fires when |
|---|---|---|
| Field | `field a affects ...;` | The field is changed on the UI (user leaves the changed field) |
| Entity CUD | `$self affects ...;` | The current entity undergoes a create/update/delete |
| Action | `action act affects ...;` | The action is executed on the UI |
| Determine action | `determine action d executed on field c, field _Assoc.e affects ...;` | Any listed source changes → the determine action runs, then targets reload |
| Event | `event evt affects ...;` | The business event (declared `for side effects`) is raised and committed |

Notes per trigger:
- **`field`** — the classic dependency: discount changed → total must be re-read.
- **`$self`** — restriction: the **targets may not be fields of the current entity**; use
  it to refresh associated entities' data (e.g. header statistics after item CUD). For own
  fields use a `field` or `action` trigger instead.
- **`action`** — pair with actions whose implementation (or attached determinations)
  changes data the user is looking at.
- **`determine action ... executed on ...`** — the trigger *group* after `executed on` can
  list several fields, including association paths (`field _Assoc.e`). When any of them
  changes, the determine action executes its assigned determinations/validations and the
  targets reload. This is the declarative replacement for "recalculate on field exit".
  (Determine actions themselves: only `on save` determinations/validations can be assigned;
  the `always` addition forces execution regardless of trigger conditions.)
- **`event`** — the event must be declared in the same BDEF with
  `event <name> for side effects;`. This is how a background process pushes a UI refresh.

## Targets (right of `affects`)

| Target | Syntax | Reloads |
|---|---|---|
| Field(s) | `affects field b` / `affects field ( b, c )` | The listed fields |
| All fields | `affects field *` | All fields of the same instance |
| Associated field | `affects field _Assoc.e` | Field on an associated entity |
| Entity | `affects entity _Assoc` | The associated entity's data |
| Entity groups | `affects entity ( _Assoc1, _Assoc2 )` / `entity _Assoc1.( _Item1, _Item2 )` | Several (nested) associations |
| Own entity | `affects $self` | The current instance as a whole |
| Permissions | `affects permissions( field h )` / `permissions( action act )` / `permissions( create )` / `permissions( create _Assoc )` | Feature and authorization control — field editability, action enablement, operation availability |
| Messages | `affects messages` | All reported messages (message reload) |

Targets combine freely in one side effect, comma-separated.

## Complete syntax example

All variants in one block (from the RAP BDL cheat sheet):

```
side effects
{
  // Single source property
  field a affects field b;

  // Entity CUD → associated-entity target (never own fields)
  $self affects field y;

  // Multiple source properties triggering a determine action
  determine action someDetermineAction
    executed on field c,
                field d,
                field _Assoc.e
    affects field f;

  // Reload feature control for another field
  field g affects permissions( field h );

  // Action with full reload, operation control, and messages
  action act1 affects field *,
                      permissions( action act2 ),
                      messages;

  // Action refreshing a field and an associated entity
  action act3 affects field i, entity _Assoc;

  // Event-driven side effect
  event evt affects field j;
}
```

And the minimal real-world event-driven variant (from SAP's bgPF sample):

```
// side effect events
event QuantityUpdated for side effects;

side effects
{
  event QuantityUpdated affects field ( Quantity );
}
```

## Projection enablement

Side effects reach the UI only if the projection behavior definition opts in — on BO level
and, for triggers, on entity level:

```
projection;
strict ( 2 );
use draft;
use side effects;                    // BO level

define behavior for ZC_Inventory alias Inventory
use etag
{
  use action reCalculateInventory;   // action triggers must be exposed
  use event QuantityUpdated;         // event triggers must be exposed

  use create;
  use update;
  use delete;
}
```

Symptoms of a missing opt-in: the side effect activates without errors, but the Fiori app
never refreshes. Check, in order: `use side effects;` in the projection header,
`use event <name>;` / `use action <name>;` at entity level, and that the service binding
exposes the projection (side effects target OData V4 / Fiori Elements consumption).

## How the Fiori Elements UI refresh works

1. At activation, the framework translates the BDEF side-effect definitions into OData
   side-effect annotations in the service metadata. The Fiori Elements app reads them —
   no UI extension code, no controller logic.
2. When a trigger occurs (field changed, action pressed, event committed), the UI sends a
   **read request for exactly the declared targets** and re-renders those controls:
   - `field` targets → the listed properties are re-read;
   - `field *` → all fields of the instance;
   - `entity` targets → the associated entity data is re-read;
   - `permissions(...)` → feature control is re-evaluated (buttons enable/disable, fields
     switch editable/read-only);
   - `messages` → reported messages are re-fetched and shown.
3. For **event-driven side effects**, the running Fiori Elements app is notified after the
   event's transaction commits; it re-reads the affected fields and informs the user with a
   small notification popup. Net effect: a long-running background calculation finishes and
   the value on the open Object Page updates by itself.

## The background-push scenario end to end

The reference flow from SAP's sample (inventory calculation via bgPF):

1. User presses *Calculate inventory* → action `reCalculateInventory` updates a status
   field.
2. `save_modified` detects the status change (`%control`) and starts a background process
   (bgPF) — see the [abap-background-processing](../../abap-background-processing/SKILL.md)
   skill.
3. The background process finishes and updates `Quantity` via an EML `MODIFY ENTITIES`.
4. That save's `save_modified` sees `%control-Quantity` set and raises
   `RAISE ENTITY EVENT ...~QuantityUpdated`.
5. The committed event triggers the side effect `event QuantityUpdated affects field
   ( Quantity )` — the open Fiori UI re-reads `Quantity` and pops a notification.

Full code in [../examples/inventory-events-side-effects.md](../examples/inventory-events-side-effects.md).

## Availability

- Side effects (field/action/`$self`/determine-action triggers) are part of the RAP BDL in
  ABAP Cloud (SAP BTP ABAP Environment, SAP S/4HANA Cloud); check the CLOUD keyword
  documentation for your release.
- **Event-driven side effects** were initially released only for SAP BTP ABAP Environment
  and SAP S/4HANA Cloud Public Edition; per SAP's own sample README
  ([abap-platform-bgpf-appl-log-events-side-effects](https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects)):
  "We plan to make this available for on premise and private cloud systems as of release
  2025" — a stated intent, not a shipped commitment, so verify current availability in your
  system before relying on it.
- bgPF, the usual event producer in this pattern, is available on-premise / private cloud
  as of SAP S/4HANA 2023.

## Design guidance

- Declare the **narrowest target** that satisfies the UI: `field ( TotalPrice )` beats
  `field *` (every reload is a read round-trip).
- Use `permissions(...)` whenever an action or field changes what the user is allowed to do
  next; otherwise buttons stay stale until a full refresh.
- Keep side effects in the **base** BDEF (they describe the BO's data dependencies); the
  projection only selects which ones a given consumer sees.
- Do not model business logic as a chain of side effects — they cannot compute anything.
  Compute in determinations; declare the dependency as a side effect.
