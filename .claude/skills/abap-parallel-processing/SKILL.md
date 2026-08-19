---
name: abap-parallel-processing
description: "Use when ABAP work should be split across multiple work processes to cut elapsed time — deciding whether parallelization pays at all (data-intensive, independent work units) or whether the work belongs in the database or a background framework instead; implementing worker classes with IF_ABAP_PARALLEL whose instances carry the work-unit state; fanning out with CL_ABAP_PARALLEL's run_inst (instance tables cl_abap_parallel=>t_in_inst_tab / t_out_inst_tab) or the serialized run variant with xstring in/out tables; sizing the fan-out with constructor parameters such as p_num_tasks, p_percentage, and p_local_server; collecting and merging per-task results and message info; and understanding the aRFC/free-dialog-work-process mechanics and per-task LUW isolation underneath. Triggers include CL_ABAP_PARALLEL, IF_ABAP_PARALLEL, run_inst, parallelize this loop, process in parallel tasks, speed up mass processing, parallel processing in ABAP Cloud, STARTING NEW TASK, aRFC, and SPTA framework."
---

# ABAP Parallel Processing — CL_ABAP_PARALLEL

## Overview

`CL_ABAP_PARALLEL` is SAP's released, object-oriented framework for **synchronous fan-out/fan-in** parallel processing: the caller hands over a set of work units, the framework distributes them as asynchronous RFC (aRFC) tasks onto **free dialog work processes** (by default across all servers of the system), and the call returns when the tasks are done — results and per-task message info come back in one table, in the same order as the input.

Two programming models:

- **`run_inst` (recommended)** — implement `IF_ABAP_PARALLEL` in a worker class whose *instances* carry the work-unit state; pass an instance table, get back processed instances. No manual serialization.
- **`run` (low-level)** — subclass `CL_ABAP_PARALLEL`, redefine its `do` method (`p_in`/`p_out` are `xstring`), and pass a table of serialized inputs. You do the (de)serialization, e.g. with `CALL TRANSFORMATION`.

**Core principle:** parallelization is a *last-resort* elapsed-time optimization for **independent, data-intensive work units**. It buys wall-clock time by spending system resources (dialog work processes on the whole system) and by giving up transactional unity (every task is its own session and LUW). Before fanning out, push set-based work into the database ([abap-sql-performance](../abap-sql-performance/SKILL.md)) and check whether the requirement is really "faster now" (parallel) or "later, reliably" (background — [abap-background-processing](../abap-background-processing/SKILL.md)).

## Workflow

1. **Decide whether to parallelize at all** (first decision guide below). If the work is DB-bound, order-dependent, or the units are tiny, don't.
2. **Pick the vehicle** (second decision guide): `CL_ABAP_PARALLEL` for synchronous fan-out/fan-in, bgPF/jobs for asynchronous-after-commit, classic aRFC/SPTA only in classic ABAP where `CL_ABAP_PARALLEL` is unavailable or unsuitable.
3. **Cut the work into packages.** Aim for units that run well above ~200 ms each — SAP's documentation calls parallelizing shorter operations inefficient because of data-transport overhead and recommends bundling several short operations into one task.
4. **Implement the worker class:** `INTERFACES if_abap_parallel`, state (input package + result attributes) in the instance, work in `if_abap_parallel~do( )` (no parameters — everything travels via instance state).
5. **Orchestrate:** build a `cl_abap_parallel=>t_in_inst_tab` of worker instances, create `NEW cl_abap_parallel( ... )` with explicit sizing (`p_num_tasks` or `p_percentage`), call `run_inst`.
6. **Collect and merge:** loop over `p_out_tab`, check per row whether the task succeeded (`inst` bound) or failed (`message` filled), `CAST` each returned instance to the worker class, and merge its result attributes. Read results **only** from the returned instances.
7. **Test sequentially first:** both `run` and `run_inst` accept `p_debug` — the tasks then run one after another in the current session without RFC, so breakpoints work.

### Decision guide 1 — parallelize or not

