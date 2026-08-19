---
name: abap-dynamic-programming
description: Use when writing or reviewing dynamic ABAP — field symbols (FIELD-SYMBOLS, ASSIGN, ASSIGN COMPONENT, UNASSIGN, IS ASSIGNED); data references (TYPE REF TO data, CREATE DATA, GET REFERENCE, ->* dereferencing); RTTI / run-time type identification with cl_abap_typedescr and its subclasses (elemdescr, structdescr, tabledescr, refdescr, classdescr, intfdescr) via describe_by_data / describe_by_name / describe_by_object_ref; RTTC run-time type creation with CREATE DATA ... TYPE HANDLE; dynamic CREATE DATA / CREATE OBJECT; dynamic SQL (dynamic SELECT field list, FROM, WHERE, ORDER BY); dynamic method / function-module calls with PARAMETER-TABLE; generic programming; or deciding whether a dynamic technique is worth its cost.
---

# ABAP Dynamic Programming

## Overview

Dynamic programming lets ABAP determine names, types, and operands at *runtime* instead of compile time. The same `SELECT` can read any table; the same routine can walk any structure; the same call can invoke any method. It is the foundation of generic frameworks, ALV, serialization, RAP generic handlers, and test doubles.

It is also a power tool with a sharp edge: **the compiler cannot check dynamic tokens.** A typo in a dynamic field list is a runtime dump, not a syntax error. Every dynamic technique trades static type safety for flexibility. Use it where the flexibility is genuinely required — and stay static everywhere else.

**Core principle:** prefer static ABAP. Reach for dynamic programming only when the type or name is genuinely unknown until runtime. "Dynamic ABAP does the same as static ABAP, but with dynamic ABAP, errors may not be discovered until runtime."

## When to Use

- Accessing data objects, components, or attributes whose names are known only at runtime (field symbols, dynamic `ASSIGN`).
- Building or reading data objects whose *type* is known only at runtime (data references, `CREATE DATA`, RTTC).
- Inspecting a type at runtime — count components, get key fields, walk a structure generically (RTTI).
- Writing a `SELECT` / `UPDATE` / `MODIFY` against a table chosen at runtime, or with a clause assembled at runtime.
- Calling a method, function module, or BAdI whose name is in a variable (`CALL METHOD (meth)`, `PARAMETER-TABLE`).
- Writing generic utilities (serializers, copiers, comparators, generic ALV feeders).

**When NOT to use:**
- The type *is* known at compile time — write it statically. Generic typing has a real performance and debuggability cost.
- For field-symbol basics as data-object handles → [abap-data-objects](../abap-data-objects/SKILL.md).
- For a dynamic `WHERE` that could just be a static `WHERE` with ranges/`IN` → [abap-sql-performance](../abap-sql-performance/SKILL.md).
- For test-double design (interfaces + injection beat RTTI tricks) → [abap-oo-patterns](../abap-oo-patterns/SKILL.md).

## Field Symbols — symbolic names for memory areas

A field symbol is a placeholder for a data object (or part of one). It reserves no memory; `ASSIGN` binds it to an existing memory area. Names go in angle brackets.

```abap
"Declaration with complete or generic type
FIELD-SYMBOLS <fs_i>    TYPE i.
FIELD-SYMBOLS <fs_data> TYPE data.        "Any data type
FIELD-SYMBOLS <fs_tab>  TYPE ANY TABLE.   "Any internal table

"ASSIGN binds the field symbol to a data object's memory
DATA num TYPE i VALUE 1.
ASSIGN num TO <fs_i>.
<fs_i> = 2.            "num now has value 2 — the field symbol IS the object

"Inline declaration (implicitly typed with generic type data)
LOOP AT itab ASSIGNING FIELD-SYMBOL(<line>).
  <line>-carrid = 'LH'.   "Modifies the table line in place — no copy
ENDLOOP.

READ TABLE itab INDEX 1 ASSIGNING FIELD-SYMBOL(<rt>).
```

**Why field symbols matter for performance:** `LOOP AT itab ASSIGNING <fs>` modifies the line *in place* — no work-area copy. The same applies to `READ TABLE ... ASSIGNING`.

