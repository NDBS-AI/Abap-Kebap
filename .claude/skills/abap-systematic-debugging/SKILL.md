---
name: abap-systematic-debugging
description: Use when an ABAP runtime problem needs root cause analysis — a short dump (ST22), an application log error (SLG1), a performance regression (ST05 SQL trace, SAT runtime), an inconsistency between dev and prod, a "works on my system" report, or a flaky job (SM37). Forces a hypothesis-driven workflow so you stop guessing, start measuring, and stop fixing the wrong layer. This is the diagnosis process — once a trace points at a specific SQL statement, the fix itself lives in abap-sql-performance.
---

# ABAP Systematic Debugging

## Overview

A disciplined, hypothesis-driven workflow for ABAP runtime problems. Most ABAP debugging fails for the same reason most software debugging fails: the engineer pattern-matches a fix from memory before they have measured the actual symptom. This skill forces the order: **symptom → measurement → hypothesis → verification → fix → regression test**.

**Core principle:** debug from first principles. The system is not magic. Every dump, every wrong number, every slow query has a *deterministic* cause. Your job is to *show* the cause, not assume it.

## When to Use

- A short dump appeared (ST22). You need to know whether it's a code defect, configuration, data, or environment.
- A program suddenly got slower (or it always was slow and someone finally noticed).
- An application log shows an error you can't trace from the message alone (SLG1, BAL).
- A scheduled job (SM37) is failing or hanging.
- Results in dev ≠ results in QA ≠ results in prod with the same input.
- A user reports "the screen froze" / "the document didn't post" / "the amount is wrong."

**When NOT to use:**
- You're writing new code that doesn't work yet — that's an authoring problem; the test you didn't write would tell you faster than the debugger. See [abap-unit-tdd](../abap-unit-tdd/SKILL.md).
- You're reviewing code statically — that's [abap-code-review](../abap-code-review/SKILL.md).
- You already know the root cause and just need the syntax — go straight to the fix, no need to debug.

## The Loop

```
   ┌──> 1. Pin the symptom (what / where / when / who)
   │
   │    2. Gather raw evidence (don't theorize yet)
   │
   │    3. Form a hypothesis (smallest explanation)
   │
   │    4. Choose a verification (cheapest measurement
   │       that distinguishes this hypothesis)
   │
   │    5. Run it. Did the evidence confirm or refute?
   │
   ├──< 6. Refuted? Drop hypothesis, go to 3 with new candidate.
   │
   │    7. Confirmed? Root cause known. Fix at the right layer.
   │
   └──< 8. Write a regression test that would have caught this
          (ABAP Unit or equivalent). Then close.
```

The loop is short. Each iteration should take minutes, not hours. If you're spending two hours on "I think it's the buffer" without a confirming measurement, you have skipped step 4.

## Step 1 — Pin the symptom

Write down, in plain text:

