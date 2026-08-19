# CDS — Sample View Stack

A complete `Z_I_*` → `Z_C_*` → `Z_P_*` stack for a fictitious "Sales Order" domain. Use as a template; rename and adapt to the real entity.

## Basic / Interface view

`Z_I_SalesOrder.ddls`:

```sql
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck:    #CHECK
@EndUserText.label:                   'Sales Order — Interface'
@Metadata.layer:                      #CORE
@Metadata.allowExtensions:            true
@VDM.viewType:                        #BASIC
@ObjectModel.usageType:               { dataClass: #TRANSACTIONAL,
                                        serviceQuality: #A,
                                        sizeCategory:   #L }
@ObjectModel.representativeKey:       'SalesOrderId'

define view entity Z_I_SalesOrder
  as select from vbak as so

  association [0..*] to Z_I_SalesOrderItem as _Items
    on $projection.SalesOrderId = _Items.SalesOrderId

  association [1..1] to Z_I_Customer as _Customer
    on $projection.CustomerId = _Customer.CustomerId

  association [0..1] to Z_I_SalesOrg as _SalesOrg
    on $projection.SalesOrg = _SalesOrg.SalesOrg
{
  @EndUserText.label: 'Sales Order ID'
  key cast(so.vbeln as abap.char(10))                 as SalesOrderId,

  @EndUserText.label: 'Customer'
  @ObjectModel.foreignKey.association: '_Customer'
  so.kunnr                                            as CustomerId,

  @EndUserText.label: 'Sales Organization'
  @ObjectModel.foreignKey.association: '_SalesOrg'
  so.vkorg                                            as SalesOrg,

  @EndUserText.label: 'Net Amount'
  @Semantics.amount.currencyCode: 'Currency'
  so.netwr                                            as NetAmount,

  @EndUserText.label: 'Currency'
  @Semantics.currencyCode: true
  so.waerk                                            as Currency,

  @EndUserText.label: 'Document Date'
  so.audat                                            as DocumentDate,

  @EndUserText.label: 'Created By'
  @Semantics.user.createdBy: true
  so.ernam                                            as CreatedBy,

  @EndUserText.label: 'Created On'
  // Audit semantics stay off this DATS field: project convention reserves
  // createdAt for timestamp fields with @Semantics.systemDateTime.createdAt.
  so.erdat                                            as CreatedOn,

  /* exposed associations */
  _Items,
  _Customer,
  _SalesOrg
}
```

Key properties:
- Layer mark on top.
- Every element labeled.
- Amount carries `@Semantics.amount.currencyCode` pointing to `Currency`.
- Associations defined but no business rule (this is `BASIC`).
- `@Metadata.allowExtensions` permits downstream teams to add fields without touching this view.

## Composite view

`Z_C_OpenSalesOrderByCustomer.ddls`:

```sql
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label:                'Open Sales Orders — by customer (last 90 days)'
@VDM.viewType:                     #COMPOSITE
@ObjectModel.usageType:            { dataClass: #TRANSACTIONAL,
                                     serviceQuality: #B,
                                     sizeCategory:   #M }

define view entity Z_C_OpenSalesOrderByCustomer
  with parameters
    p_lookback_days : abap.int4

  as select from Z_I_SalesOrder as so

  association [1..1] to Z_I_Customer as _Customer
    on $projection.CustomerId = _Customer.CustomerId
{
  key so.CustomerId,
      _Customer.Name                                     as CustomerName,

      @Semantics.amount.currencyCode: 'Currency'
      sum( so.NetAmount )                                as OpenAmount,

      @Semantics.currencyCode: true
      so.Currency,

      count(*)                                           as OrderCount,

      _Customer
}
where dats_add_days( so.DocumentDate, $parameters.p_lookback_days ) >= $session.system_date
group by so.CustomerId, _Customer.Name, so.Currency;
```

Key properties:
- Aggregation lives here, not in basic.
- Parameter `p_lookback_days` lets consumers vary the window without per-consumer views.
- Returns the customer name via the association — saves consumers a second view.
- Filters AND groups in one expression — DB-side push-down.

## Consumption / Projection view

`Z_P_OpenSalesOrderByCustomer.ddls`:

```sql
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label:                'Open Sales By Customer — Consumption'
@VDM.viewType:                     #CONSUMPTION

@Search.searchable:                true

@UI.headerInfo: {
  typeName:       'Customer',
  typeNamePlural: 'Customers',
  title:          { value: 'CustomerName' }
}

define view entity Z_P_OpenSalesOrderByCustomer
  with parameters
    p_lookback_days : abap.int4
  as projection on Z_C_OpenSalesOrderByCustomer( p_lookback_days: $parameters.p_lookback_days ) as Source
{
  @UI.lineItem:      [ { position: 10, label: 'Customer ID' } ]
  @UI.selectionField:[ { position: 10 } ]
  @Search.defaultSearchElement: true
  key Source.CustomerId,

  @UI.lineItem: [ { position: 20, label: 'Customer Name' } ]
  @Search.defaultSearchElement: true
  Source.CustomerName,

  @UI.lineItem: [ { position: 30, label: 'Open Amount' } ]
  @Semantics.amount.currencyCode: 'Currency'
  Source.OpenAmount,

  @UI.lineItem: [ { position: 40, label: 'Currency' } ]
  @Semantics.currencyCode: true
  Source.Currency,

  @UI.lineItem: [ { position: 50, label: 'Orders' } ]
  Source.OrderCount,

  Source._Customer
}
```

Key properties:
- `@UI.*` only at this layer.
- Service binding (separate object) exposes this projection as OData.
- `Source.Currency` is in the SELECT list so the amount has a currency context at consumer.
- No `provider contract` — this is a plain read-only consumption view over an aggregate. `provider contract transactional_query` belongs on RAP BO projections (a `define root view entity ... as projection on` a RAP root, paired with a behavior projection) — see the RAP section in [../SKILL.md](../SKILL.md).

## Service binding (one more step to expose as OData)

Service Definition (`Z_OPEN_SALES_SD.srvd`):
```
@EndUserText.label: 'Open Sales Service'
define service Z_OPEN_SALES_SD {
  expose Z_P_OpenSalesOrderByCustomer as OpenSalesByCustomer;
}
```

Service Binding (`Z_OPEN_SALES_SB.srvb`): Type **OData V4 — UI**, target **Service Definition Z_OPEN_SALES_SD**, activate. The binding URL becomes the consumer endpoint.

## ABAP consumption of the consumption view

```abap
" Inside an if_oo_adt_classrun main method (classic WRITE lists are not
" available in ABAP Cloud — out->write is the released output channel).
SELECT CustomerId, CustomerName, OpenAmount, Currency, OrderCount
  FROM Z_P_OpenSalesOrderByCustomer( p_lookback_days = 90 )
  INTO TABLE @DATA(open_summary)
  WHERE OpenAmount > 100000.

out->write( open_summary ).
```
