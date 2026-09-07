# RTTI / RTTC Reference — Type Description Classes

Run Time Type Services (RTTS) is a hierarchy of type description classes used to **identify** types at runtime (RTTI) and to **create** new types at runtime (RTTC). All syntax below is taken from the SAP ABAP cheat sheet `06_Dynamic_Programming.md`.

## The class hierarchy

```
CL_ABAP_TYPEDESCR
  |
  |--CL_ABAP_DATADESCR
  |   |
  |   |--CL_ABAP_ELEMDESCR
  |   |   |
  |   |   |--CL_ABAP_ENUMDESCR
  |   |
  |   |--CL_ABAP_REFDESCR
  |   |--CL_ABAP_COMPLEXDESCR
  |       |
  |       |--CL_ABAP_STRUCTDESCR
  |       |--CL_ABAP_TABLEDESCR
  |
  |--CL_ABAP_OBJECTDESCR
     |
     |--CL_ABAP_CLASSDESCR
     |--CL_ABAP_INTFDESCR
```

- For each type there is exactly **one** type description object.
- For each type category there is one type description class with special attributes for that category.
- Working with the tree means using **downcasts** (the entry methods return `ref to cl_abap_typedescr`; cast to the subclass for detail). Guard downcasts with `IS INSTANCE OF` or `CASE TYPE OF`.

## Entry methods (on `cl_abap_typedescr`)

| Method | Input | Returns |
|---|---|---|
| `describe_by_data( dobj )` | a data object | `ref to cl_abap_typedescr` |
| `describe_by_name( 'TYPE_NAME' )` | a relative or absolute type name | `ref to cl_abap_typedescr` |
| `describe_by_object_ref( oref )` | an object reference | `ref to cl_abap_typedescr` |
| `describe_by_data_ref( dref )` | a data reference (describes the *referenced* object) | `ref to cl_abap_typedescr` |

```abap
"General info needs no cast
DATA(lo_tdo) = cl_abap_typedescr=>describe_by_data( some_dobj ).
DATA(lv_kind)          = lo_tdo->kind.            "kind_elem / kind_struct / ...
DATA(lv_type_kind)     = lo_tdo->type_kind.
DATA(lv_absolute_name) = lo_tdo->absolute_name.
DATA(lv_relative_name) = lo_tdo->get_relative_name( ).
```

## RTTI — getting information per category

### Elementary types — `CL_ABAP_ELEMDESCR`

```abap
DATA(lo_tdo_elem) = CAST cl_abap_elemdescr( cl_abap_typedescr=>describe_by_data( lv_ts ) ).

DATA(lv_type_category) = lo_tdo_elem->kind.            "= cl_abap_typedescr=>kind_elem
DATA(lv_type_kind)     = lo_tdo_elem->type_kind.
DATA(lv_decimals)      = lo_tdo_elem->decimals.
DATA(lv_output_length) = lo_tdo_elem->output_length.
DATA(lv_is_ddic)       = lo_tdo_elem->is_ddic_type( ).
"Type-compatibility checks
DATA(lv_ok1) = lo_tdo_elem->applies_to_data( lv_some_value ).
DATA(lv_ok2) = lo_tdo_elem->applies_to_data_ref( REF #( lv_some_value ) ).
DATA(lv_ok3) = lo_tdo_elem->applies_to_data_descr( CAST cl_abap_datadescr( ... ) ).
```

### Enumerated types — `CL_ABAP_ENUMDESCR`

Enumerated types count as elementary (`kind = kind_elem`).

```abap
DATA(lo_tdo_enum) = CAST cl_abap_enumdescr( cl_abap_typedescr=>describe_by_data( lv_a ) ).
DATA(lv_base_kind) = lo_tdo_enum->base_type_kind.
DATA(lt_members)   = lo_tdo_enum->members.            "table of name/value
ASSERT lt_members[ name = 'D' ]-value = 'wx'.
```

### Structures — `CL_ABAP_STRUCTDESCR`

```abap
DATA(lo_tdo_struc) = CAST cl_abap_structdescr( cl_abap_typedescr=>describe_by_data( ls_demo_struc ) ).

DATA(lt_comps)             = lo_tdo_struc->components.        "abap_compdescr_tab (name/type_kind/length/decimals)
DATA(lt_comps_detailed)    = lo_tdo_struc->get_components( ). "abap_component_tab (name + type description object)
DATA(lv_has_include)       = lo_tdo_struc->has_include.
DATA(lv_struct_kind)       = lo_tdo_struc->struct_kind.
DATA(lo_included_view)     = lo_tdo_struc->get_included_view( ).
DATA(lt_symbols)           = lo_tdo_struc->get_symbols( ).     "all components incl. substructures
```

