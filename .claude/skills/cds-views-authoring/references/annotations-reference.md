# CDS Annotations — Quick Reference

The annotations you actually reach for, organized by purpose. For exhaustive coverage see SAP's [CDS Annotations documentation](https://help.sap.com/docs/abap-cloud/abap-data-models/cds-annotations).

## On the view (header)

| Annotation | Values | Use |
|---|---|---|
| `@AbapCatalog.viewEnhancementCategory` | `[#NONE]`, `[#PROJECTION_LIST]`, … | Whether the view may be extended via CDS view extension |
| `@AbapCatalog.compiler.compareFilter` | `true` / `false` | Optimizer hint about combining filters |
| `@AccessControl.authorizationCheck` | `#CHECK`, `#NOT_REQUIRED`, `#NOT_ALLOWED` | Whether DCL is evaluated |
| `@EndUserText.label` | `'Free text'` | Translatable label (mandatory in practice) |
| `@EndUserText.quickInfo` | `'Free text'` | Tooltip |
| `@Metadata.layer` | `#CORE`, `#LOCALIZATION`, … | VDM layering hint |
| `@VDM.viewType` | `#BASIC`, `#COMPOSITE`, `#CONSUMPTION` | Layer marker |
| `@ObjectModel.usageType.dataClass` | `#MASTER`, `#TRANSACTIONAL`, `#ORGANIZATIONAL`, `#CUSTOMIZING`, `#MIXED` | Data classification |
| `@ObjectModel.usageType.serviceQuality` | `#A` (high) – `#D` (low) | Performance / SLA category |
| `@ObjectModel.usageType.sizeCategory` | `#XS`, `#S`, `#M`, `#L`, `#XL` | Expected row count |
| `@ObjectModel.representativeKey` | `'KeyElement'` | Primary key element for tooling |
| `@ObjectModel.semanticKey` | `[ 'KeyElement' ]` | Business key for OData consumers |
| `@Search.searchable` | `true` | Enables free-text search via `$search` |
| `@Search.fuzzinessThreshold` | `0.8` | Fuzziness for `$search` |
| `@Analytics.dataCategory` | `#CUBE`, `#DIMENSION`, `#FACT` | Analytical role |
| `@Analytics.dataExtraction.enabled` | `true` | View extractable for analytics |
| `@ClientHandling.type` | `#CLIENT_DEPENDENT`, `#CLIENT_INDEPENDENT` | Required for table functions — declares whether the function result depends on the SAP client |
| `@ClientHandling.algorithm` | `#SESSION_VARIABLE` | How the client is determined inside the table function: with `#CLIENT_DEPENDENT`, use `#SESSION_VARIABLE` — the client is taken from the HANA session variable (the current session client) |

## On an element

| Annotation | Use |
|---|---|
| `@EndUserText.label: 'Sales Order ID'` | Per-field label |
| `@EndUserText.quickInfo: 'Long description'` | Per-field tooltip |
| `@ObjectModel.text.element: [ 'CustomerName' ]` | Text element for this code field |
| `@ObjectModel.foreignKey.association: '_Customer'` | Marks the field as a FK to the named association |
| `@ObjectModel.readOnly: true` | Per-field readonly hint |
| `@Semantics.amount.currencyCode: 'Currency'` | This is an amount; currency comes from the named field |
| `@Semantics.quantity.unitOfMeasure: 'Unit'` | This is a quantity; unit from the named field |
| `@Semantics.currencyCode: true` | This field IS a currency code |
| `@Semantics.unitOfMeasure: true` | This field IS a unit of measure |
| `@Semantics.systemDateTime.createdAt: true` | System "created at" **timestamp** (RAP audit standard). Use `systemDateTime.*` for timestamp fields; `@Semantics.systemDate.*` is valid too but only for **date-only** fields |
| `@Semantics.systemDateTime.lastChangedAt: true` | System "last changed at" (total ETag) — timestamp |
| `@Semantics.systemDateTime.localInstanceLastChangedAt: true` | System "local last changed at" (ETag per draft instance) — timestamp |
| `@Semantics.user.createdBy: true` | System "created by" |
| `@Semantics.user.lastChangedBy: true` | System "last changed by" |
| `@Semantics.user.localInstanceLastChangedBy: true` | System "local instance last changed by" (mirrors localInstanceLastChangedAt) |
| `@Semantics.largeObject: { mimeType: 'MimeType', fileName: 'FileName', acceptableMimeTypes: ['image/png', 'image/jpeg'], contentDispositionPreference: #ATTACHMENT }` | OData stream-enabled field (file attachment). `mimeType` / `fileName` reference **element names** (case-sensitive). `#ATTACHMENT` or `#INLINE`. |
| `@Semantics.mimeType: true` | This field IS the MIME type of the adjacent `largeObject` field |
| `@Search.defaultSearchElement: true` | Include in `$search` |
| `@DefaultAggregation: #SUM`, `#MIN`, etc. | Default aggregation for analytics |

