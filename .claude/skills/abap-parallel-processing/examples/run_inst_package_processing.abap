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
    CONSTANTS package_size          TYPE i VALUE 10000.
    CONSTANTS number_of_work_items  TYPE i VALUE 100000.
    CONSTANTS number_of_tasks       TYPE i VALUE 4.

    METHODS build_work_items
      RETURNING VALUE(result) TYPE lcl_square_worker=>numbers.

    METHODS build_worker_instances
      IMPORTING work_items    TYPE lcl_square_worker=>numbers
      RETURNING VALUE(result) TYPE cl_abap_parallel=>t_in_inst_tab.

    METHODS run_in_parallel
      IMPORTING worker_instances TYPE cl_abap_parallel=>t_in_inst_tab
                console          TYPE REF TO if_oo_adt_classrun_out
      RETURNING VALUE(result)    TYPE lcl_square_worker=>numbers.

    METHODS run_sequentially_for_compare
      IMPORTING work_items    TYPE lcl_square_worker=>numbers
      RETURNING VALUE(result) TYPE lcl_square_worker=>numbers.
ENDCLASS.


CLASS zcl_parallel_package_demo IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA(work_items) = build_work_items( ).

    " --- Parallel run -------------------------------------------------
    DATA(parallel_started_at) = utclong_current( ).
    DATA(parallel_results) = run_in_parallel(
        worker_instances = build_worker_instances( work_items )
        console          = out ).
    DATA(parallel_seconds) = utclong_diff( high = utclong_current( )
                                           low  = parallel_started_at ).

    " --- Sequential run for comparison (cheat sheet 32 pattern) -------
    DATA(sequential_started_at) = utclong_current( ).
    DATA(sequential_results) = run_sequentially_for_compare( work_items ).
    DATA(sequential_seconds) = utclong_diff( high = utclong_current( )
                                             low  = sequential_started_at ).

    out->write( |Work items processed:  { lines( work_items ) }| ).
    out->write( |Parallel results:      { lines( parallel_results ) } | &&
                |in { parallel_seconds STYLE = SIMPLE } s | &&
                |({ number_of_tasks } tasks)| ).
    out->write( |Sequential results:    { lines( sequential_results ) } | &&
                |in { sequential_seconds STYLE = SIMPLE } s| ).
  ENDMETHOD.

  METHOD build_work_items.
    " Any independent workload; here: numbers to square.
    result = VALUE #( FOR item_index = 1 UNTIL item_index > number_of_work_items
                      ( item_index ) ).
  ENDMETHOD.

  METHOD build_worker_instances.
    " Packaging: one worker instance per package, NOT one per row.
    " SAP guidance: work units below ~200 ms are inefficient to
    " parallelize - bundle them (data-transport overhead dominates).
    DATA current_package TYPE lcl_square_worker=>numbers.

    LOOP AT work_items INTO DATA(work_item).
      APPEND work_item TO current_package.
      IF lines( current_package ) = package_size.
        APPEND NEW lcl_square_worker( current_package ) TO result.
        CLEAR current_package.
      ENDIF.
    ENDLOOP.

    IF current_package IS NOT INITIAL.
      APPEND NEW lcl_square_worker( current_package ) TO result.
    ENDIF.
  ENDMETHOD.

  METHOD run_in_parallel.
    " Explicit, modest sizing. Defaults if omitted: 50 percent of the
    " free dialog work processes, across all servers; two free dialog
    " processes per server are always retained by the system.
    DATA(parallel_runner) = NEW cl_abap_parallel( p_num_tasks = number_of_tasks ).

    " Synchronous fan-out/fan-in: run_inst returns when all tasks have
    " finished. The framework serializes each worker instance, executes
    " if_abap_parallel~do( ) in an aRFC task on a free dialog work
    " process, and returns the processed instances.
    " Tip: add p_debug = abap_true to run sequentially without RFC
    " (breakpoints inside do( ) work in that mode).
    parallel_runner->run_inst( EXPORTING p_in_tab  = worker_instances
                               IMPORTING p_out_tab = DATA(task_results) ).

    " Fan-in: the result table has the SAME count and SAME order as the
    " input table, so sy-tabix maps a result row back to its package.
    LOOP AT task_results INTO DATA(task_result).
      IF task_result-inst IS INITIAL.
        " Infrastructure failure for this package (documented example
        " message: "Time limit exceeded"). The original input instance
        " still holds the package - a real orchestrator could re-run it
        " sequentially, collect it for a retry, or raise.
        console->write( |Package { sy-tabix } failed - check message info.| ).
        CONTINUE.
      ENDIF.

      " Results MUST be read from the returned instance: the work
      " happened on a deserialized copy in another session, not on the
      " reference the caller appended to p_in_tab.
      DATA(finished_worker) = CAST lcl_square_worker( task_result-inst ).
      APPEND LINES OF finished_worker->get_squared_numbers( ) TO result.
    ENDLOOP.
  ENDMETHOD.

  METHOD run_sequentially_for_compare.
    " The same worker used sequentially (cheat sheet 32 contrasts the
    " parallel run with exactly such a sequential baseline). Always
    " measure both before deciding that parallelization pays.
    DATA(sequential_worker) = NEW lcl_square_worker( work_items ).
    sequential_worker->if_abap_parallel~do( ).
    result = sequential_worker->get_squared_numbers( ).
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

    TYPES numbers TYPE STANDARD TABLE OF i WITH EMPTY KEY.

    METHODS constructor
      IMPORTING numbers_to_square TYPE numbers.

    METHODS get_squared_numbers
      RETURNING VALUE(result) TYPE numbers.

  PRIVATE SECTION.
    DATA numbers_to_square TYPE numbers.
    DATA squared_numbers   TYPE numbers.
ENDCLASS.


CLASS lcl_square_worker IMPLEMENTATION.
  METHOD constructor.
    me->numbers_to_square = numbers_to_square.
  ENDMETHOD.

  METHOD if_abap_parallel~do.
    " Runs inside its own aRFC session and its own SAP LUW:
    " - no access to the caller's session state or uncommitted data
    " - any database change here commits independently of the caller
    " - catch expected errors HERE and store them in instance state;
    "   an exception escaping do( ) cannot be caught by the caller.
    squared_numbers = VALUE #( FOR current_number IN numbers_to_square
                               ( current_number * current_number ) ).
  ENDMETHOD.

  METHOD get_squared_numbers.
    result = squared_numbers.
  ENDMETHOD.
ENDCLASS.
