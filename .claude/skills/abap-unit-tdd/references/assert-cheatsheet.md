# `cl_abap_unit_assert` Cheat Sheet

Which assertion method for which check.

## Most used (90% of tests)

| Method | When | Example |
|---|---|---|
| `assert_equals` | Compare two values | `assert_equals( act = result exp = 42 msg = 'Total should be 42' )` |
| `assert_not_initial` | Value must not be empty/zero | `assert_not_initial( act = error msg = 'Should have caught an error' )` |
| `assert_initial` | Value should be empty/zero | `assert_initial( act = balance msg = 'New account starts at zero' )` |
| `assert_true` | Boolean must be true | `assert_true( act = is_blocked msg = 'Customer should be blocked' )` |
| `assert_false` | Boolean must be false | `assert_false( act = was_processed msg = 'Should not be processed yet' )` |

## References

| Method | When |
|---|---|
| `assert_bound` | Reference is assigned to a real object |
| `assert_not_bound` | Reference is null / cleared |

## Subrc / kernel calls

| Method | When |
|---|---|
| `assert_subrc` | After a `READ TABLE` / `SELECT` / `OPEN DATASET` — check sy-subrc |

```abap
SELECT SINGLE name1 FROM kna1 INTO @DATA(lv_name) WHERE kunnr = @cust.
cl_abap_unit_assert=>assert_subrc(
  exp = 0
  msg = |Customer { cust } should exist in test data| ).
```

## Tables

| Method | When |
|---|---|
| `assert_equals` on an itab | Whole-table equality (with optional `ignore_hash_sequence` flag) |
| `assert_table_contains` | At least one row matches |
| `assert_table_not_contains` | No row matches |

```abap
cl_abap_unit_assert=>assert_table_contains(
  line  = VALUE result_row( id = '1' status = 'PAID' )
  table = lt_results
  msg   = 'Result should include the paid invoice' ).
```

When testing a sorted/hashed table where order is part of the contract, prefer `assert_equals` of the entire table over multiple `assert_table_contains` calls — the failure message shows the diff.

## Exception handling

For "should raise":

```abap
TRY.
    mo_cut->do_something( invalid_input ).
    cl_abap_unit_assert=>fail( msg = 'Expected cx_invalid_input' ).
  CATCH cx_invalid_input.
    " expected
ENDTRY.
```

Or, additionally asserting on the caught exception:
```abap
TRY.
    mo_cut->do_something( invalid_input ).
    cl_abap_unit_assert=>fail( 'Expected cx_invalid_input' ).
  CATCH cx_invalid_input INTO DATA(lo_ex).
    cl_abap_unit_assert=>assert_equals(
      act = lo_ex->get_text( )
      exp = 'Invalid input X'
      msg = 'Wrong message text' ).
ENDTRY.
```

For "should NOT raise":

```abap
TRY.
    DATA(lv_result) = mo_cut->do_something( valid_input ).
  CATCH cx_root INTO DATA(lo_ex).
    cl_abap_unit_assert=>fail(
      msg = |Did not expect exception: { lo_ex->get_text( ) }| ).
ENDTRY.
" Now assert on lv_result
```

## Less common but useful

| Method | When |
|---|---|
| `assert_differs` | Two values must NOT be equal (negation of `assert_equals`) |
| `assert_number_between` | Numeric range check: value must be between `lower` and `upper` |
| `assert_char_cp` | Character sequence matches a pattern (like ABAP `CP` operator) |
| `assert_char_np` | Character sequence does NOT match a pattern (like ABAP `NP` operator) |
| `assert_text_matches` / `assert_text_not_matches` | Text matches / does NOT match a **regular expression** (unlike `assert_char_cp` / `assert_char_np`, which use simple `*` `?` wildcards) |
| `assert_that` | Constraint-based (Hamcrest-style) assertion |
| `assert_return_code` | Checks that a return code has a specific value |
| `skip` | Skip a test due to missing prerequisites — counted as skipped, not failed |

