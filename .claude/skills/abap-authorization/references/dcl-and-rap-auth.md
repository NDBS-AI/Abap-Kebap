# CDS Access Control (DCL) & RAP Authorization — Deep Dive

Companion to [../SKILL.md](../SKILL.md). All syntax is from the SAP ABAP Keyword Documentation and the SAP-samples authorization cheat sheet. Use this when you need the full DCL grammar or a complete RAP authorization handler, beyond the summary in the main skill.

---

## Part 1 — CDS Access Control (DCL)

CDS access control answers a different question than `AUTHORITY-CHECK`. Instead of "is this user allowed to run this code?", it answers "**which rows of this view may this user see?**" — and the database enforces it. It applies to **read** access via ABAP SQL (and to RAP read in managed scenarios). It does **not** apply to direct access to the underlying database table, only to the CDS entity.

### The two pieces

1. The CDS view (DDL) carries `@AccessControl.authorizationCheck`, which decides whether access control is expected.
2. A CDS role (DCL) defines `grant select on <entity> where <access rule>`.

When both are present, every `SELECT ... FROM <entity>` implicitly gains the role's `where` condition, filtered for the current user.

### @AccessControl.authorizationCheck — the four options

```abap
@AccessControl.authorizationCheck: #CHECK
define view entity ZDEMO_ABAP_FLSCH_VE_AUTH
  as select from zdemo_abap_flsch
{
  key carrid,
  key connid,
      countryfr,
      ...
}
```

| Option | Meaning | When to use |
|---|---|---|
| `#NOT_REQUIRED` | No access control needed — full access to all users. | Genuinely public reference data only. **Flag in review otherwise.** |
| `#CHECK` | A warning is issued if no access control object is present. The view still works without one. | Migration / gradual rollout; not a final state for sensitive data. |
| `#MANDATORY` | An access control object must be present. | Sensitive data where a missing role must be an error, not a warning. |
| `#NOT_ALLOWED` | An access control object must not be present; if one exists it is disregarded. | Views that must never be row-filtered (e.g. technical/internal views). |

### Access rule kinds inside `define role`

A role grants `select` on an entity subject to an **access rule**. The cheat sheet example uses a **conditional** rule (`grant select on ... where ...`); the DCL language supports more. Consult the documentation for the complete set; the common ones:

| Rule kind | Form | Effect |
|---|---|---|
| Literal condition | `where (field) = 'value'` / `between` / `like` / `is [not] null` / `is [not] initial` | Static row filter independent of user authorizations. |
| PFCG-aspect condition | `where (field) = aspect pfcg_auth(<object>, <field>, ACTVT = '<nn>')` | Row filter bound to the user's PFCG authorization object/field values. The bridge to classic authorization objects. |
| Inheritance | `inheriting conditions from entity <other_entity>` | Reuses the access conditions already defined on another entity. |
| Combination | Multiple `grant` rules / conditions combined | See combination modes below. |

### Conditional access rule with `aspect pfcg_auth`

This is the canonical pattern — filter rows by what the user's PFCG authorization grants:

```abap
@EndUserText.label: 'Test'
@MappingRole: true
define role ZCDS_ACC_CTRL {
  grant
    select
      on
        ZDEMO_ABAP_FLSCH_VE_AUTH
          where
            (countryfr) = aspect pfcg_auth(zauth_obj, zauth_ctry, ACTVT = '03');
}
```

Reading it:
- `grant select on ZDEMO_ABAP_FLSCH_VE_AUTH` — this rule governs read access to that entity.
- `where (countryfr) = aspect pfcg_auth(...)` — a row is visible only if its `countryfr` value is covered by the user's authorization.
- `pfcg_auth(zauth_obj, zauth_ctry, ACTVT = '03')` — bind to authorization object `zauth_obj`, map view column `countryfr` to authorization field `zauth_ctry`, and require activity `03` (display).
- `@MappingRole: true` makes the role's grants effective (a mapping role is the kind evaluated at runtime).

Effect: a user authorized for country `US` with display activity sees only the `US` rows of the view, with **no WHERE clause in the calling ABAP** and **no `AUTHORITY-CHECK`** in the consuming code. Open the view's data preview (F8) and only `US` rows appear.

### Combination modes (multiple conditions / rules)

When a role defines more than one access condition, DCL combines them. The defaults:
- Conditions **within a single `where`** combine with logical `and` / `or` as written.
- Separate **`grant` rules** for the same entity combine by union (a row visible under any rule is visible).
- DCL also offers explicit combination/`redefinition` modes when inheriting — see the Access Control documentation for `inheriting conditions from entity ... combination mode ...`.

Practical guidance: keep one role per entity where possible; reach for inheritance only when several views genuinely share the same condition, so the authorization logic lives in one place.

