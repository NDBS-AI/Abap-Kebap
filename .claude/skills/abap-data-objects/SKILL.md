---
name: abap-data-objects
description: "Use when declaring ABAP data types or data objects, choosing TYPES vs DATA, picking a built-in elementary type (i, int8, p, decfloat16/34, f, c, n, x, d, t, utclong, string, xstring), defining or operating on structures (flat, nested, deep, INCLUDE TYPE/STRUCTURE, MOVE-CORRESPONDING and CORRESPONDING # with BASE/MAPPING/EXCEPT/DEEP), working with data references (TYPE REF TO data, REF #, GET REFERENCE, dereferencing ->*, up/downcast), creating anonymous data objects (NEW, CREATE DATA), constants and immutable variables (CONSTANTS, FINAL), generic types for parameters and field symbols (any, data, clike, csequence, numeric, simple, any/index/sorted/standard table), enumerated types, ranges tables, or doing bit/byte operations on xstring. Distilled from SAP's official ABAP cheat sheets."
---

# ABAP Data Types and Data Objects

## Overview

A scannable reference for declaring data **types** (descriptions, no memory) and data **objects** (typed, memory-occupying instances) in ABAP. Distilled from SAP's [16_Data_Types_and_Objects](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/16_Data_Types_and_Objects.md), [02_Structures](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/02_Structures.md), and [09_Bits_and_Bytes](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/09_Bits_and_Bytes.md) cheat sheets.

**Core principle:** the data type defines the technical properties; the same 4 bytes in memory mean a different value depending on whether ABAP reads them as `i`, `c`, or `x`. Choose the type that matches the data's meaning, not the one that is convenient. Reach for `TYPES`/`DATA` with explicit types when the type is documentation; reach for inline `DATA(...)`/`FINAL(...)` when the right-hand side already makes the type obvious.

## When to Use

Load this skill when:
- Declaring a variable, constant, type, structure, internal table type, or reference — and you want the right built-in type, length, and decimals.
- Deciding between `TYPES` (a standalone type) and `DATA` (a bound data object), or between explicit and inline declaration.
- Building or copying structures: flat vs nested vs deep, `MOVE-CORRESPONDING` vs `CORRESPONDING #( … )`, `INCLUDE TYPE`/`INCLUDE STRUCTURE`.
- Using data references: `TYPE REF TO data`, `REF #( … )`, dereferencing `->*`, up/downcasts with `CAST`.
- Creating anonymous data objects with `NEW` / `CREATE DATA`.
- Typing a method parameter or field symbol generically (`any`, `data`, `clike`, `numeric`, `any table`, …).
- Defining enumerated types, ranges tables, or doing bit/byte work on `xstring`.

**When NOT to use:**
- Heavy internal-table operations (LOOP/READ/MODIFY/sorting/keys) — see [abap-internal-tables](../abap-internal-tables/SKILL.md).
- `VALUE`/`CORRESPONDING`/`REDUCE`/`COND`/`SWITCH` expression mechanics in depth — see [abap-constructor-expressions](../abap-constructor-expressions/SKILL.md).
- String templates, `FIND`/`REPLACE`, regex — see [abap-strings-regex](../abap-strings-regex/SKILL.md).
- RTTI/RTTC, dynamic `ASSIGN`, dynamic component access — see [abap-dynamic-programming](../abap-dynamic-programming/SKILL.md).
- Naming and modern-vs-legacy style choices — see [abap-clean-style](../abap-clean-style/SKILL.md).
- DDIC-defined global types (data elements, structures, table types, CDS) — see abap-dictionary-ddic and the [ABAP Dictionary cheat sheet](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/26_ABAP_Dictionary.md).

## Quick Reference

