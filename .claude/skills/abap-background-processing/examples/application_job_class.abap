*"* Example: application job class with Application Log (BALI) output
*"* Pattern from SAP-samples/abap-platform-application-jobs, reworked to
*"* Clean ABAP (descriptive names, inline declarations).
*"*
*"* Artifacts around this class:
*"*   - Job catalog entry (SAJC)  ZINVENTORY_CATALOG  -> points to this class
*"*   - Job template     (SAJT)  ZINVENTORY_TEMPLATE -> schedulable entity
*"*   - Log object       (APLO)  ZINVENTORY_LOG with subobject ZINVENTORY_SUB
*"*
*"* Debugging: application jobs cannot be debugged. if_oo_adt_classrun~main( )
*"* calls execute( ) with default parameters so the logic runs under F9 with
*"* breakpoints; sy-batch routes output to console vs application log.

CLASS zcl_inventory_job DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    CONSTANTS c_selection_name          TYPE c LENGTH 8 VALUE 'INVENT'.
    CONSTANTS c_log_object_name         TYPE if_bali_object_handler=>ty_object VALUE 'ZINVENTORY_LOG'.
    CONSTANTS c_log_subobject_name      TYPE if_bali_object_handler=>ty_object VALUE 'ZINVENTORY_SUB'.
    CONSTANTS c_job_template_name       TYPE cl_apj_rt_api=>ty_template_name VALUE 'ZINVENTORY_TEMPLATE'.

    "! Design time: parameter definitions + default values ("selection screen").
    INTERFACES if_apj_dt_exec_object.
    "! Runtime: execute( ) is the job's entry point.
    INTERFACES if_apj_rt_exec_object.
    "! F9 test harness — lets the developer debug the job logic interactively.
    INTERFACES if_oo_adt_classrun.

    "! Schedules this job for one inventory. Call ONLY from the additional
    "! save phase (save_modified) of the RAP BO — never from the interaction
    "! phase, where implicit commits could schedule a job for data that is
    "! never saved.
    CLASS-METHODS schedule_for_inventory
      IMPORTING iv_inventory_uuid   TYPE sysuuid_x16
                iv_job_description  TYPE string
      EXPORTING ev_job_name         TYPE cl_apj_rt_api=>ty_jobname
                ev_job_count        TYPE cl_apj_rt_api=>ty_jobcount
      RAISING   cx_apj_rt.

    METHODS constructor.

  PRIVATE SECTION.
    DATA mo_console_out      TYPE REF TO if_oo_adt_classrun_out.
    DATA mo_application_log  TYPE REF TO if_bali_log.

    "! Console when started via F9, application log when running as a job.
    METHODS log_message
      IMPORTING iv_message_text TYPE cl_bali_free_text_setter=>ty_text
      RAISING   cx_bali_runtime.
ENDCLASS.


