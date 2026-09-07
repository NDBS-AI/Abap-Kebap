# ABAP Type Catalog

Built-in elementary types, generic types, and conversion behaviour. Ground truth: [16_Data_Types_and_Objects.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/16_Data_Types_and_Objects.md) and the ABAP Keyword Documentation [Built-in ABAP types](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abenbuilt_in_types.htm). Always confirm exact lengths/ranges with the F2 info in ADT for your system.

## Built-in elementary types

Two families: **fixed length** (length and memory fixed at declaration) and **variable length** (`string`, `xstring` — grow with content).

| Type | Kind | Length (standard / range) | Initial value | Typical use |
|---|---|---|---|---|
| `i` | numeric, fixed | 4 bytes | `0` | Integers, counters, indices, IDs. Value range approx. −2,147,483,648 … +2,147,483,647 |
| `int8` | numeric, fixed | 8 bytes | `0` | Large integers beyond `i`'s range |
| `b` | numeric, fixed | 1 byte | `0` | 1-byte int — **not declarable directly**; use DDIC type `int1` (0 … 255) |
| `s` | numeric, fixed | 2 bytes | `0` | 2-byte int — **not declarable directly**; use DDIC type `int2` |
| `p` | numeric, fixed | 1–16 bytes (`LENGTH`), 0–14 `DECIMALS` | `0` | **Packed/exact decimal** — money, quantities. Generic in length and decimals |
| `decfloat16` | numeric, fixed | 8 bytes, 16 significant digits | `0` | Decimal floating point — modern successor combining `p`/`f` advantages |
| `decfloat34` | numeric, fixed | 16 bytes, 34 significant digits | `0` | Decimal floating point, widest precision |
| `f` | numeric, fixed | 8 bytes (binary float, up to 17 mantissa digits: 1 before + 16 after the decimal point) | `0` | Scientific/engineering math; **not** for currency (binary rounding) |
| `c` | character, fixed | 1–262143 chars (`LENGTH`), std 1 | `' '` (blanks) | Fixed-length text. Generic in length |
| `n` | character, fixed | 1–262143 chars (`LENGTH`), std 1 | `'0…0'` (zeros) | Numeric text (digit strings, leading zeros preserved) |
| `d` | character, fixed | 8 chars, `YYYYMMDD` | `'00000000'` | Date. Character-like but usable in calculations |
| `t` | character, fixed | 6 chars, `HHMMSS` | `'000000'` | Time. Character-like but usable in calculations |
| `string` | character, variable | unlimited | empty string `` `` `` | Variable-length text. Deep when a structure component |
| `x` | byte, fixed | 1–524287 bytes (`LENGTH`), std 1 | `00…` | Fixed-length byte field / raw bytes |
| `xstring` | byte, variable | unlimited | empty | Variable-length byte string. Deep when a structure component |
| `utclong` | time stamp, fixed | 8 bytes | initial UTC stamp | UTC time stamp (`utclong`) |

Notes from the cheat sheet:
- `c`, `n`, `x`, and `p` are **incomplete (generic) in length** — they need the `LENGTH` addition; `p` is also generic in `DECIMALS`. In ABAP Objects you **must** specify `LENGTH` (and `DECIMALS` for `p`).
- The other types are **complete** — no extra syntax needed.
- `decfloat16`/`decfloat34` are "more modern versions of `p` and `f`, combining their advantages."
- `b` and `s` cannot be written in ABAP programs; reference the built-in DDIC types `int1`/`int2` to obtain their value ranges.
- `d` and `t` are character-like yet can be used for calculations.
- `string`/`xstring` (and references, internal tables) make a containing structure **deep**.

### Declaration patterns

```abap
"Pattern: TYPES|DATA name TYPE some_type [LENGTH len] [DECIMALS dec] [VALUE val].
DATA lv_i        TYPE i.
DATA lv_int8     TYPE int8.
DATA lv_p_l8_d2  TYPE p LENGTH 8 DECIMALS 2.
DATA lv_decfl34  TYPE decfloat34.
DATA lv_f        TYPE f.
DATA lv_c_l5     TYPE c LENGTH 5.
DATA lv_n_l4     TYPE n LENGTH 4.
DATA lv_str      TYPE string.
DATA lv_x_l2     TYPE x LENGTH 2.
DATA lv_xstr     TYPE xstring.
DATA lv_d        TYPE d.
DATA lv_t        TYPE t.
DATA lv_utc      TYPE utclong.

"Standard length applies if LENGTH is omitted for c, n, p, x (check F2 info)
DATA lv_c_std    TYPE c.   "c LENGTH 1
DATA lv_p_std    TYPE p.

"No TYPE/LIKE at all -> bound type c LENGTH 1
DATA lv_c.
```