- `components` is the lightweight table (`abap_compdescr_tab`); `get_components( )` returns each component's own type description object (handles nesting).
- Some methods (e.g. `get_ddic_field_list`) are **not** available in ABAP for Cloud Development — use the XCO library (`xco_cp_abap_dictionary`) instead.

### Internal tables — `CL_ABAP_TABLEDESCR`

```abap
DATA(lo_tdo_tab) = CAST cl_abap_tabledescr( cl_abap_typedescr=>describe_by_data( lt_itab ) ).

DATA(lv_table_kind)     = lo_tdo_tab->table_kind.        "= cl_abap_tabledescr=>tablekind_sorted / _hashed / _std
DATA(lt_keys)           = lo_tdo_tab->key.
DATA(lt_keys_detailed)  = lo_tdo_tab->get_keys( ).
DATA(lv_has_unique_key) = lo_tdo_tab->has_unique_key.
DATA(lt_key_aliases)    = lo_tdo_tab->get_key_aliases( ).
DATA(lo_line_tdo)       = lo_tdo_tab->get_table_line_type( ).   "ref to cl_abap_datadescr
"Line components — cast the line type to structdescr
DATA(lt_line_comps) = CAST cl_abap_structdescr( lo_tdo_tab->get_table_line_type( ) )->components.
```

### Data references — `CL_ABAP_REFDESCR`

```abap
DATA(lo_tdo_ref) = CAST cl_abap_refdescr( cl_abap_typedescr=>describe_by_data( lr_dref ) ).
"Type of the referenced object
DATA(lo_referenced_type) = lo_tdo_ref->get_referenced_type( ).   "ref to cl_abap_typedescr
"Convenience: describe what a data reference points to in one go
DATA(lo_tdo_target) = cl_abap_typedescr=>describe_by_data_ref( lr_dref ).
```

### Classes — `CL_ABAP_CLASSDESCR`

```abap
DATA(lo_tdo_cl) = CAST cl_abap_classdescr( cl_abap_typedescr=>describe_by_object_ref( lo_oref ) ).

DATA(lv_class_kind) = lo_tdo_cl->class_kind.        "= cl_abap_classdescr=>classkind_final / ...
DATA(lt_attributes) = lo_tdo_cl->attributes.
DATA(lt_interfaces) = lo_tdo_cl->interfaces.
DATA(lt_events)     = lo_tdo_cl->events.
DATA(lt_methods)    = lo_tdo_cl->methods.
"Per-method parameter type
DATA(lo_param_tdo) = lo_tdo_cl->get_method_parameter_type(
  p_method_name = 'SOME_METH' p_parameter_name = 'P1' ).
DATA(lo_super_tdo)       = lo_tdo_cl->get_super_class_type( ).
DATA(lv_is_instantiable) = lo_tdo_cl->is_instantiatable( ).
```

### Interfaces — `CL_ABAP_INTFDESCR`

```abap
DATA(lo_tdo_if) = CAST cl_abap_intfdescr( cl_abap_typedescr=>describe_by_name( 'ZIF_X' ) ).
DATA(lv_intf_kind) = lo_tdo_if->intf_kind.          "= cl_abap_intfdescr=>intfkind_flatt / ...
DATA(lt_attributes) = lo_tdo_if->attributes.
DATA(lt_interfaces) = lo_tdo_if->interfaces.
DATA(lt_events)     = lo_tdo_if->events.
DATA(lt_methods)    = lo_tdo_if->methods.
```

## Safe downcasting

```abap
"IS INSTANCE OF
IF lo_some_tdo IS INSTANCE OF cl_abap_structdescr.
  DATA(lo_struct_descr) = CAST cl_abap_structdescr( lo_some_tdo ).
ENDIF.

"CASE TYPE OF
CASE TYPE OF lo_some_tdo.
  WHEN TYPE cl_abap_elemdescr.   DATA(lo_elem_descr) = CAST cl_abap_elemdescr( lo_some_tdo ).
  WHEN TYPE cl_abap_refdescr.    DATA(lo_ref_descr) = CAST cl_abap_refdescr( lo_some_tdo ).
  WHEN TYPE cl_abap_structdescr. DATA(lo_st) = CAST cl_abap_structdescr( lo_some_tdo ).
  WHEN TYPE cl_abap_tabledescr.  DATA(lo_table_descr) = CAST cl_abap_tabledescr( lo_some_tdo ).
  WHEN OTHERS. ...
ENDCASE.
```

For a **non-initial** reference the *dynamic* type is checked; for an **initial** one the *static* type is checked. An unguarded illegal downcast raises `CX_SY_MOVE_CAST_ERROR`.

