---
name: cds-views-authoring
description: "Use when writing or reviewing CDS views — choosing between basic interface, composite, and consumption views; picking the right annotations (@AbapCatalog, @AccessControl, @EndUserText, @ObjectModel, @Search, @UI, @Consumption); deciding association vs join; handling parameters and table functions; avoiding deep view chains and join expansion surprises; or working within ABAP Cloud / Steampunk DDIC restrictions. For artifact kinds beyond a plain view (provider contracts, custom and abstract entities, table function implementations, hierarchies) use cds-entity-types; for Fiori Elements @UI annotation depth use fiori-elements-ui-annotations."
---

# CDS Views — Authoring Guide

## Overview

A guide for designing and reviewing Core Data Services (CDS) views in ABAP. CDS is SAP's data modeling language on the database — it lets you express joins, aggregations, hierarchies, and authorization in a declarative, reusable way that runs on the DB and is consumable from ABAP, OData, RAP, and Fiori.

**Core principle:** CDS is a *layered modeling* tool. Build small composable basic views; combine them via associations; expose the right shape at the consumption layer. Resist the urge to write one giant CDS view that does everything — it becomes the new "god SELECT" and performs accordingly.

## When to Use

- Designing a new CDS view for an entity (master data or transactional).
- Refactoring procedural SELECTs into CDS for reuse.
- Reviewing an existing CDS view for clarity, layering, performance, and ABAP Cloud compatibility.
- Adding annotations for Fiori UI (`@UI`), search (`@Search`), value help (`@Consumption.valueHelp`), or RAP behavior.
- Choosing between CDS view, CDS table function (AMDP), and procedural ABAP for a read scenario.

**When NOT to use:**
- For modifying data — CDS is read-only; use RAP BO ([rap-bo-modeling](../rap-bo-modeling/SKILL.md)).
- For one-off, never-reused SELECT — overhead exceeds benefit.
- For procedural logic that can't be expressed declaratively — write it in ABAP or AMDP.

## VDM Layering — pick a layer per view

SAP's Virtual Data Model (VDM) prescribes three primary CDS layers. Use them consistently — review feedback dries up.

| Layer | Naming | Purpose | Annotations |
|---|---|---|---|
| **Basic / Interface** | `Z_I_*` | One entity, faithful to source. Join only to closely-bound master. No business logic. | `@AbapCatalog.viewEnhancementCategory: [#NONE]`, `@AccessControl.authorizationCheck: #CHECK`, `@EndUserText.label: '…'` |
| **Composite** | `Z_C_*` | Combines / aggregates / transforms multiple basics for a business purpose. | Same plus `@VDM.viewType: #COMPOSITE` |
| **Consumption** | `Z_P_*` or `Z_C_*Projection` | Exposes a shape for OData / Fiori / RAP. `@UI`, `@Search`, `@Consumption` live here. | `@OData.publish: true` (on-prem) or via service binding (cloud) |

See [references/vdm-layering.md](references/vdm-layering.md) for the long form.

**Anti-pattern:** Putting `@UI` annotations on a basic view. Now the basic view is owned by a UI — its evolution is constrained by Fiori needs.

## RAP Integration — root view and compositions

When a CDS view is the root of a RAP business object data model, it is declared with `define root view entity`. Child entities link back with a `composition` on the root side and an `association to parent` on the child side.

```sql
-- Root entity (parent)
@AccessControl.authorizationCheck: #NOT_REQUIRED
define root view entity Z_I_Order
  as select from zorder_db
  composition [0..*] of Z_I_OrderItem as _Items
{
  key order_id  as OrderId,
      status    as Status,
      _Items
}

-- Child entity
define view entity Z_I_OrderItem
  as select from zorder_item_db
  association to parent Z_I_Order
    as _Order on $projection.OrderId = _Order.OrderId
{
  _Order,
  key order_id   as OrderId,
  key item_id    as ItemId,
      description as Description
}
```

Key rules:
- `define root view entity` — marks the root of a RAP BO; only one root per BO hierarchy.
- `composition [0..*] of ChildEntity as _Child` — declares the parent-to-child relationship; the child entity is fully owned by the parent.
- `association to parent ParentEntity as _Parent on $projection.ParentId = _Parent.ParentId` — back-link from child to parent; exposes navigation from child to root.
- This CDS layer sits directly beneath a RAP BDEF (`define behavior for Z_I_Order …`). The BDEF references the root view entity.
- Compositions enforce lifecycle coupling: deleting the root cascades to children in managed RAP.

