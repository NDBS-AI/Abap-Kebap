# Numeric Operations — Full Reference

Source: SAP-samples/abap-cheat-sheets `29_Numeric_Operations.md` and `24_Builtin_Functions.md`. Syntax copied verbatim.

Back to [SKILL.md](../SKILL.md). Related: [abap-data-objects](../../abap-data-objects/SKILL.md) (type declarations), [datetime.md](datetime.md), [builtin-catalog.md](builtin-catalog.md).

---

## 1. Numeric type selection

Calculations use numeric data objects or objects convertible to numeric types. Only **built-in ABAP types** are usable directly in programs; built-in DDIC types (e.g. `INT4`→`i`, `DECFLOAT16`→`decfloat16`) are for DDIC/CDS and typed literals only.

| Built-in ABAP type | Bytes / size | Use for | Notes |
|---|---|---|---|
| `i` | 4-byte integer | counters, indexes (`sy-index`, `sy-tabix`), quantities | only type specifiable directly as a numeric literal |
| `int8` | 8-byte integer | larger integer range than `i` | DDIC `INT8` |
| `b` / `s` | 1-byte / 2-byte integer | short integers | not specifiable directly in programs; use DDIC `INT1`/`INT2` |
| `p` | packed, 1–16 bytes, ≤14 decimals | lengths, weights, currency (fixed decimal places) | length×2−1 digits; sign in last byte; needs `LENGTH`/`DECIMALS` |
| `decfloat16` | decimal float, 16 places | high precision + wide range | preferred for money |
| `decfloat34` | decimal float, 34 places | maximum precision + wide range | result type of `round`/`rescale`; highest priority in calculation type |
| `f` | binary float, ~17 mantissa digits, 3-digit exponent | speed over precision, scientific notation | binary fractions ⇒ not every decimal is exact |

> Type `n` (numeric text) is **character-like, not numeric** — use it for IDs / article numbers, never for calculations.
> Generic types `numeric`, `p`, `decfloat` can type field symbols and formal parameters.

### Declaring & assigning values

```abap
"Integers — i can be specified directly as a numeric literal
DATA lv_i_a TYPE i.
lv_i_a = 2.
DATA lv_i_b TYPE i VALUE 1.
DATA(lv_i_d) = 3.                  "automatically typed i
FINAL(lv_i_e) = 4.                 "immutable
DATA(lv_i_f) = CONV i( '4' ).

DATA lv_int8_b TYPE int8 VALUE 1.
DATA(lv_int8_d) = CONV int8( 2 ).

"Packed — values must come from character literals interpretable as packed
DATA lv_p_d2 TYPE p LENGTH 16 DECIMALS 2 VALUE '8915050542191264935993694231.83-'.
TYPES ty_p_l8d2 TYPE p LENGTH 8 DECIMALS 2.   "length 8 -> 15 digits, 2 reserved for decimals
DATA lv_p_l8d2_a TYPE ty_p_l8d2.
lv_p_l8d2_a = '1234567890123.99-'.
lv_p_l8d2_a = '1234567890123.99+'.
DATA(lv_p_l8d2_c) = CONV ty_p_l8d2( '1.23' ).

"Decimal floating point
DATA lv_dec16 TYPE decfloat16 VALUE '0.7805874561940696'.        "16 places
DATA lv_dec34 TYPE decfloat34 VALUE '0.0587780463975441530508753423121495'. "34 places

"Binary floating point — not exact
DATA lv_float TYPE f VALUE '2.1643779466775481E-01'.
lv_float = CONV f( '0.815' ).                "8.1499999999999995E-01
DATA(lv_dec34_b) = CONV decfloat34( '0.815' ). "0.815
ASSERT lv_float <> lv_dec34_b.
```

### Generic numeric field symbols

```abap
FIELD-SYMBOLS <fv_number> TYPE numeric.   "accepts i, int8, p, decfloat16/34, f
FIELD-SYMBOLS <fv_packed> TYPE p.         "accepts any packed type
FIELD-SYMBOLS <fv_dec>    TYPE decfloat.  "accepts decfloat16 / decfloat34
```

### Notations in character-like fields

Most types (except `i`) take their value from character literals. Which notation is allowed depends on the type:

