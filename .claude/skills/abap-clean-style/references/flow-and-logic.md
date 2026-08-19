# Program Flow & Logical Expressions — Full Catalog

Syntax catalog for control structures, flow-control keywords, logical expressions, and predicate/Boolean functions. All syntax is copied verbatim from SAP's [13_Program_Flow_Logic](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/13_Program_Flow_Logic.md) and [37_Logical_Expressions_and_Functions](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/37_Logical_Expressions_and_Functions.md) cheat sheets. For Clean ABAP guidance (guard clauses, `xsdbool` over `boolc`, no `CHECK` mid-method), see the parent [SKILL.md §control-flow](../SKILL.md).

## Control Structures

### IF / ELSEIF / ELSE

- A maximum of one statement block is executed. The check runs top to bottom; the block after the first true logical expression runs.
- If none are true, the `ELSE` block runs. `ELSE` and `ELSEIF` are optional, but specifying `ELSE` ensures at least one block runs.

```abap
DATA(abap) = `ABAP`.
FIND `AB` IN abap.
IF sy-subrc = 0.
  "found
  ...
ELSE.
  "not found
  ...
ENDIF.

"IF statement with multiple included ELSEIF statements
DATA(current_utc_time) = cl_abap_context_info=>get_system_time( ).
DATA greetings TYPE string.

IF current_utc_time BETWEEN '050000' AND '115959'.
  greetings = |Good morning, it's { current_utc_time TIME = ISO }.|.
ELSEIF current_utc_time BETWEEN '120000' AND '175959'.
  greetings = |Good afternoon, it's { current_utc_time TIME = ISO }.|.
ELSEIF current_utc_time BETWEEN '180000' AND '215959'.
  greetings =  |Good evening, it's { current_utc_time TIME = ISO }.|.
ELSE.
  greetings = |Good night, it's { current_utc_time TIME = ISO }.|.
ENDIF.
```

Control structures can be nested:

```abap
IF num = 1.
  IF flag = 'X'.
   ...
   ELSE.
    ...
  ENDIF.
ELSE.
  ...
ENDIF.
```

> SAP recommends not nesting more than 5 control structures — outsource functionality into methods instead. Keep the number of consecutive control structures low.

#### COND operator (conditional expression in operand position)

`COND` implements branches in operand positions based on logical expressions. The result type is specified after `COND` (or `#` if derivable from context). All operands after `THEN` must be convertible to the result type.

```abap
DATA greetings_cond TYPE string.
DATA(current_utc_time_cond) = cl_abap_context_info=>get_system_time( ).
greetings_cond = COND #( WHEN current_utc_time_cond BETWEEN '050000' AND '115959' THEN |Good morning, it's { current_utc_time_cond TIME = ISO }.|
                         WHEN current_utc_time_cond BETWEEN '120000' AND '175959' THEN |Good afternoon, it's { current_utc_time_cond TIME = ISO }.|
                         WHEN current_utc_time_cond BETWEEN '180000' AND '215959' THEN |Good evening, it's { current_utc_time_cond TIME = ISO }.|
                         ELSE |Good night, it's { current_utc_time_cond TIME = ISO }.| ).
```

### CASE

- Case distinction. A maximum of one statement block is executed depending on the value of the operand after `CASE`. Constant values should be specified as operands.
- `WHEN op1 OR op2 OR op3 ...` matches more than one value.
- `WHEN OTHERS` (optional) runs when no match is found.

```abap
CASE random_num.
  WHEN 1.
    num = `The number is 1.`.
  WHEN 2.
    num = `The number is 2.`.
  WHEN 3 OR 4.
    num = `The number is either 3 or 4.`.
  WHEN OTHERS.
    num = `The number is not between 1 and 4.`.
ENDCASE.
```

#### CASE TYPE OF

Checks the type of object reference variables. An object reference variable with the static type of a class or interface must follow `CASE TYPE OF`. (RTTI dispatch — a code smell in business logic; use polymorphism instead. Legitimate only in framework code.)

```abap
DATA stringtab TYPE TABLE OF string WITH EMPTY KEY.
DATA(type_description) = cl_abap_typedescr=>describe_by_data( stringtab ).

CASE TYPE OF type_description.
  WHEN TYPE cl_abap_elemdescr.
    ...
  WHEN TYPE cl_abap_refdescr.
    ...
  WHEN TYPE cl_abap_structdescr.
    ...
  WHEN TYPE cl_abap_tabledescr.
    ...
  WHEN OTHERS.
    ...
ENDCASE.
```

