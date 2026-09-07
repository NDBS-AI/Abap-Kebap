---
name: abap-constructor-expressions
description: Use when constructing or transforming ABAP data with constructor operators — VALUE (structures, internal tables, ranges, deep/nested), CORRESPONDING (MAPPING/EXCEPT/BASE/DEEP/DISCARDING DUPLICATES/lookup tables), NEW (anonymous data objects and instances), REF (data references), CAST (up/downcasts, RTTS), CONV (forced conversions), EXACT (lossless), COND / SWITCH (conditional results, THROW), REDUCE (folds), FILTER (USING KEY / WHERE / EXCEPT / filter tables); or when writing inline table/structure construction, LET helper variables, or FOR iteration expressions (FOR ... IN, FOR ... UNTIL/WHILE, THEN, STEP, FROM/TO, INDEX INTO, nested/multiple FOR, FOR GROUPS ... GROUP BY). Pulls SAP's official Constructor Expressions cheat sheet into one scannable reference with verbatim syntax.
---

# ABAP Constructor Expressions

## Overview

A constructor expression is a **constructor operator** + a type (or `#` for the operand type) + parameters in parentheses: `... VALUE some_type( ... ) ...` or `... VALUE #( ... ) ...`. The operator constructs a result of that type *in place* — no helper variable, often no extra statement.

Two ideas make these powerful together:
- **Type inference (`#`).** When the type can be derived from the operand position (or, for some operators, the arguments), write `#` instead of naming the type.
- **Inline declaration.** Declare and assign in one go: `DATA(lt_strtable) = VALUE string_table( ( \`a\` ) ( \`b\` ) ).` or `DATA(lv_dec) = CONV decfloat34( '1.23' ).`

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
- A plain assignment suffices (`DATA(lv_greeting) = CONV string( \`hallo\` ).` is a redundant conversion — just `DATA(lv_greeting) = \`hallo\`.`).
- The logic needs step debugging or is genuinely clearer as a `LOOP` / `IF` / `CASE`.
- Heavy table building/grouping belongs more in [abap-internal-tables](../abap-internal-tables/SKILL.md); elementary typing belongs in [abap-data-objects](../abap-data-objects/SKILL.md).

## Quick Reference

| Operator | Purpose | One-liner |
|---|---|---|
| `VALUE` | Build structures / internal tables / initial values | `DATA(lt_it) = VALUE int_tab_type( ( 1 ) ( 2 ) ( 3 ) ).` |
| `CORRESPONDING` | Copy by name with mapping / exclusion / lookup | `ls_s2 = CORRESPONDING #( ls_s1 MAPPING d = c EXCEPT b ).` |
| `NEW` | Anonymous data object or class instance | `DATA(lo_calc) = NEW cl_tax( country = 'TR' ).` |
| `REF` | Data/object reference to an existing object | `DATA(lr_dref) = REF #( lv_num ).` |
| `CAST` | Up/downcast, returns typed reference | `lo_ref_i = CAST #( lo_ref_gen ).` |
| `CONV` | Forced conversion between types | `DATA(lv_rate) = CONV decfloat34( '0.4' ).` |
| `EXACT` | Lossless assignment/calculation, else exception | `DATA(lv_code) = EXACT clen3( 'XY' ).` |
| `COND` | Result from logical expressions (`WHEN/THEN/ELSE`) | `COND #( WHEN lv_hour < 12 THEN \`day\` ELSE \`night\` )` |
| `SWITCH` | Result from one discriminator value (like `CASE`) | `SWITCH #( lv_op WHEN '+' THEN ... ELSE ... )` |
| `REDUCE` | Fold rows/iterations into one result | `REDUCE i( INIT lv_sum = 0 FOR ls_row IN lt_it NEXT lv_sum += ls_row-col2 )` |
| `FILTER` | Subset of a table by key + `WHERE` | `FILTER #( lt_it USING KEY sk WHERE a < 3 )` |
| `LET ... IN` | Local helper variable inside an expression | `VALUE #( LET lv_mark = '!' IN ( \|a{ lv_mark }\| ) )` |
| `FOR` | Iterate inside `VALUE` / `NEW` / `REDUCE` | `VALUE #( FOR ls_row IN lt_it ( col1 = ls_row-col1 ) )` |

