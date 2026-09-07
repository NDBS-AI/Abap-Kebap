---
name: abap-strings-regex
description: Use when building or transforming strings in ABAP — string templates `|...{ }...|` with formatting options (NUMBER, DATE, TIME, CASE, WIDTH, ALIGN, PAD, SIGN, ALPHA), choosing string vs c, concatenation (CONCATENATE vs && vs templates), string functions (strlen, find, count, contains, matches, substring/substring_before/after/from/to, replace, condense, to_upper/to_lower, shift, translate, reverse, repeat, insert, segment, split), the FIND and REPLACE statements with ALL OCCURRENCES, or pattern matching with PCRE regular expressions, the FIND/REPLACE ... PCRE addition, the pcre parameter, and the cl_abap_regex / cl_abap_matcher OO API. Also when deciding regex vs plain string functions, or migrating obsolete POSIX REGEX to PCRE.
---

# ABAP String Processing and Regular Expressions

## Overview

ABAP gives you three layers for working with character strings: ABAP statements (`FIND`, `REPLACE`, `CONCATENATE`, `SPLIT`, `CONDENSE`, `TRANSLATE`, `SHIFT`), string expressions (concatenation `&&` and string templates `|...|`), and built-in string functions (`strlen`, `find`, `replace`, `substring`, ...). For pattern work there are PCRE regular expressions, usable from the same statements and functions plus the `cl_abap_regex` / `cl_abap_matcher` classes.

**Core principle:** prefer expressions and functions over statements. Functions work in operand position, return their result instead of mutating the source, and avoid temporary variables — so they read more cleanly and compose. The return value of a string function that returns a character string is always type `string`.

**Second principle:** reach for a regular expression only when the pattern is genuinely complex. A plain `find`/`replace`/`contains` or a `CS`/`CP` comparison is faster and clearer for single characters or fixed substrings.

## When to Use

- Building a message or output string from literals plus expressions — string templates.
- Formatting a number, date, time, or timestamp into text — template formatting options.
- Concatenating, splitting, condensing, shifting, translating, or reversing strings.
- Searching or replacing a fixed substring — `find`/`replace` functions or `FIND`/`REPLACE` statements.
- Matching, extracting, or replacing a *pattern* — PCRE regular expressions.
- Deciding between a string function, an ABAP statement, and a regex for a given task.
- Migrating legacy `REGEX` (POSIX) code to the modern `PCRE` addition.

**When NOT to use:**
- For constructor expressions in general (`VALUE`, `NEW`, `COND`, `REDUCE`, `CONV`) → [abap-constructor-expressions](../abap-constructor-expressions/SKILL.md). String templates are covered here; the rest there.
- For Clean ABAP naming and the "templates over CONCATENATE" style rule → [abap-clean-style](../abap-clean-style/SKILL.md).
- For ABAP SQL / CDS string functions (`like_regexpr`, `replace_regexpr`, `substring_regexpr`) — those run in the database; see the regex reference and SQL docs.

## string vs c — pick the right type

| | `string` (text string) | `c` (text field) |
|---|---|---|
| Length | Variable, dynamic; grows/shrinks at runtime | Fixed at declaration (1..262143) |
| Literal | Backquotes `` `...` `` | Single quotes `'...'` |
| Initial value | Empty string, length 0 | A blank at every position |
| Trailing blanks | Always preserved | Truncated in most operand positions |
| Internal | Deep (reference + sharing) | Flat memory block |

Use `c` when a maximum/mandatory length is part of the contract (a 2-char country code, a form field). Use `string` when length is not a constraint — which is most of the time.

```abap
TYPES: ty_c_type   TYPE c LENGTH 3,
       ty_str_type TYPE string.
DATA: lv_flag TYPE c LENGTH 1,
      lv_str1 TYPE string VALUE `Hallo!`.
"Inline declarations derive the type from the right side
DATA(lv_char2) = 'abcd'.   "type c length 4
DATA(lv_str5)  = `efgh`.   "type string
FINAL(lv_immutable) = `zyx`.
```

