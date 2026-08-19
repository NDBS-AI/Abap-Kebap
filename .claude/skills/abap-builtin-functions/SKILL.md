---
name: abap-builtin-functions
description: Use when calling ABAP built-in functions (numeric, string, table, logical, type/describe), handling dates / times / time stamps (types d, t, utclong, timestamp, timestampl; sy-datum/sy-uzeit; cl_abap_context_info, XCO_CP_TIME, CONVERT, GET TIME STAMP), or doing numeric operations — rounding (round / ceil / floor / trunc / frac / rescale), integer vs packed vs decfloat vs binary-float type choice, the calculation type and conversion rules in mixed arithmetic, / DIV MOD and ** operators, overflow and zero-division handling, type conversions inside calculations, or utility functions like line_exists / line_index / lines / abs / sign / nmin / nmax. Covers classic ABAP and ABAP Cloud (Steampunk). Distilled from SAP's official ABAP cheat sheets.
---

# ABAP Built-In Functions, Date/Time & Numeric Operations

## Overview

ABAP ships a large library of *built-in functions* (predefined, no `CALL METHOD`) plus dedicated language support for dates, times, time stamps, and numeric calculations. The hard part is rarely "which function exists" — it is **which type to compute in**, **how rounding behaves**, and **which API is allowed in ABAP Cloud**. This skill is the decision layer; the exhaustive catalogs live in `references/`.

**Core principle:** pick the right *type* before you pick the function. A wrong type silently rounds, overflows, or loses precision long before any function is called.

## When to Use

- Calling a built-in function: numeric (`abs`, `round`, `ceil`…), table (`lines`, `line_exists`, `line_index`), logical (`boolc`, `xsdbool`, `contains`), or string (→ [abap-strings-regex](../abap-strings-regex/SKILL.md)).
- Handling dates, times, or time stamps: differences, add/subtract, conversion, time zones, weekday/quarter.
- Choosing a numeric type (`i` / `int8` / `p` / `decfloat16/34` / `f`) and reasoning about rounding.
- Debugging a calculation that rounds, truncates, overflows, or divides by zero unexpectedly.
- Targeting ABAP Cloud and needing the cloud-safe API (`cl_abap_context_info`, XCO) instead of `sy-datum` / `sy-uzeit`.

**When NOT to use:**
- Pure string building / regex → [abap-strings-regex](../abap-strings-regex/SKILL.md).
- Declaring the numeric/date types themselves, structures, generics → [abap-data-objects](../abap-data-objects/SKILL.md).
- SQL/CDS-only functions in a `SELECT` field list — see [references/builtin-catalog.md](references/builtin-catalog.md) "SQL/CDS functions".

## Function categories — what lives where

| Category | Examples | Returns | Reference |
|---|---|---|---|
| **Logical** | `boolc`, `xsdbool`, `contains`, `contains_any_of`, `matches`, `line_exists` | truth value (`X`/` `) | [builtin-catalog.md](references/builtin-catalog.md) |
| **Numeric** | `abs`, `sign`, `ceil`, `floor`, `trunc`, `frac`, `ipow`, `nmin`, `nmax`, `round`, `rescale`, `sqrt`, `log`, `factorial` | numeric (mostly `decfloat34`) | [numeric.md](references/numeric.md) |
| **String** | `strlen`, `find`, `count`, `replace`, `substring*`, `to_upper`, `condense`, `reverse`, `segment` | string/int | → [abap-strings-regex](../abap-strings-regex/SKILL.md) |
| **Table** | `lines`, `line_exists`, `line_index` | int / truth value | this file + catalog |
| **Time stamp** | `utclong_current`, `utclong_add`, `utclong_diff` | `utclong` / `decfloat34` | [datetime.md](references/datetime.md) |
| **SQL/CDS only** | `div`, `division`, `mod`, `dats_add_days`, `concat`, `coalesce`, `uuid`, `unit_conversion` | per function | [builtin-catalog.md](references/builtin-catalog.md) |

`boolc` returns type `string` ('X'/' ') and must **not** be compared with `abap_true`/`abap_false`. Use `xsdbool` (type `c` length 1) when you need an `abap_bool`.

```abap
DATA(flag) = xsdbool( 3 > 1 ).            "abap_true (type c length 1, safe to compare)
DATA(line_ok) = xsdbool( line_exists( itab[ comp1 = 2 ] ) ).
```

---

## Numeric essentials

### Choosing the numeric type