Full variant catalog (every addition of every operator): [references/operator-catalog.md](references/operator-catalog.md).

## VALUE {#value}

Constructs a result *based on a data type* — structures, internal tables, and type-specific initial values for any non-generic type. Elementary and reference types cannot be given a concrete value with `VALUE` (use `CONV`); an empty `VALUE` produces their initial value.

```abap
"Structure (# when type derivable, else name the type)
ls_struc = VALUE #( a = 1 b = 'aaa' ).
DATA(ls_struc2) = VALUE struc_type( a = 4 b = 'ddd' ).

"Internal table — extra parentheses per line
lt_itab = VALUE #( ( a = 5 b = 'eee' )
                ( a = 6 b = 'fff' ) ).
DATA(lt_itab3) = VALUE string_table( ( `Hello` ) ( `world` ) ).

"Type-specific initial value (any type)
ls_struc = VALUE #( ).
DATA(lv_int) = VALUE i( ).
```

**`BASE`** — keep existing content instead of initializing the target:
```abap
ls_struc = VALUE #( BASE ls_struc b = 'bbb' ).            "a kept, only b changed
lt_itab  = VALUE #( BASE lt_itab ( a = 3 b = 'ccc' ) ).   "lines appended
```

**`LINES OF`** — include lines of another table (supports `FROM ... TO`, `STEP`, `USING KEY`):
```abap
lt_itab = VALUE #( ( LINES OF lt_itab5 )
                ( LINES OF lt_itab6 FROM 2 TO 4 ) ).
```

**Deep/nested** values are built in place:
```abap
ls_nested_struc = VALUE #( a = 1 struct = VALUE #( b = 1 c = 'aaa' ) ).
```

**Table expressions as arguments** — avoid `CX_SY_ITAB_LINE_NOT_FOUND` with `OPTIONAL` / `DEFAULT`:
```abap
DATA(ls_optional) = VALUE #( lt_it[ 1 ] OPTIONAL ).
DATA(ls_default)  = VALUE #( lt_it[ 1 ] DEFAULT VALUE #( a = 1 b = 'abc' ) ).
```

Range tables and short forms (a value before the inner parentheses applies to following lines until overridden) — see the catalog. Inline `VALUE` also avoids helper variables in `MODIFY`/`INSERT`/`DELETE TABLE` and ABAP SQL host expressions.

## CORRESPONDING {#corresponding}

Constructs a structure or internal table, assigning components **by identical name** or by an explicit **mapping**. Unlike `MOVE-CORRESPONDING`, without `BASE` the target is **initialized first** — non-matching components become initial.

```abap
ls_s2 = CORRESPONDING #( ls_s1 ).                          "identical names; rest initialized
ls_s2 = CORRESPONDING #( BASE ( ls_s2 ) ls_s1 ).              "keep existing (parens around BASE!)
ls_s2 = CORRESPONDING #( ls_s1 MAPPING d = c ).            "map target d from source c
ls_s2 = CORRESPONDING #( ls_s1 EXCEPT b ).                 "leave b initial
ls_s2 = CORRESPONDING #( ls_s1 MAPPING d = c EXCEPT b ).   "combine
ls_s2 = CORRESPONDING #( ls_s1 MAPPING d = c EXCEPT * ).   "only mapped comps; rest initial
```

**Internal tables** work the same; `DISCARDING DUPLICATES` prevents `ITAB_DUPLICATE_KEY` when the target has a unique key:
```abap
lt_it2 = CORRESPONDING #( lt_it1 DISCARDING DUPLICATES ).
```

**`MAPPING ... DEFAULT`** assigns a fallback expression (evaluated before the `CORRESPONDING`). With a source component before `DEFAULT`, the source value is used only when it is **not initial**:
```abap
ls_struc2 = CORRESPONDING #( ls_struc1 MAPPING id2 = id1
                                         b = DEFAULT `ha` && `llo`
                                         d = DEFAULT VALUE #( lt_itab1[ 1 ]-d DEFAULT `hi` ) ).
ls_struc2 = CORRESPONDING #( ls_struc1 MAPPING b = b DEFAULT `hallo` ).  "source b if filled
```