CLASS zcl_inventory_job IMPLEMENTATION.

  METHOD constructor.
    mo_application_log = cl_bali_log=>create_with_header(
        header = cl_bali_header_setter=>create( object      = c_log_object_name
                                                subobject   = c_log_subobject_name
                                                external_id = 'INVENTORY_JOB' ) ).
  ENDMETHOD.

  METHOD if_apj_dt_exec_object~get_parameters.
    " Which parameters does this job accept? (like a report's selection screen)
    et_parameter_def = VALUE #(
      ( selname        = c_selection_name
        kind           = if_apj_dt_exec_object=>parameter
        datatype       = 'C'
        length         = 32
        param_text     = 'Inventory key'
        changeable_ind = abap_true ) ).

    " Default values — the fallback when the job is scheduled without values.
    SELECT SINGLE uuid
      FROM zr_inventorytp
      WHERE InventoryID = '1'
      INTO @DATA(lv_default_inventory_uuid).

    et_parameter_val = VALUE #(
      ( selname = c_selection_name
        kind    = if_apj_dt_exec_object=>parameter
        sign    = 'I'
        option  = 'EQ'
        low     = lv_default_inventory_uuid ) ).
  ENDMETHOD.

  METHOD if_apj_rt_exec_object~execute.
    TRY.
        log_message( 'Job started' ).

        LOOP AT it_parameters INTO DATA(ls_job_parameter)
             WHERE selname = c_selection_name AND low IS NOT INITIAL.

          SELECT SINGLE uuid, Quantity, QuantityUnit
            FROM zr_inventorytp
            WHERE uuid = @ls_job_parameter-low
            INTO @DATA(ls_current_inventory).
          IF sy-subrc <> 0.
            log_message( |Inventory { ls_job_parameter-low } not found| ).
            CONTINUE.
          ENDIF.

          " The job runs in its own LUW: EML including COMMIT ENTITIES is fine.
          MODIFY ENTITIES OF zr_inventorytp
            ENTITY Inventory
              UPDATE FIELDS ( Quantity LogHandle )
              WITH VALUE #( ( uuid      = ls_current_inventory-uuid
                              Quantity  = ls_current_inventory-Quantity + 10
                              LogHandle = mo_application_log->get_handle( ) ) )
            REPORTED DATA(lt_update_reported)
            FAILED   DATA(lt_update_failed).

          IF lt_update_failed IS INITIAL.
            COMMIT ENTITIES RESPONSE OF zr_inventorytp
              REPORTED DATA(lt_commit_reported)
              FAILED   DATA(lt_commit_failed).
            log_message( |Inventory { ls_current_inventory-uuid } updated| ).
          ELSE.
            log_message( |Update failed for { ls_current_inventory-uuid }| ).
          ENDIF.
        ENDLOOP.

        log_message( 'Job finished' ).

      CATCH cx_bali_runtime INTO DATA(lo_logging_error).
        " Let the job framework record the failure.
        RAISE EXCEPTION TYPE cx_apj_rt_content
          EXPORTING previous = lo_logging_error.
    ENDTRY.
  ENDMETHOD.

  METHOD if_oo_adt_classrun~main.
    " F9 harness: run the job logic interactively with default parameters —
    " breakpoints work here, unlike in a real background job.
    mo_console_out = out.

    TRY.
        if_apj_dt_exec_object~get_parameters(
          IMPORTING et_parameter_def = DATA(lt_parameter_definitions)
                    et_parameter_val = DATA(lt_default_parameters) ).

        if_apj_rt_exec_object~execute( it_parameters = lt_default_parameters ).
        out->write( |Finished| ).
      CATCH cx_root INTO DATA(lo_job_error).
        out->write( |Exception occurred: { lo_job_error->get_text( ) }| ).
    ENDTRY.
  ENDMETHOD.

  METHOD schedule_for_inventory.
    " On-premise caveat: start_immediately performs an internal COMMIT WORK and
    " dumps inside a save sequence — use ls_job_start_info-timestamp there instead.
    DATA(ls_job_start_info) = VALUE cl_apj_rt_api=>ty_start_info(
        start_immediately = abap_true ).

    DATA(lt_job_parameters) = VALUE cl_apj_rt_api=>tt_job_parameter_value(
        ( name    = c_selection_name
          t_value = VALUE #( ( sign = 'I' option = 'EQ' low = iv_inventory_uuid ) ) ) ).

    cl_apj_rt_api=>schedule_job(
      EXPORTING iv_job_template_name   = c_job_template_name
                iv_job_text            = iv_job_description
                is_start_info          = ls_job_start_info
                it_job_parameter_value = lt_job_parameters
      IMPORTING ev_jobname             = ev_job_name
                ev_jobcount            = ev_job_count ).

    " Caller (save_modified) persists ev_job_name/ev_job_count with a direct SQL
    " UPDATE on the BO table — business data is frozen in the save phase.
  ENDMETHOD.

  METHOD log_message.
    IF sy-batch = abap_true.
      " Running as an application job: write to the application log.
      DATA(lo_log_item) = cl_bali_free_text_setter=>create(
          severity = if_bali_constants=>c_severity_status
          text     = iv_message_text ).
      lo_log_item->set_detail_level( detail_level = '1' ).
      mo_application_log->add_item( item = lo_log_item ).
      cl_bali_log_db=>get_instance( )->save_log(
          log                         = mo_application_log
          assign_to_current_appl_job = abap_true ).
    ELSE.
      " Started interactively via F9: write to the ADT console.
      mo_console_out->write( iv_message_text ).
    ENDIF.
  ENDMETHOD.

ENDCLASS.
