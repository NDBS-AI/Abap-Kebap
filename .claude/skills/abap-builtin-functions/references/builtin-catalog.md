# Built-In Function Catalog

Full catalog of ABAP built-in functions by category, with parameters and return values. Source: SAP-samples/abap-cheat-sheets `24_Builtin_Functions.md`. Functions and syntax copied verbatim; not invented.

Back to [SKILL.md](../SKILL.md). Related: [numeric.md](numeric.md), [datetime.md](datetime.md). String functions detailed in [abap-strings-regex](../../abap-strings-regex/SKILL.md).

> Built-in functions take one or more arguments (some optional) and have one return value. They can be used in many operand positions. They exist in ABAP, and a (different) set exists for ABAP SQL / ABAP CDS. Avoid naming class methods after built-in functions — methods would "hide" the function.

---

## 1. Logical functions (return a truth value)

| Function | Returns | Key params | Notes |
|---|---|---|---|
| `boolc` | `string` ('X'/' ') | logexp | Do NOT compare with `abap_true`/`abap_false` (c→string conversion). |
| `xsdbool` | `c` length 1 | logexp | 'X'/' '; comparable with `abap_true`/`abap_false`. Use instead of IF/COND. |
| `contains` | truth value | `val`, `sub`/`start`/`end`, `off`, `len`, `case`, `occ`, `pcre` | Substring/range/regex membership test. |
| `contains_any_of` | truth value | `val`, `sub`/`start`/`end`, `case` | Checks individual characters; no `pcre`. |
| `contains_any_not_of` | truth value | `val`, `sub`/`start`/`end`, `case` | Negation of `contains_any_of`. |
| `matches` | truth value | `val`, `pcre`, `case`, `off`, `len` | Whole search range matches a regex. |
| `line_exists` | truth value | a table expression `itab[ … ]` | Row membership in an internal table. |

```abap
DATA(lv_b1) = xsdbool( 3 > 1 ).                                   "abap_true
DATA(lv_c1) = xsdbool( contains( val = `abdefghijklmn` sub = `ghi` ) ). "abap_true
DATA(lv_c2) = xsdbool( contains( val = `ABCDE` start = `ab` case = abap_false ) ). "abap_true
DATA(lv_c3) = xsdbool( contains( val = `Hallo world` pcre = `\s` ) ).  "abap_true
DATA(lv_m1) = xsdbool( matches( val = `jon.doe@email.com`
                             pcre = `\w+(\.\w+)*@(\w+\.)+(\w{2,4})` ) ). "abap_true
DATA(lv_l1) = xsdbool( line_exists( lt_itab[ comp1 = 2 ] ) ).        "abap_true
DATA(lv_l2) = xsdbool( line_exists( lt_str_tab[ table_line = `xxx` ] ) ). "abap_false
```

`contains` parameter summary: `val` (string searched), `sub`/`start`/`end` (substring to find), `off`/`len` (search range), `case` (default `abap_true`), `occ` (false if more occurrences than `occ` exist), `pcre` (regex).

---

## 2. Numeric functions

Detailed in [numeric.md](numeric.md). Catalog:

| Function | Returns | Params | Meaning |
|---|---|---|---|
| `abs` | numeric | value | Absolute value |
| `sign` | -1/0/1 | value | Sign |
| `ceil` | decfloat34 | decfloat34 | Smallest integer ≥ value |
| `floor` | decfloat34 | decfloat34 | Largest integer ≤ value |
| `trunc` | decfloat34 | decfloat34 | Integer part (toward zero) |
| `frac` | decfloat34 | decfloat34 | Decimal part |
| `ipow` | numeric | `base`, `exp` | Integer power (avoids type `f`); overflow → `cx_sy_arithmetic_overflow` |
| `nmin` / `nmax` | numeric | `val1`…`val9` (2–9) | Smallest / largest argument |
| `round` | decfloat34 | `val`, `dec` or `prec`, `mode` | Round to decimal places / precision; rounding rule via `mode` |
| `rescale` | decfloat34 | `val`, `dec` or `prec` | Like `round`, rescales (rounds if needed) |
| `acos` `asin` `atan` `cos` `sin` `tan` `cosh` `sinh` `tanh` `exp` `log` `log10` `sqrt` | float | value | Floating-point math |
| `factorial` | numeric | n (positive integer) | Factorial |
| `binomial` | numeric | `n`, `k` | Binomial coefficient |

