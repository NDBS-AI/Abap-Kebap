# Constructor Operator Catalog — Variant Reference

Exhaustive lookup of the additions of every constructor operator, with syntax copied verbatim from SAP's official cheat sheet ([05_Constructor_Expressions.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/05_Constructor_Expressions.md)). For the curated "when to use which" guidance, see [../SKILL.md](../SKILL.md). For the authoritative grammar, see the [ABAP Keyword Documentation — Constructor expressions](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abenconstructor_expression_glosry.htm).

General form: `<operator> <type>|#( <parameters> )`. `#` stands for the operand type when derivable from the operand position (or, for some operators, from the arguments).

---

## VALUE

Constructs structures, internal tables, and type-specific initial values for any non-generic type. Elementary and reference types cannot be given a *concrete* value (only an empty `VALUE` for their initial value).

| Variant / addition | Syntax | Notes |
|---|---|---|
| Initial value | `VALUE #( )` / `VALUE i( )` / `VALUE xstring( )` | Type-specific initial value; works for any non-generic type. |
| Structure, inferred type | `ls_struc = VALUE #( a = 1 b = 'aaa' ).` | Named component arguments. |
| Structure, explicit type | `DATA(ls_struc) = VALUE struc_type( a = 4 b = 'ddd' ).` | Needed when type not derivable from context. |
| Partial structure | `ls_struc = VALUE #( a = 2 ).` | Unspecified components stay initial. |
| Internal table | `VALUE #( ( a = 5 b = 'eee' ) ( a = 6 b = 'fff' ) )` | Inner parentheses = one line. |
| Elementary-line table | `VALUE string_table( ( \`Hello\` ) ( \`world\` ) )` | No component names. |
| Initial first line | `VALUE #( ( ) ( a = 1 b = 'aaa' ) )` | `( )` adds an all-initial line. |
| `BASE` | `VALUE #( BASE ls_struc b = 'bbb' )` / `VALUE #( BASE lt_itab ( ... ) )` | Keep existing content; no parentheses around `BASE` (unlike `CORRESPONDING`). |
| `LINES OF` | `VALUE #( ( LINES OF lt_itab5 ) )` | Include all lines of another table. |
| `LINES OF ... FROM ... TO` | `( LINES OF lt_itab6 FROM 2 TO 4 )` | Line range by index. |
| `LINES OF ... STEP` | `( LINES OF lt_itab5 STEP 2 )` | Every n-th line. |
| `LINES OF ... USING KEY` | `( LINES OF lt_itab6 USING KEY primary_key )` | Specify the table key for access. |
| Deep / nested | `VALUE #( a = 1 struct = VALUE #( b = 1 c = 'aaa' ) )` | Nested `VALUE` per level. |
| Deep table | `VALUE deep_itab_type( ( ls_nested_struc ) ( a = 3 struct = VALUE #( ... ) ) )` | Add existing structures or build in place. |
| Short form (sticky component) | `VALUE tabtype( b = 'aaa' ( a = 1 c = \`xxx\` ) ( a = 2 c = \`yyy\` ) b = 'bbb' c = \`zzz\` ( a = 3 ) )` | A value set outside inner parentheses applies to all following lines until overridden. |
| Range table short form | `VALUE #( sign = 'I' option = 'BT' ( low = 1 high = 3 ) ( low = 6 high = 8 ) option = 'GE' ( low = 18 ) )` | Build `RANGE OF` tables concisely. |
| Table expression `OPTIONAL` | `VALUE #( lt_it[ 1 ] OPTIONAL )` | Initial value if line not found (no exception). |
| Table expression `DEFAULT` | `VALUE #( lt_it[ 1 ] DEFAULT VALUE #( a = 1 b = 'abc' ) )` | Default value if line not found. |
| Table iteration `FOR` | `VALUE itab_type( FOR ls_wa IN lt_itab ( col1 = ls_wa-col1 ) )` | See FOR section. |
| `FOR GROUPS ... GROUP BY` | `VALUE string_table( FOR GROUPS lv_gr OF ls_wa IN lt_itab GROUP BY ls_wa-col1 ASCENDING WITHOUT MEMBERS ( |{ lv_gr }| ) )` | Grouping; see FOR section. |
| `LET ... IN` | `VALUE string_table( LET lv_mark = '!' IN ( |abc{ lv_mark }| ) )` | Local helpers; see LET section. |

