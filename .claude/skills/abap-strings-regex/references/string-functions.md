# ABAP String Function Catalog

Full reference for the built-in string functions and string-template formatting options. All syntax is copied from the SAP-samples `abap-cheat-sheets` (07_String_Processing.md). Functions work in operand position, do not mutate their source, and — when they return a character string — always return type `string`.

Conventions used below: `val` is the input string, `sub` a substring, `pcre` a PCRE pattern, `case` case-sensitivity (`abap_true` default, `abap_false` = ignore case), `occ` the occurrence, `off` an offset, `len` a length.

---

## Length and counting

| Function | Parameters | Returns | Notes |
|---|---|---|---|
| `strlen` | `( val )` | `i` | Character count. **Includes** trailing blanks for type `string`; excludes them for `c`. |
| `numofchar` | `( val )` | `i` | Character count **excluding** trailing blanks, regardless of type. |
| `xstrlen` | `( val )` | `i` | Number of bytes of a byte-like (`xstring`/`x`) argument. |
| `count` | `( val sub [case] [off] [len] )` or `( val pcre ... )` | `i` | Number of occurrences. |
| `count_any_of` | `( val sub )` | `i` | Count of any character listed in `sub`. |
| `count_any_not_of` | `( val sub )` | `i` | Count of characters not listed in `sub`. |
| `distance` | `( val1 val2 [max] )` | `i` | Levenshtein distance (string similarity). `max` caps the computation. |

```abap
DATA(len_str_a) = strlen( `abc   ` ).      "6
DATA(len_c_a)   = numofchar( `abc   ` ).   "3
DATA(xstr) = CONV xstring( `480065006C006C006F00` ).
DATA(len_x) = xstrlen( xstr ).

DATA(str) = `Pieces of cakes.`.
count( val = str sub = `e` ).               "3
count_any_of( val = str sub = `x523z4e` ).  "3
count_any_not_of( val = str sub = `fP` ).   "14

distance( val1 = `abap` val2 = `axbap` ).             "1
distance( val1 = `abap` val2 = `zabapzzzz` max = 5 ). "5 (capped)
```

---

## Case transformation

| Function | Parameters | Returns | Notes |
|---|---|---|---|
| `to_upper` | `( val )` | `string` | All characters to uppercase. |
| `to_lower` | `( val )` | `string` | All characters to lowercase. |

```abap
to_upper( `abap` ).            "ABAP
to_lower( `SOME_FILE.Txt` ).   "some_file.txt
```

(For in-place transformation use the `TRANSLATE ... TO UPPER/LOWER CASE` statement.)

---

## Structure transformation

| Function | Parameters | Returns | Notes |
|---|---|---|---|
| `reverse` | `( val )` | `string` | Reverses the string. |
| `repeat` | `( val occ )` | `string` | `val` repeated `occ` times. `occ = 0` or empty `val` → empty string; negative `occ` raises `cx_sy_strg_par_val`. |
| `condense` | `( val [del] [from] [to] )` | `string` | Removes blanks. With no params: like `CONDENSE` (trims + collapses inner runs to one blank). `to = ` `` `` → like `NO-GAPS`. `del` lists leading/trailing chars to strip. |
| `insert` | `( val sub [off] )` | `string` | Inserts `sub` at offset `off` (default 0 → prepends). |
| `escape` | `( val format )` | `string` | Escapes special characters per `format` (constants `cl_abap_format=>e_url_full`, `e_json_string`, `e_string_tpl`, ...). |
| `cmin` / `cmax` | `( val1 val2 ... val9 )` | `string` | Smallest / biggest of 2–9 character-like arguments (left-to-right comparison). |

```abap
reverse( `paba` ).                       "abap
repeat( val = `abap` occ = 5 ).          "abapabapabapabapabap

condense( ` ab   cd ` ).                            "ab cd
condense( val = ` ab   cd ` to = `` ).              "abcd  (NO-GAPS)
condense( val = `##see###you##` del = `#` ).        "see###you

insert( val = `abcghi` sub = `def` off = 3 ).       "abcdefghi
insert( val = `abcghi` sub = `def` ).               "defabcghi

escape( val = '...test: 5@8...' format = cl_abap_format=>e_url_full ). "...test%3A%205%408...