`strlen` counts characters *including* trailing blanks for `string`; `numofchar` excludes trailing blanks regardless of type; `xstrlen` returns bytes of an `xstring`.

```abap
strlen( `abc   ` ).    "6  (string keeps trailing blanks)
numofchar( `abc   ` ). "3  (always excludes trailing blanks)
```

## String Templates `|...{ }...|`

Construct strings from literal text plus embedded expressions in curly brackets. Any expression convertible to `string` is allowed: data objects, functional method calls, built-in functions.

```abap
DATA(lv_s1) = |Hallo { cl_abap_context_info=>get_user_technical_name( ) }!|.
DATA(lv_s3) = |{ lv_s1 } { `How are you?` }|.
DATA(lv_s9) = |Length of string lv_s5: { strlen( lv_s5 ) }|.
"\n / \t are backslash escapes recognized ONLY inside a |...| template
"(never inside a `...` or '...' literal, where \ has no special meaning);
"escape a literal \ | { } inside a template with a backslash too
DATA(lv_s12) = |\\ \| \{ \}|.   "\ | { }
ASSERT cl_abap_char_utilities=>newline = |\n|.          "the \n escape equals the newline constant
ASSERT cl_abap_char_utilities=>horizontal_tab = |\t|.   "the \t escape equals the horizontal_tab constant

"Building real multi-line content: prefer the named constant over \n so the
"intent (a control character, not two literal characters "\" and "n") is
"unambiguous to the reader - and verify with a length check, not by eyeballing
"a rendered escape sequence.
DATA(lv_two_lines) = |First line{ cl_abap_char_utilities=>newline }Second line|.
ASSERT strlen( lv_two_lines ) = 22.   "10 + 1 (newline) + 11 characters
```

> A template that contains *only* literal text is still compiled as an expression at runtime — for pure literals prefer a backquoted text string literal `` `...` ``.

### Formatting options

Options follow the embedded expression inside the braces. A selection (full list in the reference and ABAP docs):

```abap
"CASE
|{ `AbCdEfG` CASE = UPPER }|.    "ABCDEFG
|{ `AbCdEfG` CASE = LOWER }|.    "abcdefg

"WIDTH / ALIGN / PAD
|{ `##` WIDTH = 10 ALIGN = LEFT }<---|.            "'##        <---'
|{ `##` WIDTH = 10 ALIGN = CENTER }<---|.          "'    ##    <---'
|{ `##` WIDTH = 10 ALIGN = RIGHT PAD = `.` }<---|. "'........##<---'

"NUMBER / DECIMALS / SIGN / ZERO
|{ lv_decimal_number NUMBER = USER }|.       "user-master decimal/thousands separators
|{ CONV decfloat34( - 1 / 3 ) DECIMALS = 3 }|.  "'-0.333'
|{ 1 SIGN = LEFTPLUS }|.                   "+1
|{ -1 SIGN = RIGHT }|.                     "1-
|{ 0 ZERO = NO }|.                         "'' (empty)

"DATE / TIME / TIMESTAMP / TIMEZONE
|{ cl_abap_context_info=>get_system_date( ) DATE = ISO }|.  "2024-01-01
|{ cl_abap_context_info=>get_system_time( ) TIME = ISO }|.  "14:37:24
|{ utclong_current( ) TIMESTAMP = ISO }|.
|{ utclong_current( ) TIMEZONE = 'CET' COUNTRY = 'DE ' }|.

"ALPHA — add/remove leading zeros (type string, c, or n)
|{ '1234' ALPHA = IN WIDTH = 10 }|.  "0000001234
|{ '00001234' ALPHA = OUT }|.        "1234