```abap
" assert_differs — value must not equal 42
cl_abap_unit_assert=>assert_differs(
  act = result
  exp = 0
  msg = 'Result must not be zero for a non-empty order' ).

" assert_number_between — value must be in range
cl_abap_unit_assert=>assert_number_between(
  number = discount_pct
  lower  = CONV decfloat34( '0' )
  upper  = CONV decfloat34( '100' )
  msg    = 'Discount percent must be between 0 and 100' ).

" assert_char_cp / assert_char_np — pattern matching (pattern goes in EXP)
cl_abap_unit_assert=>assert_char_cp(
  act = order_id
  exp = 'ORD-*'
  msg = 'Order ID must start with ORD-' ).

cl_abap_unit_assert=>assert_char_np(
  act = description
  exp = '*<script>*'
  msg = 'Description must not contain script tags' ).

" assert_text_not_matches — regex negation
cl_abap_unit_assert=>assert_text_not_matches(
  text    = output_message
  pattern = 'error|exception'
  msg     = 'Success path must not produce error text' ).

" assert_that — check a value against a constraint object (REF TO if_constraint).
" There is no built-in equals-constraint factory: for plain equality use assert_equals;
" assert_that is for reusable / compound constraints (cl_aunit_constraint AND/OR/XOR,
" or your own class implementing if_constraint).
cl_abap_unit_assert=>assert_that(
  act = invoice-status
  exp = status_constraint          " REF TO if_constraint
  msg = 'Invoice must satisfy the status constraint' ).

" assert_return_code — checks sy-subrc equivalent
cl_abap_unit_assert=>assert_return_code(
  exp = 0
  msg = 'File open should succeed' ).

" skip — skip a test when prerequisite is unavailable
METHOD requires_external_system FOR TESTING.
  IF external_system_available( ) = abap_false.
    cl_abap_unit_assert=>skip( msg = 'External system not available in this landscape' ).
  ENDIF.
  " ... rest of the test
ENDMETHOD.
```

`skip` vs `abort`: `skip` marks the individual test as skipped; `abort` stops the entire test class. Use `skip` when a single test has an unmet prerequisite; use `abort` when the whole class cannot run.

## Floating point comparison

For decimals, beware of rounding:

```abap
cl_abap_unit_assert=>assert_equals_float(
  act = computed_amount
  exp = '123.45'
  tol = '0.005'
  msg = 'Total within 0.5 cent tolerance' ).
```

Use `assert_equals` for `decfloat34` / `decfloat16` where you don't need a tolerance (these are exact decimal).

## fail() — force a failure

```abap
IF result-status <> 'OK'.
  cl_abap_unit_assert=>fail( msg = |Bad status: { result-status }| ).
ENDIF.
```

Useful for asserting conditions that don't map to a single `act`/`exp` pair, but prefer one of the specific methods when you can.

## abort() — abort test class

```abap
IF environment_not_available = abap_true.
  cl_abap_unit_assert=>abort( msg = 'Test prerequisites not met; skipping' ).
ENDIF.
```

Stops the current test class without marking as failed. Use for environmental prerequisites (e.g. test data setup tool not available), not for asserting business logic.

## Don't

- Don't compare reference variables with `assert_equals` — use `assert_bound` / `assert_equals( act = ref1 exp = ref2 )` checks identity not content. For content equality of the dereferenced object, write a method like `is_equivalent` and assert it directly.
- Don't write `assert_equals( act = sy-subrc exp = 0 )` — use `assert_subrc` so the failure message is clearer.
- Don't include "Test" or "Expected" in the message — those are implicit. Say what the *business* expectation is.
- Don't `assert_equals( act = abap_true exp = abap_true )` — use `assert_true`.

## Always

- Always include a `msg` parameter. Default message ("Assertion failed") tells the reader nothing.
- Always state the expectation in business terms: `'Order total should match line sum'`, not `'computed = sum'`.
- Always assert on the *outputs* the caller would see, not internal state.