| Situation | Verdict |
|---|---|
| Heavy, CPU/application-server-bound work over many independent units (pricing per order package, document checks, external-format rendering) | **Parallelize** — this is the target case |
| The loop's body is one or more `SELECT`/`UPDATE` per row | **Don't parallelize the loop — fix the SQL.** Set-based SQL, joins, `FOR ALL ENTRIES` replacement, code pushdown ([abap-sql-performance](../abap-sql-performance/SKILL.md)) beat N parallel tasks hammering the same database |
| Work units < ~200 ms each | **Don't** split that fine — bundle several units per task or stay sequential (SAP guidance: data transport overhead dominates) |
| Units depend on each other's results, or processing order matters | **Don't** — `CL_ABAP_PARALLEL` gives no ordering of *execution*; only the result table order matches the input order |
| All units must commit or roll back together | **Don't** — each task is its own SAP LUW; there is no cross-task rollback ([abap-sap-luw](../abap-sap-luw/SKILL.md)) |
| Small total workload / interactive dialog step | **Don't** — task setup, serialization, and RFC dispatch cost more than they save |
| Work should run *after* the current transaction, not block it | **Not this skill** — background processing ([abap-background-processing](../abap-background-processing/SKILL.md)) |

### Decision guide 2 — CL_ABAP_PARALLEL vs bgPF vs aRFC/SPTA

| Requirement | Pick |
|---|---|
| Caller needs the combined result *in this program run* (fan-out, wait, merge) | **`CL_ABAP_PARALLEL`** — synchronous `run_inst`/`run` |
| Same, in ABAP for Cloud Development | **`CL_ABAP_PARALLEL`** — it is a released class ([cheat sheet 22](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/22_Released_ABAP_Classes.md)); classic aRFC statements and SPTA are not in the cloud language scope |
| Fire-and-forget work after `COMMIT WORK`, transactional Exactly-Once | **bgPF** — see [abap-background-processing](../abap-background-processing/SKILL.md) |
| Recurring, admin-visible, schedulable runs | **Application Jobs** — same skill |
| Classic ABAP, fine-grained control over tasks/callbacks/destinations | **`CALL FUNCTION ... STARTING NEW TASK`** (aRFC), ideally `DESTINATION IN GROUP` against an RFC server group |
| Classic ABAP mass runs with packet building, restart logic, RFC-enabled function modules | **SPTA framework** (function group SPTA, `SPTA_PARA_PROCESS_START_2`) — classic on-premise only |
| Queued, ordered, reliable units (EOIO) | **bgRFC** directly (classic) or bgPF queued processes (cloud) |

`CL_ABAP_PARALLEL` is *synchronous* from the caller's perspective (start, wait, merge); bgPF is *asynchronous after commit*. They answer different questions — "make this loop faster" vs "don't make the user wait".

## When parallelization pays — and when it does not

The performance cheat sheet (32) frames parallel processing as one tool at the end of the optimization ladder: it is "particularly suitable for data-intensive operations" where tasks can run "simultaneously rather than sequentially". Before reaching for it:

1. **Push down first.** A parallelized loop of single-row SQL is still a loop of single-row SQL — N tasks now compete for the same database. Set-based statements, joins, and aggregate functions remove the loop instead of multiplying it ([abap-sql-performance](../abap-sql-performance/SKILL.md)).
2. **Check unit independence.** Each task gets a *serialized copy* of its worker instance and runs in its own session. Tasks cannot see each other's state, the caller's uncommitted database changes, or shared buffers/memory of the caller's session.
3. **Check unit size.** SAP's parallel-processing documentation: operations below roughly **200 ms** are inefficient to parallelize because of data-transport overhead — bundle several into one task. Package the workload (e.g., 10 packages of 10,000 rows), don't create one task per row.
4. **Check system headroom.** The framework takes *free dialog work processes* system-wide. Two free dialog processes per server are always retained by the system for dialog users, and by default only a share (50% if nothing is specified) of the free processes is used — but a careless `p_percentage = 100` on a busy system starves real users.

## The CL_ABAP_PARALLEL model — worker instances

The `run_inst` contract:

- The **worker class implements `IF_ABAP_PARALLEL`** — a released interface with a single method `do( )` (no parameters) that also includes `IF_SERIALIZABLE_OBJECT`.
- **All state lives in the instance**: the constructor (or setters) load the work-unit input into attributes; `do( )` computes and stores results into attributes.
- The framework **serializes each input instance**, ships it to an aRFC task on a free dialog work process, calls `do( )` there, serializes the instance back, and returns it in the output table.
- **Read results from the returned instances only.** Your original references in the calling session are not the objects that did the work — the work happened on deserialized copies in other sessions. (In `p_debug` mode everything runs in-process, which can mask this — always merge from `p_out_tab` so both modes behave alike.)

