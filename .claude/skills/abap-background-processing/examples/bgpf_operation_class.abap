*"* Example: bgPF operation class + RAP saver-class trigger
*"* Pattern from SAP-samples/abap-platform-bgpf-appl-log-events-side-effects,
*"* reworked to Clean ABAP (descriptive names, inline declarations).
*"*
*"* Flow:
*"*   1. A RAP action sets a marker field (interaction phase — no scheduling here).
*"*   2. save_modified( ) registers the bgPF process (save phase).
*"*   3. The framework runs if_bgmc_op_single~execute( ) right after COMMIT WORK,
*"*      in its own framework-controlled LUW (controlled scenario: no COMMIT here).

CLASS zcl_recalculate_inventory DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    "! State of this instance is serialized and shipped to the background task —
    "! keep it small: entity keys, not object references.
    INTERFACES if_serializable_object.
    INTERFACES if_bgmc_operation.
    "! Controlled scenario — the framework owns the LUW; execute( ) uses EML only.
    INTERFACES if_bgmc_op_single.
    "! Uncontrolled scenario — only needed when the operation must COMMIT WORK itself.
    INTERFACES if_bgmc_op_single_tx_uncontr.

    TYPES: BEGIN OF inventory_key,
             uuid TYPE sysuuid_x16,
           END OF inventory_key.

    "! Registers this operation as a transactional controlled background process.
    "! Call from the saver class (save_modified) of the RAP business object.
    "! @parameter entity_key             | key of the inventory to recalculate
    "! @parameter process_monitor_string | persist this to query the state later
    CLASS-METHODS start_in_background
      IMPORTING entity_key                    TYPE inventory_key
      RETURNING VALUE(process_monitor_string) TYPE string
      RAISING   cx_bgmc.

    "! Same operation, registered transactional UNCONTROLLED — for wrapped code
    "! that performs its own COMMIT WORK.
    CLASS-METHODS start_in_background_uncontrolled
      IMPORTING entity_key                    TYPE inventory_key
      RETURNING VALUE(process_monitor_string) TYPE string
      RAISING   cx_bgmc.

    METHODS constructor
      IMPORTING entity_key TYPE inventory_key.

  PRIVATE SECTION.
    CONSTANTS quantity_increment TYPE i VALUE 10.

    DATA inventory_uuid TYPE sysuuid_x16.
ENDCLASS.


CLASS zcl_recalculate_inventory IMPLEMENTATION.

  METHOD constructor.
    inventory_uuid = entity_key-uuid.
  ENDMETHOD.

  METHOD start_in_background.
    DATA(process_monitor) = cl_bgmc_process_factory=>get_default(
        )->create(
        )->set_name( |Recalculate inventory|
        )->set_operation( NEW zcl_recalculate_inventory( entity_key = entity_key )
        )->save_for_execution( ).

    " The process becomes real only when the surrounding LUW commits.
    process_monitor_string = process_monitor->to_string( ).
  ENDMETHOD.

  METHOD start_in_background_uncontrolled.
    DATA(process_monitor) = cl_bgmc_process_factory=>get_default(
        )->create(
        )->set_name( |Recalculate inventory (uncontrolled)|
        )->set_operation_tx_uncontrolled(
              NEW zcl_recalculate_inventory( entity_key = entity_key )
        )->save_for_execution( ).

    process_monitor_string = process_monitor->to_string( ).
  ENDMETHOD.

  METHOD if_bgmc_op_single~execute.
    " Controlled scenario: runs after the registering transaction committed,
    " inside a framework-managed LUW. EML only — the framework commits.
    READ ENTITIES OF zr_inventorytp
      ENTITY Inventory
        ALL FIELDS WITH VALUE #( ( %is_draft = if_abap_behv=>mk-off
                                   %key-uuid = inventory_uuid ) )
      RESULT DATA(inventories)
      FAILED DATA(read_failed).

    IF inventories IS INITIAL.
      RETURN.
    ENDIF.

    MODIFY ENTITIES OF zr_inventorytp
      ENTITY Inventory
        UPDATE FIELDS ( Quantity )
        WITH VALUE #( FOR inventory IN inventories
                      ( %is_draft = if_abap_behv=>mk-off
                        uuid      = inventory-uuid
                        Quantity  = inventory-Quantity + quantity_increment ) )
      REPORTED DATA(update_reported)
      FAILED   DATA(update_failed).

    " This EML update triggers a new save cycle of the BO. Its saver class can
    " RAISE ENTITY EVENT <bo>~QuantityUpdated (declared "for side effects" in
    " the BDEF) so the Fiori UI refreshes the Quantity field automatically.
  ENDMETHOD.

  METHOD if_bgmc_op_single_tx_uncontr~execute.
    " Uncontrolled variant: implement when the wrapped code needs its own
    " COMMIT WORK. The framework's transactional guarantees do not apply here.
  ENDMETHOD.

ENDCLASS.


*"* --- Trigger from the RAP saver class (local class in the behavior pool) ---
*"*
*"* CLASS lsc_inventory DEFINITION INHERITING FROM cl_abap_behavior_saver.
*"*   PROTECTED SECTION.
*"*     METHODS save_modified REDEFINITION.
*"* ENDCLASS.
*"*
*"* CLASS lsc_inventory IMPLEMENTATION.
*"*
*"*   METHOD save_modified.
*"*     LOOP AT update-inventory ASSIGNING FIELD-SYMBOL(<updated_inventory>)
*"*          WHERE %control-BgpfStatus = if_abap_behv=>mk-on.
*"*
*"*       TRY.
*"*           DATA(process_monitor_string) =
*"*             zcl_recalculate_inventory=>start_in_background(
*"*                 entity_key = VALUE #( uuid = <updated_inventory>-uuid ) ).
*"*
*"*           " Business data is frozen in the save phase — persist the monitor
*"*           " string with a direct UPDATE on the BO's own database table.
*"*           UPDATE zinventory
*"*             SET bgpf_process_monitor = @process_monitor_string
*"*             WHERE uuid = @<updated_inventory>-uuid.
*"*
*"*         CATCH cx_bgmc INTO DATA(background_error).
*"*           APPEND VALUE #(
*"*               uuid = <updated_inventory>-uuid
*"*               %msg = new_message_with_text(
*"*                          severity = if_abap_behv_message=>severity-error
*"*                          text     = background_error->get_text( ) ) )
*"*             TO reported-inventory.
*"*       ENDTRY.
*"*     ENDLOOP.
*"*   ENDMETHOD.
*"*
*"* ENDCLASS.
*"*
*"* Later, to check whether the background process ran:
*"*   DATA(process_monitor) =
*"*     cl_bgmc_process_factory=>create_monitor_from_string( persisted_string ).
*"*   DATA(process_state) = process_monitor->get_state( ).
