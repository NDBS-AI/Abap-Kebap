---
name: rap-business-events-side-effects
description: "Use when defining, raising, or consuming RAP business events, or when declaring RAP side effects so a Fiori Elements UI reloads the right data. Covers event definitions in the behavior definition (event with parameter, CDS abstract entity payload, managed derived events, event for side effects), raising events with RAISE ENTITY EVENT in the RAP save phase, local consumption via event handler classes (FOR EVENTS OF, CL_ABAP_BEHAVIOR_EVENT_HANDLER), external consumption via event bindings, Enterprise Event Enablement, SAP Event Mesh, and the Event Consumption Model, the side effects block with its triggers (field, action, $self, determine action, event) and targets (field, entity, permissions, messages), enabling side effects in the projection behavior definition, and how determinations, side effects, and events differ. Triggers include RAP event, business event, raise entity event, event binding, event mesh, consume event, side effects, affects field, field not refreshing, and UI refresh after action."
---

# RAP Business Events and Side Effects

## Overview

Two RAP mechanisms that are often confused because both react to "something changed":

- **Business events** are asynchronous, after-commit notifications. A RAP BO raises an event
  (typically in the save phase with `RAISE ENTITY EVENT`), and after the transaction commits,
  consumers react — a local event handler class in the same system, or external systems via
  an event binding and SAP Event Mesh. Events decouple follow-up processing from the
  transaction that caused it.
- **Side effects** are declarative UI-refresh rules in the behavior definition. They contain
  no code at all: they tell a Fiori Elements UI "when trigger X happens, reload targets Y".
  The framework turns them into OData metadata; the UI issues targeted read requests.

They meet in **event-driven side effects** (`event ... for side effects`): a background
process updates the BO, raises an event, and the side effect pushes the refreshed value to
the open Fiori UI without the user pressing anything.

**Core principle:** determinations change data, side effects refresh the UI, events notify
the world. A determination that recalculates a total does *not* make the UI show it — only a
side effect does. A side effect does *not* run logic — only determinations and event handlers
do. Model each concern with the mechanism built for it.

This skill assumes BDEF basics (managed/unmanaged, actions, determinations, saver classes)
from [rap-bo-modeling](../rap-bo-modeling/SKILL.md). Event payload abstract entities are CDS
artifacts — see [cds-views-authoring](../cds-views-authoring/SKILL.md). The canonical
event-driven side-effect scenario uses the background processing framework (bgPF) — see
[abap-background-processing](../abap-background-processing/SKILL.md).

## Workflow

1. **Classify the requirement.**
   - "UI should reload field/entity/permissions after a user interaction" → side effect.
   - "Something must happen after commit, decoupled (log, notify, replicate, integrate)" → business event.
   - "UI should reflect a change made by a background job / another session" → event + event-driven side effect.
   - "A value must be computed on the server" → determination (not this skill; see rap-bo-modeling).
2. **For side effects:** declare the `side effects { ... }` block in the base behavior
   definition; pick the trigger (`field`, `action`, `$self`, `determine action`, `event`) and
   the targets (`field`, `entity`, `permissions(...)`, `messages`, `$self`).
3. **Enable side effects in the projection:** `use side effects;` in the projection BDEF
   header, and `use event <name>;` / `use action <name>;` at entity level for every trigger
   the UI needs.
4. **For business events:** define the event in the BDEF (with a CDS abstract entity
   `parameter` if consumers need a payload), then raise it with `RAISE ENTITY EVENT` in the
   save phase — for managed BOs, add `with additional save` and raise in `save_modified`.
5. **Consume:** locally with an event handler class (`FOR EVENTS OF` + local class
   inheriting `cl_abap_behavior_event_handler`), or externally by creating an event binding
   and configuring Enterprise Event Enablement / SAP Event Mesh.
6. **Verify end to end:** commit the triggering transaction, confirm the handler ran (or the
   external topic received the event), and confirm the UI reloads the declared targets.

## Defining business events in the behavior definition

Events are declared inside `define behavior for ...` in the base BDEF:

```
define behavior for ZR_Inventory alias Inventory
...
{
  // Event without payload — consumers get the instance key only
  event StockCounted;

  // Event with payload — SOME_ENTITY is a CDS abstract entity
  event OutOfStock parameter ZD_InventoryOutOfStock;

  // Deep payload — abstract entity from an abstract BDEF with "with hierarchy"
  event InventoryReplicated deep parameter ZD_InventoryHierarchy;

  // Derived event: raised automatically whenever OutOfStock is raised,
  // with a redefined payload
  managed event OutOfStockExternal on OutOfStock parameter ZD_OutOfStockExt;

  // Event used solely to trigger an event-driven side effect (no external use)
  event QuantityUpdated for side effects;
}
```