- **What** is wrong? ("Order 4500001234 has invoice total 19.50 instead of 20.50.")
- **Where** did the wrong thing happen? Program / transaction / RFC endpoint / batch job? Be specific. (`SM37` → job name → step → step's program.)
- **When**? First seen / always / since SP upgrade / only after 18:00 / only on month-end?
- **Who**? One user / one role / one company code / system-wide?
- **Reproducible?** Yes / no / sometimes. Reproducibility decides whether you can use the debugger or you must rely on traces and logs.

If you can't answer "where" with object/include/line precision after step 1 — e.g. `CL_MY_CLASS, method GET_DATA, line 42`, the way ST22 and the ABAP Debugger report it (not a filesystem path) — go re-read the dump or the log. You're not ready for hypothesis yet.

## Step 2 — Gather raw evidence

The tools to know, in roughly this order:

| Tool | T-code | Use for | What you get |
|---|---|---|---|
| Short dump | `ST22` | Hard ABAP runtime errors (unhandled exceptions and uncatchable errors that terminate the program) | Dump text + ABAP stack + variable dump + last 10 SQL statements (`ST22` "Last 10 statements") |
| System log | `SM21` | OS-level problems, work-process restarts, db disconnects | Time-correlated events around the dump |
| Application log | `SLG1` (UI) / `BAL_*` (API) | Custom application errors written deliberately | Log entries with context messages |
| Batch job log | `SM37` → "Job log" | Background job behavior, step start/end, error messages | Job log; spool list per step |
| SQL trace | `ST05` ("Performance trace") | "Why is this slow / which DB calls happen / are we doing N+1" | Per-statement timing, executions, rows, exec plan link |
| Runtime analysis | `SAT` (SE30 in older) | "Where is CPU spent inside ABAP?" | Method-level call tree with time |
| Single-step trace | `ST12` (managed service tools) | When you need both ABAP + SQL on the same timeline | Combined call tree |
| ABAP debugger | `/h` | Interactive root-cause hunt where reproducible | Live state inspection, breakpoints, watchpoints |
| Where-used | ADT `Ctrl+Shift+G` / SAP GUI `Ctrl+Shift+F3` | "Who calls this method / who writes this field?" | Static call graph |
| Code Inspector / ATC | `SCI` / `SATC` | Static analysis for known patterns | Findings list |
| Memory inspector | `S_MEMORY_INSPECTOR` | Memory growth, leaks | Heap snapshots |

**Capture before you act.** Save the dump (export from ST22), save the trace (ST05 → save). Once a user re-runs the job, the trace is gone. The dump in ST22 also rolls over.

See [references/common-dumps.md](references/common-dumps.md) for a triage table of the most frequent dump categories. See [references/sql-trace-reading.md](references/sql-trace-reading.md) for how to read an ST05 output.

## Step 3 — Form a hypothesis

A hypothesis is a **single, falsifiable statement** about the cause. "It might be the buffer or it might be the SELECT" is two hypotheses; pick the more likely one.

Good hypothesis traits:
- **Specific to a line or a path.** "`READ TABLE lt_x WITH KEY id = ls_customer-bukrs` reads `bukrs` from an uninitialized structure when `ls_customer` is bound but not loaded."
- **Falsifiable cheaply.** "Setting a breakpoint there and looking at `ls_customer-bukrs` value will refute or confirm in 5 seconds."
- **One step from the symptom.** Don't jump to "DB hardware". Start at the line where the wrong value appears and walk *one step backward*.

**Anti-pattern:** "It's flaky, must be a race condition." That is a category, not a hypothesis. Force yourself to name the *specific* shared resource: "`cl_singleton=>get_instance( )` returns a stale price table when two work processes initialize within ~10ms because the LOAD-OF-PROGRAM only runs once per session and Session A finished before the price update."

## Step 4 — Pick the cheapest verification

You have a hypothesis. What measurement will *distinguish* it from the alternates?

| Hypothesis flavor | Cheapest verification |
|---|---|
| "Variable has wrong value at line X" | Breakpoint at X, inspect. Or insert one-shot `BREAK-POINT` and let the user reproduce. |
| "This SQL runs N times when it should run once" | ST05 trace, look at execution count |
| "This method is slow because of a nested loop" | SAT — look at "Net time" on the method |
| "Two transactions race on the same row" | ST05 + SM50, or `ST04`/`DBACOCKPIT` exclusive-lock-wait analysis; also check `SM12` lock entries while the bad scenario runs |
| "Customizing differs between systems" | SE16 / SM30 on the customizing table in both systems, diff |
| "Authorization is missing" | SU53 right after the failure |
| "SAP Note already fixed this in higher SP" | OSS Note search on the dump short text; check current SP/component version (`System → Status`) |

**Pick the one that takes seconds to run, not the one that takes a day to set up.**

## Step 5 — Run and update

If the verification confirms the hypothesis, you're at step 7. If it refutes, drop the hypothesis. Don't keep it on life support ("well, maybe sometimes…"). Form a new one based on what the refutation taught you, and go to step 4 again.

Write down (mentally or in a scratch note) what each refutation eliminated. Two refuted hypotheses about "the value of `ls_customer-bukrs`" both being correct mean the value is fine; stop looking there.

## Step 7 — Fix at the right layer

Now you know the root cause. Three traps to avoid:

1. **Fix the symptom, not the cause.** Wrapping the dump with `TRY/CATCH cx_root` is not a fix; it is a longer line of code that produces wrong results silently. Fix the line where the wrong value originates.

2. **Fix above the cause.** If the cause is "DDIC field too short for the new business value", fixing it in *one* report leaves the next twenty broken. Fix it in DDIC, run where-used, patch the consumers in the same transport (or sequenced ones).

3. **Fix at the right boundary.** If the cause is "the input data is wrong, the code handled it as best it could", the fix is upstream (validation at the boundary), not downstream (special-case the value).

If the cause is a missing SAP Note, apply the note; do not write a custom workaround that the next upgrade will quietly remove.

## Step 8 — Regression test

Convert the root cause into a test. For ABAP that usually means an ABAP Unit test that exercises the same input through the same method and asserts the now-correct output. See [abap-unit-tdd](../abap-unit-tdd/SKILL.md). For dump categories where ABAP Unit isn't the right tool (e.g. database deadlock), document the failure mode in the application log or add an ATC custom check.

A bug that doesn't earn a regression test will return.

## "Is" vs "appears to be"

When you describe what the code does, say what you can *prove*. When you describe what you think it intends, mark it as inference.

> "The method `recalc` *reads* `gv_invoice_total` (line 142) and *writes* `et_results-total` (line 187). It *appears to* refresh the total after a tax change — the comment on line 130 says so, but `gv_invoice_total` is also written by `cl_other_helper` on line 220, so the comment may be stale."

The discipline saves hours when the comment IS stale.

## Quick reference — Most common ABAP dump categories

| Dump | First thing to check | Skill / reference |
|---|---|---|
| `TIME_OUT` | ST05 trace of the program; look for a runaway loop or unbounded SELECT | [abap-sql-performance](../abap-sql-performance/SKILL.md) |
| `MEMORY_NO_MORE_PAGING`, `TSV_TNEW_PAGE_ALLOC_FAILED` | S_MEMORY_INSPECTOR; look for unbounded internal table growth | [references/common-dumps.md](references/common-dumps.md) |
| `MESSAGE_TYPE_X` | Read message + class + number; `SE91` to find caller intent | [references/common-dumps.md](references/common-dumps.md) |
| `CALL_FUNCTION_OPEN_ERROR` | SM59 destination test; destination user (`SU01`) / network | [references/common-dumps.md](references/common-dumps.md) |
| `ITAB_DUPLICATE_KEY` | Reproduce; inspect the duplicate row at insertion | [references/common-dumps.md](references/common-dumps.md) |
| `OBJECTS_OBJREF_NOT_ASSIGNED` | Stack frame above; track where the ref was lost | [references/common-dumps.md](references/common-dumps.md) |
| `UNCAUGHT_EXCEPTION` (class-based) / `RAISE_EXCEPTION` (classic) | Read exception class; look at `RAISING` of the throwing method | [abap-clean-style §errors](../abap-clean-style/SKILL.md#errors) |
| `DBSQL_*` family | Vendor-specific DB error; check `dbsl` text + SAP Note | [references/common-dumps.md](references/common-dumps.md) |
| `LOAD_PROGRAM_*` | Inactive object; check `SE80`; look for missing transport | — |

Full triage table: [references/common-dumps.md](references/common-dumps.md).

## ST05 SQL trace — what to look for

In rough priority order when you open a trace:
1. **Aggregated by SQL statement.** Sort by total duration. The top one is almost always the problem.
2. **Identical SELECT runs.** Same statement, many executions = N+1 antipattern. Move the SELECT out of the loop into a single FAE (with the empty-check) or a JOIN.
3. **Redundant SELECTs.** Same statement, called from different places in the same business operation. Cache.
4. **`SELECT *` on wide tables.** Field list under "Recording Layer" — if it's all of T001, you're paying for unused columns.
5. **Execution plan hints.** Click "Explain" — if `Index range scan` is missing on a known-large table, suspect missing index or wrong WHERE order.

Full guide: [references/sql-trace-reading.md](references/sql-trace-reading.md).

## Common Mistakes

| Mistake | Cost | Fix |
|---|---|---|
| Skipping step 1 (symptom pinpoint) | Hours debugging the wrong call site | Force yourself to write a single sentence stating what is wrong, where, and when |
| Jumping to a fix without verification | Wrong fix; bug returns | Always have a measurement that confirms before you change code |
| Trusting comments / variable names | Wrong mental model | "is" vs "appears to be" discipline |
| Catching `cx_root` to "fix" a dump | Silent wrong results | Find the source; fix the value or signature, not the catch |
| Reproducing with different inputs than the report | "Works for me" loop | Use the exact data, exact user, exact company code, exact date |
| Not saving the dump / trace before re-run | Loses evidence | Export ST22 dump and ST05 trace before any reproduction attempt |
| Stopping at "it's flaky" | Real cause never found | Name the specific shared resource and the specific race window |
| Re-opening a settled question — re-asking what the user already answered, or dropping a *confirmed* hypothesis | Thrash; wasted iterations; the real fix never lands | Record each answered fact and each confirmed cause, then move forward. Re-open only when new evidence *refutes* it — and name that evidence |
| Fixing one symptom of an N-symptom DDIC change | Other symptoms surface next sprint | Where-used; fix at the DDIC layer in one transport |

## References

- [references/common-dumps.md](references/common-dumps.md) — triage table for the most common dump types
- [references/sql-trace-reading.md](references/sql-trace-reading.md) — reading an ST05 trace, step by step
- **ABAP Keyword Documentation — ASSERTIONS / Catchable Runtime Errors:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm
- **Runtime errors (catalog):** SAP Help — Catchable runtime errors, search by name (e.g. `ITAB_DUPLICATE_KEY`)
- **OSS Notes search:** https://launchpad.support.sap.com — paste the dump short text
- **SAP-samples/abap-cheat-sheets** — ABAP debugger and runtime examples: https://github.com/SAP-samples/abap-cheat-sheets
- Linked skills: [abap-sql-performance](../abap-sql-performance/SKILL.md), [abap-unit-tdd](../abap-unit-tdd/SKILL.md), [abap-clean-style](../abap-clean-style/SKILL.md)
