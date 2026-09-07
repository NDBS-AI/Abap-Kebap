# VDM Layering — Virtual Data Model Rules

SAP's Virtual Data Model prescribes a layered structure for CDS views. Following it makes views reusable; ignoring it makes them throwaway.

> **Naming note:** the `Z_I_`/`Z_C_`/`Z_P_` letters below are SAP's classic three-tier
> VDM scheme, where `C_` means **composite**. The shipped ABAP naming convention
> ([naming-conventions.md](../../abap-clean-style/references/naming-conventions.md))
> collapses CDS views into two customer-Z rows instead — interface/basic (`_i_`) and
> projection/consumption (`_c_`) — for projects with no separate composite tier. Pick
> whichever fits your project's actual layer count; never double the leading `Z`/`Y`
> either way.

## The three primary layers

### Basic / Interface views (`Z_I_*`)

- One per source entity (one DB table or one tightly-bound combination).
- **No business logic** beyond field selection, type adjustment, association definition.
- **No aggregation, no filtering** (other than client handling and obvious data quality filters).
- Stable contract — once consumed downstream, breaking changes require versioning.

```sql
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Sales Order — interface'
@Metadata.layer: #CORE
@VDM.viewType: #BASIC
define view entity Z_I_SalesOrder
  as select from vbak as so
  association [0..*] to Z_I_SalesOrderItem as _Items
    on $projection.SalesOrderId = _Items.SalesOrderId
{
  key so.vbeln as SalesOrderId,
      so.kunnr as CustomerId,
      so.netwr as NetAmount,
      so.waerk as Currency,
      _Items
}
```

### Composite views (`Z_C_*`)

- Combine multiple basics for a business purpose (aggregate, join, filter).
- Can include calculations, currency conversion, time filters.
- Reused across multiple consumption views.
- Still consumer-agnostic — no `@UI` here.

```sql
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Sales Orders — open per customer'
@VDM.viewType: #COMPOSITE
define view entity Z_C_OpenSalesByCustomer
  as select from Z_I_SalesOrder as so
{
  key so.CustomerId,
      sum( so.NetAmount )       as OpenAmount,
      so.Currency
}
where so.DeliveryStatus = 'A'    -- "open"
group by so.CustomerId, so.Currency;
```

### Consumption / Projection views (`Z_P_*` or `Z_C_*Projection`)

- The shape exposed to a specific consumer: OData service, Fiori list page, RAP BO projection.
- `@UI`, `@Search`, `@Consumption` annotations live here.
- For RAP: this is the *projection* layer of the BO; the BDEF lives next to it.

```sql
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Open Sales By Customer — Fiori'
@VDM.viewType: #CONSUMPTION
@Search.searchable: true
@UI.headerInfo: { typeName: 'Customer', typeNamePlural: 'Customers' }
define view entity Z_P_OpenSalesByCustomer
  as projection on Z_C_OpenSalesByCustomer as Source
{
  @UI.lineItem: [ { position: 10 } ]
  @UI.selectionField: [ { position: 10 } ]
  @Search.defaultSearchElement: true
  key Source.CustomerId,
  @UI.lineItem: [ { position: 20 } ]
  @Semantics.amount.currencyCode: 'Currency'
  Source.OpenAmount,
  @UI.lineItem: [ { position: 30 } ]
  Source.Currency
}
```

## Less common layers

- **Cube** — analytical aggregation surface (`@Analytics.dataCategory: #CUBE`). Special name suffix `*Cube` is common.
- **Dimension** — analytical dimension (`@Analytics.dataCategory: #DIMENSION`). Used as foreign key targets in cubes.
- **Hierarchy** — `define hierarchy …`. For org structures, product hierarchies.

## Rules for upward composition

1. **Basics may consume basics.** Use sparingly — depth ≥ 3 starts to compound.
2. **Composites consume basics.** Standard.
3. **Composites may consume composites.** OK if the upper composite genuinely refines; bad if it just renames.
4. **Consumption consumes composites or basics.** Never *basic → consumption directly* if business logic was needed in between.
5. **Composites must never consume consumption views.** Layer violation.

## What goes where — quick test

> "Will this annotation / field change *only* because of UI requirements?"

- YES → consumption.
- NO  → maybe composite.

> "Will this annotation / field change *only* because of business logic?"

- YES → composite.
- NO  → maybe basic.

> "Will this annotation / field change *only* because of source data structure?"

- YES → basic.

## Cross-cutting

### Authorization (DCL)

- Apply at the lowest layer that has the relevant authorization columns.
- Higher layers inherit the check automatically.

### Annotations propagation

- `@EndUserText.label` propagates to consumers when not overridden.
- `@Semantics.amount.currencyCode` should be set as low as the currency column is present.
- `@UI.*` does NOT propagate sensibly — keep it in consumption.

### Naming exception — SAP-delivered models

SAP-delivered CDS uses prefixes like `I_*` (interface), `C_*` (composite), `P_*` (projection) without the `Z`. Your custom ones live in customer namespace (`Z*`, `Y*`, or registered customer namespace).

## Anti-patterns

| Anti-pattern | Symptom | Fix |
|---|---|---|
| One giant CDS view with joins, aggregation, UI annotations | Hard to change, slow plan compile, single consumer | Split into Z_I + Z_C + Z_P |
| Basic view aggregates | Non-reusable | Move aggregation to composite |
| Composite view exposes UI annotations | UI requirements drive business model | Move to projection |
| Z_P consumes Z_P | Layer violation | Z_P consumes Z_C, never another Z_P |
| Three basic views for the same DB table because three composites want different fields | Wasted modeling overhead | One basic view exposing all relevant fields; composites project subsets |
| Renaming fields at every layer | Trace from consumer to source is painful | Rename once at basic; preserve down the chain |
