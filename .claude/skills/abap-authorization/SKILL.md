---
name: abap-authorization
description: Use when writing or reviewing ABAP authorization and security — the AUTHORITY-CHECK statement (syntax, sy-subrc, ID ... FIELD ..., DUMMY); authorization objects, fields, values, and ACTVT; where to place an auth check so it cannot be bypassed; classic role/profile (PFCG) concepts; CDS access control (DCL define role, grant select on, aspect pfcg_auth); RAP authorization (master/dependent, global vs instance, the authorization handler method); ABAP Cloud authorization (IAM apps, business catalogs, business roles); or running a security review of who-can-do-what.
---

# ABAP Authorization & Security Checks

## Overview

In an SAP system you protect data by ensuring only authorized users can read or modify it. **ABAP SQL statements do not trigger any authorization check in the database** — `SELECT carrid, connid, fldate FROM ztable` reads every row the program can technically reach, regardless of who runs it — column projection does not add a row-level check. It is therefore the programmer's job to guard every protected operation with an explicit or implicit authorization check. This skill is security-critical: a check in the wrong place, on the wrong object, or with an unevaluated `sy-subrc` is a real vulnerability, not a style nit.

**Core principle:** the database trusts your code. Every entry point that reaches protected data must check authorization *before* the operation, at a boundary the caller cannot skip.

Authorization checks come in two forms:
- **Explicit** — `AUTHORITY-CHECK` statements you write by hand.
- **Implicit** — CDS access control (DCL) evaluated automatically for read access via ABAP SQL, and RAP authorization for transactional operations.

## When to Use

- Writing or reviewing any `AUTHORITY-CHECK` statement.
- Deciding *where* to place an auth check — at a report entry, a method boundary, an RFC, a RAP operation.
- Defining or reviewing authorization objects, fields, and `ACTVT` activity values.
- Writing CDS access control (DCL): `define role`, `grant select on`, `aspect pfcg_auth`.
- Implementing RAP authorization — global vs instance, the authorization handler method in the behavior pool.
- Building authorization in ABAP Cloud / Steampunk (IAM apps, business catalogs, business roles, IAM).
- Running a security review: "who can call this, and what can they reach once inside?"

**When NOT to use:**
- For CDS view design itself → [cds-views-authoring](../cds-views-authoring/SKILL.md). This skill covers only the DCL/access-control layer on top.
- For RAP behavior design (CRUD, actions, validations) → [rap-bo-modeling](../rap-bo-modeling/SKILL.md). This skill covers only the authorization clauses + handler.
- For a general code review where security is one of several axes → [abap-code-review](../abap-code-review/SKILL.md) (use the security checklist there, backed by this skill).
- For the transactional consistency model (commit boundaries, where the check sits relative to the LUW) → [abap-sap-luw](../abap-sap-luw/SKILL.md).

## The authorization concept

A user **authenticates** by logging in. Once authenticated, what they can do is governed by **authorizations**, which are values for the **fields** of an **authorization object**.

| Term | Meaning |
|---|---|
| Authorization object | A named container (e.g. `ZAUTH_OBJ`) grouping up to 10 authorization fields. The unit you check against. |
| Authorization field | A field of the object (e.g. `ZAUTH_CTRY`), typed by a DDIC data element (e.g. `LAND1`). Holds the values to check. |
| Value | The concrete value a user is allowed (e.g. country `US`). The check passes when the requested value is covered by the user's granted values. |
| `ACTVT` (activity) | A standard field naming the *operation*: `01` create, `02` change, `03` display, `06` delete (more exist). Almost every object should include it. |
| Authorization | The combination of object + field values assigned to a user, via a role/profile. |

The combination of object and field values defines **which activities a user may perform and which data they may access**. Common activity values worth memorizing:

| `ACTVT` | Activity |
|---|---|
| `01` | Create |
| `02` | Change |
| `03` | Display |
| `06` | Delete |

## The AUTHORITY-CHECK statement

`AUTHORITY-CHECK` checks whether an authorization is available for the **current user**, determined by the values set for the authorization fields of the object.

