*&---------------------------------------------------------------------*
*& Example: late numbering — adjust_numbers for a root + child RAP BO
*&
*& Scenario: managed BO ZR_SalesOrder (alias SalesOrder) with child
*& entity ZR_SalesOrderItem (alias Item). The BDEF declares
*& "late numbering" on both entities, so final keys are assigned here,
*& in the late save phase, just before the database write.
*&
*& BDEF (root entity, excerpt):
*&   define behavior for ZR_SalesOrder alias SalesOrder
*&   persistent table zsalesorder
*&   late numbering
*&   ...
*&   { field ( readonly ) SalesOrderId; ... }
*&
*& Contract recap:
*&   - On entry, preliminary key values sit in %tmp, preliminary IDs in
*&     %pid; %pre = %pid + %tmp covers both.
*&   - For every row of mapped-<entity>, map %pre to the final key
*&     (assign the key fields directly on the mapped row).
*&   - The number range API commits on a secondary DB connection, which
*&     is why it is legal inside the save sequence.
*&
*& Modeled on SAP-samples/abap-platform-reuse-services
*& (zreusebp_r_salesordertp_002) and the abap-cheat-sheets late
*& numbering demo (zbp_demo_abap_rap_draft_m). Names follow Clean ABAP.
*&---------------------------------------------------------------------*

CLASS lsc_zr_salesorder DEFINITION INHERITING FROM cl_abap_behavior_saver.
  PROTECTED SECTION.
    METHODS adjust_numbers REDEFINITION.
ENDCLASS.


CLASS lsc_zr_salesorder IMPLEMENTATION.

  " Pre-check number-range *availability* earlier in the save sequence
  " (finalize / check_before_save) wherever possible, so the CATCH below
  " is reached only for a truly exceptional, unrecoverable condition --
  " not for an ordinary, foreseeable "range exhausted" business failure.
  METHOD adjust_numbers.

    "--------------------------------------------------------------
    " Root entity: draw final IDs from a number range object
    "--------------------------------------------------------------
    IF mapped-salesorder IS NOT INITIAL.

      TRY.
          cl_numberrange_runtime=>number_get(
            EXPORTING
              nr_range_nr       = '01'
              object            = 'ZSALESORD'
              quantity          = CONV #( lines( mapped-salesorder ) )
            IMPORTING
              number            = DATA(number_range_key)
              returned_quantity = DATA(returned_quantity) ).
        CATCH cx_number_ranges INTO DATA(number_range_error).
          " The late save phase is the point of no return: under the
          " default saver base class CL_ABAP_BEHAVIOR_SAVER, adjust_numbers
          " has no "failed"/"reported" parameters, so a caught error here
          " cannot flow back to the interaction phase as an ordinary
          " business failure. SAP's own reuse-services sample this file is
          " modeled on (SAP-samples/abap-platform-reuse-services,
          " zreusebp_r_salesordertp_002) raises this identical shortdump
          " for this identical failure -- terminating hard is the
          " documented pattern at this exact point, not a shortcut.
          "
          " A documented escape hatch exists: CL_ABAP_BEHAVIOR_SAVER_FAILED
          " is a *base class* the local saver class would have to inherit
          " from INSTEAD OF CL_ABAP_BEHAVIOR_SAVER (it is not an exception
          " type -- "RAISE EXCEPTION TYPE cl_abap_behavior_saver_failed"
          " does not compile), which then exposes failed/reported inside
          " adjust_numbers too. SAP's ABAP Keyword Documentation reserves
          " it "for exceptional cases only, as there is a risk of data
          " inconsistency when multiple RAP BOs are involved" (its own
          " example: BAPIs that internally save *other* RAP BO instances
          " during the late phase) -- and it still requires the consumer
          " to issue ROLLBACK ENTITIES to recover. Prefer preventing the
          " failure (see the note above adjust_numbers) over routing an
          " ordinary, foreseeable condition through that mechanism.
          RAISE SHORTDUMP TYPE cx_number_ranges
            EXPORTING
              previous = number_range_error.
      ENDTRY.

      ASSERT returned_quantity = lines( mapped-salesorder ).

      " number_get returns the LAST drawn number; walk up from the first.
      DATA(next_sales_order_id) =
        CONV zsalesorder_id( number_range_key - returned_quantity ).

      LOOP AT mapped-salesorder ASSIGNING FIELD-SYMBOL(<sales_order>).
        next_sales_order_id += 1.
        " %pre (= %pid + %tmp) -> final key in %key
        <sales_order>-SalesOrderId = next_sales_order_id.
      ENDLOOP.

    ENDIF.

    "--------------------------------------------------------------
    " Child entity: inherit the parent's freshly assigned key, then
    " number the items per parent
    "--------------------------------------------------------------
    IF mapped-item IS NOT INITIAL.

      " Items created under a parent that was itself created in this
      " transaction carry no parent key yet (%tmp-SalesOrderId is
      " initial). Resolve the parent via the association LINK table,
      " addressing both sides by their preliminary identifiers.
      READ ENTITIES OF zr_salesorder IN LOCAL MODE
        ENTITY Item BY \_SalesOrder
          FROM VALUE #( FOR item IN mapped-item
                        WHERE ( %tmp-SalesOrderId IS INITIAL )
                        ( %pid = item-%pid
                          %key = item-%tmp ) )
        LINK DATA(item_to_parent_links).

      LOOP AT mapped-item ASSIGNING FIELD-SYMBOL(<item>).
        <item>-SalesOrderId =
          COND #( WHEN <item>-%tmp-SalesOrderId IS INITIAL
                  THEN mapped-salesorder[
                         %pid = item_to_parent_links[
                                  source-%pid = <item>-%pid ]-target-%pid
                       ]-SalesOrderId
                  ELSE <item>-%tmp-SalesOrderId ).
      ENDLOOP.

      " Item numbers continue per parent from the highest persisted one.
      LOOP AT mapped-item INTO DATA(mapped_item)
           GROUP BY mapped_item-SalesOrderId.

        SELECT MAX( item_id )
          FROM zsalesorderitem
          WHERE salesorder_id = @mapped_item-SalesOrderId
          INTO @DATA(highest_item_id).

        LOOP AT GROUP mapped_item ASSIGNING <item>.
          highest_item_id += 10.
          <item>-ItemId = highest_item_id.
        ENDLOOP.

      ENDLOOP.

    ENDIF.

  ENDMETHOD.

ENDCLASS.

*&---------------------------------------------------------------------*
*& Minimal variant (from the abap-cheat-sheets "RAP calculator" demo):
*& when the key field has a 16-character byte-like UUID type, the %pid
*& value itself is already a valid, unique final key.
*&
*&   METHOD adjust_numbers.
*&     LOOP AT mapped-calc ASSIGNING FIELD-SYMBOL(<calculation>).
*&       <calculation>-%key-id = <calculation>-%pid.
*&     ENDLOOP.
*&   ENDMETHOD.
*&---------------------------------------------------------------------*
