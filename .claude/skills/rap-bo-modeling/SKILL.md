---
name: rap-bo-modeling
description: "Use when designing or implementing a RAP (RESTful ABAP Programming Model) business object — choosing managed vs unmanaged vs draft-enabled, writing behavior definitions (BDEF), scaffolding the behavior pool, the projection layer, and the service binding, and wiring CRUD end-to-end. Pulls the RAP architecture into one place so you can scaffold a BO. For the depth of actions, validations, determinations, and feature control use rap-actions-validations-determinations; for consuming or testing a BO via EML statements use rap-eml; for save-sequence enhancements and numbering use rap-saves-and-numbering."
---

# RAP Business Object Modeling

## Overview

A guide for designing and implementing RAP Business Objects. RAP is SAP's modern stack for transactional ABAP applications — it sits on CDS, defines transactional behavior declaratively (BDEF), and exposes everything via OData V4 for Fiori. Once internalized, RAP makes the boilerplate disappear; until then, it has a steep learning curve because there are five files per BO and each has its own grammar.

**Core principle:** RAP is built in layers. Each layer is small and focused. Treat each as its own design decision: data model (CDS), behavior contract (BDEF), behavior implementation (class), projection (consumption CDS + projection BDEF), and exposure (service definition + binding).

## When to Use

- Designing a new RAP BO for a custom transactional entity.
- Reviewing or extending an existing RAP BO.
- Migrating a classical ALV report + screen to RAP + Fiori.
- Writing tests against RAP BO behavior (EML in test framework).
- Choosing between managed, unmanaged, and abstract BO strategies.
- Adding actions, determinations, or validations to an existing BO.

**When NOT to use:**
- For a read-only consumption view → CDS only ([cds-views-authoring](../cds-views-authoring/SKILL.md)).
- For a simple SQL report → don't model a BO, just query.
- For RFC-only backends (no Fiori, no OData) → procedural or classical OO without RAP overhead.

## The five files of a RAP BO

```
Z_I_Customer.ddls            CDS interface (data + associations)        — data shape, "the entity"
Z_C_Customer.ddls            CDS composite (optional, often projection
                             via behavior)                              — combined shape if needed
Z_C_Customer.bdef            Behavior definition (BDEF)                 — declarative "what operations are possible"
zbp_z_c_customer.clas        Behavior implementation pool ("BP class")  — ABAP code "how each operation behaves"
Z_C_Customer_Projection.ddls Projection consumption CDS                 — what's exposed to OData/Fiori
Z_C_Customer_Projection.bdef Projection BDEF                            — which behavior to expose
Z_CUSTOMER_SD.srvd           Service definition                         — which projections to expose
Z_CUSTOMER_SB.srvb           Service binding                            — protocol + endpoint
```

Some of these can be consolidated (composite is optional, single-entity BOs collapse some layers), but understanding the pattern matters.

## Managed vs Unmanaged — pick once

For the save-sequence contract, additional/unmanaged save, and numbering in depth, see [rap-saves-and-numbering](../rap-saves-and-numbering/SKILL.md).

| Aspect | Managed | Unmanaged |
|---|---|---|
| Persistence | RAP framework auto-generates SAVE sequence | Your code does INSERT / UPDATE / DELETE |
| Locking | Framework handles | Your code (`ENQUEUE` / `DEQUEUE`) |
| Use when | New custom entities; you own the DB tables | Wrapping an existing legacy API (BAPI, function modules) |
| Effort | Low — most behavior auto-generated | High — implement every operation |
| Cloud compatibility | First-class | Possible but constrained |

**Default:** Managed. Choose unmanaged only when you can't change how persistence happens. For a complete unmanaged scaffold wrapping a legacy function-module API (BDEF, handlers, saver, EML proof), see [examples/unmanaged-bo/README.md](examples/unmanaged-bo/README.md).

## Draft — when to enable

Draft = user-editable state that hasn't been saved as a real instance yet. Required for Fiori "Object Page with edit" UX.

| Need draft? | When |
|---|---|
| Yes | Fiori app where user fills a form before save; multiple sessions of edit allowed; want crash-safe in-progress edits |
| No  | Pure API consumer; back-office bulk import; performance-critical writes |

Draft costs:
- Additional draft persistence table (auto-generated).
- More complex EML semantics for tests (you read from active OR draft).
- ETag and lifecycle to think about.

