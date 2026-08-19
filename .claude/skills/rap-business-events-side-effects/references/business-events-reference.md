# RAP Business Events — Deep Dive

Everything about defining, raising, and consuming RAP business events. Companion to the
main [SKILL.md](../SKILL.md); side effects are covered in
[side-effects-reference.md](side-effects-reference.md).

## What a business event is

- A RAP business event typically represents information about the **outcome of a
  create/update/delete operation** (or an action) on a RAP BO instance.
- It enables **asynchronous communication** between an event provider (the RAP BO) and one
  or more event consumers. Consumers subscribe; they receive and process events after the
  fact.
- The information passed — the **event payload** — always includes the instance key and,
  optionally, additional data declared via a CDS abstract entity parameter.
- Events are transactional-outcome messages: they are only delivered after the raising
  transaction commits successfully. A rollback discards queued events.

## Definition grammar (BDEF)

All event declarations appear in the entity behavior body of the base behavior definition:

```
event evt1;
event evt2 parameter SOME_ENTITY;
event evt3 deep parameter SOME_ENTITY;

managed event evt4 on evt1 parameter SOME_ENTITY;

event evt5 for side effects;
```

| Variant | Meaning |
|---|---|
| `event evt1;` | No payload beyond the instance key |
| `event evt2 parameter E;` | Payload = fields of CDS abstract entity `E`, transported in `%param` |
| `event evt3 deep parameter E;` | Hierarchical (deep) payload; `E` must belong to an abstract BDEF declared `with hierarchy` |
| `managed event evt4 on evt1 parameter E;` | **Derived event** — automatically raised whenever `evt1` is raised, with a redefined payload; never raised manually |
| `event evt5 for side effects;` | Usable **only** as the trigger of a RAP side effect (see [side-effects-reference.md](side-effects-reference.md)) |

### Payload abstract entity

```
@EndUserText.label: 'Out-of-stock event payload'
define abstract entity ZD_InventoryOutOfStock
{
  product_id : abap.char(10);
  quantity   : abap.dec(13,3);
  plant      : abap.char(4);
}
```

Design guidance:
- Use abstract entities as the payload type — they make the event contract explicit and
  reusable.
- Include enough business data that consumers do not need a synchronous callback into the
  producing system ("event-carried state transfer"). Calling back re-couples what the event
  was supposed to decouple.
- For derived events (`managed event ... on ...`), shape the payload for the external
  audience (stable field names, no internal technical fields).

## Raising events

### Statement

```abap
RAISE ENTITY EVENT <bdef>~<event> FROM <event table>.
```

The `FROM` table has the generated type `TYPE TABLE FOR EVENT <bdef>~<event>`; each row
contains the key components (via `%key`) and — if the event declares a parameter — `%param`.

```abap
" Key only
RAISE ENTITY EVENT zr_inventory~StockCounted
  FROM VALUE #( FOR <created_inventory> IN create-inventory
                ( %key = <created_inventory>-%key ) ).

" With payload
RAISE ENTITY EVENT zr_inventory~OutOfStock
  FROM VALUE #( ( %key   = updated_inventory-%key
                  %param = VALUE #( product_id = updated_inventory-ProductID
                                    quantity   = updated_inventory-Quantity
                                    plant      = 'WERK' ) ) ).
```