### Built-in DDIC types worth knowing

These are DDIC data elements usable as types in ABAP programs (selection from the cheat sheet examples):

| DDIC type | Meaning |
|---|---|
| `int1` / `int2` | value ranges of the 1-/2-byte integers `b` / `s` |
| `abap_bool` / `abap_boolean` | flag of type `c LENGTH 1`; constants `abap_true` (`'X'`), `abap_false` (`' '`) |
| `timestamp` / `timestampl` | packed time stamps (short / long with fractional seconds) |

## Type pools

- A **type pool** is an ABAP program administered by the ABAP Dictionary holding globally visible types and constants.
- Creating new type pools is **only possible in Standard ABAP and is considered obsolete** — not available in ABAP for Cloud Development.
- The predefined type pool **`abap`** *can* be used in ABAP for Cloud Development (e.g. `abap_bool`, `abap_true`).

```abap
TYPES ty_tp TYPE abap_bool.
TYPES ty_const_in_tp LIKE abap_true.
```

For modern global types, use DDIC data elements / structures / table types or CDS instead — see abap-dictionary-ddic.

## Generic types

Generic types do not fix all properties. They may type **only** formal parameters of methods and field symbols; the concrete type is taken from the actual parameter / assigned memory at runtime.

| Generic type | Accepts (concrete types) |
|---|---|
| `any` | any data type |
| `data` | any data type |
| `c` | text field `c` of generic length |
| `n` | numeric text `n` of generic length |
| `x` | byte field `x` of generic length |
| `p` | packed number of generic length and decimals |
| `clike` | character-like: `c`, `n`, `string`, `d`, `t`, and character-like flat structures |
| `csequence` | text-like: `c`, `string` |
| `xsequence` | byte-like: `x`, `xstring` |
| `numeric` | numeric: (`b`, `s`,) `i`, `int8`, `p`, `decfloat16`, `decfloat34`, `f` |
| `decfloat` | `decfloat16`, `decfloat34` |
| `simple` | elementary (incl. enumerated types) + structures with exclusively character-like flat components |
| `table` | standard table |
| `any table` | internal table of any table type |
| `index table` | index tables (standard + sorted) |
| `standard table` | standard tables |
| `sorted table` | sorted tables |
| `hashed table` | hashed tables |

After `TYPE REF TO`, the only generic types allowed are `data` (data references) and `object` (object references); both count as *complete* typing.

```abap
FIELD-SYMBOLS <fv_numeric> TYPE numeric.
ASSIGN ls_s-int   TO <fv_numeric>.   "ok: i is numeric
ASSIGN ls_s-pl4d2 TO <fv_numeric>.   "ok: p is numeric
"ASSIGN ls_s-n4  TO <fv_numeric>.    "not ok: n is not numeric (it is character-like)

FIELD-SYMBOLS <fv_clike> TYPE clike.
ASSIGN ls_s-c10  TO <fv_clike>.      "ok
ASSIGN ls_s-str  TO <fv_clike>.      "ok
ASSIGN ls_s-date TO <fv_clike>.      "ok (d is character-like)

FIELD-SYMBOLS <ft_index_table> TYPE INDEX TABLE.
ASSIGN ls_s-tab_std TO <ft_index_table>.  "ok: standard table is an index table
ASSIGN ls_s-tab_so  TO <ft_index_table>.  "ok: sorted table is an index table
"ASSIGN ls_s-tab_ha TO <ft_index_table>.  "not ok: hashed table is not an index table
```

Clean ABAP: avoid generic typing in public APIs; restrict it to framework / dynamic code.

## Conversion rules when assigning elementary data objects

When source and target types differ, ABAP applies conversion rules. Selected behaviour from the cheat sheet ([Assignment and Conversion Rules](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abenconversion_rules.htm)):

**Character/string source → numeric target.** The source must contain a number (mathematical, commercial, or scientific notation depending on the target). Blanks → `0`. Decimals are rounded automatically.

```abap
DATA lv_c5  TYPE c LENGTH 5.
DATA lv_num TYPE i.
lv_c5  = '1.567'.
lv_num = lv_c5.          "2 (rounded)
lv_c5  = '   '.
lv_num = lv_c5.          "0
```