Inline `VALUE` also feeds ABAP statements directly: `MODIFY TABLE lt_itab FROM VALUE #( ... ).`, `INSERT VALUE #( ... ) INTO TABLE lt_itab.`, `DELETE TABLE lt_itab FROM VALUE #( ... ).`, and ABAP SQL host expressions `... FROM TABLE @( VALUE #( ( ... ) ) )`.

---

## CORRESPONDING

Copies a structure or internal table by identical names or mapping. Without `BASE`, the target is initialized first.

| Addition | Syntax | Notes |
|---|---|---|
| Plain | `CORRESPONDING #( ls_s1 )` | Identical names; non-matching target components initialized. |
| `BASE` | `CORRESPONDING #( BASE ( ls_s2 ) ls_s1 )` | Keep original target content. **Parentheses around `BASE` are mandatory.** |
| `MAPPING` | `CORRESPONDING #( ls_s1 MAPPING d = c )` | Map target component from a differently named source component. Do not use `-` for nested components in mappings. |
| `MAPPING ... DEFAULT expr` | `CORRESPONDING #( ls_s1 MAPPING b = DEFAULT \`hallo\` )` | Assign an expression (evaluated before `CORRESPONDING`) as the value. |
| `MAPPING src DEFAULT expr` | `CORRESPONDING #( ls_s1 MAPPING b = b DEFAULT \`hallo\` )` | Use source value if not initial, else the `DEFAULT` expression. |
| `EXCEPT` | `CORRESPONDING #( ls_s1 EXCEPT b )` | Listed components stay initial (excludes incompatible identically named components from assignment). |
| `EXCEPT *` | `CORRESPONDING #( ls_s1 MAPPING d = c EXCEPT * )` | With `MAPPING`: all non-specified components stay initial. |
| `MAPPING ... EXCEPT ...` | `CORRESPONDING #( ls_s1 MAPPING d = c EXCEPT b )` | Combine mapping and exclusion. |
| `DISCARDING DUPLICATES` | `CORRESPONDING #( lt_it1 DISCARDING DUPLICATES )` | Tabular/target unique key: drop duplicates instead of `ITAB_DUPLICATE_KEY`. |
| `DEEP` | `CORRESPONDING #( ... DEEP ... )` | Resolve deep tabular components at every level; identical names assigned line by line. |
| `APPENDING` / `DEEP APPENDING` | `CORRESPONDING #( ... [DEEP] APPENDING ... )` | Do not delete nested target tables; append source lines (with/without `DEEP` semantics). |
| Lookup table `FROM ... USING` | `CORRESPONDING #( lt_it1 FROM lt_lookup_tab USING character = character )` | Join `lt_itab` with a lookup table; unmatched lines keep original values; search components not reassigned by default. |
| Lookup `USING KEY` | `CORRESPONDING #( lt_it3 FROM lt_lookup_table USING KEY sk c = a d = b )` | Specify a sorted/hash secondary key (all key components required). |
| Lookup `... MAPPING` | `CORRESPONDING #( lt_it4 FROM lt_lookup_table USING KEY sk c = a d = b MAPPING a = a b = b c = c d = d f = g )` | Override default identical-name mapping. |
| Lookup, different target type | `CORRESPONDING it_type( lt_it5 FROM lt_lookup_table USING KEY sk c = a d = b ) ##operator` | Pragma `##operator` suppresses the temporary-copy warning when source ≠ target. |

Lookup-table rules: source/filter line types need not be identical; target type must be a table type with structured line type; search needs a sorted/hash key; omit `KEY` only if the lookup table itself is sorted/hashed.

> `CORRESPONDING #( s )` initializes non-matching components; `MOVE-CORRESPONDING s TO t` does not. They are not equivalent.

---

## NEW

Creates anonymous data objects or class instances; returns a reference. Replaces `CREATE DATA` / `CREATE OBJECT` (still required only in dynamic programming).