```abap
DATA(lv_math_notation) = `- 123.45`.   "Mathematical: sign on the left (blank-separated allowed)
DATA(lv_comm_notation) = `123.45-`.    "Commercial:   sign on the right
DATA(lv_sci_notation)  = `-1.23456E03`."Scientific:   mantissa + E/e + exponent
```

| Type | Mathematical | Commercial | Scientific |
|---|---|---|---|
| `decfloat16` / `decfloat34` | ✓ | ✓ | ✓ |
| `f` | ✓ (signs must **not** be blank-separated) | ✓ | ✓ |
| `i`, `int8`, `p` | ✓ | ✓ | ✗ (`cx_sy_conversion_no_number`) |

Use `EXACT #( … )` to verify a lossless assignment (raises on rounding/invalid).

---

## 2. Arithmetic operators

Operators: `+`, `-`, `*`, `/`, `DIV`, `MOD`, `**`. Parentheses prioritize. Operands may be prefixed `+`/`-`.

- **`DIV`** — integer part of left/right, with positive remainder.
- **`MOD`** — positive remainder of left/right (always ≥ 0).
- **`**`** — left to the power of right; **can produce type `f`** — use `ipow` to avoid `f`.

```abap
DATA lv_res TYPE i.
lv_res = 7 DIV 3.   "2 (integer part of 2.333…)
lv_res = 4 DIV 5.   "0
lv_res = 7 MOD 3.   "1
lv_res = 4 MOD 5.   "4
lv_res = 9 + 8 - 7. "10
lv_res = 1 + 1 * 3. "4  (* before +)
lv_res = 3 + 3 / 3. "4
lv_res = ( 3 + 3 ) / 3. "2

"** producing type f vs decfloat34
DATA(lv_power_result1) = 2 ** 5.                       "type f ('F')
DATA(lv_power_result2) = CONV decfloat34( '2' ) ** 5.  "type decfloat34 ('e')
```

Operands in arithmetic expressions may be: named/unnamed numeric data objects, objects convertible to numeric, numeric functions, or functional method calls returning numeric.

```abap
lv_result = 1 + '2'.                       "3 (char literal '2' converted)
DATA lv_str TYPE string VALUE `7      `.
lv_result = lv_num + lv_str.                     "convertible string operand
lv_result = 1 + ipow( base = 2 exp = 3 ).  "function operand -> 9
TRY.
    lv_result = 1 + '#'.                   "non-convertible -> cx_sy_conversion_no_number
  CATCH cx_sy_conversion_no_number INTO DATA(lo_error).
ENDTRY.
```

### Rounding pitfalls with integer targets

```abap
lv_res = 1 / 3.            ASSERT lv_res = 0.  "0.333 -> 0
lv_res = 2 / 3.            ASSERT lv_res = 1.  "0.666 -> 1 (rounded)
lv_res = 3 * ( 1 / 3 ).    ASSERT lv_res = 0.  "3 * 0
lv_res = 3 * ( 2 / 3 ).    ASSERT lv_res = 3.  "3 * 1
```

---

## 3. Calculation type

The arithmetic expression has a **calculation type** determined at runtime from the statically identifiable operand types. It governs rounding and the type of an inline-declared result. Priority (decreasing):

1. **decfloat** if any operand is `decfloat34`/`decfloat16` → `decfloat34` if any `decfloat34` is involved, else `decfloat16`.
2. **`f`** if any operand is `f` (but a `decfloat` operand outranks `f` per rule 1).
3. **`p`** if any operand is `p`.
4. **`int8`** if any operand is `int8`.
5. **`i`** otherwise.

Conversion rules for non-numeric operands:
- `d`, `t`, `x`, `xstring` → `i`
- `c`, `n`, `string` → `p`
- `utclong` → **not supported**

`type_kind` constants (from `cl_abap_typedescr`) seen in the examples: `'e'` = decfloat34, `'a'` = decfloat16, `'F'` = f, `'P'` = p, `'8'` = int8, `'I'` = i.

```abap
DATA(lv_res_dec_a) = 1 + CONV decfloat34( '1.1' ).                 "'e' decfloat34
DATA(lv_res_dec_c) = CONV decfloat16( '2.2' ) + 5.                 "'a' decfloat16
DATA(lv_res_dec_g) = CONV decfloat34( '2.2' ) + CONV f( '2.2E-01' )."'e' decfloat34 (outranks f)
DATA(lv_res_f_a)   = 1 + CONV f( '2.23645E-01' ).                  "'F' f
DATA(lv_res_int8_a)= CONV int8( 2 ) + 2.                           "'8' int8
DATA(lv_res_i_a)   = 2 + 5.                                        "'I' i
```