## UI annotations (only on consumption / projection)

Summary rows only — the [fiori-elements-ui-annotations](../../fiori-elements-ui-annotations/SKILL.md) skill owns the UI depth (metadata extensions, list report, object page, facets, criticality, value help).

| Annotation | Use |
|---|---|
| `@UI.headerInfo: { typeName: 'Order', typeNamePlural: 'Orders' }` | Object page header |
| `@UI.lineItem: [ { position: 10, label: 'Order' } ]` | List page column |
| `@UI.identification: [ { position: 10 } ]` | Object page identification region |
| `@UI.facet: [ { … } ]` | Object page facets |
| `@UI.selectionField: [ { position: 10 } ]` | Selection screen field |
| `@UI.hidden: true` | Hide from UI |
| `@UI.hidden: #(IsHiddenFlag)` (dynamic — path to a Boolean element) | Conditionally hide |
| `@UI.fieldGroup` | Group of fields shown together |
| `@UI.dataPoint: { title: 'Open Total' }` | Header KPI |
| `@UI.chart: [ { … } ]` | Analytical chart hint |
| `@UI.textArrangement: #TEXT_FIRST` | How code+text shown |
| `@UI.lineItem: [ { criticality: 'Status' } ]` | Color cue from field |

## Consumption / RAP-relevant

| Annotation | Use |
|---|---|
| `@Consumption.valueHelp: '_Customer'` | Value help via association |
| `@Consumption.valueHelpDefinition: [ { entity: { name: 'Z_VH_Customer' } } ]` | Explicit value help binding |
| `@Consumption.filter.selectionType: #SINGLE` | UI filter behavior |
| `@OData.publish: true` | (On-prem) publish as OData service |
| `@ObjectModel.action: [ { … } ]` | RAP behavior action hint |
| `@ObjectModel.modelingPattern: #ANALYTICAL_DIMENSION` | Pattern hint |

## Association Cardinality Semantics

Cardinality is specified in square brackets on the association declaration: `association [min..max] to TargetEntity`. It is a *semantic contract* — consumers (OData navigation, RAP, ABAP SQL with associations) rely on it to decide join behavior and runtime assumptions.

| Cardinality | Meaning | DB join equivalent |
|---|---|---|
| `[1..1]` | Exactly one related record always exists | Inner join semantics — safe to read target fields without null-check |
| `[0..1]` | At most one related record (may be absent) | Left outer join semantics — target fields can be NULL; use `coalesce` |
| `[1..*]` | One or more related records (parent with children, at least one child guaranteed) | Left outer join; result set may multiply rows |
| `[0..*]` | Zero or more related records (optional children) | Left outer join; result set may multiply rows or return no child rows |

Shorthand notation: `[1]` is equivalent to `[0..1]`; `[*]` is equivalent to `[0..*]`. The minimum defaults to `0` when omitted; the default when no cardinality is specified at all is `[0..1]`.

**Wrong cardinality is a contract violation.** If you declare `[1..1]` but the target can be absent, consumers will not defensively null-check and will fail at runtime. If you declare `[0..*]` on what is actually a `[1..1]`, OData navigation properties will be modeled as a collection rather than a single entity — breaking Fiori object-page navigation.

## DCL — Access Control (companion language)

Not an annotation but the companion language: a DCL role restricts which rows a consumer can read from the entity annotated with `@AccessControl.authorizationCheck: #CHECK`. Example (PFCG-aspect variant — the role condition maps to a classic authorization object):

```sql
@MappingRole: true
define role Z_I_SalesOrder_Auth {
  grant select on Z_I_SalesOrder
    where SalesOrg = aspect pfcg_auth ( V_VBAK_VKO, VKORG, ACTVT = '03' );
}
```

## Things people get wrong

- `@EndUserText.label: 'Amount'` on an amount field but no `@Semantics.amount.currencyCode` → Fiori can't format; consumer sees raw number.
- `@UI.lineItem: [ { position: 10 } ]` on a basic view → the basic now serves a UI, future business changes must defer to UI requirements.
- `@Search.searchable: true` on the view but no `@Search.defaultSearchElement` on any element → `$search` returns no results.
- Missing `@ObjectModel.usageType.*` triple → some downstream RAP tooling complains.
- `@AccessControl.authorizationCheck: #CHECK` on the entity but no DCL role exists → all reads return zero rows (correct behavior; but surprising).
- Element-level annotations applied at the wrong layer (e.g., `@UI` on basic).

## Best practices

- Set `@EndUserText.label` on every view and every projected element.
- Pair every amount/quantity with its `@Semantics` reference.
- Decide once per view what the `@VDM.viewType` is; everything else flows.
- Use `@Metadata.allowExtensions: true` on basic views you expect downstream teams to extend.
