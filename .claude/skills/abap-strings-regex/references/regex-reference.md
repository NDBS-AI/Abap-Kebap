# ABAP PCRE Regular Expression Reference

PCRE (Perl Compatible Regular Expressions) syntax as supported in ABAP, the `cl_abap_regex` / `cl_abap_matcher` API, and a set of common (illustrative) patterns. Syntax and examples are copied from the SAP-samples `abap-cheat-sheets` (28_Regular_Expressions.md).

## Contexts where PCRE is available

- `FIND` / `REPLACE` statements with the `PCRE` addition.
- Built-in functions with the `pcre` parameter: `find`, `find_end`, `count`, `match`, `matches`, `replace`, `contains`, `substring_from`, `substring_after`, `substring_before`, `substring_to`.
- `cl_abap_regex` and `cl_abap_matcher` classes (`create_pcre`).
- ABAP SQL / CDS built-in functions (run in the database): `like_regexpr`, `locate_regexpr`, `locate_regexpr_after`, `occurrences_regexpr`, `replace_regexpr`, `substring_regexpr`.

> **POSIX (`REGEX` / `regex`) is obsolete.** Use `PCRE` / `pcre`. ABAP uses the PCRE2 library in the kernel; ABAP SQL uses PCRE1 in HANA. XPath and XSD regex are converted internally to PCRE. Exceptions to expect: `cx_sy_invalid_regex`, `cx_sy_regex_too_complex`, `cx_sy_invalid_regex_format`.

> **Extended mode is on by default** for ABAP statements and built-in functions: unescaped whitespace in the pattern is ignored. Match a space with `\s`, escape it `\ `, or disable extended mode with `(?-x)` / the `extended` parameter of `create_pcre`.

---

## Characters and character types

| Expression | Represents |
|---|---|
| `x` | The specific literal character. |
| `.` | Any character except a line break (any character incl. newline in dotall/single-line `(?s)` mode). |
| `\d` / `\D` | Any digit `[0-9]` / any non-digit `[^0-9]`. |
| `\s` / `\S` | Any whitespace (blank, tab, newline) / any non-whitespace. |
| `\w` / `\W` | Any word char `[a-zA-Z0-9_]` / any non-word char. |