```abap
AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
    ID id1 FIELD val1
    ID id2 FIELD val2
    ID id3 DUMMY
    ... .
```

Rules of the statement:
- The **current user** is checked. In Standard ABAP an addition exists to check other users; in ABAP for Cloud Development it is always the current user.
- `'ZAUTH_OBJ'` is the authorization object name in **uppercase**. In ABAP for Cloud Development it **must be a literal** — it cannot be a (flat character-like) data object.
- `ID ... FIELD ...` specifies **at least one and at most 10** authorization fields. The field name (uppercase) follows `ID`; the value follows `FIELD`. The value may be a literal or a data object.
- `DUMMY` specifies that a field is **not** checked.
- The result is in **`sy-subrc`** — you **must** evaluate it.

### sy-subrc — evaluate it, always

| `sy-subrc` | Meaning |
|---|---|
| `0` | Check successful **or no check was performed** |
| `4` | Check **not** successful (user lacks the authorization / value not found) |
| `12` | No authorization found for the object (e.g. object does not exist for the user) |

> The `0` case is subtle: it also means *no check was performed* (for example, when every field carries `DUMMY`, or the field/object does not exist in a checkable form). Never treat "didn't fail" as "is allowed" without understanding why it passed.

```abap
AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
        ID 'ZAUTH_CTRY' FIELD 'US'
        ID 'ACTVT'      FIELD '03'.

IF sy-subrc = 0.
  " allowed — proceed with the protected operation
ELSE.
  " not allowed — raise an exception / message and stop. Do NOT proceed.
ENDIF.
```

### All listed fields must match

The check passes only when **every** non-`DUMMY` field matches a granted value. In the example object, CRUD is permitted only for country value `US`:

```abap
" Allowed: ZAUTH_CTRY 'US' and ACTVT '03' are both granted
AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
        ID 'ZAUTH_CTRY' FIELD 'US'
        ID 'ACTVT'      FIELD '03'.   " sy-subrc = 0

" Not allowed: 'DE' is not a granted country value
AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
        ID 'ZAUTH_CTRY' FIELD 'DE'
        ID 'ACTVT'      FIELD '03'.   " sy-subrc = 4

" Not allowed: ACTVT value '10' is not granted
AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
        ID 'ACTVT' FIELD '10'.        " sy-subrc = 4
```

### The DUMMY addition

`DUMMY` skips a field. Use it deliberately, and understand what it does to `sy-subrc`:

```abap
" ZAUTH_CTRY not checked, ACTVT checked and value exists → sy-subrc = 0
AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
  ID 'ZAUTH_CTRY' DUMMY
  ID 'ACTVT'      FIELD '03'.

" ZAUTH_CTRY not checked, ACTVT checked, value '10' does NOT exist → sy-subrc = 4
AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
  ID 'ZAUTH_CTRY' DUMMY
  ID 'ACTVT'      FIELD '10'.

" DUMMY on ALL fields → no check performed → sy-subrc = 0 (NOT a real grant!)
AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
  ID 'NON_EXISTENT' DUMMY
  ID 'ACTVT'        DUMMY.

" Non-existent authorization object → sy-subrc = 12, no authorization found
AUTHORITY-CHECK OBJECT 'NON_EXISTENT'
  ID 'NON_EXISTENT' DUMMY
  ID 'ACTVT'        DUMMY.
```

> The third case is a classic trap: `DUMMY` on every field returns `sy-subrc = 0` because *no check was performed* — it grants nothing but looks like success. A reviewer who sees all-`DUMMY` and an `IF sy-subrc = 0` "allow" branch has found a hole.

> Source: [ABAP Keyword Documentation — AUTHORITY-CHECK](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapauthority-check.htm); [abap-cheat-sheets/25_Authorization_Checks.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/25_Authorization_Checks.md)

## Where to place the check — the part that determines whether it works

The statement is trivial. **Placement is where security is won or lost.** A correct `AUTHORITY-CHECK` after the data is already read protects nothing.