**Projection (consumption) view** — the layer that OData / Fiori sees. Declared with `as projection on` and the `provider contract` keyword:

```sql
define root view entity Z_C_Order_P
  provider contract transactional_query
  as projection on Z_I_Order as Order
{
  key Order.OrderId,
      Order.Status,
      Order._Items  " expose association for navigation
}
```

- `provider contract transactional_query` — required for RAP transactional query providers (OData V4 read/write via service binding). Without this keyword the framework does not recognise the view as a RAP projection.
- `provider contract analytical_query` — for analytical queries (SAP Analytics Cloud, `@Analytics.query: true`).
- The projection view must mirror every element consumed by the corresponding projection BDEF.

## Annotation categories

CDS annotations are grouped by purpose. Each has a different audience.

| Category | Audience | Typical annotations |
|---|---|---|
| `@AbapCatalog.*` | DDIC / activation framework | `viewEnhancementCategory`, `compiler.compareFilter` |
| `@AccessControl.*` | Authorization | `authorizationCheck: #CHECK | #NOT_REQUIRED` |
| `@EndUserText.*` | Translatable text | `label`, `quickInfo` |
| `@ObjectModel.*` | Foundation / readability hints | `representativeKey`, `text.element`, `usageType.dataClass`, `semanticKey` |
| `@Semantics.*` | Data semantics for consumers | `amount.currencyCode`, `quantity.unitOfMeasure`, `date.original`, `currencyCode` |
| `@Search.*` | Free-text search | `searchable`, `defaultSearchElement`, `fuzzinessThreshold` |
| `@UI.*` | Fiori list/object pages | `lineItem`, `headerInfo`, `facet`, `selectionField`, `hidden` |
| `@Consumption.*` | OData / consumption | `valueHelp`, `filter`, `derivation` |
| `@Analytics.*` | Analytical (cubes / dimensions) | `dataCategory: #CUBE`, `dataExtraction.enabled` |
| `@Metadata.*` | Tooling | `layer`, `allowExtensions` |
| `@VDM.*` | VDM compliance | `viewType: #BASIC | #COMPOSITE | #CONSUMPTION` |

See [references/annotations-reference.md](references/annotations-reference.md) for a per-annotation reference card.

## Associations vs joins

**Use an association** when:
- The related entity is referenced *optionally* by some consumers and not others. Joins are eager; associations are lazy.
- The cardinality is `[1..1]` or `[1..*]` and consumers may want to traverse from the parent.
- You want OData consumers (Fiori, RAP) to navigate the relationship.

**Use a join** (`inner join`, `left outer join`) when:
- Every row in the result *requires* the joined data.
- The result set is intrinsically the cross product.
- You're inside a composite view computing aggregates.

**Less-common join types** (supported in CDS, rarely needed in business code):
- `right outer join` — symmetric to `left outer join`; keeps all rows from the *right* source, filling NULLs on the left where there is no match. In practice, swap the table order and use `left outer join` instead — it reads more naturally.
- `cross join` — Cartesian product of both sources; no `ON` condition is allowed. Row count = left rows × right rows. Only use when a genuine combination of all rows is needed (e.g., a calendar/entity matrix); accidental cross joins are a common performance disaster.

**Anti-pattern:** Exposing 10 associations on a basic view "in case someone needs them". Each association is a contract; future changes to the target view affect every consumer.

**Best practice:** Expose associations *only* where used by a consumer; the composite/consumption layer is where you wire them.

```sql
define view entity Z_I_SalesOrder
  as select from vbak as so
  association [0..*] to Z_I_SalesOrderItem as _Items
    on $projection.SalesOrderId = _Items.SalesOrderId
  association [1..1] to Z_I_Customer      as _Customer
    on $projection.CustomerId = _Customer.CustomerId
{
  key so.vbeln as SalesOrderId,
      so.kunnr as CustomerId,
      so.netwr as NetAmount,
      so.waerk as Currency,
      _Items,
      _Customer
}
```

## Path expressions

