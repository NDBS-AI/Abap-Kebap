# Clean ABAP — One-Page Cheat Sheet

A scannable do / don't table covering the rules most often violated in reviews. For full reasoning see the parent [SKILL.md](../SKILL.md) and the official [Clean ABAP styleguide](https://github.com/SAP/styleguides/blob/main/clean-abap/CleanABAP.md).

## Naming

| Don't | Do | Why |
|---|---|---|
| `lv_x`, `lt_tmp`, `ls_data` | `customer_id`, `overdue_invoices`, `invoice_header` | Reveal intent, not type-prefix |
| `cl_invoice_helper` | `cl_invoice_overdue_finder` | "Helper" / "Util" / "Manager" are noise |
| `do_processing( )` | `calculate_total( )`, `notify_subscribers( )` | Verb says exactly what happens |
| `flag_x` | `is_overdue`, `has_changes` | Predicates read as English |
| `lv_kunnr` (DDIC short) outside KNA1 context | `customer_id` | DDIC short names leak schema into business code |

## Control flow

| Don't | Do |
|---|---|
| Nested `IF` four deep | Early `RETURN` / `RAISE`, flat happy path |
| `IF cond = abap_true` | `IF cond` |
| `IF NOT cond IS INITIAL` | `IF cond IS NOT INITIAL` |
| `CASE TYPE OF` in business logic | Polymorphism (subclass / strategy) |
| `LOOP … INTO wa.   IF wa-… EQ … . CONTINUE. ENDIF` | `LOOP … ASSIGNING <wa> WHERE …` |
| `CHECK cond.` in the middle of a method | Guard clause: `IF NOT cond.   RETURN.   ENDIF.` (`CHECK` belongs in loops) |
| `EXIT`/`CHECK` used to leave a method | `RETURN` (or `RAISE`) — explicit method exit |
| `boolc( … )` feeding an `abap_bool` / compared to `abap_true` | `xsdbool( … )` — returns type `c`, comparable; `boolc` returns `string` |
| `CAST #( ref )` wrapped in `TRY … CATCH cx_sy_move_cast_error` | `IF ref IS INSTANCE OF cl_x.   … = CAST #( ref ).   ENDIF.` |
| `READ TABLE itab … IF sy-subrc = 0` (only checking presence) | `IF line_exists( itab[ key = … ] ).` |

## Object creation & strings

| Don't | Do |
|---|---|
| `CREATE OBJECT lo_x EXPORTING …` | `DATA(instance) = NEW cl_x( … )` |
| `CONCATENATE 'Customer' name 'has' n 'orders' INTO msg SEPARATED BY space` | `\|Customer { name } has { n } orders\|` |
| `APPEND wa TO lt_x.` (repeated) | `lt_x = VALUE #( ( … ) ( … ) ( … ) )` |
| `MOVE-CORRESPONDING wa1 TO wa2` (multi-line) | `wa2 = CORRESPONDING #( wa1 MAPPING … )` — ⚠️ initialises target first; unmatched fields go initial. Use `CORRESPONDING #( BASE ( wa2 ) wa1 )` to keep unmatched fields. |
| `x = x + 1`, `str = str && suffix` | `x += 1`, `str &&= suffix` (compound assignment, 7.54+) |
| `TRANSLATE str TO UPPER CASE` | `str = to_upper( str )` (functional, no in-place mutation) |

## Internal tables

| Don't | Do |
|---|---|
| `READ TABLE lt INTO wa WITH KEY id = '1'.   IF sy-subrc = 0.` | `IF line_exists( lt[ id = '1' ] ).   DATA(line) = lt[ id = '1' ].` |
| `READ TABLE … INTO wa` you do not modify | `READ TABLE … REFERENCE INTO wa_ref` |
| Sorting a standard table just before binary search | Declare as `SORTED TABLE OF` from the start |
| `TYPE STANDARD TABLE OF t WITH DEFAULT KEY` | `WITH EMPTY KEY` (or explicit key fields) — DEFAULT KEY makes all non-numeric fields the key; wrong sort results and resource waste |
| Compute the same value twice inside a `VALUE` expression | `LET var = expr IN` — define once, use many times within the expression |

## Errors

| Don't | Do |
|---|---|
| `CATCH cx_root.` empty | Handle, log+rethrow, or comment WHY |
| `MESSAGE 'X' TYPE 'E'` in business class | Raise typed exception; map at the dialog boundary |
| `RAISE EXCEPTION TYPE cx_x.` without `previous` when wrapping | `RAISE EXCEPTION TYPE cx_x EXPORTING previous = lo_old.` |
| Static check for an OOM | `CX_NO_CHECK` (or let it propagate) |
| Dynamic check for a *validation failure* the caller must handle | `CX_STATIC_CHECK` |

## Methods & visibility

| Don't | Do |
|---|---|
| 80-line method with two responsibilities | Two methods, each at one level of abstraction |
| 4 `EXPORTING` parameters | Return a structure or split the method |
| `EXPORTING` when there is exactly one result | `RETURNING VALUE(result) TYPE …` |
| `PUBLIC SECTION` with helpers | Private; expose only the real API |
| Default `PUBLIC OPEN` class | `FINAL` until inheritance is actually needed |
| `CHANGING wa` when you mean "compute new value" | `IMPORTING wa  RETURNING new_wa` |

## Comments

| Don't | Do |
|---|---|
| `" loop over invoices` above a `LOOP AT invoices` | (nothing — the code reads itself) |
| `" set bukrs to T001-BUKRS` | Either delete or explain *why* — e.g. cite an SAP Note |
| `" lt_x = … " (old code)` commented-out block | Delete. Git is the archive. |
| Long ABAP Doc on a private helper | None — ABAP Doc is for public reusable APIs |

## Tests

| Don't | Do |
|---|---|
| `test_1`, `test_2`, `test_3` | `given_overdue_when_settle_then_status_paid` |
| Three asserts and a final assert that checks the previous three | One concept per test method |
| `LOOP AT cut->invoices … cl_abap_unit_assert=>assert_equals( … )` | Few, focused assertions per test (or one structural assertion that a helper builds) |
| Real DB select in unit test | `cl_osql_test_environment` or `cds_test_environment` (see [abap-unit-tdd](../../abap-unit-tdd/SKILL.md)) |
