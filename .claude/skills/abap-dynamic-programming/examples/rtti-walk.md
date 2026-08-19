# Worked Example — Walking a Structure's Components Generically via RTTI

Goal: given **any** structure (its type unknown at compile time), visit every component, read its name from RTTI, and read its value through dynamic component access. This is the building block for generic serializers, loggers, comparators, and table displays.

All patterns are taken verbatim from `06_Dynamic_Programming.md`.

## The two ingredients

1. **RTTI** gives the component *names* — `cl_abap_structdescr=>components` (or `get_components( )`).
2. **Dynamic component access** gives the *value* — `<struc>-(name)` or `<struc>-(position)`, where `sy-index` is interpreted as the 1-based component position.

## Pattern 1 — walk by position with `sy-index`

The simplest walk. Increase `sy-index` until dynamic access fails (component not found), which raises `CX_SY_ASSIGN_ILLEGAL_COMPONENT`. All component values must be convertible to string.

```abap
TYPES: BEGIN OF ty_struc,
         comp1 TYPE c LENGTH 3,
         comp2 TYPE string,
         comp3 TYPE i,
         comp4 TYPE n LENGTH 4,
       END OF ty_struc.
DATA(struct) = VALUE ty_struc( comp1 = 'abc' comp2 = `ABAP` comp3 = 123 comp4 = '9876' ).
DATA looped_struc TYPE string.

DO.
  TRY.
      looped_struc = |{ looped_struc }{ COND #( WHEN sy-index <> 1 THEN `, ` ) }"{ struct-(sy-index) }"|.
    CATCH cx_sy_assign_illegal_component.
      EXIT.
  ENDTRY.
ENDDO.

"Result: "abc", "ABAP", "123", "9876"
```

## Pattern 2 — walk with names from RTTI

Use RTTI to retrieve the **component names** too. Assign the structure to a generic field symbol, cast its description to `cl_abap_structdescr`, and read `components`. Then pair each name with its value via `<struc>-(sy-index)`.

```abap
DATA struc2string TYPE string.
FIELD-SYMBOLS <strco> TYPE data.
ASSIGN st TO <strco>.                 "st is any structure; <strco> is generic

TRY.
    "RTTI: get the component descriptors (name, type_kind, length, decimals)
    DATA(comps) = CAST cl_abap_structdescr(
      cl_abap_typedescr=>describe_by_data( <strco> ) )->components.

    DO.
      TRY.
          "Name from RTTI by position; value by dynamic component access
          DATA(comp_name) = comps[ sy-index ]-name.
          struc2string = struc2string &&
                         COND #( WHEN sy-index <> 1 THEN `, ` ) &&
                         comp_name && `: "` && <strco>-(sy-index) && `"`.
        CATCH cx_sy_assign_illegal_component cx_sy_itab_line_not_found.
          EXIT.
      ENDTRY.
    ENDDO.
  CATCH cx_sy_move_cast_error.        "<strco> was not a structure
ENDTRY.

"struc2string: COL1: "123", COL2: "ABAP", COL3: "Z"
```

Key points:
- `<strco>` is typed `TYPE data` so any structure can be assigned — RTTI supplies the shape.
- The outer `TRY` guards the `CAST` (`CX_SY_MOVE_CAST_ERROR` if the input is not a structure).
- The inner `TRY` ends the loop when the position runs past the last component.
- `comps[ sy-index ]-name` is the RTTI name; `<strco>-(sy-index)` is the live value.

## Pattern 3 — generic for a table's line type (RTTI on a table)

When you have an internal table (e.g. from a dynamic `SELECT`) and need its column names, describe the table, get its line type, cast that to a structure descriptor, and read `get_components( )`.

```abap
"itab is REF TO data filled by a dynamic SELECT — field list MUST come from a fixed allowlist, never unvalidated caller input
"Example: SELECT (`CARRID, CONNID`) FROM (dbtab) INTO TABLE NEW @DATA(itab)
TRY.
    DATA(type_descr_obj_tab) = CAST cl_abap_tabledescr(
      cl_abap_typedescr=>describe_by_data( itab->* ) ).
    DATA(tab_comps) = CAST cl_abap_structdescr(
      type_descr_obj_tab->get_table_line_type( ) )->get_components( ).

    LOOP AT tab_comps ASSIGNING FIELD-SYMBOL(<comp>).
      DATA(name) = <comp>-name.        "column name
      "<comp>-type is the component's own type description object (handles nesting)
    ENDLOOP.
  CATCH cx_sy_move_cast_error INTO DATA(error).
    ...
ENDTRY.
```

Then iterate the rows and read each cell dynamically:

```abap
LOOP AT itab->* ASSIGNING FIELD-SYMBOL(<wa>).
  DO.
    TRY.
        DATA(cell) = |{ <wa>-(sy-index) }|.   "value of column sy-index in this row
      CATCH cx_sy_assign_illegal_component.
        EXIT.
    ENDTRY.
  ENDDO.
ENDLOOP.
```

This is exactly how a generic "display any database table" routine works: a dynamic `SELECT` into an anonymous table, RTTI to learn the columns, and dynamic component access to read every cell.

## Why guard everything

Because the structure's shape is unknown at compile time, **every** access can fail at runtime:
- `CAST cl_abap_structdescr( ... )` → `CX_SY_MOVE_CAST_ERROR` if the input is not a structure/table.
- `<struc>-(name)` / `<struc>-(pos)` → `CX_SY_ASSIGN_ILLEGAL_COMPONENT` for a bad name or out-of-range position.
- `comps[ sy-index ]` → `CX_SY_ITAB_LINE_NOT_FOUND` past the last component.

The compiler checks none of these — that is the price of going generic, and the reason the loops above are wrapped in `TRY ... CATCH`.

## Validate any external/runtime name first

If the structure or table name comes from outside, allowlist-check it before the dynamic `SELECT`/`ASSIGN`:

```abap
TRY.
    DATA(checked) = cl_abap_dyn_prg=>check_allowlist(
      val           = dbtab
      allowlist_str = `ZDEMO_ABAP_CARR,ZDEMO_ABAP_FLI,ZDEMO_ABAP_FLSCH` ).
  CATCH cx_abap_not_in_allowlist INTO DATA(not_allowed).
    "reject the input
ENDTRY.
```

> Source: SAP-samples/abap-cheat-sheets — [06_Dynamic_Programming.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/06_Dynamic_Programming.md) ("Accessing Structure Components Dynamically" and the dynamic table-display example).