A path expression traverses a CDS association to access a field from a related entity directly in the element list — without writing an explicit JOIN.

```sql
define view entity Z_C_FlightSchedule
  as select from zdemo_abap_cds_ve_assoc_e as _flsch
{
  key _flsch.Carrid,
  key _flsch.Connid,
      -- Single-hop: field from the association target
      _flsch._carr_exp.currcode as CurrencyCode
      -- Multi-hop (conceptual): _Assoc._SubAssoc.field as Alias —
      -- each step must be an association exposed by the preceding entity
}
```

Usage rules:
- Syntax: `_AssocName.FieldName as Alias` — the association must be defined on the data source (or inherited from a source view).
- Multi-hop: `_Assoc._SubAssoc.field` — each step must be an exposed association on the preceding entity, and in the element list each step must effectively be to-one (a to-many step needs a cardinality-reducing filter).
- When the path is used in the element list, CDS materializes it as a left outer join at activation time. Performance implications are the same as an explicit `left outer join`.
- Use path expressions to expose a denormalized field (e.g., a description from a text table) without writing a JOIN — the join is deferred and only executed when a consumer requests that field.
- Avoid deep multi-hop chains in basic views — they create hidden join chains that complicate explain plans.

## Parameters

Use view parameters when the consumer needs to influence the result with a value (not just a filter). Example: a date for "as-of-balance":

```sql
define view entity Z_I_AccountBalance
  with parameters
    p_as_of_date : abap.dats
  as select from zaccount
  {
    key id,
        amount as Balance
  }
where created_at <= $parameters.p_as_of_date;
```

Callers pass parameters via `SELECT … FROM Z_I_AccountBalance( p_as_of_date = '20260101' )`.

**Don't:** Use parameters where a WHERE in the consumer would do. Parameters complicate composition (downstream views must forward them).

## Table functions (AMDP)

When the logic can't be expressed in CDS DDL — recursive hierarchy, complex window function not in CDS yet, native HANA SQLScript needs — use a CDS table function backed by an AMDP method.

```sql
@ClientHandling.type: #CLIENT_DEPENDENT
@ClientHandling.algorithm: #SESSION_VARIABLE
define table function Z_TF_DueInDays
  with parameters
    p_today : abap.dats
  returns {
    customer_id  : kunnr;
    due_in_days  : abap.int4;
  }
  implemented by method zcl_amdp_due=>get_due_in_days;
```

```abap
CLASS zcl_amdp_due DEFINITION
  PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    CLASS-METHODS get_due_in_days
      FOR TABLE FUNCTION Z_TF_DueInDays.
ENDCLASS.

CLASS zcl_amdp_due IMPLEMENTATION.
  METHOD get_due_in_days BY DATABASE FUNCTION
    FOR HDB LANGUAGE SQLSCRIPT
    OPTIONS READ-ONLY USING zinvoice.

    RETURN
      SELECT customer_id,
             DAYS_BETWEEN(:p_today, due_date) AS due_in_days
      FROM zinvoice
      WHERE due_date > :p_today;
  ENDMETHOD.
ENDCLASS.
```

**Restrictions:**
- HANA-only (`HDB`).
- In ABAP Cloud: allowed, but read-only (`OPTIONS READ-ONLY` mandatory) and client-safe — `@ClientHandling` annotations on the table function, released and client-safe objects in `USING` (see [abap-amdp-hierarchies](../abap-amdp-hierarchies/SKILL.md)).
- Authorization handled inside the function — be explicit.

## Performance — common pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Deep view chain (10+ levels) | Slow read; expensive plan compile on first use | Flatten where possible; use composite to consolidate |
| Many associations exposed but only one used | DB plan considers all; can choose poorly | Expose only used associations at consumption |
| Aggregation in a *basic* view | The view is now non-reusable for non-aggregate consumers | Move aggregation to a composite view |
| Joining a buffered table via CDS | Buffer bypass | Read the buffered table separately in ABAP; combine in code |
| Mixing `LEFT OUTER JOIN` and aggregations without care | NULLs propagate into `SUM`/`COUNT`; wrong results | `COALESCE` or restructure |
| Filtering aggregated results in `WHERE` instead of `HAVING` | Syntax error or wrong semantics — `WHERE` runs before `GROUP BY` | Use `having` after `group by` |
| Currency / unit conversion in CDS without `@Semantics` | Consumer can't display correctly | Use `@Semantics.amount.currencyCode: 'Currency'` etc. |
| Composite over basic that itself joins many tables | Multiply joins | Pre-filter at basic level |