| Variant | Syntax | Notes |
|---|---|---|
| Anonymous, initial | `NEW #( )` / `NEW string( )` | Retains initial value. |
| Anonymous, single value | `NEW #( 123 )` / `NEW string( \`hallo\` )` | Unnamed argument. |
| Anonymous, inline | `DATA(lr_dref3) = NEW i( 456 ).` | Type `REF TO i`. |
| Anonymous structure | `NEW zdemo_abap_carr( carrid = 'XY' carrname = 'XY Airlines' )` | Named component arguments. |
| Anonymous table | `NEW string_table( ( \`c\` ) ( \`d\` ) )` / `NEW string_table( VALUE #( ( \`a\` ) ) )` | Build with lines or a nested `VALUE`. |
| Instance, inferred | `lo_oref1 = NEW #( ).` | Type from declared reference. |
| Instance, explicit | `NEW zcl_demo_abap_objects( )` | |
| Instance, named ctor params | `NEW cl_a( p1 = ... p2 = ... )` | List instance-constructor parameters. |
| Instance, single ctor param | `NEW cl_b( 123 )` | Name optional when only one parameter. |
| Chained attribute | `NEW zcl_demo_abap_objects( )->another_string` | Access attribute via `->`. |
| Chained / standalone method | `NEW zcl_demo_abap_objects( )->hallo_instance_method( )` | Method call via `->`, chainable. |
| `FOR` / `STEP` | `NEW <tabtype>( FOR ... STEP ... ( ... ) )` | `FOR` and `STEP` supported for anonymous tables. |

---

## REF

Creates a data reference variable to a data object. Replaces `GET REFERENCE` (deprecated). After `REF` you may write a non-generic type satisfying upcast rules, generic `data`, or `#`.

| Variant | Syntax | Notes |
|---|---|---|
| Inferred type | `REF #( lv_num )` | Static type from context. |
| Explicit type | `REF abap_bool( 'X' )` | Names the static type. |
| Generic | `REF data( ... )` | Generic data reference. |
| Table expression | `REF #( lt_int_tab[ 2 ] )` | Reference to a line. |
| `OPTIONAL` | `REF #( lt_int_tab[ 6 ] OPTIONAL )` | Initial reference if line not found. |
| `DEFAULT` | `REF #( lt_int_tab[ 7 ] DEFAULT NEW #( 123 ) )` | Provide a default if line not found. |
| Object reference | `REF #( lo_oref_a )` | Reference to an object reference. |

---

## CAST

Up/downcast returning a reference of the given static type. Replaces `?=`; enables chaining.

| Variant | Syntax | Notes |
|---|---|---|
| Upcast | `lo_ref_gen = CAST #( lo_ref_i ).` | `CAST` optional for upcasts (`lo_ref_gen = lo_ref_i.` also works). |
| Downcast | `lo_ref_i = CAST #( lo_ref_gen ).` | Required and checked at runtime. |
| Dereference result | `CAST string( lo_ref_gen )->* = \`abap\`.` / `DATA(lv_str) = CAST string( lo_ref_gen )->*.` | `->*` dereferences. |
| Component access | `CAST zdemo_abap_carr( lo_ref_gen )->carrid = 'XY'.` | `->comp` on a structured static type. |
| Dynamic component | `CAST zdemo_abap_carr( lo_ref_gen )->('CARRID') = 'ZZ'.` | Dynamic name in parentheses. |
| RTTS chaining | `CAST cl_abap_structdescr( cl_abap_typedescr=>describe_by_data( ls_st ) )->components` | Replaces helper-variable + `?=`. |
| Nested RTTS | `CAST cl_abap_structdescr( CAST cl_abap_tabledescr( cl_abap_typedescr=>describe_by_data( lt_it ) )->get_table_line_type( ) )->components` | Multi-level casts inline. |

---

## CONV

Forces a conversion per the conversion rules; the way to construct elementary values (which `VALUE` cannot).

| Variant | Syntax | Notes |
|---|---|---|
| Elementary | `CONV decfloat34( 1 / 5 )` → `0.2` | Without `CONV`, `1 / 5` is `0` (type `i`). |
| From literal | `CONV decfloat34( '0.4' )` | |
| Table type | `CONV inttab_type( lt_itab )` | Convert to a different table type/key. |
| Generic formal params | `CONV #( ... )` passed to generic parameter | Special inference rules apply. |

Avoid redundant conversions: `CONV string( \`hallo\` )` only adds a warning — `DATA(lv_greeting) = \`hallo\`.` already types `lv_greeting`.

---

## EXACT

Lossless assignment or calculation; raises a catchable exception on loss.

