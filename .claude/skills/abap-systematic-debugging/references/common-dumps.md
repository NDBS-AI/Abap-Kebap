# Common ABAP Dumps — Triage Table

Each entry: what the dump is *really* saying, the first 1–2 things to check, the typical root cause categories, and where to look in the dump (`ST22`).

## Memory / runtime exhaustion

### `TIME_OUT`
- **Meaning:** A dialog or RFC work process exceeded the runtime limit (default 600s, profile param `rdisp/max_wprun_time` — confirm the value configured on your system via `RZ11`/`RZ10`, since sites commonly raise it to 1800s).
- **First check:** ST05 SQL trace of the program. A runaway SELECT or an unbounded loop is the most common cause, but confirm with the trace rather than assuming — don't skip straight to a fix.
- **Common causes:**
  - Missing or wrong `WHERE` clause on a large transparent table
  - FOR ALL ENTRIES driver table empty-check missing → FAE behaves as no WHERE
  - Nested `LOOP AT` where one inner table grows with each iteration
  - Long-running synchronous RFC waiting on a remote system
  - Background-only logic running in dialog
- **Dump fields:** Look at "Last 10 ABAP statements" + "Last 10 SQL statements" sections.

### `MEMORY_NO_MORE_PAGING` / `TSV_TNEW_PAGE_ALLOC_FAILED`
- **Meaning:** Work process tried to allocate more memory than available; ABAP paging exhausted.
- **First check:** S_MEMORY_INSPECTOR if reproducible; SM50 → "Memory" while running.
- **Common causes:**
  - Internal table loaded without `PACKAGE SIZE` from a large source
  - SELECT INTO TABLE without WHERE on a huge table
  - Recursive call building a deep tree without pruning
  - Held references preventing garbage collection (especially via `STATIC` instance attributes)
- **Dump fields:** "Memory consumption when error occurred"; look at the table/structure consuming the most.

### `SYSTEM_NO_ROLL`
- **Meaning:** Roll area exhausted.
- **First check:** Profile parameters `ztta/roll_area`, `ztta/roll_extension`. May be a sizing problem, not a code problem.
- **Common causes:** Very deep call stack, oversized parameters, large `STATICS` in a module pool.

## Object reference errors

### `OBJECTS_OBJREF_NOT_ASSIGNED`
- **Meaning:** Tried to use a reference variable that is `IS NOT BOUND` / null.
- **First check:** Stack frame above the dump line. Where was the reference *supposed* to be set?
- **Common causes:**
  - Factory returned `NULL` without raising — caller didn't check `IS BOUND`
  - `READ TABLE … REFERENCE INTO lr_ref` with `sy-subrc <> 0` — `lr_ref` is unbound; the dump fires on the next `lr_ref->…` access
  - Method that may legitimately return unset reference; signature should be `RETURNING VALUE(ro_result) TYPE REF TO …` with the caller checking `IS BOUND`
- **Dump fields:** Variable section will show `<lr_ref> = "OBJECT REFERENCE: <not assigned>"`.

### `OBJECTS_OBJREF_NOT_VALID`
- **Meaning:** Reference variable still points but the referenced object has been freed.
- **Common causes:** A `CLEAR` on a holder that another part of the code still held; misuse of `cl_abap_gc=>execute( )`.

### `OBJECTS_NOT_CHARLIKE` / `OBJECTS_NOT_NUMBER`
- **Meaning:** Type mismatch on a generic operation (typically `MOVE` to/from `TYPE ANY`).
- **Common causes:** Dynamic type code that didn't validate before assigning.

## Internal table errors

### `ITAB_DUPLICATE_KEY`
- **Meaning:** INSERT or APPEND into a SORTED / HASHED / unique-keyed table violated key uniqueness.
- **First check:** Inspect the row about to be inserted at the dump line vs the existing row.
- **Common causes:**
  - Duplicate input data not de-duped before INSERT
  - `INSERT TABLE` (no `INTO TABLE`) used when caller meant `INSERT … INTO TABLE` (different semantics)
  - Concurrent jobs writing the same key
- **Fix:** Decide whether duplicates should be rejected (`IF NOT line_exists( )`) or merged (`COLLECT` semantics) or whether the unique key was wrong.

### `ITAB_LINE_NOT_FOUND` (uncaught `CX_SY_ITAB_LINE_NOT_FOUND`)
- **Meaning:** Table expression `itab[ key = … ]` did not find a row; the unhandled exception `CX_SY_ITAB_LINE_NOT_FOUND` terminates with runtime error `ITAB_LINE_NOT_FOUND`.
- **First check:** Wrap in `TRY` or pre-check with `line_exists( )`. This is by-design behavior, not a system bug.

### `TABLE_OUT_OF_BOUNDS`
- **Meaning:** Indexed access past the end (`itab[ 5 ]` on a 3-row table).
- **First check:** The index calculation; off-by-one is the usual culprit.

