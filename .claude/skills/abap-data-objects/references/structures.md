# ABAP Structures — Deep Dive

Structure declaration forms, variants, MOVE-CORRESPONDING/CORRESPONDING semantics, INCLUDE, BDEF-derived types, and boxed components. Ground truth: [02_Structures.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/02_Structures.md). See the parent [SKILL.md](../SKILL.md) for the overview.

A structure is a data object with a structured (complex) type — a sequence of components of any type (elementary, structured, table, or reference). Structured types are the line types of internal and database tables.

## Declaration forms

### Local structured type / structure

```abap
"Structured TYPE (chained form — preferred for readability)
TYPES: BEGIN OF ty_struc_type,
         comp1 TYPE i,                 "elementary
         comp2 TYPE c LENGTH 5,        "elementary
         comp3 TYPE structured_type,   "substructure
         comp4 TYPE itab_type,         "internal table
         comp5 TYPE ddic_type,         "DDIC type
         comp6 TYPE REF TO i,          "data reference
         comp7 LIKE data_object,       "derive from a data object
         comp8 TYPE LINE OF itab_type, "line type of a table type
         comp9 LIKE LINE OF lt_itab,    "line type of a table object
       END OF ty_struc_type.

"Non-chained equivalent
TYPES BEGIN OF ty_struc_type2.
  TYPES comp1 TYPE i.
  TYPES comp2 TYPE string.
TYPES END OF ty_struc_type2.

"Structure (object) — DATA supports VALUE for start values
DATA: BEGIN OF ls_struc,
        comp1 TYPE i VALUE 99,
        comp2 TYPE i VALUE IS INITIAL,   "without VALUE, content is initial
        comp3 TYPE local_structured_type,
      END OF ls_struc.
```

`CLASS-DATA` and `CONSTANTS` can also build structures (special cases of the above).

### From existing types / objects

```abap
DATA ls_struc_1 TYPE ty_struc_type.            "from a local structured type
DATA ls_struc_2 TYPE some_ddic_structure.   "from a DDIC structure
DATA ls_struc_3 TYPE some_ddic_table.       "from a DB table's line type
DATA ls_struc_4 TYPE some_cds_view.         "from a CDS view entity
DATA ls_struc_5 TYPE cl_some_class=>struc_type.   "from a global class/interface
DATA ls_struc_6 LIKE ls_struc_1.               "LIKE an existing structure
DATA ls_struc_7 LIKE LINE OF lt_some_itab.     "LIKE a table's line
DATA ls_struc_8 TYPE LINE OF some_itab_type."line type of a table type
```

> When referring to globally available DDIC types you **cannot** provide start values for the individual components.

### Inline

```abap
DATA(ls_struc_10) = ls_struc_1.                  "type derived, content copied
FINAL(ls_struc_11) = ls_struc_9.                  "immutable copy
DATA(ls_struc_a)  = VALUE ty_struc_type( ).       "initial structure of explicit type
SELECT SINGLE carrid, connid, seatsocc FROM zdemo_abap_fli WHERE carrid = 'LH' INTO @DATA(ls_struc_13).
LOOP AT lt_itab INTO DATA(ls_wa_2).
  ...
ENDLOOP.
```

### Constant / immutable / enumerated / anonymous

```abap
"Constant structure (values mandatory, cannot change)
CONSTANTS: BEGIN OF c_const_struct,
             num TYPE i VALUE 123,
             str TYPE string VALUE `ABAP`,
           END OF c_const_struct.

"Immutable via FINAL
TYPES ty_struct_type LIKE c_const_struct.
FINAL(ls_final_struct) = VALUE ty_struct_type( num = 987 str = `hello` ).

"Enumerated structure (groups enum constants — base type i unless specified)
TYPES ty_basetype TYPE i.
TYPES: BEGIN OF ENUM ty_enum_struc STRUCTURE ls_en_struc BASE TYPE ty_basetype,
         a VALUE IS INITIAL,
         b VALUE 1,
         c VALUE 2,
       END OF ENUM ty_enum_struc STRUCTURE ls_en_struc.
DATA(lv_enum_comp) = ls_en_struc-b.

"Anonymous structure (addressed via reference)
DATA(lr_struc_ref_a) = NEW ty_struc_type( ).
CREATE DATA lr_struc_ref_b TYPE ty_struc_type.
SELECT SINGLE carrid, carrname FROM zdemo_abap_carr WHERE carrid = char`LH`
  INTO NEW @DATA(lr_struc_ref_d).
```

## Variants: flat / nested / deep

| Variant | Definition |
|---|---|
| **Flat** | only fixed-length elementary components. Nesting alone does not change this — a nested structure is still flat unless a substructure has a deep component |
| **Nested** | at least one component is a substructure |
| **Deep** | contains at least one internal table, reference, or **`string`/`xstring`** |