```abap
" Input/output types (all from CL_ABAP_PARALLEL):
" cl_abap_parallel=>t_in_inst_tab  - table of REF TO if_abap_parallel (input)
" cl_abap_parallel=>t_out_inst_tab - result table: one row per input instance,
"                                    same count, same order; components:
"                                    inst    - the processed instance (bound on success)
"                                    message - error/status info (filled on failure,
"                                              e.g. "Time limit exceeded" on timeout)
```

The flow, minimal:

```abap
DATA worker_instances TYPE cl_abap_parallel=>t_in_inst_tab.

APPEND NEW zcl_discount_worker( first_order_package )  TO worker_instances.
APPEND NEW zcl_discount_worker( second_order_package ) TO worker_instances.

DATA(parallel_runner) = NEW cl_abap_parallel( p_num_tasks = 4 ).

parallel_runner->run_inst( EXPORTING p_in_tab  = worker_instances
                           IMPORTING p_out_tab = DATA(task_results) ).
" run_inst has returned: all tasks are finished (or failed/timed out).
```

The full verified method/type/constructor surface — including the `fork`/`join` split calls and `p_debug` — is in [references/cl-abap-parallel-api.md](references/cl-abap-parallel-api.md).

## Worked example — package workers with result merge

Adapted from the cheat-sheet examples (22_Released_ABAP_Classes.md's self-contained `run_inst` demo and 32_Performance_Notes.md's `lcl_parallel` CCIMP worker), with Clean ABAP names. The worker squares numbers per package — substitute any CPU-heavy, independent computation:

```abap
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
    " Runs inside an aRFC task in its own session: only instance state
    " is available here; the caller's session data is out of reach.
    squared_numbers = VALUE #( FOR number IN numbers_to_square
                               ( number * number ) ).
  ENDMETHOD.

  METHOD get_squared_numbers.
    result = squared_numbers.
  ENDMETHOD.
ENDCLASS.
```

Orchestration — package the workload, fan out, merge:

```abap
METHOD square_in_parallel.
  CONSTANTS package_size TYPE i VALUE 10000.

  DATA worker_instances TYPE cl_abap_parallel=>t_in_inst_tab.
  DATA current_package  TYPE lcl_square_worker=>numbers.

  " 1. Cut the workload into packages big enough to be worth a task
  LOOP AT all_numbers INTO DATA(current_number).
    APPEND current_number TO current_package.
    IF lines( current_package ) = package_size.
      APPEND NEW lcl_square_worker( current_package ) TO worker_instances.
      CLEAR current_package.
    ENDIF.
  ENDLOOP.
  IF current_package IS NOT INITIAL.
    APPEND NEW lcl_square_worker( current_package ) TO worker_instances.
  ENDIF.

  " 2. Fan out - cap the number of tasks explicitly
  DATA(parallel_runner) = NEW cl_abap_parallel( p_num_tasks = 4 ).

  parallel_runner->run_inst( EXPORTING p_in_tab  = worker_instances
                             IMPORTING p_out_tab = DATA(task_results) ).

  " 3. Fan in - same count and order as the input table
  LOOP AT task_results INTO DATA(task_result).
    IF task_result-inst IS INITIAL.
      " Task failed (e.g. "Time limit exceeded") - decide: retry the
      " package sequentially, collect for a rerun, or raise.
      handle_failed_package( package_index = sy-tabix
                             message_info  = task_result-message ).
      CONTINUE.
    ENDIF.

    DATA(finished_worker) = CAST lcl_square_worker( task_result-inst ).
    APPEND LINES OF finished_worker->get_squared_numbers( )
           TO all_squared_numbers.
  ENDLOOP.
ENDMETHOD.
```

A complete, self-contained `if_oo_adt_classrun` version (global class + CCIMP worker, plus a sequential comparison in the style of the performance cheat sheet) is in [examples/run_inst_package_processing.abap](examples/run_inst_package_processing.abap).

## Collecting results and per-task error handling

Facts about the output table (SAP parallel-processing documentation):

- `p_out_tab` has **the same number of entries and the same order** as `p_in_tab` — row 3 of the output belongs to instance 3 of the input. `sy-tabix` in the merge loop identifies the package.
- On **success** the row's `inst` component carries the processed instance — `CAST` it back to the worker class to reach the result attributes.
- On **failure** the row carries **message information** instead; a timed-out task reports "Time limit exceeded". SAP's own example loops with `WHERE inst IS NOT INITIAL` to filter successful rows.

