# RAP BO Test Example — EML with Doubled Persistence

Testing the validations / determinations / actions of a RAP business object in isolation: drive the real BO via EML while `cl_cds_test_environment` doubles its persistence, and reset the transactional buffer with `ROLLBACK ENTITIES` between tests.

This builds on the Customer BO from `rap-bo-modeling/examples/managed-bo/`.

## Test class

```abap
CLASS ltcl_customer_bo DEFINITION
  FOR TESTING
  RISK LEVEL HARMLESS
  DURATION SHORT
  FINAL.

  PRIVATE SECTION.

    CLASS-DATA mo_cds_env TYPE REF TO if_cds_test_environment.

    CLASS-METHODS:
      class_setup,
      class_teardown.

    METHODS:
      setup,
      teardown,

      create_with_short_name_fails              FOR TESTING,
      create_valid_customer_succeeds            FOR TESTING,
      block_action_sets_blocked_flag            FOR TESTING,
      determine_sets_audit_fields_on_save       FOR TESTING.

ENDCLASS.

CLASS ltcl_customer_bo IMPLEMENTATION.

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

  " ----- validation -----

  METHOD create_with_short_name_fails.
    MODIFY ENTITIES OF Z_C_Customer
      ENTITY Customer
      CREATE FIELDS ( Name City Country )
      WITH VALUE #( ( %cid = 'C1' Name = 'AB' City = 'Berlin' Country = 'DE' ) )
      FAILED   DATA(lt_failed)
      REPORTED DATA(lt_reported)
      MAPPED   DATA(lt_mapped).

    cl_abap_unit_assert=>assert_not_initial(
      act = lt_failed-customer
      msg = 'Two-character name should be rejected by validate_name' ).

    cl_abap_unit_assert=>assert_not_initial(
      act = lt_reported-customer
      msg = 'Validation failure should produce a reported message' ).
  ENDMETHOD.

  METHOD create_valid_customer_succeeds.
    MODIFY ENTITIES OF Z_C_Customer
      ENTITY Customer
      CREATE FIELDS ( Name City Country )
      WITH VALUE #( ( %cid = 'C1' Name = 'Acme Industries' City = 'Berlin' Country = 'DE' ) )
      FAILED   DATA(lt_failed)
      MAPPED   DATA(lt_mapped).

    cl_abap_unit_assert=>assert_initial(
      act = lt_failed-customer
      msg = 'Valid customer must not fail' ).

    cl_abap_unit_assert=>assert_not_initial(
      act = lt_mapped-customer
      msg = 'Mapping should contain assigned CustomerId' ).

    DATA(lv_new_id) = lt_mapped-customer[ 1 ]-CustomerId.
    cl_abap_unit_assert=>assert_not_initial(
      act = lv_new_id
      msg = 'Managed numbering should have produced a key' ).
  ENDMETHOD.

  " ----- action -----

  METHOD block_action_sets_blocked_flag.
    " arrange: create a customer first
    MODIFY ENTITIES OF Z_C_Customer
      ENTITY Customer
      CREATE FIELDS ( Name City Country )
      WITH VALUE #( ( %cid = 'C1' Name = 'Acme Industries' City = 'Berlin' Country = 'DE' ) )
      MAPPED DATA(lt_mapped).

    DATA(lv_id) = lt_mapped-customer[ 1 ]-CustomerId.

    " act: execute block action
    MODIFY ENTITIES OF Z_C_Customer
      ENTITY Customer
      EXECUTE block FROM VALUE #( ( CustomerId = lv_id ) )
      RESULT DATA(lt_result)
      FAILED DATA(lt_failed).

    cl_abap_unit_assert=>assert_initial(
      act = lt_failed-customer
      msg = 'Block action should succeed' ).

    " assert: read back, Blocked = true
    READ ENTITIES OF Z_C_Customer
      ENTITY Customer
      ALL FIELDS WITH VALUE #( ( CustomerId = lv_id ) )
      RESULT DATA(lt_customers).

    cl_abap_unit_assert=>assert_equals(
      act = lt_customers[ 1 ]-Blocked
      exp = abap_true
      msg = 'Blocked flag should be set after action' ).
  ENDMETHOD.

  " ----- determination -----

  METHOD determine_sets_audit_fields_on_save.
    MODIFY ENTITIES OF Z_C_Customer
      ENTITY Customer
      CREATE FIELDS ( Name City Country )
      WITH VALUE #( ( %cid = 'C1' Name = 'Acme Industries' City = 'Berlin' Country = 'DE' ) )
      MAPPED DATA(lt_mapped).

    COMMIT ENTITIES RESPONSE OF Z_C_Customer
      FAILED   DATA(lt_failed_save)
      REPORTED DATA(lt_reported_save).

    cl_abap_unit_assert=>assert_initial(
      act = lt_failed_save-customer
      msg = 'Expected on-save determination to commit without errors' ).

    DATA(lv_id) = lt_mapped-customer[ 1 ]-CustomerId.

    READ ENTITIES OF Z_C_Customer
      ENTITY Customer
      ALL FIELDS WITH VALUE #( ( CustomerId = lv_id ) )
      RESULT DATA(lt_customers).

    cl_abap_unit_assert=>assert_not_initial(
      act = lt_customers[ 1 ]-LastChangedAt
      msg = 'Determination set_audit_fields should have populated LastChangedAt' ).

    cl_abap_unit_assert=>assert_equals(
      act = lt_customers[ 1 ]-LastChangedBy
      exp = cl_abap_context_info=>get_user_technical_name( )
      msg = 'LastChangedBy should be the executing user' ).
  ENDMETHOD.

ENDCLASS.
```

