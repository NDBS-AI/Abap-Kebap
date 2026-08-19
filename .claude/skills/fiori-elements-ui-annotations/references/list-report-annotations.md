# List Report Annotations — Deep Dive

Everything the List Report shows, mapped to its annotation. All snippets follow the
[SAP Fiori Elements Feature Showcase](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase)
(source objects `/DMO/FSA_C_RootTP`, `/DMO/FSA_C_ChildTP` and their metadata
extensions); the `#SearchTerm` in comments locates the original snippet in that repo.

## Filter Bar (Header Area)

Grounded in [02_list_report_header.md](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/02_list_report_header.md).

### Default visible filters — @UI.selectionField

```
@UI.selectionField: [{ position: 10 }]   // #VisibleFilters
StringProperty;

@UI.selectionField: [{ position: 40 }]
CriticalityCode;
```

Users can add any other filterable element via "Adapt Filters"; `selectionField` only
controls what is visible *by default*.

### Filter defaults — @Consumption.filter.defaultValue

```
@Consumption.filter.defaultValue: '3'    // #FilterDefault
CriticalityCode;
```

Simple values only. The default is ignored once the user switches variants. For
complex defaults (ranges, multiple filters) use `@UI.selectionVariant` instead.

### Hiding filters — @Consumption.filter.hidden

```
@Consumption.filter.hidden: true         // #HideFilter
AreachartTolUpperboundValue;
```

Removes the element from the adaptable filter list entirely (the column can still be
shown in the table).

### Grouping the "Adapt Filters" dialog — filter facets

A `@UI.facet` with `purpose: #FILTER` targeting a field group (showcase
`#FilterGrouping`):

```
@UI.facet: [
  {
    purpose: #FILTER,
    type: #FIELDGROUP_REFERENCE,
    targetQualifier: 'chartData',
    label: 'Chart Data'
  }
]

@UI.fieldGroup: [{ qualifier: 'chartData' }]
IntegerValue;

@UI.fieldGroup: [{ qualifier: 'chartData' }]
TargetValue;
```

### Free-text search — @Search.*