Error-handling policy belongs in the orchestrator, not the worker:

- **Catch inside `do( )`** for *expected* per-unit errors: store the error in a result attribute (e.g., a `failed_keys` table) so the unit "succeeds" as a task and reports business failures in-band. A classical exception escaping `do( )` inside an RFC task cannot reach the caller's `CATCH`.
- **React to `message`-only rows** for *infrastructure* failures (timeout, task abort): the input instance still exists in your session with its input state, so you can re-run those packages sequentially as a fallback.
- The constructor's `p_abort_on_error` flag exists in the released signature for stop-on-first-error behavior; its exact semantics are documented in the class's ABAP Doc in ADT — verify there before relying on it (see [references/cl-abap-parallel-api.md](references/cl-abap-parallel-api.md)).

## The xstring-based run variant

The older, lower-level model — still useful when the input/output is *already* a byte stream (files, serialized XML/JSON) or when you must control serialization yourself:

1. **Subclass `CL_ABAP_PARALLEL`** and redefine its `do` method: `p_in TYPE xstring` in, `p_out TYPE xstring` out (plus optional `p_in_all`, an xstring shipped identically to *every* task — e.g. shared customizing).
2. Serialize each work unit into an `xstring` (e.g. `CALL TRANSFORMATION id SOURCE ... RESULT XML data_xml`), collect them in `cl_abap_parallel=>t_in_tab`.
3. Call `run( EXPORTING p_in_tab = ... IMPORTING p_out_tab = ... )`; deserialize each row's output xstring.

```abap
CLASS zcl_render_worker DEFINITION PUBLIC
    INHERITING FROM cl_abap_parallel FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS do REDEFINITION.
ENDCLASS.

CLASS zcl_render_worker IMPLEMENTATION.
  METHOD do.
    CALL TRANSFORMATION id SOURCE XML p_in RESULT input = DATA(work_unit).
    " ... process work_unit ...
    CALL TRANSFORMATION id SOURCE output = work_unit RESULT XML p_out.
  ENDMETHOD.
ENDCLASS.
```

Prefer `run_inst` unless you have a concrete reason: it removes the hand-written serialization and keeps input, logic, and result together in one typed object (the same recommendation SAP community material converges on). See [examples/run_xstring_variant.abap](examples/run_xstring_variant.abap) for a complete skeleton.

## Sizing — constructor parameters and work-process mechanics

Verified constructor signature (all parameters optional): `p_num_tasks`, `p_timeout`, `p_percentage`, `p_num_processes`, `p_local_server`, `p_abort_on_error`, `p_keeping_tasks`.

What SAP documents publicly:

| Parameter | Documented semantics |
|---|---|
| `p_percentage` | Share of the dialog work processes to use for the aRFC tasks. **Default: 50 percent** if nothing is specified. Community material: when both `p_percentage` and `p_num_tasks` are supplied, the percentage governs |
| `p_local_server` | `'X'` = use only the current application server's processes; default is **all servers** of the system |
| `p_num_tasks` | Fixed number of parallel tasks to use (community-documented; cap it explicitly for predictable load) |
| `p_timeout`, `p_num_processes`, `p_abort_on_error`, `p_keeping_tasks` | Names/types are part of the released signature; SAP's public page does not spell out their semantics — **read the class's ABAP Doc in ADT** before using them (the "Time limit exceeded" task message indicates timeout enforcement is real) |

Mechanics to size against:

- Tasks run as **aRFC on free dialog work processes**. **Two free dialog processes per server are always retained** by the system for dialog users — you can never consume everything.
- The general aRFC resource rule (ABAP keyword documentation on `CALL FUNCTION ... STARTING NEW TASK`): an application server instance used for parallel processing must have **at least three dialog work processes, one of them currently free**.
- More tasks help only while free work processes and non-conflicting resources (DB locks, enqueues) exist. Measured community examples show throughput scaling from 1 → 3 → 9 tasks, but the curve flattens as tasks contend.
- Leave capacity deliberately: on shared systems prefer a modest `p_num_tasks` (or the default 50% share) over `p_percentage = 100`.

## Transactional caveats — each task is its own LUW

