*"* Behavior pool local handler for ZR_SalesOrderTP (CCIMP include, "Local Types" tab).
*"* Companion to zr_salesordertp.bdef — implements every handler kind the BDEF demands:
*"* actions (instance / parameter / factory / static / internal), determinations
*"* (on modify + on save), validations, instance + global feature control, and a precheck.
*"* Patterns follow SAP-samples rap100 / opensAP week3 Travel behavior pools.

CLASS lhc_order DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.

    CONSTANTS:
      BEGIN OF c_order_status,
        open      TYPE c LENGTH 1 VALUE 'O',
        accepted  TYPE c LENGTH 1 VALUE 'A',
        rejected  TYPE c LENGTH 1 VALUE 'X',
        completed TYPE c LENGTH 1 VALUE 'C',
      END OF c_order_status.

    " ---- Actions -----------------------------------------------------------
    METHODS accept_order FOR MODIFY
      IMPORTING keys FOR ACTION Order~acceptOrder RESULT result.

    METHODS reject_order FOR MODIFY
      IMPORTING keys FOR ACTION Order~rejectOrder RESULT result.

    METHODS apply_discount FOR MODIFY
      IMPORTING keys FOR ACTION Order~applyDiscount RESULT result.

    METHODS copy_order FOR MODIFY
      IMPORTING keys FOR ACTION Order~copyOrder.

    METHODS delete_all_completed FOR MODIFY
      IMPORTING keys FOR ACTION Order~deleteAllCompleted.

    METHODS recalculate_total_amount FOR MODIFY
      IMPORTING keys FOR ACTION Order~recalculateTotalAmount.

    " ---- Determinations ------------------------------------------------------
    METHODS set_initial_status FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Order~setInitialStatus.

    METHODS calculate_total_amount FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Order~calculateTotalAmount.

    METHODS calculate_order_id FOR DETERMINE ON SAVE
      IMPORTING keys FOR Order~calculateOrderId.

    " ---- Validations -----------------------------------------------------------
    METHODS validate_customer FOR VALIDATE ON SAVE
      IMPORTING keys FOR Order~validateCustomer.

    METHODS validate_quantity FOR VALIDATE ON SAVE
      IMPORTING keys FOR Order~validateQuantity.

    " ---- Feature control ----------------------------------------------------------
    METHODS get_instance_features FOR INSTANCE FEATURES
      IMPORTING keys REQUEST requested_features FOR Order RESULT result.

    METHODS get_global_features FOR GLOBAL FEATURES
      IMPORTING REQUEST requested_features FOR Order RESULT result.

    " ---- Precheck --------------------------------------------------------------------
    METHODS precheck_update FOR PRECHECK
      IMPORTING entities FOR UPDATE Order.

    " ---- Authorization (stub — see the abap-authorization skill) -----------------------
    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR Order RESULT result.

ENDCLASS.