"CURRENCY / COUNTRY / STYLE / EXPONENT / XSD also exist
|{ 12345678 CURRENCY = 'EUR' }|.     "123456.78
```

Formatting an unsupported value can raise `cx_sy_strg_format`. See [references/string-functions.md](references/string-functions.md) for the complete option list.

## Concatenation — `&&` and templates over CONCATENATE

```abap
"Preferred: && operator and templates
DATA(lv_s1) = `ab` && `cd`.            "abcd
DATA(lv_s3) = |{ lv_s1 }. done!|.      "abcd. done!
lv_a &&= lv_b.                         "concatenation assignment: same as lv_a = lv_a && lv_b.

"CONCATENATE statement — still valid, more verbose
CONCATENATE lv_s4 lv_s5 INTO lv_s3.
CONCATENATE lv_s4 lv_s5 INTO DATA(lv_s8) SEPARATED BY ` `.
CONCATENATE 'a  ' 'b  ' INTO DATA(lv_ch) RESPECTING BLANKS.  "keep trailing blanks of c

"Concatenating internal-table lines (avoids a LOOP)
DATA(lt_itab) = VALUE string_table( ( `abc` ) ( `def` ) ( `ghi` ) ).
CONCATENATE LINES OF lt_itab INTO DATA(lv_c1) SEPARATED BY `,`.  "abc,def,ghi
DATA(lv_c2) = concat_lines_of( table = lt_itab sep = ` ` ).      "abc def ghi
```

Clean ABAP: prefer string templates / `&&` / `concat_lines_of` over `CONCATENATE`. Do not confuse the literal operator `&` (combines character *literals* of the same type at compile time, max 255 chars) with the runtime operator `&&`.

## Splitting

```abap
DATA(lv_s1) = `Hallo,world,123`.
SPLIT lv_s1 AT `,` INTO DATA(lv_part1) DATA(lv_part2) DATA(lv_part3).  "fewer targets => last gets the rest
SPLIT lv_s1 AT `,` INTO TABLE DATA(lt_itab).         "one segment per line, comma dropped
"Single segment by index, without splitting everything
DATA(lv_seg) = segment( val = lv_s1 index = 2 sep = `,` ).  "world
```

## Common string functions

Functions return a value (offset as `i`, or the new string), never mutate the source. Most take `case`, `occ`, `off`, `len`, and a `pcre` parameter.

```abap
"Length / case / structure
strlen( lv_str )  numofchar( lv_str )  to_upper( lv_str )  to_lower( lv_str )
reverse( lv_str )  repeat( val = `ab` occ = 3 )  condense( lv_str )

"Substring extraction
substring( val = lv_s off = 6 len = 5 )
substring_before( val = lv_s sub = `b2` )   substring_after( val = lv_s sub = `aa` )
substring_from( val = lv_s sub = `a3` )     substring_to( val = lv_s sub = `3b` )
match( val = `ABAP` pcre = `.b` case = abap_false )   "AB

"Searching (offset, or -1 if not found)
find( val = lv_str sub = `ca` )                 "first occurrence from left
find( val = lv_str sub = `c` occ = 2 )          "2nd occurrence; negative occ = from right
find_end( val = lv_str sub = `of` )             "offset + length of match
find_any_of( val = lv_str sub = `xe4` )         "offset of any listed char
count( val = lv_str sub = `e` )                 "number of occurrences

"Replacing
replace( val = lv_str sub = `ap` with = `#` )            "first occurrence
replace( val = lv_str sub = `ab` with = `#` occ = 0 )    "occ = 0 => ALL occurrences
translate( val = lv_s from = `hi_` to = `?!+` )          "char-by-char mapping
insert( val = `abcghi` sub = `def` off = 3 )          "abcdefghi
```

`contains` and `matches` are predicate functions (return a truth value — wrap with `xsdbool` to store):

```abap
DATA(lv_has_space) = xsdbool( contains( val = `abc def` sub = ` ` ) ).

