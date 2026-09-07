# Example — Inventory BO with Business Events and Side Effects

End-to-end worked example combining both mechanisms, modeled on SAP's official sample
[abap-platform-bgpf-appl-log-events-side-effects](https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects)
(names adapted, logic condensed). Scenario:

1. The user presses **Calculate inventory** on the Fiori Object Page (action
   `recalculateInventory` sets a status field).
2. The saver detects the status change and starts a background process (bgPF — see the
   abap-background-processing skill).
3. The background process updates `Quantity` via EML; that save raises the side-effect
   event `QuantityUpdated`, and the open UI re-reads `Quantity` automatically.
4. Independently, an `OutOfStock` event with payload notifies a local consumer whenever a
   quantity drops to zero.

## 1. Base behavior definition (`ZR_Inventory.bdef`)

```
managed with additional save implementation in class zbp_r_inventory unique;
strict ( 2 );
with draft;

define behavior for ZR_Inventory alias Inventory
persistent table zinventory
draft table zinventory_d
etag master LocalLastChangedAt
lock master total etag LastChangedAt
authorization master ( global )
{
  field ( readonly )
  InventoryUUID,
  InventoryID,
  Quantity,
  CreatedBy,
  CreatedAt,
  LastChangedBy,
  LastChangedAt,
  LocalLastChangedAt;

  field ( numbering : managed )
  InventoryUUID;

  // ---- Business events ----------------------------------------------------

  // UI-refresh only: usable solely as a side-effect trigger
  event QuantityUpdated for side effects;

  // Integration event with payload (CDS abstract entity)
  event OutOfStock parameter ZD_InventoryOutOfStock;

  // ---- Side effects --------------------------------------------------------

  side effects
  {
    // Background job updated Quantity -> open UI re-reads Quantity
    event QuantityUpdated affects field ( Quantity );

    // Action pressed -> status field and feature control must refresh
    action recalculateInventory affects field ( CalculationStatus ),
                                        permissions( action recalculateInventory );
  }

  action recalculateInventory;

  create;
  update;
  delete;

  draft action Edit;
  draft action Activate optimized;
  draft action Discard;
  draft action Resume;
  draft determine action Prepare;

  determination determineInventoryId on save { create; }
}
```

## 2. Payload abstract entity (`ZD_InventoryOutOfStock.ddls`)

```
@EndUserText.label: 'Out-of-stock event payload'
define abstract entity ZD_InventoryOutOfStock
{
  product_id : abap.char(10);
  quantity   : abap.dec(13,3);
  plant      : abap.char(4);
}
```

## 3. Projection behavior definition (`ZC_Inventory.bdef`)

```
projection;
strict ( 2 );
use draft;
use side effects;

define behavior for ZC_Inventory alias Inventory
use etag
{
  field ( readonly ) Quantity;

  use action recalculateInventory;

  use event QuantityUpdated;

  use create;
  use update;
  use delete;

  use action Edit;
  use action Activate;
  use action Discard;
  use action Resume;
  use action Prepare;
}
```

Both opt-ins matter: `use side effects;` at BO level, `use event QuantityUpdated;` at
entity level. Without them the base-BDEF side effects never reach the Fiori app.

## 4. Behavior pool — saver raising the events (CCIMP include of `zbp_r_inventory`)