| Need | Syntax | See |
|---|---|---|
| Integer | `TYPE i` (4-byte), `TYPE int8` (8-byte) | §elementary |
| Exact decimal (money, qty) | `TYPE p LENGTH n DECIMALS d` | §elementary |
| Decimal floating point | `TYPE decfloat16` / `TYPE decfloat34` | §elementary |
| Binary float (math) | `TYPE f` | §elementary |
| Fixed text | `TYPE c LENGTH n` | §elementary |
| Digit string (leading zeros) | `TYPE n LENGTH n` | §elementary |
| Variable text | `TYPE string` | §elementary |
| Bytes | `TYPE x LENGTH n` (fixed) / `TYPE xstring` (variable) | §elementary |
| Date / time / timestamp | `TYPE d` / `TYPE t` / `TYPE utclong` | §elementary |
| Standalone type | `TYPES t_x TYPE …` | §types-vs-data |
| Data object | `DATA lv_dobj TYPE … [VALUE …]` | §types-vs-data |
| Inline object | `DATA(lv_amount) = …` / `FINAL(lv_amount) = …` | §types-vs-data |
| Derive from object/line | `LIKE lv_dobj` / `LIKE LINE OF lt_itab` / `TYPE LINE OF tabtype` | §types-vs-data |
| Structure | `TYPES/DATA: BEGIN OF s, … END OF s.` | §structures |
| Copy same-named components | `MOVE-CORRESPONDING a TO b.` / `b = CORRESPONDING #( a ).` | §structure-ops |
| Include flat components | `INCLUDE TYPE t.` / `INCLUDE STRUCTURE s.` | §structure-ops |
| Internal table type | `TYPES tt TYPE STANDARD TABLE OF line WITH …KEY` | §internal-tables |
| Data reference | `TYPE REF TO data` / `TYPE REF TO type` | §references |
| Point a ref at an object | `lr_dref = REF #( lv_dobj ).` | §references |
| Read through a ref | `lr_dref->*` (whole) / `lr_dref->comp` (component) | §references |
| Anonymous object | `NEW type( … )` / `CREATE DATA lr_dref TYPE …` | §references |
| Constant | `CONSTANTS c_max_retries TYPE … VALUE …` | §constants |
| Generic parameter/field symbol | `TYPE any` / `data` / `clike` / `numeric` / `any table` … | §generic |
| Enumerated type | `TYPES: BEGIN OF ENUM t … END OF ENUM t.` | §enum |
| Ranges table | `TYPE RANGE OF type` | §ranges |
| Bit/byte ops | `GET BIT` / `SET BIT` / `BIT-AND`/`-OR`/`-XOR`/`-NOT` | §bits |

Full built-in and generic type tables: [references/types-catalog.md](references/types-catalog.md). Structure deep-dive: [references/structures.md](references/structures.md).

## Elementary types {#elementary}

Elementary (scalar) types are built directly on ABAP's built-in types. They split into **fixed length** (length and memory fixed at declaration) and **variable length** (`string`, `xstring` — grow with content at runtime).

```abap
"Numeric types
TYPES ty_i      TYPE i.                      "4-byte integer
TYPES ty_int8   TYPE int8.                   "8-byte integer
TYPES ty_decfl16 TYPE decfloat16.            "decimal floating point, 16 places
TYPES ty_decfl34 TYPE decfloat34.            "decimal floating point, 34 places
TYPES ty_f      TYPE f.                       "binary floating point
TYPES ty_p_l4_d2 TYPE p LENGTH 4 DECIMALS 2. "packed number, exact decimals

"Character-like types
TYPES ty_c5  TYPE c LENGTH 5.   "fixed-length text field
TYPES ty_n4  TYPE n LENGTH 4.   "numeric text (digits, leading zeros)
TYPES ty_str TYPE string.       "variable-length text string

"Byte-like types
TYPES ty_x_l2 TYPE x LENGTH 2.  "fixed-length byte field
TYPES ty_xstr TYPE xstring.     "variable-length byte string

"Date and time types
TYPES ty_d   TYPE d.        "date field, 8 chars YYYYMMDD
TYPES ty_t   TYPE t.        "time field, 6 chars HHMMSS
TYPES ty_utc TYPE utclong.  "time stamp (UTC)
```