## Why this works

- `cl_cds_test_environment` creates a doubled persistence layer for the BO's underlying CDS. No real `zcustomer` writes happen.
- `ROLLBACK ENTITIES` in `teardown` resets the BO's transactional buffer, so no state leaks between tests.
- Each test follows arrange / act / assert; setup is minimal because we exercise via EML.
- Validations are tested by attempting an invalid CREATE and asserting on `failed` / `reported`.
- Determinations are tested by doing a CREATE, then COMMIT ENTITIES (which triggers the on-save sequence), then reading back the determined fields.
- Actions are tested by creating first, then executing the action, then reading back.

## Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Forgot `ROLLBACK ENTITIES` | Previous test's MODIFY leaks | Always roll back in `teardown` |
| Tried to read fields the test data didn't set | Empty values; flaky test | Insert defaults via the CREATE itself |
| Test asserted on dates without tolerance | `LastChangedAt` differs by microseconds across runs | Use `assert_not_initial` for system timestamps; only assert exact values if you set them |
| EML returns failed but test passes | `failed` is the success-channel inversion | Always check `failed` first; `assert_initial` on success, `assert_not_initial` on expected failure |
| Test depends on a sequence of test methods | Order-dependent | Each test arranges its own data inside the test method, not in shared setup |
| Commit not called, then test passes anyway | Pre-commit buffer contents | If your test relies on commit-time logic (an on-save determination/validation), use `COMMIT ENTITIES RESPONSE OF ... FAILED ... REPORTED ...` and assert on `failed`/`reported` — see `determine_sets_audit_fields_on_save` above |
| `mo_cds_env` not destroyed | Stale doubles across runs | `class_teardown` must destroy |
| Test passes against `mo_cds_env` but the real BO fails | The double doesn't simulate all the BO's reality (RAP locking, draft, etc.) | Add an integration test in a separate test class with looser isolation, and accept it runs slower |

## Where to expand

- Add a test for the draft lifecycle: Edit → Update → Activate, then verify the active state.
- Add a test for `validate_name` `on save { update }` with a UPDATE EML statement (not just CREATE).
- Add a test for `get_instance_authorizations` if the BO uses per-instance auth.