Place the check:
- **At the boundary**, where untrusted callers enter — the report `START-OF-SELECTION` / `INITIALIZATION`, the public method, the RFC-enabled function module, the RAP operation handler. Not buried three calls deep where some callers skip it.
- **Before the protected operation**, never after. Check, then read/modify — not read, then check.
- **On every path** that reaches the data. If two entry points read the same table, both need the check (or both must funnel through one checked gateway).
- **Such that it cannot be bypassed.** A check in interactive mode that a batch/background path skips is not a control.

```abap
" WRONG — data already read before the check; the SELECT leaked everything
SELECT * FROM zsensitive INTO TABLE @DATA(rows).
AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ' ID 'ACTVT' FIELD '03'.
IF sy-subrc <> 0.
  RETURN.   " too late — rows already in memory, and a logging side effect may have fired
ENDIF.

" RIGHT — check first, read only if authorized
AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ' ID 'ACTVT' FIELD '03'.
IF sy-subrc <> 0.
  RAISE EXCEPTION TYPE zcx_not_authorized.
ENDIF.
SELECT carrid, connid, amount FROM zsensitive INTO TABLE @DATA(rows).
```

For finer-grained data filtering (per row, per country, per company code), prefer **CDS access control** so SADL/the CDS runtime layer returns only permitted rows when consumed through the CDS entity (ABAP SQL or RAP) — direct table access bypasses this entirely. See below.

## Classic role/profile concept (PFCG) — high level

In classic ABAP, authorizations reach users through **roles and profiles** maintained in transaction **PFCG** (the Profile Generator):

- A **role** bundles the transactions/apps a job needs, and PFCG derives the required **authorization objects** with their field values into an **authorization profile**.
- The profile is assigned to **users**; at logon the user's authorizations form their **authorization buffer**, which `AUTHORITY-CHECK` consults.
- Maintaining default check values for authorization objects per transaction is done via **SU24**; objects themselves are defined in **SU21**.
- This is the classic-ABAP path. The Cloud path (below) uses IAM apps, business catalogs, and business roles instead — but the *programming* side (`AUTHORITY-CHECK`, the object, the fields) is the same.

## CDS access control (DCL) — implicit checks for read access

Implicit authorization checks apply to CDS entities (including CDS view entities) when accessed via ABAP SQL, provided you defined **access conditions in a CDS role**. The role is written in **DCL** (Data Control Language) with `DEFINE ROLE`. The result: ABAP SQL returns **only the rows the user is permitted to see** — no `AUTHORITY-CHECK` in the consuming code, no leaking SELECT.

### Step 1 — annotate the view with @AccessControl.authorizationCheck

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

The annotation drives whether and how access control applies:

| Option | Effect |
|---|---|
| `#NOT_REQUIRED` | No access control needed — **full access to all users**. Use only for genuinely public data. |
| `#CHECK` | A **warning** is issued if no access control object is present. |
| `#MANDATORY` | An access control object **must** be present. |
| `#NOT_ALLOWED` | An access control object must **not** be present; if one exists it is disregarded. |

> `#NOT_REQUIRED` is the dangerous default to watch for in review: it exposes the entire view to everyone. Confirm it is intentional, not a forgotten placeholder.

### Step 2 — define the role and access rule (DCL)

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

What this says: grant `select` on the view **where** the `countryfr` column is covered by the user's authorization for object `zauth_obj`, field `zauth_ctry`, with activity `03` (display). A user authorized only for country `US` sees only `US` rows — automatically, at the database, with no WHERE clause in the calling code.

`aspect pfcg_auth(...)` binds the CDS condition to a **PFCG authorization object** and its fields, including the `ACTVT` value. This is the bridge between the declarative CDS layer and the classic authorization object.

> The full DCL grammar — literal/conditional/combination access rules, `inheriting conditions from entity`, user conditions (`aspect user`), combination modes — is in [references/dcl-and-rap-auth.md](references/dcl-and-rap-auth.md).

> Source: [ABAP CDS — Access Control](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abencds_access_control.htm); [abap-cheat-sheets/25_Authorization_Checks.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/25_Authorization_Checks.md)