**Picking the numeric type** (see [references/types-catalog.md](references/types-catalog.md) for ranges):
- `i` / `int8` — counters, indices, IDs. No decimals.
- `p LENGTH n DECIMALS d` — money and quantities. **Exact** decimal arithmetic; use for anything financial.
- `decfloat16` / `decfloat34` — "more modern versions of `p` and `f`, combining their advantages." Wide range and exact decimal representation.
- `f` — scientific/engineering math where binary floating point rounding is acceptable. Avoid for currency.

**Generic-with-respect-to-length.** The types `c`, `n`, `x`, and `p` are *generic* in their length; `p` is also generic in `DECIMALS`. In ABAP Objects contexts you **must** specify `LENGTH` (and `DECIMALS` for `p`). The length-in-parentheses form (`ty_c(4) TYPE c`) works but `LENGTH` is recommended.

```abap
TYPES ty_cfour(4) TYPE c.   "works, but prefer LENGTH
TYPES ty_c5 TYPE c LENGTH 5. "recommended
```

**`b` and `s`** (1- and 2-byte integers) cannot be written directly in ABAP programs. Use the built-in DDIC types `int1` and `int2` to get their value ranges.

```abap
TYPES ty_int1 TYPE int1.
TYPES ty_int2 TYPE int2.
```

If you write `DATA lv_do_c.` with no `TYPE`/`LIKE`, you get the bound type `c LENGTH 1`.

## TYPES vs DATA {#types-vs-data}

`TYPES` declares a standalone **type** (a description, no memory). `DATA` declares a **data object** (typed, occupies memory). They share the same syntax; `DATA` additionally supports `VALUE`.

```abap
"Standalone type, then an object of that type
TYPES ty_string TYPE string.
DATA  lv_str    TYPE ty_string.

"VALUE sets a start value (DATA only); without it, the type-specific initial value applies
DATA lv_i_val   TYPE i VALUE 123.
DATA lv_c_l2    TYPE c LENGTH 2 VALUE 'hi'.
DATA lv_i_init  TYPE i VALUE IS INITIAL.   "explicit initial value

"VALUE can take a constant
CONSTANTS c_con TYPE string VALUE `abcdef`.
DATA lv_val_con TYPE string VALUE c_con.

"READ-ONLY is allowed only for class attributes (public, set inside the class only)
"CLASS-DATA mv_read_only_attribute TYPE string VALUE `Hallo` READ-ONLY.
```

**Deriving types from existing types / objects:**

```abap
TYPES ty_another_i TYPE ty_i.        "from an existing type
DATA  lv_num TYPE i.
TYPES ty_from_int  LIKE lv_num.      "from an existing data object
DATA  lv_like_dobj LIKE lv_i.        "object LIKE object

"From an internal table's line type
TYPES ty_line  TYPE LINE OF tt_w_like.
DATA  ls_line   LIKE LINE OF lt_itab_local_ts.
```

**Inline declaration** — declare at the operand position where you need the object; the type is derived statically from the right-hand side. Use `FINAL(...)` for an [immutable variable](references/structures.md) (one assignment, then read-only).

```abap
DATA(lv_str_b3) = `ghi`.        "type string (backquote literal)
DATA(lv_c_l3)   = 'jkl'.        "type c LENGTH 3 (quote literal)
DATA(ls_struc)  = VALUE ts_struc( comp1 = 1 comp2 = `A` ).
FINAL(lv_final_inl) = 1.     "immutable; lv_final_inl = 2. would be an error

SELECT SINGLE carrid, carrname FROM zdemo_abap_carr INTO @DATA(ls_struc_b5).  "target created inline
LOOP AT lt_itab INTO DATA(ls_wa).
  ...
ENDLOOP.
```

Inline declaration cannot be used when the call is itself an expression on the right-hand side, e.g. `DATA(lv_result) = meth( IMPORTING p = DATA(lv_param) ).` is **not** possible.