> **Packed pitfall:** an inline-declared result of a `p` calculation gets `p LENGTH 8 DECIMALS 0` — length/decimals cannot be inferred, so decimals are lost. Declare the target explicitly; `##TYPE` suppresses the syntax warning.

```abap
DATA lv_p_l16d3 TYPE p LENGTH 16 DECIMALS 3 VALUE '1.234'.
DATA(lv_res_p_a) = lv_p_l16d3 + 1 ##TYPE.
ASSERT cl_abap_typedescr=>describe_by_data( lv_res_p_a )->length   = 8.
ASSERT cl_abap_typedescr=>describe_by_data( lv_res_p_a )->decimals = 0.
```

Use `CONV` to adjust the calculation type on the right-hand side. For generally typed operands, the standard type is used.

---

## 4. Calculation assignments

`+=`, `-=`, `*=`, `/=` — shorthand for `a = a + ( b )` etc.

```abap
DATA lv_int_calc TYPE i.
lv_int_calc = 1.   lv_int_calc += 1.  "2
lv_int_calc = 10.  lv_int_calc -= 1.  "9
lv_int_calc = 5.   lv_int_calc *= 3.  "15
lv_int_calc = 100. lv_int_calc /= 2.  "50
```

---

## 5. Exceptions in calculations

| Situation | Exception | Notes |
|---|---|---|
| Division by zero | `cx_sy_zerodivide` | `0 / 0` does **not** raise — result is 0 |
| Result exceeds value range | `cx_sy_arithmetic_overflow` | e.g. `2147483647 + 1`, `999999 * 999999` |
| Non-numeric operand | `cx_sy_conversion_no_number` | content not convertible |
| Lossless calc requires rounding | `cx_sy_conversion_rounding` | only with `EXACT` |

`cx_sy_arithmetic_error` is a common superclass (used in the calculator example methods, `RAISING cx_sy_arithmetic_error`).

```abap
TRY.
    lv_res = 2147483647 + 1.
  CATCH cx_sy_arithmetic_overflow INTO DATA(lo_e3).
ENDTRY.

TRY.
    lv_res = 1 / 0.
  CATCH cx_sy_zerodivide INTO DATA(lo_e1).
ENDTRY.
TRY.
    lv_res = 0 / 0.                  "no exception
  CATCH cx_sy_zerodivide INTO DATA(lo_e2).
ENDTRY.
ASSERT lo_e2 IS INITIAL.
```

### Lossless calculations with EXACT

```abap
TYPES ty_pl8d3 TYPE p LENGTH 8 DECIMALS 3.
DATA(lv_p_a) = EXACT ty_pl8d3( '123.987' ).   "ok
TRY.
    DATA(lv_p_d) = EXACT ty_pl8d3( '123.9876' ). "4 decimals -> rounding needed
  CATCH cx_sy_conversion_rounding INTO DATA(lo_err).
ENDTRY.

TYPES ty_pl8d2 TYPE p LENGTH 8 DECIMALS 2.
DATA(lv_p_e) = EXACT ty_pl8d2( 1 / 4 ).       "ok (0.25)
TRY.
    DATA(lv_p_g) = EXACT ty_pl8d2( 1 / 3 ).   "rounding -> exception
  CATCH cx_sy_conversion_rounding INTO lo_err.
ENDTRY.
```

---

## 6. Numeric built-in functions

### Sign / extremum / power

```abap
abs(  CONV decfloat34( '-4.756' ) )   "4.756  — absolute value
abs(  -4 )                            "4
sign( -789 )                          "-1     — -1/0/1 for neg/zero/pos
sign( 5 - 5 )                         "0
ipow( base = 2 exp = 3 )              "8      — integer power, avoids type f
ipow( base = 10 exp = 0 )             "1
"ipow( base = 10 exp = 100 ) -> cx_sy_arithmetic_overflow
nmin( val1 = … val2 = … … )           "smallest of 2–9 numeric arguments
nmax( val1 = … val2 = … … )           "largest of 2–9 numeric arguments
```

### Rounding / truncation (argument decfloat34, result decfloat34)