**Lookup table** (`FROM tab USING [KEY k] a = b`) joins `itab` with a lookup table; unmatched lines keep their original values; search components are not reassigned unless overridden by `MAPPING`:
```abap
lt_it1 = CORRESPONDING #( lt_it1 FROM lt_lookup_tab USING character = character ).
lt_it4 = CORRESPONDING #( lt_it4 FROM lt_lookup_table USING KEY sk c = a d = b
                       MAPPING a = a b = b c = c d = d f = g ).
```

`DEEP` / `[DEEP] APPENDING` handle nested tabular components — see the catalog.

## NEW {#new}

Creates **anonymous data objects** or **class instances**, returning a reference. Replaces `CREATE DATA` / `CREATE OBJECT` (which remain required only in dynamic programming).

```abap
"Anonymous data objects
lr_dref1 = NEW #( ).                "initial value
lr_dref1 = NEW #( 123 ).            "single value
DATA(lr_dref3) = NEW i( 456 ).
DATA(lr_dref4) = NEW zdemo_abap_carr( carrid = 'XY' carrname = 'XY Airlines' ).
DATA(lr_dref6) = NEW string_table( VALUE #( ( `a` ) ( `b` ) ) ).

"Instances
lo_oref1 = NEW #( ).                          "type derivable
DATA(lo_oref3) = NEW zcl_demo_abap_objects( ).
DATA(lo_oref5) = NEW cl_b( 123 ).             "single ctor param, name optional
```

Follow with `->` for chained attribute access or method calls — no extra variable:
```abap
DATA(lv_str2) = NEW zcl_demo_abap_objects( )->another_string.
NEW zcl_demo_abap_objects( )->hallo_instance_method( ).
```

`NEW` also supports `FOR` and `STEP` when building anonymous tables. See [abap-oo-patterns](../abap-oo-patterns/SKILL.md) for instantiation design.

## REF {#ref}

Creates a **data reference variable** pointing to a data object. Replaces `GET REFERENCE` (do not use that anymore). Useful to pass references as actual parameters without a helper.

```abap
lr_dref_a = REF #( lv_num ).
DATA(lr_dref_c) = REF abap_bool( 'X' ).              "explicit static type
DATA(lr_dref_d) = REF #( lt_int_tab[ 2 ] ).             "table expression
DATA(lr_dref_e) = REF #( lt_int_tab[ 6 ] OPTIONAL ).    "initial ref if not found
DATA(lr_dref_f) = REF #( lt_int_tab[ 7 ] DEFAULT NEW #( 123 ) ).
DATA(lo_oref_b) = REF #( lo_oref_a ).                   "object reference
```

## CAST {#cast}

Performs **upcasts and downcasts**, returning a reference of the given static type. Replaces `?=` and enables method chaining.

```abap
lo_ref_gen = CAST #( lo_ref_i ).        "upcast (CAST optional here)
lo_ref_i   = CAST #( lo_ref_gen ).      "downcast — checked at runtime, must be explicit

"Dereference / component access on the result
DATA(lv_str)  = CAST string( lo_ref_gen )->*.
DATA(lv_comp) = CAST zdemo_abap_carr( lo_ref_gen )->carrid.

"RTTS without helper variables
DATA(lt_components) = CAST cl_abap_structdescr(
    cl_abap_typedescr=>describe_by_data( ls_st ) )->components.
```

More up/downcast examples in [abap-oo-patterns](../abap-oo-patterns/SKILL.md) and the dynamic programming skill.

## CONV {#conv}

Forces a **conversion** between types per the conversion rules, and is the way to construct elementary data objects with a value (which `VALUE` cannot do).

```abap
DATA(lv_conv_res) = CONV decfloat34( 1 / 5 ).   "0.2 (without CONV: 1/5 = 0, type i)
DATA(lv_rate)     = CONV decfloat34( '0.4' ).
DATA(lt_conv_itab) = CONV inttab_type( lt_itab ).  "to a different table type/key
```
Do not write redundant conversions: `DATA(lv_greeting) = \`hallo\`.` already types `lv_greeting` as `string`; `CONV string( \`hallo\` )` only adds a warning.

## EXACT {#exact}

Enforces a **lossless** assignment or calculation; raises a catchable exception if data would be lost or precision rounded. See also [abap-clean-style](../abap-clean-style/SKILL.md).

