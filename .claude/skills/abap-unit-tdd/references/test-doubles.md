# ABAP Test Doubles — Which One for Which Scenario

Selecting the right test double tool. Each ABAP technology has its preferred double; the wrong choice means painful setup or non-isolated tests.

## Decision matrix

| Cut depends on | Double tool |
|---|---|
| Another class via interface (you control construction) | Manual stub (local test class implementing the interface) |
| Another class via interface (you can't change construction) | `cl_abap_testdouble` — dynamic double of a global interface / non-final class |
| `SELECT … FROM <table>` directly | `cl_osql_test_environment` |
| `SELECT … FROM <cds_view>` | `cl_cds_test_environment` |
| Your own RAP BO's behavior (validation / determination / action) | EML in the test against the real BO + `cl_cds_test_environment` / `cl_osql_test_environment` for its persistence; `ROLLBACK ENTITIES` in `teardown` |
| Another RAP BO the cut consumes via EML | `cl_botd_txbufdbl_bo_test_env` (transactional buffer double) or `cl_botd_mockemlapi_bo_test_env` (mock EML API) |
| Authority check (`AUTHORITY-CHECK`) | Inject auth checker via interface; or restrict/grant authorizations in the test with `cl_aunit_authority_check` |
| `sy-uname` / `sy-datum` / `sy-uzeit` | Inject `cl_abap_context_info` calls via a wrapper; double the wrapper |
| Function module call | Wrap the FM in a method on a class with an interface; double the class |
| RFC destination call | Same — wrap the RFC call in a class behind an interface |
| File system (`OPEN DATASET`) | Wrap in interface; double the wrapper |

## Manual stub — the canonical pattern

The most common scenario: your class collaborates with another class through an interface. Constructor injection lets the test substitute a fake.

```abap
INTERFACE if_rate_provider PUBLIC.
  METHODS rate IMPORTING iv_currency     TYPE waers
               RETURNING VALUE(rv_result) TYPE decfloat34
               RAISING   cx_rate_unavailable.
ENDINTERFACE.

CLASS zcl_order_pricing DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    METHODS constructor IMPORTING io_rate_provider TYPE REF TO if_rate_provider.
    METHODS total_in_eur IMPORTING is_order       TYPE order_data
                         RETURNING VALUE(rv_result) TYPE decfloat34.
  PRIVATE SECTION.
    DATA mo_rate_provider TYPE REF TO if_rate_provider.
ENDCLASS.

" --- in test include ---
CLASS ltcl_fake_rate DEFINITION FOR TESTING.
  PUBLIC SECTION.
    INTERFACES if_rate_provider.
    METHODS:
      stub_rate IMPORTING iv_currency TYPE waers iv_value TYPE decfloat34,
      stub_raise IMPORTING iv_currency TYPE waers.
  PRIVATE SECTION.
    DATA mt_rates    TYPE HASHED TABLE OF rate_row WITH UNIQUE KEY currency.
    DATA mt_raises   TYPE TABLE OF waers.
ENDCLASS.

CLASS ltcl_fake_rate IMPLEMENTATION.
  METHOD stub_rate.
    INSERT VALUE #( currency = iv_currency value = iv_value ) INTO TABLE mt_rates.
  ENDMETHOD.
  METHOD stub_raise.
    APPEND iv_currency TO mt_raises.
  ENDMETHOD.
  METHOD if_rate_provider~rate.
    IF line_exists( mt_raises[ table_line = iv_currency ] ).
      RAISE EXCEPTION TYPE cx_rate_unavailable EXPORTING currency = iv_currency.
    ENDIF.
    READ TABLE mt_rates ASSIGNING FIELD-SYMBOL(<fs_rate>) WITH TABLE KEY currency = iv_currency.
    IF sy-subrc = 0.
      rv_result = <fs_rate>-value.
    ELSE.
      rv_result = '1.00'.   " default
    ENDIF.
  ENDMETHOD.
ENDCLASS.

" --- in test class ---
METHOD setup.
  mo_fake_rates = NEW ltcl_fake_rate( ).
  mo_cut        = NEW zcl_order_pricing( io_rate_provider = mo_fake_rates ).
ENDMETHOD.

METHOD test_eur_passes_through.
  mo_fake_rates->stub_rate( iv_currency = 'EUR' iv_value = '1.00' ).
  DATA(lv_result) = mo_cut->total_in_eur( VALUE #( amount = '100' currency = 'EUR' ) ).
  cl_abap_unit_assert=>assert_equals( act = lv_result exp = CONV decfloat34( '100' ) ).
ENDMETHOD.

METHOD test_raises_when_rate_unavailable.
  mo_fake_rates->stub_raise( iv_currency = 'XYZ' ).
  TRY.
      mo_cut->total_in_eur( VALUE #( amount = '100' currency = 'XYZ' ) ).
      cl_abap_unit_assert=>fail( 'Expected cx_rate_unavailable' ).
    CATCH cx_rate_unavailable.
      " expected
  ENDTRY.
ENDMETHOD.
```

## Interface seam for an external service client (OData / HTTP)

Same mechanics as the manual stub, one extra design rule: the interface carries **neutral DTOs**
(plain structures/tables of your own types), never `/iwbep/if_cp_*` or `if_web_http_*` types.
The concrete adapter class owns the client proxy and the mapping; the double returns canned DTOs
and records calls (spies). Tests then need no destination, no proxy model, no network — `RISK
LEVEL HARMLESS`, `DURATION SHORT`, order-independent.

Caveat to write into the test class header: **the double proves our logic, not the server's
contract.** Pair it with (a) a serialization unit test on the concrete client that asserts the
exact JSON body (populated members present, initial members absent), and (b) one live F9 smoke
run. Worked example in [../SKILL.md](../SKILL.md#external-service-clients-odata--http-behind-an-interface-seam).

## `cl_osql_test_environment` — when SELECT is unavoidable

Some logic genuinely depends on data from a table:

```abap
CLASS ltcl_overdue_finder DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.
  PRIVATE SECTION.
    CLASS-DATA mo_env TYPE REF TO if_osql_test_environment.
    CLASS-METHODS:
      class_setup,
      class_teardown.
    METHODS:
      setup,
      finds_overdue FOR TESTING.
ENDCLASS.

CLASS ltcl_overdue_finder IMPLEMENTATION.
  METHOD class_setup.
    mo_env = cl_osql_test_environment=>create(
            i_dependency_list = VALUE #( ( 'ZINVOICE' ) ( 'KNA1' ) ) ).
  ENDMETHOD.

  METHOD class_teardown.
    mo_env->destroy( ).
  ENDMETHOD.

  METHOD setup.
    mo_env->clear_doubles( ).
  ENDMETHOD.

  METHOD finds_overdue.
    DATA lt_invoices TYPE STANDARD TABLE OF zinvoice WITH EMPTY KEY.
    lt_invoices = VALUE #(
      ( id = '1' status = 'O' due_date = sy-datum - 5 amount = '100' kunnr = '1' )
      ( id = '2' status = 'O' due_date = sy-datum + 5 amount = '200' kunnr = '1' )
      ( id = '3' status = 'P' due_date = sy-datum - 5 amount = '300' kunnr = '1' ) ).
    mo_env->insert_test_data( i_data = lt_invoices ).

    DATA(lt_result) = NEW zcl_overdue_finder( )->find( as_of = sy-datum ).

    cl_abap_unit_assert=>assert_equals(
      act = lines( lt_result )
      exp = 1
      msg = 'Only one open overdue invoice' ).
  ENDMETHOD.
ENDCLASS.
```

Key:
- Declared in `class_setup` and destroyed in `class_teardown` — once per class run, not per test.
- `clear_doubles( )` in `setup` empties the doubled table for each test.
- The cut's `SELECT` against `zinvoice` and `kna1` is automatically routed to the doubled data.

## `cl_cds_test_environment` — when CDS view is involved

Similar shape, but registers the CDS view:

```abap
mo_env = cl_cds_test_environment=>create(
        i_for_entity = 'Z_C_OPENSALESORDERBYCUSTOMER' ).

DATA lt_sales_orders TYPE STANDARD TABLE OF z_i_salesorder WITH EMPTY KEY.
lt_sales_orders = VALUE #(
  ( SalesOrderId = '4500000001' CustomerId = '1' NetAmount = '100' Currency = 'EUR' ) ).
mo_env->insert_test_data( i_data = lt_sales_orders ).
```

The framework substitutes the base table; the CDS view evaluates on top of the substituted data.

## `cl_abap_testdouble` — dynamic class double (ABAP OO Test Double Framework)

When you cannot easily construct an interface-based double (e.g. the collaborator is a concrete SAP-delivered class), the ABAP OO Test Double Framework constructs a dynamic double:

```abap
DATA(lo_double) = CAST zif_other( cl_abap_testdouble=>create( 'ZIF_OTHER' ) ).
cl_abap_testdouble=>configure_call( lo_double )->returning( '42' ).
lo_double->some_method( ).   " records the configuration for this method
```

This is more setup than a manual stub but useful for legacy code that can't be retrofitted with interfaces immediately. Limitations: `cl_abap_testdouble` does not support local classes/interfaces, or classes declared `FINAL`, `FOR TESTING`, `CREATE PRIVATE`, or with constructors that have mandatory parameters.

## Testing your own RAP BO — EML against doubled persistence

```abap
CLASS ltcl_customer_create DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    CLASS-DATA mo_cds_env TYPE REF TO if_cds_test_environment.
    CLASS-METHODS:
      class_setup,
      class_teardown.
    METHODS:
      setup,
      teardown,
      create_with_short_name_fails FOR TESTING.
ENDCLASS.

CLASS ltcl_customer_create IMPLEMENTATION.

  METHOD class_setup.
    mo_cds_env = cl_cds_test_environment=>create(
                i_for_entity = 'Z_C_CUSTOMER' ).
  ENDMETHOD.

  METHOD class_teardown.
    mo_cds_env->destroy( ).
  ENDMETHOD.

  METHOD setup.
    mo_cds_env->clear_doubles( ).
  ENDMETHOD.

  METHOD teardown.
    ROLLBACK ENTITIES.   " reset the BO's transactional buffer between tests
  ENDMETHOD.

  METHOD create_with_short_name_fails.
    MODIFY ENTITIES OF Z_C_Customer
      ENTITY Customer
      CREATE FIELDS ( Name City Country )
      WITH VALUE #( ( %cid = 'C1' Name = 'AB' City = 'X' Country = 'DE' ) )
      FAILED   DATA(lt_failed)
      REPORTED DATA(lt_reported).

    cl_abap_unit_assert=>assert_not_initial(
      act = lt_failed-customer
      msg = 'Validation should reject 2-char name' ).
  ENDMETHOD.

ENDCLASS.
```

## Doubling a consumed RAP BO — `cl_botd_txbufdbl_bo_test_env`

When the cut *consumes* another RAP BO via EML, replace that BO's transactional buffer with a
double (the cut's EML statements then run for real against fake data):

```abap
CLASS-DATA mo_environment TYPE REF TO if_botd_txbufdbl_bo_test_env.

" class_setup:
mo_environment = cl_botd_txbufdbl_bo_test_env=>create(
  environment_config = cl_botd_txbufdbl_bo_test_env=>prepare_environment_config(
  )->set_bdef_dependencies( VALUE #( ( 'Z_C_CUSTOMER' ) ) ) ).

" setup:          mo_environment->clear_doubles( ).
" test method:    run MODIFY, assert on failed/reported, COMMIT, assert end state.
" class_teardown: mo_environment->destroy( ).
```

`cl_botd_mockemlapi_bo_test_env` follows the same lifecycle but mocks the EML API itself —
you script inputs/outputs per statement instead of doubling the buffer.

## Anti-patterns

| Anti-pattern | Why it's wrong | Fix |
|---|---|---|
| Double the cut itself | You're testing a fake, not the real code | Double collaborators, not the unit under test |
| Manual stub that re-implements the production class | Now the test is a second source of truth that drifts | Manual stub only covers the methods needed by the test |
| Live DB read "just for setup" | Flaky; coupled to system state | Use the test environment |
| Double a SAP API class with `cl_abap_testdouble` to "skip" SAP logic | You may skip exactly what the test needs to verify | Wrap the SAP call in your own interface; double *your* wrapper |
| Treat a green interface-double suite as proof the remote payload is accepted | The server's contract is never exercised | Serialization test on the concrete client + live smoke path |
| Many doubles per test | The cut has too many collaborators | Refactor: extract a façade collaborator |
| Test class touches another test class's doubles | Shared state breaks isolation | Each test class owns its environment |
| Forgetting `ROLLBACK ENTITIES` in RAP BO tests | Previous test's MODIFY leaks into this test | Always roll back in `teardown` |

## When to use what — quick chart

```
                          Cut directly does …
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
        SELECT FROM           Call other         EML on RAP BO
       <table>/<view>      class via iface
              │                   │                   │
              ▼                   ▼                   ▼
   cl_osql_test_env       Manual stub          Own BO: EML + doubled
   cl_cds_test_env        (preferred)          persistence + ROLLBACK ENTITIES
                          OR cl_abap_testdouble
                          (when iface absent)   Consumed BO: cl_botd_txbufdbl_bo_test_env
                                                or cl_botd_mockemlapi_bo_test_env
```