"Illustrative only - NOT a production validator; use cl_mail_address=>create_instance( ... )->validate( ) for a real address check
DATA(lv_looks_like_email) = xsdbool( matches( val = lv_addr pcre = `\w+@\w+\.\w{2,4}` ) ).
```

Full catalog — every function, its parameters, return type, and an example — is in [references/string-functions.md](references/string-functions.md).

## FIND and REPLACE statements

Statements carry a rich set of additions that the functions lack (sections, tables, results tables, submatches). `FIND` sets `sy-subrc` (0 found / 4 not found); `REPLACE` sets 0 / 2 (truncated) / 4.

```abap
DATA(lv_str) = `She sells seashells by the seashore.`.

"FIND — first occurrence by default; SUBSTRING is optional
FIND `se` IN lv_str.                                "sy-subrc = 0
FIND ALL OCCURRENCES OF `se` IN lv_str
  MATCH COUNT DATA(lv_cnt)     "3
  MATCH OFFSET DATA(lv_off).   "27 (last occurrence)
FIND ALL OCCURRENCES OF `se` IN SECTION OFFSET 9 LENGTH 5 OF lv_str MATCH COUNT DATA(lv_c2).
FIND FIRST OCCURRENCE OF `A` IN lv_str IGNORING CASE MATCH OFFSET DATA(lv_o2).
FIND ALL OCCURRENCES OF `ab` IN lv_str RESULTS DATA(lt_res)  "lt_res: match_result_tab
  IGNORING CASE.

"REPLACE — first occurrence by default; ALL OCCURRENCES for global
REPLACE ALL OCCURRENCES OF `ab` IN lv_str WITH `##` IGNORING CASE
  REPLACEMENT COUNT DATA(lv_rcnt).
REPLACE SECTION OFFSET 5 LENGTH 4 OF lv_str WITH `#`.   "position-based

"In internal tables (character-like line type, standard table)
FIND ALL OCCURRENCES OF `Z` IN TABLE lt_str_table RESULTS DATA(lt_rtab) RESPECTING CASE.
REPLACE ALL OCCURRENCES OF `Z` IN TABLE lt_str_table FROM 1 TO 2 WITH `#` RESPECTING CASE.
```

Both statements take a `PCRE` addition in place of the substring (see below). `RESULTS` returns `match_result_tab` (ALL) or `match_result` (FIRST); `SUBMATCHES sub1 sub2` binds capturing-group content directly to variables.

## Pattern-based search and replace

### Simple patterns — comparison operators

For single characters and trivial wildcards, comparison operators are the lightest tool. They set `sy-fdpos` to the offset of the match (or the string length if not found).

| Operator | Meaning | Case-sensitive |
|---|---|---|
| `CA` / `NA` | Contains any / not any of a char set | yes |
| `CO` / `CN` | Contains only / not only a char set | yes |
| `CS` / `NS` | Contains string / no string (substring) | no |
| `CP` / `NP` | Conforms to / not to pattern | no (except `#`-escaped) |

`CP` pattern characters: `*` = any sequence (incl. blanks), `+` = exactly one character, `#` = escape the next character for an exact match.

```abap
DATA(lv_sample) = `abc_def_ghi`.
IF lv_sample CP `*f#_*`. ... "true; sy-fdpos = 6  (f followed by a literal '_')
IF lv_sample CS `def`.  ... "true (substring, case-insensitive)
```

### Complex patterns — PCRE regular expressions

ABAP supports **PCRE** (Perl Compatible Regular Expressions) via the PCRE2 library. Use the `PCRE` addition on `FIND`/`REPLACE`, the `pcre` parameter on string functions, or the `cl_abap_regex` / `cl_abap_matcher` classes.

> **POSIX is obsolete.** The `REGEX` addition and `regex` parameter use POSIX syntax and are deprecated — PCRE performs better. Always write new code with `PCRE` / `pcre`. (A leftover POSIX warning can be silenced with pragma `##REGEX_POSIX`, but migrate instead.) Objects of `cl_abap_regex` created via `create_pcre` are passed to statements with the `REGEX` addition — that is the one non-obsolete use of `REGEX`.