For the draft lifecycle end-to-end and a draft-aware custom action, see [examples/draft-action/README.md](examples/draft-action/README.md).

## BDEF — the contract

A managed BDEF for a simple BO:

```
managed implementation in class zbp_z_c_customer unique;
strict ( 2 );
with draft;

define behavior for Z_C_Customer alias Customer
persistent table zcustomer
draft table zcustomer_d
lock master total etag LastChangedAt
authorization master ( instance )
etag master LastChangedAt
{
  field ( readonly )         CustomerId, CreatedAt, CreatedBy, LastChangedAt, LastChangedBy;
  field ( mandatory )        Name;
  field ( numbering : managed ) CustomerId;

  create;
  update;
  delete;

  draft action Edit;
  draft action Activate optimized;
  draft action Discard;
  draft action Resume;
  draft determine action Prepare;

  validation validate_name on save { create; update; }
  determination set_audit_fields on save { create; update; }

  action ( features: instance ) block result [1] $self;
}
```

What each clause means:
- `managed implementation in class zbp_z_c_customer` — framework manages, code in this class.
- `strict ( 2 )` — strictest semantics; recommended for new BOs (catches more issues at design time).
- `with draft` — draft support enabled.
- `persistent table` / `draft table` — where rows live.
- `lock master` — which entity owns the lock (master for the root).
- `etag master LastChangedAt` — optimistic locking via etag field.
- `authorization master ( instance )` — instance-level auth (per row); use `( global )` for "anyone with the right object can do this".
- `field ( readonly )` — fields the framework refuses to write from outside.
- `field ( mandatory )` — must be filled before save.
- `field ( numbering : managed )` — framework assigns the key automatically (a UUID; the key field must have a 16-character byte-like type).
- Omitting the `numbering` characteristic makes the key **externally supplied** instead — the client determines it (e.g. a client-generated UUID) rather than the framework assigning it via early or late numbering. Pair it with `field ( mandatory : create, readonly : update )` so the key must be set on create and can't change afterward; the framework rejects duplicates at save. See [rap-saves-and-numbering](../rap-saves-and-numbering/SKILL.md) for the full early/late × internal/external numbering matrix.
- `create / update / delete` — standard CRUD.
- `draft action Edit / Activate / Discard / Resume / Prepare` — standard draft lifecycle.
- `validation … on save` — runs before save; failure prevents save.
- `determination … on save` — runs at save to populate or recompute.
- `action … block` — custom action method.

See [references/behavior-definition-syntax.md](references/behavior-definition-syntax.md) for BDL quick tables with pointers to the owning deep-dive skills. For a complete end-to-end scaffold (table, CDS views, BDEF, behavior pool, projection, service definition and binding), see [examples/managed-bo/README.md](examples/managed-bo/README.md).

## Behavior implementation — the class

For the full action/validation/determination/feature-control grammar and handler signatures, see [rap-actions-validations-determinations](../rap-actions-validations-determinations/SKILL.md).

A skeletal `zbp_z_c_customer`:

```abap
CLASS lhc_customer DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS:
      validate_name FOR VALIDATE ON SAVE
        IMPORTING keys FOR Customer~validate_name,

      set_audit_fields FOR DETERMINE ON SAVE
        IMPORTING keys FOR Customer~set_audit_fields,

      block FOR MODIFY
        IMPORTING keys FOR ACTION Customer~block RESULT result.

ENDCLASS.

CLASS lhc_customer IMPLEMENTATION.

  METHOD validate_name.
    READ ENTITIES OF Z_C_Customer IN LOCAL MODE
      ENTITY Customer
      FIELDS ( CustomerId Name )
      WITH CORRESPONDING #( keys )
      RESULT DATA(customers).

    LOOP AT customers ASSIGNING FIELD-SYMBOL(<customer>).
      IF strlen( <customer>-Name ) < 3.
        APPEND VALUE #( %tky = <customer>-%tky ) TO failed-customer.
        APPEND VALUE #( %tky = <customer>-%tky
                        %msg = new_message(
                                 id       = 'ZCUST_MSG'
                                 number   = '001'
                                 severity = if_abap_behv_message=>severity-error
                                 v1       = <customer>-Name )
                        %element-Name = if_abap_behv=>mk-on )
          TO reported-customer.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD set_audit_fields.
    READ ENTITIES OF Z_C_Customer IN LOCAL MODE
      ENTITY Customer
      FIELDS ( CustomerId )
      WITH CORRESPONDING #( keys )
      RESULT DATA(customers).

    MODIFY ENTITIES OF Z_C_Customer IN LOCAL MODE
      ENTITY Customer
      UPDATE
        FIELDS ( LastChangedAt LastChangedBy )
      WITH VALUE #( FOR <customer> IN customers
                    ( %tky          = <customer>-%tky
                      LastChangedAt = cl_abap_tstmp=>utclong2tstmp( utclong_current( ) )
                      LastChangedBy = cl_abap_context_info=>get_user_technical_name( ) ) )
      REPORTED DATA(update_reported).
  ENDMETHOD.

  METHOD block.
    " toggle Customer-Blocked = abap_true
    MODIFY ENTITIES OF Z_C_Customer IN LOCAL MODE
      ENTITY Customer
      UPDATE FIELDS ( Blocked )
      WITH VALUE #( FOR key IN keys ( %tky = key-%tky Blocked = abap_true ) )
      FAILED   DATA(failed_modify)
      REPORTED DATA(reported_modify).

    READ ENTITIES OF Z_C_Customer IN LOCAL MODE
      ENTITY Customer
      ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(blocked).

    result = VALUE #( FOR <blocked_customer> IN blocked
                      ( %tky = <blocked_customer>-%tky %param = <blocked_customer> ) ).
  ENDMETHOD.

ENDCLASS.
```