---

## RTTC — creating types and data objects at runtime

Build a type description object, then materialize it with `CREATE DATA ... TYPE HANDLE`. After `HANDLE`, a reference of static type `CL_ABAP_DATADESCR` (or a subclass) is expected.

### Getting type description objects

```abap
"From an existing type name
DATA(lo_tdo1) = cl_abap_typedescr=>describe_by_name( 'TY_TAB' ).
"From an existing data object
DATA(lo_tdo2) = cl_abap_typedescr=>describe_by_data( some_dobj ).
```

### Built-in elementary types — `cl_abap_elemdescr=>get_*`

Conceptually all built-in elementary types already exist; the `get_*` methods return their description objects.

```abap
DATA(lo_tdo_string) = cl_abap_elemdescr=>get_string( ).
DATA(lo_tdo_i)      = cl_abap_elemdescr=>get_i( ).
DATA(lo_tdo_int1)   = cl_abap_elemdescr=>get_int1( ).
DATA(lo_tdo_int2)   = cl_abap_elemdescr=>get_int2( ).
DATA(lo_tdo_int8)   = cl_abap_elemdescr=>get_int8( ).
DATA(lo_tdo_d)      = cl_abap_elemdescr=>get_d( ).
DATA(lo_tdo_t)      = cl_abap_elemdescr=>get_t( ).
DATA(lo_tdo_utcl)   = cl_abap_elemdescr=>get_utclong( ).
DATA(lo_tdo_dec16)  = cl_abap_elemdescr=>get_decfloat16( ).
DATA(lo_tdo_dec34)  = cl_abap_elemdescr=>get_decfloat34( ).
DATA(lo_tdo_f)      = cl_abap_elemdescr=>get_f( ).
DATA(lo_tdo_xstr)   = cl_abap_elemdescr=>get_xstring( ).
"Length-parameterized
DATA(lo_tdo_c5)  = cl_abap_elemdescr=>get_c( 5 ).
DATA(lo_tdo_n4)  = cl_abap_elemdescr=>get_n( 4 ).
DATA(lo_tdo_x10) = cl_abap_elemdescr=>get_x( 10 ).
DATA(lo_tdo_p)   = cl_abap_elemdescr=>get_p( p_length = 16 p_decimals = 14 ).
"By type kind
DATA(lo_tdo_by_kind) = cl_abap_elemdescr=>get_by_kind( cl_abap_elemdescr=>typekind_string ).

DATA lr_dref TYPE REF TO data.
CREATE DATA lr_dref TYPE HANDLE lo_tdo_c5.
```

DDIC data elements come via `describe_by_name`, cast to `cl_abap_datadescr` for use with `TYPE HANDLE`:

```abap
DATA(lo_tdo_elem) = CAST cl_abap_datadescr( cl_abap_elemdescr=>describe_by_name( 'TIMESTAMPL' ) ).
CREATE DATA lr_dref TYPE HANDLE lo_tdo_elem.
```

### Structures — `cl_abap_structdescr=>get`

Pass a component table (`abap_component_tab`), each row a `name` + a type description object.

```abap
DATA(lo_tdo_struc) = cl_abap_structdescr=>get(
  VALUE #(
    ( name = 'NUM'    type = cl_abap_elemdescr=>get_i( ) )
    ( name = 'PACKED' type = cl_abap_elemdescr=>get_p( p_length = 16 p_decimals = 14 ) )
    ( name = 'TEXT'   type = cl_abap_elemdescr=>get_c( 20 ) )
    ( name = 'LAND'   type = CAST cl_abap_datadescr( cl_abap_typedescr=>describe_by_name( 'LAND1' ) ) )
    ( name = 'TS'     type = CAST cl_abap_datadescr( cl_abap_typedescr=>describe_by_name( 'TIMESTAMPL' ) ) ) ) ).
CREATE DATA lr_dref TYPE HANDLE lo_tdo_struc.
```

Deep structures (component types that are themselves structures or tables) work the same — just supply the nested description object. `get_bdef_derived_type( p_entity = ... p_kind = abp_bdef_derived_type-create )` builds RAP BDEF derived-type structures.

### Internal tables — `cl_abap_tabledescr=>get` / `get_with_keys`

`get( )` needs only the line type; everything else defaults (standard table, default key).