### Checking assignment and unassigning

An unassigned field symbol raises a runtime error if used. Guard with `IS ASSIGNED`; remove the binding with `UNASSIGN`.

```abap
FIELD-SYMBOLS <fs> TYPE string.
DATA(some_string) = `hello`.
ASSIGN some_string TO <fs>.

IF <fs> IS ASSIGNED.
  ...
ENDIF.

UNASSIGN <fs>.
ASSERT <fs> IS NOT ASSIGNED.

"CLEAR only initializes the value; it does NOT remove the assignment
DATA num TYPE i VALUE 1.
FIELD-SYMBOLS <num_fs> TYPE i.
ASSIGN num TO <num_fs>.
CLEAR <num_fs>.                 "<num_fs> still assigned; num is now 0
ASSERT <num_fs> IS ASSIGNED.
```

> **Pitfall — `IS ASSIGNED` after a failed dynamic assignment:** in a *dynamic* `ASSIGN`, a failure sets `sy-subrc = 4` but leaves the field symbol assigned to whatever it pointed to before. `IS ASSIGNED` then returns true even though the new assignment failed. Use `ELSE UNASSIGN` (dynamic only) to force unassignment on failure, and check `sy-subrc`, not `IS ASSIGNED`, to test the *current* statement. See [references/dynamic-tokens.md](references/dynamic-tokens.md).

## Data References — opaque, typed references

A data reference variable holds a reference to a data object. It is "opaque": you must *dereference* it with `->*` to reach the content. Unlike field symbols, data references can be stored in structure components and internal table columns.

```abap
"Reference to an existing object with the REF operator (replaces GET REFERENCE)
DATA num TYPE i VALUE 5.
DATA(ref) = REF #( num ).

"Anonymous data objects — created at runtime, addressed only via the reference
DATA(ref_i)    = NEW i( 1 ).
DATA(ref_carr) = NEW zdemo_abap_carr( carrid = 'LH' carrname = 'Lufthansa' ).

"Dereferencing with ->*
DATA(number) = ref_i->*.       "read
ref_i->* = 10.                 "write

"Structured reference: component selector -> reaches a component directly
DATA(carrid) = ref_carr->carrid.
ref_carr->carrid = 'UA'.
ref_carr->*-carrname = 'United Airlines'.   "longer form also works

"Check before dereferencing
IF ref_carr IS BOUND.
  ...
ENDIF.
```

### CREATE DATA — anonymous data objects

`CREATE DATA` (or the `NEW` operator) creates an anonymous data object. The type can be static or, crucially, **dynamic** — supplied as a name in parentheses or a type description object via `TYPE HANDLE`.

```abap
DATA dref TYPE REF TO data.

"Static type
CREATE DATA dref TYPE p LENGTH 8 DECIMALS 3.
CREATE DATA dref TYPE HASHED TABLE OF zdemo_abap_carr WITH UNIQUE KEY carrid.

"NEW operator (modern; cannot be used for dynamic type names)
DATA(dref_5) = NEW i( 789 ).

"Dynamic type name in parentheses
CREATE DATA dref TYPE ('T_FLI_STRUC').
CREATE DATA dref TYPE TABLE OF ('ZDEMO_ABAP_FLI') WITH EMPTY KEY.
CREATE DATA dref TYPE REF TO ('STRING').

"From a type description object (RTTC) — see below
DATA(tdo) = cl_abap_elemdescr=>get_c( 4 ).
CREATE DATA dref TYPE HANDLE tdo.
```

> In modern ABAP you can use `dref->*` directly in `LOOP`, `READ TABLE`, table expressions, and even `SELECT ... INTO TABLE @dref->*`. In older releases the only way to access an anonymous object was via a field symbol (`ASSIGN dref->* TO <fs>`).

### Field symbol vs data reference

Data reference variables are more powerful (storable in structures/tables, fit the OO world) and are the modern default. Use a field symbol when you want a transparent in-place handle (loop lines, offset/length access). See the SAP guideline *Accessing Data Objects Dynamically*.

## RTTI — Run Time Type Identification