Key things:
- `cl_abap_behavior_handler` is the base; your handler classes are local (`lhc_*`).
- Always `READ ENTITIES OF …` before write — you cannot trust `keys` to contain non-key fields.
- `IN LOCAL MODE` bypasses RAP's own auth check (you're inside the BO; trust own writes).
- `failed-<entity>`, `reported-<entity>`, `mapped-<entity>` are the standard "return channels" — use them to communicate problems back to the framework.
- Messages use `if_abap_behv_message` interface + a message class.

## Saver class — `with unmanaged save` / `with additional save`

When the BDEF declares `with unmanaged save` or `with additional save`, you provide a **saver class** (`lsc_*`) that inherits from `cl_abap_behavior_saver` and overrides `save_modified`. The handler class (`lhc_*`) still handles actions, validations, determinations as normal — the saver class only handles the final persistence step.

```abap
CLASS lsc_zr_onlineshop DEFINITION
  INHERITING FROM cl_abap_behavior_saver.
  PROTECTED SECTION.
    METHODS save_modified REDEFINITION.
    METHODS cleanup_finalize REDEFINITION.  " optional
ENDCLASS.

CLASS lsc_zr_onlineshop IMPLEMENTATION.

  METHOD save_modified.
    " create-onlineshop, update-onlineshop, delete-onlineshop
    " are typed tables available in save_modified. Each row includes
    " the CDS entity fields plus %control (which fields were changed).

    DATA new_orders TYPE STANDARD TABLE OF zaonlineshop.

    IF create-onlineshop IS NOT INITIAL.
      new_orders = CORRESPONDING #( create-onlineshop MAPPING FROM ENTITY ).
      INSERT zaonlineshop FROM TABLE @new_orders.
    ENDIF.

    IF update-onlineshop IS NOT INITIAL.
      " Use %control to only update fields the consumer explicitly set
      LOOP AT update-onlineshop ASSIGNING FIELD-SYMBOL(<order_update>)
           WHERE %control-OverallStatus = if_abap_behv=>mk-on.
        UPDATE zaonlineshop
          SET overall_status = @<order_update>-OverallStatus
          WHERE order_uuid = @<order_update>-OrderUUID.
      ENDLOOP.
    ENDIF.

    IF delete-onlineshop IS NOT INITIAL.
      LOOP AT delete-onlineshop INTO DATA(order_to_delete).
        DELETE FROM zaonlineshop WHERE order_uuid = @order_to_delete-OrderUUID.
      ENDLOOP.
    ENDIF.
  ENDMETHOD.

  METHOD cleanup_finalize.
    " Called after save; optional cleanup (e.g. clearing cache, temp tables)
  ENDMETHOD.

ENDCLASS.
```