```abap
DATA(lv_as1) = EXACT clen3( abap_true ).
TRY.
    DATA(lv_as4) = EXACT clen3( 'abcd' ).        "too long
  CATCH cx_sy_conversion_data_loss.
ENDTRY.

DATA(lv_calc1) = EXACT packednum( 1 / 4 ).       "ok
TRY.
    DATA(lv_calc3) = EXACT packednum( 1 / 3 ).   "needs rounding
  CATCH cx_sy_conversion_rounding.
ENDTRY.
```

## COND {#cond}

Produces a result from one or more **logical expressions** (`WHEN ... THEN ...`), with an optional `ELSE` (otherwise initial value). Can raise via `THROW` / `THROW SHORTDUMP`.

```abap
DATA(lv_day_or_night) = COND #( WHEN cl_abap_context_info=>get_system_time( ) BETWEEN '050000' AND '220000'
                             THEN `day`
                             ELSE `night` ).

"LET shared across all WHEN branches
DATA(lv_time_of_day) = COND #( LET lv_time = cl_abap_context_info=>get_system_time( ) IN
                            WHEN lv_time BETWEEN '050001' AND '120000' THEN |Good morning ...|
                            ELSE |Good night ...| ).

"THROW raises like RAISE EXCEPTION TYPE
DATA(lv_div) = COND decfloat34( WHEN lv_num1 <> 0 AND lv_num2 <> 0 THEN lv_num1 / lv_num2
                             ELSE THROW cx_sy_zerodivide( ) ).
```
All `THEN` operands must be convertible to the result type. `THROW` examples: see the Exceptions cheat sheet.

## SWITCH {#switch}

Like `COND`, but tests a **single value** (in the style of `CASE`). Also supports `THROW`.

```abap
DATA(lv_calc_result) = SWITCH #( lv_operator
                              WHEN '+' THEN |{ lv_num1 + lv_num2 STYLE = SIMPLE }|
                              WHEN '-' THEN |{ lv_num1 - lv_num2 STYLE = SIMPLE }|
                              WHEN '*' THEN |{ lv_num1 * lv_num2 STYLE = SIMPLE }|
                              WHEN '/' THEN |{ CONV decfloat34( lv_num1 / lv_num2 ) STYLE = SIMPLE }|
                              ELSE `Wrong operator.` ).
```

## REDUCE {#reduce}

Folds one or more `FOR` iterations into a single result. `FOR` is **mandatory**. Structure: optional `LET`, then `INIT` (result variable + initial value), `FOR`, `NEXT` (assignment applied each iteration).

```abap
"Sum a column -> 6
DATA(lv_sum_val) = REDUCE i( INIT lv_len = 0
                          FOR <fs_line> IN lt_itab
                          NEXT lv_len = lv_len + <fs_line>-col2 ).

"Longest string -> ccc
DATA(lv_long_str) = REDUCE s-col1( INIT lv_str = VALUE #( )
                                FOR <fs_line> IN lt_itab
                                NEXT lv_str = COND #( WHEN strlen( <fs_line>-col1 ) > strlen( lv_str )
                                                   THEN <fs_line>-col1 ELSE lv_str ) ).

"Build a table (VALUE BASE appends each pass)
DATA(lt_itstr) = REDUCE string_table( INIT lt_strtab = VALUE string_table( )
                                   FOR ls_wa IN lt_itab
                                   NEXT lt_strtab = VALUE #( BASE lt_strtab
                                     ( |lv_sum is { ls_wa-col2 + ls_wa-col3 }| ) ) ).

"Conditional iteration: 1..10 -> 55
DATA(lv_reduce_until) = REDUCE i( INIT lv_sum = 0
                              FOR lv_int = 1 UNTIL lv_int > 10
                              NEXT lv_sum += lv_int ).
```
`INIT` may declare several variables; only the first determines the result (others are usable after `NEXT`). `WHERE ( ... )` is allowed on table iterations.

## FILTER {#filter}

Constructs a subset of an internal table by key. The source table needs a **sorted key** or **hash key** (primary or secondary). Conditions combine with `AND` only (no `OR`/`NOT`). `EXCEPT` inverts the `WHERE` condition.