```abap
"Flat
DATA: BEGIN OF ls_flat,
        comp1 TYPE i,
        comp2 TYPE c LENGTH 15,
        comp3 TYPE p LENGTH 8 DECIMALS 2,
      END OF ls_flat.

"Nested
DATA: BEGIN OF ls_address_n,
        BEGIN OF name,
          title   TYPE string,
          surname TYPE string,
        END OF name,
        BEGIN OF city,
          zipcode TYPE string,
          name    TYPE string,
        END OF city,
      END OF ls_address_n.

"Deep — contains an internal table
DATA: BEGIN OF ls_address_d,
        name    TYPE string,
        details TYPE TABLE OF some_table WITH EMPTY KEY,
      END OF ls_address_d.

"Deep — looks simple but strings make it deep
DATA: BEGIN OF ls_address,
        name   TYPE string,
        street TYPE string,
      END OF ls_address.
```

Why it matters:
- DDIC structure types are all flat (exception: `string` components may occur).
- ABAP SQL work areas cannot contain deep components other than `string` (among others).
- Assignment and comparison of deep structures require compatible source/target.

## Accessing components

```abap
ls_struc-comp1 = 1.                      "structure component selector -
DATA(lv_title) = ls_address_n-name-title.    "chaining for nested
IF ls_struc IS INITIAL. ... ENDIF.

"Through a reference: object component selector ->
lr_struc->comp1 = 1.
lr_struc->*-comp1 = 1.                "equivalent via dereferencing, less convenient

"Type/data declarations from a component
TYPES ty_type_1 TYPE structured_type-comp1.
DATA  lv_var_1  LIKE ls_struc-comp1.
```

Dynamic component access (`ASSIGN COMPONENT … OF STRUCTURE …`, `ls_struc-(name)`, `ls_struc-(index)`) is in [abap-dynamic-programming](../../abap-dynamic-programming/SKILL.md).

## Populating: VALUE / NEW / CORRESPONDING

```abap
"Component by component
ls_address-name = `Mr. Duncan Pea`.

"VALUE operator (# when type derivable, else explicit type)
ls_address = VALUE #( name = `Mr. Duncan Pea` street = `Vegetable Lane 11` ).
DATA(ls_addr) = VALUE addr_struc( name = `Mr. Duncan Pea` ).

"BASE keeps existing component values; without it, unspecified comps initialize
ls_addr = VALUE #( BASE ls_addr street = `Some Street 1` ).

"Nested VALUE
ls_str_1 = VALUE #( a = 1 nested_1 = VALUE #( b = 2 c = 3 ) ).

"NEW: anonymous structure via reference
DATA(lr_str_ref) = NEW struc_nested( a = 1 nested_1 = VALUE #( b = 2 c = 3 ) ).
lr_addr_ref2->* = VALUE #( BASE lr_addr_ref2->* name = `Mr. John Doe` ).
```

## MOVE-CORRESPONDING and CORRESPONDING #( ) — semantics

Both assign **identically named** components; useful when source/target types differ or component names differ. Special structure conversion/comparison rules apply.

### Flat structures

```abap
"Statement form — moves same-named comps; keeps other target comps
MOVE-CORRESPONDING ls_struc TO ls_diff_struc.

"Operator — INITIALIZES target, then moves same-named comps
ls_diff_struc = CORRESPONDING #( ls_struc ).

"BASE — keep existing target content (same effect as MOVE-CORRESPONDING)
ls_diff_struc = CORRESPONDING #( BASE ( ls_diff_struc ) ls_struc ).

"MAPPING — map source comp to target comp by name
ls_diff_struc = CORRESPONDING #( BASE ( ls_diff_struc ) ls_struc MAPPING comp1 = compa ).

"EXCEPT — exclude components from the assignment
ls_diff_struc = CORRESPONDING #( BASE ( ls_diff_struc ) ls_struc EXCEPT comp1 ).
```

### Deep structures (internal tables as components)

| Statement / expression | Internal table behaviour |
|---|---|
| `MOVE-CORRESPONDING deep TO diff.` | non-identical elementary comps kept; existing table content **replaced** by source, regardless of identically named comps |
| `MOVE-CORRESPONDING deep TO diff EXPANDING NESTED TABLES.` | existing table content replaced, but assignment happens for identically named comps only |
| `MOVE-CORRESPONDING deep TO diff KEEPING TARGET LINES.` | existing table content **kept**; source rows added (assignment like the plain statement) |
| `MOVE-CORRESPONDING deep TO diff EXPANDING NESTED TABLES KEEPING TARGET LINES.` | existing kept, source added, assignment like `EXPANDING NESTED TABLES` |
| `CORRESPONDING #( deep )` | target initialized; table assignment regardless of identically named comps |
| `CORRESPONDING #( DEEP deep )` | target initialized; table assignment for identically named comps only |
| `CORRESPONDING #( BASE ( diff ) deep )` | non-identical elementary comps kept; table content replaced (like operator without addition) |
| `CORRESPONDING #( DEEP BASE ( diff ) deep )` | as above but table assignment like `DEEP` |
| `CORRESPONDING #( APPENDING BASE ( diff ) deep )` | elementary comps kept; existing table content kept; source rows added (like operator without addition) |
| `CORRESPONDING #( DEEP APPENDING BASE ( diff ) deep )` | as above but table assignment like `DEEP` |

