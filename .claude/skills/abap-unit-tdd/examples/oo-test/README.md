# OO Test Example — Class + Test Class

Full minimal example: a domain class with constructor injection, its interface, and a test class using a manual stub.

## Production code

`zif_rate_provider.intf`:
```abap
INTERFACE zif_rate_provider PUBLIC.
  METHODS rate
    IMPORTING iv_currency     TYPE waers
    RETURNING VALUE(rv_result) TYPE decfloat34
    RAISING   zcx_rate_unavailable.
ENDINTERFACE.
```

`zcl_order_pricing.clas` (definition):
```abap
CLASS zcl_order_pricing DEFINITION
  PUBLIC FINAL CREATE PUBLIC.

  PUBLIC SECTION.
    METHODS:
      constructor
        IMPORTING io_rate_provider TYPE REF TO zif_rate_provider,
      total_in_eur
        IMPORTING is_order       TYPE zorder_data
        RETURNING VALUE(rv_result) TYPE decfloat34
        RAISING   zcx_rate_unavailable.

  PRIVATE SECTION.
    DATA mo_rate_provider TYPE REF TO zif_rate_provider.

ENDCLASS.
```

`zcl_order_pricing.clas` (implementation):
```abap
CLASS zcl_order_pricing IMPLEMENTATION.

  METHOD constructor.
    me->mo_rate_provider = io_rate_provider.
  ENDMETHOD.

  METHOD total_in_eur.
    IF is_order-amount IS INITIAL.
      rv_result = 0.
      RETURN.
    ENDIF.

    DATA(lv_rate) = mo_rate_provider->rate( is_order-currency ).

    rv_result = is_order-amount * lv_rate.
  ENDMETHOD.

ENDCLASS.
```

## Test class (local — in the same class include)

```abap
*"* test class
CLASS ltcl_fake_rate DEFINITION FOR TESTING.
  PUBLIC SECTION.
    INTERFACES zif_rate_provider.
    METHODS:
      stub_rate  IMPORTING iv_currency TYPE waers iv_value TYPE decfloat34,
      stub_raise IMPORTING iv_currency TYPE waers.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_rate,
             currency TYPE waers,
             value    TYPE decfloat34,
           END OF ty_rate.
    DATA: mt_rates  TYPE HASHED TABLE OF ty_rate WITH UNIQUE KEY currency,
          mt_raises TYPE TABLE OF waers.
ENDCLASS.

CLASS ltcl_fake_rate IMPLEMENTATION.
  METHOD stub_rate.
    INSERT VALUE #( currency = iv_currency value = iv_value ) INTO TABLE mt_rates.
  ENDMETHOD.
  METHOD stub_raise.
    APPEND iv_currency TO mt_raises.
  ENDMETHOD.
  METHOD zif_rate_provider~rate.
    IF line_exists( mt_raises[ table_line = iv_currency ] ).
      RAISE EXCEPTION TYPE zcx_rate_unavailable EXPORTING currency = iv_currency.
    ENDIF.
    READ TABLE mt_rates ASSIGNING FIELD-SYMBOL(<fs_rate>) WITH TABLE KEY currency = iv_currency.
    IF sy-subrc = 0.
      rv_result = <fs_rate>-value.
    ELSE.
      rv_result = '1.00'.
    ENDIF.
  ENDMETHOD.
ENDCLASS.

CLASS ltcl_order_pricing DEFINITION
  FOR TESTING
  RISK LEVEL HARMLESS
  DURATION SHORT
  FINAL.

  PRIVATE SECTION.
    DATA:
      mo_cut         TYPE REF TO zcl_order_pricing,
      mo_fake_rates  TYPE REF TO ltcl_fake_rate.

    METHODS:
      setup,
      given_zero_amount_returns_zero       FOR TESTING,
      given_eur_passes_through             FOR TESTING,
      given_usd_converts_to_eur            FOR TESTING,
      given_rate_unavailable_raises        FOR TESTING.

ENDCLASS.

CLASS ltcl_order_pricing IMPLEMENTATION.

  METHOD setup.
    mo_fake_rates = NEW ltcl_fake_rate( ).
    mo_cut        = NEW zcl_order_pricing( io_rate_provider = mo_fake_rates ).
  ENDMETHOD.

  METHOD given_zero_amount_returns_zero.
    DATA(lv_result) = mo_cut->total_in_eur(
                     VALUE #( amount = 0 currency = 'EUR' ) ).
    cl_abap_unit_assert=>assert_equals(
      act = lv_result
      exp = CONV decfloat34( '0' )
      msg = 'Zero amount must yield zero total' ).
  ENDMETHOD.

  METHOD given_eur_passes_through.
    mo_fake_rates->stub_rate( iv_currency = 'EUR' iv_value = '1.00' ).
    DATA(lv_result) = mo_cut->total_in_eur(
                     VALUE #( amount = '100' currency = 'EUR' ) ).
    cl_abap_unit_assert=>assert_equals(
      act = lv_result
      exp = CONV decfloat34( '100' )
      msg = 'EUR amount should remain unchanged' ).
  ENDMETHOD.

  METHOD given_usd_converts_to_eur.
    mo_fake_rates->stub_rate( iv_currency = 'USD' iv_value = '0.90' ).
    DATA(lv_result) = mo_cut->total_in_eur(
                     VALUE #( amount = '100' currency = 'USD' ) ).
    cl_abap_unit_assert=>assert_equals(
      act = lv_result
      exp = CONV decfloat34( '90' )
      msg = '100 USD at 0.90 = 90 EUR' ).
  ENDMETHOD.

  METHOD given_rate_unavailable_raises.
    mo_fake_rates->stub_raise( iv_currency = 'XYZ' ).
    TRY.
        mo_cut->total_in_eur(
          VALUE #( amount = '100' currency = 'XYZ' ) ).
        cl_abap_unit_assert=>fail(
          msg = 'Expected zcx_rate_unavailable for unknown currency' ).
      CATCH zcx_rate_unavailable.
        " expected
    ENDTRY.
  ENDMETHOD.

ENDCLASS.
```

## What makes this pattern work

1. **Constructor injection.** The cut doesn't know whether the rate provider is real or a fake. The test gets to choose.
2. **Interface, not class.** `zif_rate_provider` lets the fake exist without subclassing `zcl_real_rate_provider`.
3. **Local fake.** `ltcl_fake_rate` is in the same test include as the test class. No global namespace cost; deletes when the cut goes away.
4. **Setup per test.** Each test gets a fresh `mo_cut` and fresh `mo_fake_rates`. No leakage.
5. **Test names describe behavior.** Reading `given_zero_amount_returns_zero` tells you what the code does without opening the implementation.
6. **One concept per test.** Four scenarios → four methods. Failure messages point precisely to the broken behavior.
7. **Exception test forces failure first.** `fail( )` after the call that should raise; if no exception, the test reports the absence.

## How to run

In ADT or SE80: right-click the class → Run As → ABAP Unit Test. Or `Ctrl+Shift+F10` in ADT.

Verify the test run output shows 4 tests, 4 passed. If any failed, the assertion message and stack point at the problem.