| Variant | Syntax | Exception |
|---|---|---|
| Lossless assignment | `EXACT clen3( 'XY' )` (ok), `EXACT clen3( 'abcd' )` (fails) | `CX_SY_CONVERSION_DATA_LOSS` |
| Lossless calculation | `EXACT packednum( 1 / 4 )` (ok), `EXACT packednum( 1 / 3 )` (fails) | `CX_SY_CONVERSION_ROUNDING` |

---

## COND

Result from logical expressions.

| Addition | Syntax | Notes |
|---|---|---|
| `WHEN ... THEN ... ELSE` | `COND #( WHEN t BETWEEN '050000' AND '220000' THEN \`day\` ELSE \`night\` )` | Multiple `WHEN`; without `ELSE`, result is initial value. |
| `LET ... IN` | `COND #( LET lv_time = ... IN WHEN lv_time ... THEN ... )` | Helper shared across branches. |
| `THROW` | `COND decfloat34( WHEN ... THEN ... ELSE THROW cx_sy_zerodivide( ) )` | Raises like `RAISE EXCEPTION TYPE`; usable after `THEN` too; `RESUMABLE` for resumable. |
| `THROW SHORTDUMP` | `COND decfloat34( WHEN ... ELSE THROW SHORTDUMP cx_sy_zerodivide( ) )` | Raises a runtime error; message/params can be passed. |

All `THEN` operands must be convertible to the result type.

---

## SWITCH

Result from a single discriminator value (like `CASE`).

| Addition | Syntax | Notes |
|---|---|---|
| `WHEN ... THEN ... ELSE` | `SWITCH #( lv_operator WHEN '+' THEN ... WHEN '-' THEN ... ELSE \`Wrong operator.\` )` | Tests one value. |
| `THROW` / `THROW SHORTDUMP` | `SWITCH #( ... ELSE THROW ... )` | As for `COND`. |

---

## REDUCE

Folds `FOR` iterations into one result. `FOR` is mandatory.

| Component / addition | Syntax | Notes |
|---|---|---|
| `INIT` | `REDUCE i( INIT lv_len = 0 FOR <fs_line> IN lt_itab NEXT lv_len = lv_len + <fs_line>-col2 )` | Declares result variable(s); first one is the result. |
| Multiple `INIT` vars | `INIT lt_numbers = VALUE #( ) lv_rng = ... lv_number = 0 lv_dist = ...` | Extra vars usable after `NEXT`. |
| `NEXT` | `NEXT lv_max = COND #( WHEN ls_line-col2 > lv_max THEN ls_line-col2 ELSE lv_max )` | Assignment applied each iteration. |
| Build a table | `REDUCE string_table( INIT lt_tab = VALUE #( ) FOR ls_wa IN lt_itab NEXT lt_tab = VALUE #( BASE lt_tab ( ... ) ) )` | `VALUE BASE` appends each pass. |
| `WHERE` | `REDUCE s3_tab_type( INIT lt_tab = VALUE #( ) FOR ls_wa IN lt_itab WHERE ( col2 < 3 ) NEXT lt_tab = ... )` | Condition in parentheses. |
| `FOR ... UNTIL` | `REDUCE i( INIT lv_sum = 0 FOR lv_int = 1 UNTIL lv_int > 10 NEXT lv_sum += lv_int )` | Conditional iteration. |
| `FOR ... WHILE` | `REDUCE i( INIT lv_sum = 0 FOR lv_int = 1 WHILE lv_int <= 10 NEXT lv_sum += lv_int )` | |
| `FOR ... THEN` | `REDUCE string( ... FOR lv_counter = lv_start THEN lv_counter - 1 WHILE lv_counter > 0 NEXT lv_text &&= | { lv_counter }| )` | Custom step; required for non-numeric iteration variables. |
| `LET ... IN` | `REDUCE string( LET lv_start = 10 IN INIT lv_text = ... FOR ... )` | Helper variable. |
| `FOR GROUPS ... GROUP BY` | `REDUCE string_table( INIT lt_li = VALUE #( ) FOR GROUPS lv_group OF ls_grt IN lt_itab GROUP BY ( ... ) ASCENDING ... NEXT lt_li = ... )` | Grouping; see below. |

---

## FILTER

Subset of an internal table by key. Source needs a sorted or hash key (primary or secondary). Conditions combine with `AND` only.