```abap
DATA(lt_f1) = FILTER #( lt_fi_tab1 WHERE a >= 4 ).                          "primary key, implicit
DATA(lt_f2) = FILTER #( lt_fi_tab1 USING KEY primary_key WHERE a >= 4 ).    "explicit primary
DATA(lt_f3) = FILTER #( lt_fi_tab2 USING KEY sec_key WHERE a < 3 ).         "secondary key
DATA(lt_f4) = FILTER #( lt_fi_tab3 WHERE a = 3 ).                           "hash key: only =
DATA(lt_f5) = FILTER #( lt_fi_tab4 USING KEY sec_hash_key WHERE a = 3 AND b = 'ccc' ).
DATA(lt_f6) = FILTER #( lt_fi_tab1 EXCEPT WHERE a >= 4 ).                   "inverse
```

**Filter table** (`IN filter_tab`): keep source lines for which at least one filter line matches the `WHERE` comparison. `USING KEY` can target the source or the filter table depending on placement; `EXCEPT` inverts.
```abap
DATA(lt_f11) = FILTER #( lt_fi_tab1 IN lt_filter_tab1 WHERE a = table_line ).
DATA(lt_f13) = FILTER #( lt_fi_tab2 IN lt_filter_tab2 USING KEY line WHERE a = table_line ).
```
Hash keys allow `=` only; sorted keys allow the full comparison set, and single-value filtering also allows `IS [NOT] INITIAL`.

## LET expressions {#let}

`LET var = expr ... IN` defines one or more local helper variables (or field symbols) **scoped entirely to the expression**. The right-hand side is typed by inference, as in an inline declaration. Use it when a computed value is needed more than once, to avoid recomputation and noise.

```abap
DATA(lt_strtab) = VALUE string_table( LET lv_mark = '!' IN
                                   ( |abc{ lv_mark }| )
                                   ( |def{ lv_mark }| ) ).

DATA(ls_new_struc) = NEW st_type( LET lv_num = 2 lv_ch = 'AP' IN
                               comp1 = 'AB' && lv_ch comp2 = 2 * lv_num comp3 = 3 * lv_num ).
```
A `LET` field symbol needs a **writable** right-hand side (e.g. a table expression `it[ sy-index ]` or `NEW ...->attr`). `LET` placed after `FOR` is re-evaluated every iteration.

## FOR iteration {#for}

`FOR` drives iterations inside `VALUE`, `NEW`, and `REDUCE`. Two flavors: **table iterations** (`FOR wa IN itab`, semantics of `LOOP AT`) and **conditional iterations** (`FOR index = ... UNTIL/WHILE`, semantics of `DO`/`WHILE`). The iteration variable is visible only inside the `FOR`. Iterations cannot be debugged.

```abap
"Table iteration
DATA(lt_it1) = VALUE itab_type( FOR ls_wa IN lt_itab ( col1 = ls_wa-col1 && 'z'
                                              col2 = ls_wa-col2 + 1 ) ).

"INDEX INTO (stores sy-tabix, implicitly type i) + LET re-evaluated each pass
DATA(lt_it2) = VALUE itab_type( FOR <fs_line> IN lt_itab INDEX INTO lv_idx
                             LET lv_idxplus1 = lv_idx + 1 IN
                             ( col1 = <fs_line>-col1 col2 = lv_idx col3 = lv_idxplus1 ) ).

"WHERE (in parentheses), FROM/TO, STEP, USING KEY
DATA(lt_it8)  = VALUE itab_type( FOR ls_wa IN lt_itab WHERE ( col2 < 3 ) ( col1 = ls_wa-col1 ) ).
DATA(lt_it9)  = VALUE itab_type( FOR ls_wa IN lt_itab FROM 2 TO 3 ( col1 = ls_wa-col1 ) ).
DATA(lt_it10) = VALUE itab_type( FOR ls_wa IN lt_itab STEP -1 ( col1 = ls_wa-col1 ) ).
DATA(lt_it11) = VALUE itab_type( FOR ls_wa IN lt_itab USING KEY primary_key ( col1 = ls_wa-col1 ) ).

"Nested / multiple FOR = nested loops
DATA(lt_it7) = VALUE string_table( FOR ls_wa1 IN lt_itab
                                FOR ls_wa2 IN lt_inttab
                                ( |{ ls_wa1-col1 } / { ls_wa2 }| ) ).

"Conditional: THEN optional for numeric/d/t (implicit +1), required otherwise
DATA(lt_it12) = VALUE itab_type( FOR lv_index = 1 WHILE lv_index < 4 ( col1 = lv_index ) ).
DATA(lt_it14) = VALUE itab_type( FOR lv_index = 1 THEN lv_index + 2 WHILE lv_index < 8 ( col1 = lv_index ) ).
DATA(lt_it15) = VALUE itab_type( FOR lv_str = `x` THEN lv_str && lv_str WHILE strlen( lv_str ) < 5 ( col1 = lv_str ) ).
DATA(lt_it16) = VALUE itab_type( FOR lv_offset = 10 UNTIL lv_offset > 12 ( col1 = lv_offset ) ).
```
`STEP` controls step size and direction (`STEP 2` every second, `STEP -1` reverse). `CORRESPONDING #( wa )` inside `FOR` handles non-identical line types.