Every task is a separate RFC session on some work process, so ([abap-sap-luw](../abap-sap-luw/SKILL.md)):

| Aspect | Consequence |
|---|---|
| SAP LUW / DB LUW | Each task opens and ends **its own LUW**. Database changes made in a task are committed independently of the caller and of other tasks — there is **no all-or-nothing across tasks** |
| Caller's uncommitted data | Invisible to the tasks (different DB session). Commit or pass the data as instance state |
| Locks (`ENQUEUE`) | Caller's enqueues are *held against* the tasks like against any foreign session — tasks writing to caller-locked objects will fail or wait; tasks competing for the same lock serialize or fail |
| Session state | No shared internal tables, no shared buffers, no `EXPORT/IMPORT MEMORY` across tasks, no static class attributes shared with the caller — the *only* channel is the serialized instance (or xstring) in and out |
| User/authorization context | Tasks run under the caller's user — authorization checks behave as in the caller, but transaction-bound context (e.g. update-task registrations of the caller) does not travel along |
| RAP | Do not fan out *casually* from inside a RAP interaction phase or save sequence — tasks commit independently of the caller's LUW. Heavy fan-out belongs in application jobs / bgPF ([abap-background-processing](../abap-background-processing/SKILL.md)). That same independence, used deliberately, is the RAP commit-isolation pattern below |

Design workers to be **self-contained and idempotent** where possible: a failed task ("Time limit exceeded") may or may not have committed partial work before dying — idempotent packages make sequential re-runs safe.

### RAP commit isolation — persisting another BO from a behavior implementation

Inside a RAP handler or saver, `COMMIT ENTITIES` / `COMMIT WORK` terminates with `BEHAVIOR_ILLEGAL_STMT_IN_CALL` (ABAP Cloud contexts — see [abap-sap-luw](../abap-sap-luw/SKILL.md)). A `CL_ABAP_PARALLEL` worker is an isolation escape hatch — its task runs in its own aRFC session with its own SAP LUW, so the worker's `do` method may legally `MODIFY ENTITIES` + `COMMIT ENTITIES` another BO — but use it **only** when the two BOs must be genuinely decoupled transactions: an attempt log, a counter, an audit trail that must survive the caller's rollback. For anything that merely needs to happen *after* the caller's transaction succeeds (a cross-BO side effect, a notification), prefer an after-commit bgPF operation or a business event instead — see [abap-background-processing](../abap-background-processing/SKILL.md).

Use it deliberately, not by default:

- **Default remains same-LUW EML**: modifying the other BO *without* commit from the handler joins the caller's RAP LUW — atomic, and no dump. Reach for isolation only when genuine transactional independence is the requirement, not a side effect.
- **Rollback-consistency implication**: the isolated commit is final and unconditional — if the caller's RAP transaction later rolls back, the worker's independent `COMMIT ENTITIES` does **not** roll back with it. The other BO's change stands even though the transaction that triggered it was undone; design for that (idempotency, compensating action, or accept the inconsistency as a documented trade-off).
- For work that should run only *after* the caller commits — rather than genuinely independently of it — prefer bgPF or a business event over parallel isolation.

Decision path and a worked handler example: [rap-actions-validations-determinations](../rap-actions-validations-determinations/SKILL.md), "Calling and committing another BO from an action".

## ABAP Cloud status and classic alternatives

`CL_ABAP_PARALLEL` is a **released ABAP class** — it appears in the released-classes cheat sheet (22) with a complete `run_inst` example and in the released-API list of [abap-cloud-development](../abap-cloud-development/SKILL.md). `IF_ABAP_PARALLEL` is likewise released. That makes it the parallel-processing option for ABAP for Cloud Development; confirm release state for your own system in ADT's *Released Objects* view.