| Variant | Syntax | Notes |
|---|---|---|
| Primary key, implicit | `FILTER #( lt_fi_tab1 WHERE a >= 4 )` | Uses primary table key. |
| Primary key, explicit | `FILTER #( lt_fi_tab1 USING KEY primary_key WHERE a >= 4 )` | Default primary key name. |
| Secondary key | `FILTER #( lt_fi_tab2 USING KEY sec_key WHERE a < 3 )` | Sorted secondary key. |
| Hash key | `FILTER #( lt_fi_tab3 WHERE a = 3 )` | Only `=` allowed with hash keys. |
| Multi-component key | `FILTER #( lt_fi_tab4 USING KEY sec_hash_key WHERE a = 3 AND b = 'ccc' )` | All key components, joined with `AND`. |
| `EXCEPT` | `FILTER #( lt_fi_tab1 EXCEPT WHERE a >= 4 )` | Inverts: keep lines not matching. |
| `EXCEPT USING KEY` | `FILTER #( lt_fi_tab2 EXCEPT USING KEY sec_key WHERE a >= 4 )` | Inverse with explicit key. |
| Filter table `IN` | `FILTER #( lt_fi_tab1 IN lt_filter_tab1 WHERE a = table_line )` | Keep source lines matching ≥1 filter line. |
| Filter table `EXCEPT IN` | `FILTER #( lt_fi_tab1 EXCEPT IN lt_filter_tab1 WHERE a = table_line )` | Inverse. |
| Filter table `USING KEY` (filter) | `FILTER #( lt_fi_tab2 IN lt_filter_tab2 USING KEY line WHERE a = table_line )` | Key for the filter table. |
| Filter table `USING KEY` (source) | `FILTER #( lt_fi_tab2 USING KEY sec_key EXCEPT IN lt_filter_tab2 WHERE a = table_line )` | Key placement before `IN`/`EXCEPT IN` targets the source. |

`WHERE` operators — hash key: `=` only. Sorted key: `=`/`EQ`, `<>`/`NE`, `<`/`LT`, `>`/`GT`, `<=`/`LE`, `>=`/`GE`. Single-value filtering also allows `IS [NOT] INITIAL`. No `OR`/`NOT`. Filter-table line types need not match the source.

---

## LET expressions

Local helper variables (or field symbols), scoped to the expression; right-hand side typed by inference. Allowed inside `VALUE`, `NEW`, `CONV`, `COND`, `SWITCH`, `REDUCE`, and `FOR`.

| Variant | Syntax | Notes |
|---|---|---|
| Single helper | `VALUE string_table( LET lv_mark = '!' IN ( |abc{ lv_mark }| ) )` | |
| Multiple helpers | `NEW st_type( LET lv_num = 2 lv_ch = 'AP' IN comp1 = 'AB' && lv_ch comp2 = 2 * lv_num )` | Several `var = expr` before `IN`. |
| In `CONV` | `CONV string( LET lv_name = ... lv_date = ... IN |Hi { lv_name }. ...| )` | Build elementary values with helpers. |
| Nested `LET` | `CONV string( LET lv_time = ... IN COND string( LET lv_good = \`Good\` IN ... ) )` | Per-expression scoping. |
| Field symbol | `CONV string( LET <fs_li> = lt_it[ sy-index ] lv_comma = \`, \` IN |{ <fs_li>-comp1 }...| )` | RHS must be **writable** (table expression, `NEW ...->attr`, `CAST type( ... )->dobj`). |
| After `FOR` | `VALUE #( FOR ... LET lv_idxplus1 = lv_idx + 1 IN ( ... ) )` | Re-evaluated each iteration. |

Helpers cannot be used outside the expression. They may be reused in subsequent iteration expressions only if name **and type** match.

---

## FOR iteration

Drives iterations inside `VALUE`, `NEW`, `REDUCE`. Two flavors: table iterations (`LOOP AT` semantics) and conditional iterations (`DO`/`WHILE` semantics). Iteration variable visible only inside the `FOR`; iterations cannot be debugged.

### Table iterations (`FOR ls_wa IN lt_itab`)

