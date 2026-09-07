---
name: abap-sap-luw
description: Use when reasoning about transactional consistency in ABAP — the SAP LUW vs the database LUW, when a database commit fires (implicit on dialog-step end / synchronous RFC / WAIT / message; explicit via COMMIT WORK, COMMIT CONNECTION, DB_COMMIT), COMMIT WORK [AND WAIT] / ROLLBACK WORK, bundling work so all changes land in one database LUW (update function modules with CALL FUNCTION ... IN UPDATE TASK and V1/V2 priority, PERFORM ... ON COMMIT / ON ROLLBACK, CALL FUNCTION ... IN BACKGROUND UNIT / bgRFC), SAP locking (ENQUEUE_/DEQUEUE_ function modules, lock objects, lock modes E/S/X) vs database locks, how the RAP save sequence and EML COMMIT ENTITIES / ROLLBACK ENTITIES map onto the classic LUW, the controlled SAP LUW (cl_abap_tx modify/save), and consistency pitfalls like premature commits or unreleased locks.
---

# ABAP SAP LUW, Transactions & Locking

## Overview

A correctness skill for the **SAP Logical Unit of Work (LUW)** — the unit of transactional consistency on the Application Server ABAP. The whole point of the SAP LUW is one rule:

> **All database changes that belong to one business transaction must be committed together in a single database LUW, or rolled back together — never half-applied.**

The classic failure mode is the bank transfer: debit account A in one work process, the work process switches (implicit commit), then crediting account B fails. Now money has left A but never arrived at B, and you cannot cheaply roll back because the debit was already persisted in a *different, already-committed* database LUW. The SAP LUW concept exists to make that impossible.

**Core principle:** the database commits when *it* decides to (often implicitly, on a work-process switch), not when your business transaction is logically done. So you must **defer** all real database modifications and bundle them so they execute in one work process, in one database LUW, triggered by a single final `COMMIT WORK`.

This is a *process / correctness* skill. Like [abap-systematic-debugging](../abap-systematic-debugging/SKILL.md), the value is in the discipline and the failure modes, not in a syntax dump.

## When to Use

- You are writing code that changes the database in more than one step and must stay consistent.
- You see `COMMIT WORK`, `ROLLBACK WORK`, `IN UPDATE TASK`, `PERFORM ... ON COMMIT`, or `SET UPDATE TASK LOCAL` and need to know what they actually do.
- An update silently didn't persist, or persisted partially, or an `UPDATE TASK` failed (you're staring at `SM13`).
- You need to lock business data across several dialog steps / RFC calls (not just a single SQL statement).
- You're mapping a classic posting program onto RAP, or wondering how `COMMIT ENTITIES` relates to `COMMIT WORK`.
- You hit a `BEHAVIOR_ILLEGAL_STMT_IN_CALL` runtime error doing a `MODIFY` in the wrong transactional phase.

**When NOT to use:**

- You only need RAP behavior implementation mechanics (BDEF, determinations, the save sequence itself) — see [rap-bo-modeling](../rap-bo-modeling/SKILL.md).
- You're debugging *why* an update dumped (SM13/ST22 root-cause hunt) — that's [abap-systematic-debugging](../abap-systematic-debugging/SKILL.md); this skill tells you the model, that one tells you the method.
- You need the deep enqueue mechanics (FM parameters, lock table, deadlock avoidance) — go to [references/locking.md](references/locking.md).

## Two LUWs, one transaction

There are two distinct "logical units of work" in play, and confusing them causes most consistency bugs.

| | **Database LUW** | **SAP LUW** |
|---|---|---|
| Also called | Database transaction | (the AS ABAP transaction) |
| Owner | The database system, SAP-independent | AS ABAP |
| Span | One indivisible sequence of DB ops ending at a **database commit** | One business transaction; usually starts with a new internal session |
| Ends with | Database commit (persist) or database rollback (undo) | `COMMIT WORK` (final) or `ROLLBACK WORK` |
| Key constraint | A single work process executes exactly **one** database LUW; it cannot touch another work process's DB LUW | May **span several work processes** and therefore several database LUWs |