```abap
"           4.999  4.001  -4.999  -4.001
ceil(  )  "    5      5      -4      -4   smallest integer >= value
floor( )  "    4      4      -5      -5   largest integer <= value
trunc( )  "    4      4      -4      -4   integer part (toward zero)
frac(  )  "0.999  0.001  -0.999  -0.001  decimal part
```

### round / rescale

`round` and `rescale` expect a decimal floating point number; return `decfloat34`. Round to **decimal places** (`dec`) or **precision** (`prec`); rounding rules can be specified (see below).

```abap
round( val = CONV decfloat34( '1.2374' ) dec = 2 )            "1.24
round( val = CONV decfloat34( '1.2374' ) dec = 3 )            "1.237
round( val = CONV decfloat34( '1234567890123' ) prec = 10 )  "1.234567890E+12
round( val = CONV decfloat34( '1234' ) prec = 3 )            "1.23E+3

rescale( val = CONV decfloat34( '1234.56789' ) dec = 0 )     "1235
rescale( val = CONV decfloat34( '1234.56789' ) dec = 1 )     "1234.6
rescale( val = CONV decfloat34( '1234.56789' ) prec = 3 )    "1.23E+3
rescale( val = CONV decfloat34( '1234.56789' ) prec = 10 )   "1234.567890
```

