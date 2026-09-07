# SAP Locking (Enqueue / Dequeue) — Deep Dive

Reference for [abap-sap-luw](../SKILL.md). Covers the SAP lock concept: lock objects, lock modes, the `ENQUEUE_`/`DEQUEUE_` function module parameters, the lock table and lock owner, common patterns, and deadlock avoidance.

## Why SAP locks exist (recap)

ABAP SQL modifications cause the database to set a **database lock** (a lock flag on existing rows). But that flag is **removed at the next database commit**, and an SAP LUW typically spans several database LUWs — one per work-process switch, since a work-process switch forces an implicit commit (see [abap-sap-luw/SKILL.md — What triggers a database commit](../SKILL.md#what-triggers-a-database-commit) for the precise triggers and the update-task exception). So a database lock cannot protect a business object for the *whole* SAP LUW.

The **SAP lock concept** solves this. It is:

- **Independent of database locks** — it lives in a central **lock table** managed by the **enqueue work process**, not in the database.
- **Logical, not physical** — a lock entry is just `(table name, key values, mode, owner)`. The locked key **need not correspond to an existing database row**; you can lock a key you are about to insert.
- **Advisory / proactive** — there is **no automatic enforcement**. Nothing stops another program from modifying the row directly with ABAP SQL. The protection only works because *every* program that touches the object **agrees to request and check the lock first**. If one consumer skips the enqueue, the lock buys you nothing against it.

## Lock objects

A **lock object** is a repository object defined in the **ABAP Dictionary** (transaction `SE11`, or ADT). It declares:

- A **primary table** and optionally **secondary tables** joined by foreign keys.
- The **lock fields** — the key fields a lock request applies to (a lock argument). A lock can be on the full key or a prefix of it (generic lock).

Naming convention: a lock object is named `EZ...` or `EY...` (customer namespace), and SAP delivers many `E...` lock objects for standard tables. When you activate a lock object, the system **auto-generates two function modules**:

- `ENQUEUE_<lock object name>` — sets the lock.
- `DEQUEUE_<lock object name>` — releases the lock.

Both run in the dedicated **enqueue work process**.

> In ABAP Cloud / RAP, do not call the generated FMs directly — use the object-oriented lock API `CL_ABAP_LOCK_OBJECT_FACTORY` (`=>get_instance( )` → `enqueue( )` / `dequeue( )`). It is the released, cloud-ready equivalent.

### The generic lock API in ABAP Cloud (CL_ABAP_LOCK_OBJECT_FACTORY)

In ABAP Cloud direct usage of the generated FMs is not permitted; the FM calls are wrapped in a generic API:

- `cl_abap_lock_object_factory=>get_instance( iv_name = ... )` — creates the lock object instance; `=>dequeue_all( )` releases all locks of the current LUW.
- On the instance: `enqueue( )` sets a lock, `dequeue( )` releases it. Lock parameters travel as name/value-reference pairs (`it_parameter`); the lock mode per table via `it_table_mode`, using the constants in `if_abap_lock_object=>cs_mode`.
- Catch `cx_abap_lock_failure` on both calls — an enqueue that cannot be granted (e.g. a foreign lock) surfaces as this exception, not via `sy-subrc`. Do not proceed with the change when it is raised.

```abap
DATA(lo_lock_object) = cl_abap_lock_object_factory=>get_instance( iv_name = 'EZ_MY_LOCK' ).
TRY.
    lo_lock_object->enqueue(
      it_parameter  = VALUE #( ( name = 'KEY_FIELD' value = REF #( lv_key_value ) ) )
      it_table_mode = VALUE #( ( table_name = 'Z_T_MYTAB'
                                 mode       = if_abap_lock_object=>cs_mode-<lock mode> ) ) ).
  CATCH cx_abap_lock_failure INTO DATA(lo_lock_failure).
    "lock not granted — inform the user, do not proceed
ENDTRY.
```

Full parameterization (including the `cs_mode` constants) is documented in the ABAP Doc comments of `CL_ABAP_LOCK_OBJECT_FACTORY` and `IF_ABAP_LOCK_OBJECT`.

## Lock modes

The mode is passed per lock table via the `mode_<table>` parameter of the enqueue FM.

| Mode | Name | Behavior | Use when |
|---|---|---|---|
| `E` | **Exclusive** (write) | One owner only. Blocks other `E`, `S`, `X` requests from *other* owners. The **same** owner may request `E` again (cumulative — a counter increments). | You are going to change the object. The default choice for editing. |
| `S` | **Shared** (read) | Many owners may hold `S` at the same time. Blocks `E`/`X`. Does not block other `S`. | You only read and must guarantee nobody writes while you read. |
| `X` | **eXclusive, non-cumulative** | Like `E`, but cannot be requested a second time even by the same owner (a second request fails). | You need a strict single acquisition with no re-entrancy. |
| `O` | (Optimistic, internal/RAP) | Set as a read lock that is *promoted* to exclusive on first change. Used by RAP optimistic concurrency; rarely set by hand in classic code. | RAP optimistic locking scenarios. |

Cumulation: with mode `E`, repeated enqueues by the same lock owner stack up; you must dequeue the same number of times (or use `_SCOPE`/dequeue-all) to fully release.

## ENQUEUE function module parameters

```abap
CALL FUNCTION 'ENQUEUE_EZ_MY_LOCK'
  EXPORTING
    mode_z_t_mytab    = 'E'         "lock mode for table Z_T_MYTAB (E/S/X)
    mandt          = sy-mandt    "client (defaulted)
    key_field1     = lv_key1     "lock argument: key field value(s)
    key_field2     = lv_key2
    x_key_field2   = ' '         "initial-value flag for the field (see below)
    _scope         = '2'         "lock scope (owner / LUW handover)
    _wait          = abap_true   "retry on collision instead of failing fast
    _collect       = ' '         "collect into lock container instead of setting now
  EXCEPTIONS
    foreign_lock   = 1           "someone ELSE holds an incompatible lock
    system_failure = 2           "enqueue server problem
    OTHERS         = 3.

IF sy-subrc <> 0.
  " foreign_lock: read sy-msgv1 for the conflicting user, inform & abort
ENDIF.
```

Key parameters:

- **`mode_<table>`** — the lock mode (`E`/`S`/`X`) for that table inside the lock object. One per table in the lock object.
- **Lock argument fields** (`mandt`, your key fields) — the values that identify the locked object. Leaving a key field initial creates a **generic lock** over all values of that field.
- **`x_<field>`** — "set field to its initial value" flag; lets you lock on an initial key value deliberately (rarely needed).
- **`_scope`** — controls how long the lock lives and who owns it relative to the update task:
  - `_scope = '1'` — lock belongs to the **dialog (program)** owner; **not** passed to the update task. Released at end of the SAP LUW / program, *not* by `COMMIT WORK`.
  - `_scope = '2'` (default for most use) — lock belongs to the **update** owner; it **is** inherited by the update task and **released automatically when the update finishes** (after `COMMIT WORK`). This is what you usually want when the update FMs do the database write.
  - `_scope = '3'` — both owners; combination of 1 and 2.
- **`_wait`** — if set, the enqueue **retries** for a configured time when it hits a collision (instead of raising `foreign_lock` immediately). Useful for short, transient contention; risky if it masks a real long-held lock.
- **`_collect`** — if set, the lock request is **not** executed now but placed in a **lock container**; the whole container is then set together by `FLUSH_ENQUEUE` (lets you acquire many locks atomically).

## DEQUEUE function module parameters

```abap
CALL FUNCTION 'DEQUEUE_EZ_MY_LOCK'
  EXPORTING
    mode_z_t_mytab = 'E'
    mandt       = sy-mandt
    key_field1  = lv_key1
    key_field2  = lv_key2
    _scope      = '3'           "which owner's lock to release
    _synchron   = ' '.         "wait until release confirmed
```

- Matching the original lock argument releases exactly that lock; passing initial keys releases generically.
- **`DEQUEUE_ALL`** — releases **all** locks of the current program at once (handy in error handlers / cleanup).
- A `COMMIT WORK` / `ROLLBACK WORK` releases `_scope = '2'` locks automatically when the update completes — usually you do **not** call dequeue explicitly for those.

## The lock table and lock owner

- All locks live in a single **lock table** in shared memory on the enqueue server. View / manage current locks with transaction **`SM12`** (display, and — emergency only — delete stuck entries).
- A lock has a **lock owner**. By default the owner is the dialog work process's user session (`_scope = 1`) and/or the update task (`_scope = 2`). Two requests with the *same* owner and a cumulative mode (`E`) stack; requests with *different* owners that are incompatible collide (`foreign_lock`).
- Lock entries record: client, lock object, lock argument (key values), mode, owner, and the holding user.

`SM12` is the first place to look when a user complains "the object is locked and I can't edit it." See [abap-systematic-debugging](../../abap-systematic-debugging/SKILL.md) for the broader workflow; the lock-specific step is: `SM12` → find the entry → identify the holding user/session → decide if it's legitimately held or orphaned.

## Common patterns

### Lock → check → read → modify → commit → (auto) release

The canonical "edit a business object across several steps" pattern:

```abap
" 1. Acquire the lock BEFORE reading, so nobody changes it under you
CALL FUNCTION 'ENQUEUE_EZ_MY_LOCK'
  EXPORTING mode_z_t_mytab = 'E' mandt = sy-mandt key_field = lv_key
  EXCEPTIONS foreign_lock = 1 system_failure = 2 OTHERS = 3.
IF sy-subrc <> 0.
  MESSAGE e001(zmsg) WITH lv_key.   "object locked by another user — STOP
ENDIF.

" 2. Read the current consistent state
SELECT SINGLE key_field, field1, field2 FROM z_t_mytab WHERE key_field = @lv_key INTO @DATA(ls_row).

" 3. Work on it (possibly across dialog steps) ...

" 4. Register the database change in an update FM
CALL FUNCTION 'ZMY_UPDATE' IN UPDATE TASK EXPORTING values = ls_row.

" 5. Commit — runs the update; with _scope=2 the lock is released
"    automatically when the update finishes
COMMIT WORK AND WAIT.
```

### Releasing on error

If you abandon the transaction before commit, release explicitly so the lock does not leak:

```abap
IF lv_error = abap_true.
  CALL FUNCTION 'DEQUEUE_ALL'.   "drop everything this program holds
  ROLLBACK WORK.
  RETURN.
ENDIF.
```

### Generic (prefix) lock

Lock all rows whose key starts with a given prefix by leaving the trailing key fields initial — e.g. lock all items of one order by passing the order number and leaving the item number blank. Use sparingly: a generic lock blocks a wide range and increases contention.

## Deadlock avoidance

A deadlock is two transactions each holding a lock the other needs. The enqueue server does **not** auto-resolve classic application deadlocks for you; you avoid them by discipline:

1. **Acquire locks in a consistent global order.** If every program that locks order header + items always locks the header first, then items, two programs can never hold them in opposite order. Pick an ordering (e.g. by lock object name, then key) and document it.
2. **Lock late, release early — but lock everything you need up front in one go** when you need multiple locks for one operation. Use `_collect` + `FLUSH_ENQUEUE` to acquire a set atomically rather than one-by-one (which opens a window for interleaving).
3. **Keep the lock window short.** Don't hold locks across long user think-time if you can avoid it. The longer a lock is held, the higher the collision and deadlock probability.
4. **Fail fast by default; use `_wait` deliberately.** Letting `foreign_lock` surface immediately and telling the user "locked by X" is usually better than silently retrying and stacking up blocked sessions. Use `_wait` only for short, predictably-transient contention.
5. **Don't mix lock granularities inconsistently.** A generic lock on a prefix plus a specific lock on a key within that prefix, taken in different orders by different programs, is a deadlock recipe.
6. **Mirror the lock lifetime to the update.** Use `_scope = '2'` so locks are owned by and released with the update task; this prevents "lock held but transaction already over" leaks.

## Quick reference

| Need | Call |
|---|---|
| Set exclusive write lock | `ENQUEUE_<lo>` with `mode_<tab> = 'E'` |
| Set shared read lock | `ENQUEUE_<lo>` with `mode_<tab> = 'S'` |
| Release one lock | `DEQUEUE_<lo>` with same argument |
| Release all locks of program | `DEQUEUE_ALL` |
| Acquire many locks atomically | `_collect = 'X'` on each, then `FLUSH_ENQUEUE` |
| Retry on collision | `_wait = 'X'` |
| Hand lock to update task, auto-release | `_scope = '2'` |
| Inspect / delete stuck locks | transaction `SM12` |
| Cloud / RAP lock API | `CL_ABAP_LOCK_OBJECT_FACTORY=>get_instance( )` → `enqueue( )` / `dequeue( )` |

## Sources

- **SAP Locks (ABAP Keyword Documentation):** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abensap_lock.htm
- **Lock object (glossary):** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abenlock_object_glosry.htm
- **Lock function module (glossary):** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abenlock_function_module_glosry.htm
- **Lock objects / `CL_ABAP_LOCK_OBJECT_FACTORY` (BTP ABAP Environment):** https://help.sap.com/docs/sap-btp-abap-environment/abap-environment/lock-objects
- **Database lock (glossary):** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abendatabase_lock_glosry.htm
- **SAP-samples/abap-cheat-sheets** — SAP LUW cheat sheet: https://github.com/SAP-samples/abap-cheat-sheets