## SQL / DB errors

### `DBSQL_DUPLICATE_KEY_ERROR`
- **Meaning:** DB constraint violation on INSERT — primary key already exists.
- **First check:** DB content vs the application's view; concurrent inserts, missing `MODIFY` semantics.

### `DBSQL_SQL_INTERNAL_DB_ERROR`
- **Meaning:** Vendor-specific DB error returned by `dbsl`.
- **First check:** Error text and DB error code in the dump → SAP Note search.

### `DBIF_RSQL_SQL_ERROR`
- **Meaning:** ABAP could not translate the SQL to DB SQL — usually syntax that the DB rejects.
- **Common causes:** Dynamic WHERE clause built incorrectly; type mismatch between host variable and column.

## Message-as-error

### `MESSAGE_TYPE_X`
- **Meaning:** Code issued `MESSAGE … TYPE 'X'` (or system did internally), turning a message into a fatal abort.
- **First check:** Message class + number in the dump → `SE91`; find the call site; was 'X' deliberate?
- **Common causes:**
  - A `MESSAGE … TYPE 'E'` outside a dialog context (e.g. background job, RFC) gets upgraded
  - Customizing missing → SAP-delivered code raised 'X' as last resort
- **Fix:** Often the right answer is *not* to suppress; either ensure customizing is present or replace the MESSAGE with a proper exception.

## Communication / external

### `CALL_FUNCTION_OPEN_ERROR`
- **Meaning:** RFC call could not be opened (connection-level, not function-level).
- **First check:** `SM59` → test destination. Then check destination user authorization, gateway, network.
- **Common causes:** Destination password changed, gateway ACL, target system down, TLS handshake failure.

### `CALL_FUNCTION_NOT_FOUND` / `CALL_FUNCTION_SIGNATURE_ERROR`
- **Meaning:** Remote function name missing or signature mismatch.
- **Common causes:** Target system patched; older client expects old signature.

### `CALL_FUNCTION_REMOTE_ERROR` (uncaught)
- **Meaning:** Remote raised an exception the local didn't catch.
- **Fix:** Add the exception to the `EXCEPTIONS` or `CATCH cx_root` (with logging) at the boundary.

## Authorization

### `MESSAGE_TYPE_X` after auth check / `NO_AUTHORIZATION`
- **Meaning:** Authority-check failed and the application converted it to a runtime error.
- **First check:** `SU53` immediately after reproducing — shows missing object/values for the failing user.

## Load / activation

### `LOAD_PROGRAM_LOST` / `LOAD_PROGRAM_NOT_FOUND`
- **Meaning:** Program load expected but missing; usually transport activation issue.
- **First check:** `SE80` on the object; check activation log; missing pre-requisite object?

### `OBJECT_LOAD_FAILURE`
- **Meaning:** A class or interface failed to load (compile error in a related object).
- **First check:** Activation log; check error messages for the underlying object.

## RTTI / dynamic code

### `MOVE_NOT_SUPPORTED` / `MOVE_CAST_ERROR`
- **Meaning:** Generic typed assignment / cast at runtime found incompatible types.
- **Common causes:** RTTI-driven generic helpers without type guards.

### `RAISE_EXCEPTION` (uncaught, no class)
- **Meaning:** Uncaught classic exception raised by a procedural `RAISE`.
- **First check:** Look at the failing `RAISE` line; either catch in `EXCEPTIONS` or convert the throwing routine to a class-based exception.

## Reading a dump — section by section

When you open a dump in ST22:

1. **Short text** — usually says exactly what happened. Don't skip it.
2. **What happened? / What can you do?** — SAP's hint, sometimes useful (especially for environment dumps).
3. **Error analysis** — the exception text, often includes the violating value.
4. **How to correct the error** — SAP's suggested categories; the SAP Note hint at the bottom is gold.
5. **System environment** — release, kernel, DB, instance name. Match against incident system in SM21.
6. **User and transaction** — exact user, T-code, terminal. Use this user for re-reproduction.
7. **Information on where terminated** — the failing module, line, screen. This is your starting point.
8. **Source code extract** — 20 lines around the dump line.
9. **Contents of system fields** — `sy-subrc`, `sy-msgid/msgno/msgty/msgv1..4` if message-related.
10. **Active calls / events** — the ABAP stack. Walk it from bottom (oldest) to top (failing line).
11. **Internal Notes** — kernel-side info; skim for `dbsl_*` or kernel-error hints.
12. **Active calls in SAP kernel** — usually relevant only for kernel/db issues.
13. **List of ABAP programs affected** — repo objects in the dump path.
14. **Directory of application tables** — what was open / locked.
15. **Last 10 ABAP statements** — execution trail; sometimes catches the loop that ran wild.
16. **Last 10 SQL statements** — execution trail of DB calls; gold for TIME_OUT.

The dump preserves enough state to root-cause most issues *without* re-running. Practice reading it before reaching for the debugger.
