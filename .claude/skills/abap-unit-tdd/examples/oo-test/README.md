# OO Test Example — Class + Test Class

Full minimal example: a domain class with constructor injection, its interface, and a test class using a manual stub.

## Production code

`zif_rate_provider.intf`:
```abap
INTERFACE zif_rate_provider PUBLIC.
  METHODS rate
    IMPORTING currency      TYPE waers
    RETURNING VALUE(result) TYPE decfloat34
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
        IMPORTING rate_provider TYPE REF TO zif_rate_provider,
      total_in_eur
        IMPORTING order         TYPE zorder_data
        RETURNING VALUE(result) TYPE decfloat34
        RAISING   zcx_rate_unavailable.

  PRIVATE SECTION.
    DATA rate_provider TYPE REF TO zif_rate_provider.

ENDCLASS.
```

`zcl_order_pricing.clas` (implementation):
```abap
CLASS zcl_order_pricing IMPLEMENTATION.

  METHOD constructor.
    me->rate_provider = rate_provider.
  ENDMETHOD.

  METHOD total_in_eur.
    IF order-amount IS INITIAL.
      result = 0.
      RETURN.
    ENDIF.

    DATA(rate) = rate_provider->rate( order-currency ).

    result = order-amount * rate.
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
      stub_rate  IMPORTING currency TYPE waers value TYPE decfloat34,
      stub_raise IMPORTING currency TYPE waers.
  PRIVATE SECTION.
    TYPES: BEGIN OF t_rate,
             currency TYPE waers,
             value    TYPE decfloat34,
           END OF t_rate.
    DATA: rates  TYPE HASHED TABLE OF t_rate WITH UNIQUE KEY currency,
          raises TYPE TABLE OF waers.
ENDCLASS.

CLASS ltcl_fake_rate IMPLEMENTATION.
  METHOD stub_rate.
    INSERT VALUE #( currency = currency value = value ) INTO TABLE rates.
  ENDMETHOD.
  METHOD stub_raise.
    APPEND currency TO raises.
  ENDMETHOD.
  METHOD zif_rate_provider~rate.
    IF line_exists( raises[ table_line = currency ] ).
      RAISE EXCEPTION TYPE zcx_rate_unavailable EXPORTING currency = currency.
    ENDIF.
    READ TABLE rates ASSIGNING FIELD-SYMBOL(<rate>) WITH TABLE KEY currency = currency.
    IF sy-subrc = 0.
      result = <rate>-value.
    ELSE.
      result = '1.00'.
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
      cut         TYPE REF TO zcl_order_pricing,
      fake_rates  TYPE REF TO ltcl_fake_rate.

    METHODS:
      setup,
      given_zero_amount_returns_zero       FOR TESTING,
      given_eur_passes_through             FOR TESTING,
      given_usd_converts_to_eur            FOR TESTING,
      given_rate_unavailable_raises        FOR TESTING.

ENDCLASS.

CLASS ltcl_order_pricing IMPLEMENTATION.

  METHOD setup.
    fake_rates = NEW ltcl_fake_rate( ).
    cut        = NEW zcl_order_pricing( rate_provider = fake_rates ).
  ENDMETHOD.

  METHOD given_zero_amount_returns_zero.
    DATA(result) = cut->total_in_eur(
                     VALUE #( amount = 0 currency = 'EUR' ) ).
    cl_abap_unit_assert=>assert_equals(
      act = result
      exp = CONV decfloat34( '0' )
      msg = 'Zero amount must yield zero total' ).
  ENDMETHOD.

  METHOD given_eur_passes_through.
    fake_rates->stub_rate( currency = 'EUR' value = '1.00' ).
    DATA(result) = cut->total_in_eur(
                     VALUE #( amount = '100' currency = 'EUR' ) ).
    cl_abap_unit_assert=>assert_equals(
      act = result
      exp = CONV decfloat34( '100' )
      msg = 'EUR amount should remain unchanged' ).
  ENDMETHOD.

  METHOD given_usd_converts_to_eur.
    fake_rates->stub_rate( currency = 'USD' value = '0.90' ).
    DATA(result) = cut->total_in_eur(
                     VALUE #( amount = '100' currency = 'USD' ) ).
    cl_abap_unit_assert=>assert_equals(
      act = result
      exp = CONV decfloat34( '90' )
      msg = '100 USD at 0.90 = 90 EUR' ).
  ENDMETHOD.

  METHOD given_rate_unavailable_raises.
    fake_rates->stub_raise( currency = 'XYZ' ).
    TRY.
        cut->total_in_eur(
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
4. **Setup per test.** Each test gets a fresh `cut` and fresh `fake_rates`. No leakage.
5. **Test names describe behavior.** Reading `given_zero_amount_returns_zero` tells you what the code does without opening the implementation.
6. **One concept per test.** Four scenarios → four methods. Failure messages point precisely to the broken behavior.
7. **Exception test forces failure first.** `fail( )` after the call that should raise; if no exception, the test reports the absence.

## How to run

In ADT or SE80: right-click the class → Run As → ABAP Unit Test. Or `Ctrl+Shift+F10` in ADT.

Verify the test run output shows 4 tests, 4 passed. If any failed, the assertion message and stack point at the problem.