For value-assignment and conversion rules between elementary types (rounding, overflow, `EXACT #( )` lossless checks, the exceptions `cx_sy_conversion_no_number` / `_overflow` / `_rounding` / `_data_loss`), see [references/types-catalog.md](references/types-catalog.md).

## Structures {#structures}

A structure is a data object with a structured type — a sequence of components of any type. Declare with `BEGIN OF … END OF …` after `TYPES` (type) or `DATA` (object).

```abap
"Structured type
TYPES: BEGIN OF ty_addr,
         name   TYPE string,
         street TYPE string,
         city   TYPE string,
       END OF ty_addr.

"Structure (object), with start values
DATA: BEGIN OF ls_struc,
        comp1 TYPE i VALUE 1,
        comp2 TYPE string VALUE `hi`,
        comp3 TYPE i VALUE IS INITIAL,
      END OF ls_struc.
```

**Flat vs nested vs deep** (this distinction drives assignment, comparison, and DB compatibility):
- **Flat** — only fixed-length elementary components. Nesting alone does not make it deep.
- **Nested** — at least one component is itself a structure (substructure).
- **Deep** — contains at least one internal table, reference, or **`string`/`xstring`**. (A structure of only `string` components is already deep.)

Access components with the structure component selector `-`; chain for nesting:

```abap
ls_struc-comp1 = 1.
DATA(lv_title) = ls_address_n-name-title.   "nested
```

For all structure topics — nested/deep declaration, `VALUE … BASE`, nesting `VALUE` operators, `INCLUDE TYPE`/`INCLUDE STRUCTURE` with `AS`/`RENAMING WITH SUFFIX`, BDEF-derived types, boxed components, dynamic component access — see [references/structures.md](references/structures.md).

## Structure operations {#structure-ops}

**Whole-structure assignment** copies all components (special conversion/comparison rules apply for incompatible types):

```abap
ls_some_struc = ls_another_struc.
DATA(ls_struc_inl) = ls_some_struc.    "inline: type derived, content copied
```

**`MOVE-CORRESPONDING` / `CORRESPONDING #( )`** copy *identically named* components — use when source and target have different types or differently-named components.

```abap
"Statement: moves same-named comps; keeps other target comps
MOVE-CORRESPONDING ls_struc TO ls_diff_struc.

"Operator: initializes target, then moves same-named comps
ls_diff_struc = CORRESPONDING #( ls_struc ).

"BASE keeps existing target content (like MOVE-CORRESPONDING)
ls_diff_struc = CORRESPONDING #( BASE ( ls_diff_struc ) ls_struc ).

"MAPPING: map differently-named components
ls_diff_struc = CORRESPONDING #( ls_struc MAPPING comp1 = compa ).

"EXCEPT: exclude components from the assignment
ls_diff_struc = CORRESPONDING #( ls_struc EXCEPT comp1 ).
```

For deep structures there are additional variants (`EXPANDING NESTED TABLES`, `KEEPING TARGET LINES`, `CORRESPONDING #( DEEP … )`, `APPENDING BASE`, `DEEP APPENDING BASE`) — full table in [references/structures.md](references/structures.md).

**Clearing:** `CLEAR ls_struc.` resets to initial; `FREE ls_struc.` additionally releases memory; `ls_struc = VALUE #( ).` also clears.

## Internal table types {#internal-tables}

Internal tables are a complex type — a sequence of lines of one row type, plus a table category and key. Declare the type with `TABLE OF`.

```abap
TYPES tt_int    TYPE STANDARD TABLE OF i WITH EMPTY KEY.
TYPES tt_struc  TYPE TABLE OF ts_misc_comps WITH EMPTY KEY.   "STANDARD is implicit
TYPES tt_w_like LIKE lt_itab_local_ts.                           "from an existing table
DATA  lt_itab      TYPE tt_struc.
```

This skill covers only **declaring** table types and deriving structures from them (`TYPE LINE OF`, `LIKE LINE OF`). For table categories (STANDARD/SORTED/HASHED), keys, and all access/modify operations, see **[abap-internal-tables](../abap-internal-tables/SKILL.md)**.

