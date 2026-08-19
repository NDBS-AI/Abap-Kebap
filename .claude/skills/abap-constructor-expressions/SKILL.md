---
name: abap-constructor-expressions
description: Use when constructing or transforming ABAP data with constructor operators — VALUE (structures, internal tables, ranges, deep/nested), CORRESPONDING (MAPPING/EXCEPT/BASE/DEEP/DISCARDING DUPLICATES/lookup tables), NEW (anonymous data objects and instances), REF (data references), CAST (up/downcasts, RTTS), CONV (forced conversions), EXACT (lossless), COND / SWITCH (conditional results, THROW), REDUCE (folds), FILTER (USING KEY / WHERE / EXCEPT / filter tables); or when writing inline table/structure construction, LET helper variables, or FOR iteration expressions (FOR ... IN, FOR ... UNTIL/WHILE, THEN, STEP, FROM/TO, INDEX INTO, nested/multiple FOR, FOR GROUPS ... GROUP BY). Pulls SAP's official Constructor Expressions cheat sheet into one scannable reference with verbatim syntax.
---

# ABAP Constructor Expressions

## Overview

A constructor expression is a **constructor operator** + a type (or `#` for the operand type) + parameters in parentheses: `... VALUE some_type( ... ) ...` or `... VALUE #( ... ) ...`. The operator constructs a result of that type *in place* — no helper variable, often no extra statement.

Two ideas make these powerful together:
- **Type inference (`#`).** When the type can be derived from the operand position (or, for some operators, the arguments), write `#` instead of naming the type.
- **Inline declaration.** Declare and assign in one go: `DATA(strtable) = VALUE string_table( ( \`a\` ) ( \`b\` ) ).` or `DATA(dec) = CONV decfloat34( '1.23' ).`

**Why use them:** leaner, more readable code, fewer statements. **The catch:** iteration expressions replace `LOOP` but cannot be debugged step by step, and a dense expression can be harder to read than the loop it replaces. Use them where they *clarify* intent — see [abap-clean-style](../abap-clean-style/SKILL.md). They are not showpieces.

## When to Use

Load this skill when:
- Building a structure, internal table, range table, or deep/nested value in place — `VALUE`.
- Copying between non-identical structures/tables with name mapping or exclusions — `CORRESPONDING`.
- Creating anonymous data objects or class instances inline — `NEW`.
- Needing a data/object reference without a helper variable — `REF`.
- Up/downcasting, or reducing RTTS helper variables — `CAST`.
- Forcing a conversion (`CONV`) or a lossless one (`EXACT`).
- Producing a value from conditions (`COND`) or a single discriminator (`SWITCH`), optionally raising via `THROW`.
- Folding a table to one value or building a table iteratively — `REDUCE`.
- Filtering an internal table by key — `FILTER`.
- Iterating inline with `FOR`, or scoping a helper with `LET`.

**When NOT to use:**
- A plain assignment suffices (`DATA(greeting) = CONV string( \`hallo\` ).` is a redundant conversion — just `DATA(greeting) = \`hallo\`.`).
- The logic needs step debugging or is genuinely clearer as a `LOOP` / `IF` / `CASE`.
- Heavy table building/grouping belongs more in [abap-internal-tables](../abap-internal-tables/SKILL.md); elementary typing belongs in [abap-data-objects](../abap-data-objects/SKILL.md).

## Quick Reference

