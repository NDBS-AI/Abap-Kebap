*&---------------------------------------------------------------------*
*& CL_ABAP_PARALLEL / run — xstring-based variant (subclass + REDEFINITION)
*&
*& Lower-level model: the caller serializes each work unit into an
*& xstring, the framework ships one xstring per task, and the subclass's
*& redefined do( ) method turns p_in (xstring) into p_out (xstring).
*& p_in_all optionally carries one shared payload to EVERY task.
*&
*& Prefer run_inst (see run_inst_package_processing.abap) unless the
*& data already is a byte stream or you need full control over the
*& serialization. Clean ABAP naming applied throughout.
*&---------------------------------------------------------------------*

*&---------------------------------------------------------------------*
*& Worker: subclass of CL_ABAP_PARALLEL with do( ) redefined
*&---------------------------------------------------------------------*
CLASS zcl_order_totals_worker DEFINITION
  PUBLIC
  INHERITING FROM cl_abap_parallel
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    TYPES: BEGIN OF order_amount,
             order_id TYPE c LENGTH 10,
             amount   TYPE p LENGTH 16 DECIMALS 2,
           END OF order_amount,
           order_amounts TYPE STANDARD TABLE OF order_amount WITH EMPTY KEY.

    METHODS do REDEFINITION.
ENDCLASS.


CLASS zcl_order_totals_worker IMPLEMENTATION.
  METHOD do.
    " p_in:     this task's serialized work unit (xstring)
    " p_in_all: optional payload shipped identically to every task
    " p_out:    this task's serialized result (xstring)
    DATA order_package TYPE order_amounts.

    " Deserialize the package (the identity transformation round-trips
    " ABAP data via asXML).
    CALL TRANSFORMATION id SOURCE XML p_in
                           RESULT package = order_package.

    " Independent, CPU-bound work on the package.
    DATA(package_total) = REDUCE order_amount-amount(
        INIT total = CONV order_amount-amount( 0 )
        FOR package_line IN order_package
        NEXT total = total + package_line-amount ).

    " Serialize the result back.
    CALL TRANSFORMATION id SOURCE total = package_total
                           RESULT XML p_out.
  ENDMETHOD.
ENDCLASS.


*&---------------------------------------------------------------------*
*& Orchestration snippet (e.g. inside an if_oo_adt_classrun main method)
*&---------------------------------------------------------------------*
*  DATA serialized_packages TYPE cl_abap_parallel=>t_in_tab.
*
*  " 1. Serialize each package into one xstring work unit.
*  LOOP AT order_packages INTO DATA(order_package).
*    DATA serialized_package TYPE xstring.
*    CALL TRANSFORMATION id SOURCE package = order_package
*                           RESULT XML serialized_package.
*    APPEND serialized_package TO serialized_packages.
*  ENDLOOP.
*
*  " 2. Fan out on an instance of the SUBCLASS (its redefined do( )
*  "    is what the tasks execute). p_debug = abap_true would run all
*  "    units sequentially in this session without RFC.
*  DATA(parallel_runner) = NEW zcl_order_totals_worker( p_num_tasks = 3 ).
*
*  parallel_runner->run( EXPORTING p_in_tab  = serialized_packages
*                        IMPORTING p_out_tab = DATA(task_outputs) ).
*
*  " 3. Fan in - same count and order as the input; deserialize each
*  "    task's output xstring. CAUTION: SAP's public page spells out only
*  "    the inst/message components of the run_inst result rows; the
*  "    component name that holds the output xstring on a
*  "    cl_abap_parallel=>t_out_tab row is NOT publicly documented - look
*  "    it up via ABAP Doc / code completion in ADT on your release and
*  "    set it in the constant below. Accessed dynamically here (ASSIGN
*  "    COMPONENT) so this snippet compiles without guessing that name.
*  CONSTANTS output_xstring_component TYPE string VALUE 'OUTPUT'.  " ADJUST to your release's actual component name
*  DATA grand_total TYPE zcl_order_totals_worker=>order_amount-amount.
*
*  LOOP AT task_outputs INTO DATA(task_output).
*    ASSIGN COMPONENT output_xstring_component OF STRUCTURE task_output
*           TO FIELD-SYMBOL(<output_xstring>).
*    IF sy-subrc <> 0.
*      " Component name is wrong for this release - fix the constant above.
*      CONTINUE.
*    ENDIF.
*    DATA package_total TYPE zcl_order_totals_worker=>order_amount-amount.
*    CALL TRANSFORMATION id SOURCE XML <output_xstring>
*                           RESULT total = package_total.
*    grand_total = grand_total + package_total.
*  ENDLOOP.