```abap
replace( val = `a1-b2 3-4c9` pcre = `\d` with = `#` occ = 0 ).  "a#-b# #-#c#
replace( val = `(ab 12_c)`   pcre = `\w` with = `#` occ = 0 ).  "(## ####)
```

## Escaped characters and special variants

| Expression | Represents |
|---|---|
| `\.` `\[` `\]` `\\` `\/` `\^` | Escape a metacharacter to match it literally. |
| `\n` / `\N` | Line feed / non-line-feed. |
| `\t` | Tab. |
| `\r` | Carriage return. |
| `\R` | Any newline sequence (`\n`, `\r`, or `\r\n`). |
| `\x{...}` | Character by hex code (e.g. `\x{00A0}` non-breaking space). |
| `\N{U+...}` | Character by Unicode code point (needs `(*UTF)`). |
| `\p{..}` / `\P{..}` | Char with / without a Unicode property (`Ll` lowercase, `Lu` uppercase, ...). |

```abap
replace( val = `a[b]c\d/e^f.g` pcre = `\[|\]|\\|\/|\^|\.` with = `#` occ = 0 ). "a#b#c#d#e#f#g
replace( val = `Hello ABAP`    pcre = `\p{Ll}+` with = `#` occ = 0 ).            "H# ABAP
```

## Quantifiers, repetitions, alternatives

| Expression | Represents |
|---|---|
| `x*` | Zero or more. |
| `x+` | One or more. |
| `x?` | Zero or one (optional). |
| `x{m,n}` | Between m and n. |
| `x{m}` | Exactly m. |
| `x{m,}` | m or more. |
| `x\|y` | `x` or `y` (alternation). |
| `x*?` / `x+?` | Non-greedy versions (match as few as possible). |

```abap
replace( val = `abc abbc abbbc a ac` pcre = `ab+`  with = `#` occ = 0 ).  "#c #c #c a ac
replace( val = `abcd abccccd ab`     pcre = `bc*?` with = `#` occ = 0 ).  "a#cd a#ccccd a#
replace( val = `<span>Hallo</span>`  pcre = `<.+?>` with = `#` occ = 0 ). "#Hallo#  (greedy <.+> would eat the whole tag pair)
```

## Character sets and ranges

| Expression | Represents |
|---|---|
| `[...]` | A single character from the set. |
| `[x-y]` | A single character in the range. |
| `[^...]` | A single character NOT in the set. |
| `[^x-y]` | A single character NOT in the range. |

```abap
replace( val = `bit bat but bet` pcre = `b[iu]`   with = `#` occ = 0 ). "#t bat #t bet
replace( val = `ABap`            pcre = `[^Ap]`   with = `#` occ = 0 ). "A##p
```

## Anchors and positions

| Expression | Represents |
|---|---|
| `\A` | Start of the subject. |
| `\Z` | End of the subject. |
| `^` | Start of subject / start of line in multi-line `(?m)` mode. |
| `$` | End of subject / end of line in multi-line `(?m)` mode. |
| `\b` / `\B` | Word boundary / not a word boundary. |
| `\K` | Reset the start of the reported match (drop what came before). |

```abap
"Built with the named newline constant, not a literal \n, so it is unambiguous
"that these are real line breaks, not the two characters "\" and "n"
DATA(lv_three_lines) = |abc{ cl_abap_char_utilities=>newline }def{ cl_abap_char_utilities=>newline }ghi|.
replace( val = lv_three_lines pcre = `(?m)^` with = `#` occ = 0 ). "#abc<NL>#def<NL>#ghi - each real line start matched (<NL> marks the newline character; strlen( ) = 11 + 3 '#' = 14)
replace( val = `abcd`      pcre = `a.\Kc` with = `#` occ = 0 ). "ab#d (only 'c' replaced)
```

## Capturing groups, replacements, backreferences

| Expression | Represents |
|---|---|
| `(...)` | Capturing group. |
| `(?:...)` | Non-capturing group. |
| `(?<name>...)`, `(?'name'...)` | Named capturing group. |
| `$id`, `${id}` | Replacement reference to group (number or name); `$0` / `${0}` = whole match. |
| `$name`, `${name}` | Replacement reference to a named group. |
| `\1` | Backreference to capturing group 1 (group index starts at 1). |

```abap
replace( val = `APAB` pcre = `(..)(..)` with = `$2$1` ).        "ABAP
replace( val = `abcd` pcre = `(..)(..)` with = `#$0#` ).        "#abcd#
replace( val = `20241128`
         pcre = `(?<yr>\d{4})(?<mo>\d{2})(?<d>\d{2})`
         with = `${d}.${mo}.${yr}` ).                           "28.11.2024