| Operator | Purpose | One-liner |
|---|---|---|
| `VALUE` | Build structures / internal tables / initial values | `DATA(it) = VALUE int_tab_type( ( 1 ) ( 2 ) ( 3 ) ).` |
| `CORRESPONDING` | Copy by name with mapping / exclusion / lookup | `s2 = CORRESPONDING #( s1 MAPPING d = c EXCEPT b ).` |
| `NEW` | Anonymous data object or class instance | `DATA(calc) = NEW cl_tax( country = 'TR' ).` |
| `REF` | Data/object reference to an existing object | `DATA(dref) = REF #( num ).` |
| `CAST` | Up/downcast, returns typed reference | `ref_i = CAST #( ref_gen ).` |
| `CONV` | Forced conversion between types | `DATA(rate) = CONV decfloat34( '0.4' ).` |
| `EXACT` | Lossless assignment/calculation, else exception | `DATA(code) = EXACT clen3( 'XY' ).` |
| `COND` | Result from logical expressions (`WHEN/THEN/ELSE`) | `COND #( WHEN hour < 12 THEN \`day\` ELSE \`night\` )` |
| `SWITCH` | Result from one discriminator value (like `CASE`) | `SWITCH #( op WHEN '+' THEN ... ELSE ... )` |
| `REDUCE` | Fold rows/iterations into one result | `REDUCE i( INIT sum = 0 FOR row IN it NEXT sum += row-col2 )` |
| `FILTER` | Subset of a table by key + `WHERE` | `FILTER #( it USING KEY sk WHERE a < 3 )` |
| `LET ... IN` | Local helper variable inside an expression | `VALUE #( LET mark = '!' IN ( \|a{ mark }\| ) )` |
| `FOR` | Iterate inside `VALUE` / `NEW` / `REDUCE` | `VALUE #( FOR row IN it ( col1 = row-col1 ) )` |

Full variant catalog (every addition of every operator): [references/operator-catalog.md](references/operator-catalog.md).

## VALUE {#value}

Constructs a result *based on a data type* — structures, internal tables, and type-specific initial values for any non-generic type. Elementary and reference types cannot be given a concrete value with `VALUE` (use `CONV`); an empty `VALUE` produces their initial value.

```abap
"Structure (# when type derivable, else name the type)
struc = VALUE #( a = 1 b = 'aaa' ).
DATA(struc2) = VALUE struc_type( a = 4 b = 'ddd' ).

"Internal table — extra parentheses per line
itab = VALUE #( ( a = 5 b = 'eee' )
                ( a = 6 b = 'fff' ) ).
DATA(itab3) = VALUE string_table( ( `Hello` ) ( `world` ) ).

"Type-specific initial value (any type)
struc = VALUE #( ).
DATA(int) = VALUE i( ).
```

**`BASE`** — keep existing content instead of initializing the target:
```abap
struc = VALUE #( BASE struc b = 'bbb' ).            "a kept, only b changed
itab  = VALUE #( BASE itab ( a = 3 b = 'ccc' ) ).   "lines appended
```

**`LINES OF`** — include lines of another table (supports `FROM ... TO`, `STEP`, `USING KEY`):
```abap
itab = VALUE #( ( LINES OF itab5 )
                ( LINES OF itab6 FROM 2 TO 4 ) ).
```

**Deep/nested** values are built in place:
```abap
nested_struc = VALUE #( a = 1 struct = VALUE #( b = 1 c = 'aaa' ) ).
```

**Table expressions as arguments** — avoid `CX_SY_ITAB_LINE_NOT_FOUND` with `OPTIONAL` / `DEFAULT`:
```abap
DATA(it_optional) = VALUE #( it[ 1 ] OPTIONAL ).
DATA(it_default)  = VALUE #( it[ 1 ] DEFAULT VALUE #( a = 1 b = 'abc' ) ).
```

Range tables and short forms (a value before the inner parentheses applies to following lines until overridden) — see the catalog. Inline `VALUE` also avoids helper variables in `MODIFY`/`INSERT`/`DELETE TABLE` and ABAP SQL host expressions.

## CORRESPONDING {#corresponding}

Constructs a structure or internal table, assigning components **by identical name** or by an explicit **mapping**. Unlike `MOVE-CORRESPONDING`, without `BASE` the target is **initialized first** — non-matching components become initial.

```abap
s2 = CORRESPONDING #( s1 ).                          "identical names; rest initialized
s2 = CORRESPONDING #( BASE ( s2 ) s1 ).              "keep existing (parens around BASE!)
s2 = CORRESPONDING #( s1 MAPPING d = c ).            "map target d from source c
s2 = CORRESPONDING #( s1 EXCEPT b ).                 "leave b initial
s2 = CORRESPONDING #( s1 MAPPING d = c EXCEPT b ).   "combine
s2 = CORRESPONDING #( s1 MAPPING d = c EXCEPT * ).   "only mapped comps; rest initial
```