| Type | Use when | Watch out |
|---|---|---|
| `i` (4-byte) / `int8` (8-byte) | counters, indexes, quantities; literals like `sy-index` | overflow → `cx_sy_arithmetic_overflow` |
| `p` (packed, fixed decimals) | currency, weights, lengths — fixed decimal places | length 1–16 bytes; ≤ 14 decimals; needs `LENGTH`/`DECIMALS` |
| `decfloat16` / `decfloat34` | high precision *and* wide range (16 / 34 places) | `round`/`rescale` return `decfloat34`; preferred for money math |
| `f` (binary float) | speed over precision; scientific notation | binary fractions ⇒ `0.815` is NOT exact; avoid comparisons |

Type `n` is **character-like**, not numeric — use it for IDs/article numbers, never for calculations.

```abap
DATA(float)  = CONV f( '0.815' ).         "8.1499999999999995E-01 (not exact!)
DATA(dec34)  = CONV decfloat34( '0.815' ). "0.815
ASSERT float <> dec34.                     "binary float != decimal float
```

### Rounding functions — know which way they go

All four take a `decfloat34` argument and return `decfloat34`:

```abap
"          value 4.999  4.001  -4.999  -4.001
ceil(  )  "      5      5      -4      -4    smallest integer >= value
floor( )  "      4      4      -5      -5    largest integer <= value
trunc( )  "      4      4      -4      -4    integer part (toward zero)
frac(  )  "  0.999  0.001  -0.999  -0.001   decimal part
```

```abap
DATA(round1) = round( val = CONV decfloat34( '1.2374' ) dec = 2 ).  "1.24 (to decimal places)
DATA(round3) = round( val = CONV decfloat34( '1234567890123' ) prec = 10 ). "1.234567890E+12 (to precision)
DATA(rescale1) = rescale( val = CONV decfloat34( '1234.56789' ) dec = 0 ). "1235
```

`round` also accepts a rounding-rule parameter (`cl_abap_math` constants) — see [references/numeric.md](references/numeric.md).

### Arithmetic operators and the calculation type

ABAP operators: `+`, `-`, `*`, `/`, `DIV`, `MOD`, `**`.

- `/` rounds the result to the **target type** — integer target ⇒ rounded integer.
- `DIV` = integer part of the division (positive remainder).
- `MOD` = positive remainder (always ≥ 0, regardless of operand signs).
- `**` raises to a power but **produces type `f`** — use `ipow( base = exp = )` to stay in integer/decfloat.

```abap
DATA res TYPE i.
res = 7 DIV 3.          "2   (integer part)
res = 7 MOD 3.          "1   (remainder)
res = 1 / 3.            "0   (rounded to integer target!)
res = 2 / 3.            "1   (0.666 rounds up to 1)
DATA(power_result) = 2 ** 5.       "type f
DATA(power_result_int) = ipow( base = 2 exp = 5 ). "32, no type f
```

**The calculation type** is determined at runtime from the operands, in decreasing priority:

1. `decfloat34` if any operand is `decfloat34` (else `decfloat16` if any is `decfloat16`)
2. `f` if any operand is `f` (but a `decfloat` operand still wins — see #1)
3. `p` if any operand is `p`
4. `int8` if any operand is `int8`
5. `i` otherwise

Non-numeric operands convert first: `d`, `t`, `x`, `xstring` → `i`; `c`, `n`, `string` → `p`; `utclong` is **not** supported in arithmetic.

> Pitfall: an inline-declared result of a `p` calculation gets `p LENGTH 8 DECIMALS 0` (length/decimals can't be inferred). Declare the target explicitly for packed math. See [references/numeric.md](references/numeric.md).

### Overflow, zero division, lossless checks

```abap
TRY.
    res = 2147483647 + 1.             "CX_SY_ARITHMETIC_OVERFLOW
  CATCH cx_sy_arithmetic_overflow.
ENDTRY.

TRY.
    res = 1 / 0.                      "CX_SY_ZERODIVIDE
  CATCH cx_sy_zerodivide.
ENDTRY.
" 0 / 0 does NOT raise — result is 0.

"EXACT forces a lossless calculation; rounding raises CX_SY_CONVERSION_ROUNDING
DATA(ok)  = EXACT ty_pl8d2( 1 / 4 ).  "works
"DATA(bad) = EXACT ty_pl8d2( 1 / 3 ). "raises — rounding required
```

Calculation assignments `+=`, `-=`, `*=`, `/=` mean `a = a + ( b )` etc.

---

## Date / Time / Time Stamp essentials

### The types (built-in ABAP)

| Type | Length | Format | Initial | Notes |
|---|---|---|---|---|
| `d` | 8 char | `yyyymmdd` | `00000000` | character-like; converts to *days since 01.01.0001* in numeric context |
| `t` | 6 char | `hhmmss` | `000000` | character-like; converts to *seconds since 00:00:00* |
| `utclong` | 8 byte | ISO 8601, 100 ns | special | **recommended** time stamp; UTC; POSIX (86400 s/day, no leap seconds) |

DDIC types for tables/CDS: `datn`/`timn` (modern, optimized), `dats`/`tims` (older, need conversion), `utclong`, plus data elements `timestamp` (`yyyymmddhhmmss`) and `timestampl` (`…​.sssssss`, 100 ns) — **packed numbers**, used only in some statements.

### Cloud-safe current date/time (do NOT use sy-datum / sy-uzeit in ABAP Cloud)

```abap
"cl_abap_context_info — base type dats/tims mapped to d/t
DATA(utc_date) = cl_abap_context_info=>get_system_date( ).  "e.g. 20240101
DATA(utc_time) = cl_abap_context_info=>get_system_time( ).  "e.g. 152450
DATA(tz)       = cl_abap_context_info=>get_user_time_zone( ). "e.g. UTC (catch cx_abap_context_info_error)

"XCO library — chained calls, return type string
DATA(date_iso) = xco_cp=>sy->date( )->as( xco_cp_time=>format->iso_8601_extended )->value. "2025-01-01
DATA(ts_now)   = utclong_current( ).                          "type utclong
```

In **classic** ABAP, `sy-datum` / `sy-uzeit` are fine. In **ABAP Cloud**, use `cl_abap_context_info` or XCO.

### Common operations

```abap
"--- Difference (dates: subtract → days; times: subtract → seconds) ---
DATA d1 TYPE d VALUE '20240101'.
DATA d2 TYPE d VALUE '20231227'.
DATA(days) = d1 - d2.                       "5 days
DATA(secs) = CONV i( CONV t( '115708' ) ).  "43028 seconds since 00:00:00

"--- Time stamp difference (exact seconds, type decfloat34) ---
DATA(diff) = utclong_diff( high = CONV utclong( '2024-01-01 06:30:00' )
                           low  = CONV utclong( '2024-01-01 05:30:00' ) ). "3600

"--- Add / subtract on utclong (no years/months params; negative = subtract) ---
DATA(later)   = utclong_add( val = utclong_current( ) hours = 1 ).
DATA(earlier) = utclong_add( val = utclong_current( ) hours = -1 ).

"--- Add / subtract with XCO (supports year/month, ultimo handling) ---
DATA(plus5) = xco_cp=>sy->date( )->add( iv_day = 5
                              )->as( xco_cp_time=>format->iso_8601_extended )->value.

"--- Weekday from a date (1 = Monday … 7 = Sunday) ---
DATA(weekday) = ( 5 + CONV i( d1 ) MOD 7 ) MOD 7 + 1.  "1 = Monday
```

### Time-difference-over-midnight idiom (MOD 86400)

`time2 - time1` can be negative; `MOD 86400` normalizes to the positive elapsed seconds across midnight:

```abap
DATA: time1 TYPE t VALUE '210000', time2 TYPE t VALUE '040000'.
DATA(elapsed) = ( time2 - time1 ) MOD 86400.            "25200 seconds (7 h)
DATA diff_time TYPE t.
diff_time(2)   = ( ( time2 - time1 ) MOD 86400 ) DIV 3600.
diff_time+2(2) = ( ( ( time2 - time1 ) MOD 86400 ) MOD 3600 ) DIV 60.
diff_time+4(2) = ( ( ( time2 - time1 ) MOD 86400 ) MOD 3600 ) MOD 60. "diff_time = '070000'
```

Use `DIV` (not `/`) for hours/minutes — `/` into an integer target rounds (`15.72…` → `16`), `DIV` truncates (`15`).

### Time stamps and time zones (CONVERT)

```abap
"utclong → local date/time
CONVERT UTCLONG CONV utclong( '2024-11-03 05:30:00' )
        INTO DATE DATA(loc_date)   "20241103
             TIME DATA(loc_time)   "013000
             TIME ZONE 'EST'.

"local date/time → utclong
CONVERT DATE CONV d( '20240101' ) TIME CONV t( '112458' )
        TIME ZONE 'EST'
        INTO UTCLONG DATA(utcl).   "2024-01-01 16:24:58.0000000

"packed time stamp: GET TIME STAMP, CONVERT TIME STAMP
GET TIME STAMP FIELD DATA(tsf).    "type timestamp, e.g. 20240101081317
CONVERT TIME STAMP tsf TIME ZONE 'EST' INTO DATE DATA(dt) TIME DATA(tm).
```

An **initial** time zone means no shift. A non-existent zone raises `cx_sy_conversion_no_date_time` (CONVERT UTCLONG) or sets `sy-subrc = 8` (CONVERT TIME STAMP).

### Date/time validity — check before you trust

```abap
TRY.
    DATA(invalid_date) = EXACT d( '20240231' ).   "raises CX_SY_CONVERSION_NO_DATE (Feb 31 invalid)
  CATCH cx_sy_conversion_no_date.
ENDTRY.
```

In SQL/CDS use `is_valid`, `dats_is_valid`, `tims_is_valid`, `tstmp_is_valid` — see [references/builtin-catalog.md](references/builtin-catalog.md).

### Date/time in string templates (formatting)

```abap
DATA(s1) = |{ cl_abap_context_info=>get_system_date( ) DATE = ISO }|.    "2024-01-01
DATA(s2) = |{ cl_abap_context_info=>get_system_time( ) TIME = ISO }|.    "14:37:24
DATA(s3) = |{ utclong_current( ) TIMESTAMP = ISO }|.                     "2024-01-01T14:39:50,40
DATA(s4) = |{ utclong_current( ) TIMEZONE = 'CET' COUNTRY = 'DE ' }|.    "localized
```

Full reference (XCO classes, `cl_abap_datfm`, `cl_abap_timefm`, `cl_abap_utclong`, `cl_abap_tstmp`, Unix time stamps, calendar info) → [references/datetime.md](references/datetime.md).

---

## Table functions

```abap
DATA(row_count) = lines( itab ).                          "row count
IF line_exists( itab[ comp1 = 2 ] ).  ... ENDIF.  "membership (table expression required)
DATA(idx) = line_index( itab[ comp2 = 'd' ] ).    "index of found row; 0 = not found; -1 = no primary index (hashed)
```

`line_index` needs a key specification (explicit table key or free key). A hashed table has no primary index → returns `-1` for `KEY primary_key`; use a secondary key for an index.

---

## Cloud / Steampunk notes

- **Date/time:** avoid `sy-datum`, `sy-uzeit`, `sy-timlo`, `sy-datlo` — use `cl_abap_context_info=>get_system_date/time/user_time_zone` or XCO (`xco_cp=>sy`, `xco_cp_time`).
- **Big numbers / rationals:** `cl_abap_bigint` (arbitrary precision integers) and `cl_abap_rational` (exact fractions) for values beyond `decfloat34` or where fractions must be preserved.
- **Math/random:** `cl_abap_math` (min/max constants, helpers), `cl_abap_random*` (seeded random numbers).
- Built-in functions themselves (numeric, string, table, `utclong_*`) are available in both classic and Cloud ABAP.

## Common Mistakes

| Mistake | Result | Fix |
|---|---|---|
| Comparing `boolc(...)` with `abap_true` | "not equal" (it's type `string`) | use `xsdbool` |
| `/` where you wanted integer truncation | result is rounded (`1/3`→0, `2/3`→1) | use `DIV` |
| `**` in money/integer code | silently produces type `f` | use `ipow` |
| Inline-declared result of `p` arithmetic | gets `p LENGTH 8 DECIMALS 0`, loses decimals | declare target type explicitly |
| Comparing/calculating with type `f` | binary imprecision (`0.815` not exact) | use `decfloat34` |
| `sy-datum` / `sy-uzeit` in ABAP Cloud | not allowed / wrong context | `cl_abap_context_info`, XCO |
| Trusting an unchecked date field | invalid date → wrong calc or dump | `EXACT` / `is_valid` first |
| `utclong` in an arithmetic expression | unsupported in calculation type | use `utclong_add` / `utclong_diff` |
| Time difference without `MOD 86400` | negative seconds across midnight | `( t2 - t1 ) MOD 86400` |
| Ignoring overflow / zero-division | runtime dump | `TRY … CATCH cx_sy_arithmetic_overflow / cx_sy_zerodivide` |

## References

- [references/numeric.md](references/numeric.md) — numeric type table, rounding modes, calculation/conversion rules, numeric built-in functions, `cl_abap_math` / `cl_abap_bigint` / `cl_abap_rational`.
- [references/datetime.md](references/datetime.md) — full date/time/time stamp reference: types, conversions, calculations, time zones, XCO / `cl_abap_*` classes, calendar functions.
- [references/builtin-catalog.md](references/builtin-catalog.md) — full built-in function catalog (function → category → params → returns), incl. SQL/CDS-only functions.
- **ABAP Keyword Doc — Built-in functions:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenbuilt_in_functions.htm
- **ABAP Keyword Doc — Date and Time Processing:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abendate_time_processing.htm
- **ABAP Keyword Doc — Compute Expressions:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENCOMPUTE_EXPRESSIONS.html
- **SAP-samples/abap-cheat-sheets:** https://github.com/SAP-samples/abap-cheat-sheets (`24_Builtin_Functions.md`, `23_Date_and_Time.md`, `29_Numeric_Operations.md`)
- Linked skills: [abap-strings-regex](../abap-strings-regex/SKILL.md) (string functions), [abap-data-objects](../abap-data-objects/SKILL.md) (numeric/date types), [abap-clean-style](../abap-clean-style/SKILL.md).
