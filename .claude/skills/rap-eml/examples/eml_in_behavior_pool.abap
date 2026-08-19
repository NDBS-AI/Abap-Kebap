*&---------------------------------------------------------------------*
*& EML inside a behavior pool (CCIMP include / "Local Types" tab)
*&
*& Shows the ABP-side patterns: IN LOCAL MODE reads and writes,
*& filling failed/reported (with %tky, %msg, %element, %fail-cause),
*& a determination, and an action that returns a result via %param.
*&
*& Generic managed BO assumed: root entity Z_R_Customer, alias
*& Customer, key CustomerId, fields Name, City, Blocked,
*& LastChangedAt; BDEF declares:
*&   validation validate_name on save { create; update; }
*&   determination set_audit_fields on save { create; update; }
*&   action ( features : instance ) block result [1] $self;
*& Adapt names to your BO — the EML statement forms are the point.
*&---------------------------------------------------------------------*
CLASS lhc_customer DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS validate_name FOR VALIDATE ON SAVE
      IMPORTING keys FOR Customer~validate_name.

    METHODS set_audit_fields FOR DETERMINE ON SAVE
      IMPORTING keys FOR Customer~set_audit_fields.

    METHODS block FOR MODIFY
      IMPORTING keys FOR ACTION Customer~block RESULT result.

ENDCLASS.


CLASS lhc_customer IMPLEMENTATION.

  METHOD validate_name.
    "--------------------------------------------------------------
    " READ ... IN LOCAL MODE:
    " - keys contains only key components — never assume data
    "   fields are present; read what you need explicitly.
    " - IN LOCAL MODE suppresses feature control, authorization
    "   checks, and prechecks: the BO trusts its own access.
    "--------------------------------------------------------------
    READ ENTITIES OF z_r_customer IN LOCAL MODE
      ENTITY Customer
      FIELDS ( Name )
      WITH CORRESPONDING #( keys )
      RESULT DATA(customers).

    LOOP AT customers ASSIGNING FIELD-SYMBOL(<customer>).
      IF strlen( <customer>-Name ) < 3.
        "failed: identifies the rejected instance via %tky
        APPEND VALUE #( %tky = <customer>-%tky ) TO failed-customer.

        "reported: message for the consumer/UI.
        " - %msg carries the message object
        " - %element-Name marks the field so a UI can highlight it
        APPEND VALUE #( %tky          = <customer>-%tky
                        %msg          = new_message(
                                          id       = 'ZCUST_MSG'
                                          number   = '001'
                                          severity = if_abap_behv_message=>severity-error
                                          v1       = <customer>-Name )
                        %element-Name = if_abap_behv=>mk-on )
               TO reported-customer.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


  METHOD set_audit_fields.
    "--------------------------------------------------------------
    " MODIFY ... IN LOCAL MODE:
    " LastChangedAt is typically readonly for consumers — only
    " IN LOCAL MODE lets the BO itself write it.
    "--------------------------------------------------------------
    MODIFY ENTITIES OF z_r_customer IN LOCAL MODE
      ENTITY Customer
      UPDATE FIELDS ( LastChangedAt )
      WITH VALUE #( FOR <changed_customer> IN keys
                    ( %tky          = <changed_customer>-%tky
                      LastChangedAt = utclong_current( ) ) )
      REPORTED DATA(reported_update).

    "Propagate messages of the internal modify, if any
    LOOP AT reported_update-customer ASSIGNING FIELD-SYMBOL(<reported_line>).
      APPEND <reported_line> TO reported-customer.
    ENDLOOP.
  ENDMETHOD.


  METHOD block.
    "--------------------------------------------------------------
    " Action with result [1] $self:
    " 1) modify the instances IN LOCAL MODE,
    " 2) report failures per %tky,
    " 3) fill the RESULT table — each row = instance key + %param
    "    (there is no %result component; %param carries the data).
    "--------------------------------------------------------------
    MODIFY ENTITIES OF z_r_customer IN LOCAL MODE
      ENTITY Customer
      UPDATE FIELDS ( Blocked )
      WITH VALUE #( FOR <key_to_block> IN keys
                    ( %tky    = <key_to_block>-%tky
                      Blocked = abap_true ) )
      FAILED   DATA(failed_block)
      REPORTED DATA(reported_block).

    "Propagate failures of the internal modify to the caller
    LOOP AT failed_block-customer ASSIGNING FIELD-SYMBOL(<failed_customer>).
      APPEND VALUE #( %tky                  = <failed_customer>-%tky
                      %fail-cause           = <failed_customer>-%fail-cause
                      %action-block         = if_abap_behv=>mk-on )
             TO failed-customer.
    ENDLOOP.

    "Re-read the final state and return it as the action result
    READ ENTITIES OF z_r_customer IN LOCAL MODE
      ENTITY Customer
      ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(blocked_customers).

    result = VALUE #( FOR <blocked_customer> IN blocked_customers
                      ( %tky   = <blocked_customer>-%tky
                        %param = <blocked_customer> ) ).
  ENDMETHOD.

ENDCLASS.