Key points:
- Name convention: `lsc_<CDS-entity-name>` (local saver class, no global class needed).
- `cl_abap_behavior_saver` base: override `save_modified` and optionally `cleanup_finalize` and `finalize`.
- In `save_modified`, the parameters `create-<entity>`, `update-<entity>`, `delete-<entity>` are pre-typed tables — rows carry the entity fields plus a `%control` component. By default only the key values are guaranteed to be populated; declare the save variant `... with full data` to have the full instance data passed to `save_modified` (avoids extra reads).
- `MAPPING FROM ENTITY` converts CDS element names to DDIC column names using the BDEF's `mapping for` block.
- With `with unmanaged save`: you own all persistence; the framework writes nothing.
- With `with additional save`: the framework writes first (to `persistent table`), then your `save_modified` runs — useful for change documents, business events, audit logs, external system calls.
- `%control-<FieldName> = if_abap_behv=>mk-on` means the consumer explicitly set that field; use this for selective UPDATE statements.

## EML — Entity Manipulation Language

EML is how non-framework code (tests, batch jobs, other BOs) drives a RAP BO. This section is the overview; the full statement catalog and BDEF derived-type reference live in [rap-eml](../rap-eml/SKILL.md).

```abap
MODIFY ENTITIES OF Z_C_Customer
  ENTITY Customer
  CREATE FIELDS ( Name City Country )
  WITH VALUE #( ( %cid = 'CUST1' Name = 'Acme' City = 'Berlin' Country = 'DE' ) )
  MAPPED   DATA(mapped_create)
  FAILED   DATA(failed_create)
  REPORTED DATA(reported_create).

COMMIT ENTITIES RESPONSE OF Z_C_Customer
  FAILED   DATA(failed_commit)
  REPORTED DATA(reported_commit).

IF failed_commit IS INITIAL.
  WRITE: / 'Customer created with id', mapped_create-customer[ 1 ]-%key-CustomerId.
ELSE.
  " inspect failed_commit-customer
ENDIF.
```

Pattern: `MODIFY ENTITIES … COMMIT ENTITIES` is the unit of work. Inside one work unit you can create + update + delete + action across multiple BOs; `COMMIT ENTITIES` makes it durable.

