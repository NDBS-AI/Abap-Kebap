*&---------------------------------------------------------------------*
*& CL_ABAP_PARALLEL / run_inst — complete package-processing example
*&
*& Adapted from the SAP-samples abap-cheat-sheets:
*&   - 22_Released_ABAP_Classes.md (Parallel Processing: self-contained
*&     run_inst demo with timestamps)
*&   - 32_Performance_Notes.md (misc_07_parallel_processing_a/z: parallel
*&     vs sequential comparison, worker as local class in CCIMP)
*& Clean ABAP naming applied throughout (no single-letter identifiers).
*&
*& Setup: create global class ZCL_PARALLEL_PACKAGE_DEMO with the code in
*& section 1; put the worker class from section 2 into the CCIMP include
*& (Local Types tab in ADT). Run with F9 (console output).
*&---------------------------------------------------------------------*

*&---------------------------------------------------------------------*
*& Section 1 — global orchestrator class (main include)
*&---------------------------------------------------------------------*
CLASS zcl_parallel_package_demo DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.

  PRIVATE SECTION.
    CONSTANTS c_package_size          TYPE i VALUE 10000.
    CONSTANTS c_number_of_work_items  TYPE i VALUE 100000.
    CONSTANTS c_number_of_tasks       TYPE i VALUE 4.

    METHODS build_work_items
      RETURNING VALUE(rt_result) TYPE lcl_square_worker=>tt_numbers.

    METHODS build_worker_instances
      IMPORTING it_work_items TYPE lcl_square_worker=>tt_numbers
      RETURNING VALUE(rt_result) TYPE cl_abap_parallel=>t_in_inst_tab.

    METHODS run_in_parallel
      IMPORTING it_worker_instances TYPE cl_abap_parallel=>t_in_inst_tab
                io_console          TYPE REF TO if_oo_adt_classrun_out
      RETURNING VALUE(rt_result)    TYPE lcl_square_worker=>tt_numbers.

    METHODS run_sequentially_for_compare
      IMPORTING it_work_items TYPE lcl_square_worker=>tt_numbers
      RETURNING VALUE(rt_result) TYPE lcl_square_worker=>tt_numbers.
ENDCLASS.