cmin( val1 = `zzz` val2 = `zza` val3 = `zzzz` ).    "zza
```

---

## Substring extraction

| Function | Parameters | Returns | Notes |
|---|---|---|---|
| `substring` | `( val [off] [len] )` | `string` | At least one of `off`/`len`. Out-of-bounds raises `cx_sy_range_out_of_bounds`. |
| `substring_before` | `( val sub\|pcre [case] [occ] [len] [off] )` | `string` | Part before the match (excludes it). |
| `substring_after` | `( val sub\|pcre [case] [occ] [len] [off] )` | `string` | Part after the match (excludes it). |
| `substring_from` | `( val sub\|pcre [case] [occ] [len] [off] )` | `string` | From the match onward (**includes** it). |
| `substring_to` | `( val sub\|pcre [case] [occ] [len] [off] )` | `string` | Up to the match (**includes** it). |
| `match` | `( val pcre [case] [occ] )` | `string` | Substring matching the PCRE pattern. |
| `segment` | `( val index sep )` | `string` | The `index`-th segment delimited by `sep`. |

```abap
DATA(s1) = `Lorem ipsum dolor sit amet`.
substring( val = s1 off = 6 ).             "ipsum dolor sit amet
substring( val = s1 off = 6 len = 5 ).     "ipsum

DATA(s2) = `aa1bb2aa3bb4`.
substring_after(  val = s2 sub = `aa` ).   "1bb2aa3bb4 (first occurrence)
substring_before( val = s2 sub = `b2` ).   "aa1b
substring_from(   val = s2 sub = `a3` ).   "a3bb4
substring_to(     val = s2 sub = `3b` ).   "aa1bb2aa3b

match( val = `ABAP` pcre = `.b` case = abap_false ).  "AB
segment( val = `Hallo,world,123` index = 2 sep = `,` ). "world
```

Offset/length syntax (also write access for fixed-length strings): `txt(5)`, `txt+6(5)`, `txt+12(*)` (rest of string).

---

## Searching (return offset)

All return type `i`; **-1** when nothing is found (the comparison operators set `sy-fdpos` instead). `occ`: positive = nth from left, negative = nth from right, `0` raises an exception for `find` (but means "all" for `replace`).

| Function | Parameters | Returns | Notes |
|---|---|---|---|
| `find` | `( val sub\|pcre [case] [occ] [off] [len] )` | `i` | Offset of the match. `sub` must not be initial. |
| `find_end` | `( val sub\|pcre [case] [occ] [off] [len] )` | `i` | Offset of match **plus** its length. |
| `find_any_of` | `( val sub [occ] )` | `i` | Offset of any character in `sub` (always case-sensitive). |
| `find_any_not_of` | `( val sub [occ] )` | `i` | Offset of first character not in `sub` (always case-sensitive). |

```abap
DATA(str) = `Pieces of cakes.`.
find( val = str sub = `ca` ).                 "10
find( val = str sub = `xy` ).                 "-1
find( val = str sub = `OF` case = abap_false ). "7
find( val = str sub = `c` occ = 2 ).          "10
find( val = str sub = `e` occ = -1 ).         "13 (first from the end)

find_end( val = str sub = `of` ).             "9
find_any_of( val = str sub = `x523z4e` ).     "2  (the 'e')
find_any_of( val = str sub = `zwq85t` ).      "-1
find_any_not_of( val = str sub = `P` ).       "1
```

---

## Replacing

| Function | Parameters | Returns | Notes |
|---|---|---|---|
| `replace` | `( val [sub\|pcre] with [case] [occ] )` or `( val with off [len] )` | `string` | First occurrence by default; `occ = 0` replaces **all**; negative `occ` counts from the right. With `off`/`len` (no `sub`/`occ`) it is position-based. |
| `translate` | `( val from to )` | `string` | Maps each char in `from` to the same-position char in `to`; chars with no counterpart in `to` are removed. |

```abap
DATA(str) = `abap ABAP abap`.
replace( val = str sub = `ap` with = `#` ).                       "ab# ABAP abap (first)
replace( val = str sub = `AB` with = `#` case = abap_false ).     "#ap ABAP abap
replace( val = str sub = `ab` with = `#` occ = 0 case = abap_false ). "#ap #AP #ap (all)
replace( val = str sub = `ab` with = `#` occ = -1 ).              "abap ABAP #ap
replace( val = str with = `#` off = 5 len = 3 ).                  "abap #P abap
replace( val = str with = `#` off = strlen( str ) ).             "appends: abap ABAP abap#
replace( val = str pcre = `.\Z` with = `#` ).                     "replace last char

translate( val = `___abc_def_` from = `_` to = `#` ).            "###abc#def#
translate( val = `___abc_def_` from = `hi_` to = `?!` ).          "drops chars without a 'to'
```

---

## Predicate functions (return a truth value)

Wrap with `xsdbool` to store the result, or use directly in `IF`.

| Function | Parameters | Notes |
|---|---|---|
| `contains` | `( val sub\|pcre [case] [off] [len] )` | True if the substring/pattern occurs. |
| `matches` | `( val pcre [case] )` | True if the (search range of the) argument matches the pattern. |

```abap
DATA(has_ws) = xsdbool( contains( val = `abc def` pcre = `\s` ) ).        "X