```abap
CLASS lsc_inventory DEFINITION
  INHERITING FROM cl_abap_behavior_saver.

  PROTECTED SECTION.
    METHODS save_modified REDEFINITION.

ENDCLASS.


CLASS lsc_inventory IMPLEMENTATION.

  METHOD save_modified.
    DATA lt_quantity_updated_events TYPE TABLE FOR EVENT zr_inventory~QuantityUpdated.

    LOOP AT update-inventory ASSIGNING FIELD-SYMBOL(<fs_updated_inventory>).

      " Start the background calculation when the action set the status
      IF     <fs_updated_inventory>-CalculationStatus          = zcl_inventory_calc=>calculation_state-requested
         AND <fs_updated_inventory>-%control-CalculationStatus = if_abap_behv=>mk-on.
        TRY.
            zcl_inventory_calc=>run_via_bgpf(
              inventory_key = <fs_updated_inventory>-%key ).
          CATCH cx_bgmc INTO DATA(lo_background_error).
            " Log via application log; never let the save dump
        ENDTRY.
      ENDIF.

      " The background process wrote Quantity -> raise the side-effect event
      IF <fs_updated_inventory>-%control-Quantity = if_abap_behv=>mk-on.
        lt_quantity_updated_events = VALUE #(
          ( CORRESPONDING #( <fs_updated_inventory> ) ) ).
        RAISE ENTITY EVENT zr_inventory~QuantityUpdated
          FROM lt_quantity_updated_events.

        " Integration event with payload when stock is exhausted
        IF <fs_updated_inventory>-Quantity = 0.
          RAISE ENTITY EVENT zr_inventory~OutOfStock
            FROM VALUE #(
              ( %key   = <fs_updated_inventory>-%key
                %param = VALUE #(
                  product_id = <fs_updated_inventory>-ProductID
                  quantity   = <fs_updated_inventory>-Quantity
                  plant      = <fs_updated_inventory>-Plant ) ) ).
        ENDIF.
      ENDIF.

    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
```

Notes:
- `with additional save` (base BDEF) means the framework persists to `zinventory` first;
  `save_modified` only adds the event raising and the bgPF start.
- `%control-<Field> = if_abap_behv=>mk-on` limits event raising to saves that actually
  changed the field — without it, every update raises the event.
- The background process itself completes the loop later by updating `Quantity` through a
  plain EML call, which lands in this same `save_modified` in a new transaction:

```abap
MODIFY ENTITIES OF zr_inventory
  ENTITY Inventory
  UPDATE FIELDS ( Quantity )
  WITH lt_quantity_updates
  FAILED   DATA(lt_failed_updates)
  REPORTED DATA(lt_reported_updates).

COMMIT ENTITIES.
```

## 5. Local event consumer for `OutOfStock`

Global RAP event handler class:

```abap
CLASS zcl_inventory_events DEFINITION
  PUBLIC
  FOR EVENTS OF zr_inventory.
ENDCLASS.

CLASS zcl_inventory_events IMPLEMENTATION.
ENDCLASS.
```

Local handler class in its CCIMP include ("Local Types" tab in ADT):

```abap
CLASS lhe_inventory DEFINITION
  INHERITING FROM cl_abap_behavior_event_handler.

  PRIVATE SECTION.
    METHODS on_out_of_stock
      FOR ENTITY EVENT out_of_stock_events FOR Inventory~OutOfStock.

ENDCLASS.


CLASS lhe_inventory IMPLEMENTATION.

  METHOD on_out_of_stock.
    " Runs asynchronously after the raising transaction committed.
    " Set the transactional phase before performing modifications.
    cl_abap_tx=>modify( ).

    LOOP AT out_of_stock_events INTO DATA(ls_out_of_stock_event).
      " Key components:  ls_out_of_stock_event-%key
      " Payload fields:  ls_out_of_stock_event-%param-product_id,
      "                  ls_out_of_stock_event-%param-quantity,
      "                  ls_out_of_stock_event-%param-plant
      " e.g. create a replenishment request, write an application log entry
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
```

`QuantityUpdated` needs **no** handler class: `for side effects` events exist only to
trigger the declared side effect — the framework handles the UI notification.

## What the user sees

- Pressing *Calculate inventory* immediately refreshes `CalculationStatus` and the button's
  enabled state (action side effect).
- When the background job finishes — seconds or minutes later — the `Quantity` field on the
  open Object Page updates by itself and a small popup notifies the user (event-driven side
  effect).
- Meanwhile, the `OutOfStock` consumer runs decoupled in the background whenever stock hits
  zero (business event with payload).