#### SWITCH operator (case distinction in operand position)

Makes case distinctions in operand positions, constructing a result. Same type criteria as `COND`.

```abap
DATA(num_switch) = SWITCH #( random_num_switch
                             WHEN 1 THEN `The number is 1.`
                             WHEN 2 THEN `The number is 2.`
                             WHEN 3 OR 4 THEN `The number is either 3 or 4.`
                             ELSE `The number is not between 1 and 4.` ).
```

## Loops

### DO — unconditional loops

A block between `DO` and `ENDDO` is carried out multiple times. Exited via a termination statement (`EXIT`); otherwise endless. `sy-index` holds the number of loop passes including the current one.

```abap
DATA str_a TYPE string.
DO.
  str_a &&= sy-index.
  IF sy-index = 5.
    EXIT.
  ENDIF.
ENDDO.
"str_a: 12345

"Restrict passes with TIMES
DATA str_b TYPE string.
DO 9 TIMES.
  str_b &&= sy-index.
ENDDO.
"str_b: 123456789
```

### WHILE — conditional loops

Repeated as long as a logical expression is true; ended by `ENDWHILE`. `sy-index` holds the number of passes including the current. Can be exited with `EXIT`/`CHECK`/`CONTINUE`.

```abap
DATA int_itab TYPE TABLE OF i WITH EMPTY KEY.

WHILE lines( int_itab ) = 5.
  int_itab = VALUE #( BASE int_itab ( sy-index ) ).
ENDWHILE.
```

### Loops across tables

- `LOOP ... ENDLOOP` for internal tables — see [abap-internal-tables](../../abap-internal-tables/SKILL.md). `sy-index` is *not* set here; `sy-tabix` holds the table index of the current line.
- `FOR` loops with `VALUE` / `REDUCE` — iteration expressions (see [abap-constructor-expressions](../../abap-constructor-expressions/SKILL.md)).
- `SELECT ... ENDSELECT` loops across a result set — see [abap-sql-performance](../../abap-sql-performance/SKILL.md).

## Flow-Control Keywords: CONTINUE / CHECK / EXIT / RETURN

| Keyword | Syntax | Details |
|---|---|---|
| `CONTINUE` | `CONTINUE.` | The current loop pass is terminated immediately; flow continues with the next loop pass. |
| `CHECK` | `CHECK log_exp.` | Conditional termination. If `log_exp` is false, the current loop pass is terminated immediately; flow continues with the next loop pass. |
| `EXIT` | `EXIT.` | The loop is terminated completely; flow resumes after the loop's closing statement. |
| `RETURN` | `RETURN.` | Terminates the current processing block. Intended for leaving procedures (e.g. methods) early. |

```abap
"CONTINUE — skip even numbers
DO 15 TIMES.
  IF sy-index MOD 2 = 0.
    CONTINUE.
  ELSE.
    str_c = |{ str_c }{ COND #( WHEN str_c IS NOT INITIAL THEN `, ` ) }{ sy-index }|.
  ENDIF.
ENDDO.
"str_c: 1, 3, 5, 7, 9, 11, 13, 15

"CHECK — terminate pass when condition is false (continue when index is even)
DO 15 TIMES.
  CHECK sy-index MOD 2 = 0.
  str_d = |{ str_d }{ COND #( WHEN str_d IS NOT INITIAL THEN `, ` ) }{ sy-index }|.
ENDDO.
"str_d: 2, 4, 6, 8, 10, 12, 14

"CHECK NOT
DO 15 TIMES.
  CHECK NOT sy-index MOD 2 = 0.
  str_e = |{ str_e }{ COND #( WHEN str_e IS NOT INITIAL THEN `, ` ) }{ sy-index }|.
ENDDO.
"str_e: 1, 3, 5, 7, 9, 11, 13, 15

"EXIT — terminate the entire loop
DO 15 TIMES.
  IF sy-index = 7.
    EXIT.
  ELSE.
    str_f = |{ str_f }{ COND #( WHEN str_f IS NOT INITIAL THEN `, ` ) }{ sy-index }|.
  ENDIF.
ENDDO.
"str_f: 1, 2, 3, 4, 5, 6
```