**Internal tables** work the same; `DISCARDING DUPLICATES` prevents `ITAB_DUPLICATE_KEY` when the target has a unique key:
```abap
it2 = CORRESPONDING #( it1 DISCARDING DUPLICATES ).
```

**`MAPPING ... DEFAULT`** assigns a fallback expression (evaluated before the `CORRESPONDING`). With a source component before `DEFAULT`, the source value is used only when it is **not initial**:
```abap
struc2 = CORRESPONDING #( struc1 MAPPING id2 = id1
                                         b = DEFAULT `ha` && `llo`
                                         d = DEFAULT VALUE #( itab1[ 1 ]-d DEFAULT `hi` ) ).
struc2 = CORRESPONDING #( struc1 MAPPING b = b DEFAULT `hallo` ).  "source b if filled
```

**Lookup table** (`FROM tab USING [KEY k] a = b`) joins `itab` with a lookup table; unmatched lines keep their original values; search components are not reassigned unless overridden by `MAPPING`:
```abap
it1 = CORRESPONDING #( it1 FROM lookup_tab USING character = character ).
it4 = CORRESPONDING #( it4 FROM lookup_table USING KEY sk c = a d = b
                       MAPPING a = a b = b c = c d = d f = g ).
```

`DEEP` / `[DEEP] APPENDING` handle nested tabular components — see the catalog.

## NEW {#new}

Creates **anonymous data objects** or **class instances**, returning a reference. Replaces `CREATE DATA` / `CREATE OBJECT` (which remain required only in dynamic programming).

```abap
"Anonymous data objects
dref1 = NEW #( ).                "initial value
dref1 = NEW #( 123 ).            "single value
DATA(dref3) = NEW i( 456 ).
DATA(dref4) = NEW zdemo_abap_carr( carrid = 'XY' carrname = 'XY Airlines' ).
DATA(dref6) = NEW string_table( VALUE #( ( `a` ) ( `b` ) ) ).

"Instances
oref1 = NEW #( ).                          "type derivable
DATA(oref3) = NEW zcl_demo_abap_objects( ).
DATA(oref5) = NEW cl_b( 123 ).             "single ctor param, name optional
```

Follow with `->` for chained attribute access or method calls — no extra variable:
```abap
DATA(str2) = NEW zcl_demo_abap_objects( )->another_string.
NEW zcl_demo_abap_objects( )->hallo_instance_method( ).
```

`NEW` also supports `FOR` and `STEP` when building anonymous tables. See [abap-oo-patterns](../abap-oo-patterns/SKILL.md) for instantiation design.

## REF {#ref}

Creates a **data reference variable** pointing to a data object. Replaces `GET REFERENCE` (do not use that anymore). Useful to pass references as actual parameters without a helper.

```abap
dref_a = REF #( num ).
DATA(dref_c) = REF abap_bool( 'X' ).              "explicit static type
DATA(dref_d) = REF #( int_tab[ 2 ] ).             "table expression
DATA(dref_e) = REF #( int_tab[ 6 ] OPTIONAL ).    "initial ref if not found
DATA(dref_f) = REF #( int_tab[ 7 ] DEFAULT NEW #( 123 ) ).
DATA(oref_b) = REF #( oref_a ).                   "object reference
```

## CAST {#cast}

Performs **upcasts and downcasts**, returning a reference of the given static type. Replaces `?=` and enables method chaining.

```abap
ref_gen = CAST #( ref_i ).        "upcast (CAST optional here)
ref_i   = CAST #( ref_gen ).      "downcast — checked at runtime, must be explicit

"Dereference / component access on the result
DATA(str)  = CAST string( ref_gen )->*.
DATA(comp) = CAST zdemo_abap_carr( ref_gen )->carrid.

"RTTS without helper variables
DATA(components) = CAST cl_abap_structdescr(
    cl_abap_typedescr=>describe_by_data( st ) )->components.
```

More up/downcast examples in [abap-oo-patterns](../abap-oo-patterns/SKILL.md) and the dynamic programming skill.

## CONV {#conv}