Or with an explicitly typed table (pattern from SAP's bgPF sample):

```abap
DATA events_to_be_raised TYPE TABLE FOR EVENT zr_inventory~QuantityUpdated.

IF updated_inventory-%control-Quantity = if_abap_behv=>mk-on.
  events_to_be_raised = VALUE #( ( CORRESPONDING #( updated_inventory ) ) ).
  RAISE ENTITY EVENT zr_inventory~QuantityUpdated FROM events_to_be_raised.
ENDIF.
```

### Where to raise

- Events are typically raised in ABAP behavior pools **during the RAP late save**.
- For **managed** RAP BOs, declare the BO `with additional save` and raise events in the
  saver class's `save_modified` method. The framework persists first; your `save_modified`
  then sees exactly what is being committed (`create-<entity>`, `update-<entity>`,
  `delete-<entity>` tables with `%control` flags) and can raise matching events.
- For **unmanaged save**, raise in `save_modified` alongside your own persistence.
- Use `%control-<Field> = if_abap_behv=>mk-on` to raise only when the relevant field was
  actually changed (e.g. raise `QuantityUpdated` only when `Quantity` was written).
- Raising in interaction-phase handlers (actions, determinations) is the wrong place: the
  transaction may still fail or be rolled back, and the event would describe uncommitted
  state.

### Delivery semantics

1. `RAISE ENTITY EVENT` registers the event within the current RAP transaction.
2. The RAP save sequence completes and the transaction commits.
3. After a **successful** commit:
   - local event handler methods are invoked **asynchronously**;
   - events with an event binding are published to the configured broker (e.g. SAP Event
     Mesh);
   - derived events (`managed event ... on ...`) are raised automatically alongside their
     base event.

## Local consumption — RAP event handler class

Two-layer structure, mirroring how behavior pools work:

### 1. Global event handler class (the anchor)

```abap
CLASS zcl_inventory_events DEFINITION
  PUBLIC
  FOR EVENTS OF zr_inventory.
ENDCLASS.

CLASS zcl_inventory_events IMPLEMENTATION.
ENDCLASS.
```

`FOR EVENTS OF <bdef>` ties the class to the behavior definition whose events it consumes.
The class body stays empty — the logic lives in the CCIMP include.

### 2. Local handler class in the CCIMP include ("Local Types" in ADT)

```abap
CLASS lhe_inventory DEFINITION
  INHERITING FROM cl_abap_behavior_event_handler.
  PRIVATE SECTION.
    METHODS on_out_of_stock
      FOR ENTITY EVENT out_of_stock_events FOR Inventory~OutOfStock.

    METHODS on_stock_counted
      FOR ENTITY EVENT stock_counted_events FOR Inventory~StockCounted.
ENDCLASS.

CLASS lhe_inventory IMPLEMENTATION.

  METHOD on_out_of_stock.
    LOOP AT out_of_stock_events INTO DATA(out_of_stock_event).
      " Instance key: out_of_stock_event-%key components
      " Payload:      out_of_stock_event-%param (abstract entity fields)
    ENDLOOP.
  ENDMETHOD.

  METHOD on_stock_counted.
    " Key-only event: rows contain just the instance keys
  ENDMETHOD.

ENDCLASS.
```

Method rules (all enforced by the compiler or the framework):
- Instance methods, **private** visibility section.
- Signature: `METHODS <name> FOR ENTITY EVENT <param> FOR <entity>~<event>.`
- `<param>` is an internal table of `TYPE TABLE FOR EVENT`, containing instance keys and
  `%param` if the event has a parameter.
- **No RAP response parameters** — there is no `failed`/`reported`/`mapped` here.
- Called **asynchronously** after the raising transaction commits.

### Transactional behavior inside handlers

Event handler methods run outside the raising RAP transaction. If the handler performs
database modifications or transactional EML, set the transactional phase explicitly with
the released class `cl_abap_tx` (controlled SAP LUW):

```abap
METHOD on_out_of_stock.
  cl_abap_tx=>modify( ).
  " ... perform database modifications / EML MODIFY + COMMIT ENTITIES ...
ENDMETHOD.
```

Make handlers **idempotent** — delivery guarantees mean a consumer must tolerate seeing an
event more than once without corrupting data.

## External consumption — event binding, Enterprise Event Enablement, Event Mesh

Raised events remain system-local until you bind them.

### Event binding

ADT: *New → Other → Event Binding*. The binding maps a RAP event to an **event type** with a
topic:

| Property | Example |
|---|---|
| Namespace | `zcustom` (or `sap.s4.beh` for SAP-delivered) |
| Business object | `Inventory` |
| Event | `OutOfStock` |
| Topic | `zcustom/inventory/outofstock/v1` |

Topic structure: `<namespace>/<business-object>/<event-name>/<version>`. Version topics
(`/v1`, `/v2`) so payload changes stay backward compatible.

### Enterprise Event Enablement (producer side)

1. Create a communication arrangement for scenario **`SAP_COM_0092`** (Enterprise Event
   Enablement).
2. Configure the SAP Event Mesh service instance on SAP BTP.
3. Maintain the channel and activate outbound topic bindings in the **Enterprise Event
   Enablement** app.

After that, every commit that raises a bound event publishes a message to the broker.

### Consumer side

- **Non-ABAP consumers:** subscribe via SAP Event Mesh (webhook or AMQP) or route through
  SAP Integration Suite.
- **ABAP consumers:** generate an **Event Consumption Model** in ADT from the event
  specification. The wizard creates typed artifacts (including abstract entities matching
  the payload) and a consumer class skeleton in which you implement the reaction. Treat the
  generated model as the contract; regenerate when the producer publishes a new version.

## Patterns

| Pattern | How |
|---|---|
| Fire and forget | Raise; consumers process independently; no response expected |
| Event-carried state transfer | Put the full relevant entity state into `%param` so consumers never call back |
| Audit trail | Key-only events + consumer that writes an application log |
| External payload adaptation | Internal `event` + `managed event ... on ...` with an external-friendly payload |
| UI push after background work | `event ... for side effects` + side effect — see [side-effects-reference.md](side-effects-reference.md) |

## Checklist

- [ ] Event named for a business fact in past tense semantics (`OutOfStock`,
      `QuantityUpdated`), not a technical operation.
- [ ] Payload abstract entity defined and referenced via `parameter` where consumers need
      data.
- [ ] Raised in the save phase (`with additional save` + `save_modified` for managed BOs).
- [ ] `%control` checked so events fire only for relevant field changes.
- [ ] Local handler: global class `FOR EVENTS OF`, local class inheriting
      `cl_abap_behavior_event_handler`, private instance methods.
- [ ] `cl_abap_tx` phase set before database modifications in handlers.
- [ ] Event binding + `SAP_COM_0092` configured for external delivery; topics versioned.