| Technique | Environment | Model | Notes |
|---|---|---|---|
| `CL_ABAP_PARALLEL` | **ABAP Cloud + classic** (released) | Synchronous fan-out/fan-in over aRFC | This skill's subject; OO, typed results, per-task messages |
| `CALL FUNCTION ... STARTING NEW TASK` (aRFC) | Classic only | Async function calls; `CALLING meth ON END OF TASK` / `PERFORMING subr ON END OF TASK` callbacks; `DESTINATION IN GROUP` for RFC server groups | Maximum control, maximum boilerplate (task bookkeeping, `WAIT UNTIL`, receive logic); what `CL_ABAP_PARALLEL` wraps for you |
| SPTA framework (`SPTA_PARA_PROCESS_START_2`) | Classic only | Packet-oriented parallel framework around RFC-enabled function modules | Long-standing on-premise workhorse for mass runs; not part of the cloud language scope |
| bgRFC | Classic (directly); wrapped by bgPF in cloud | Reliable queued units (EO/EOIO), transactional | Reliability/ordering, not elapsed-time fan-in |
| bgPF | ABAP Cloud + S/4HANA 2023+ | Async **after commit**, Exactly Once | Complements, not replaces, `CL_ABAP_PARALLEL`: use bgPF when the caller must not wait; use `CL_ABAP_PARALLEL` when the caller needs the merged result now ([abap-background-processing](../abap-background-processing/SKILL.md)) |
| Application Jobs | ABAP Cloud + classic | Scheduled background runs | Split a huge run into several jobs for coarse parallelism with admin visibility |

## Testing and debugging parallel code

- **`p_debug` on `run`/`run_inst`**: runs all tasks **sequentially in the current session without RFC** — breakpoints inside `do( )` work, and unit tests become deterministic. Wire it to a constructor parameter of your orchestrator so tests can force sequential mode.
- **Unit-test the worker directly**: `do( )` is a plain method on a plain object — instantiate the worker with a fixture package, call `if_abap_parallel~do( )`, assert on the getter. No framework needed ([abap-unit-tdd](../abap-unit-tdd/SKILL.md) patterns apply unchanged).
- **Observing real parallelism**: the cheat-sheet demo technique — every worker appends `utclong_current( )` timestamps to an instance table; after the run, merge and `SORT ... BY time_stamp` to see interleaving (tasks starting before earlier ones finish, identical timestamps across instances).
- **Don't trust `WAIT` for correctness**: the cheat-sheet demo adds `WAIT UP TO 1 SECONDS` purely to make the visualization tidy; your production merge logic needs no wait — `run_inst` returns with the completed result table.
- **Test the failure path**: force a timeout/failure in a test package and verify the orchestrator's `message`-row handling (skip, retry, raise) — the merge loop above is exactly where silent data loss hides.

## Quick Reference

| Task | Code |
|---|---|
| Worker class | `INTERFACES if_abap_parallel.` + state in attributes + logic in `if_abap_parallel~do( )` (no parameters) |
| Input table | `DATA workers TYPE cl_abap_parallel=>t_in_inst_tab.` + `APPEND NEW zcl_worker( package ) TO workers.` |
| Fan out (default sizing: 50% of free dialog WPs, all servers) | `NEW cl_abap_parallel( )->run_inst( EXPORTING p_in_tab = workers IMPORTING p_out_tab = DATA(results) ).` |
| Fan out, capped | `NEW cl_abap_parallel( p_num_tasks = 4 )->run_inst( ... )` |
| Local server only | `NEW cl_abap_parallel( p_local_server = abap_true )` |
| Share of free dialog WPs | `NEW cl_abap_parallel( p_percentage = 25 )` |
| Merge results | `LOOP AT results INTO DATA(row). DATA(worker) = CAST zcl_worker( row-inst ). ... ENDLOOP.` |
| Detect failed task | Row with `inst` initial / `message` filled (e.g. "Time limit exceeded"); input order = output order, so `sy-tabix` maps back to the package |
| Sequential debugging | `run_inst( EXPORTING p_in_tab = workers p_debug = abap_true IMPORTING ... )` |
| xstring variant | Subclass `cl_abap_parallel`, `METHODS do REDEFINITION` (`p_in`/`p_out` xstring), call `run( p_in_tab = xstring_tab )` |
| Same payload to every task (`run`) | `p_in_all TYPE xstring` on `run` |

## Common Mistakes