> **Extended mode is on by default** for ABAP statements and built-in functions: unescaped whitespace in the pattern is ignored. To match a space, use `\s`, escape it `\ `, or disable extended mode with `(?-x)`.

PCRE syntax essentials — full table with match/no-match examples in [references/regex-reference.md](references/regex-reference.md):

| Category | Examples |
|---|---|
| Character types | `.` any (not newline), `\d` digit, `\D` non-digit, `\s` whitespace, `\S` non-ws, `\w` word, `\W` non-word |
| Quantifiers | `x*` 0+, `x+` 1+, `x?` 0/1, `x{m,n}`, `x{m}`, `x{m,}`; non-greedy `x*?` `x+?` |
| Char sets | `[iu]` set, `[a-z0-9]` range, `[^Ap]` negation |
| Anchors | `\A` start, `\Z` end, `^`/`$` (line in multiline `(?m)`), `\b` word boundary, `\K` reset match start |
| Groups | `(...)` capture, `(?:...)` non-capturing, `(?<name>...)` named, `\1` backreference, `x\|y` alternation |
| Lookarounds | `(?=...)` lookahead, `(?!...)` neg. lookahead, `(?<=...)` lookbehind, `(?<!...)` neg. lookbehind |
| Replacement refs | `$0` whole match, `$1`/`${1}` group, `$name`, case `\u \U \l \L \E` |

```abap
DATA(lv_some_string) = `aa bb cc dd ee`.

"Statements
FIND ALL OCCURRENCES OF PCRE `\s` IN lv_some_string RESULTS DATA(lt_findings).
REPLACE ALL OCCURRENCES OF PCRE `\s` IN lv_some_string WITH `#`.  "aa#bb#cc#dd#ee

"Built-in functions with the pcre parameter
DATA(lv_count_result)   = count( val = lv_some_string pcre = `\s` ).            "4
DATA(lv_match_result)   = match( val = lv_some_string pcre = `a.\s.` ).         "aa b
DATA(lv_replace_result) = replace( val = lv_some_string pcre = `\s` with = `#` occ = 0 ). "all

"Capturing groups in a replacement — replace the body of each <p>…</p>, keep the tags
DATA(lv_html) = |<p>Hallo</p><p>Ciao!</p>|.
REPLACE ALL OCCURRENCES OF PCRE `(<p>)(.*?)(<\/p>)` IN lv_html WITH `$1Hi$3`.

"Named groups: reformat a yyyymmdd date
DATA(lv_out) = replace( val = `20241128`
                     pcre = `(?<yr>\d{4})(?<mo>\d{2})(?<d>\d{2})`
                     with = `${d}.${mo}.${yr}` ).            "28.11.2024
```

`FIND ... PCRE ... SUBMATCHES` binds capturing groups to variables; `RESULTS` exposes their offset/length in nested `submatches` tables:

```abap
FIND PCRE `(.*)\son\s(.*)` IN lv_str IGNORING CASE SUBMATCHES DATA(lv_before) DATA(lv_after).
```

### The cl_abap_regex / cl_abap_matcher API

Use the OO API when you want to **compile a pattern once and reuse it**, iterate matches with `find_next`, or inspect matcher state.

```abap
"Compile a PCRE pattern, create a matcher, find everything — one chain
DATA(lt_matches) = cl_abap_regex=>create_pcre( pattern = `\D\d` ignore_case = abap_true
                                          )->create_matcher( text = lv_str )->find_all( ).

"Or build the matcher directly
DATA(lo_matcher) = cl_abap_matcher=>create_pcre( pattern = `X(.*?)X` text = lv_str ).
DATA(lv_replaced_count) = lo_matcher->replace_all( newtext = `#$1#` ).
DATA(lv_result_text)    = lo_matcher->text.