"Illustrative only - NOT a production validator; use cl_mail_address=>create_instance( ... )->validate( ) for a real address check
DATA(looks_like_email) = xsdbool( matches( val = `jon.doe@email.com`
                                            pcre = `\w+(\.\w+)*@(\w+\.)+(\w{2,4})` ) ). "X
```

---

## Concatenation / splitting functions

| Function | Parameters | Returns | Notes |
|---|---|---|---|
| `concat_lines_of` | `( table [sep] )` | `string` | Joins all lines of a character-like internal table. |

```abap
DATA(itab) = VALUE string_table( ( `abc` ) ( `def` ) ( `ghi` ) ).
concat_lines_of( table = itab ).             "abcdefghi
concat_lines_of( table = itab sep = `,` ).   "abc,def,ghi
```

(Splitting back out is the `SPLIT` statement or the `segment` function above.)

---

## String-template formatting options (full list)

Options follow the embedded expression inside `{ }`. Values shown are illustrative and may depend on user/system settings.

| Option | Values | Effect |
|---|---|---|
| `CASE` | `UPPER`, `LOWER`, `RAW` | Letter case. |
| `WIDTH` | integer | Minimum field width (pads with `PAD`). |
| `ALIGN` | `LEFT`, `RIGHT`, `CENTER` | Alignment within `WIDTH`. |
| `PAD` | a character | Fill character for surplus width. |
| `SIGN` | `LEFT`, `LEFTPLUS`, `LEFTSPACE`, `RIGHT`, `RIGHTPLUS`, `RIGHTSPACE` | Placement/format of the +/- sign (numeric). |
| `ZERO` | `YES`, `NO` | How the numeric value 0 is shown (`NO` → empty). |
| `DECIMALS` | integer | Number of decimal places (not with `CURRENCY`). |
| `NUMBER` | `RAW`, `USER`, `ENVIRONMENT` | Decimal/thousands separators (numeric). |
| `CURRENCY` | currency key | Decimal places driven by the currency. |
| `COUNTRY` | country key | Country-specific number/date/time formatting. |
| `STYLE` | `SIMPLE`, `SIGN_AS_POSTFIX`, `SCALE_PRESERVING`, `SCIENTIFIC`, `SCIENTIFIC_WITH_LEADING_ZERO`, `SCALE_PRESERVING_SCIENTIFIC`, `ENGINEERING` | Decimal-float presentation. |
| `EXPONENT` | integer | Exponent when formatting floats / scientific style. |
| `ALPHA` | `IN`, `OUT`, `RAW` | Add (`IN`) / remove (`OUT`) leading zeros (type `string`, `c`, `n`). |
| `DATE` | `RAW`, `ISO`, `USER`, `ENVIRONMENT` | Date format. |
| `TIME` | `RAW`, `ISO`, `USER`, `ENVIRONMENT` | Time format. |
| `TIMESTAMP` | `SPACE`, `ISO`, `USER`, `ENVIRONMENT` | Timestamp format. |
| `TIMEZONE` | time-zone id (+ `COUNTRY`) | Render a UTC long timestamp in a zone. |
| `XSD` | `YES` | asXML/XSD representation of an elementary value. |

```abap
|{ `AbCdEfG` CASE = UPPER }|.                       "ABCDEFG
|{ `##` WIDTH = 10 ALIGN = RIGHT PAD = `.` }|.      "'........##'
|{ CONV decfloat34( - 1 / 3 ) DECIMALS = 3 }|.      "-0.333
|{ 1 SIGN = LEFTPLUS }|.                            "+1
|{ 0 ZERO = NO }|.                                  "(empty)
|{ '1234' ALPHA = IN WIDTH = 10 }|.                 "0000001234
|{ '00001234' ALPHA = OUT }|.                       "1234
|{ 12345678 CURRENCY = 'EUR' }|.                    "123456.78
|{ decimal_number NUMBER = USER }|.                 "-123.456,789 (example)
|{ cl_abap_context_info=>get_system_date( ) DATE = ISO }|.  "2024-01-01
|{ utclong_current( ) TIMESTAMP = ISO }|.
|{ utclong_current( ) TIMEZONE = 'CET' COUNTRY = 'DE ' }|.
|{ CONV decfloat34( '-123.45600' ) STYLE = SCIENTIFIC }|.   "-1.23456E+02
```

An invalid value for a formatting option (e.g. a non-existent country) raises `cx_sy_strg_format`.

---

## Sources

- ABAP Keyword Documentation — string functions: https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm
- Template formatting options: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapcompute_string_format_options.htm
- SAP-samples/abap-cheat-sheets — 07_String_Processing.md: https://github.com/SAP-samples/abap-cheat-sheets