The tension: an SAP LUW can stretch across multiple work processes (e.g. each dialog step gets a fresh one), and **every work-process switch forces an implicit database commit**. So if you write to the database in dialog step 1 and again in dialog step 2, those are *two separate database LUWs* — already committed independently. That breaks all-or-nothing. The fix is to never write "in between": collect the changes and fire them all in one final database LUW.

## What triggers a database commit

You must know this cold, because an *unexpected* commit is what splits your transaction.

### Implicit database commits

Triggered (among others) by:

- **Completing a dialog step** (dynpro context). A dialog step is the span between a user action and the next screen being sent (PAI of the current dynpro + PBO of the next). When the screen is shown the program waits for input and **releases the work process**; the next dialog step gets a *different* work process — and a work-process change requires and implicitly triggers a database commit.
- **Calling a function module via synchronous (sRFC) or asynchronous (aRFC) remote function call** — this forces a commit *because* control passes to a different work process or system (a work-process/context switch), not simply because the call is synchronous. **Named exception: updates.** A function module called with `CALL FUNCTION ... IN UPDATE TASK` runs inside the update task, and sRFC/aRFC calls made from *within* that update do not cause a work-process switch and therefore do not trigger this commit — that is precisely what lets everything registered for the update land in one database LUW.
- **HTTP / HTTPS / SMTP communication** through the ICF.
- **`WAIT` statements** (`WAIT UP TO ... SECONDS`, `WAIT FOR ASYNCHRONOUS TASKS`, `WAIT FOR MESSAGING CHANNELS`) — the *same* work-process-interruption mechanism as the dialog-step case above, not a separate rule: the statement interrupts the current work process, which is reallocated once the wait ends, so a commit happens first (same named exception for updates).
- **Sending a message** — error (`E`), information (`I`), or warning (`W`).

> Source: ABAP Keyword Documentation — "Database Commit", "Database Rollback", and "SAP LUW" topics (help.sap.com, BC-ABA component).

### Explicit database commits

In an ABAP program you can force a database commit with:

- The relevant **Native SQL** statement of the specific database.
- ABAP SQL **`COMMIT CONNECTION`**.
- The function module **`DB_COMMIT`** (wraps the Native SQL).
- ABAP SQL **`COMMIT WORK`** — the SAP-LUW-relevant one; it also *ends the SAP LUW*.

### Database rollbacks

A database rollback also ends a database LUW, undoing all modifying operations back to its start.

- **Implicit:** a runtime error, or a termination message (message type `A`).
- **Explicit:** Native SQL rollback, `ROLLBACK CONNECTION`, `DB_ROLLBACK`, or `ROLLBACK WORK` (which also ends the SAP LUW).

> A work process can execute only a single database LUW and cannot interfere with another work process's database LUW. That is exactly why a work-process switch must commit first.

## Ending the SAP LUW — `COMMIT WORK` / `ROLLBACK WORK`

```abap
"Synchronous: caller waits for the update work process to finish
COMMIT WORK AND WAIT.

"Asynchronous: caller does NOT wait for the update work process
COMMIT WORK.

"Undo everything registered in this SAP LUW
ROLLBACK WORK.
```

`COMMIT WORK [AND WAIT]`:

- Closes the current SAP LUW and opens a new one.
- Commits all change requests registered in the current SAP LUW.
- Triggers, among other things: processing of **all registered update function modules**, the update work process and local updates, and a **database commit on all open database connections** (which also ends the current database LUW).
- `COMMIT WORK` triggers an **asynchronous** update; `COMMIT WORK AND WAIT` triggers a **synchronous** update.

`ROLLBACK WORK`:

- Closes the current SAP LUW and opens a new one.
- Undoes all changes in the SAP LUW — all registrations for the current SAP LUW are removed.
- Triggers a **database rollback on all open database connections** (ending the current database LUW).