replace( val = `abcdefabghij` pcre = `(a.)(\w*)\1` with = `#` ). "#ghij (backreference)
```

## Lookarounds

| Expression | Represents |
|---|---|
| `(?=...)` | Positive lookahead — followed by, not consumed. |
| `(?!...)` | Negative lookahead — not followed by. |
| `(?<=...)` | Positive lookbehind — preceded by, not consumed. |
| `(?<!...)` | Negative lookbehind — not preceded by. |

```abap
replace( val = `abc ade`   pcre = `a(?=b)`  with = `#` occ = 0 ). "#bc ade
replace( val = `ab c abcd` pcre = `(?<=\s)c` with = `#` occ = 0 ). "ab # abcd
```

## Case conversion in replacement patterns

`\u` upper-case next char · `\U` upper-case until `\E`/`\L` · `\l` lower-case next char · `\L` lower-case until `\E`/`\U` · `\E` end conversion.

```abap
replace( val = `abcdefg` pcre = `c(.*)`     with = `c\U$1` ).      "abcDEFG
replace( val = `abcdefg` pcre = `c(..)(..)` with = `c\U$1\E$2` ). "abcDEfg
```

## Setting options and control verbs

- `(?m)` multi-line mode · `(?s)` single-line/dotall · `(?-x)` disable extended mode.
- These apply to the rest of the group they appear in (top-level pattern or a capturing group).
- `^`/`$` change meaning (start/end of line) under `(?m)`; `.` matches newlines under `(?s)`.

```abap
"Built with the named newline constant, not a literal \n - dotall (?s)
"makes "." match the two real newlines too
DATA(lv_three_lines) = |abc{ cl_abap_char_utilities=>newline }def{ cl_abap_char_utilities=>newline }ghi|.
replace( val = lv_three_lines pcre = `(?s).`  with = `#` occ = 0 ). "11 '#' characters - every character, including both real newlines, replaced
replace( val = `abc def`  pcre = `(?-x)abc def` with = `#` ).    "# (space matched)
```

Control verbs: `(*UTF)` enable UTF mode; line breaks `(*CR)`, `(*LF)`, `(*CRLF)`, `(*ANYCRLF)`.

Other features (advanced): conditional patterns `(?(condition)yes|no)` and `${n:+true:false}` / `${n:-default}` replacement conditions; callouts `(?Cn)` / `(?C"text")` invoking ABAP via `IF_ABAP_MATCHER_CALLOUT`.

---

## cl_abap_regex / cl_abap_matcher

- **`cl_abap_regex`** — object-oriented representation of a regex. `create_pcre( )` builds a PCRE instance. A `cl_abap_regex` object can be used to create a matcher, or passed to `FIND`/`REPLACE` with the `REGEX` addition (the one non-obsolete `REGEX` use).
- **`cl_abap_matcher`** — applies a regex to a string or internal table; methods to search/replace/match and `get...` methods for matcher state. Create via the `create_matcher( )` method of a `cl_abap_regex` instance or via `cl_abap_matcher=>create_pcre( )`.

Key `create_pcre` parameters: `pattern`, `text` (or `table`), `ignore_case`, `enable_multiline`, `extended`.

Key matcher methods: `find_all( )`, `find_next( )`, `match( )`, `replace_all( newtext = )`, `get_match( )`, `get_offset( )`, `get_length( )`, `get_submatch( n )`, `set_callout( )`, plus attributes `text` / `table`.

```abap
DATA(lv_str) = `a1 # B2 ? cd . E3`.

"Compile a pattern, create a matcher (two equivalent ways)
DATA(lo_regex)     = cl_abap_regex=>create_pcre( pattern = `\D\d` ignore_case = abap_true ).
DATA(lo_matcher_1) = lo_regex->create_matcher( text = lv_str ).
DATA(lo_matcher_3) = cl_abap_matcher=>create_pcre( pattern = `\D\d` text = lv_str ignore_case = abap_true ).

"Find all — returns match_result_tab
DATA(lt_result_fa) = lo_matcher_1->find_all( ).

"Replace all in place; read the updated text afterwards
DATA(lo_matcher_2) = cl_abap_matcher=>create_pcre( pattern = `X(.*?)X` text = `XabcdXXefgX` ).
DATA(lv_count)     = lo_matcher_2->replace_all( newtext = `#$1#` ).
DATA(lv_out)       = lo_matcher_2->text.

"Sequential processing with find_next + getters and submatches
DATA(lo_m2) = cl_abap_matcher=>create_pcre( pattern = `\d(\D.)` text = lv_str ).
WHILE lo_m2->find_next( ) = abap_true.
  DATA(lv_offset)  = lo_m2->get_offset( ).
  DATA(lv_length)  = lo_m2->get_length( ).
  DATA(lv_sub1)    = lo_m2->get_submatch( 1 ).
ENDWHILE.

"Reuse a compiled cl_abap_regex in a statement (REGEX addition, NOT obsolete here)
DATA(lo_re) = cl_abap_regex=>create_pcre( pattern = `\d(\D.)` ).
FIND ALL OCCURRENCES OF REGEX lo_re IN lv_str RESULTS DATA(lt_all).