| Addition | Syntax | Notes |
|---|---|---|
| Basic | `VALUE itab_type( FOR ls_wa IN lt_itab ( col1 = ls_wa-col1 && 'z' ) )` | Work area after `FOR`. |
| Field symbol | `VALUE itab_type( FOR <fs_line> IN lt_itab ( col1 = <fs_line>-col1 ) )` | |
| `INDEX INTO` | `FOR <fs_line> IN lt_itab INDEX INTO lv_idx ( ... col2 = lv_idx )` | Stores `sy-tabix`; variable implicitly type `i`. |
| `WHERE` | `FOR ls_wa IN lt_itab WHERE ( col2 < 3 ) ( ... )` | Condition in parentheses. |
| `FROM ... TO` | `FOR ls_wa IN lt_itab FROM 2 TO 3 ( ... )` | Index range. |
| `STEP` | `FOR ls_wa IN lt_itab STEP -1 ( ... )` | Step size/direction (`STEP 2`, `STEP -1`). |
| `USING KEY` | `FOR ls_wa IN lt_itab USING KEY primary_key ( ... )` | Iteration order by key. |
| Combined STEP+FROM/TO/WHERE | `FOR ls_line IN lt_itab FROM 2 TO 6 STEP 2 ( ls_line )` / `FOR ls_line IN lt_itab STEP -1 WHERE ( table_line CA \`ACXYGZD\` ) ( ls_line )` | Additions combine. |
| `BASE` per line | `FOR ls_wa IN lt_itab ( VALUE #( BASE ls_wa col1 = ls_wa-col1 && 'y' ) )` | Retain non-specified columns. |
| `CORRESPONDING` per line | `FOR ls_wa IN lt_itab ( CORRESPONDING #( ls_wa ) )` | Map non-identical line types. |
| Multiple / nested `FOR` | `FOR ls_wa1 IN lt_itab FOR ls_wa2 IN lt_inttab ( ... )` | Behaves like nested loops. |

### Conditional iterations (`FOR index = ...`)

| Addition | Syntax | Notes |
|---|---|---|
| `WHILE` | `FOR lv_index = 1 WHILE lv_index < 4 ( col1 = lv_index )` | `THEN` optional for numeric/`d`/`t` (implicit +1). |
| `THEN ... WHILE` | `FOR lv_index = 1 THEN lv_index + 2 WHILE lv_index < 8 ( ... )` | Explicit step. |
| Non-numeric, `THEN` required | `FOR lv_str = \`x\` THEN lv_str && lv_str WHILE strlen( lv_str ) < 5 ( ... )` | `THEN` mandatory for non-numeric/`d`/`t`. |
| `UNTIL` | `FOR lv_offset = 10 UNTIL lv_offset > 12 ( col1 = lv_offset )` | |
| `THEN ... UNTIL` | `FOR lv_offset = 31 THEN lv_offset - 10 UNTIL lv_offset < 10 ( ... )` | |

### Grouping (`FOR GROUPS ... GROUP BY`)

Equivalent to `LOOP AT ... GROUP BY`. See [abap-internal-tables](../../abap-internal-tables/SKILL.md).

| Variant | Syntax | Notes |
|---|---|---|
| Group keys only | `VALUE string_table( FOR GROUPS lv_gr OF ls_wa IN lt_itab GROUP BY ls_wa-col1 ASCENDING WITHOUT MEMBERS ( |{ lv_gr }| ) )` | `WITHOUT MEMBERS` when member content is irrelevant. |
| Members via `IN GROUP` | `LET lt_members = VALUE string_table( FOR ls_grpd IN GROUP lv_grp ( |{ ls_grpd-col2 }, { ls_grpd-col3 }| ) ) IN ( ... )` | Iterate group members. |
| Structured group key | `GROUP BY ( grpkey = ls_grt-col1 size = GROUP SIZE index = GROUP INDEX ) ASCENDING` | `GROUP SIZE`, `GROUP INDEX` available in the key. |
| With `REDUCE` | `REDUCE string_table( INIT lt_li = VALUE #( ) FOR GROUPS lv_group OF ls_grt IN lt_itab GROUP BY ( ... ) ASCENDING LET lt_mem = ... IN NEXT lt_li = VALUE #( BASE lt_li ( ... ) ) )` | Reduce over groups. |

### Scope of helper variables

- Iteration/`LET` helpers are usable only inside the iteration expression, its subexpressions, or to build the result.
- They cannot be used outside, and an inline `DATA(name)` outside cannot reuse the name.
- Reuse in a *subsequent* iteration expression is allowed only when name **and type** match; type-incompatible reuse fails.