CLASS lhc_order IMPLEMENTATION.

  METHOD accept_order.
    " Instance action with result [1] $self: modify, re-read, return.
    MODIFY ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        UPDATE FIELDS ( OverallStatus )
        WITH VALUE #( FOR order_key IN keys
                      ( %tky          = order_key-%tky
                        OverallStatus = c_order_status-accepted ) )
      FAILED failed
      REPORTED reported.

    READ ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(lt_accepted_orders).

    result = VALUE #( FOR accepted_order IN lt_accepted_orders
                      ( %tky   = accepted_order-%tky
                        %param = accepted_order ) ).
  ENDMETHOD.


  METHOD reject_order.
    MODIFY ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        UPDATE FIELDS ( OverallStatus )
        WITH VALUE #( FOR order_key IN keys
                      ( %tky          = order_key-%tky
                        OverallStatus = c_order_status-rejected ) )
      FAILED failed
      REPORTED reported.

    READ ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(lt_rejected_orders).

    result = VALUE #( FOR rejected_order IN lt_rejected_orders
                      ( %tky   = rejected_order-%tky
                        %param = rejected_order ) ).
  ENDMETHOD.


  METHOD apply_discount.
    " Action with input parameter: each keys row carries %param-discount_percent.
    DATA lt_orders_for_update TYPE TABLE FOR UPDATE zr_salesordertp.

    DATA(lt_keys_with_valid_discount) = keys.

    " Reject invalid parameter values and drop them from processing.
    LOOP AT lt_keys_with_valid_discount ASSIGNING FIELD-SYMBOL(<fs_invalid_key>)
         WHERE %param-discount_percent IS INITIAL
            OR %param-discount_percent > 100
            OR %param-discount_percent <= 0.
      APPEND VALUE #( %tky = <fs_invalid_key>-%tky ) TO failed-order.
      APPEND VALUE #( %tky = <fs_invalid_key>-%tky
                      %msg = new_message( id       = 'ZSALESORDER_MSG'
                                          number   = '004'
                                          severity = if_abap_behv_message=>severity-error ) )
             TO reported-order.
      DELETE lt_keys_with_valid_discount.
    ENDLOOP.
    CHECK lt_keys_with_valid_discount IS NOT INITIAL.

    READ ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        FIELDS ( DiscountPercent ) WITH CORRESPONDING #( lt_keys_with_valid_discount )
      RESULT DATA(lt_orders).

    LOOP AT lt_orders ASSIGNING FIELD-SYMBOL(<fs_order>).
      DATA(lv_discount_percent) =
        lt_keys_with_valid_discount[ KEY draft %tky = <fs_order>-%tky ]-%param-discount_percent.
      APPEND VALUE #( %tky            = <fs_order>-%tky
                      DiscountPercent = lv_discount_percent ) TO lt_orders_for_update.
    ENDLOOP.

    " The on-modify determination calculateTotalAmount recalculates TotalAmount,
    " because DiscountPercent is one of its trigger fields.
    MODIFY ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        UPDATE FIELDS ( DiscountPercent )
        WITH lt_orders_for_update.

    READ ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        ALL FIELDS WITH CORRESPONDING #( lt_orders )
      RESULT DATA(lt_discounted_orders).

    result = VALUE #( FOR discounted_order IN lt_discounted_orders
                      ( %tky   = discounted_order-%tky
                        %param = discounted_order ) ).
  ENDMETHOD.


  METHOD copy_order.
    " Factory action: no RESULT parameter — output travels through mapped.
    DATA lt_new_orders TYPE TABLE FOR CREATE zr_salesordertp.

    " Factory actions require a %cid per requested new instance.
    READ TABLE keys WITH KEY %cid = '' INTO DATA(ls_key_without_cid).
    ASSERT ls_key_without_cid IS INITIAL.

    READ ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(lt_source_orders)
      FAILED failed.

    LOOP AT lt_source_orders ASSIGNING FIELD-SYMBOL(<fs_source_order>).
      APPEND VALUE #( %cid      = keys[ KEY entity %key = <fs_source_order>-%key ]-%cid
                      %is_draft = keys[ KEY entity %key = <fs_source_order>-%key ]-%param-%is_draft
                      %data     = CORRESPONDING #( <fs_source_order> EXCEPT OrderId ) )
             TO lt_new_orders ASSIGNING FIELD-SYMBOL(<fs_new_order>).
      " Copies start over: open status, no discount yet.
      <fs_new_order>-OverallStatus   = c_order_status-open.
      <fs_new_order>-DiscountPercent = 0.
    ENDLOOP.

    MODIFY ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        CREATE FIELDS ( CustomerId OrderQuantity UnitPrice DiscountPercent
                        CurrencyCode OverallStatus )
        WITH lt_new_orders
      MAPPED DATA(lt_mapped_create).

    mapped-order = lt_mapped_create-order.
  ENDMETHOD.


  METHOD delete_all_completed.
    " Static action: not bound to an instance — operates on the whole entity.
    " EML has no "read all instances" statement, so the candidate key list
    " below still comes from the database — but each candidate's live
    " status is then read through the RAP buffer (READ ENTITIES), not the
    " raw table, so orders completed earlier in this same transaction are
    " correctly picked up even though their database row is not yet updated.
    DATA lt_completed_order_keys TYPE TABLE FOR DELETE zr_salesordertp.

    SELECT order_uuid FROM zsalesorder
      INTO TABLE @DATA(lt_candidate_order_uuids).

    " No FAILED clause: if a candidate was deleted between the SELECT above and this
    " READ ENTITIES (concurrent delete), it is simply absent from lt_all_orders and so
    " excluded from the completed-order filter below - nothing to report, it just
    " means fewer rows to delete.
    READ ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        FIELDS ( OverallStatus )
        WITH VALUE #( FOR candidate_uuid IN lt_candidate_order_uuids
                      ( OrderUuid = candidate_uuid-order_uuid ) )
      RESULT DATA(lt_all_orders).

    lt_completed_order_keys = VALUE #( FOR order IN lt_all_orders
                                    WHERE ( OverallStatus = c_order_status-completed )
                                    ( %tky = order-%tky ) ).

    IF lt_completed_order_keys IS INITIAL.
      APPEND VALUE #( %msg = new_message( id       = 'ZSALESORDER_MSG'
                                          number   = '005'
                                          severity = if_abap_behv_message=>severity-information ) )
             TO reported-order.
      RETURN.
    ENDIF.

    MODIFY ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        DELETE FROM lt_completed_order_keys
      FAILED failed
      REPORTED reported.
  ENDMETHOD.


  METHOD recalculate_total_amount.
    " Internal action: the reusable calculation, callable only from inside the BO.
    READ ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        FIELDS ( OrderQuantity UnitPrice DiscountPercent )
        WITH CORRESPONDING #( keys )
      RESULT DATA(lt_orders).

    LOOP AT lt_orders ASSIGNING FIELD-SYMBOL(<fs_order>).
      <fs_order>-TotalAmount = <fs_order>-OrderQuantity * <fs_order>-UnitPrice
                            * ( 100 - <fs_order>-DiscountPercent ) / 100.
    ENDLOOP.

    " Writes TotalAmount (readonly, NOT a trigger field) — no self-trigger loop.
    MODIFY ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        UPDATE FIELDS ( TotalAmount )
        WITH CORRESPONDING #( lt_orders ).
  ENDMETHOD.


  METHOD set_initial_status.
    " On-modify determination: default a field on create.
    READ ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        FIELDS ( OverallStatus ) WITH CORRESPONDING #( keys )
      RESULT DATA(lt_orders).

    " Skip instances that already have a status — idempotent, loop-safe.
    DELETE lt_orders WHERE OverallStatus IS NOT INITIAL.
    CHECK lt_orders IS NOT INITIAL.

    MODIFY ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        UPDATE FIELDS ( OverallStatus )
        WITH VALUE #( FOR order IN lt_orders
                      ( %tky          = order-%tky
                        OverallStatus = c_order_status-open ) )
      REPORTED DATA(lt_update_reported).

    reported = CORRESPONDING #( DEEP lt_update_reported ).
  ENDMETHOD.


  METHOD calculate_total_amount.
    " On-modify determination delegating to the internal action.
    MODIFY ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        EXECUTE recalculateTotalAmount
        FROM CORRESPONDING #( keys )
      REPORTED DATA(lt_execute_reported).

    reported = CORRESPONDING #( DEEP lt_execute_reported ).
  ENDMETHOD.


  METHOD calculate_order_id.
    " On-save determination (runs during finalize): human-readable id,
    " drawn from a number range object — see rap-saves-and-numbering's
    " late-numbering-adjust-numbers.abap for the equivalent adjust_numbers pattern.
    READ ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        FIELDS ( OrderId ) WITH CORRESPONDING #( keys )
      RESULT DATA(lt_orders).

    DELETE lt_orders WHERE OrderId IS NOT INITIAL.
    CHECK lt_orders IS NOT INITIAL.

    TRY.
        cl_numberrange_runtime=>number_get(
          EXPORTING
            nr_range_nr       = '01'
            object            = 'ZSALESORD'
            quantity          = CONV #( lines( lt_orders ) )
          IMPORTING
            number            = DATA(lv_number_range_key)
            returned_quantity = DATA(lv_returned_quantity) ).
      CATCH cx_number_ranges INTO DATA(lo_number_range_error).
        " Number range exhaustion/misconfiguration is a business failure here,
        " not a program error: report it instead of raising a shortdump.
        APPEND VALUE #( %tky = lt_orders[ 1 ]-%tky
                        %msg = new_message_with_text(
                                 severity = if_abap_behv_message=>severity-error
                                 text     = lo_number_range_error->get_text( ) ) )
               TO reported-order.
        RETURN.
    ENDTRY.

    DATA(lv_next_order_id) = CONV zsalesorder_id( lv_number_range_key - lv_returned_quantity ).

    MODIFY ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        UPDATE FROM VALUE #( FOR order IN lt_orders INDEX INTO order_index (
                     %tky             = order-%tky
                     OrderId          = ( lv_next_order_id + order_index )
                     %control-OrderId = if_abap_behv=>mk-on ) )
      REPORTED DATA(lt_update_reported).

    reported = CORRESPONDING #( DEEP lt_update_reported ).
  ENDMETHOD.


  METHOD validate_customer.
    READ ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        FIELDS ( CustomerId ) WITH CORRESPONDING #( keys )
      RESULT DATA(lt_orders).

    DATA lt_customer_ids TYPE SORTED TABLE OF zcustomer WITH UNIQUE KEY customer_id.
    lt_customer_ids = CORRESPONDING #( lt_orders DISCARDING DUPLICATES
                                    MAPPING customer_id = CustomerId EXCEPT * ).
    DELETE lt_customer_ids WHERE customer_id IS INITIAL.

    IF lt_customer_ids IS NOT INITIAL.
      SELECT FROM zcustomer FIELDS customer_id
        FOR ALL ENTRIES IN @lt_customer_ids
        WHERE customer_id = @lt_customer_ids-customer_id
        INTO TABLE @DATA(lt_existing_customers).
    ENDIF.

    LOOP AT lt_orders INTO DATA(ls_order).
      " Clear this validation's previous draft state messages first.
      APPEND VALUE #( %tky        = ls_order-%tky
                      %state_area = 'VALIDATE_CUSTOMER' ) TO reported-order.

      IF ls_order-CustomerId IS INITIAL
         OR NOT line_exists( lt_existing_customers[ customer_id = ls_order-CustomerId ] ).
        APPEND VALUE #( %tky = ls_order-%tky ) TO failed-order.
        APPEND VALUE #( %tky                = ls_order-%tky
                        %state_area         = 'VALIDATE_CUSTOMER'
                        %msg                = new_message( id       = 'ZSALESORDER_MSG'
                                                           number   = '001'
                                                           severity = if_abap_behv_message=>severity-error
                                                           v1       = ls_order-CustomerId )
                        %element-CustomerId = if_abap_behv=>mk-on ) TO reported-order.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


  METHOD validate_quantity.
    READ ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        FIELDS ( OrderQuantity ) WITH CORRESPONDING #( keys )
      RESULT DATA(lt_orders).

    LOOP AT lt_orders INTO DATA(ls_order).
      APPEND VALUE #( %tky        = ls_order-%tky
                      %state_area = 'VALIDATE_QUANTITY' ) TO reported-order.

      IF ls_order-OrderQuantity <= 0.
        APPEND VALUE #( %tky = ls_order-%tky ) TO failed-order.
        APPEND VALUE #( %tky                   = ls_order-%tky
                        %state_area            = 'VALIDATE_QUANTITY'
                        %msg                   = new_message( id       = 'ZSALESORDER_MSG'
                                                              number   = '002'
                                                              severity = if_abap_behv_message=>severity-error )
                        %element-OrderQuantity = if_abap_behv=>mk-on ) TO reported-order.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


  METHOD get_instance_features.
    " One method serves every "features : instance" declaration of the entity.
    READ ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        FIELDS ( OverallStatus ) WITH CORRESPONDING #( keys )
      RESULT DATA(lt_orders)
      FAILED failed.

    result = VALUE #(
      FOR order IN lt_orders
        LET accept_state = COND #( WHEN order-OverallStatus = c_order_status-accepted
                                   THEN if_abap_behv=>fc-o-disabled
                                   ELSE if_abap_behv=>fc-o-enabled )
            reject_state = COND #( WHEN order-OverallStatus = c_order_status-rejected
                                   THEN if_abap_behv=>fc-o-disabled
                                   ELSE if_abap_behv=>fc-o-enabled )
            discount_editability = COND #( WHEN order-OverallStatus = c_order_status-accepted
                                             OR order-OverallStatus = c_order_status-completed
                                           THEN if_abap_behv=>fc-f-read_only
                                           ELSE if_abap_behv=>fc-f-unrestricted )
        IN ( %tky                   = order-%tky
             %action-acceptOrder    = accept_state
             %action-rejectOrder    = reject_state
             %field-DiscountPercent = discount_editability ) ).
  ENDMETHOD.


  METHOD get_global_features.
    " Global feature control: state-independent, result is a structure.
    " Demo rule: mass deletion only outside business hours.
    DATA(lv_current_time) = cl_abap_context_info=>get_system_time( ).

    result = VALUE #( %action-deleteAllCompleted =
                        COND #( WHEN lv_current_time BETWEEN '180000' AND '235959'
                                THEN if_abap_behv=>fc-o-enabled
                                ELSE if_abap_behv=>fc-o-disabled ) ).
  ENDMETHOD.


  METHOD precheck_update.
    " Runs BEFORE the update reaches the transactional buffer.
    " entities carries the incoming values including %control — reject attempts
    " to change the customer of an already accepted order.
    READ ENTITIES OF zr_salesordertp IN LOCAL MODE
      ENTITY Order
        FIELDS ( OverallStatus ) WITH CORRESPONDING #( entities )
      RESULT DATA(lt_current_orders).

    LOOP AT entities INTO DATA(ls_entity)
         WHERE %control-CustomerId = if_abap_behv=>mk-on.
      DATA(ls_current_order) = VALUE #( lt_current_orders[ KEY draft %tky = ls_entity-%tky ] OPTIONAL ).

      IF ls_current_order-OverallStatus = c_order_status-accepted.
        " Row in failed-order = this instance is dropped from the update request.
        APPEND VALUE #( %tky = ls_entity-%tky ) TO failed-order.
        APPEND VALUE #( %tky                = ls_entity-%tky
                        %msg                = new_message( id       = 'ZSALESORDER_MSG'
                                                           number   = '003'
                                                           severity = if_abap_behv_message=>severity-error )
                        %element-CustomerId = if_abap_behv=>mk-on ) TO reported-order.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


  METHOD get_global_authorizations.
    " Authorization handlers are covered in the abap-authorization skill.
  ENDMETHOD.

ENDCLASS.