"Sequential processing with find_next + getters
DATA(lo_seq_matcher) = cl_abap_matcher=>create_pcre( pattern = `\d(\D.)` text = lv_str ).
WHILE lo_seq_matcher->find_next( ) = abap_true.
  DATA(lv_match_offset) = lo_seq_matcher->get_offset( ).
  DATA(lv_match_length) = lo_seq_matcher->get_length( ).
  DATA(lv_sub) = lo_seq_matcher->get_submatch( 1 ).
ENDWHILE.

"Reuse a compiled cl_abap_regex object in a statement (the valid REGEX use)
DATA(lo_re) = cl_abap_regex=>create_pcre( pattern = `\d(\D.)` ).
FIND ALL OCCURRENCES OF REGEX lo_re IN lv_str RESULTS DATA(lt_all).
```

Key `create_pcre` parameters: `pattern`, `text` (or `table`), `ignore_case`, `enable_multiline`, `extended`. The full method/parameter list and more patterns are in [references/regex-reference.md](references/regex-reference.md).

## Regex vs plain string functions — choosing

| Task | Use |
|---|---|
| Test for a fixed substring | `contains( sub = )` / `CS` |
| Find / replace a fixed substring | `find` / `replace` with `sub =` |
| Trivial wildcard (`*`, `+`) | `CP` comparison |
| Variable-length pattern, classes, groups, alternation, lookaround | PCRE |
| Same pattern applied many times, or iterate matches with state | `cl_abap_regex` + `cl_abap_matcher` |
| Pattern work pushed to the database | ABAP SQL `*_regexpr` functions |

A regex that is too complex raises `cx_sy_regex_too_complex`; an invalid pattern raises `cx_sy_invalid_regex`. Don't pay the compile and backtracking cost when a substring function would do.

## Common Mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| `CONCATENATE` chains for everything | Verbose, error-prone | String templates / `&&` / `concat_lines_of` |
| New code with `REGEX` (POSIX) | Deprecated, slower | Use `PCRE` / `pcre` |
| Forgetting extended mode eats spaces | Pattern silently never matches a literal space | `\s`, `\ `, or `(?-x)` |
| `replace( ... )` expecting all occurrences | Only first replaced | Add `occ = 0` |
| `find` result used without `-1` check | Off-by-one / wrong slice | Test for `-1` |
| `strlen` on `string` to "trim" trailing blanks | Counts the blanks | Use `numofchar`, or `cl_abap_string_utilities=>del_trailing_blanks` |
| Regex for a fixed substring | Needless compile + backtracking | `contains` / `find` / `CS` |
| Catastrophic backtracking in a complex pattern | `cx_sy_regex_too_complex` | Anchor, make quantifiers non-greedy, simplify |
| `c`-typed target too short for the result | Silent truncation | Use `string`, or size the field |

## Helper classes

- `cl_abap_char_utilities` — `newline`, `horizontal_tab`, `cr_lf` control-character attributes.
- `cl_abap_string_utilities` — `del_trailing_blanks`, `c2str_preserving_blanks`.
- `xco_cp=>string( ... )` — fluent string API (`split`, `join`, `to_upper_case`, `starts_with`, `ends_with`, camelCase compose/decompose, `matches`) for ABAP Cloud.

## References

- [references/string-functions.md](references/string-functions.md) — full string-function catalog and template formatting options.
- [references/regex-reference.md](references/regex-reference.md) — PCRE syntax reference, the `cl_abap_regex`/`cl_abap_matcher` API, and common (illustrative) patterns.
- **ABAP Keyword Documentation — String Processing:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm
- **PCRE syntax (ABAP specials):** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/abenregex_pcre_syntax_specials.html
- **Official PCRE/Perl reference:** https://perldoc.perl.org/perlre
- **SAP-samples/abap-cheat-sheets:** https://github.com/SAP-samples/abap-cheat-sheets (07_String_Processing.md, 28_Regular_Expressions.md)
- Linked skills: [abap-constructor-expressions](../abap-constructor-expressions/SKILL.md), [abap-clean-style](../abap-clean-style/SKILL.md)