## Data references {#references}

A reference type (`REF TO`) describes a variable that points to another object. There are no built-in reference types — you define them. The only generic types allowed after `REF TO` are `data` (data references) and `object` (object references); both count as *complete* typing.

```abap
"Declaring data reference variables
DATA lr_int  TYPE REF TO i.
DATA lr_str  TYPE REF TO string.
DATA lr_data TYPE REF TO data.   "generic static type

"Point a reference at an existing data object — use the REF operator
DATA lv_number TYPE i VALUE 987.
lr_int  = REF #( lv_number ).
lr_data = REF #( lv_number ).    "static type generic, dynamic type i

"REF # in inline declarations
DATA(lr_i) = REF #( lv_number ).
```

> `GET REFERENCE OF lv_dobj INTO lr_dref.` does the same as `REF #( )` but is obsolete — **do not use it**, especially in ABAP for Cloud Development. Prefer `REF #( )`.

**Dereferencing** with `->*` reads/writes the referenced object; `->comp` reaches a structure component.

```abap
lr_str->* = `hi`.            "whole object
DATA(lv_val)   = lr_i->*.
lr_struc->comp1 = 1.          "structure component (object component selector)
lr_struc->*-comp1 = 1.        "equivalent, less convenient
```

**Up/downcast** between reference variables:
- **Upcast** (target more general / identical): assignment operator `=`. Works when types match, or the source is completely typed and the target is generic.
- **Downcast** (target more specific): must be explicit with `CAST #( )` (or the older `?=`); checked at runtime, can raise `cx_sy_move_cast_error`.

```abap
lr_data = lr_int.            "upcast: i -> data
lr_int  = CAST #( lr_data ). "downcast: needs CAST; runtime-checked
TRY.
    lr_str = CAST #( lr_data ).  "fails if dynamic type isn't string
  CATCH cx_sy_move_cast_error INTO DATA(lo_cast_error).
ENDTRY.
```

**Anonymous data objects** are unnamed, created at runtime, addressed only through a reference. Use `NEW` (an expression, allows value assignment) or `CREATE DATA` (a statement, many additions).

```abap
"NEW operator
DATA(lr_11_i) = NEW i( 32 ).                  "type explicit
lr_10_i = NEW #( 653 ).                        "# when type derivable
DATA(lr_struc) = NEW zdemo_abap_carr( carrid = 'AB' carrname = 'AB Airlines' ).

"CREATE DATA statement
DATA lr_8 TYPE REF TO data.
CREATE DATA lr_8 TYPE p LENGTH 8 DECIMALS 3.
lr_8->* = 1 / 3.
CREATE DATA lr_8 LIKE lt_it.                       "LIKE an existing object
CREATE DATA lr_8 TYPE HASHED TABLE OF zdemo_abap_carr WITH UNIQUE KEY carrid.

"NEW addition in SELECT creates an anonymous object inline
SELECT carrid, carrname FROM zdemo_abap_carr INTO TABLE NEW @DATA(lr_14_inline).
```

## Generic types {#generic}

Generic types do not fix all properties; they may type only **formal parameters of methods** and **field symbols**. The actual type is taken from the actual parameter / assigned memory area at runtime.

```abap
FIELD-SYMBOLS:
  <fv_data>      TYPE data,      "any type
  <fv_any>       TYPE any,       "any type
  <fv_c>         TYPE c,         "text field, generic length
  <fv_clike>     TYPE clike,     "c, n, string, d, t, character-like flat structures
  <fv_csequence> TYPE csequence, "c, string
  <fv_n>         TYPE n,         "numeric text, generic length
  <fv_x>         TYPE x,         "byte field, generic length
  <fv_xsequence> TYPE xsequence, "x, xstring
  <fv_decfloat>  TYPE decfloat,  "decfloat16, decfloat34
  <fv_numeric>   TYPE numeric,   "(b, s,) i, int8, p, decfloat16, decfloat34, f
  <fv_p>         TYPE p,         "packed, generic length and decimals
  <ft_any_table>      TYPE ANY TABLE,
  <ft_index_table>    TYPE INDEX TABLE,
  <ft_sorted_table>   TYPE SORTED TABLE,
  <ft_standard_table> TYPE STANDARD TABLE,
  <ft_hashed_table>   TYPE HASHED TABLE,
  <ft_table>          TYPE table,   "standard table
  <fv_simple>    TYPE simple.    "elementary (incl. enums) + char-like flat structures
```

