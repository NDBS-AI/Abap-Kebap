---
name: abap-clean-style
description: "Use when writing new ABAP, reviewing existing ABAP for Clean ABAP compliance, deciding naming, choosing between modern (NEW #, VALUE #, inline data) and legacy (CREATE OBJECT, CONCATENATE, MOVE) syntax, designing class visibility, picking the right exception class type, or weighing whether to add a comment. Pulls SAP's official Clean ABAP rules into a scannable reference so you do not need to re-derive style from first principles each time."
---

# Clean ABAP — Style Reference

## Overview

A scannable, ABAP-specific style reference distilled from SAP's official [Clean ABAP styleguide](https://github.com/SAP/styleguides/blob/main/clean-abap/CleanABAP.md). Use it as a quick lookup while writing or reviewing ABAP. The goal is not to memorize every rule but to recognize the *category* of decision in front of you and jump to the right answer.

**Core principle:** code is read far more often than it is written. Optimize for the reader. Prefer explicit, intent-revealing names and modern constructs that show *what* the code does, not *how*.

## When to Use

Load this skill when:
- Writing new ABAP and you want naming and syntax to match Clean ABAP defaults.
- Reviewing code and need a citable rule for a finding ("this should follow Clean ABAP §X").
- Deciding between a modern construct (`NEW #`, `VALUE #`, inline `DATA(…)`, `REDUCE`) and a legacy one (`CREATE OBJECT`, `MOVE`, `LOOP … INTO wa`).
- Choosing an exception class type (`CX_STATIC_CHECK` vs `CX_DYNAMIC_CHECK` vs `CX_NO_CHECK`).
- Naming a class, interface, method, attribute, local variable, constant, table type, or CDS view.
- Wondering "should I add a comment here?" — the answer is usually *rename instead*.

**When NOT to use:**
- For non-style topics (logic, performance, OO design) — load a more targeted skill.
- For ABAP system technical limits — see the ABAP Keyword Documentation directly.

## Quick Reference

| Category | Default | See |
|---|---|---|
| Identifier language | English | §names |
| Casing | `snake_case` for ABAP identifiers; `CamelCase` only in CDS/RAP entity names where SAP convention requires it | §names |
| Length | Names long enough to reveal intent; up to ~30 chars; avoid abbreviations unless universally known | §names |
| Boolean | `is_active`, `has_changes`, `was_processed` — predicate names | §names |
| Class names | `cl_<noun>` nouns; final by default; abstract only when there is a real polymorphic family | §classes |
| Method names | Verb phrases — `calculate_tax`, `find_overdue_invoices`. Getters: `get_*` or just `<noun>`; setters: `set_*` | §methods |
| Parameters | Importing > exporting > changing > returning. Single returning > multiple exporting | §parameters |
| Variables | `DATA(amount) = …` inline when type obvious; `DATA: amount TYPE …` when type is the documentation | §variables |
| Constants | `CONSTANTS` in interfaces or classes — group with enum-like nested types | §constants |
| Conditions | `IF` for two branches; `CASE` for three or more on a discrete value; avoid `CASE TYPE OF` in business logic | §control-flow |
| Loops | `LOOP AT … REFERENCE INTO`/`LOOP AT … ASSIGNING <fs>` over `INTO wa`. Use `LOOP AT … INTO` only when you genuinely need a copy. | §control-flow |
| Strings | `\|template { var }\|` over `CONCATENATE`; `\|…\|` over `&&` for multi-arg | §strings |
| Tables | `VALUE #( … )`, `CORRESPONDING #( … )`, `FILTER #( … )` over manual `APPEND`/`MOVE-CORRESPONDING` loops | §internal-tables |
| `EXACT #( expr )` | Lossless conversion — raises `cx_sy_conversion_data_loss` (assignment) or `cx_sy_conversion_rounding` (calculation) if data would be truncated or precision lost | §internal-tables |
| Object creation | `NEW #( … )` over `CREATE OBJECT` (>= 7.40) | §objects |
| Errors | Static checked for expected/recoverable; dynamic for environmental; no-check for truly exceptional | §errors |
| Comments | Rename, don't comment. Comments only for *why* (constraint, surprise), never for *what* | §comments |
| Tests | Methods named `given_<state>_when_<action>_then_<outcome>`; few, focused assertions per test | Clean ABAP §Testing |

