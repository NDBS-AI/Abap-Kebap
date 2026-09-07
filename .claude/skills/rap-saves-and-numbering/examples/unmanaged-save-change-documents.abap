*&---------------------------------------------------------------------*
*& Example: managed BO with unmanaged save — change documents + bgPF
*&
*& Scenario: managed, draft-enabled BO ZR_SalesOrder whose BDEF declares
*& "with unmanaged save": the framework still provides the transactional
*& buffer, locking, and draft orchestration, but save_modified owns all
*& persistence. That ordering control is the point — the classic change
*& document API compares old vs new values, so the change document must
*& be written BEFORE the row is persisted (with additional save the
*& framework has already written by the time save_modified runs).
*&
*& BDEF (excerpt):
*&   managed implementation in class zbp_r_salesorder unique;
*&   strict ( 2 );
*&
*&   define behavior for ZR_SalesOrder alias SalesOrder
*&   //persistent table zsalesorder      <- forbidden with unmanaged save
*&   draft table zdsalesorder
*&   lock master total etag LastChangedAt
*&   etag master LocalLastChangedAt
*&   authorization master ( global )
*&   with unmanaged save
*&   {
*&     ...
*&     mapping for zsalesorder control zsalesorder_x corresponding
*&     { ... }
*&   }
*&
*& zsalesorder_x is the DDIC control ("x-") structure: one abap_boolean
*& per non-key field, mirroring %control in DDIC terms.
*&
*& Modeled on SAP-samples/abap-platform-reuse-services
*& (zreusebp_r_salesordertp_002). Names follow Clean ABAP.
*&---------------------------------------------------------------------*

CLASS lsc_zr_salesorder DEFINITION INHERITING FROM cl_abap_behavior_saver.
  PROTECTED SECTION.
    METHODS save_modified REDEFINITION.
    METHODS cleanup_finalize REDEFINITION.
ENDCLASS.


CLASS lsc_zr_salesorder IMPLEMENTATION.

  METHOD save_modified.

    "--------------------------------------------------------------
    " 1. Change documents — BEFORE persisting, while the database
    "    still holds the old values.
    "    zcl_zsalesorder_chdo is the class generated for the change
    "    document object (Change Document Objects editor in ADT).
    "--------------------------------------------------------------
    LOOP AT update-salesorder INTO DATA(ls_changed_order)
         WHERE %control-OverallStatus = if_abap_behv=>mk-on
            OR %control-TotalAmount   = if_abap_behv=>mk-on.

      SELECT SINGLE salesorder_id, total_amount, currency_code, overall_status FROM zsalesorder
        WHERE salesorder_id = @ls_changed_order-SalesOrderId
        INTO @DATA(ls_sales_order_before_change).

      DATA(ls_sales_order_after_change) = VALUE zsalesorder(
        salesorder_id  = ls_changed_order-SalesOrderId
        total_amount   = ls_changed_order-TotalAmount
        currency_code  = ls_changed_order-CurrencyCode
        overall_status = ls_changed_order-OverallStatus ).

      TRY.
          zcl_zsalesorder_chdo=>write(
            EXPORTING
              objectid                = CONV #( ls_changed_order-SalesOrderId )
              utime                   = CONV #( sy-uzeit )
              udate                   = CONV #( sy-datum )
              username                = CONV #( sy-uname )
              object_change_indicator = 'U'
              o_zsalesorder           = ls_sales_order_before_change
              n_zsalesorder           = ls_sales_order_after_change
              upd_zsalesorder         = 'U'
            IMPORTING
              changenumber            = DATA(lv_change_document_number) ).
        CATCH cx_chdo_write_error INTO DATA(lo_change_document_error).
          " Late save phase: failures are not expected here. If the
          " change document is business-critical, validate the
          " preconditions in check_before_save instead of failing now.
      ENDTRY.

    ENDLOOP.

    "--------------------------------------------------------------
    " 2. Persistence — unmanaged save owns every database write.
    "--------------------------------------------------------------
    DATA lt_new_sales_orders TYPE STANDARD TABLE OF zsalesorder.

    IF create-salesorder IS NOT INITIAL.
      " MAPPING FROM ENTITY: CDS element names -> DDIC column names,
      " driven by the BDEF's "mapping for" block.
      lt_new_sales_orders =
        CORRESPONDING #( create-salesorder MAPPING FROM ENTITY ).
      INSERT zsalesorder FROM TABLE @lt_new_sales_orders.
    ENDIF.

    IF update-salesorder IS NOT INITIAL.
      " INDICATORS SET STRUCTURE %control: only the columns the
      " consumer actually changed are updated.
      UPDATE zsalesorder FROM TABLE @update-salesorder
        INDICATORS SET STRUCTURE %control MAPPING FROM ENTITY.
    ENDIF.

    IF delete-salesorder IS NOT INITIAL.
      LOOP AT delete-salesorder INTO DATA(ls_sales_order_to_delete).
        DELETE FROM zsalesorder
          WHERE salesorder_id = @ls_sales_order_to_delete-SalesOrderId.
      ENDLOOP.
    ENDIF.

    "--------------------------------------------------------------
    " 3. bgPF handoff — follow-up work that needs its own LUW
    "    (e.g. calling an API that commits) must NOT run inside the
    "    RAP transaction. Register it here; the background processing
    "    framework executes it after the RAP commit.
    "    See skill abap-background-processing.
    "--------------------------------------------------------------
    DATA lt_order_ids_for_follow_up TYPE zcl_salesorder_follow_up=>order_id_table.

    LOOP AT update-salesorder INTO ls_changed_order
         WHERE %control-OverallStatus = if_abap_behv=>mk-on.
      APPEND VALUE #( salesorder_id = ls_changed_order-SalesOrderId )
        TO lt_order_ids_for_follow_up.
    ENDLOOP.

    IF lt_order_ids_for_follow_up IS NOT INITIAL.
      DATA(lo_follow_up_operation) =
        NEW zcl_salesorder_follow_up( lt_order_ids_for_follow_up ).
      TRY.
          DATA(lo_background_process) =
            cl_bgmc_process_factory=>get_default( )->create( ).
          lo_background_process->set_operation_tx_uncontrolled( lo_follow_up_operation ).
          lo_background_process->set_name( |Sales order follow-up| ).
          lo_background_process->save_for_execution( ).
        CATCH cx_bgmc INTO DATA(lo_background_error).
          " Handle/log via application log on a secondary connection.
      ENDTRY.
    ENDIF.

  ENDMETHOD.

  METHOD cleanup_finalize.
    " Called only when an earlier saver method failed: undo whatever
    " finalize changed. Nothing to do in this example.
  ENDMETHOD.

ENDCLASS.