Rule of thumb (Clean ABAP): **no generic typing in public APIs** — it pushes type-checking to runtime. Use generics only in framework/dynamic code. The full generic catalog with which concrete types each accepts is in [references/types-catalog.md](references/types-catalog.md).

## Constants and immutable variables {#constants}

`CONSTANTS` declares a named object whose value cannot change at runtime — `VALUE` is **mandatory**. `FINAL(...)` declares an immutable variable inline (one assignment, then read-only).

```abap
CONSTANTS c_con_str TYPE string VALUE `hallo`.

CONSTANTS: BEGIN OF c_const_struct,
             int  TYPE i        VALUE 1,
             char TYPE c LENGTH 4 VALUE 'ABAP',
           END OF c_const_struct.   "usage: c_const_struct-char

FINAL(lv_final) = 1.   "lv_final = 2. -> error
LOOP AT lt_itab INTO FINAL(ls_wa).   "ls_wa read-only inside the loop body
  APPEND ls_wa TO lt_other_itab.
ENDLOOP.
```

Group related constants under `BEGIN OF … END OF …` (or in an interface) so the meaning lives at the call site — see [abap-clean-style](../abap-clean-style/SKILL.md) §constants.

## Enumerated types {#enum}

Enumerated types mix a type with a fixed value set. The default base type is `i` (values counted from 0); you may supply an explicit `BASE TYPE` (flat, elementary, max 16 bytes) where one value must be initial. An optional enumerated `STRUCTURE` groups the constants.

```abap
"Default base type i: a->0, b->1, c->2, d->3
TYPES: BEGIN OF ENUM ty_enum,
         a, b, c, d,
       END OF ENUM ty_enum.

"Explicit base type with start values (one must be initial)
TYPES: ty_basetype TYPE c LENGTH 2,
       BEGIN OF ENUM ty_enum_base BASE TYPE ty_basetype,
         e VALUE IS INITIAL,
         f VALUE 'u',
         g VALUE 'v',
       END OF ENUM ty_enum_base.

DATA  lv_dobj_enum TYPE ty_enum.
lv_dobj_enum = a.                       "only enum values are assignable
DATA(lv_base_b) = CONV i( b ).          "1
```

Prefer the default integer base type unless you are migrating existing non-enum constants. Enumerated objects are mainly used to restrict allowed values (e.g. method parameters).

## Ranges tables {#ranges}

A ranges table is an internal table with the predefined columns `SIGN`, `OPTION`, `LOW`, `HIGH`, declared with `TYPE RANGE OF`. Each row is one comparison, evaluated together via the `IN` operator.

```abap
DATA lt_carrid_range TYPE RANGE OF zdemo_abap_carr-carrid.
lt_carrid_range = VALUE #( ( sign = 'I' option = 'EQ' low = 'LH' )
                        ( sign = 'I' option = 'BT' low = 'AA' high = 'DL' ) ).
"... WHERE carrid IN @lt_carrid_range
```

More detail in [abap-internal-tables](../abap-internal-tables/SKILL.md).

## Bit and byte operations {#bits}

A data object is a sequence of bytes; only for byte-like types (`x`/`xstring`) does the value equal the hexadecimal content directly. These statements process byte strings only.

- `GET BIT pos OF byte_string INTO value.` — read the bit at `pos` into a target.
- `SET BIT pos OF byte_string [TO value].` — set the bit at `pos` (to 1 by default, or 0/1 after `TO`). Built-in `bit-set` is an alternative.
- Bit operators on byte fields: `BIT-AND`, `BIT-OR`, `BIT-XOR`, `BIT-NOT`.