## RAP authorization

In the RAP (RESTful ABAP Programming Model), authorization control safeguards business objects from unauthorized access. You declare it in the **behavior definition (BDEF)** per entity and implement it in **RAP handler methods** in the **ABAP behavior pool (ABP)**.

- **Read** operations: reuse **CDS access control** — automatically applied in managed scenarios. No extra handler needed.
- **Modify** operations (create/update/delete/actions): use dedicated authorization implementations.

Two kinds of modify authorization, which can be combined:

| Kind | Scope | Effect |
|---|---|---|
| **Global** | The entire RAP BO, regardless of instance. Often role-based. | If a user may not delete, the delete handler method is **never invoked** — the request is rejected before reaching any other behavior handler. |
| **Instance** | Based on the state of a specific entity **instance**. | Checks per key/row — e.g. "may delete only instances of country `US`". |

Declare the kind in the BDEF and a `master`/`dependent` designation:

```abap
" Global only
authorization master ( global )

" Both global and instance
authorization master ( global, instance )
```

`authorization master` means this entity decides its own authorization; child entities can be `authorization dependent` to inherit the parent's decision.

The **global authorization handler** method, checking activities (note `DUMMY` on the value field — global checks care about the *activity*, not instance state):

```abap
METHOD get_global_authorizations.

  IF requested_authorizations-%create = if_abap_behv=>mk-on.
    AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
            ID 'ZAUTH_FIELD' DUMMY
            ID 'ACTVT'      FIELD '01'.
    result-%create = COND #( WHEN sy-subrc = 0
                             THEN if_abap_behv=>auth-allowed
                             ELSE if_abap_behv=>auth-unauthorized ).
  ENDIF.

  IF requested_authorizations-%update = if_abap_behv=>mk-on.
    AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
            ID 'ZAUTH_FIELD' DUMMY
            ID 'ACTVT'      FIELD '02'.
    result-%update = COND #( WHEN sy-subrc = 0
                             THEN if_abap_behv=>auth-allowed
                             ELSE if_abap_behv=>auth-unauthorized ).
  ENDIF.

  IF requested_authorizations-%delete = if_abap_behv=>mk-on.
    AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
            ID 'ZAUTH_FIELD' DUMMY
            ID 'ACTVT'      FIELD '06'.
    result-%delete = COND #( WHEN sy-subrc = 0
                             THEN if_abap_behv=>auth-allowed
                             ELSE if_abap_behv=>auth-unauthorized ).
  ENDIF.

ENDMETHOD.
```

**Instance** authorization reads the affected instances and checks per row (here the field value `r-some_field`, not `DUMMY`, because instance state matters). Both the BDEF declaration and the full handler are in [references/dcl-and-rap-auth.md](references/dcl-and-rap-auth.md).

Two more RAP tools worth knowing:
- **RAP BO precheck** validates incoming values *before* they reach the transactional buffer — use it to reject bad values early.
- **`PRIVILEGED` mode** lets trusted code **circumvent** authorization checks (e.g. framework-internal EML calls). Powerful and dangerous: every `PRIVILEGED` call is a deliberate bypass and must be justified in review.