"Multi-line / table / extended parameters
DATA(lo_mm) = cl_abap_matcher=>create_pcre( pattern = `^` text = |abc\ndef| enable_multiline = abap_true ).
DATA(lo_mt) = cl_abap_matcher=>create_pcre( pattern = `z+` table = lt_str_table ignore_case = abap_true ).
DATA(lo_me) = cl_abap_matcher=>create_pcre( pattern = `abc def` text = `abc def` extended = abap_false ).
```

---

## FIND / REPLACE with PCRE — statement form

```abap
"Count, results, submatches
FIND ALL OCCURRENCES OF PCRE `[A-Za-z]` IN lv_str MATCH COUNT DATA(lv_match_count).
FIND ALL OCCURRENCES OF PCRE `\s` IN lv_str RESULTS DATA(lt_match_results).        "match_result_tab
FIND PCRE `(.*)\son\s(.*)` IN lv_str IGNORING CASE SUBMATCHES DATA(lv_before) DATA(lv_after).

"Replace, capture-group reordering, table form
REPLACE PCRE `(.*?)PP(.*)` IN lv_str_replace WITH `$2#$1` IGNORING CASE.
REPLACE ALL OCCURRENCES OF PCRE `\d` IN TABLE lt_str_table WITH `#` RESULTS DATA(lt_res_table).
```

`RESULTS` of a PCRE `FIND` (type `match_result_tab`/`match_result`) contains `submatches` (a nested table of offset/length per capturing group); extract each submatch with `substring( val = text off = sub-offset len = sub-length )`. `RESULTS` of `REPLACE` (type `repl_result_tab`/`repl_result`) holds only line/offset/length.

---

## Common patterns — ILLUSTRATIVE ONLY

> These are teaching examples copied/adapted from the cheat sheet. They are **not** validated, production-grade validators. Real-world email, URL, date, and number formats have many edge cases (internationalized domains, leap years, locale separators). Use a dedicated, well-tested validator or a domain-specific check where correctness matters.

| Goal | Illustrative pattern | Note |
|---|---|---|
| Email (rough) | `\w+(\.\w+)*@(\w+\.)+(\w{2,4})` | From the cheat sheet's `match`/`matches` examples; does not cover all valid addresses. |
| Whitespace | `\s` | Blank, tab, newline. |
| A digit | `\d` | Single digit; `\d+` for a run. |
| `yyyymmdd` date split | `(?<yr>\d{4})(?<mo>\d{2})(?<d>\d{2})` | Splits only — does **not** validate calendar dates. |
| Content inside `/.../ ` URL segments | `(?<=\/)([^\/]+)(?=\/)` | Lookaround + capture; from the URL-segment example. |
| Last comma-delimited field | `,(?!.*,)\K.*` or `,(?=[^,]*$)\K.*` | `\K` drops the comma from the match. |
| HTML `<p>…</p>` body (non-greedy) | `(<p>)(.*?)(<\/p>)` | Regex on HTML is fragile; prefer a parser for real markup. |

```abap
DATA(lv_email) = match( val = `The email address is jon.doe@email.com.`
                     pcre = `\w+(\.\w+)*@(\w+\.)+(\w{2,4})` ).   "jon.doe@email.com
DATA(lv_ok)    = xsdbool( matches( val = `jon.doe@email.com`
                                pcre = `\w+(\.\w+)*@(\w+\.)+(\w{2,4})` ) ).
```

---

## ABAP SQL / CDS regex functions (run in the database)

```abap
SELECT SINGLE carrid, url,
  like_regexpr( pcre = '\..', value = url ) AS like_regex,            "1 = found
  locate_regexpr( pcre = '\..', value = url, occurrence = 2 ) AS loc, "offset of 2nd match
  occurrences_regexpr( pcre = '\..', value = url ) AS occ,            "count
  replace_regexpr( pcre = '\..', value = url, with = '#' ) AS repl,
  substring_regexpr( pcre = '\...', value = url ) AS sub
  FROM zdemo_abap_carr WHERE carrid = 'LH'
  INTO @DATA(ls_result).
```

---

## Sources

- ABAP Keyword Documentation — Regular Expressions: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENREGEX_SYNTAX.html
- PCRE syntax specials in ABAP: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/abenregex_pcre_syntax_specials.html
- Official PCRE/Perl reference: https://perldoc.perl.org/perlre
- SAP-samples/abap-cheat-sheets — 28_Regular_Expressions.md: https://github.com/SAP-samples/abap-cheat-sheets