> **The asynchronous trap.** After `COMMIT WORK` (no `AND WAIT`), a `SELECT` executed immediately afterward may still see the *old* data, because the update work process hasn't run yet. If your code reads back what it "just wrote," you need `AND WAIT` — or you'll act on stale data. The cheat sheet's own example: 4 original rows, register a delete + one insert, then `COMMIT WORK` and immediately `SELECT` → you still see 4, not 1.

## Bundling techniques — defer the writes into one database LUW

The whole job: register *what to change* during the transaction, but actually *execute* the changes only at `COMMIT WORK`, in a single work process / single database LUW. Standard ABAP offers these techniques. (Most are **classic ABAP only** — see the ABAP Cloud note below.)

### 1. Update function modules (the workhorse)

An update function module is a normal FM with the **"Update module" attribute** set (a checkbox on the *Attributes* tab in SAP GUI — the code alone does not reveal it). It usually contains the database modification statements.

```abap
FUNCTION zsome_update_fu_mod
  IMPORTING
    VALUE(values) TYPE some_dbtab.

  MODIFY some_dbtab FROM @values.

ENDFUNCTION.
```

Register it for later execution with `CALL FUNCTION ... IN UPDATE TASK`; the actual run is triggered by `COMMIT WORK`:

```abap
"--------------------- Synchronous update ---------------------
DATA(ls_a) = VALUE some_type( ... ).

"Registering the update function module (name in uppercase)
CALL FUNCTION 'ZSOME_UPDATE_FU_MOD' IN UPDATE TASK
    EXPORTING values = ls_a.

"Triggering the synchronous update
COMMIT WORK AND WAIT.

"--------------------- Asynchronous update ---------------------
DATA(ls_b) = VALUE some_type( ... ).

CALL FUNCTION 'ZSOME_UPDATE_FU_MOD' IN UPDATE TASK
    EXPORTING values = ls_b.

"Triggering the asynchronous update
COMMIT WORK.

"--------------------- Local update ---------------------
"Before update function modules are registered:
SET UPDATE TASK LOCAL.

DATA(ls_c) = VALUE some_type( ... ).

CALL FUNCTION 'ZSOME_UPDATE_FU_MOD' IN UPDATE TASK
    EXPORTING values = ls_c.

"With local update the update is synchronous whether or not you add AND WAIT.
COMMIT WORK.
"COMMIT WORK AND WAIT.
```

Three ways the update can run:

- **Synchronous update** — the calling program waits until the update work process finishes. Triggered by `COMMIT WORK AND WAIT` (separate update work process).
- **Asynchronous update** — the caller does not wait. Triggered by `COMMIT WORK` (separate update work process).
- **Local update** — performed immediately in the *current* work process in a separate internal session, **not** a separate update work process. This holds whether or not `AND WAIT` is used. Local update is **off** at the start of every SAP LUW; activate it with `SET UPDATE TASK LOCAL` **before** registering the update modules.

**V1 vs V2 priority.** Update function modules can be given an attribute that sets the priority with which they run in the update work process:

- **V1 (primary / time-critical)** — high priority, runs synchronously *within the update transaction*, holds the SAP locks, and the changes it makes are the consistency-critical ones (e.g. the actual posting). If a V1 module fails, the whole update rolls back.
- **V2 (secondary)** — lower priority, runs *after* all V1 modules succeed, in its own database LUW, for non-critical follow-on work (e.g. statistics). V2 failures do not roll back the V1 changes.

> **If a runtime error occurs during the update, the update work process executes a database rollback and notifies the user whose program created the entries** (a Business Workplace mail for non-local updates). The failed update is visible in **`SM13`**; see [abap-systematic-debugging](../abap-systematic-debugging/SKILL.md) for the SM13 → ST22 hunt.

### 2. Remote-enabled function modules (bgRFC / background unit)

Bundling can also be done through **remote-enabled** function modules, registered for later **asynchronous** execution via the RFC interface using background RFC (bgRFC). This works in the same or a different ABAP system.

```abap
CALL FUNCTION 'ZSOME_RFC_FU_MOD' IN BACKGROUND UNIT <unit>
    EXPORTING ...
```