---

## 3. String functions

Detailed in [abap-strings-regex](../../abap-strings-regex/SKILL.md). Catalog:

| Function | Returns | Purpose |
|---|---|---|
| `numofchar` | int | Char count; trailing blanks never counted |
| `strlen` | int | Length; trailing blanks counted only in variable-length strings |
| `xstrlen` | int | Byte length of `xstring` |
| `cmin` / `cmax` | string | Smallest / largest of character-like arguments |
| `find` | int (offset, -1 if none) | Offset of substring/regex |
| `find_end` | int | Offset + length of match |
| `find_any_of` | int | Offset of any of the given characters (case-sensitive) |
| `find_any_not_of` | int | Offset of first char not in the set |
| `count` | int | Number of occurrences |
| `count_any_of` / `count_any_not_of` | int | Char-set occurrence counts |
| `distance` | int | Levenshtein distance (optional `max`) |
| `repeat` | string | Repeat `val` `occ` times |
| `condense` | string | Condense (params `del`, `from`, `to`) |
| `concat_lines_of` | string | Join internal table (optional `sep`) |
| `reverse` | string | Reverse |
| `escape` | string | Escape per `format` (`cl_abap_format=>e_*`) |
| `insert` | string | Insert `sub` at `off` |
| `match` | string | Substring matching a regex (`pcre`, `occ`) |
| `replace` | string | Replace by `sub`/`pcre`/`off`+`len`, with `occ` |
| `segment` | string | Segment by `index` + `sep`/`space` |
| `shift_left` / `shift_right` | string | Shift (`places`, `circular`, `sub`) |
| `substring` | string | Substring by `off`/`len` |
| `substring_after` / `substring_before` | string | After / before a `sub`/`pcre` (`occ`, `case`, `len`) |
| `substring_from` / `substring_to` | string | From / up to and including a `sub` |
| `to_upper` / `to_lower` | string | Case transform |
| `from_mixed` / `to_mixed` | string | Mixed-case ⇄ separated (`sep`, `case`, `min`) |
| `translate` | string | Char-by-char replace (`from`, `to`) |

---

## 4. Table functions

| Function | Returns | Params | Notes |
|---|---|---|---|
| `lines` | int | itab | Row count |
| `line_exists` | truth value | table expression | See logical functions |
| `line_index` | int | table expression with key | Index of found row; 0 = not found; -1 = no primary index (hashed table) |

```abap
DATA(lv_row_count) = lines( lt_strtab ).
DATA(lv_i1) = line_index( lt_itab_em[ comp1 = 1 ] ).                 "1
DATA(lv_i2) = line_index( lt_itab_em[ comp2 = 'd' ] ).               "2
DATA(lv_i3) = line_index( lt_itab_sec[ KEY primary_key comp1 = 1 ] )."-1 (hashed: no primary index)
DATA(lv_i4) = line_index( lt_itab_sec[ KEY sk comp2 = 'd' ] ).       "4 (secondary table key/index)
DATA(lv_i5) = line_index( lt_itab_str[ table_line = `aaa` ] ).       "1
DATA(lv_i6) = line_index( lt_itab_str[ table_line = `zzz` ] ).       "0
```

`line_index` requires a key specification (explicit table key or free key).

---

## 5. Time stamp functions (ABAP)

| Function | Returns | Params | Notes |
|---|---|---|---|
| `utclong_current` | utclong | — | Current UTC time stamp |
| `utclong_add` | utclong | `val`, `days`, `hours`, `minutes`, `seconds` | ≥1 param besides `val`; negative = subtract; no years/months |
| `utclong_diff` | decfloat34 | `high`, `low` | Exact difference in seconds (may be negative) |

See [datetime.md](datetime.md) for full date/time handling.

---

## 6. Built-in functions for ABAP SQL and ABAP CDS

These are a *separate* set, usable inside `SELECT` field lists / CDS. Examples use typed literals for self-contained types. Full list: ABAP Keyword Doc — Built-in functions for ABAP CDS and ABAP SQL.