`§<topic>` headings below.

## Naming {#names}

**Identifier language.** English. ABAP keywords are English, DDIC names tend to be English, and SAP's released APIs are English. Mixing Turkish or German in identifiers breaks searchability across the rest of the system.

**Casing.**
- ABAP identifiers: `snake_case`. ABAP is case-insensitive in source but consistency matters for grep and review.
- CDS entity names: follow SAP convention — `Z_I_Customer`, `Z_C_SalesOrderHeader`, `Z_P_Product`. Casing matches the VDM layer prefix convention (see [cds-views-authoring](../cds-views-authoring/SKILL.md)).
- RAP behavior names and EML keywords match the CDS entity casing.

**Length.** Names should be long enough to make the read self-evident. ABAP allows up to 30 chars for most names and 61 for some; use what you need. `o`, `tmp`, `x1` are noise. `customer_with_active_contract` is fine.

**Abbreviations.** Use only those universally known in SAP context: `id`, `qty`, `amt`, `bp` (business partner), `bukrs` (company code — DDIC-derived), `werks` (plant), `vbeln` (sales order — DDIC-derived). Custom abbreviations are debt.

**Booleans.** Predicate names: `is_active`, `has_overdue`, `was_already_processed`, `should_skip_validation`. Avoid `flag_*` — flag of what?

**Class / interface names.**
- Classes: `cl_<noun>` for global, `lcl_<noun>` for local. Nouns describe *what the object is*, not *what it does*.
  - Good: `cl_invoice`, `cl_overdue_invoice_finder`, `cl_pricing_strategy`.
  - Bad: `cl_invoice_helper`, `cl_invoice_util`, `cl_invoice_manager`.
- Interfaces: `if_<noun>`. The interface describes a *capability* the implementer provides: `if_invoice_persistence`, `if_pricing_strategy`.
- Exception classes: `cx_<noun>`. The noun describes the error, not the action that raised it: `cx_invoice_not_found`, not `cx_get_invoice_failed`.

**Method names.** Verb phrases. The method does something.
- `calculate_total`, `find_overdue_invoices`, `is_overdue` (predicate returns `abap_bool`).
- Avoid `do_*`, `handle_*`, `process_*`, `manage_*` — these are noise verbs. Be specific.
- Getter: `get_total` or just `total`; for data-object-like classes Clean ABAP suggests public `READ-ONLY` attributes instead of getters ("Consider using immutable instead of getter"). Setter: `set_total`. Side-effect-free transforms: `to_<noun>` (`to_string`, `to_xml`).

**Local variables.** Short, contextual. Inside a 10-line method, `lt_inv` is fine if it is obviously "invoices". In a 200-line procedural block, `lt_invoices_with_overdue_status` earns its length.

**Hungarian prefixes.** Clean ABAP discourages `lt_`, `ls_`, `lv_`, `lo_`, `lr_`. In practice, most SAP shops still use them; if the project does, follow project convention — Clean ABAP is *guidance*, project convention is *contract*. The rule below applies regardless of prefix style. **The shipped naming convention** ([references/naming-conventions.md](references/naming-conventions.md)) is the authoritative naming standard for the ABAP Kebap agents — a full scope+type Hungarian grid (`mv_`/`lt_`/`iv_`/`ro_`…, field symbols `<fv_>`/`<fs_>`/`<ft_>`, CDS `z<area>_i_`/`z<area>_c_`) — and it overrides the Clean ABAP naming guidance in this section. A project may override it with a naming section in its `CLAUDE.md`/`AGENTS.md`.

## Control flow {#control-flow}

**IF / ELSE.** Two branches, simple condition.
- Prefer early return (`RETURN`, `RAISE EXCEPTION`) over nested `IF`. Guard clauses keep the happy path flat.
- `IF NOT condition` — flip the condition if it makes the read clearer.

**CASE.** Three or more branches on a single discrete value.
- Always include `WHEN OTHERS` and decide what it means — usually a `RAISE` or a no-op.
- `CASE TYPE OF` is a code smell in business logic (switch-on-type pattern). Replace with polymorphism. Exception: framework code that genuinely dispatches on RTTI.

