# CL_ABAP_PARALLEL — verified API surface

Verification status of every item below:

- **[SAP doc]** — SAP Help Portal page *Parallel Processing* (help.sap.com, doc id 1193647; Markdown mirror in the SAP-docs GitHub org), or the abap-cheat-sheets (SAP-samples).
- **[signature]** — released-API signature confirmed via the Steampunk released-objects mirror (abapedia.org, 2205). Names and types are reliable; where SAP publishes no prose for a parameter, its *behavior* is marked "verify in ABAP Doc".
- **[community]** — SAP community material (software-heroes.com walkthrough); reliable in practice, not an SAP guarantee.

SAP's own pointer for full semantics: *"For more information and examples, see the ABAP Doc comments of the `CL_ABAP_PARALLEL` class in the ABAP development tools for Eclipse (ADT)."* When in doubt, open the class in ADT — the ABAP Doc is the authoritative spec.

Release status: `CL_ABAP_PARALLEL` and `IF_ABAP_PARALLEL` are **RELEASED** for ABAP for Cloud Development. **[SAP doc]** ([cheat sheet 22](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/22_Released_ABAP_Classes.md) lists the class among released classes) **[signature]**

## Interface IF_ABAP_PARALLEL

| Element | Details | Status |
|---|---|---|
| `do( )` | The work method. **No parameters** — input and output travel exclusively through the implementing object's instance state | **[SAP doc]** (all published examples implement it parameterless) |
| Included interface | `IF_SERIALIZABLE_OBJECT` — instances are serialized to the task and back; keep attribute state to serializable data | **[signature]** |