**Grouping** with `FOR GROUPS ... GROUP BY` (equivalent to `LOOP AT ... GROUP BY`); see [abap-internal-tables](../abap-internal-tables/SKILL.md):
```abap
DATA(lt_val_1) = VALUE string_table( FOR GROUPS lv_gr OF ls_wa IN lt_itab4grp
                                     GROUP BY ls_wa-col1 ASCENDING
                                     WITHOUT MEMBERS
                                     ( |{ lv_gr }| ) ).
```
The group key may be a structured key with `GROUP SIZE` / `GROUP INDEX`; `FOR ... IN GROUP gr` iterates members.

## Common Mistakes

| Mistake | Why it hurts | Fix |
|---|---|---|
| Expecting `CORRESPONDING #( s )` to keep old values | Target is initialized first | Add `BASE ( s )` to retain content |
| `CORRESPONDING #( BASE s ... )` without parentheses | Syntax error | `CORRESPONDING #( BASE ( s ) ... )` — parens are mandatory here |
| `VALUE elem_type( '0.4' )` for an elementary value | `VALUE` only makes initial elementary values | Use `CONV elem_type( '0.4' )` |
| `CONV string( \`hallo\` )` on a literal | Redundant; raises a warning | Assign directly: `DATA(lv_greeting) = \`hallo\`.` |
| Table expression `it[ n ]` in `VALUE`/`REF` without guard | `CX_SY_ITAB_LINE_NOT_FOUND` | Add `OPTIONAL` or `DEFAULT ...` |
| `FILTER #( lt_it WHERE ... )` on a standard table with no sorted/hash key | No key to access by | Define a sorted/secondary/hash key, then `USING KEY` |
| `OR` / `NOT` in a `FILTER` `WHERE` | Not allowed | Combine with `AND`, or use `EXCEPT` to invert |
| `FOR lv_str = \`x\` WHILE ...` without `THEN` | `THEN` required for non-numeric iteration variables | Add `THEN <next-value>` |
| Using a `FOR`/`REDUCE` helper variable outside the expression | Scoped to the expression only | Declare a real variable, or restructure |
| Reaching for a constructor expression as a showpiece | Dense expressions hurt readability and cannot be debugged | Prefer the clearer of expression vs `LOOP`/`IF`/`CASE` |
| Mismatched types when reusing a `FOR` helper name | Reuse needs identical type | Use a fresh name or matching type |

## References

- **Source cheat sheet:** [SAP-samples/abap-cheat-sheets — 05_Constructor_Expressions](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/05_Constructor_Expressions.md) — ground truth for every snippet here.
- **ABAP Keyword Documentation — Constructor expressions:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abenconstructor_expression_glosry.htm
- Local: [references/operator-catalog.md](references/operator-catalog.md) — exhaustive additions per operator for lookup.
- Cross-links: [abap-internal-tables](../abap-internal-tables/SKILL.md) (building/grouping tables), [abap-data-objects](../abap-data-objects/SKILL.md) (typing), [abap-clean-style](../abap-clean-style/SKILL.md) (when constructor expressions earn their place), [abap-oo-patterns](../abap-oo-patterns/SKILL.md) (`NEW`/`CAST` in OO).