Not covered by the showcase; grounded in the ABAP Keyword Documentation
([Search.searchable](https://help.sap.com/docs/ABAP_Cloud/abap-cloud-docs_abap-keyword-documentation_abap-for-cloud-development/abencds_1567884046_anno.html),
[Search.defaultSearchElement](https://help.sap.com/docs/ABAP_Cloud/abap-cloud-docs_abap-keyword-documentation_abap-for-cloud-development/abencds_1489485690-_anno.html)).
These belong in the CDS view, not the MDE:

```
@Search.searchable: true                 // entity level — renders the search field
define root view entity ZC_Travel ... {
      @Search.defaultSearchElement: true // element level — element participates in $search
      @Search.fuzzinessThreshold: 0.8    // element level — 0..1, fuzzy matching
      Description,
}
```

Rules:
- `searchable: true` without any `defaultSearchElement` → search field renders but
  finds nothing.
- Fuzziness below ~0.7 tends to produce noise; 0.8 is the customary starting point.

## Value Help

Grounded in [01_general_features.md](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/01_general_features.md)
(`#ValueHelps`, `#DependentFilter`, `#useForValidationVH`; `#CollectiveValueHelp` is
in [04_object_page_general.md](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/04_object_page_general.md)).
Lives in the CDS view (or on action parameters in abstract entities).

### Basic binding

```
@Consumption.valueHelpDefinition: [{ entity: { name: 'I_TimeZone', element: 'TimeZoneID' } }]
SAPTimezone,
```

### additionalBinding — filter and/or result

```
// usage #RESULT: picking an entry also fills FieldWithCriticality
@Consumption.valueHelpDefinition: [{
  entity: { name: '/DMO/FSA_I_Criticality', element: 'Code' },
  additionalBinding: [{ element: 'Name',
                        localElement: 'FieldWithCriticality',
                        usage: #RESULT }]
}]
CriticalityCode,

// usage #FILTER: the local Country restricts the contact list shown
@Consumption.valueHelpDefinition: [{
  entity: { name: '/DMO/FSA_I_Contact', element: 'ID' },
  label: 'Contacts',
  additionalBinding: [{ element: 'Country',
                        localElement: 'Country',
                        usage: #FILTER }]
}]
ContactID,
```

When `usage` is omitted the binding acts as filter *and* result.

### useForValidation — value help as input validation

```
@Consumption.valueHelpDefinition: [{
  entity: { name: 'I_RegionVH', element: 'Region' },
  qualifier: 'RegionValueHelp',
  useForValidation: true,
  additionalBinding: [{ element: 'Country', localElement: 'Country' }]
}]
Region,
```

- Always set a `qualifier`; with several value helps and no qualifiers the UI cannot
  determine which one validates.
- Does not work for collective value helps.
- In draft apps it prevents invalid values from ever reaching the draft.

### Dropdown instead of dialog

On the value-help *provider* view (small, stable value sets):

```
@ObjectModel: { resultSet.sizeCategory: #XS }
define view entity /DMO/FSA_I_Criticality ...
```

### Controlling dialog columns

On provider elements: `@Consumption.valueHelpDefault.display: true|false`.

### Collective value help

An abstract entity bundling several elementary value helps
(showcase `#CollectiveValueHelp`):

```
@ObjectModel.supportedCapabilities: [#COLLECTIVE_VALUE_HELP]
@ObjectModel.modelingPattern: #COLLECTIVE_VALUE_HELP
@ObjectModel.collectiveValueHelp.for.element: 'Country'
define abstract entity /DMO/FSA_D_CountryCVH
{
  @Consumption.valueHelpDefinition: [
    { entity: { name: 'I_Country' },  label: 'Search by Country' },
    { entity: { name: '/DMO/FSA_I_ContactVH', element: 'Country' },
      label: 'Search by Contact', qualifier: 'ContactSearch' },
    { entity: { name: 'I_RegionVH', element: 'Country' },
      additionalBinding: [{ localElement: 'Region', element: 'Region' }],
      label: 'Search by Region', qualifier: 'RegionSearch' }
  ]
  Country : land1;
  Region  : regio;
}
```

The consuming view binds to the collective entity with
`@Consumption.valueHelpDefinition` as usual; only `entity.name`, `entity.element`,
`additionalBinding.localElement`, `additionalBinding.element`, and `qualifier` are
allowed for a collective value help.

### Value help on action parameters

Annotate the parameter in the abstract entity exactly like a view element
(showcase `#ValueHelpParameter`); default it with
`@UI.defaultValue: #( 'ELEMENT_OF_REFERENCED_ENTITY: CriticalityCode' )`
(showcase `#ParameterDefaultValue`).

## Table Content — @UI.lineItem Catalog

Grounded in [03_list_report_content.md](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/03_list_report_content.md).

### Plain column

```
@UI.lineItem: [{
  position: 20,        // order; number in tens
  importance: #HIGH,   // kept on small screens; #MEDIUM / #LOW dropped first
  label: 'Semantic Key'
}]
StringProperty;
```

### Row highlight by criticality (entity level!)

```
@UI.lineItem: [{ criticality: 'CriticalityCode' }]   // #LineItemHighlight — before annotate entity
```

Criticality element values: 0 neutral, 1 negative (red), 2 critical (yellow),
3 positive (green), 5 new item (not supported everywhere — e.g. bullet micro charts
reject 5).

### Cell criticality + hyperlink action — #WITH_ACTION

```
@UI.lineItem: [{
  position: 50,
  criticality: 'CriticalityCode',
  label: 'Change Criticality',
  type: #WITH_ACTION,            // value rendered as link that triggers the action
  dataAction: 'changeCriticality',
  importance: #LOW
}]
FieldWithCriticality;
```

### Toolbar action — #FOR_ACTION

```
@UI.lineItem: [{
  type: #FOR_ACTION,             // #ActionInLineItem
  label: 'Change Criticality',
  dataAction: 'changeCriticality',
  position: 10
}]
LastChangedAt;
```

BDEF counterpart (mandatory — no BDEF action, no button):

```
action changeCriticality parameter /DMO/FSA_D_ChangeCriticalityP result [1] $self;
```

A regular action needs a selected row; a *static* action (BDEF) is always active.
`invocationGrouping: #ISOLATED` (one call per selected instance) or `#CHANGE_SET`
(all in one changeset) controls multi-select execution
([SAPUI5: Adding Actions to Tables](https://help.sap.com/docs/SAPUI5/b2f662dd9d7a4ec680056733050b4d34/b623e0bbbb2b4147b2d0516c463921a0.html)).

### Inline (per-row) action

```
@UI.lineItem: [{
  type: #FOR_ACTION,             // #InlineActionInLineItem
  label: 'Change Progress',
  dataAction: 'changeProgress',
  inline: true,                  // renders inside the row, own column
  emphasized: true,
  importance: #HIGH,
  position: 100
}]
LastChangedAt;
```

### Copy action — isCopyAction

```
@UI.lineItem: [{
  type: #FOR_ACTION,             // #CopyActionInLineItem
  dataAction: 'copyInstance',
  isCopyAction: true             // renders next to Create/Delete; default label 'Copy'
}]
LastChangedAt;
```

BDEF: `factory action copyInstance [1];` — factory actions always have cardinality
[1] (one instance copied at a time). With `inline: true` you must supply a label.

### Intent-based navigation button — #FOR_INTENT_BASED_NAVIGATION

```
@Consumption.semanticObject: 'FeatureShowcaseNavigation'   // #Navigation-IBN
@UI.lineItem: [{
  label: 'IntentBased Navigation',
  type: #FOR_INTENT_BASED_NAVIGATION,
  semanticObjectAction: 'manage',
  requiresContext: true
}]
NavigationID;
```

Requires a launchpad with the target app published — it does nothing in the ADT
preview.

### URL link — #WITH_URL

```
@UI.lineItem: [{
  url: 'FieldWithUrl',           // element holding the target URL
  label: 'URL Property',         // #Navigation-URL
  type: #WITH_URL,
  importance: #MEDIUM,
  position: 130
}]
FieldWithUrlText;                // element whose text is the link
```

### Rating / progress in a cell — #AS_DATAPOINT

```
@UI: {
  dataPoint: {
    qualifier: 'StarsValue',     // MUST equal the element name
    targetValue: 4,              // number of possible stars
    visualization: #RATING
  },
  lineItem: [{
    type: #AS_DATAPOINT,         // #DataPointRatingTable
    label: 'Rating',
    importance: #LOW,
    position: 70
  }]
}
StarsValue;
```

`visualization: #PROGRESS` works the same way (`targetValue` = maximum; optional
`criticality`).

### Micro chart in a cell — #AS_CHART

```
@UI: {
  dataPoint: {
    qualifier: 'IntegerValue',           // MUST equal the element name
    targetValueElement: 'TargetValue',   // goal line
    forecastValue: 'ForecastValue',      // background bar
    criticality: 'CriticalityCode',
    minimumValue: 0                      // required for rendering
  },
  lineItem: [{
    type: #AS_CHART,                     // #BulletMicroChartTable
    label: 'Bullet Chart',
    valueQualifier: 'bulletChart',       // -> @UI.chart qualifier
    importance: #HIGH,
    position: 80
  }]
}
IntegerValue;

@UI.chart: [{
  qualifier: 'bulletChart',
  title: 'Bullet Micro Chart',
  chartType: #BULLET,                    // #DONUT for radial
  measures: ['IntegerValue'],
  measureAttributes: [{ measure: 'IntegerValue', role: #AXIS_1, asDataPoint: true }]
}]
```

### Several fields in one column — #AS_FIELDGROUP

```
@UI.fieldGroup: [{ qualifier: 'AdminData' }]     // #MultiFieldsCol
CreatedAt;

@UI.fieldGroup: [{ qualifier: 'AdminData' }]
LocalLastChangedBy;

@UI: {
  fieldGroup: [{ qualifier: 'AdminData' }],
  lineItem: [{
    type: #AS_FIELDGROUP,
    label: 'Admin Data',
    valueQualifier: 'AdminData',
    importance: #HIGH,
    position: 100
  }]
}
CreatedBy;
```

### Contact card — #AS_CONTACT

```
@UI.lineItem: [{
  type: #AS_CONTACT,             // #ContactInLineItem
  label: 'Contact',
  value: '_Contact',             // association to the contact entity
  position: 120
}]
ContactID;
```

The contact entity carries `@Semantics.name.fullName`, `@Semantics.telephone.type`,
`@Semantics.address.*` annotations that shape the popup card.

### Image column

```
// CDS view:
@Semantics.imageUrl: true
image_url as ImageUrl,

// MDE:                                            #Image
@UI.lineItem: [{ cssDefault.width: '5em', position: 10, importance: #HIGH }]
ImageUrl;
```

### Amount / quantity columns

No `@UI` work needed beyond the lineItem — the *view* must pair the element:
`@Semantics.amount.currencyCode: 'IsoCurrency'` or
`@Semantics.quantity.unitOfMeasure: 'Uom'` (showcase `#Units`).

### Attachment (large object) column

View: `@Semantics.largeObject` (acceptableMimeTypes, fileName, mimeType,
contentDispositionPreference `#INLINE`/`#ATTACHMENT`) + `@Semantics.mimeType: true`
on the MIME element. MDE: plain `@UI.lineItem` on the stream element,
`@UI.hidden: true` on filename/mimetype (showcase `#Stream`, `#StreamTable`).
Read-only control for the stream is BDEF feature control, not an annotation.

## Variants

Grounded in [03_list_report_content.md](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/03_list_report_content.md)
(`#PresentationVariant`, `#SelectionVariant`, `#SelectionPresentationVariant`,
`#DefaultSort`). All entity level:

```
@UI.presentationVariant: [{
  qualifier: 'pvariant',
  maxItems: 5,
  sortOrder: [{ by: 'StringProperty', direction: #ASC }],  // omit direction => ascending
  visualizations: [{ type: #AS_LINEITEM }]
}]

@UI.selectionVariant: [{
  qualifier: 'svariant',
  text: 'Selection (Criticality between 0 and 2)',
  filter: 'CriticalityCode GE 0 and CriticalityCode LE 2'
}]

@UI.selectionPresentationVariant: [{
  text: 'SPresVariant',
  presentationVariantQualifier: 'pvariant',
  selectionVariantQualifier: 'svariant'
}]
```

- `visualizations: [{ type: #AS_LINEITEM }]` is what ties the variant to the table.
- The default sort order of the list report is simply an unqualified
  `presentationVariant` with a `sortOrder`.
- The `filter` string uses OData-ish comparison operators (`EQ`, `GE`, `LE`, `and`).

## Header Texts

The list report table title comes from `@UI.headerInfo.typeNamePlural` — the same
annotation that titles the object page (see
[object-page-annotations.md](object-page-annotations.md)).