Worker skeleton (SAP's own example uses a local class; keys/state via constructor):

```abap
CLASS lcl_parallel_task DEFINITION.
  PUBLIC SECTION.
    INTERFACES if_abap_parallel.
    METHODS constructor IMPORTING iv_input_value TYPE i.
  PRIVATE SECTION.
    DATA mv_input_value  TYPE i.
    DATA mv_result_value TYPE i.
ENDCLASS.

CLASS lcl_parallel_task IMPLEMENTATION.
  METHOD constructor.
    me->mv_input_value = iv_input_value.
  ENDMETHOD.

  METHOD if_abap_parallel~do.
    mv_result_value = mv_input_value * mv_input_value.
  ENDMETHOD.
ENDCLASS.
```

## Types

| Type | Content | Status |
|---|---|---|
| `t_in_inst_tab` | Input table for `run_inst` / `fork_inst`: references to `IF_ABAP_PARALLEL` implementations | **[SAP doc]** |
| `t_out_inst` | Result row for one task. Verified components: `inst` (the processed instance; bound on success) and `message` (error/status info; filled on failure, e.g. timeout). Do not assume further components without checking ADT | **[SAP doc]** for `inst`/`message`; full component list: verify in ABAP Doc |
| `t_out_inst_tab` | Output table of `run_inst`: **same number of rows and same order as the input table** | **[SAP doc]** |
| `t_in_tab` | Input table for `run` / `fork`: one `xstring` per work unit (caller serializes) | **[signature]** **[community]** |
| `t_out` / `t_out_tab` | Result row/table of `run`: the task's output `xstring` plus message info; exact component names: verify in ABAP Doc | **[signature]** (names exist); components not publicly documented |
| `t_task_inst` | Reference type for `IF_ABAP_PARALLEL` instances | **[signature]** |

## Constructor

```abap
" All parameters optional [signature]:
NEW cl_abap_parallel(
    p_num_tasks      = ...   " TYPE i
    p_timeout        = ...   " TYPE i
    p_percentage     = ...   " TYPE i
    p_num_processes  = ...   " TYPE i
    p_local_server   = ...   " TYPE abap_bool
    p_abort_on_error = ...   " TYPE abap_bool
    p_keeping_tasks  = ... ) " TYPE abap_bool
```

| Parameter | Semantics | Status |
|---|---|---|
| `p_percentage` | Share of the dialog work processes used for the aRFC tasks. *"If nothing is specified here, a value of 50 percent is used."* Values 0–100 | **[SAP doc]** |
| `p_local_server` | `'X'` → only processes of the current application server are used; default: dialog processes of **all servers** of the SAP system | **[SAP doc]** |
| `p_num_tasks` | Fixed number of parallel tasks. When both `p_num_tasks` and `p_percentage` are supplied, the percentage governs the effective limit | **[community]**; verify precedence details in ABAP Doc |
| `p_timeout` | Timeout for task execution (unit not publicly documented — presumably seconds). Related observable behavior: a timed-out task's result row carries the message *"Time limit exceeded"* | **[signature]**; message text **[SAP doc]**; unit/scope: verify in ABAP Doc |
| `p_num_processes` | Name/type in the released signature; **no public SAP prose found** distinguishing it from `p_num_tasks` — do not guess, read the ABAP Doc in ADT | **[signature]** only |
| `p_abort_on_error` | Name/type in the released signature; presumably stop-scheduling-on-first-error — **verify in ABAP Doc** before use | **[signature]** only |
| `p_keeping_tasks` | Name/type in the released signature; presumably keeps tasks alive for reuse across runs — **verify in ABAP Doc** before use | **[signature]** only |

Hard system floor regardless of settings: *"two of the free dialog processes on a server are always retained by the system for dialog requests."* **[SAP doc]**

## Methods

### run_inst — instance-based fan-out/fan-in

```abap
lo_parallel_runner->run_inst(
  EXPORTING p_in_tab  = lt_worker_instances      " t_in_inst_tab
            p_debug   = abap_false            " optional
  IMPORTING p_out_tab = DATA(lt_task_results) ). " t_out_inst_tab
```

- Serializes each input instance, executes `if_abap_parallel~do( )` in an aRFC task on a free dialog work process, returns the processed instances. **[SAP doc]**
- Synchronous: when the call returns, the result table is complete (SAP's example reads results immediately after the call — no `WAIT` needed). **[SAP doc]**
- `p_debug = abap_true`: all units run **sequentially in the current session, no RFC** — for debugging/deterministic tests. **[community]** **[signature]**

### run — xstring-based fan-out/fan-in

```abap
lo_parallel_runner->run(
  EXPORTING p_in_tab  = lt_serialized_inputs     " t_in_tab (xstrings)
            p_in_all  = lv_shared_payload        " optional xstring, sent to EVERY task
            p_debug   = abap_false            " optional
  IMPORTING p_out_tab = DATA(lt_task_outputs) ). " t_out_tab
```

Requires a **subclass of `CL_ABAP_PARALLEL`** with `METHODS do REDEFINITION`:

```abap
" Redefinition point in the subclass [signature] [community]:
" do( IMPORTING p_in     TYPE xstring   " this task's work unit
"               p_in_all TYPE xstring   " optional shared payload
"     EXPORTING p_out    TYPE xstring ) " this task's result
```

The caller serializes/deserializes (e.g. `CALL TRANSFORMATION id SOURCE ... RESULT XML ...`). **[community]**

### Split fan-out / fan-in and other methods

Present in the released signature **[signature]**; SAP publishes no prose walkthrough for them — confirm semantics in the class's ABAP Doc before use:

| Method | Signature (verified names) | Presumed role — verify in ABAP Doc |
|---|---|---|
| `fork` | `p_in_tab`, `p_in_all`, `p_debug` (all optional) | Start xstring tasks without waiting |
| `join` | exports `p_out_tab` | Wait for / collect `fork` results |
| `fork_inst` | `p_in_tab`, `p_debug` (optional) | Start instance tasks without waiting |
| `join_inst` | exports `p_out_tab` | Wait for / collect `fork_inst` results |
| `terminate` | — | Stop processing |
| `start_inst_in_background` | `p_inst` (`IF_ABAP_PARALLEL` ref), `p_background_unit` (object ref), `p_time_out` (i, optional) | Single instance into a background unit |
| `end_task` / `end_task_inst` (static) | `p_task TYPE clike` | Task-callback plumbing (framework-internal use) |

## Result and error handling — verified facts

1. Output table: **same entry count and same order** as the input table → positional mapping input package ↔ result row. **[SAP doc]**
2. Success row: `inst` bound; `CAST` to the worker class for results. SAP's example filters `WHERE inst IS NOT INITIAL`. **[SAP doc]**
3. Failure row: message information instead of a usable instance; documented example: *"Time limit exceeded"* for a timed-out task. **[SAP doc]**
4. Sizing guidance: operations **below ~200 ms** are inefficient to parallelize (data-transport overhead); bundle several short operations into one task. **[SAP doc]**
5. Underlying mechanics: tasks are **asynchronous RFC** on free dialog work processes; the general aRFC rule (keyword documentation on `CALL FUNCTION ... STARTING NEW TASK`) is that an instance used for parallel processing needs at least three dialog work processes with one currently free. **[SAP doc]**

## Not publicly verifiable (as of 2026-08) — handle with care

- Exact semantics of `p_num_processes`, `p_keeping_tasks`, `p_abort_on_error`, and the `p_timeout` unit.
- Full component lists of `t_out` and `t_out_inst` beyond `inst`/`message`.
- Precise `fork`/`join`/`terminate`/`start_inst_in_background` behavior (blocking, reuse, cancellation).
- Which internal function modules/classes dispatch the tasks (community posts name internals, but the pages are not reliably reachable and the internals are unreleased anyway — never call them directly).

For all of these: the class's **ABAP Doc in ADT** on your system release is the source of truth.

## Sources

- Parallel Processing (ABAP Platform): https://help.sap.com/docs/ABAP_PLATFORM_NEW/b5670aaaa2364a29935f40b16499972d/1193647aaf804eee8d8356ffe4096423.html
- Markdown mirror: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/parallel-processing-1193647.md
- Released signature mirror: https://abapedia.org/steampunk-2205-api/cl_abap_parallel.clas.html
- `CALL FUNCTION ... STARTING NEW TASK`: https://help.sap.com/doc/abapdocu_758_index_htm/7.58/en-US/abapcall_function_starting.htm
- abap-cheat-sheets 22 (released classes) and 32 (performance): https://github.com/SAP-samples/abap-cheat-sheets
- Community walkthrough: https://software-heroes.com/en/blog/abap-cloud-parallel-processing