`%cid` = client-side correlation id (for CREATE; you don't know the key yet).
`%tky` = transactional key (`%key` plus `%is_draft` and, with late numbering, `%pid`) — prefer it over `%key`; valid for READ on draft and active.

See [references/eml-syntax.md](references/eml-syntax.md) for the operation set and result channels.

## Projection layer

The projection is what you expose:

```sql
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Customer — Fiori projection'
@Metadata.allowExtensions: true
@Search.searchable: true
@ObjectModel.semanticKey: [ 'CustomerId' ]
@UI.headerInfo: { typeName: 'Customer', typeNamePlural: 'Customers' }

define root view entity Z_C_Customer_Projection
  provider contract transactional_query
  as projection on Z_C_Customer as Customer
{
  @UI.lineItem: [ { position: 10 } ]
  key Customer.CustomerId,
  @UI.lineItem: [ { position: 20 } ]
  Customer.Name,
  @UI.lineItem: [ { position: 30 } ]
  Customer.City,
  Customer.Country,
  Customer.Blocked,
  /* …draft and audit fields… */
  Customer.LastChangedAt
}
```

And the projection BDEF (`Z_C_Customer_Projection.bdef`):
```
projection;
strict ( 2 );
use draft;

define behavior for Z_C_Customer_Projection alias Customer
{
  use create;
  use update;
  use delete;

  use action Edit;
  use action Activate;
  use action Discard;
  use action Resume;
  use action Prepare;
  use action block;

  // Validations and determinations of the base BO apply automatically —
  // there is no "use validation" / "use determination" in BDL.
}
```

The projection BDEF *uses* what the base BDEF defined; you can hide actions (don't `use` them) to expose a subset.

## Service Definition + Binding

```
@EndUserText.label: 'Customer service'
define service Z_CUSTOMER_SD {
  expose Z_C_Customer_Projection as Customer;
}
```

Binding: in ADT, create a Service Binding, target the Service Definition, choose protocol "OData V4 — UI", activate, and you get a URL. Plug that into a Fiori app or browse via the "Service Binding" preview.

## Decision matrix — quick reference

| Need | Pick |
|---|---|
| New custom entity, you own the tables | Managed |
| Wrapping a legacy BAPI | Unmanaged |
| Fiori with edit form | Draft enabled |
| API-only consumer | No draft |
| Custom action that returns the modified entity | Action with `result [1] $self` |
| Computed field set from other fields on save | Determination `on save` |
| Computed field set every time another field changes | Determination `on modify` |
| Reject save if rule fails | Validation `on save` |
| Reject a change before it reaches the buffer | Precheck on the operation/action — validations exist only `on save` (see [rap-actions-validations-determinations](../rap-actions-validations-determinations/SKILL.md)) |
| Per-row authorization | `authorization master ( instance )` + `for instance authorization` method |
| Same auth for all rows | `authorization master ( global )` |

## Common Mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Reading from `keys` and assuming non-key fields are there | NULL fields, wrong logic | Always `READ ENTITIES OF … FIELDS …` first |
| Forgetting `IN LOCAL MODE` inside the BO | Hidden auth re-check loops | Use `IN LOCAL MODE` for the BO's own reads/writes |
| Returning a result from `action` but not declaring `result [1] $self` in BDEF | Compiler error or empty result | Declare in BDEF |
| Determination `on save` for a field that the UI needs to show as you type | Field stays empty until save | Use `on modify` |
| Validation `on modify` that's slow | Editing feels slow | Move to `on save` if possible |
| Hardcoded message in `reported` without a message class | No translation, no message text in production | Use `new_message( id=… number=… severity=… )` referencing a T100 message |
| `strict ( 1 )` to "make it easier" | Hides design issues | Use `strict ( 2 )` for new BOs |
| Projection that exposes fields you didn't declare in the base view | Can't activate | Add to base; or skip in projection |
| Service binding activates but `$metadata` shows no entities | Forgot `expose … as` in service definition | Check service definition |
| Draft never goes away, even after save | Forgot `Activate optimized` or wrong `Activate` clause | Use `draft action Activate optimized` for managed draft |
| RAP test doubles return empty results | Test environment not initialized | Use `cl_cds_test_environment` / `cl_botd_txbufdbl_bo_test_env` properly; see [abap-unit-tdd](../abap-unit-tdd/SKILL.md) |

## References

- [references/behavior-definition-syntax.md](references/behavior-definition-syntax.md) — BDL quick tables (header clauses, behavior elements, draft actions) + pointers to the deep-dive skills
- [references/eml-syntax.md](references/eml-syntax.md) — EML verb and `%` component quick tables + pointers to [rap-eml](../rap-eml/SKILL.md)
- [examples/managed-bo/](examples/managed-bo/) — minimal managed BO scaffold
- [examples/unmanaged-bo/](examples/unmanaged-bo/) — unmanaged BO wrapping a legacy API
- [examples/draft-action/](examples/draft-action/) — draft + custom action example
- Deep-dive skills: [rap-eml](../rap-eml/SKILL.md), [rap-actions-validations-determinations](../rap-actions-validations-determinations/SKILL.md), [rap-saves-and-numbering](../rap-saves-and-numbering/SKILL.md), [rap-business-events-side-effects](../rap-business-events-side-effects/SKILL.md), [cds-entity-types](../cds-entity-types/SKILL.md)
- **RAP Development Guide:** https://help.sap.com/docs/abap-cloud/abap-rap/
- **SAP-samples/abap-platform-rap100** — RAP 100 hands-on workshop: https://github.com/SAP-samples/abap-platform-rap100
- **SAP-samples/abap-platform-rap110** — RAP 110: Building Fiori Apps with RAP (intermediate): https://github.com/SAP-samples/abap-platform-rap110
- **SAP-samples/abap-platform-rap630** — RAP 630: ABAP Cloud for developer extensibility: https://github.com/SAP-samples/abap-platform-rap630
- **SAP-samples/abap-platform-rap-workshops** — index of RAP workshop materials: https://github.com/SAP-samples/abap-platform-rap-workshops
- **SAP-samples/abap-platform-refscen-flight** — Flight Reference Scenario covering CDS + RAP end-to-end (use branch matching your release): https://github.com/SAP-samples/abap-platform-refscen-flight
- **EML examples** — in `abap-cheat-sheets` repo, file `08_EML_ABAP_for_RAP.md`: https://github.com/SAP-samples/abap-cheat-sheets/blob/main/08_EML_ABAP_for_RAP.md
- **SAP-samples/cloud-abap-rap** — examples and the RAP Generator for BTP ABAP environment: https://github.com/SAP-samples/cloud-abap-rap
- Linked skills: [cds-views-authoring](../cds-views-authoring/SKILL.md), [abap-oo-patterns](../abap-oo-patterns/SKILL.md), [abap-unit-tdd](../abap-unit-tdd/SKILL.md)