### 6a. Numeric (SQL/CDS)

| Function | Returns | Notes |
|---|---|---|
| `div( a, b )` | integer | Division, result rounded to integer |
| `division( a, b, dec )` | decimal | Division, rounded to `dec` decimals |
| `mod( a, b )` | numeric | Remainder of division |
| `ceil( x )` | integer | Round up to next greater integer |
| `floor( x )` | integer | Largest integer ≤ value |
| `abs( x )` | numeric | Absolute value |
| `round( x, pos )` | decimal | Round to `pos` decimal places |

```abap
SELECT SINGLE
  div( 4, 2 ) AS div,                  "2
  division( 1, 3, 2 ) AS division,     "0.33
  ceil( decfloat34`1.333` ) AS ceil,   "2
  mod( 3, 2 ) AS mod,                  "1
  floor( decfloat34`1.333` ) AS floor, "1
  abs( int4`-2` ) AS abs,              "2
  round( decfloat34`1.337`, 2 ) AS round "1.34
  FROM zdemo_abap_carr WHERE carrid = 'LH' INTO @DATA(ls_num_fns).
```

### 6b. Strings (SQL/CDS)

| Function | Returns | Notes |
|---|---|---|
| `concat( a, b )` | string | Concatenate, trailing blanks ignored |
| `concat_with_space( a, b, n )` | string | Concatenate with `n` blanks |
| `initcap( x )` | string | First letter of each word uppercase |
| `instr( x, sub )` | int | Position of first occurrence |
| `left( x, n )` | string | Leftmost `n` chars (trailing blanks ignored) |
| `length( x )` | int | Char count (trailing blanks ignored) |
| `like_regexpr( pcre, value )` | 1/0 | Whether value matches a PCRE (`case_sensitive` opt.) |
| `locate( x, sub, off, occ )` | int | Position of a substring |
| `locate_regexpr( pcre, value, occurrence )` | int | Offset of regex match (`case_sensitive`, `start`, `group`) |
| `locate_regexpr_after( pcre, value, occurrence )` | int | Offset of match + 1 |
| `ltrim( x, ch )` | string | Remove leading `ch`; trailing blanks removed |
| `occurrences_regexpr( pcre, value )` | int | Count of PCRE matches |
| `replace( x, sub, with )` | string | Replace `sub` with `with` |
| `replace_regexpr( pcre, value, with )` | string | Replace regex match (`occurrence`, `case_sensitive`, `start`) |
| `right( x, n )` | string | Rightmost `n` chars |
| `rpad( x, n, ch )` | string | Pad to length `n` with `ch` (truncates if shorter) |
| `rtrim( x, ch )` | string | Remove trailing `ch`; trailing blanks removed |
| `substring( x, pos, len )` | string | Substring from `pos`, length `len` |
| `substring_regexpr( pcre, value )` | string | Matched substring (`occurrence`, `case_sensitive`, `start`, `group`) |
| `upper( x )` | string | Uppercase |

```abap
SELECT SINGLE
  concat( carrid, carrname ) AS concat,                   "LHLufthansa
  concat_with_space( carrid, carrname, 1 ) AS concat_sp,  "LH Lufthansa
  initcap( url ) AS initcap,
  instr( carrname,'a' ) AS instr,                         "6
  left( carrname, 4 ) AS left,                            "Luft
  length( url ) AS length,                                "24
  ltrim( carrname, 'L' ) AS ltrim,                        "ufthansa
  replace( carrname, 'a', '#' ) AS replace,               "Lufth#ns#
  right( carrname, 5 ) AS right,                          "hansa
  rpad( carrname, 12, '#' ) AS rpad,                      "Lufthansa###
  rtrim( carrname, 'a' ) AS rtrim,                        "Lufthans
  substring( carrname, 3, 3 ) AS substring,               "fth
  upper( carrname ) AS upper                              "LUFTHANSA
  FROM zdemo_abap_carr WHERE carrid = 'LH' INTO @DATA(ls_str_fns).
```

### 6c. Date, time, time stamp (SQL/CDS)