Forces a **conversion** between types per the conversion rules, and is the way to construct elementary data objects with a value (which `VALUE` cannot do).

```abap
DATA(conv_res) = CONV decfloat34( 1 / 5 ).   "0.2 (without CONV: 1/5 = 0, type i)
DATA(rate)     = CONV decfloat34( '0.4' ).
DATA(conv_itab) = CONV inttab_type( itab ).  "to a different table type/key
```
Do not write redundant conversions: `DATA(greeting) = \`hallo\`.` already types `greeting` as `string`; `CONV string( \`hallo\` )` only adds a warning.

## EXACT {#exact}

Enforces a **lossless** assignment or calculation; raises a catchable exception if data would be lost or precision rounded. See also [abap-clean-style](../abap-clean-style/SKILL.md).

```abap
DATA(as1) = EXACT clen3( abap_true ).
TRY.
    DATA(as4) = EXACT clen3( 'abcd' ).        "too long
  CATCH cx_sy_conversion_data_loss.
ENDTRY.

DATA(calc1) = EXACT packednum( 1 / 4 ).       "ok
TRY.
    DATA(calc3) = EXACT packednum( 1 / 3 ).   "needs rounding
  CATCH cx_sy_conversion_rounding.
ENDTRY.
```

## COND {#cond}

Produces a result from one or more **logical expressions** (`WHEN ... THEN ...`), with an optional `ELSE` (otherwise initial value). Can raise via `THROW` / `THROW SHORTDUMP`.

```abap
DATA(day_or_night) = COND #( WHEN cl_abap_context_info=>get_system_time( ) BETWEEN '050000' AND '220000'
                             THEN `day`
                             ELSE `night` ).

"LET shared across all WHEN branches
DATA(time_of_day) = COND #( LET time = cl_abap_context_info=>get_system_time( ) IN
                            WHEN time BETWEEN '050001' AND '120000' THEN |Good morning ...|
                            ELSE |Good night ...| ).

"THROW raises like RAISE EXCEPTION TYPE
DATA(div) = COND decfloat34( WHEN num1 <> 0 AND num2 <> 0 THEN num1 / num2
                             ELSE THROW cx_sy_zerodivide( ) ).
```
All `THEN` operands must be convertible to the result type. `THROW` examples: see the Exceptions cheat sheet.

## SWITCH {#switch}

Like `COND`, but tests a **single value** (in the style of `CASE`). Also supports `THROW`.

```abap
DATA(calc_result) = SWITCH #( operator
                              WHEN '+' THEN |{ num1 + num2 STYLE = SIMPLE }|
                              WHEN '-' THEN |{ num1 - num2 STYLE = SIMPLE }|
                              WHEN '*' THEN |{ num1 * num2 STYLE = SIMPLE }|
                              WHEN '/' THEN |{ CONV decfloat34( num1 / num2 ) STYLE = SIMPLE }|
                              ELSE `Wrong operator.` ).
```

## REDUCE {#reduce}

Folds one or more `FOR` iterations into a single result. `FOR` is **mandatory**. Structure: optional `LET`, then `INIT` (result variable + initial value), `FOR`, `NEXT` (assignment applied each iteration).

```abap
"Sum a column -> 6
DATA(sum_val) = REDUCE i( INIT len = 0
                          FOR <line> IN itab
                          NEXT len = len + <line>-col2 ).

"Longest string -> ccc
DATA(long_str) = REDUCE s-col1( INIT str = VALUE #( )
                                FOR <line> IN itab
                                NEXT str = COND #( WHEN strlen( <line>-col1 ) > strlen( str )
                                                   THEN <line>-col1 ELSE str ) ).

"Build a table (VALUE BASE appends each pass)
DATA(itstr) = REDUCE string_table( INIT strtab = VALUE string_table( )
                                   FOR wa IN itab
                                   NEXT strtab = VALUE #( BASE strtab
                                     ( |sum is { wa-col2 + wa-col3 }| ) ) ).

"Conditional iteration: 1..10 -> 55
DATA(reduce_until) = REDUCE i( INIT sum = 0
                              FOR int = 1 UNTIL int > 10
                              NEXT sum += int ).
```
`INIT` may declare several variables; only the first determines the result (others are usable after `NEXT`). `WHERE ( ... )` is allowed on table iterations.