> Source: [Authorization Control in RAP](https://help.sap.com/docs/abap-cloud/abap-rap/authorization-control?version=sap_btp); [BDEF authorization syntax](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenbdl_authorization.htm)

## ABAP Cloud authorization specifics

In the SAP BTP ABAP Environment (Steampunk), the *programming* is identical (`AUTHORITY-CHECK`, authorization objects, fields, `ACTVT`), but **assignment** runs through a different chain than classic PFCG:

1. **Authorization field** — e.g. `ZAUTH_CTRY`, typed by a data element (`LAND1`). Created as a repository object in ADT.
2. **Authorization object** — e.g. `ZAUTH_OBJ`, with the field(s) plus the `ACTVT` activity field and its permitted activities (01/02/03/06...).
3. **IAM app** (Identity and Access Management) — e.g. an *External app* `ZIAM_AUTH_EXT`; on its *Authorizations* tab you add the authorization object and set the permitted field values (e.g. `ACTVT` = all, `ZAUTH_CTRY` = `US`). Publish locally.
4. **Business catalog** — e.g. `ZAUTH_BUS_CAT`, with the IAM app added. Publish locally.
5. **Business role** — e.g. `ZBR_AUTH_TEST`, created in the *Maintain Business Roles* Fiori app; add the business catalog and assign business users.

The runtime behavior is the same: `AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ' ...` consults what the user's business role grants. Remember the ABAP-Cloud constraint: the object name in `AUTHORITY-CHECK` must be a **literal**, never a variable.

> Source: [Create Authorization Model and App in SAP BTP, ABAP Environment](https://developers.sap.com/tutorials/abap-environment-authorization.html); [Identity and Access Management (IAM)](https://help.sap.com/docs/btp/sap-business-technology-platform/identity-and-access-management-iam)

## Common Mistakes

| Mistake | Why it is a hole | Fix |
|---|---|---|
| Check placed **after** the read/modify | Data already leaked / side effect already fired | Move the check before the protected operation |
| **`sy-subrc` not evaluated** after `AUTHORITY-CHECK` | The check ran but the result is ignored — equivalent to no check | Always `IF sy-subrc <> 0. <reject>. ENDIF.` |
| Treating `sy-subrc = 0` as "allowed" when all fields are `DUMMY` | `0` here means *no check was performed*, not "granted" | Only conclude "allowed" when a real field was checked against a real value |
| Missing **`ACTVT`** field in the check | Cannot distinguish display from change/delete — read-only users get write access | Include `ID 'ACTVT' FIELD '...'` with the correct activity |
| Checking the **wrong object** (copy-paste from another module) | Passes for users with the unrelated object; fails to protect the real data | Verify the object actually governs *this* data |
| Auth check only on the **interactive path**, skipped in **batch/background/RFC** | The control is bypassable | Put the check at a gateway every path funnels through |
| `@AccessControl.authorizationCheck: #NOT_REQUIRED` on sensitive data | Entire CDS view exposed to all users | Use `#MANDATORY`/`#CHECK` with a real DCL role |
| Forgotten DCL role on a `#CHECK`/`#MANDATORY` view | Warning ignored → no row filtering | Define the `define role ... grant select on ...` |
| `PRIVILEGED` mode left in non-framework code | Deliberately bypasses all authorization | Remove, or justify each use explicitly |
| Object name as a **variable** in ABAP Cloud `AUTHORITY-CHECK` | Syntax error / not allowed in Cloud | Use an uppercase **literal** |
| One auth field checked, another silently `DUMMY` | Partial check looks complete | Confirm every security-relevant field is checked, not skipped |

## References

- [references/dcl-and-rap-auth.md](references/dcl-and-rap-auth.md) — deep dive: full CDS DCL grammar (define role / grant / aspect / combination / inheritance / user conditions) and the RAP BDEF authorization clauses + global and instance handler implementations with example code.
- **ABAP Keyword Documentation — AUTHORITY-CHECK:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapauthority-check.htm
- **ABAP CDS — Access Control:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abencds_access_control.htm
- **CDS authorization concept (SAP Help):** https://help.sap.com/docs/abap-cloud/abap-data-models/cds-authorization-concept
- **Authorization Control in RAP:** https://help.sap.com/docs/abap-cloud/abap-rap/authorization-control?version=sap_btp
- **Identity and Access Management (IAM):** https://help.sap.com/docs/btp/sap-business-technology-platform/identity-and-access-management-iam
- **SAP-samples/abap-cheat-sheets — Authorization Checks:** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/25_Authorization_Checks.md
- Linked skills: [cds-views-authoring](../cds-views-authoring/SKILL.md) (DCL on views), [rap-bo-modeling](../rap-bo-modeling/SKILL.md) (RAP authorization), [abap-code-review](../abap-code-review/SKILL.md) (security checklist), [abap-sap-luw](../abap-sap-luw/SKILL.md) (check placement vs the LUW)