```abap
DATA lv_hex TYPE x LENGTH 4 VALUE 'CDFFC8FF'.
lv_hex = BIT-NOT lv_hex.                       "bitwise complement

DATA(lv_xstr) = cl_abap_conv_codepage=>create_out( )->convert( `Hello ABAP` ).
GET BIT sy-index OF lv_xstr INTO DATA(lv_bit). "read one bit

DATA lv_hex_val TYPE x LENGTH 1.
SET BIT 3 OF lv_hex_val.        "set bit 3 to 1
SET BIT 3 OF lv_hex_val TO 0.   "set bit 3 to 0
```

Casting the *same* bytes through differently-typed field symbols (`ASSIGN lv_hex TO <fv_num> CASTING`) shows the type, not the bytes, decides the value. For string/xstring processing (`SET BIT`/`GET BIT` context, conversions) see [abap-strings-regex](../abap-strings-regex/SKILL.md).

## Common Mistakes

| Mistake | Why it hurts | Fix |
|---|---|---|
| `TYPE p` without `LENGTH`/`DECIMALS` in a class | Syntax error in ABAP Objects (`p`/`c`/`n`/`x` are generic) | `TYPE p LENGTH 8 DECIMALS 2` |
| `TYPE f` for money | Binary float rounding corrupts currency | `TYPE p LENGTH n DECIMALS d` or `decfloat34` |
| Assuming a `string`-only structure is flat | It is **deep**; breaks DB work areas and some comparisons | Use fixed-length `c`/`n` for flat needs |
| `MOVE-CORRESPONDING` between unrelated structures expecting all fields | Only *same-named* components move | Add `MAPPING`, or check names |
| `CORRESPONDING #( a )` when you wanted to keep target fields | It initializes the target first | `CORRESPONDING #( BASE ( b ) a )` |
| `GET REFERENCE OF lv_dobj INTO lr_dref.` | Obsolete, flagged in ABAP Cloud | `lr_dref = REF #( lv_dobj ).` |
| Forgetting `->*` when reading a data reference | `lr_dref` is the reference, not the value | `lr_dref->*` (whole) / `lr_dref->comp` |
| Downcast with `=` | Compile error / no narrowing | `CAST #( )` (runtime-checked) |
| `TYPE ANY` in a public method signature | Defers type errors to runtime, burdens caller | Concrete type; generics only in framework code |
| `CONSTANTS max_retries TYPE i.` without `VALUE` | `VALUE` is mandatory for constants | `CONSTANTS c_max_retries TYPE i VALUE 0.` |
| Length in parentheses `lv_do(4) TYPE c` | Discouraged form | `lv_do TYPE c LENGTH 4` |
| Reading `sy-*` fields freely in ABAP Cloud | Most are Standard-ABAP only (syntax warning) | Use only `sy-subrc`, `sy-tabix`, `sy-index` |

## References

- **ABAP cheat sheets (ground truth):**
  - [16_Data_Types_and_Objects.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/16_Data_Types_and_Objects.md)
  - [02_Structures.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/02_Structures.md)
  - [09_Bits_and_Bytes.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/09_Bits_and_Bytes.md)
- **ABAP Keyword Documentation:** [Built-in ABAP types](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abenbuilt_in_types.htm), [Type hierarchy](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abentype_hierarchy.htm), [Assignment and conversion rules](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abenconversion_rules.htm)
- **Local references:** [references/types-catalog.md](references/types-catalog.md) (built-in + generic type tables, conversion rules), [references/structures.md](references/structures.md) (structure deep-dive)
- **Related skills:** [abap-internal-tables](../abap-internal-tables/SKILL.md), [abap-constructor-expressions](../abap-constructor-expressions/SKILL.md), [abap-strings-regex](../abap-strings-regex/SKILL.md), [abap-dynamic-programming](../abap-dynamic-programming/SKILL.md), [abap-clean-style](../abap-clean-style/SKILL.md), abap-dictionary-ddic
