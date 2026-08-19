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
DATA do_i        TYPE i.
DATA do_int8     TYPE int8.
DATA do_p_l8_d2  TYPE p LENGTH 8 DECIMALS 2.
DATA do_decfl34  TYPE decfloat34.
DATA do_f        TYPE f.
DATA do_c_l5     TYPE c LENGTH 5.
DATA do_n_l4     TYPE n LENGTH 4.
DATA do_str      TYPE string.
DATA do_x_l2     TYPE x LENGTH 2.
DATA do_xstr     TYPE xstring.
DATA do_d        TYPE d.
DATA do_t        TYPE t.
DATA do_utc      TYPE utclong.

"Standard length applies if LENGTH is omitted for c, n, p, x (check F2 info)
DATA do_c_std    TYPE c.   "c LENGTH 1
DATA do_p_std    TYPE p.

"No TYPE/LIKE at all -> bound type c LENGTH 1
DATA do_c.
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
TYPES te_tp TYPE abap_bool.
TYPES te_const_in_tp LIKE abap_true.
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
FIELD-SYMBOLS <numeric> TYPE numeric.
ASSIGN s-int   TO <numeric>.   "ok: i is numeric
ASSIGN s-pl4d2 TO <numeric>.   "ok: p is numeric
"ASSIGN s-n4  TO <numeric>.    "not ok: n is not numeric (it is character-like)

FIELD-SYMBOLS <clike> TYPE clike.
ASSIGN s-c10  TO <clike>.      "ok
ASSIGN s-str  TO <clike>.      "ok
ASSIGN s-date TO <clike>.      "ok (d is character-like)

FIELD-SYMBOLS <index_table> TYPE INDEX TABLE.
ASSIGN s-tab_std TO <index_table>.  "ok: standard table is an index table
ASSIGN s-tab_so  TO <index_table>.  "ok: sorted table is an index table
"ASSIGN s-tab_ha TO <index_table>.  "not ok: hashed table is not an index table
```

Clean ABAP: avoid generic typing in public APIs; restrict it to framework / dynamic code.

## Conversion rules when assigning elementary data objects

When source and target types differ, ABAP applies conversion rules. Selected behaviour from the cheat sheet ([Assignment and Conversion Rules](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abenconversion_rules.htm)):

**Character/string source → numeric target.** The source must contain a number (mathematical, commercial, or scientific notation depending on the target). Blanks → `0`. Decimals are rounded automatically.

```abap
DATA c5  TYPE c LENGTH 5.
DATA num TYPE i.
c5  = '1.567'.
num = c5.          "2 (rounded)
c5  = '   '.
num = c5.          "0
```

**Errors raised on bad numeric conversion:**

| Exception | When |
|---|---|
| `cx_sy_conversion_no_number` | source cannot be interpreted as a number (e.g. `'abc'`, `'11111111#'`, scientific notation into `i`) |
| `cx_sy_conversion_overflow` | the number is outside the target's value range |
| `cx_sy_conversion_rounding` | a calculation/assignment needs rounding under `EXACT #( )` |
| `cx_sy_conversion_data_loss` | an assignment would truncate data under `EXACT #( )` |

```abap
c5 = 'abc'.
TRY.
    i = c5.
  CATCH cx_sy_conversion_no_number INTO DATA(error).
    DATA(txt) = error->get_text( ).   "Cannot be interpreted as a number
ENDTRY.
```

**Lossless assignment with `EXACT #( )`** raises rather than silently truncating/rounding:

```abap
TRY.
    c5 = '1.567'.
    i = EXACT #( c5 ).            "rounding needed -> cx_sy_conversion_rounding
  CATCH cx_sy_conversion_rounding INTO error.
ENDTRY.

DATA c30 TYPE c LENGTH 30.
TRY.
    c30 = 'abcdefghijklmn'.
    c5 = EXACT #( c30 ).          "truncation -> cx_sy_conversion_data_loss
  CATCH cx_sy_conversion_data_loss INTO error.
ENDTRY.
```

**Character target rules (summary):**
- `c` ← left-aligned; truncate if target shorter, pad blanks if longer. From `string`, trailing blanks are retained.
- `n` ← only digits kept, right-aligned; pad `0` if target longer, truncate (right-aligned) if shorter.
- `string` ← passed including leading blanks, excluding trailing blanks.

```abap
DATA c3 TYPE c LENGTH 3.
DATA n5 TYPE n LENGTH 5.
c5 = 'abcde'.   c3 = c5.   "abc
c5 = '3#4#5'.   n5 = c5.   "00345  (non-digits ignored, right-aligned, zero-padded)
```

**Compatibility:** if source and target types are *compatible*, content is copied unchanged; if incompatible but a conversion rule exists, content is converted. Deep structures need careful compatibility checks (see [structures.md](structures.md)).

## Casting vs conversion (bits and bytes)

- **Casting** treats the same memory under a different type (via field symbols with `... CASTING`). The bytes are unchanged; the *type* decides the value.
- **Conversion** changes the actual bytes so the value's meaning is preserved across types.

```abap
DATA hex TYPE x LENGTH 4 VALUE '32003700'.
FIELD-SYMBOLS <num>  TYPE i.
FIELD-SYMBOLS <text> TYPE c.
ASSIGN hex TO <num>  CASTING.   "same bytes read as i    -> 3604530
ASSIGN hex TO <text> CASTING.   "same bytes read as text -> 27
```

## Typed literals in ABAP SQL

A typed literal fixes its type via a built-in DDIC type prefix; preferred over untyped literals for type safety, fewer implicit conversions, and readability.

```abap
SELECT SINGLE FROM zdemo_abap_fli FIELDS *
  WHERE fldate = datn`20240102`            "typed (preferred)
  INTO @DATA(wa).

"Examples of typed literals: char`X`, int8`32984723948723`, raw`11`,
"numc`1234`, utclong`2024-01-01T10:01:02,2`, tims`101507`, curr`173.95`, datn`20240102`
```

## TYPES ... WITH INDICATORS

For ABAP SQL `UPDATE` with set indicators — update specific fields without overwriting others.

```abap
TYPES ind_wa TYPE dbtab WITH INDICATORS comp_ind TYPE abap_bool.
DATA ind_tab TYPE TABLE OF ind_wa.
ind_tab = VALUE #( ( comp1 = ... comp2 = ... comp_ind-comp2 = abap_true ) ).
UPDATE dbtab FROM TABLE @ind_tab INDICATORS SET STRUCTURE comp_ind.
"Reversed logic:
UPDATE dbtab FROM TABLE @ind_tab INDICATORS NOT SET STRUCTURE comp_ind.
```