What each variant means:
- `event <name>;` — payload is just the instance key(s).
- `event <name> parameter <abstract entity>;` — payload adds the abstract entity's fields
  (available as `%param` when raising and consuming).
- `event <name> deep parameter <abstract entity>;` — hierarchical payload; the abstract
  entity must belong to an abstract BDEF defined `with hierarchy`.
- `managed event <name> on <base event> parameter ...;` — a *derived event*: you never raise
  it yourself; the framework raises it automatically when the referenced event is raised.
  Use it to publish a differently-shaped payload for external consumers.
- `event <name> for side effects;` — usable *only* as a side-effect trigger; it does not
  need (and is not meant for) handler classes or event bindings.

The payload contract is a CDS abstract entity:

```
@EndUserText.label: 'Out-of-stock event payload'
define abstract entity ZD_InventoryOutOfStock
{
  product_id : abap.char(10);
  quantity   : abap.dec(13,3);
  plant      : abap.char(4);
}
```

## Raising events — RAISE ENTITY EVENT

Events are raised with the EML statement `RAISE ENTITY EVENT ... FROM`. Raise them in the
**save phase**: for managed BOs, declare `with additional save` (or `with unmanaged save`)
and raise in the saver class `save_modified` method — that way the event describes data that
is actually being committed.

```abap
CLASS lsc_inventory IMPLEMENTATION.

  METHOD save_modified.
    " Event without payload — key only
    IF create-inventory IS NOT INITIAL.
      RAISE ENTITY EVENT zr_inventory~StockCounted
        FROM VALUE #( FOR <created_inventory> IN create-inventory
                      ( %key = <created_inventory>-%key ) ).
    ENDIF.

    " Event with payload — fill %param from the abstract entity's fields
    LOOP AT update-inventory ASSIGNING FIELD-SYMBOL(<updated_inventory>)
         WHERE %control-Quantity = if_abap_behv=>mk-on.
      RAISE ENTITY EVENT zr_inventory~OutOfStock
        FROM VALUE #( ( %key   = <updated_inventory>-%key
                        %param = VALUE #( product_id = <updated_inventory>-ProductID
                                          quantity   = <updated_inventory>-Quantity
                                          plant      = 'WERK' ) ) ).
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
```

The event table type is generated for you: `TYPE TABLE FOR EVENT zr_inventory~OutOfStock`
(rows contain the key components and, if declared, `%param`).

Delivery flow:
1. `RAISE ENTITY EVENT` queues the event inside the RAP transaction.
2. The transaction commits (RAP save sequence completes).
3. Only after a successful commit are local event handler methods called (asynchronously)
   and bound events published externally. A rolled-back transaction publishes nothing.

## Consuming events locally — event handler class

Local consumption needs two classes: a global **RAP event handler class** declared
`FOR EVENTS OF <bdef>`, and a local class in its CCIMP include ("Local Types" tab in ADT)
inheriting from `cl_abap_behavior_event_handler` with the actual handler methods.

```abap
" Global class — the anchor; handler logic lives in the CCIMP include
CLASS zcl_inventory_events DEFINITION
  PUBLIC
  FOR EVENTS OF zr_inventory.
ENDCLASS.

CLASS zcl_inventory_events IMPLEMENTATION.
ENDCLASS.
```

```abap
" CCIMP include (Local Types)
CLASS lhe_inventory DEFINITION
  INHERITING FROM cl_abap_behavior_event_handler.
  PRIVATE SECTION.
    METHODS on_out_of_stock
      FOR ENTITY EVENT out_of_stock_events FOR Inventory~OutOfStock.
ENDCLASS.

CLASS lhe_inventory IMPLEMENTATION.
  METHOD on_out_of_stock.
    LOOP AT out_of_stock_events INTO DATA(out_of_stock_event).
      " out_of_stock_event contains the instance key and %param (payload)
      " e.g. write an application log entry, start follow-up processing
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
```

Rules for handler methods:
- Instance methods in the **private** section, declared
  `FOR ENTITY EVENT <param> FOR <entity>~<event>`.
- The importing parameter is a table (`TYPE TABLE FOR EVENT`) with instance keys and
  `%param` if the event has a payload.
- No RAP response parameters (`failed`/`reported` do not exist here).
- Methods are called **asynchronously** after the commit — never rely on them running inside
  the raising transaction.
- If the handler modifies the database or calls a RAP BO transactionally, set the
  transactional phase explicitly with `cl_abap_tx` (controlled SAP LUW) — handlers do not run
  inside a RAP modify/save phase.