**Errors raised on bad numeric conversion:**

| Exception | When |
|---|---|
| `cx_sy_conversion_no_number` | source cannot be interpreted as a number (e.g. `'abc'`, `'11111111#'`, scientific notation into `i`) |
| `cx_sy_conversion_overflow` | the number is outside the target's value range |
| `cx_sy_conversion_rounding` | a calculation/assignment needs rounding under `EXACT #( )` |
| `cx_sy_conversion_data_loss` | an assignment would truncate data under `EXACT #( )` |

```abap
lv_c5 = 'abc'.
TRY.
    lv_i = lv_c5.
  CATCH cx_sy_conversion_no_number INTO DATA(lo_error).
    DATA(lv_txt) = lo_error->get_text( ).   "Cannot be interpreted as a number
ENDTRY.
```

**Lossless assignment with `EXACT #( )`** raises rather than silently truncating/rounding:

```abap
TRY.
    lv_c5 = '1.567'.
    lv_i = EXACT #( lv_c5 ).            "rounding needed -> cx_sy_conversion_rounding
  CATCH cx_sy_conversion_rounding INTO lo_error.
ENDTRY.

DATA lv_c30 TYPE c LENGTH 30.
TRY.
    lv_c30 = 'abcdefghijklmn'.
    lv_c5 = EXACT #( lv_c30 ).          "truncation -> cx_sy_conversion_data_loss
  CATCH cx_sy_conversion_data_loss INTO lo_error.
ENDTRY.
```

**Character target rules (summary):**
- `c` ← left-aligned; truncate if target shorter, pad blanks if longer. From `string`, trailing blanks are retained.
- `n` ← only digits kept, right-aligned; pad `0` if target longer, truncate (right-aligned) if shorter.
- `string` ← passed including leading blanks, excluding trailing blanks.

```abap
DATA lv_c3 TYPE c LENGTH 3.
DATA lv_n5 TYPE n LENGTH 5.
lv_c5 = 'abcde'.   lv_c3 = lv_c5.   "abc
lv_c5 = '3#4#5'.   lv_n5 = lv_c5.   "00345  (non-digits ignored, right-aligned, zero-padded)
```

**Compatibility:** if source and target types are *compatible*, content is copied unchanged; if incompatible but a conversion rule exists, content is converted. Deep structures need careful compatibility checks (see [structures.md](structures.md)).

## Casting vs conversion (bits and bytes)

- **Casting** treats the same memory under a different type (via field symbols with `... CASTING`). The bytes are unchanged; the *type* decides the value.
- **Conversion** changes the actual bytes so the value's meaning is preserved across types.

```abap
DATA lv_hex TYPE x LENGTH 4 VALUE '32003700'.
FIELD-SYMBOLS <fv_num>  TYPE i.
FIELD-SYMBOLS <fv_text> TYPE c.
ASSIGN lv_hex TO <fv_num>  CASTING.   "same bytes read as i    -> 3604530
ASSIGN lv_hex TO <fv_text> CASTING.   "same bytes read as text -> 27
```

## Typed literals in ABAP SQL

A typed literal fixes its type via a built-in DDIC type prefix; preferred over untyped literals for type safety, fewer implicit conversions, and readability.

```abap
SELECT SINGLE FROM zdemo_abap_fli FIELDS *
  WHERE fldate = datn`20240102`            "typed (preferred)
  INTO @DATA(ls_wa).

"Examples of typed literals: char`X`, int8`32984723948723`, raw`11`,
"numc`1234`, utclong`2024-01-01T10:01:02,2`, tims`101507`, curr`173.95`, datn`20240102`
```

## TYPES ... WITH INDICATORS

For ABAP SQL `UPDATE` with set indicators — update specific fields without overwriting others.

```abap
TYPES ty_ind_wa TYPE dbtab WITH INDICATORS comp_ind TYPE abap_bool.
DATA lt_ind_tab TYPE TABLE OF ty_ind_wa.
lt_ind_tab = VALUE #( ( comp1 = ... comp2 = ... comp_ind-comp2 = abap_true ) ).
UPDATE dbtab FROM TABLE @lt_ind_tab INDICATORS SET STRUCTURE comp_ind.
"Reversed logic:
UPDATE dbtab FROM TABLE @lt_ind_tab INDICATORS NOT SET STRUCTURE comp_ind.
```