**Rounding-mode constants** (`cl_abap_math`, passed via the `mode` parameter of `round`) — common modes include half-up, half-down, half-even (banker's), toward zero, ceiling, floor. Refer to `cl_abap_math` and the ABAP Keyword Documentation for the exact constant names and behavior.

### Floating-point math functions

`acos`, `asin`, `atan`, `cos`, `sin`, `tan`, `cosh`, `sinh`, `tanh`, `exp`, `log`, `log10`, `sqrt`.

```abap
sqrt(  CONV decfloat34( '9' ) )     "3
sqrt(  CONV decfloat34( '40.96' ) ) "6.4
log10( CONV decfloat34( '1000' ) )  "3
sin( '30' )                         "-0.988031…
cos( '45' )                         "0.525321…
tan( '90' )                         "-1.9952…
```

### factorial / binomial

```abap
DATA(lv_result)    = factorial( lv_count ).        "factorial of a positive integer
DATA(lv_bin_coeff) = binomial( n = lv_n_val k = lv_k_val ). "binomial coefficient
"Large results: format with STYLE = SIMPLE, e.g. |{ lv_result STYLE = SIMPLE }|
```

---

## 7. System classes for numeric values

### cl_abap_math — min/max constants & helpers

```abap
DATA(lv_min_int4)      = cl_abap_math=>min_int4.
DATA(lv_max_int4)      = cl_abap_math=>max_int4.
DATA(lv_max_int1)      = cl_abap_math=>max_int1.
DATA(lv_max_int2)      = cl_abap_math=>max_int2.
DATA(lv_max_int8)      = cl_abap_math=>max_int8.
DATA(lv_max_decfloat16)= cl_abap_math=>max_decfloat16.
DATA(lv_max_decfloat34)= cl_abap_math=>max_decfloat34.
"…and min_* counterparts. Also holds rounding-mode constants for round( … mode = … ).
```

### cl_abap_random* — seeded random numbers

```abap
DATA(lv_random_i)     = cl_abap_random_int=>create( seed = cl_abap_random=>seed( )
                                                 min  = 1 max = 100 )->get_next( ).
DATA(lv_random_int8)  = cl_abap_random_int8=>create( seed = cl_abap_random=>seed( ) )->get_next( ).
DATA(lv_random_dec16) = cl_abap_random_decfloat16=>create( seed = cl_abap_random=>seed( ) )->get_next( ).
DATA(lv_random_dec34) = cl_abap_random_decfloat34=>create( seed = cl_abap_random=>seed( ) )->get_next( ).
DATA(lv_random_f)     = cl_abap_random_float=>create( seed = cl_abap_random=>seed( ) )->get_next( ).
DATA(lv_random_p)     = cl_abap_random_packed=>create( seed = cl_abap_random=>seed( ) )->get_next( ).
"cl_abap_random_packed_dec1 … _dec14 for packed types with 1–14 decimals
```

### cl_abap_bigint — arbitrary-precision integers

Use for large numbers, avoiding overflow, exact integer math beyond `int8`.

```abap
DATA(lo_bigint_int4)  = cl_abap_bigint=>factory_from_int4( 10 ).
DATA(lo_big_string)   = cl_abap_bigint=>factory_from_string( `283469208407283452340` ).
DATA(lo_big_int8)     = cl_abap_bigint=>factory_from_int8( CONV int8( 1234567890123456 ) ).

DATA(lv_sum)   = cl_abap_bigint=>factory_from_int4( 4 )->add( lo_bigint_int4 )->to_string( ).
DATA(lv_absv)  = cl_abap_bigint=>factory_from_int4( -10 )->abs( )->to_string( ).
DATA(ls_divr)  = cl_abap_bigint=>factory_from_int4( 20 )->div( lo_bigint_int4 ). "structure: -quotient / -remainder
DATA(lv_quot)  = ls_divr-quotient->to_string( ).
DATA(lv_rem)   = ls_divr-remainder->to_string( ).
DATA(lv_gcdv)  = cl_abap_bigint=>factory_from_int4( 50 )->gcd( lo_bigint_int4 )->to_string( ).
DATA(lv_powv)  = cl_abap_bigint=>factory_from_int4( 8 )->pow( 2 )->to_string( ).
DATA(lv_sqrtv) = cl_abap_bigint=>factory_from_int4( 9 )->sqrt( )->to_string( ).
"Methods mutate the instance; use ->clone( ) to keep the original:
DATA(lo_a44) = cl_abap_bigint=>factory_from_int4( 15 )->clone( )->add( cl_abap_bigint=>factory_from_int4( 5 ) ).
"Also: to_external, to_utf8, to_df34, compare, mod, mul, sub, is_zero/is_negative/is_larger, is_int4, …
```

### cl_abap_rational — exact fractions

Preserves fractions (no decimal rounding).

```abap
DATA(lo_r1) = cl_abap_rational=>factory_from_string( `-1/3` ).
DATA(lo_r3) = cl_abap_rational=>factory_from_dec( CONV p_l16d5( '123456.789' ) ).
DATA(lo_r5) = cl_abap_rational=>factory_from_df34( `1.4` ).
DATA(lv_r8) = cl_abap_rational=>factory_from_string( `-2/3` )->add_int4( 1 )->to_df34( ).
DATA(lv_r9) = cl_abap_rational=>factory_from_string( `-2/3` )->add_int4( 1 )->to_string( ).
"to_dec( IMPORTING ev_decimal = … ), add_bigint, factory_from_int4/int8/bigint/decimal_string …
```

---

## 8. Numeric functions / arithmetic in ABAP SQL & CDS

```abap
SELECT SINGLE
   1 + 2 AS add,                              "3
   10 - -8 AS subtract,                       "18
   3 * 5 AS multiply,                         "15
   "/ is NOT allowed in integer expressions — use typed literals / casts:
   d34n`4.4` / d34n`2.2` AS divide1,          "2
   CAST( 1 AS D34N ) / CAST( 2 AS D34N ) AS divide2, "0.5
   ( 1 + 2 ) * 3 AS parentheses,              "9
   div( 4, 2 ) AS div,                        "2  (division, rounded to integer)
   division( 1, 3, 2 ) AS division,           "0.33 (3rd arg = decimals)
   ceil( decfloat34`1.333` ) AS ceil,         "2
   mod( 3, 2 ) AS mod,                        "1  (remainder)
   floor( decfloat34`1.333` ) AS floor,       "1
   abs( int4`-2` ) AS abs,                     "2
   round( decfloat34`1.337`, 2 ) AS round     "1.34
 FROM i_timezone
 INTO @DATA(ls_some_data).
```

See [builtin-catalog.md](builtin-catalog.md) for the SQL/CDS string, date, and special functions.

---

## Sources

- ABAP Keyword Doc — Compute Expressions: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENCOMPUTE_EXPRESSIONS.html
- ABAP Keyword Doc — Calculation type: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENARITH_TYPE.html
- ABAP Keyword Doc — Numeric functions: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abennumeric_functions.htm
- DIV and MOD explained: https://community.sap.com/t5/technology-blogs-by-sap/understanding-div-and-mod-in-abap-and-beyond/ba-p/14015181
- SAP-samples/abap-cheat-sheets — `29_Numeric_Operations.md`, `24_Builtin_Functions.md`