See [references/business-events-reference.md](references/business-events-reference.md) for
the full grammar, delivery details, and patterns.

## Consuming events externally — event binding, Event Mesh, Event Consumption Model

Conceptually (configuration, not code):

1. **Event binding** (ADT: New → Other → Event Binding) maps a RAP event to an *event type*
   / topic. Without a binding, a raised event stays local. Topic shape:
   `<namespace>/<business-object>/<event>/<version>`, e.g. `zcustom/inventory/outofstock/v1`.
2. **Enterprise Event Enablement** publishes bound events to a broker: create a
   communication arrangement for scenario `SAP_COM_0092`, configure the SAP Event Mesh
   instance on BTP, maintain the outbound topic bindings in the Enterprise Event Enablement
   app.
3. **Consumers** subscribe via SAP Event Mesh (webhooks, AMQP), SAP Integration Suite, or —
   for an ABAP system acting as consumer — an **Event Consumption Model** generated in ADT
   from the event's specification, which produces typed artifacts and a consumer class
   skeleton to implement.

Versioning and payload advice: version topics (`/v1`, `/v2`), and put enough data in the
payload that consumers do not need to call back synchronously (that would re-couple what the
event decoupled).

## Business event logging

SAP BTP ABAP Environment also ships a Business Event Logging framework that records raised
business events for later analysis:

- Custom events participate in logging when their abstract event entity carries the
  `@ObjectModel.sapObjectNodeType.name` annotation naming the SAP object node type (SAP-defined
  or customer-defined) the event refers to; add `@Event.sapObjectNodeTypeKey` listing the key
  elements (in the node entity's order) when the node is customer-defined or its key deviates
  from the SAP standard.
- New or changed RAP objects are considered for logging only after the framework's shared
  memory (metadata buffer) is reset — Business Event Logging resets it once a day.
- Log data is accessed via released CDS views for event header data, payload details, and the
  full event payload as JSON (e.g. `C_BUSEVTLOGEVENTDEX_2` / `C_BUSEVTLOGPAYLOADDEX_2` /
  `C_BUEVLGEVTFULLPAYLOADJSONDEX`). These view names carry version suffixes and are superseded
  over time (newer releases ship `_3`-generation successors) — look up the current names in the
  [Business Event Logging](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/business-event-logging-c04117a.md)
  section for your release.

## Side effects in the behavior definition

Side effects declare **UI data dependencies**. No implementation exists or is needed. All
variants live in one block inside the entity behavior body of the base BDEF:

```
side effects
{
  // Trigger: a field changed on the UI → reload another field
  field DiscountPercent affects field TotalPrice;

  // Trigger: any CUD on this entity → reload targets on ASSOCIATED entities
  // (targets of $self must not be fields of the current entity)
  $self affects field _Statistics.TotalCount;

  // Trigger: an action was executed → reload everything + permissions + messages
  action recalculateInventory affects field *,
                                      permissions(action closeInventory),
                                      messages;

  // Trigger: an action → reload the entity itself and an associated entity
  action reject affects $self, entity _Booking;

  // Trigger group: run a determine action when any source field changes
  determine action calculateTotals
    executed on field Quantity,
                field Price,
                field _Item.Amount
    affects field TotalPrice;

  // Trigger: a business event (declared "for side effects") → reload fields
  event QuantityUpdated affects field ( Quantity );
}
```

Triggers (left side): `field`, `$self` (CUD on the entity), `action`, `determine action ...
executed on ...`, `event`. Targets (after `affects`): `field` (one, several, or `field *`;
association paths like `_Assoc.Element` allowed), `entity _Assoc` (grouping variants exist),
`permissions(...)` (feature/authorization control for fields, actions, or standard
operations), `messages`, and `$self` (reload the own entity).

Full trigger/target matrix with all syntax variants:
[references/side-effects-reference.md](references/side-effects-reference.md).

## Enabling side effects in the projection

Side effects only reach the UI if the projection BDEF opts in — at BO level *and*, for
event triggers, at entity level:

```
projection;
strict ( 2 );
use draft;
use side effects;                        // BO level: expose side effects

define behavior for ZC_Inventory alias Inventory
use etag
{
  use action recalculateInventory;       // trigger actions must be exposed
  use event QuantityUpdated;             // event triggers must be exposed

  use create;
  use update;
  use delete;
}
```

Forgetting `use side effects;` (or `use event`) is the most common reason a declared side
effect never fires on the UI.

## How side effects drive Fiori Elements UI refresh

- At activation, the framework translates the BDEF side-effect definitions into OData
  side-effect annotations in the service metadata — the UI needs no custom extension code.
- When the trigger occurs (user leaves a changed field, presses the action button, or the
  bound event arrives), Fiori Elements issues a **read request for exactly the declared
  targets** and re-renders them. `field *` reloads all fields of the instance;
  `permissions(...)` re-evaluates feature control (button enabled/disabled, field editable).
- For `event ... for side effects`, the running Fiori Elements app is notified after the
  event's transaction commits, re-reads the affected fields (e.g. `Quantity`), and shows the
  user a small notification popup — the visible effect is a live UI update after a
  background process finishes.

## Determinations vs side effects vs events

| Aspect | Determination | Side effect | Business event |
|---|---|---|---|
| What it is | ABAP logic in the behavior pool | Declarative BDEF metadata | After-commit notification |
| Changes data | Yes | Never | No (handlers may, in their own LUW) |
| Refreshes UI | No (server-side only) | Yes — that is its whole job | Only via `for side effects` |
| Runs | on modify / on save, inside the LUW | In the UI client, after the trigger | Asynchronously, after commit |
| Implementation | `FOR DETERMINE ON MODIFY/SAVE` method | None | `RAISE ENTITY EVENT` + handler class |
| Failure impact | Can fail the transaction | None (just a read) | None on the raising transaction |

Interplay patterns:
- **Action recalculates a total:** action + determination compute it; a side effect
  `action ... affects field TotalPrice` makes the UI show it. Without the side effect the
  new value sits in the database while the UI shows the stale one.
- **Field dependency:** `determine action` side effect (`executed on field ...`) runs
  server-side derivation *and* reloads the targets in one declaration.
- **Background completion:** saver raises `event ... for side effects`; the side effect
  `event ... affects field (...)` pushes the result to the open UI. The full worked example
  (inventory + bgPF, from SAP's official sample) is in
  [examples/inventory-events-side-effects.md](examples/inventory-events-side-effects.md).

## ABAP Cloud and release availability

- The syntax shown here is the ABAP for Cloud Development / ABAP Cloud language scope —
  BDL `event` and `side effects` are documented in the CLOUD keyword documentation and work
  in SAP BTP ABAP Environment and SAP S/4HANA Cloud Public Edition.
- **Event-driven side effects** (`event ... for side effects`) were released first for SAP
  BTP ABAP Environment and SAP S/4HANA Cloud Public Edition only. Per SAP's own sample
  README (the same
  [abap-platform-bgpf-appl-log-events-side-effects](https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects)
  sample cited below): "We plan to make this available for on premise and private cloud
  systems as of release 2025" — this is a stated intent, not a shipped commitment, so
  verify current availability in ADT's *Released Objects* view and your system's release
  notes before designing for it on-premise, as timing may change.
- **bgPF** (the natural producer of such events) is available for on-premise and private
  cloud SAP S/4HANA as of release 2023 — see
  [abap-background-processing](../abap-background-processing/SKILL.md).
- External eventing (event binding, Enterprise Event Enablement, Event Mesh) requires the
  corresponding BTP service setup and communication arrangement (`SAP_COM_0092`).

## Quick Reference

| Element | Syntax | Notes |
|---|---|---|
| Event, key-only | `event StockCounted;` | Payload = instance key |
| Event with payload | `event OutOfStock parameter ZD_Payload;` | `ZD_Payload` = CDS abstract entity; fills `%param` |
| Deep payload | `event Replicated deep parameter ZD_Hier;` | Abstract BDEF `with hierarchy` required |
| Derived event | `managed event Ext on OutOfStock parameter ZD_Ext;` | Auto-raised with the base event; never raised manually |
| Side-effect event | `event QuantityUpdated for side effects;` | Only usable as side-effect trigger |
| Raise | `RAISE ENTITY EVENT zr_inventory~OutOfStock FROM ...` | In save phase; `%key` + optional `%param` |
| Event table type | `TYPE TABLE FOR EVENT zr_inventory~OutOfStock` | Generated type for the FROM table |
| Handler class (global) | `CLASS zcl_x DEFINITION PUBLIC FOR EVENTS OF zr_inventory.` | Anchor; logic in CCIMP include |
| Handler class (local) | `INHERITING FROM cl_abap_behavior_event_handler` | In CCIMP of the event handler class |
| Handler method | `METHODS m FOR ENTITY EVENT par FOR Inventory~OutOfStock.` | Private, instance, async, no failed/reported |
| Side effect, field | `field A affects field B;` | UI reload of B when A changes |
| Side effect, action | `action act affects field *, messages;` | Also `permissions(...)`, `$self`, `entity _Assoc` |
| Side effect, CUD | `$self affects field _Assoc.X;` | Targets must not be own-entity fields |
| Side effect, determine action | `determine action d executed on field A affects field B;` | Runs determinations + reloads |
| Side effect, event | `event QuantityUpdated affects field ( Quantity );` | Event must be `for side effects` |
| Projection, BO level | `use side effects;` | Header of projection BDEF |
| Projection, entity level | `use event QuantityUpdated;` | Plus `use action ...` for action triggers |
| External publishing | Event binding + `SAP_COM_0092` | Maps event → topic `<ns>/<bo>/<event>/<version>` |
| Transactional phases in handlers | `cl_abap_tx` | Set phase before DB writes in event handlers |

## Common Mistakes

| Wrong | Right |
|---|---|
| Raising an event in an action/determination handler during the interaction phase | Raise in the save phase — `with additional save` and `RAISE ENTITY EVENT` in `save_modified`, so the event matches committed data |
| Expecting the event handler to run synchronously inside the raising transaction | Handlers run asynchronously after a successful commit; design them idempotent and self-contained |
| `side effects { ... }` declared in the base BDEF only — UI never refreshes | Add `use side effects;` to the projection BDEF header and `use event <name>;` / `use action <name>;` at entity level |
| Relying on a determination alone to update the field the user is looking at | Pair the determination with a side effect (`action`/`field`/`determine action` trigger) so the UI reloads the target |
| Writing ABAP to "implement" a side effect | Side effects are purely declarative — there is nothing to implement; put logic in determinations or event handlers |
| `$self affects field OwnField;` on the same entity | Targets of a `$self` trigger may be associated-entity fields only; for own fields use a `field` or `action` trigger |
| Using a `for side effects` event as an integration event (binding, handler class) | `event ... for side effects` exists solely to trigger a side effect; define a separate plain event for consumers |
| Raising a `managed event` (derived event) manually | Derived events are raised automatically when their base event is raised — only raise the base event |
| Declaring handler methods public or static | `FOR ENTITY EVENT` methods must be instance methods in the private section of the local handler class |
| Reading `failed`/`reported` in an event handler method | Event handler methods have no RAP response parameters — log problems (application log) instead |
| Modifying the database in an event handler without setting a transactional phase | Use `cl_abap_tx` (controlled SAP LUW) to set the phase before performing modifications |
| Expecting external systems to receive a raised event with no further setup | Create an event binding and configure Enterprise Event Enablement (`SAP_COM_0092`) / Event Mesh — unbound events stay local |
| Designing event payloads that force consumers to call back for details | Put the business-relevant data in the abstract-entity payload (event-carried state transfer) |

## References

- [references/business-events-reference.md](references/business-events-reference.md) — event grammar, raising, local and external consumption in depth
- [references/side-effects-reference.md](references/side-effects-reference.md) — full trigger/target matrix and Fiori Elements mechanics
- [examples/inventory-events-side-effects.md](examples/inventory-events-side-effects.md) — end-to-end worked example (BDEF + projection + saver + handler)
- **Business Events (RAP development guide):** https://help.sap.com/docs/abap-cloud/abap-rap/business-events
- **Business Event Logging (BTP ABAP Environment):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/business-event-logging-c04117a.md
- **Log Custom Business Events (annotations, metadata-buffer reset):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/log-custom-business-events-6ecc451.md
- **Accessing Business Event Log Data using CDS Views:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/accessing-business-event-log-data-using-cds-views-aedf76d.md
- **Enterprise Event Enablement:** https://help.sap.com/docs/abap-cloud/abap-rap/enterprise-event-enablement
- **BDL `event` (keyword docs):** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenbdl_event.htm
- **BDL `side effects` (keyword docs):** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenbdl_side_effects.htm
- **`RAISE ENTITY EVENT` (keyword docs):** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapraise_entity_event.htm
- **ABAP for RAP Business Events (keyword docs):** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenrap_events.htm
- **SAP-samples/abap-platform-bgpf-appl-log-events-side-effects** — bgPF + event-driven side effects sample: https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects
- **ABAP cheat sheet 36 — RAP Behavior Definition Language:** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/36_RAP_Behavior_Definition_Language.md
- **ABAP cheat sheet 08 — EML/ABAP for RAP:** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/08_EML_ABAP_for_RAP.md
- Linked skills: [rap-bo-modeling](../rap-bo-modeling/SKILL.md), [cds-views-authoring](../cds-views-authoring/SKILL.md), [abap-background-processing](../abap-background-processing/SKILL.md)