RTTS is a hierarchy of type description classes. RTTI is the *read* half: get a type description object and inspect its attributes/methods.

```
CL_ABAP_TYPEDESCR
  |--CL_ABAP_DATADESCR
  |   |--CL_ABAP_ELEMDESCR
  |   |   |--CL_ABAP_ENUMDESCR
  |   |--CL_ABAP_REFDESCR
  |   |--CL_ABAP_COMPLEXDESCR
  |       |--CL_ABAP_STRUCTDESCR
  |       |--CL_ABAP_TABLEDESCR
  |--CL_ABAP_OBJECTDESCR
     |--CL_ABAP_CLASSDESCR
     |--CL_ABAP_INTFDESCR
```

Three entry methods on `cl_abap_typedescr` return a general `ref to cl_abap_typedescr`; **cast down** to the specific subclass for detailed info.

```abap
"From a data object
DATA(tdo) = cl_abap_typedescr=>describe_by_data( some_dobj ).

"From a type name (relative or absolute)
DATA(tdo2) = cl_abap_typedescr=>describe_by_name( 'ZDEMO_ABAP_CARR' ).

"From an object reference (for classes)
DATA(tdo3) = cl_abap_typedescr=>describe_by_object_ref( oref ).

"General info available without a cast
DATA(kind)          = tdo->kind.            "kind_elem / kind_struct / kind_table / ...
DATA(type_kind)     = tdo->type_kind.
DATA(absolute_name) = tdo->absolute_name.
DATA(relative_name) = tdo->get_relative_name( ).

"Cast down for specifics — e.g. a structure's components
DATA(comps) = CAST cl_abap_structdescr(
  cl_abap_typedescr=>describe_by_data( some_struc ) )->components.

"A table's line type and keys
DATA(tdo_tab)  = CAST cl_abap_tabledescr( cl_abap_typedescr=>describe_by_data( itab ) ).
DATA(line_tdo) = tdo_tab->get_table_line_type( ).
DATA(keys)     = tdo_tab->get_keys( ).
```

Guard downcasts with `IS INSTANCE OF` or `CASE TYPE OF` to avoid `CX_SY_MOVE_CAST_ERROR`:

```abap
CASE TYPE OF some_tdo.
  WHEN TYPE cl_abap_elemdescr.   DATA(elem_descr) = CAST cl_abap_elemdescr( some_tdo ).
  WHEN TYPE cl_abap_structdescr. DATA(struct_descr) = CAST cl_abap_structdescr( some_tdo ).
  WHEN TYPE cl_abap_tabledescr.  DATA(table_descr) = CAST cl_abap_tabledescr( some_tdo ).
  WHEN OTHERS. ...
ENDCASE.
```

Full class/method/attribute catalog: [references/rtti-rttc.md](references/rtti-rttc.md). A worked structure-walk: [examples/rtti-walk.md](examples/rtti-walk.md).

## RTTC — Run Time Type Creation

RTTC is the *create* half: build a brand-new type as a type description object, then materialize a data object with `CREATE DATA ... TYPE HANDLE`.

```abap
DATA dref TYPE REF TO data.

"Elementary — get_* methods (all built-in types are already "created")
DATA(tdo_c5)  = cl_abap_elemdescr=>get_c( 5 ).
DATA(tdo_p)   = cl_abap_elemdescr=>get_p( p_length = 16 p_decimals = 14 ).
CREATE DATA dref TYPE HANDLE tdo_c5.

"Structure — from a component table (type abap_component_tab)
DATA(tdo_struc) = cl_abap_structdescr=>get(
  VALUE #(
    ( name = 'NUM'  type = cl_abap_elemdescr=>get_i( ) )
    ( name = 'TEXT' type = cl_abap_elemdescr=>get_c( 20 ) )
    ( name = 'LAND' type = CAST cl_abap_datadescr(
                              cl_abap_typedescr=>describe_by_name( 'LAND1' ) ) ) ) ).
CREATE DATA dref TYPE HANDLE tdo_struc.

"Table — cl_abap_tabledescr=>get( ) (line type mandatory; rest optional)
DATA(tdo_tab) = cl_abap_tabledescr=>get(
  p_line_type  = CAST cl_abap_structdescr(
                   cl_abap_tabledescr=>describe_by_name( 'ZDEMO_ABAP_FLSCH' ) )
  p_table_kind = cl_abap_tabledescr=>tablekind_sorted
  p_key        = VALUE #( ( name = 'CARRID' ) ( name = 'CONNID' ) )
  p_unique     = cl_abap_typedescr=>true ).
CREATE DATA dref TYPE HANDLE tdo_tab.

"Reference type
DATA(tdo_ref) = cl_abap_refdescr=>get( cl_abap_elemdescr=>get_string( ) ).
CREATE DATA dref TYPE HANDLE tdo_ref.
```