CLASS zcl_parallel_package_demo IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA(lt_work_items) = build_work_items( ).

    " --- Parallel run -------------------------------------------------
    DATA(lv_parallel_started_at) = utclong_current( ).
    DATA(lt_parallel_results) = run_in_parallel(
        it_worker_instances = build_worker_instances( lt_work_items )
        io_console          = out ).
    DATA(lv_parallel_seconds) = utclong_diff( high = utclong_current( )
                                           low  = lv_parallel_started_at ).

    " --- Sequential run for comparison (cheat sheet 32 pattern) -------
    DATA(lv_sequential_started_at) = utclong_current( ).
    DATA(lt_sequential_results) = run_sequentially_for_compare( lt_work_items ).
    DATA(lv_sequential_seconds) = utclong_diff( high = utclong_current( )
                                             low  = lv_sequential_started_at ).

    out->write( |Work items processed:  { lines( lt_work_items ) }| ).
    out->write( |Parallel results:      { lines( lt_parallel_results ) } | &&
                |in { lv_parallel_seconds STYLE = SIMPLE } s | &&
                |({ c_number_of_tasks } tasks)| ).
    out->write( |Sequential results:    { lines( lt_sequential_results ) } | &&
                |in { lv_sequential_seconds STYLE = SIMPLE } s| ).
  ENDMETHOD.

  METHOD build_work_items.
    " Any independent workload; here: numbers to square.
    rt_result = VALUE #( FOR lv_item_index = 1 UNTIL lv_item_index > c_number_of_work_items
                      ( lv_item_index ) ).
  ENDMETHOD.

  METHOD build_worker_instances.
    " Packaging: one worker instance per package, NOT one per row.
    " SAP guidance: work units below ~200 ms are inefficient to
    " parallelize - bundle them (data-transport overhead dominates).
    DATA lt_current_package TYPE lcl_square_worker=>tt_numbers.

    LOOP AT it_work_items INTO DATA(lv_work_item).
      APPEND lv_work_item TO lt_current_package.
      IF lines( lt_current_package ) = c_package_size.
        APPEND NEW lcl_square_worker( lt_current_package ) TO rt_result.
        CLEAR lt_current_package.
      ENDIF.
    ENDLOOP.

    IF lt_current_package IS NOT INITIAL.
      APPEND NEW lcl_square_worker( lt_current_package ) TO rt_result.
    ENDIF.
  ENDMETHOD.

  METHOD run_in_parallel.
    " Explicit, modest sizing. Defaults if omitted: 50 percent of the
    " free dialog work processes, across all servers; two free dialog
    " processes per server are always retained by the system.
    DATA(lo_parallel_runner) = NEW cl_abap_parallel( p_num_tasks = c_number_of_tasks ).

    " Synchronous fan-out/fan-in: run_inst returns when all tasks have
    " finished. The framework serializes each worker instance, executes
    " if_abap_parallel~do( ) in an aRFC task on a free dialog work
    " process, and returns the processed instances.
    " Tip: add p_debug = abap_true to run sequentially without RFC
    " (breakpoints inside do( ) work in that mode).
    lo_parallel_runner->run_inst( EXPORTING p_in_tab  = it_worker_instances
                               IMPORTING p_out_tab = DATA(lt_task_results) ).

    " Fan-in: the result table has the SAME count and SAME order as the
    " input table, so sy-tabix maps a result row back to its package.
    LOOP AT lt_task_results INTO DATA(ls_task_result).
      IF ls_task_result-inst IS INITIAL.
        " Infrastructure failure for this package (documented example
        " message: "Time limit exceeded"). The original input instance
        " still holds the package - a real orchestrator could re-run it
        " sequentially, collect it for a retry, or raise.
        io_console->write( |Package { sy-tabix } failed - check message info.| ).
        CONTINUE.
      ENDIF.

      " Results MUST be read from the returned instance: the work
      " happened on a deserialized copy in another session, not on the
      " reference the caller appended to p_in_tab.
      DATA(lo_finished_worker) = CAST lcl_square_worker( ls_task_result-inst ).
      APPEND LINES OF lo_finished_worker->get_squared_numbers( ) TO rt_result.
    ENDLOOP.
  ENDMETHOD.

  METHOD run_sequentially_for_compare.
    " The same worker used sequentially (cheat sheet 32 contrasts the
    " parallel run with exactly such a sequential baseline). Always
    " measure both before deciding that parallelization pays.
    DATA(lo_sequential_worker) = NEW lcl_square_worker( it_work_items ).
    lo_sequential_worker->if_abap_parallel~do( ).
    rt_result = lo_sequential_worker->get_squared_numbers( ).
  ENDMETHOD.
ENDCLASS.


*&---------------------------------------------------------------------*
*& Section 2 — worker class in the CCIMP include (Local Types tab)
*&
*& The instance IS the work unit: constructor loads the input package,
*& do( ) computes, a getter exposes the result. do( ) has no parameters;
*& everything travels via instance state, which is serialized to the
*& task and back (IF_ABAP_PARALLEL includes IF_SERIALIZABLE_OBJECT -
*& keep the state to plain, serializable data).
*&---------------------------------------------------------------------*
CLASS lcl_square_worker DEFINITION.
  PUBLIC SECTION.
    INTERFACES if_abap_parallel.

    TYPES tt_numbers TYPE STANDARD TABLE OF i WITH EMPTY KEY.

    METHODS constructor
      IMPORTING it_numbers_to_square TYPE tt_numbers.

    METHODS get_squared_numbers
      RETURNING VALUE(rt_result) TYPE tt_numbers.

  PRIVATE SECTION.
    DATA mt_numbers_to_square TYPE tt_numbers.
    DATA mt_squared_numbers   TYPE tt_numbers.
ENDCLASS.


CLASS lcl_square_worker IMPLEMENTATION.
  METHOD constructor.
    me->mt_numbers_to_square = it_numbers_to_square.
  ENDMETHOD.

  METHOD if_abap_parallel~do.
    " Runs inside its own aRFC session and its own SAP LUW:
    " - no access to the caller's session state or uncommitted data
    " - any database change here commits independently of the caller
    " - catch expected errors HERE and store them in instance state;
    "   an exception escaping do( ) cannot be caught by the caller.
    mt_squared_numbers = VALUE #( FOR lv_current_number IN mt_numbers_to_square
                               ( lv_current_number * lv_current_number ) ).
  ENDMETHOD.

  METHOD get_squared_numbers.
    rt_result = mt_squared_numbers.
  ENDMETHOD.
ENDCLASS.