Generic (accept `d`/`t`/`utclong`): `is_valid`, `extract_year`, `extract_month`, `extract_day`, `extract_hour`, `extract_minute`, `extract_second`, `dayname`, `monthname`, `weekday`, `days_between`, `add_days`, `add_months`.

Type-specific:

| Family | Functions |
|---|---|
| `datn` | `datn_days_between`, `datn_add_days`, `datn_add_months` |
| `dats` | `dats_is_valid`, `dats_days_between`, `dats_add_days`, `dats_add_months` |
| `tims` | `tims_is_valid` |
| `utclong` | `utcl_current`, `utcl_add_seconds`, `utcl_seconds_between` |
| `timestamp` | `tstmp_is_valid`, `tstmp_current_utctimestamp`, `tstmp_seconds_between`, `tstmp_add_seconds` |

Conversions: `tstmp_to_dats`, `tstmp_to_tims`, `tstmp_to_dst`, `dats_tims_to_tstmp`, `tstmpl_to_utcl`, `tstmpl_from_utcl`, `dats_to_datn`, `dats_from_datn`, `tims_to_timn`, `tims_from_timn`. Many take a `tzone` parameter and an optional `on_error`.

```abap
SELECT SINGLE FROM i_timezone FIELDS
  is_valid( @ti ) AS isvalid,                       "1
  extract_year( @utc ) AS extr_year,                "2024
  dayname( @da ) AS day_name,                       "Monday
  weekday( @utc ) AS week_day,                      "3
  days_between( @utc, utclong`2024-02-25 08:14:26` ) AS days_bw, "10
  add_days( @da, 2 ) AS add_days,                   "20240124
  add_months( @utc, 3 ) AS add_months,
  dats_add_days( dats`20240812`, 4 ) AS dats_add,   "20240816
  tstmp_to_dats( tstmp = @tmst, tzone = CAST( char`EST` AS CHAR( 6 ) ) ) AS to_dats "20240808
WHERE TimeZoneID = char`EST` INTO @DATA(ls_dt_fns).
```

### 6d. More (special) functions (SQL/CDS)

| Function | Returns | Notes |
|---|---|---|
| `to_clob( x )` | CLOB | Fixed-length string → variable-length `string` |
| `bintohex( raw )` | string | Byte string → character string |
| `hextobin( char )` | xstring | Character string → byte string |
| `to_blob( raw )` | RAWSTRING | RAW byte field → BLOB |
| `unit_conversion( quantity, source_unit, target_unit )` | numeric | Unit conversion (more params available) |
| `uuid( )` | uuid | Unique UUID per row |

```abap
SELECT SINGLE
  to_clob( carrid ) AS clob,
  bintohex( raw`1234` ) AS bintohex,
  hextobin( char`1234` ) AS hextobin,
  to_blob( raw`1234` ) AS blob,
  unit_conversion( quantity = d34n`1`, source_unit = unit`MI`, target_unit = unit`KM` ) AS miles_to_km,
  uuid( ) AS uuid
  FROM zdemo_abap_carr WHERE carrid = char`LH` INTO @DATA(ls_special_fns).
```

### 6e. coalesce (SQL/CDS)

Replaces `null` values (e.g. from outer joins) with a substitute. In ABAP there are no null values — when read into a data object, nulls become type-dependent initial values; `coalesce` substitutes before that.

```abap
SELECT tab2~key_field,
       coalesce( tab1~char1, '-' ) AS coalesced1,
       coalesce( tab1~char2, '#' ) AS coalesced2
    FROM zdemo_abap_tab2 AS tab2
    LEFT OUTER JOIN zdemo_abap_tab1 AS tab1 ON tab1~char1 = tab2~char1
    INTO TABLE @DATA(lt_join_w_null).
"key_field 4 (no match) -> coalesced1 = '-', coalesced2 = '#'
```

---

## Sources

- ABAP Keyword Doc — Built-in functions: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenbuilt_in_functions.htm
- ABAP Keyword Doc — Overview of functions: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenbuilt_in_functions_overview.htm
- ABAP Keyword Doc — Functions for ABAP CDS and ABAP SQL: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenddic_builtin_functions.htm
- SAP-samples/abap-cheat-sheets — `24_Builtin_Functions.md`