```abap
"Elementary line type, standard key
DATA(lo_tdo_tab1) = cl_abap_tabledescr=>get( p_line_type = cl_abap_elemdescr=>get_string( ) ).

"Structured line type, sorted table, custom unique key
DATA(lo_tdo_tab2) = cl_abap_tabledescr=>get(
  p_line_type  = CAST cl_abap_structdescr( cl_abap_tabledescr=>describe_by_name( 'ZDEMO_ABAP_FLSCH' ) )
  p_table_kind = cl_abap_tabledescr=>tablekind_sorted
  p_key        = VALUE #( ( name = 'CARRID' ) ( name = 'CONNID' ) )
  p_unique     = cl_abap_typedescr=>true
  p_key_kind   = cl_abap_tabledescr=>keydefkind_user ).
CREATE DATA lr_dref TYPE HANDLE lo_tdo_tab2.
```

For primary **and** secondary keys (incl. alias names), use `get_with_keys`:

```abap
DATA(lo_tdo_tab) = cl_abap_tabledescr=>get_with_keys(
  p_line_type = CAST cl_abap_structdescr( cl_abap_typedescr=>describe_by_name( 'STRUC_TYPE' ) )
  p_keys = VALUE #(
    ( name = 'PK'      is_primary = abap_true  access_kind = cl_abap_tabledescr=>tablekind_hashed
      is_unique = abap_true  key_kind = cl_abap_tabledescr=>keydefkind_user
      components = VALUE #( ( name = 'A' ) ) )
    ( name = 'SEC_KEY' is_primary = abap_false access_kind = cl_abap_tabledescr=>tablekind_sorted
      is_unique = abap_false key_kind = cl_abap_tabledescr=>keydefkind_user
      components = VALUE #( ( name = 'B' ) ( name = 'C' ) ) ) )
  p_key_aliases = VALUE #( ( name = 'PRIMARY_KEY' alias = 'PK' )
                           ( name = 'SEC_KEY'     alias = 'SK' ) ) ).
```

### Reference types — `cl_abap_refdescr=>get` / `get_by_name`

```abap
DATA(lo_tdo_ref1) = cl_abap_refdescr=>get( cl_abap_elemdescr=>get_string( ) ).
DATA(lo_tdo_ref2) = cl_abap_refdescr=>get( cl_abap_typedescr=>describe_by_name( 'TIMESTAMPL' ) ).
DATA(lo_tdo_ref3) = cl_abap_refdescr=>get_by_name( 'TIMESTAMP' ).
DATA(lo_tdo_ref_data) = cl_abap_refdescr=>get_ref_to_data( ).    "REF TO data
DATA(lo_tdo_ref_obj)  = cl_abap_refdescr=>get_ref_to_object( ).  "REF TO object
CREATE DATA lr_dref TYPE HANDLE lo_tdo_ref1.
```

> `get` / `get_by_name` are the recommended methods (over the older `create` / `create_by_name`).

## Verifying a dynamically created object

`applies_to_data( )` confirms a created object matches an expected type:

```abap
CREATE DATA lr_dref TYPE HANDLE lo_tdo_struc.
DATA(lv_check) = CAST cl_abap_structdescr(
  cl_abap_typedescr=>describe_by_data( lr_dref->* ) )->applies_to_data( ls_expected_struc ).
ASSERT lv_check = abap_true.
```

## Constants used with the description classes (selection)

| Class | Constant | Meaning |
|---|---|---|
| `cl_abap_typedescr` | `kind_elem` / `kind_struct` / `kind_table` / `kind_ref` / `kind_class` / `kind_intf` | type category (`->kind`) |
| `cl_abap_typedescr` | `typekind_int`, `typekind_string`, `typekind_struct1` (flat), `typekind_struct2` (deep), `typekind_table`, `typekind_dref`, `typekind_enum` … | technical type kind (`->type_kind`) |
| `cl_abap_typedescr` | `true` (`X`) / `false` ( ) | flags passed to RTTC `get` methods |
| `cl_abap_tabledescr` | `tablekind_std` / `tablekind_sorted` / `tablekind_hashed` | table category |
| `cl_abap_tabledescr` | `keydefkind_empty` / `keydefkind_user` / `keydefkind_default` | key definition kind |
| `cl_abap_classdescr` | `classkind_final` / `classkind_abstract` … | class kind |
| `cl_abap_intfdescr` | `intfkind_flatt` … | interface kind |
| `cl_abap_objectdescr` | `exporting` / `importing` / `changing` / `receiving` | `kind` values for `abap_parmbind_tab` |

## ABAP Cloud note

Some RTTI methods from classic ABAP are not released for ABAP for Cloud Development (e.g. `get_ddic_field_list`). Use the **XCO library** (`xco_cp_abap_dictionary`, see the Released ABAP Classes cheat sheet) for DDIC metadata in Steampunk.

> Source: SAP-samples/abap-cheat-sheets — [06_Dynamic_Programming.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/06_Dynamic_Programming.md) (Runtime Type Services / RTTI / RTTC sections).
