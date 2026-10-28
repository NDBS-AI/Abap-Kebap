---
name: abap-unit-tdd
description: Use when writing ABAP Unit tests, applying TDD discipline in ABAP, designing test doubles for OO collaborators, doubling an external OData or HTTP client behind an interface seam so tests need no live service, replacing live DB calls with cl_osql_test_environment, doubling CDS views with cds_test_environment, mocking RAP behavior with the behavior test framework, or reviewing test code for risk_level / duration / determinism / isolation. Covers the TDD red-green-refactor cycle adapted to ABAP and the test-double catalog for OO, DB, CDS, RAP, and remote service clients.
---

# ABAP Unit + TDD

## Overview

A guide for writing ABAP Unit tests that are fast, isolated, deterministic, and useful — and for applying Test-Driven Development discipline in ABAP. Tests in ABAP fail more often than they should because they hit live DB, depend on system state, or test the framework instead of the logic. This skill covers the tools (test double frameworks) and the discipline (RED-GREEN-REFACTOR) that fix that.

**Core principle:** a test that fails for reasons unrelated to the code under test (flaky DB, time-of-day, sequence with other tests, customizing) is worse than no test — it trains people to ignore red.

## When to Use

- About to write or modify ABAP logic (TDD: write the test first).
- Reviewing or improving an existing test class.
- Designing a class to be testable (dependency injection points).
- Testing CDS views (data substitution).
- Testing RAP behavior (action / validation / determination).
- Choosing among test double frameworks (OSQL, CDS test, OO test double, behavior test runtime).
- Fixing flaky tests.

**When NOT to use:**
- For integration / E2E testing — those are separate disciplines.
- For purely manual exploratory testing.
- For testing pure SAP-delivered logic — that's SAP's job; test your *use* of it.

## TDD Cycle in ABAP

```
RED   →  Write a failing ABAP Unit test for the smallest behavior you want.
         Run it. Confirm it fails for the right reason (not a typo, not a missing class).
         |
GREEN →  Write the minimum ABAP code to make the test pass. No more.
         Run all tests. Green.
         |
REFACTOR → Improve the structure (extract method, rename, dedupe) without changing behavior.
           Run all tests. Still green.
           |
           Back to RED with the next smallest behavior.
```

### Running the cycle against a real system

When the ADT MCP tools are connected ([adt-mcp](../../../docs/adt-mcp.md)), RED and GREEN are tool calls, not judgments. Write the test in the object's local test-class include (`abap_object_list_file_uris` finds it), run `abap_unit_run_tests` for the object, and read the real failure or pass. A red you did not see, or a green you did not run, is not red or green: say which one you could not run. The deliberate-break check in "Verify your tests fail for the right reason" works the same way.

### Why TDD in ABAP