**LOOP AT.**
- `LOOP AT lt_invoices REFERENCE INTO DATA(lr_invoice)` — modifies in place, no copy.
- `LOOP AT lt_invoices ASSIGNING FIELD-SYMBOL(<fs_invoice>)` — fastest, modifies in place.
- `LOOP AT lt_invoices INTO DATA(ls_invoice)` — copies to a work area. Use only when you need a copy.
- Use `WHERE` instead of `IF … CONTINUE` to skip — clearer intent, often faster.

**WHILE / DO.** Bounded loops; if you find yourself writing `WHILE x EQ abap_true … x = abap_false`, you have an `IF`. `DO` is unconditional (exit via `EXIT`/`TIMES`); `WHILE` repeats while a logical expression is true. In both, `sy-index` counts passes; in `LOOP AT` it is `sy-tabix` instead.

**Nesting.** Three levels deep is the soft limit (SAP's own guidance: no more than 5). Extract a method when you go deeper. Boolean composition via `AND`/`OR` is preferred to nested `IF`.

**Flow-control keywords — `CONTINUE` / `CHECK` / `EXIT` / `RETURN`.** All four divert flow, but Clean ABAP narrows where each belongs:

| Keyword | Does | Clean usage |
|---|---|---|
| `CONTINUE` | Skips to the next loop pass | Fine in loops. Prefer `LOOP … WHERE` to filter instead of `IF … CONTINUE`. |
| `CHECK log_exp` | Terminates the current loop pass if `log_exp` is false | **Only inside loops.** `CHECK` mid-method silently exits the method — replace with a guard clause `IF … RETURN`. |
| `EXIT` | Leaves the loop entirely | Loops only. Not a method-exit device. |
| `RETURN` | Terminates the current processing block | The clean way to leave a **method** early (guard clauses). `RETURN expr.` is allowed in a functional method to return the result. |

The trap: a stray `CHECK` in the body of a method exits the whole method when the condition fails — invisible at the call site. Use `RETURN` (or raise) with an explicit `IF` so the early exit is obvious.

**Operand-position conditionals.** `COND #( WHEN … THEN … ELSE … )` and `SWITCH #( operand WHEN … THEN … ELSE … )` move an `IF`/`CASE` into an expression — clean when the whole thing produces one value. Don't force complex multi-statement logic into a `COND`.

**Logical expressions & predicate functions.** Conditions are built from comparison operators (`=`/`EQ`, `<>`/`NE`, `<`/`LT`, `>`/`GT`, `<=`/`LE`, `>=`/`GE`, `BETWEEN`, `IN` ranges, and the character operators `CO CN CA NA CS NS CP NP`), predicate expressions (`IS [NOT] INITIAL / BOUND / ASSIGNED / SUPPLIED / INSTANCE OF`), and predicate functions (`contains`, `matches`, `line_exists`, `line_index`).
- `IS INSTANCE OF` before a `CAST #( )` is cleaner than catching `CX_SY_MOVE_CAST_ERROR`.
- `line_exists( itab[ key = … ] )` is cleaner than `READ TABLE … IF sy-subrc = 0`.
- A bare data object *is* a relational expression: `IF flag.` means `IF flag IS NOT INITIAL.` — so `IF condition = abap_true` is redundant; write `IF condition`.

**`boolc` vs `xsdbool` (the gotcha).** Both turn a logical expression into a truth value, but `boolc` returns type `string` (false = a blank, not an empty string) and must **not** be compared to `abap_true`/`abap_false`. `xsdbool` returns type `c LENGTH 1` (the same as `abap_bool`) and *is* comparable. **Prefer `xsdbool`** wherever the result feeds an `abap_bool` variable or an `abap_true`/`abap_false` test.

```abap
" Bad — boolc result is string; comparison to abap_bool is unreliable
DATA(is_overdue) = boolc( due_date < today ).
" Good
DATA(is_overdue) = xsdbool( due_date < today ).
```

Full construct catalog, comparison rules, every predicate/Boolean function with verbatim syntax: [references/flow-and-logic.md](references/flow-and-logic.md).

## Parameters {#parameters}

**Direction order in signatures:** `IMPORTING`, `EXPORTING`, `CHANGING`, `RETURNING`. Match this in the call site too.

**Prefer RETURNING over EXPORTING** when there is exactly one result. Functional calls are clearer:

```abap
" Bad
get_total( EXPORTING customer = lv_cust IMPORTING total = lv_total ).

" Good
DATA(total) = get_total( customer = lv_cust ).
```

**Avoid CHANGING when you really mean RETURNING + IMPORTING.** `CHANGING` is for genuinely mutating an existing instance — rare in pure business logic.

**Optional vs default vs preferred.** Use `OPTIONAL` when "absent" is meaningful; `DEFAULT value` when there is a sensible fallback. Three-or-more optional parameters is a signal the method does too much.

**No `TYPE ANY`** in public APIs. It transfers the type-checking burden to runtime and the caller. Use generic typing only inside framework code.

## Variables {#variables}

**Inline declarations.** Use `DATA(amount) = expr` when the type is obvious from the right-hand side. Use explicit `DATA: amount TYPE t_…` when the type IS the documentation (long-lived variable in a method, parameter to a function module).

**FINAL declarations.** Use `FINAL(amount)` (7.57+) when you do not reassign — communicates intent and helps the optimizer.

**One declaration per concept.** `DATA: total, count, average.` chained declarations on unrelated variables are noise.

**Initialization.** ABAP auto-initializes types — do not write `lv_total = 0` unless you mean to reset later. Do write `lt_invoices = VALUE #( )` when you want explicit empty initialization for documentation.

## Constants {#constants}

**Group constants** in an interface or a class as nested type:

```abap
INTERFACE if_invoice_status.
  CONSTANTS:
    BEGIN OF status,
      open      TYPE invoice_status VALUE 'O',
      paid      TYPE invoice_status VALUE 'P',
      cancelled TYPE invoice_status VALUE 'C',
    END OF status.
ENDINTERFACE.
```

Usage: `if_invoice_status=>status-paid` — the meaning is on the call site.

**Avoid magic literals.** Every `'X'`, `'Y'`, `'01'` in business code earns a comment from a reviewer; pre-empt by extracting a constant.

## Strings {#strings}

**Template strings** for everything new:

```abap
DATA(msg) = |Customer { customer-name } has { overdue_count } overdue invoices|.
```

`CONCATENATE … INTO …` is legacy; use it only when interfacing with old APIs that require it (rare).

**Compound assignments** — `x += 1`, `x -= n`, `x *= factor`, `x /= divisor`, `str &&= suffix` over `x = x + 1` / `str = str && suffix` (7.54+).

**Functional string transforms** — `to_upper( str )` / `to_lower( str )` over `TRANSLATE str TO UPPER/LOWER CASE` (the functional form does not modify in place; the `TRANSLATE` statement modifies the variable directly, which is a side effect).

**Container formatting:** `|{ amount NUMBER = USER }|`, `|{ date DATE = USER }|`. The formatting options are well documented in the ABAP Keyword Doc under "string templates".

## Internal tables {#internal-tables}

**Construction.**
```abap
" Bad
DATA: lt_orders TYPE STANDARD TABLE OF zorder.
APPEND VALUE #( id = '1' status = 'O' ) TO lt_orders.
APPEND VALUE #( id = '2' status = 'P' ) TO lt_orders.

" Good
DATA(orders) = VALUE order_t(
  ( id = '1' status = 'O' )
  ( id = '2' status = 'P' )
).
```

**Transformation.** `CORRESPONDING #( … MAPPING … )` over manual loops with `MOVE-CORRESPONDING`. `FILTER #( …USING KEY … WHERE … )` over `LOOP … DELETE`. `REDUCE` for fold operations.

⚠️ **`CORRESPONDING #()` vs `MOVE-CORRESPONDING` — behavioral trap:** `CORRESPONDING #( source )` **initialises the entire target first**, then copies matching fields — unmatched fields become initial (zero / empty / space). `MOVE-CORRESPONDING source TO target` leaves unmatched fields *untouched*. To get MOVE-CORRESPONDING semantics with the constructor expression, use `CORRESPONDING #( BASE ( target ) source )` (7.54+).

**Access.**
- `READ TABLE itab WITH KEY … INTO …` — copies. Use only if you need a copy.
- `READ TABLE itab WITH KEY … ASSIGNING …` — fastest, mutates.
- `itab[ key = … ]` — table expression. Raises `CX_SY_ITAB_LINE_NOT_FOUND` if missing — wrap in `TRY` or test with `line_exists( itab[ key = … ] )` first.

**Sorting.** Sorted tables (`TYPE SORTED TABLE OF`) for ordered access; hashed (`TYPE HASHED TABLE OF`) for keyed access. Define the right type up front — re-sorting a standard table is the most common ABAP performance smell.

**Avoid `DEFAULT KEY`.** `TYPE STANDARD TABLE OF struct WITH DEFAULT KEY` makes *all non-numeric fields* the key — confusing, resource-wasting, and produces wrong results when sorted. Use `WITH EMPTY KEY` when you don't need a key, or define explicit key fields.

**LET in constructor expressions.** `LET var = expr IN` inside `VALUE`, `REDUCE`, `NEW`, or `COND`/`SWITCH` expressions defines a local helper variable scoped entirely to that expression. Use it when the same computed value is needed more than once inside the expression — avoids redundant evaluation and reduces noise.

```abap
DATA(strtab) = VALUE string_table( LET mark = '!' IN
  ( |abc{ mark }| )
  ( |def{ mark }| )
  ( |ghi{ mark }| ) ).
```

Multiple helpers and field symbols are allowed: `LET first = expr1  second = expr2 IN ...`. `LET` after `FOR` is re-evaluated each loop iteration.

**FOR STEP in table iteration.** The optional `STEP` addition controls step size and direction when iterating with `FOR … IN itab`:

```abap
" Every 2nd row (ACEGI from a 10-element table A..J)
DATA(every_second) = VALUE string_table( FOR line IN itab STEP 2 ( line ) ).

" Reverse iteration (JIHGFEDCBA)
DATA(reversed) = VALUE string_table( FOR line IN itab STEP -1 ( line ) ).

" Bounded range with step: rows 2–6, every 2nd (BDF)
DATA(bounded) = VALUE string_table( FOR line IN itab FROM 2 TO 6 STEP 2 ( line ) ).
```

`STEP` is also available on `NEW` expressions that iterate tables.

## Objects {#objects}

**Construction.** `NEW #( … )` everywhere on 7.40+. `CREATE OBJECT` only in older releases.

```abap
" Bad
DATA lo_calc TYPE REF TO cl_tax_calculator.
CREATE OBJECT lo_calc EXPORTING country = 'TR'.

" Good
DATA(calc) = NEW cl_tax_calculator( country = 'TR' ).
```

**Chained construction.** `NEW cl_a( )->compute( NEW cl_b( ) )` — useful, but break the chain when it stops being readable.

## Classes {#classes}

**Final by default.** Subclassing is a design decision, not a default. Mark `FINAL` unless inheritance is intended.

**Abstract for real families only.** An abstract class without two real subclasses is over-design. Most "framework" classes can be regular classes with optional injectable strategies.

**Visibility.**
- `PUBLIC SECTION` — the API. Keep small.
- `PROTECTED SECTION` — extension points for subclasses.
- `PRIVATE SECTION` — internals. Default to private.

**Friends sparingly.** Friend declarations are useful for tests (local test class with private constructor access) and tightly coupled implementation classes. Outside of those, friends signal that visibility is wrong.

**No multiple inheritance.** ABAP does not allow it. Use composition + interfaces instead.

## Methods {#methods}

**One thing.** A method does one thing at one level of abstraction. If you find `AND` in the method name, split it.

**Length.** Clean ABAP ("Keep methods small"): fewer than 20 statements, optimal around 3 to 5. Beyond that, the method is doing multiple things — extract.

**No side effects in getters.** A method named `get_total` or `total` must not change state, log, or persist.

**Return early.** Guard clauses for invalid input, then the happy path.

```abap
METHOD calculate_discount.
  IF customer IS NOT BOUND.
    RAISE EXCEPTION TYPE cx_customer_missing.
  ENDIF.
  IF customer->is_blocked( ) = abap_true.
    result = 0.
    RETURN.
  ENDIF.
  result = …happy path….
ENDMETHOD.
```

## Errors {#errors}

ABAP has three exception class types. Pick the right one:

| Type | Use when | Caller obligation |
|---|---|---|
| `CX_STATIC_CHECK` | Expected, recoverable error the caller can act on (`invoice_not_found`, `validation_failed`) | Must declare in `RAISING` or catch — compiler-enforced |
| `CX_DYNAMIC_CHECK` | Environmental/external (DB down, RFC timeout, network) | Compiler does not enforce; document in method comment |
| `CX_NO_CHECK` | Truly exceptional (assertion failures, OOM, internal bug) | Caller does not catch; propagates up |

**Never catch and ignore.** Empty `CATCH` blocks are bugs. If you genuinely do not care, comment *why*.

**Don't wrap-and-rethrow without preserving the cause.** `RAISE EXCEPTION TYPE cx_x EXPORTING previous = lo_old_ex` keeps the chain readable in dumps.

**MESSAGE in business logic is a code smell.** `MESSAGE 'x' TYPE 'E'` couples logic to the dialog layer. Raise an exception with an `if_t100_message`-implementing class instead and let the boundary translate to a message.

## Comments {#comments}

**Default: no comment.** If a comment explains *what* the code does, the code's names are wrong — rename instead.

**Comment the *why*.** Non-obvious constraints, surprising performance choices, workarounds for a specific SAP Note, references to a business rule the code does not make obvious.

```abap
" SAP Note 1234567 — vendor invoices created via BAPI before SP12
" are missing the company code; default it from the user's parameter.
IF invoice-bukrs IS INITIAL.
  invoice-bukrs = sy-bukrs.
ENDIF.
```

**Never** comment-out code "in case we need it later". Git is the archive. Delete it.

**Pragmas over pseudo comments.** Use `##NEEDED` (pragma) instead of `"#EC NEEDED` (pseudo comment) to suppress irrelevant warnings — Clean ABAP: pseudo comments have mostly become obsolete and have been replaced by pragmas.

**ABAP Doc** (`"!`) is for public APIs of reusable code. Local helper methods do not need ABAP Doc.

## Anti-pattern → fixed

See [references/cheatsheet.md](references/cheatsheet.md) for a one-page table of the most common review findings and their Clean ABAP fix.

See [examples/before-after-snippets.md](examples/before-after-snippets.md) for eight before/after snippets demonstrating each category in isolated, runnable form.

## Common Mistakes

| Mistake | Why it hurts | Fix |
|---|---|---|
| Hungarian prefixes everywhere new | Carries no info that the type doesn't already | Drop prefixes for new code, or follow project convention consistently |
| `INTO TABLE @DATA(lt_result)` for a single row read | Allocates a table for one row | `INTO @DATA(single_row)` with `UP TO 1 ROWS` or table-expression `itab[ … ]` |
| `IF abap_true = condition`, `IF condition = abap_true` | Verbose, unidiomatic | `IF condition` (predicate names already read clearly) |
| `IF NOT condition IS INITIAL` | Hard to read | `IF condition IS NOT INITIAL` or rename |
| `MESSAGE 'X' TYPE 'E'` in business logic | Couples to dialog | Raise typed exception; map to message at boundary |
| Long `CASE` with type checks | Polymorphism missed | Extract a class hierarchy or strategy |
| `CREATE OBJECT` on modern release | Legacy syntax | `NEW #( … )` |
| Comments that restate code | Noise, rots | Rename the identifier so the comment is unnecessary |
| Empty `CATCH` block | Hides bugs | Either handle, log + rethrow, or comment WHY you ignore |
| `READ TABLE … INTO wa` where you don't change `wa` | Copies for nothing | `READ TABLE … REFERENCE INTO ref` |

## References

- **Official:** [SAP/styleguides — Clean ABAP](https://github.com/SAP/styleguides/blob/main/clean-abap/CleanABAP.md) — the canonical source. When in doubt, this wins.
- **ABAP Keyword Documentation:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm
- **Code Pal for ABAP** (extra ATC checks aligned with Clean ABAP): https://github.com/SAP/code-pal-for-abap
- **SAP-samples/abap-cheat-sheets** — concrete syntax examples for almost every construct: https://github.com/SAP-samples/abap-cheat-sheets
- Local: [references/cheatsheet.md](references/cheatsheet.md), [references/flow-and-logic.md](references/flow-and-logic.md), [examples/before-after-snippets.md](examples/before-after-snippets.md)