## FILTER {#filter}

Constructs a subset of an internal table by key. The source table needs a **sorted key** or **hash key** (primary or secondary). Conditions combine with `AND` only (no `OR`/`NOT`). `EXCEPT` inverts the `WHERE` condition.

```abap
DATA(f1) = FILTER #( fi_tab1 WHERE a >= 4 ).                          "primary key, implicit
DATA(f2) = FILTER #( fi_tab1 USING KEY primary_key WHERE a >= 4 ).    "explicit primary
DATA(f3) = FILTER #( fi_tab2 USING KEY sec_key WHERE a < 3 ).         "secondary key
DATA(f4) = FILTER #( fi_tab3 WHERE a = 3 ).                           "hash key: only =
DATA(f5) = FILTER #( fi_tab4 USING KEY sec_hash_key WHERE a = 3 AND b = 'ccc' ).
DATA(f6) = FILTER #( fi_tab1 EXCEPT WHERE a >= 4 ).                   "inverse
```

**Filter table** (`IN filter_tab`): keep source lines for which at least one filter line matches the `WHERE` comparison. `USING KEY` can target the source or the filter table depending on placement; `EXCEPT` inverts.
```abap
DATA(f11) = FILTER #( fi_tab1 IN filter_tab1 WHERE a = table_line ).
DATA(f13) = FILTER #( fi_tab2 IN filter_tab2 USING KEY line WHERE a = table_line ).
```
Hash keys allow `=` only; sorted keys allow the full comparison set, and single-value filtering also allows `IS [NOT] INITIAL`.

## LET expressions {#let}

`LET var = expr ... IN` defines one or more local helper variables (or field symbols) **scoped entirely to the expression**. The right-hand side is typed by inference, as in an inline declaration. Use it when a computed value is needed more than once, to avoid recomputation and noise.

```abap
DATA(strtab) = VALUE string_table( LET mark = '!' IN
                                   ( |abc{ mark }| )
                                   ( |def{ mark }| ) ).

DATA(new_struc) = NEW st_type( LET num = 2 ch = 'AP' IN
                               comp1 = 'AB' && ch comp2 = 2 * num comp3 = 3 * num ).
```
A `LET` field symbol needs a **writable** right-hand side (e.g. a table expression `it[ sy-index ]` or `NEW ...->attr`). `LET` placed after `FOR` is re-evaluated every iteration.

## FOR iteration {#for}

`FOR` drives iterations inside `VALUE`, `NEW`, and `REDUCE`. Two flavors: **table iterations** (`FOR wa IN itab`, semantics of `LOOP AT`) and **conditional iterations** (`FOR index = ... UNTIL/WHILE`, semantics of `DO`/`WHILE`). The iteration variable is visible only inside the `FOR`. Iterations cannot be debugged.

```abap
"Table iteration
DATA(it1) = VALUE itab_type( FOR wa IN itab ( col1 = wa-col1 && 'z'
                                              col2 = wa-col2 + 1 ) ).

"INDEX INTO (stores sy-tabix, implicitly type i) + LET re-evaluated each pass
DATA(it2) = VALUE itab_type( FOR <line> IN itab INDEX INTO idx
                             LET idxplus1 = idx + 1 IN
                             ( col1 = <line>-col1 col2 = idx col3 = idxplus1 ) ).

"WHERE (in parentheses), FROM/TO, STEP, USING KEY
DATA(it8)  = VALUE itab_type( FOR wa IN itab WHERE ( col2 < 3 ) ( col1 = wa-col1 ) ).
DATA(it9)  = VALUE itab_type( FOR wa IN itab FROM 2 TO 3 ( col1 = wa-col1 ) ).
DATA(it10) = VALUE itab_type( FOR wa IN itab STEP -1 ( col1 = wa-col1 ) ).
DATA(it11) = VALUE itab_type( FOR wa IN itab USING KEY primary_key ( col1 = wa-col1 ) ).

"Nested / multiple FOR = nested loops
DATA(it7) = VALUE string_table( FOR wa1 IN itab
                                FOR wa2 IN inttab
                                ( |{ wa1-col1 } / { wa2 }| ) ).

"Conditional: THEN optional for numeric/d/t (implicit +1), required otherwise
DATA(it12) = VALUE itab_type( FOR index = 1 WHILE index < 4 ( col1 = index ) ).
DATA(it14) = VALUE itab_type( FOR index = 1 THEN index + 2 WHILE index < 8 ( col1 = index ) ).
DATA(it15) = VALUE itab_type( FOR str = `x` THEN str && str WHILE strlen( str ) < 5 ( col1 = str ) ).
DATA(it16) = VALUE itab_type( FOR offset = 10 UNTIL offset > 12 ( col1 = offset ) ).
```
`STEP` controls step size and direction (`STEP 2` every second, `STEP -1` reverse). `CORRESPONDING #( wa )` inside `FOR` handles non-identical line types.