> `EXACT #( )` applies lossless-conversion checks to elementary components (see [types-catalog.md](types-catalog.md)). The system class `CL_ABAP_CORRESPONDING` offers programmatic mapping. In ABAP SQL `INTO`, the `CORRESPONDING` addition switches matching from position-based to name-based.

## INCLUDE TYPE / INCLUDE STRUCTURE

Include the components of another structure **as direct components** (a superstructure) — no substructure is created. These are standalone statements, not additions of `BEGIN OF … END OF …`, and they interrupt a chained `TYPES:`/`DATA:` statement.

- `INCLUDE TYPE struct_type.` — include a structured **type**.
- `INCLUDE STRUCTURE struct.` — include a **structure** (object).
- `AS name` — address the included components as if they were a substructure `name`.
- `RENAMING WITH SUFFIX _suffix` — append a suffix to avoid name clashes.

```abap
TYPES: BEGIN OF ty_name_type,
         title   TYPE string,
         prename TYPE string,
         surname TYPE string,
       END OF ty_name_type,
       BEGIN OF ty_street_type,
         name TYPE string,
         num  TYPE string,
       END OF ty_street_type,
       BEGIN OF ty_city_type,
         zipcode TYPE string,
         name    TYPE string,
       END OF ty_city_type.

DATA ls_city_struc TYPE ty_city_type.

TYPES BEGIN OF ty_address_type.
      INCLUDE TYPE ty_name_type AS name.
      INCLUDE TYPE ty_street_type AS street RENAMING WITH SUFFIX _street.
      INCLUDE STRUCTURE ls_city_struc AS city RENAMING WITH SUFFIX _city.
TYPES END OF ty_address_type.

"Resulting components:
"TITLE, PRENAME, SURNAME, NAME_STREET, NUM_STREET, ZIPCODE_CITY, NAME_CITY
```

## BDEF-derived types (RAP)

RAP-specific structured and table types derived from a behavior definition. Typical syntax `... TYPE STRUCTURE FOR ...` and `... TYPE TABLE FOR ...`.

```abap
DATA  lt_der_type1 TYPE TABLE FOR CREATE zdemo_abap_rap_ro_m.
TYPES tt_der_type2 TYPE TABLE FOR UPDATE zdemo_abap_rap_ro_m.
DATA  lt_der_type3 TYPE TABLE FOR ACTION IMPORT zdemo_abap_rap_ro_m~multiply_by_2.
DATA  lt_der_type4 TYPE TABLE FOR READ IMPORT zdemo_abap_rap_ro_m.
TYPES ty_der_type5 TYPE STRUCTURE FOR DELETE zdemo_abap_rap_ro_m.
DATA  ls_der_type6 TYPE STRUCTURE FOR PERMISSIONS REQUEST zdemo_abap_rap_ro_m.
```

Full details: [ABAP EML cheat sheet](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/08_EML_ABAP_for_RAP.md) and the [rap-bo-modeling](../../rap-bo-modeling/SKILL.md) skill.

## Boxed components

A boxed component is a nested structure managed by an internal reference, enabling **initial value sharing**. The addition is `BOXED`.

```abap
TYPES: BEGIN OF ty_struct,
         text          TYPE c LENGTH 20,
         nested_struct TYPE zdemo_abap_carr BOXED,
       END OF ty_struct.
```

When to use:
- Optimize memory for structures used repeatedly (e.g. internal tables with nested structures). With boxed components, memory does not grow while the nested structure stays initial.
- Faster assignments — for components with active initial value sharing only the internal reference is copied.
- Memory is allocated only on write access, or when a field symbol/data reference points to a component.

## Clearing

```abap
CLEAR ls_struc-component.    "reset one component
CLEAR ls_struc.             "reset whole structure to initial
FREE ls_struc.              "clear AND release memory
ls_struc = VALUE #( ).      "also clears
lr_struc_ref = NEW #( ).    "clears the referenced structure
```

## The sy / syst structure

The built-in `sy` (alias `syst`) structure holds ABAP system fields filled by the runtime — read-only by convention. Usable in ABAP for Cloud Development: `sy-subrc` (return code, 0 = success), `sy-tabix` (internal table row index), `sy-index` (loop pass index). Most other `sy-*` fields are Standard-ABAP only and trigger a syntax warning in ABAP Cloud.

## Related

- [abap-internal-tables](../../abap-internal-tables/SKILL.md) — tables built on structured line types, work areas, keys
- [abap-constructor-expressions](../../abap-constructor-expressions/SKILL.md) — `VALUE`/`CORRESPONDING`/`NEW` mechanics in depth
- [abap-dynamic-programming](../../abap-dynamic-programming/SKILL.md) — `ASSIGN COMPONENT`, RTTI on structures
- [types-catalog.md](types-catalog.md) — built-in/generic types and conversion rules