**`HAVING` clause:** Use `having` to filter the result *after* `group by` — equivalent to SQL `HAVING`. `WHERE` is evaluated before grouping and cannot reference aggregate results.

```sql
define view entity Z_C_ActiveCarriers
  as select from zdemo_abap_fli
{
  key carrid,
      sum( paymentsum ) as TotalRevenue,
      count(*)          as FlightCount
}
group by carrid
having sum( paymentsum ) > 0;
```

Always check the **EXPLAIN plan** for a new CDS view on representative data before publishing.

## Authorization (DCL)

CDS supports DCL (Data Control Language) to express row-level authorization:

```sql
@MappingRole: true
define role Z_I_SalesOrder_Auth {
  grant select on Z_I_SalesOrder
    where SalesOrg = aspect pfcg_auth (V_VBAK_VKO, VKORG, ACTVT='03');
}
```

- One DCL role per consumed entity, named after it.
- `aspect pfcg_auth(<auth_object>, <field>, …)` ties to classical PFCG roles.
- `@AccessControl.authorizationCheck: #CHECK` on the entity activates DCL evaluation.

## ABAP Cloud / Steampunk

- Only released DDIC objects in `from` / `inner join` / `left outer join`.
- Only released annotations.
- No native joins to non-released tables.
- Use the API Hub (`api.sap.com`) to find released alternatives.

## Naming

| Pattern | Use |
|---|---|
| `Z_I_*` | Interface / basic |
| `Z_C_*` | Composite |
| `Z_P_*` | Projection (consumption / RAP) |
| `_*` prefix | Associations: `_Customer`, `_Items` |
| `*Id` suffix | Identifier fields: `SalesOrderId`, `CustomerId` |
| `Amount`, `Quantity`, `Date` | Common typed names; pair with `@Semantics` |

Internal element names use UpperCamelCase (CDS convention), not snake_case (ABAP convention).

## Examples

See [examples/sample-views.md](examples/sample-views.md) for a complete basic / composite / projection view stack (plus service definition/binding and ABAP consumption).

## Common Mistakes

| Mistake | Fix |
|---|---|
| `@UI` annotations on a basic view | Move to projection |
| Aggregation in basic view | Compose: basic stays atomic, composite aggregates |
| 10 associations exposed "in case" | Expose only those used |
| No `@EndUserText.label` | Add — empty label means generic UI text |
| Currency field without `@Semantics.amount.currencyCode` | Add the reference |
| Inner join where outer was needed | Result missing rows — confirm cardinality and add `left outer join` |
| Forgetting `@AccessControl.authorizationCheck: #CHECK` | View bypasses authorization silently |
| `@ObjectModel.usageType.dataClass: #MASTER` on a transactional view | Misleads consumers; mark correctly |
| Composite view that doesn't filter, just projects | Pushes filtering work to consumer; do it once in composite |
| Modifying basic view to fit one consumer | Coupled; consumer-specific shape belongs in projection |

## References

- [references/vdm-layering.md](references/vdm-layering.md) — VDM stack and naming
- [references/annotations-reference.md](references/annotations-reference.md) — annotation cheat sheet
- [examples/sample-views.md](examples/sample-views.md) — basic / composite / projection examples
- **CDS in ABAP Help:** https://help.sap.com/docs/abap-cloud/abap-data-models/
- **CDS Annotations:** https://help.sap.com/docs/abap-cloud/abap-data-models/cds-annotations
- **SAP-samples/abap-cheat-sheets — CDS examples:** https://github.com/SAP-samples/abap-cheat-sheets
- **SAP-samples/abap-platform-refscen-flight** — Flight Reference Scenario; substantial real CDS view stack (DMO/* namespace): https://github.com/SAP-samples/abap-platform-refscen-flight
- Linked skills: [rap-bo-modeling](../rap-bo-modeling/SKILL.md), [cds-entity-types](../cds-entity-types/SKILL.md) (custom/abstract entities, table functions, query providers), [abap-sql-performance](../abap-sql-performance/SKILL.md), [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md)