### User conditions (`aspect user`) — current-user filtering

DCL exposes the current user through a **user condition**: the predefined aspect `user` on the right side of a condition (e.g. `where (created_by) = aspect user`), which compares the element with the logon name of the current user — the DCL counterpart of `$session.user` in DDL. Use it for ownership-style visibility ("show only rows whose `created_by` equals the current user") without needing a PFCG object. As with all DCL, it filters **read** access only; it is not a substitute for an `AUTHORITY-CHECK` guarding a modifying operation.

### DCL review checklist

- Does the view annotation match the sensitivity? `#NOT_REQUIRED` on business data is almost always wrong.
- Is there an actual `define role` for every `#CHECK` / `#MANDATORY` view?
- Does the `aspect pfcg_auth` reference the **right** object, the **right** field mapping, and the **right** `ACTVT`?
- Are the role's columns (`(countryfr)`) actually present and meaningful in the view?
- Is the view itself the only access path, or can callers reach the underlying table directly (bypassing DCL)? In ABAP Cloud, direct table access is restricted, which helps; in classic ABAP it is not.

> Source: [ABAP CDS — Access Control](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abencds_access_control.htm); [Access rules](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abencds_dcl_role_rules.htm); [CDS authorization concept](https://help.sap.com/docs/abap-cloud/abap-data-models/cds-authorization-concept); [abap-cheat-sheets/25_Authorization_Checks.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/25_Authorization_Checks.md)

---

## Part 2 — RAP Authorization

RAP authorization safeguards a business object from unauthorized data access. You declare it in the **BDEF** and implement it in **RAP handler methods** in the **ABAP behavior pool**.

- **Read** operations reuse **CDS access control** (above), automatically applied in managed scenarios.
- **Modify** operations (create / update / delete / actions) use **global** and/or **instance** authorization handlers.

### BDEF authorization clauses

In the BDEF, set authorization control for all RAP BO operations of an entity, or for particular operations. The entity that decides its own authorization is the `master`; child entities can be `dependent` to inherit the master's decision.

```abap
" Global authorization only
authorization master ( global )

" Both global and instance authorization
authorization master ( global, instance )

" A child entity that inherits the parent's authorization decision
authorization dependent by _Parent
```

- `global` — one decision for the whole BO, independent of any instance (typically role/activity based).
- `instance` — a per-instance decision based on the state of the affected rows.
- Both can be specified together; both handlers then run.
- The BDEF also supports **authorization contexts** and per-operation authorization. See the BDEF authorization documentation for the full syntax surface.

### Global authorization handler

Global authorization rejects an operation **before** the corresponding behavior handler method runs. For example, an unauthorized delete means the delete handler is never invoked.

Handler method declaration in the behavior pool:

```abap
METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR some_bdef RESULT result.
```

Implementation — check each requested activity against the authorization object. Note the **`DUMMY`** on the value field: global checks care about the *activity* (create/update/delete), independent of any instance's state.

```abap
METHOD get_global_authorizations.

  "Authorization check for create operations
  IF requested_authorizations-%create = if_abap_behv=>mk-on.

    AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
            ID 'ZAUTH_FIELD' DUMMY
            ID 'ACTVT'      FIELD '01'.

    result-%create = COND #( WHEN sy-subrc = 0 THEN if_abap_behv=>auth-allowed ELSE if_abap_behv=>auth-unauthorized ).
    "In case there is no authorization granted, you may want to add a message to the reported structure here.

  ENDIF.

  "Authorization check for update operations
  IF requested_authorizations-%update =  if_abap_behv=>mk-on.
    "Note: In draft scenarios, the Edit action is treated like an update operation.
    "So, you can add another condition such as ... OR requested_authorizations-%action-Edit =  if_abap_behv=>mk-on.

    AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
            ID 'ZAUTH_FIELD' DUMMY
            ID 'ACTVT'      FIELD '02'.

    result-%update  = COND #( WHEN sy-subrc = 0 THEN if_abap_behv=>auth-allowed ELSE if_abap_behv=>auth-unauthorized ).
    "result-%action-Edit    = COND #( WHEN sy-subrc = 0 THEN if_abap_behv=>auth-allowed ELSE if_abap_behv=>auth-unauthorized ).
    "In case there is no authorization granted, you may want to add a message to the reported structure here.
  ENDIF.

  "Authorization check for delete operations
  IF requested_authorizations-%delete = if_abap_behv=>mk-on.

    AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
            ID 'ZAUTH_FIELD' DUMMY
            ID 'ACTVT'      FIELD '06'.

    result-%delete = COND #( WHEN sy-subrc = 0 THEN if_abap_behv=>auth-allowed ELSE if_abap_behv=>auth-unauthorized ).
    "In case there is no authorization granted, you may want to add a message to the reported structure here.
  ENDIF.

ENDMETHOD.
```

Key points:
- `requested_authorizations-%create / %update / %delete = if_abap_behv=>mk-on` tells you which operations the framework is asking about — only check what was requested.
- Map the result with `if_abap_behv=>auth-allowed` / `if_abap_behv=>auth-unauthorized`.
- When unauthorized, you typically also append a message to `reported` so the consumer sees *why*.
- In **draft** scenarios the `Edit` action behaves like update — extend the `%update` condition with `OR requested_authorizations-%action-Edit = if_abap_behv=>mk-on` and set `result-%action-Edit` accordingly.

### Instance authorization handler

Instance authorization checks the **state of specific instances**. The handler reads the affected instances by key, then checks each one — here using the row's own field value (`r-some_field`), not `DUMMY`, because the decision depends on instance data.

Handler method declaration:

```abap
METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
     IMPORTING keys REQUEST requested_authorizations FOR some_bdef RESULT result.
```

Implementation:

```abap
METHOD get_instance_authorizations.

  "Reading all the instances with the imported keys into an internal table
  READ ENTITIES OF some_bdef IN LOCAL MODE
    ENTITY some_entity
    ALL FIELDS WITH CORRESPONDING #( keys )
    RESULT DATA(lt_res)
    ...

  IF lt_res IS INITIAL.
    RETURN.
  ENDIF.

  LOOP AT lt_res INTO DATA(ls_instance).

    ...

    "Covering only delete operations in the code snippet
    IF requested_authorizations-%delete = if_abap_behv=>mk-on.

      AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
         ID 'ZAUTH_FIELD' FIELD ls_instance-some_field
         ID 'ACTVT'       FIELD '06'.

      DATA(lv_is_delete_allowed) = COND #( WHEN sy-subrc = 0 THEN if_abap_behv=>auth-allowed ELSE if_abap_behv=>auth-unauthorized ).
    ENDIF.

    ...

    APPEND VALUE #( ...
                    %delete = lv_is_delete_allowed
                    ...
                  ) TO result.
  ENDLOOP.

ENDMETHOD.
```

Key points:
- Always read instances `IN LOCAL MODE` (the read inside an authorization handler must not itself trigger authorization recursion).
- Guard for an empty read result and `RETURN` early.
- The authorization field carries the **instance value** (`r-some_field`), which is exactly what makes this *instance* authorization rather than global.
- Append one `result` row per key with the per-operation decision.

### RAP precheck and PRIVILEGED mode

- **RAP BO precheck** validates incoming values against authorization (or other rules) **before** they reach the transactional buffer, so unwanted values are rejected early. See the BDEF `precheck` documentation.
- **`PRIVILEGED` mode** lets code circumvent the authorization checks performed by global/instance handlers — used by trusted framework-internal calls. Every `PRIVILEGED` EML call is a deliberate bypass; in a security review, each one must be justified and confined to trusted code paths.

### RAP authorization review checklist

- Is `authorization master ( ... )` declared on every entity that exposes modifying operations? Child entities `dependent` where appropriate?
- Does the global handler check **every** requested operation (`%create`, `%update`, `%delete`, relevant `%action`s)? A missing branch silently allows that operation.
- Is `sy-subrc` mapped to `auth-allowed` / `auth-unauthorized` for every check?
- For instance authorization: is the read `IN LOCAL MODE`, the empty result guarded, and the authorization field fed the **instance** value?
- Is `PRIVILEGED` used anywhere it should not be?
- For read protection: is CDS access control in place on the underlying view (Part 1)? Read access is *not* covered by these handlers.

> Source: [Authorization Control in RAP](https://help.sap.com/docs/abap-cloud/abap-rap/authorization-control?version=sap_btp); [Developing Authorization](https://help.sap.com/docs/abap-cloud/abap-rap/developing-authorization?version=sap_btp); [BDEF authorization syntax](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenbdl_authorization.htm); [Authorization context](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenbdl_authorization_context.htm); [PRIVILEGED](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapeml_privileged.htm); [RAP BO precheck](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenbdl_precheck.htm); [abap-cheat-sheets/25_Authorization_Checks.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/25_Authorization_Checks.md)

---

## See also

- [../SKILL.md](../SKILL.md) — the main authorization skill (AUTHORITY-CHECK, placement, common holes).
- [cds-views-authoring](../../cds-views-authoring/SKILL.md) — designing the CDS views that DCL protects.
- [rap-bo-modeling](../../rap-bo-modeling/SKILL.md) — the surrounding RAP BO (BDEF, behavior pool, projection).
- [abap-code-review](../../abap-code-review/SKILL.md) — security findings in a review context.
