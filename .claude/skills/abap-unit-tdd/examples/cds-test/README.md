# CDS View Test Example — `cl_cds_test_environment`

Testing a CDS view with substituted base data so no live DB is involved.

## Setup — view under test

Assume `Z_C_OpenSalesOrderByCustomer` (the composite from `cds-views-authoring` examples):

```sql
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Open sales orders by customer'
@VDM.viewType: #COMPOSITE
define view entity Z_C_OpenSalesOrderByCustomer
  with parameters p_lookback_days : abap.int4
  as select from Z_I_SalesOrder as so
{
  key so.CustomerId,
      sum( so.NetAmount ) as OpenAmount,
      so.Currency,
      count( so.SalesOrderId ) as OrderCount
}
where so.DocumentDate >= dats_add_days( $session.system_date, -1 * $parameters.p_lookback_days )
group by so.CustomerId, so.Currency;
```

`Z_I_SalesOrder` projects from `vbak` (a DDIC table).

## Test class

```abap
CLASS ltcl_open_sales_by_customer DEFINITION
  FOR TESTING
  RISK LEVEL HARMLESS
  DURATION SHORT
  FINAL.

  PRIVATE SECTION.

    CLASS-DATA mo_env TYPE REF TO if_cds_test_environment.

    CLASS-METHODS:
      class_setup,
      class_teardown.

    METHODS:
      setup,
      single_open_order             FOR TESTING,
      two_orders_same_customer_sum  FOR TESTING,
      old_orders_excluded_by_window FOR TESTING,
      mixed_currencies_grouped      FOR TESTING.

ENDCLASS.

CLASS ltcl_open_sales_by_customer IMPLEMENTATION.

  METHOD class_setup.
    mo_env = cl_cds_test_environment=>create(
            i_for_entity = 'Z_C_OPENSALESORDERBYCUSTOMER' ).
  ENDMETHOD.

  METHOD class_teardown.
    mo_env->destroy( ).
  ENDMETHOD.

  METHOD setup.
    mo_env->clear_doubles( ).
  ENDMETHOD.

  METHOD single_open_order.
    insert_vbak( VALUE #(
      ( vbeln = '0000000001'
        kunnr = '0000000001'
        netwr = '100'
        waerk = 'EUR'
        audat = sy-datum - 1 ) ) ).

    DATA(lt_result) = read_view( iv_lookback = 90 ).

    cl_abap_unit_assert=>assert_equals(
      act = lines( lt_result )
      exp = 1
      msg = 'Single open order should produce one summary row' ).

    cl_abap_unit_assert=>assert_equals(
      act = lt_result[ 1 ]-OpenAmount
      exp = CONV decfloat34( '100' )
      msg = 'Total should match the single order amount' ).
  ENDMETHOD.

  METHOD two_orders_same_customer_sum.
    insert_vbak( VALUE #(
      ( vbeln = '1' kunnr = '1' netwr = '100' waerk = 'EUR' audat = sy-datum - 1 )
      ( vbeln = '2' kunnr = '1' netwr = '150' waerk = 'EUR' audat = sy-datum - 1 ) ) ).

    DATA(lt_result) = read_view( iv_lookback = 90 ).

    cl_abap_unit_assert=>assert_equals(
      act = lines( lt_result )
      exp = 1
      msg = 'Two orders for one customer should group to a single row' ).

    cl_abap_unit_assert=>assert_equals(
      act = lt_result[ 1 ]-OpenAmount
      exp = CONV decfloat34( '250' )
      msg = 'OpenAmount should be the sum' ).

    cl_abap_unit_assert=>assert_equals(
      act = lt_result[ 1 ]-OrderCount
      exp = 2
      msg = 'OrderCount should be 2' ).
  ENDMETHOD.

  METHOD old_orders_excluded_by_window.
    insert_vbak( VALUE #(
      ( vbeln = '1' kunnr = '1' netwr = '100' waerk = 'EUR' audat = sy-datum - 10  )    " within window
      ( vbeln = '2' kunnr = '1' netwr = '999' waerk = 'EUR' audat = sy-datum - 200 ) ) ).  " outside

    DATA(lt_result) = read_view( iv_lookback = 90 ).

    cl_abap_unit_assert=>assert_equals(
      act = lines( lt_result )
      exp = 1
      msg = 'One row, only the in-window order' ).

    cl_abap_unit_assert=>assert_equals(
      act = lt_result[ 1 ]-OpenAmount
      exp = CONV decfloat34( '100' )
      msg = 'Out-of-window order excluded' ).
  ENDMETHOD.

  METHOD mixed_currencies_grouped.
    insert_vbak( VALUE #(
      ( vbeln = '1' kunnr = '1' netwr = '100' waerk = 'EUR' audat = sy-datum - 1 )
      ( vbeln = '2' kunnr = '1' netwr = '150' waerk = 'USD' audat = sy-datum - 1 ) ) ).

    DATA(lt_result) = read_view( iv_lookback = 90 ).

    cl_abap_unit_assert=>assert_equals(
      act = lines( lt_result )
      exp = 2
      msg = 'Different currencies should produce separate rows' ).
  ENDMETHOD.

  " ---- helpers ----

  METHOD insert_vbak.
    " test helper — adapts vbak test data for the doubled environment
    mo_env->insert_test_data( i_data = it_rows ).
  ENDMETHOD.

  METHOD read_view.
    SELECT CustomerId, OpenAmount, Currency, OrderCount
      FROM Z_C_OpenSalesOrderByCustomer( p_lookback_days = @iv_lookback )
      INTO TABLE @rt_result
      ORDER BY CustomerId.
  ENDMETHOD.

ENDCLASS.
```

(The `insert_vbak` and `read_view` helpers need matching declarations in the `PRIVATE SECTION`; expand for production use.)

## What this pattern teaches

- The CDS test environment substitutes the base table (`vbak` here) for the duration of the test class. The CDS view computation runs unchanged.
- Each test inserts only the rows it needs — three-line tests instead of "set up the whole world".
- The lookback parameter is exercised by passing different `p_lookback_days` values per test.
- Mixed currencies test ensures the `group by` works as expected.
- The view's `where` clause (date filter) is exercised by the old-orders test.

## Common pitfalls in CDS tests

| Pitfall | Symptom | Fix |
|---|---|---|
| Forgot to `destroy( )` | Subsequent test classes show stale doubles | Always destroy in `class_teardown` |
| Inserted columns the test doesn't care about | Setup noise; brittle if DDIC changes | Insert only the fields the view actually reads |
| Test depends on `sy-datum` | Date drift over time | Use `sy-datum - n` so the date is always relative |
| Test passes against doubled data but fails in production | The view references unreleased / extra logic the double can't simulate | Verify with a small integration test against real DB once |
| Multiple test classes share the `mo_env` | Race conditions, leftover data | One env per test class; create/destroy in `class_setup`/`class_teardown` |