`CREATE DATA ... TYPE (typename)` cannot specify secondary table keys; RTTC with `get_with_keys( )` can. See [references/rtti-rttc.md](references/rtti-rttc.md).

## Dynamic tokens in statements

Many statements accept a character-like operand in parentheses where a name would normally be hard-coded. Full catalog with syntax: [references/dynamic-tokens.md](references/dynamic-tokens.md).

### Dynamic ASSIGN and component access

```abap
ASSIGN ('DOBJ') TO FIELD-SYMBOL(<fs>).        "data object by name
ASSIGN st-('COL1') TO <fs>.                    "component by name
ASSIGN st-(3)      TO <fs>.                     "component by position
ASSIGN dref->('COL1') TO <fs>.                  "reference component
ASSIGN ('NOPE') TO <fs> ELSE UNASSIGN.          "unassign on failure
"Write/read structure components directly
st-('COL1') = 123.
DATA(col2_value) = CONV string( st-('COL2') ).
"Older equivalent (superseded):
ASSIGN COMPONENT 'COL1' OF STRUCTURE st TO <fs>.
```

### Dynamic ABAP SQL

```abap
DATA(select_list) = `CARRID, CONNID, FLDATE`.
DATA(table)       = 'ZDEMO_ABAP_FLI'.
DATA(where)       = VALUE string_table( ( `CARRID = 'LH'` ) ( `OR` ) ( `CARRID = 'AA'` ) ).

SELECT (select_list)
  FROM (table)
  WHERE (where)
  ORDER BY (`FLDATE`)
  INTO TABLE NEW @DATA(result).     "NEW builds a fitting anonymous itab in place
```

`INSERT`, `UPDATE`, `MODIFY`, `DELETE`, `UPDATE ... SET`, `MERGE`, and `WITH` (CTE) all have dynamic forms. Erroneous content raises `CX_SY_DYNAMIC_OSQL_*` — always wrap in `TRY`.

### Dynamic method / function-module / BAdI calls

```abap
"Method — dynamic requires CALL METHOD (NEW/functional form can't be dynamic)
CALL METHOD oref->(meth).
CALL METHOD (class)=>(meth).

"With a parameter table (type abap_parmbind_tab)
DATA(ptab) = VALUE abap_parmbind_tab(
  ( name = 'NUM1'   kind = cl_abap_objectdescr=>exporting value = NEW i( 1 ) )
  ( name = 'RESULT' kind = cl_abap_objectdescr=>importing value = NEW i( ) ) ).
CALL METHOD oref->('IN_METH4') PARAMETER-TABLE ptab.

"Function module (type abap_func_parmbind_tab)
CALL FUNCTION func_name PARAMETER-TABLE ptab.
```

Dynamic calls fail at runtime with `CX_SY_DYN_CALL_*` (illegal method, param missing, illegal type). **Names are case-sensitive** — `('in_meth2')` fails; `('IN_METH2')` works.

### Dynamic CREATE OBJECT

```abap
DATA oref TYPE REF TO object.
CREATE OBJECT oref TYPE ('ZCL_DEMO_ABAP_OBJECTS').
"NEW cannot specify a dynamic type name — CREATE OBJECT is required here.
```

## Risks and when NOT to use dynamic

Dynamic programming is the one corner of ABAP where the compiler stops protecting you. Treat every dynamic token as a liability you must justify.