| Wrong | Right |
|---|---|
| Parallelizing a loop whose body is per-row SQL | Fix the SQL first — set-based statements/pushdown ([abap-sql-performance](../abap-sql-performance/SKILL.md)); parallel tasks multiply DB pressure, not throughput |
| One task per row (thousands of tiny tasks) | Package the workload; SAP guidance: units under ~200 ms aren't worth a task — bundle them |
| Reading results from the original instances (`inst1->result`) after `run_inst` | Read from `p_out_tab`'s `inst` component (`CAST` back) — the work happened on serialized copies in other sessions |
| Merging with `LOOP AT results ... WHERE inst IS NOT INITIAL` and never looking at the rest | Handle `message`-only rows explicitly (retry, log, raise) — the output/input order mapping tells you *which* package died |
| Expecting one `COMMIT`/`ROLLBACK` to govern all tasks | Each task is its own LUW; no cross-task rollback — design idempotent packages ([abap-sap-luw](../abap-sap-luw/SKILL.md)) |
| Sharing state via static attributes, `EXPORT ... TO MEMORY`, or caller's buffers | The only channel is the serialized instance (or xstring) — put everything the task needs into instance state |
| Worker state that can't survive serialization (open cursors, UI handles, unserializable references) | Keep worker state to plain data (`IF_ABAP_PARALLEL` includes `IF_SERIALIZABLE_OBJECT`) |
| `p_percentage = 100` on a shared system | Leave headroom — default is 50% of free dialog WPs, and the system always keeps two free dialog WPs per server anyway; cap with a modest `p_num_tasks` |
| Letting exceptions escape `do( )` and expecting to `CATCH` them in the caller | Catch inside `do( )`, store business errors in result attributes; infrastructure failures arrive as `message` rows |
| Fanning out inside a RAP save sequence or between `ENQUEUE` and `COMMIT` | Tasks commit independently and collide with the caller's locks — fan out from a plain orchestrator, or go async via bgPF/jobs ([abap-background-processing](../abap-background-processing/SKILL.md)) |
| Debugging by setting breakpoints in `do( )` during a real parallel run | Run with `p_debug = abap_true` (sequential, no RFC) or unit-test the worker in isolation |
| Guessing semantics of `p_timeout` / `p_num_processes` / `p_keeping_tasks` | Only `p_percentage` and `p_local_server` are publicly documented in detail — read the class's ABAP Doc in ADT before using the rest |
| Using `CALL FUNCTION ... STARTING NEW TASK` or SPTA in ABAP for Cloud Development | Not in the cloud language scope — `CL_ABAP_PARALLEL` is the released option ([abap-cloud-development](../abap-cloud-development/SKILL.md)) |

## References

- [references/cl-abap-parallel-api.md](references/cl-abap-parallel-api.md) — verified API surface: types, constructor parameters, `run`/`run_inst`/`fork`/`join`, `IF_ABAP_PARALLEL`, error reporting, what is and is not publicly documented
- [examples/run_inst_package_processing.abap](examples/run_inst_package_processing.abap) — complete classrun example: CCIMP worker class, packaging, fan-out/fan-in, failure handling, sequential comparison
- [examples/run_xstring_variant.abap](examples/run_xstring_variant.abap) — the subclass-and-redefine-`do` skeleton for the xstring-based `run`
- **Parallel Processing (ABAP Platform, official):** https://help.sap.com/docs/ABAP_PLATFORM_NEW/b5670aaaa2364a29935f40b16499972d/1193647aaf804eee8d8356ffe4096423.html
- **Same page, SAP BTP ABAP environment:** https://help.sap.com/docs/btp/sap-business-technology-platform/parallel-processing
- **Same page, fetchable Markdown mirror (SAP-docs on GitHub):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/parallel-processing-1193647.md
- **ABAP keyword documentation — `CALL FUNCTION ... STARTING NEW TASK` (aRFC):** https://help.sap.com/doc/abapdocu_758_index_htm/7.58/en-US/abapcall_function_starting.htm
- **abap-cheat-sheets 22 — Released ABAP Classes, Parallel Processing section (`CL_ABAP_PARALLEL` + runnable example):** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/22_Released_ABAP_Classes.md
- **abap-cheat-sheets 32 — Performance Notes (parallel vs sequential example, `t_in_inst_tab`, CCIMP worker):** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/32_Performance_Notes.md
- **Released API signature mirror (community, Steampunk 2205):** https://abapedia.org/steampunk-2205-api/cl_abap_parallel.clas.html
- **Community walkthrough of both variants incl. `p_debug` and task-count measurements:** https://software-heroes.com/en/blog/abap-cloud-parallel-processing
- Linked skills: [abap-background-processing](../abap-background-processing/SKILL.md), [abap-sap-luw](../abap-sap-luw/SKILL.md), [abap-sql-performance](../abap-sql-performance/SKILL.md), [abap-cloud-development](../abap-cloud-development/SKILL.md)