**Grouping** with `FOR GROUPS ... GROUP BY` (equivalent to `LOOP AT ... GROUP BY`); see [abap-internal-tables](../abap-internal-tables/SKILL.md):
```abap
DATA(it_val_1) = VALUE string_table( FOR GROUPS gr OF wa IN itab4grp
                                     GROUP BY wa-col1 ASCENDING
                                     WITHOUT MEMBERS
                                     ( |{ gr }| ) ).
```
The group key may be a structured key with `GROUP SIZE` / `GROUP INDEX`; `FOR ... IN GROUP gr` iterates members.

## Common Mistakes

| Mistake | Why it hurts | Fix |
|---|---|---|
| Expecting `CORRESPONDING #( s )` to keep old values | Target is initialized first | Add `BASE ( s )` to retain content |
| `CORRESPONDING #( BASE s ... )` without parentheses | Syntax error | `CORRESPONDING #( BASE ( s ) ... )` — parens are mandatory here |
| `VALUE elem_type( '0.4' )` for an elementary value | `VALUE` only makes initial elementary values | Use `CONV elem_type( '0.4' )` |
| `CONV string( \`hallo\` )` on a literal | Redundant; raises a warning | Assign directly: `DATA(greeting) = \`hallo\`.` |
| Table expression `it[ n ]` in `VALUE`/`REF` without guard | `CX_SY_ITAB_LINE_NOT_FOUND` | Add `OPTIONAL` or `DEFAULT ...` |
| `FILTER #( it WHERE ... )` on a standard table with no sorted/hash key | No key to access by | Define a sorted/secondary/hash key, then `USING KEY` |
| `OR` / `NOT` in a `FILTER` `WHERE` | Not allowed | Combine with `AND`, or use `EXCEPT` to invert |
| `FOR str = \`x\` WHILE ...` without `THEN` | `THEN` required for non-numeric iteration variables | Add `THEN <next-value>` |
| Using a `FOR`/`REDUCE` helper variable outside the expression | Scoped to the expression only | Declare a real variable, or restructure |
| Reaching for a constructor expression as a showpiece | Dense expressions hurt readability and cannot be debugged | Prefer the clearer of expression vs `LOOP`/`IF`/`CASE` |
| Mismatched types when reusing a `FOR` helper name | Reuse needs identical type | Use a fresh name or matching type |

## References

- **Source cheat sheet:** [SAP-samples/abap-cheat-sheets — 05_Constructor_Expressions](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/05_Constructor_Expressions.md) — ground truth for every snippet here.
- **ABAP Keyword Documentation — Constructor expressions:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abenconstructor_expression_glosry.htm
- Local: [references/operator-catalog.md](references/operator-catalog.md) — exhaustive additions per operator for lookup.
- Cross-links: [abap-internal-tables](../abap-internal-tables/SKILL.md) (building/grouping tables), [abap-data-objects](../abap-data-objects/SKILL.md) (typing), [abap-clean-style](../abap-clean-style/SKILL.md) (when constructor expressions earn their place), [abap-oo-patterns](../abap-oo-patterns/SKILL.md) (`NEW`/`CAST` in OO).
