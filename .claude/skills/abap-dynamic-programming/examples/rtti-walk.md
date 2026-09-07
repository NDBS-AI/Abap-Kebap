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
DATA(ls_struct) = VALUE ty_struc( comp1 = 'abc' comp2 = `ABAP` comp3 = 123 comp4 = '9876' ).
DATA lv_looped_struc TYPE string.

DO.
  TRY.
      lv_looped_struc = |{ lv_looped_struc }{ COND #( WHEN sy-index <> 1 THEN `, ` ) }"{ ls_struct-(sy-index) }"|.
    CATCH cx_sy_assign_illegal_component.
      EXIT.
  ENDTRY.
ENDDO.

"Result: "abc", "ABAP", "123", "9876"
```

## Pattern 2 — walk with names from RTTI

Use RTTI to retrieve the **component names** too. Assign the structure to a generic field symbol, cast its description to `cl_abap_structdescr`, and read `components`. Then pair each name with its value via `<struc>-(sy-index)`.

```abap
DATA lv_struc2string TYPE string.
FIELD-SYMBOLS <fs_strco> TYPE data.
ASSIGN ls_st TO <fs_strco>.                 "ls_st is any structure; <fs_strco> is generic

TRY.
    "RTTI: get the component descriptors (name, type_kind, length, decimals)
    DATA(lt_comps) = CAST cl_abap_structdescr(
      cl_abap_typedescr=>describe_by_data( <fs_strco> ) )->components.

    DO.
      TRY.
          "Name from RTTI by position; value by dynamic component access
          DATA(lv_comp_name) = lt_comps[ sy-index ]-name.
          lv_struc2string = lv_struc2string &&
                         COND #( WHEN sy-index <> 1 THEN `, ` ) &&
                         lv_comp_name && `: "` && <fs_strco>-(sy-index) && `"`.
        CATCH cx_sy_assign_illegal_component cx_sy_itab_line_not_found.
          EXIT.
      ENDTRY.
    ENDDO.
  CATCH cx_sy_move_cast_error.        "<fs_strco> was not a structure
ENDTRY.

"lv_struc2string: COL1: "123", COL2: "ABAP", COL3: "Z"
```

Key points:
- `<fs_strco>` is typed `TYPE data` so any structure can be assigned — RTTI supplies the shape.
- The outer `TRY` guards the `CAST` (`CX_SY_MOVE_CAST_ERROR` if the input is not a structure).
- The inner `TRY` ends the loop when the position runs past the last component.
- `lt_comps[ sy-index ]-name` is the RTTI name; `<fs_strco>-(sy-index)` is the live value.

## Pattern 3 — generic for a table's line type (RTTI on a table)

When you have an internal table (e.g. from a dynamic `SELECT`) and need its column names, describe the table, get its line type, cast that to a structure descriptor, and read `get_components( )`.

```abap
"lr_itab is REF TO data filled by a dynamic SELECT — field list MUST come from a fixed allowlist, never unvalidated caller input
"Example: SELECT (`CARRID, CONNID`) FROM (lv_dbtab) INTO TABLE NEW @DATA(lr_itab)
TRY.
    DATA(lo_type_descr_obj_tab) = CAST cl_abap_tabledescr(
      cl_abap_typedescr=>describe_by_data( lr_itab->* ) ).
    DATA(lt_tab_comps) = CAST cl_abap_structdescr(
      lo_type_descr_obj_tab->get_table_line_type( ) )->get_components( ).

    LOOP AT lt_tab_comps ASSIGNING FIELD-SYMBOL(<fs_comp>).
      DATA(lv_name) = <fs_comp>-name.        "column name
      "<fs_comp>-type is the component's own type description object (handles nesting)
    ENDLOOP.
  CATCH cx_sy_move_cast_error INTO DATA(lo_error).
    ...
ENDTRY.
```

Then iterate the rows and read each cell dynamically:

```abap
LOOP AT lr_itab->* ASSIGNING FIELD-SYMBOL(<fs_wa>).
  DO.
    TRY.
        DATA(lv_cell) = |{ <fs_wa>-(sy-index) }|.   "value of column sy-index in this row
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
- `<fs_strco>-(name)` / `<fs_strco>-(pos)` → `CX_SY_ASSIGN_ILLEGAL_COMPONENT` for a bad name or out-of-range position.
- `lt_comps[ sy-index ]` → `CX_SY_ITAB_LINE_NOT_FOUND` past the last component.

The compiler checks none of these — that is the price of going generic, and the reason the loops above are wrapped in `TRY ... CATCH`.

## Validate any external/runtime name first

If the structure or table name comes from outside, allowlist-check it before the dynamic `SELECT`/`ASSIGN`:

```abap
TRY.
    DATA(lv_checked) = cl_abap_dyn_prg=>check_allowlist(
      val           = lv_dbtab
      allowlist_str = `ZDEMO_ABAP_CARR,ZDEMO_ABAP_FLI,ZDEMO_ABAP_FLSCH` ).
  CATCH cx_abap_not_in_allowlist INTO DATA(lo_not_allowed).
    "reject the input
ENDTRY.
```

> Source: SAP-samples/abap-cheat-sheets — [06_Dynamic_Programming.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/06_Dynamic_Programming.md) ("Accessing Structure Components Dynamically" and the dynamic table-display example).