> Clean-usage notes (from the F1 guidelines):
> - `RETURN` immediately terminates the current processing block. It should only be used to exit **procedures** (methods), not as a loop-internal control device.
> - `EXIT` and `CHECK` *can* exit procedures too, but their use is **recommended inside loops** — not in the middle of a method body. In a method, replace mid-body `CHECK` with a guard clause (`IF ... RETURN`).

### RETURN with an expression (functional methods)

In a functional method (one returning parameter), `RETURN` can be specified with an expression. These are equivalent:

```abap
res = some_expr.
RETURN.
```

```abap
RETURN some_expr.
```

The expression can be a constructor expression with `#` type inference (the returning parameter's type):

```abap
METHOD multiply.
  TRY.
      RETURN num1 * num2.
    CATCH cx_sy_arithmetic_error.
      RETURN VALUE #( ).
  ENDTRY.
ENDMETHOD.
```

## Comparison Expressions

### General comparison operators (all data types)

Comparisons follow [comparison rules](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenlogexp_rules.htm) — operands of different types are converted to a common type before comparison.

| Operator | Alt. | Meaning |
|---|---|---|
| `a = b` | `a EQ b` | content of the two operands is equal |
| `a <> b` | `a NE b` | content is not equal |
| `a < b` | `a LT b` | left less than right |
| `a > b` | `a GT b` | left greater than right |
| `a <= b` | `a LE b` | left less than or equal to right |
| `a >= b` | `a GE b` | left greater than or equal to right |
| `a [NOT] BETWEEN b AND c` | — | ternary; left is (not) within the closed interval. Equivalent to `[NOT] ( a >= b AND a <= c )` |
| `a [NOT] IN @ranges_table` | — | tabular; left (does not) match the [ranges conditions](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenranges_condition_glosry.htm) in a ranges table |

```abap
IF m BETWEEN n AND o.       ... ENDIF.
IF m NOT BETWEEN n AND o.   ... ENDIF.
```

#### Ranges (IN)

`IN` checks the left operand against ranges conditions in a ranges table. (`CP`/`NP` are transformed into `LIKE` conditions, making them case-sensitive.)

```abap
DATA int_tab TYPE TABLE OF i WITH EMPTY KEY.
int_tab = VALUE #( FOR index = 1 WHILE index <= 20 ( index ) ).

DATA rangestab TYPE RANGE OF i.
"Value range between 1 and 10
rangestab = VALUE #( ( sign = 'I' option = 'BT' low = 1 high = 10 ) ).

SELECT table_line FROM @int_tab AS tab
  WHERE table_line IN @rangestab
  INTO TABLE @DATA(result_tab).

"Value range: Lower than 5 + greater than or equal to 15
rangestab = VALUE #( ( sign = 'I' option = 'LT' low = 5 )
                     ( sign = 'I' option = 'GE' low = 15  ) ).
```

### Comparison operators for character-like data types

Search is case-sensitive for `CA`/`NA`/`CO`/`CN`; case-insensitive for `CS`/`NS`/`CP`/`NP` (except characters escaped with `#` in patterns). `sy-fdpos` holds the offset of the first hit, or the string length if not found.

| Operator | Meaning |
|---|---|
| `CA` | contains any — any character of the set is in the string |
| `NA` | contains not any — no character of the set is in the string |
| `CO` | contains only — string contains only characters from the set |
| `CN` | contains not only — string contains characters other than the set |
| `CS` | contains string — substring search (not case-sensitive) |
| `NS` | contains no string — substring is not contained |
| `CP` | conforms to pattern — `*` (any sequence), `+` (one char), `#` (escape next char) |
| `NP` | does not conform to pattern — negation of `CP` |

```abap
DATA(s1) = `cheers`.
IF s1 CA `aeiou`. ... "true; sy-fdpos: 2
IF s1 CA `xy`. ...    "false; sy-fdpos: 6

DATA(s5) = `Lorem ipsum dolor sit amet.`.
IF s5 CS `or`. ... "true; sy-fdpos: 1

DATA(s7) = `abc_def_ghi`.
"f preceded by any sequence, followed by literal '_' then any sequence
IF s7 CP `*f#_*`. ... "true; sy-fdpos: 6
```

## Predicates

### Predicate expressions (IS / IS NOT)

Relational expressions with the predicate operator `IS`. `NOT` negates.

| Expression | Checks |
|---|---|
| `IS [NOT] INITIAL` | operand contains (not) its type-dependent initial value |
| `IS [NOT] BOUND` | a reference variable contains a valid reference (data ref dereferenceable / object ref points to an object) |
| `IS [NOT] INSTANCE OF` | a downcast is possible for a non-initial object reference variable (RTTS check before a CAST) |
| `IS [NOT] ASSIGNED` | a memory area is assigned to a field symbol |
| `IS [NOT] SUPPLIED` | an optional formal parameter was filled/requested — only inside function modules and methods |

```abap
"IS INITIAL
IF p IS INITIAL.      ... ENDIF.
IF p IS NOT INITIAL.  ... ENDIF.

"IS BOUND
DATA(dref) = NEW string( `ABAP` ).
IF dref IS BOUND.
  DATA(some_string) = dref->*.
ENDIF.

"IS INSTANCE OF — guard a CAST instead of catching CX_SY_MOVE_CAST_ERROR
IF oref1 IS INSTANCE OF lcl2.
  oref2 = CAST #( oref1 ).
ENDIF.

"IS ASSIGNED
FIELD-SYMBOLS <fs> TYPE string.
ASSIGN some_str TO <fs>.
IF <fs> IS ASSIGNED. ... ENDIF.

"IS SUPPLIED (inside a method, formal parameter num2 OPTIONAL)
IF num2 IS SUPPLIED.
  APPEND |num2 (is supplied): "{ num2 }"| TO str_table.
ELSE.
  APPEND |num2 (is not supplied; initial value): "{ num2 }"| TO str_table.
ENDIF.
```

### Predicate functions

Built-in logical functions returning a truth value. For character-like and table-like arguments.

| Function | Checks |
|---|---|
| `contains( val = … sub = … )` | text string contains a substring. Optional: `start`/`end`, `off`/`len`, `case`, `occ`, `pcre` |
| `contains_any_of( val = … sub = … )` | any of the individual characters is contained (no `pcre`) |
| `contains_any_not_of( val = … sub = … )` | any character not in the set is contained (no `pcre`) |
| `matches( val = … pcre = … )` | search range of a value matches a regular expression. Optional: `case`, `off`, `len` |
| `line_exists( itab[ … ] )` | a line exists in an internal table (expects a table expression) |

```abap
"contains
IF contains( val = `abdefghijklmn` sub = `ghi` ). ... ENDIF.   "true
DATA(cont3) = xsdbool( contains( val = `ABCDE` start = `ab` case = abap_false ) ). "abap_true
DATA(cont9) = xsdbool( contains( val = `Hallo world` pcre = `\s` ) ).              "abap_true

"contains_any_of / contains_any_not_of
DATA(cont10) = xsdbool( contains_any_of( val = `abcdefg` sub = `xyza` ) ).         "abap_true

"matches — email validation
DATA(matches) = xsdbool( matches( val  = `jon.doe@email.com`
                                  pcre = `\w+(\.\w+)*@(\w+\.)+(\w{2,4})` ) ).      "abap_true

"line_exists — preferred over READ TABLE ... IF sy-subrc = 0
IF line_exists( itab[ 1 ] ). ... ENDIF.
DATA(le3) = xsdbool( line_exists( itab[ comp1 = 2 ] ) ).                          "abap_true
```

> Related: `line_index( itab[ … ] )` returns the index of a found line (0 if not found) — see [abap-internal-tables](../../abap-internal-tables/SKILL.md). It complements `line_exists` when the position matters.

### Predicative method calls & data objects as relational expressions

- **Predicative method call** `... meth( ) ...` — its single operand is a functional method call. True if the return value is not initial (type-dependent initial value check). Short form of `meth( ) IS NOT INITIAL`.
- **Data object as relational expression** `... dobj ...` — true if the operand's content is not initial. Short form of `dobj IS NOT INITIAL`. So `IF flag.` is equivalent to `IF flag IS NOT INITIAL.`.

```abap
"Predicative method call
IF check_num_greater_than_10( CONV decfloat34( '10.000000001' ) ).
  is_greater = abap_true.
ENDIF.

"Data object as relational expression
IF number.            "equivalent to IF number IS NOT INITIAL.
  is_initial = abap_false.
ELSE.
  is_initial = abap_true.
ENDIF.
```

## Boolean Operators and Parentheses

| Operator | Details |
|---|---|
| `NOT` | negates a logical expression (distinct from the `NOT` addition inside `IS NOT INITIAL` etc.) |
| `AND` | combined expression is false if any operand is false |
| `OR` | combined expression is true if at least one operand is true |
| `EQUIV` | true if both expressions are either true or false (equivalence) |
| `( … )` | parentheses refine conditions and set processing priority |

```abap
IF num1 IS NOT INITIAL AND num2 IS NOT INITIAL AND num3 IS NOT INITIAL.  ... ENDIF.
IF num1 IS NOT INITIAL OR num2 IS NOT INITIAL.                           ... ENDIF.
IF num1 = num2 EQUIV num3 = num4.                                       ... ENDIF.
IF ( num1 = num2 AND num3 = num4 ) AND NOT ( num1 <> num2 OR num3 <> num4 ). ... ENDIF.
```

### Operands of logical expressions

Operands can include data objects/literals, built-in functions, functional methods, calculation expressions, constructor expressions, and table expressions:

```abap
IF
  num = 1                                             "data object
AND 'ABAP' IS NOT INITIAL
AND reverse( `PABA` ) = `ABAP`                        "built-in function
AND strlen( `ABAP` ) = 4
AND ipow( base = 2 exp = 3 ) = 8
AND xsdbool( 3 > 1 ) = abap_true                      "boolean function
AND 1 + 2 = 3                                         "calculation expression
AND VALUE i( ) = 0                                    "constructor expression
AND COND #( WHEN num = 1 THEN `A` ELSE `B` ) = `A`
AND str_table[ 2 ] = `b`.                             "table expression
  result = abap_true.
ELSE.
  result = abap_false.
ENDIF.
```

## Boolean Functions: boolc vs xsdbool

Both evaluate a logical expression and return a truth value. **The difference is the return type — and it is the most common gotcha in this area.**

| Function | Return type | True | False |
|---|---|---|---|
| `boolc` | `string` | `X` | blank (a single space, *not* an empty string) |
| `xsdbool` | `c LENGTH 1` (same as `abap_bool`) | `X` | blank |

**The gotcha:** `boolc` returns type `string`. Comparing its result to `abap_true`/`abap_false` converts `c` to `string` and ignores trailing blanks, which can give surprising results. Also, a false `boolc` result does **not** satisfy `IS INITIAL` (it is a blank, not an empty string). `xsdbool` returns the technical type `c` and *can* be compared directly with `abap_true`/`abap_false`.

**Clean ABAP: prefer `xsdbool`** anywhere the result feeds an `abap_bool` variable or an `abap_true`/`abap_false` comparison.

```abap
"boolc returns an X or a blank of type string
DATA(int) = 0.
DATA(boolc2) = |#{ boolc( int IS INITIAL ) }#|.     "#X#
DATA(boolc3) = |#{ boolc( int IS NOT INITIAL ) }#|. "# #  (blank, not empty)

"xsdbool — type c, comparable with abap_true/abap_false
DATA(xsdb1) = xsdbool( 3 > 1 ).      "abap_true
DATA(xsdb2) = |#{ xsdbool( 1 = 1 ) }#|. "#X#

"boolc and xsdbool are NOT equal under comparison
IF boolc( 1 = 0 ) = xsdbool( 1 = 0 ).
  DATA(res) = `equal`.
ELSE.
  res = `not equal`.   "this branch runs
ENDIF.

"xsdbool replaces a 5-line IF / COND
DATA(xsdb4) = xsdbool( -1 < 1 ).                              "abap_true
DATA(truth_value2) = COND #( WHEN -1 < 1 THEN abap_true ELSE abap_false ).
```

> `boolx` is the equivalent Boolean function for byte-like types.

## Sources

- [SAP-samples/abap-cheat-sheets — 13_Program_Flow_Logic](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/13_Program_Flow_Logic.md)
- [SAP-samples/abap-cheat-sheets — 37_Logical_Expressions_and_Functions](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/37_Logical_Expressions_and_Functions.md)
- [ABAP Keyword Documentation — comparison rules](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenlogexp_rules.htm)