Note the **background processing framework (bgPF)** as the successor technology in ABAP Cloud.

### 3. Subroutines with `PERFORM ... ON COMMIT` / `ON ROLLBACK` (obsolete)

⚠️ Subroutines are no longer recommended, but you'll meet them in legacy code.

```abap
"Registered for execution at COMMIT WORK
PERFORM update_routine ON COMMIT.

"Registered for execution at ROLLBACK WORK
PERFORM cleanup_routine ON ROLLBACK.
```

- `ON COMMIT` subroutines run when `COMMIT WORK` is called; `ON ROLLBACK` when `ROLLBACK WORK` is called. An addition controls execution order.
- They run **in the current work process, before** the update function modules. (If registered *inside* an update FM with `ON COMMIT`, they run at the end of the update — in the update work process for non-local, in the current process for local.)
- **No parameter interface** — a registered subroutine cannot take parameters, so data must be passed via external means such as ABAP memory (`EXPORT`/`IMPORT`). This alone is a reason to avoid them.

## SAP locking — why DB locks are not enough

ABAP SQL modifications set **database locks** automatically (a lock flag on existing rows), but those flags are **removed at the database commit**. Since an SAP LUW can span several database LUWs (and thus several commits), a database lock cannot protect data for the *whole* SAP LUW. You need a lock that outlives the database LUW.

That is the **SAP lock concept**, independent of automatic database locks, based on **lock objects**:

- Lock objects are repository objects defined in the **ABAP Dictionary**; they name the table(s) to lock and the **key fields** the lock applies to.
- Creating a lock object auto-generates two **lock function modules**: `ENQUEUE_<lockobject>` and `DEQUEUE_<lockobject>`, executed in a dedicated **enqueue work process**.
- Enqueuing fills a central **lock table** with the table name and key values. Unlike a DB lock, **a locked entry need not correspond to an existing database row** (you can lock a key you're about to insert).
- Locking is **not automatic** — you must *proactively* request the lock and your application must *check* it. There is no automatic enforcement.
- At the end of the SAP LUW all locks should be released — automatically during the update, or explicitly via the dequeue FM.

```abap
"Request the lock (mode is a parameter, see below)
CALL FUNCTION 'ENQUEUE_EZ_MY_LOCK'
  EXPORTING
    mode_z_t_mytab = 'E'        "lock mode
    mandt       = sy-mandt
    key_field   = lv_key
  EXCEPTIONS
    foreign_lock = 1
    system_failure = 2
    OTHERS = 3.
IF sy-subrc <> 0.
  "Someone else holds the lock — handle it, do not proceed blindly
ENDIF.

"... do the work, register updates, COMMIT WORK ...

"Release explicitly (or let the update release it)
CALL FUNCTION 'DEQUEUE_EZ_MY_LOCK'
  EXPORTING
    mode_z_t_mytab = 'E'
    mandt       = sy-mandt
    key_field   = lv_key.
```

**Lock modes** (the `mode_*` parameter):

| Mode | Name | Meaning |
|---|---|---|
| `E` | Exclusive | Write lock. Held by one owner; others (incl. the same user in a new request) are blocked. The default for "I'm changing this." |
| `S` | Shared (read) | Several owners may hold `S` simultaneously; blocks `E`. "Many readers, no writer." |
| `X` | Exclusive, non-cumulative | Like `E` but cannot be requested twice even by the same owner. |

In ABAP Cloud / RAP, direct calls to the generated FMs are not permitted — use the generic OO wrapper `CL_ABAP_LOCK_OBJECT_FACTORY`: `get_instance( iv_name = ... )` returns the lock object instance (`enqueue( )` / `dequeue( )`), `dequeue_all( )` releases all locks of the current LUW, and lock failures (e.g. a foreign lock) arrive as exception `cx_abap_lock_failure` instead of `sy-subrc`.

Full mechanics — FM parameters (`_SCOPE`, `_WAIT`, `_COLLECT`), the lock owner concept, the lock table, common patterns, and deadlock avoidance — are in **[references/locking.md](references/locking.md)**.

## The SAP LUW in ABAP Cloud and RAP

In **ABAP for Cloud Development** (restricted ABAP) the classic bundling techniques above are **not available**, and **local update is enabled by default**. RAP *is* the transactional programming model for ABAP Cloud and follows the SAP LUW rules.

Mapping classic → RAP:

| Classic LUW | RAP |
|---|---|
| Register update FMs / `PERFORM ON COMMIT` | Change the **RAP transactional buffer** via EML / handler methods |
| Final database write | **RAP late save phase** persists the buffer to the database |
| `COMMIT WORK` | `COMMIT ENTITIES` (implicitly triggers `COMMIT WORK`) |
| `ROLLBACK WORK` | `ROLLBACK ENTITIES` (triggers `ROLLBACK WORK`) |

- **`COMMIT ENTITIES`** implicitly triggers `COMMIT WORK` and adds RAP-specific functionality. It enforces a **local update** (or **synchronous** `COMMIT WORK AND WAIT` if the local update fails) — so a RAP commit is **never asynchronous**.
- **`ROLLBACK ENTITIES`** resets all changes of the current transaction, clears the transactional buffer, and triggers `ROLLBACK WORK`.
- In ABAP Cloud, `COMMIT WORK` and `COMMIT WORK AND WAIT` behave **identically** (local update is always enforced), so the choice is irrelevant; `COMMIT WORK` typically returns `sy-subrc = 0`, other values raise a runtime error.

For the RAP save sequence and EML mechanics, see [rap-bo-modeling §EML](../rap-bo-modeling/SKILL.md#eml--entity-manipulation-language).

## Controlled SAP LUW (cl_abap_tx)

An enhancement available in both ABAP Cloud and classic ABAP that adds a **check mechanism** for violations of **transactional contracts** — turning the implicit "don't write mid-transaction" rule into an enforced one. There are two transactional phases, **modify** and **save**; database modifications are only legal in the **save** phase (the data in *modify* may still be inconsistent).

```abap
*& Activating the modify transactional phase
cl_abap_tx=>modify( ).

"NOT allowed in the modify phase. In ABAP Cloud this raises the
"runtime error BEHAVIOR_ILLEGAL_STMT_IN_CALL.
MODIFY zdemo_abap_carr FROM TABLE @( VALUE #(
    ( carrid = 'XY' carrname = 'XY Airlines'
      currcode = 'EUR' url = 'some_url' ) ) ).

*& Activating the save transactional phase
cl_abap_tx=>save( ).

"In the save phase, database modifications are allowed.
MODIFY zdemo_abap_carr FROM TABLE @( VALUE #(
    ( carrid = 'XY' carrname = 'XY Airlines'
      currcode = 'EUR' url = 'some_url' ) ) ).
```

In RAP the phases are set implicitly: *modify* covers the RAP interaction phase + early save phase; *save* is the RAP late save phase. **Classified APIs** (interfaces `IF_ABAP_TX_...`, e.g. `IF_ABAP_TX_SAVE`) declare in which phase a method may be called — e.g. `cl_bcs_mail_message=>...->send_async( )` is classified `IF_ABAP_TX_SAVE` and calling it in *modify* is a violation. Use F2 in ADT to see a method's transactional contract.

## Consistency pitfalls

| Pitfall | Why it breaks | Do instead |
|---|---|---|
| Writing to the DB in step 1 and step 2 of a dialog | Work-process switch commits step 1 in its own DB LUW — no all-or-nothing | Register all writes, fire one `COMMIT WORK` at the end |
| `COMMIT WORK` then immediately `SELECT` the just-written data | Async update hasn't run; you read stale data | Use `COMMIT WORK AND WAIT`, or don't read back |
| Direct `MODIFY dbtab` scattered through business logic instead of update FMs | Each runs in whatever DB LUW happens to be open; partial persistence on error | Move DB writes into update FMs registered `IN UPDATE TASK` |
| Locking with DB locks only (relying on `SELECT ... FOR UPDATE` flags) | DB lock dies at the next commit; gone for the rest of the SAP LUW | Use SAP enqueue locks (lock object) for the whole SAP LUW |
| Acquiring a lock but never checking `sy-subrc` of `ENQUEUE_*` | You proceed while another user holds the lock → lost update | Always check `sy-subrc`; on `foreign_lock` do not proceed |
| Never calling `DEQUEUE_*` and not committing | Lock leaks, blocks other users until session ends | Release explicitly or let `COMMIT WORK` release it |
| `MESSAGE` type `E`/`I`/`W` mid-transaction | Implicitly commits the open database LUW — splits your transaction | Don't emit dialog messages between partial writes |
| V2 logic depended on as if it were V1 | V2 runs later, separately; its failure won't roll back V1 | Put consistency-critical writes in V1 |
| `MODIFY dbtab` in a RAP handler / *modify* phase | Violates the transactional contract → `BEHAVIOR_ILLEGAL_STMT_IN_CALL` | Persist only in the saver / save phase |

## Quick reference

| Goal | Statement |
|---|---|
| End SAP LUW, commit, **wait** for update | `COMMIT WORK AND WAIT.` |
| End SAP LUW, commit, don't wait (async) | `COMMIT WORK.` |
| End SAP LUW, undo everything | `ROLLBACK WORK.` |
| Register an update FM | `CALL FUNCTION '...' IN UPDATE TASK EXPORTING ...` |
| Force local (synchronous, current WP) update | `SET UPDATE TASK LOCAL.` (before registering) |
| Run a subroutine at commit / rollback (obsolete) | `PERFORM ... ON COMMIT.` / `PERFORM ... ON ROLLBACK.` |
| Register a background unit (bgRFC) | `CALL FUNCTION '...' IN BACKGROUND UNIT <unit> ...` |
| Explicit DB commit (no SAP LUW end) | `COMMIT CONNECTION ...` / `CALL FUNCTION 'DB_COMMIT'` |
| Acquire / release SAP lock | `CALL FUNCTION 'ENQUEUE_<lo>' ...` / `'DEQUEUE_<lo>' ...` |
| RAP commit / rollback | `COMMIT ENTITIES ...` / `ROLLBACK ENTITIES.` |
| Controlled LUW phases | `cl_abap_tx=>modify( ).` / `cl_abap_tx=>save( ).` |

## References

- [references/locking.md](references/locking.md) — deep dive on SAP enqueue locking: lock objects, lock modes, `ENQUEUE_`/`DEQUEUE_` parameters, the lock table, lock owner / scope, common patterns, deadlock avoidance.
- Linked skills: [rap-bo-modeling](../rap-bo-modeling/SKILL.md) (RAP save sequence, EML `COMMIT ENTITIES`), [abap-systematic-debugging](../abap-systematic-debugging/SKILL.md) (debugging update-task failures via SM13/ST22), [enhancements-extensibility](../enhancements-extensibility/SKILL.md) (extension points that run inside the LUW).
- **SAP LUW (ABAP Keyword Documentation):** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abensap_luw.htm
- **Database commit / rollback:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abendb_commit.htm
- **`COMMIT WORK`:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abapcommit.htm — **`ROLLBACK WORK`:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abaprollback.htm
- **`CALL FUNCTION ... IN UPDATE TASK`:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abapcall_function_update.htm
- **`PERFORM ... ON COMMIT`:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abapperform_on_commit.htm
- **SAP Locks:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abensap_lock.htm
- **Controlled SAP LUW:** https://help.sap.com/docs/abap-cloud/abap-concepts/controlled-sap-luw
- **The RAP Transactional Model and the SAP LUW:** https://help.sap.com/docs/SAP_S4HANA_CLOUD/e5522a8a7b174979913c99268bc03f1a/ccda1094b0f845e28b88f9f50a68dfc4.html
- **SAP-samples/abap-cheat-sheets** — SAP LUW cheat sheet & executable example `zdemo_abap_sap_luw`: https://github.com/SAP-samples/abap-cheat-sheets