| Risk | What it costs you | Mitigation |
|---|---|---|
| **No static type check** | A typo in `(field_list)` or `(meth)` is a *runtime dump*, not a syntax error. No ATC pre-screening of the dynamic content. | Wrap in `TRY ... CATCH cx_sy_dynamic_osql_*`, `cx_sy_dyn_call_*`, `cx_sy_assign_*`. Validate names against an allowlist. |
| **Harder to debug** | Where-used, call hierarchy, and refactoring tools cannot see dynamic names. A renamed method silently breaks dynamic callers. | Keep dynamic surfaces tiny and well-documented; prefer constants for names. |
| **Performance** | Dynamic checks run at runtime; generic typing (`TYPE data`, `ANY TABLE`) blocks compiler optimizations and forces conversions. | Stay statically typed in hot paths; isolate dynamic code at boundaries. |
| **Security — injection** | External input in a dynamic `WHERE`, `FROM`, or `SET` is an SQL-injection vector; in `GENERATE SUBROUTINE POOL` / `INSERT REPORT` it is code injection. | Use `CL_ABAP_DYN_PRG` (`check_allowlist`, `check_char_literal`, …) or the built-in `escape`. Bind input as `@host` operands, never concatenate into the clause. |
| **ATC / Clean ABAP findings** | Dynamic constructs trip ATC checks and reduce static analyzability; reviewers cannot verify correctness by reading. | Document *why* dynamic is required; add unit tests covering the dynamic paths since the compiler won't. |
| **`CALL METHOD` is otherwise obsolete** | Static code should use functional/`NEW` syntax; `CALL METHOD` survives *only* for dynamic calls. | Don't introduce `CALL METHOD` except where the name is genuinely dynamic. |

**The decision rule:** if you can name the type or the identifier in your source, name it. Dynamic is for the cases where you genuinely cannot — a generic framework, a runtime-chosen table, a plugin dispatched by key. Everywhere else, static ABAP is faster, safer, and reviewable.

## Common Mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| Using `IS ASSIGNED` to test a failed *dynamic* assignment | Returns stale `true`; logic proceeds on wrong memory | Check `sy-subrc`; add `ELSE UNASSIGN` |
| Dynamic name in wrong case (`('in_meth')`) | `CX_SY_DYN_CALL_ILLEGAL_METHOD` | Upper-case dynamic names |
| Downcast without `IS INSTANCE OF` / `CASE TYPE OF` | `CX_SY_MOVE_CAST_ERROR` dump | Guard the cast |
| Concatenating external input into a dynamic `WHERE` | SQL injection | `CL_ABAP_DYN_PRG` / `escape`; bind as `@input` |
| `NEW` for a dynamic type name or dynamic `CREATE OBJECT` | Syntax error | Use `CREATE DATA ... TYPE (name)` / `CREATE OBJECT ... TYPE (name)` |
| Generic typing (`TYPE data`) where the type is actually known | Lost optimization, lost type safety | Declare the real type |
| No `TRY` around dynamic SQL / calls | Uncaught `CX_SY_DYNAMIC_*` dumps the program | Wrap and handle |
| Forgetting the driver/name validation in a generic table-display utility | Reads or dumps on an unexpected table | Allowlist-check the name first |

## References

- [references/rtti-rttc.md](references/rtti-rttc.md) — full RTTS class hierarchy, attributes/methods per descriptor, and RTTC creation patterns
- [references/dynamic-tokens.md](references/dynamic-tokens.md) — catalog of statements accepting dynamic tokens, with syntax
- [examples/rtti-walk.md](examples/rtti-walk.md) — worked example: walk any structure's components generically via RTTI
- **ABAP Keyword Documentation — Dynamic Programming:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abenabap_language_dynamic.htm
- **ABAP Keyword Documentation — RTTS / type description classes:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm
- **Security in dynamic programming:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abendynamic_programming_scrty.htm
- **SAP-samples/abap-cheat-sheets — 06_Dynamic_Programming.md:** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/06_Dynamic_Programming.md
- Linked skills: [abap-data-objects](../abap-data-objects/SKILL.md), [abap-oo-patterns](../abap-oo-patterns/SKILL.md), [abap-sql-performance](../abap-sql-performance/SKILL.md)