- Production code becomes testable by construction (you can't write code with hidden dependencies if a test must drive it).
- The test stays focused — each test exercises one thing.
- Refactor confidence — green tests give a safety net.
- Documentation — the test names describe behavior in English.

### Anti-pattern: tests after

Writing tests after the code exists usually produces tests that:
- Mirror the implementation, not the behavior.
- Skip the hard paths because the implementation didn't account for them.
- Add tests for cases already covered, leaving gaps in the cases that matter.

TDD avoids this by sequencing: test → code, not code → test.

## ABAP Unit basics

### Test class shape

```abap
CLASS ltcl_order_pricing DEFINITION
  FOR TESTING
  RISK LEVEL HARMLESS
  DURATION SHORT
  FINAL.

  PRIVATE SECTION.
    DATA mo_cut TYPE REF TO zcl_order_pricing.   " "code under test" — convention

    CLASS-METHODS:
      class_setup,                            " once before all tests in this class
      class_teardown.                         " once after all tests in this class

    METHODS:
      setup,                                  " before each test
      teardown,                               " after each test
      given_zero_amount_returns_zero FOR TESTING,
      given_blocked_customer_raises  FOR TESTING.

ENDCLASS.

CLASS ltcl_order_pricing IMPLEMENTATION.

  METHOD setup.
    mo_cut = NEW zcl_order_pricing( io_rate_provider = NEW ltcl_fake_rate( ) ).
  ENDMETHOD.

  METHOD given_zero_amount_returns_zero.
    DATA(lv_result) = mo_cut->total_in_eur( VALUE #( amount = 0 currency = 'EUR' ) ).
    cl_abap_unit_assert=>assert_equals(
      act = lv_result
      exp = CONV decfloat34( '0' )
      msg = 'Zero amount must yield zero total' ).
  ENDMETHOD.

  METHOD given_blocked_customer_raises.
    " arrange — set up the cut with a blocked customer context

    TRY.
        mo_cut->total_in_eur( VALUE #( amount = 100 currency = 'EUR' customer_blocked = abap_true ) ).
        cl_abap_unit_assert=>fail( 'Expected blocked customer to raise' ).
      CATCH cx_blocked_customer.
        " expected
    ENDTRY.
  ENDMETHOD.

ENDCLASS.
```

### Risk level and duration

| Risk level | Meaning |
|---|---|
| `HARMLESS` | Test does not change system settings or persistent data. What a unit test should be. |
| `DANGEROUS` | Test changes persistent data (DB). Must be intentional. |
| `CRITICAL` | Test changes system settings or customizing data. **This is the default when `RISK LEVEL` is omitted** — always declare `HARMLESS` explicitly. |

| Duration | Meaning |
|---|---|
| `SHORT` | Execution time of only a few seconds expected. The right choice for unit tests. |
| `MEDIUM` | Execution time of about one minute expected. |
| `LONG` | Execution time of more than one minute expected. Integration-ish. |

A typical unit test is `HARMLESS / SHORT`. If you find yourself marking a test `DANGEROUS / MEDIUM`, ask whether it's really a unit test.

### Assertion library — `cl_abap_unit_assert`

| Method | Use |
|---|---|
| `assert_equals( act = exp = msg = )` | The 90% case. Always include `msg`. |
| `assert_not_initial( act = msg = )` | Verify non-initial value |
| `assert_initial( act = msg = )` | Verify initial value |
| `assert_true( act = msg = )` | Boolean check |
| `assert_false( act = msg = )` | Boolean check |
| `assert_bound( act = msg = )` | Reference is bound |
| `assert_not_bound( act = msg = )` | Reference is unbound |
| `assert_subrc( exp = 0 msg = )` | After a built-in returns subrc |
| `assert_text_matches( … )` / `assert_text_not_matches( … )` | Text does / does NOT match a regular expression (`assert_char_cp`/`assert_char_np` use simple `*`/`?` wildcards instead, for non-regex pattern checks) |
| `assert_table_contains( line = table = msg = )` | Table contains row |
| `assert_table_not_contains( …  )` | Table does not contain |
| `fail( msg = )` | Force failure (use after a TRY that should have raised) |

See [references/assert-cheatsheet.md](references/assert-cheatsheet.md) for a one-page reference.

### One concept per test

If the test method name has `AND` in it, split:
- ❌ `test_create_and_compute_and_format`
- ✅ `test_create_returns_new_id`, `test_compute_with_two_rates`, `test_format_uses_user_locale`

If a single test has 5 assertions, prefer one structural assertion (table equality) over five field-level ones.

## Test doubles — the catalog

| Tool | Use when |
|---|---|
| Manual stub (local class implementing an interface) | OO collaborator — anytime you can use interface injection |
| Interface seam + hand-written local double (`ltd_*`) for an **external service client** (OData client proxy, HTTP, RFC) | The cut calls a remote service — put the call behind your own interface with neutral DTOs, double the interface; no `/iwbep` or HTTP type crosses the seam |
| Friend visibility "back door" | Setting up internal state of the cut for a specific scenario (sparingly) |
| `cl_osql_test_environment` | The cut does a SELECT against a table — substitute test data without hitting the live table |
| `cl_cds_test_environment` (`cds_test_environment`) | The cut reads a CDS view — substitute the underlying data via the test environment |
| `cl_abap_testdouble` (ABAP OO Test Double Framework) | Dynamic double of a global interface or non-final class without writing a local impl. Not usable for local classes/interfaces or classes declared `FINAL`, `FOR TESTING`, `CREATE PRIVATE`, or with mandatory constructor parameters |
| EML in the test + doubled persistence | Your own RAP BO's behavior — test action/validation/determination by driving the real BO via EML against `cl_cds_test_environment` / `cl_osql_test_environment` doubles; reset the transactional buffer with `ROLLBACK ENTITIES` in `teardown` |
| `cl_botd_txbufdbl_bo_test_env` | RAP transactional buffer double — the cut *consumes* another RAP BO via EML; the framework doubles that BO's transactional buffer |
| `cl_botd_mockemlapi_bo_test_env` | RAP mock EML API — intercepts EML calls (`MODIFY ENTITIES`, `READ ENTITIES`) without invoking a real BO; lets you configure responses and assert on what EML was called |

See [references/test-doubles.md](references/test-doubles.md) for which double to use in which scenario.

### Manual stub (preferred for OO)

```abap
CLASS ltcl_fake_rate DEFINITION
  FOR TESTING.
  PUBLIC SECTION.
    INTERFACES if_rate_provider.
ENDCLASS.

CLASS ltcl_fake_rate IMPLEMENTATION.
  METHOD if_rate_provider~rate.
    rv_result = SWITCH #( iv_currency
                     WHEN 'EUR' THEN '1.00'
                     WHEN 'USD' THEN '1.10'
                     WHEN 'TRY' THEN '0.03'
                     ELSE              '0.00' ).
  ENDMETHOD.
ENDCLASS.
```

Inject in `setup`:
```abap
mo_cut = NEW zcl_order_pricing( io_rate_provider = NEW ltcl_fake_rate( ) ).
```

### External service clients (OData / HTTP) behind an interface seam

The most common integration case — a class that calls a remote OData service through a client proxy — is doubled the same way as any collaborator, with one extra rule: **the interface exposes neutral DTOs, never proxy types.** Then the business logic runs deterministically with zero network, `RISK LEVEL HARMLESS`, `DURATION SHORT`.

```
Logic under test ──depends on──►  zif_rate_service_client  ◄──implements──  ltd_rate_service (test double, spies)
                                                          ◄──implements──  zcl_rate_service_client (prod: /iwbep proxy)
```

```abap
"! Test double for the remote rate service: canned DTOs in, call recording out.
CLASS ltd_rate_service DEFINITION FINAL FOR TESTING CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_rate_service_client.
    " Arrange knobs
    DATA mt_rates         TYPE zif_rate_service_client=>tt_rate.
    " Spies — assert the modifying call happened with the right payload
    DATA mv_publish_calls TYPE i.
    DATA mt_last_payload  TYPE zif_rate_service_client=>tt_rate.
ENDCLASS.

CLASS ltd_rate_service IMPLEMENTATION.
  METHOD zif_rate_service_client~read_rates.
    rt_rates = mt_rates.
  ENDMETHOD.
  METHOD zif_rate_service_client~publish_rates.   " spy: record, call nothing
    mv_publish_calls = mv_publish_calls + 1.
    mt_last_payload  = it_rates.
  ENDMETHOD.
ENDCLASS.

CLASS ltc_rate_sync DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    DATA mo_cut    TYPE REF TO zcl_rate_sync.
    DATA mo_client TYPE REF TO ltd_rate_service.
    METHODS setup.
    METHODS given_two_rates_when_sync_then_publishes_once FOR TESTING.
ENDCLASS.

CLASS ltc_rate_sync IMPLEMENTATION.
  METHOD setup.
    mo_client = NEW #( ).
    mo_cut    = NEW #( mo_client ).      " constructor injection of the seam
  ENDMETHOD.
  METHOD given_two_rates_when_sync_then_publishes_once.
    mo_client->mt_rates = VALUE #( ( currency = 'EUR' rate = '1.00' )
                                   ( currency = 'USD' rate = '1.10' ) ).
    mo_cut->synchronize( ).
    cl_abap_unit_assert=>assert_equals( act = mo_client->mv_publish_calls exp = 1 ).
  ENDMETHOD.
ENDCLASS.
```

A hand-written double beats `cl_abap_testdouble` here: the seam is small, the spies are explicit, and no destination or proxy is ever touched. A persistence side effect (e.g. "bookmark advanced on real runs, not on simulation runs") is spied the same way with a local subclass that redefines the write method and counts calls.

**What the seam does not prove.** Interface doubles verify *your* logic, never the *server's* contract. A payload the server rejects stays green through every test. Two obligations follow:

1. **A serialization test on the concrete client** — the body-building method is `PROTECTED`, the test class is a `LOCAL FRIENDS`, and the test asserts the exact JSON shape (a populated property present, an initial one **absent**). Pure `/ui2/cl_json`, no network, still `HARMLESS/SHORT`.

   ```abap
   METHOD given_rate_without_end_date_when_build_body_then_no_end_date_property.
     DATA(lv_json) = mo_cut->build_publish_body( VALUE #( ( currency = 'EUR' rate = '1.00' ) ) ).
     cl_abap_unit_assert=>assert_char_cp( act = lv_json exp = '*"Rate":"1.00"*' ).
     cl_abap_unit_assert=>assert_false( xsdbool( lv_json CS 'ValidityEndDate' ) ).
   ENDMETHOD.
   ```

2. **One live smoke path** — an `if_oo_adt_classrun` F9 simulation run against a known object — and the explicit statement in the hand-over that seam-tested code is not proof of remote compatibility.

### `cl_osql_test_environment`

When the cut does `SELECT … FROM zinvoice`, you can put test data into a doubled `zinvoice` for the duration of the test:

```abap
CLASS ltcl_overdue_finder DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.
  PRIVATE SECTION.
    CLASS-DATA mo_env TYPE REF TO if_osql_test_environment.
    CLASS-METHODS:
      class_setup,
      class_teardown.
    METHODS:
      setup,
      finds_only_overdue FOR TESTING.
ENDCLASS.

CLASS ltcl_overdue_finder IMPLEMENTATION.

  METHOD class_setup.
    mo_env = cl_osql_test_environment=>create(
            i_dependency_list = VALUE #( ( 'ZINVOICE' ) ) ).
  ENDMETHOD.

  METHOD class_teardown.
    mo_env->destroy( ).
  ENDMETHOD.

  METHOD setup.
    mo_env->clear_doubles( ).
  ENDMETHOD.

  METHOD finds_only_overdue.
    DATA lt_invoices TYPE TABLE OF zinvoice.
    lt_invoices = VALUE #(
      ( id = '1' status = 'O' due_date = sy-datum - 10 amount = '100' )
      ( id = '2' status = 'O' due_date = sy-datum + 5  amount = '200' )
      ( id = '3' status = 'P' due_date = sy-datum - 10 amount = '300' )
    ).
    mo_env->insert_test_data( i_data = lt_invoices ).

    DATA(lt_result) = NEW zcl_overdue_finder( )->find( as_of = sy-datum ).

    cl_abap_unit_assert=>assert_equals(
      act = lines( lt_result )
      exp = 1
      msg = 'Only the overdue open invoice should be returned' ).
  ENDMETHOD.

ENDCLASS.
```

### `cl_cds_test_environment`

For CDS views:

```abap
DATA(env) = cl_cds_test_environment=>create(
              i_for_entity = 'Z_C_OPENSALESORDERBYCUSTOMER' ).

env->insert_test_data( … ).
" run SELECT against Z_C_OpenSalesOrderByCustomer
env->destroy( ).
```

### Testing your own RAP BO — EML against doubled persistence

To test a BO's validations, determinations, and actions, drive the **real BO via EML** in the
test and double only its persistence: `cl_cds_test_environment` for the CDS entities,
`cl_osql_test_environment` for plain database tables. Issue `MODIFY ENTITIES … FAILED /
REPORTED` and assert on the responses. Reset the transactional buffer between tests:

```abap
METHOD teardown.
  ROLLBACK ENTITIES.          " clears the BO's transactional buffer between tests
ENDMETHOD.
```

When the cut *consumes another* RAP BO, double that BO instead with the RAP BO test double
framework: `cl_botd_txbufdbl_bo_test_env` (transactional buffer double) or
`cl_botd_mockemlapi_bo_test_env` (mock EML API).

See [examples/rap-test/README.md](examples/rap-test/README.md) for the full pattern.

## Test Seams (legacy code injection)

Test seams let you surgically replace a block of production code with test data during a unit test run, without refactoring the production code at all. They are a last resort for legacy code that cannot be restructured to accept interface injection.

**When to use:**
- Classic DB SELECTs in a method that has no interface to inject a repository.
- Authority checks (`AUTHORITY-CHECK`) that would reject the test user.
- System calls (`CALL FUNCTION 'ENQUEUE_...'`, RFC, OS commands) that must not run in test.
- Any code that cannot be made injectable without a larger refactoring you're not ready to do yet.

**Syntax — production code side:**

```abap
"TEST-SEAM <name> ... END-TEST-SEAM marks the block to be replaceable.
"Outside a test run the block executes normally.

DATA lt_orders TYPE TABLE OF zorders WITH EMPTY KEY.

TEST-SEAM read_orders.
  SELECT bukrs, vbeln, netwr, waers FROM zorders
    INTO TABLE @lt_orders
    WHERE bukrs = @company_code.
END-TEST-SEAM.
```

**Syntax — test class side:**

```abap
"TEST-INJECTION <name> ... END-TEST-INJECTION provides the replacement.
"The replacement runs in place of the seam block when the test executes.

TEST-INJECTION read_orders.
  lt_orders = VALUE #(
    ( bukrs = '1000' vbeln = '0000000001' netwr = '500' waers = 'EUR' )
    ( bukrs = '1000' vbeln = '0000000002' netwr = '200' waers = 'EUR' )
  ).
END-TEST-INJECTION.
```

**Before / after example — authority check seam:**

```abap
" ── PRODUCTION CODE (before) ─────────────────────────────────────────────
METHOD get_sensitive_data.
  AUTHORITY-CHECK OBJECT 'Z_SENS' ID 'ACTVT' FIELD '03'.
  IF sy-subrc <> 0.
    RAISE EXCEPTION TYPE cx_no_authority.
  ENDIF.
  " ... rest of the method
ENDMETHOD.

" ── PRODUCTION CODE (after — seam added, no logic change) ─────────────────
METHOD get_sensitive_data.
  TEST-SEAM authority_check.
    AUTHORITY-CHECK OBJECT 'Z_SENS' ID 'ACTVT' FIELD '03'.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE cx_no_authority.
    ENDIF.
  END-TEST-SEAM.
  " ... rest of the method
ENDMETHOD.

" ── TEST CLASS ─────────────────────────────────────────────────────────────
METHOD user_with_auth_gets_data FOR TESTING.
  " Inject empty block so the authority check is bypassed in this test.
  TEST-INJECTION authority_check.
  END-TEST-INJECTION.

  DATA(lv_result) = mo_cut->get_sensitive_data( ).
  cl_abap_unit_assert=>assert_not_initial(
    act = lv_result
    msg = 'Authorized user should receive data' ).
ENDMETHOD.
```

**Limitations and warnings:**
- Test seams are a tactical tool, not a design pattern. If you find yourself adding more than one or two seams to a class, refactor to use interface injection instead.
- Seam names are global within the include; avoid name collisions across multiple test classes.
- An empty injection (`TEST-INJECTION x. END-TEST-INJECTION.`) is valid and is the standard way to neutralize a block (e.g. skip an authority check or suppress an enqueue call).
- Test seams do NOT work in ABAP Cloud (Steampunk). In ABAP Cloud all DB dependencies must be isolated via `cl_osql_test_environment` / `cl_cds_test_environment` and authority checks via injected collaborators.

## Common Mistakes

| Mistake | Why | Fix |
|---|---|---|
| Test reads live DB | Flaky, depends on customizing / cleanup | `cl_osql_test_environment` / `cl_cds_test_environment` |
| Test passes only when run after another test | Order-dependent setup | `setup` / `teardown` for state; never rely on previous test |
| `RISK LEVEL DANGEROUS` on a unit test | Hides design issue | Refactor to use a double |
| Assert at the wrong layer (asserts what the framework did, not what the cut did) | Tests the framework | Assert the cut's outputs/state changes |
| 5+ assertions per test | Hard to read failure message | One concept; one structural assertion |
| Test name describes the test, not the behavior | "test_compute_1" | `given_two_lines_with_different_currency_when_total_then_eur_total` |
| Test depends on `sy-uname` / `sy-datum` | Fails for some users / dates | Inject the user/date as collaborator |
| Catching `cx_root` in a test | Test passes even on the wrong exception | Catch the specific expected exception |
| Forgetting `env->destroy( )` | Test environment leaks; next run flaky | `class_teardown` always destroys |
| Test asserts implementation detail (private state) | Brittle | Assert observable behavior |
| Setup does too much | Tests slow, brittle | Per-test setup, factory method |
| Test that never fails (test of nothing) | False sense of security | Verify it fails by introducing a deliberate bug |
| Proxy / HTTP types in the collaborator interface | Tests must build `/iwbep` objects; double becomes the proxy | Neutral DTOs in the interface; the adapter class owns the proxy |
| "All tests green" taken as proof the remote call works | Doubles never exercise the server's contract | Add a serialization test on the concrete client + one live F9 smoke run |
| Config string literals (comm scenario, service id) only exercised by the doubled client | Truncated literal compiles, tests pass, fails at runtime with "destination not found" | Diff literals against the real object names before the first live run ([abap-code-review](../abap-code-review/SKILL.md) checklist) |

## Verify your tests fail for the right reason

For each new test:
1. Run it. Confirm it **fails**.
2. Read the failure message — does it point to the *expected* problem, not a typo / compile error?
3. Implement the smallest code to make it pass.
4. Run again — confirm **green**.
5. Deliberately break the implementation in a small way (change `+` to `-`). Re-run. Confirm **failed** again.
6. Restore the implementation. Re-run. **Green** again.

Step 5 is the proof that the test actually exercises the logic you think it does.

## References

- [references/assert-cheatsheet.md](references/assert-cheatsheet.md) — `cl_abap_unit_assert` quick reference
- [references/test-doubles.md](references/test-doubles.md) — which double for which scenario
- [examples/oo-test/README.md](examples/oo-test/README.md) — minimal class + test class with stub injection
- [examples/cds-test/README.md](examples/cds-test/README.md) — testing a CDS view with `cl_cds_test_environment`
- [examples/rap-test/README.md](examples/rap-test/README.md) — testing a RAP BO via EML with doubled persistence
- **ABAP Unit:** https://help.sap.com/docs/abap-cloud/abap-rap/abap-unit
- **ABAP Test Cockpit (ATC):** https://help.sap.com/docs/btp/sap-abap-development-tools-user-guide/abap-test-cockpit
- **SAP-samples/abap-cheat-sheets — ABAP Unit examples:** https://github.com/SAP-samples/abap-cheat-sheets
- Linked skills: [abap-oo-patterns](../abap-oo-patterns/SKILL.md) (constructor injection for testability), [abap-systematic-debugging](../abap-systematic-debugging/SKILL.md) (regression-test discipline)
