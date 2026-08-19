# Object Page Annotations — Deep Dive

The Object Page is built from `@UI.headerInfo` (title area), `@UI.facet` (structure),
and target annotations (`@UI.fieldGroup`, `@UI.identification`, `@UI.dataPoint`,
`@UI.chart`, `@UI.lineItem` of child entities) that fill the facets. All snippets
follow the
[SAP Fiori Elements Feature Showcase](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase);
`#SearchTerm` comments locate the original source.

## Title Area — @UI.headerInfo

Grounded in [05_object_page_header.md](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/05_object_page_header.md) (`#HeaderInfo`):

```
@UI.headerInfo: {
  typeName: 'Object Page - Root',      // shown next to the logo in the shell bar
  typeNamePlural: 'Root Entities',     // list report + OP table title
  typeImageUrl: 'sap-icon://sales-order', // fallback icon
  imageUrl: 'ImageUrl',                // element with per-instance image URL
  title:       { type: #STANDARD, value: 'StringProperty' },  // bold page title
  description: { type: #STANDARD, value: 'StringProperty' }   // subtitle
}
```

- `imageUrl` wins over `typeImageUrl` when both are set and the element has a value.
- If a child table's `typeNamePlural` equals its section title, the table title is
  suppressed (showcase `#OPTableTitle`).

### Semantic key and the draft/editing status

```
@ObjectModel.semanticKey: ['StringProperty']    // view level, #SemanticKey
```

Semantic key elements render bold and — in draft-enabled apps — carry the editing
status ("Draft", "Unsaved Changes"). The draft capability itself is `with draft;` in
the BDEF; there is no draft annotation.

## Structure — @UI.facet

### The catalog

| `type:` | Purpose | Targets via |
|---|---|---|
| `#COLLECTION` | Tab or grouping node; nest with `parentId` | children point at its `id` |
| `#IDENTIFICATION_REFERENCE` | Form of all `@UI.identification` position entries | — |
| `#FIELDGROUP_REFERENCE` | Form of one `@UI.fieldGroup` qualifier | `targetQualifier` |
| `#LINEITEM_REFERENCE` | Table of an association | `targetElement: '_Child'` |
| `#PRESENTATIONVARIANT_REFERENCE` | Association table + presentation variant | `targetElement`, `targetQualifier` |
| `#SELECTIONPRESENTATIONVARIANT_REFERENCE` | Association table + filter + sort | `targetElement` (+ qualifier) |
| `#CHART_REFERENCE` | Chart / micro chart | `targetQualifier` (+ `targetElement` when the chart sits on an associated entity) |
| `#DATAPOINT_REFERENCE` | Data point (KPI, rating, progress) | `targetQualifier` |
| `#ADDRESS_REFERENCE` | Formatted address | `targetElement: '_Contact'`, `targetQualifier: 'pref'` |

`purpose:` decides where the facet appears:
- `#HEADER` — object page header strip.
- `#STANDARD` — body section (a tab when sections are long / anchored).
- `#FILTER` — groups the list report "Adapt Filters" dialog (see list report reference).
- `#QUICK_VIEW` — popup card shown when clicking a link to an associated entity.

Other facet attributes seen in the showcase: `label`, `id`, `parentId`, `position`,
`targetQualifier`, `targetElement`, `isPartOfPreview: false` (subsection hidden behind
"Show More", `#Preview`), `hidden: #( IsActiveEntity )` (dynamic visibility,
`#HidingContent`).

### Nesting — collection facets and parentId

Showcase `#NestedTabs` (main tab with sub-tabs):

```
@UI.facet: [
  { purpose: #STANDARD, type: #COLLECTION,
    label: 'Nested Tabs', id: 'Nested' },
  { purpose: #STANDARD, type: #COLLECTION,
    label: 'Collection Facet', id: 'collectionFacetSection',
    parentId: 'Nested' },
  { purpose: #STANDARD, type: #COLLECTION,
    label: 'Micro Chart Data', id: 'chartDataCollection',
    parentId: 'Nested' }
]
```

The same `parentId` mechanism groups header facets under a header `#COLLECTION`
(showcase `#HeaderCollectionFacet`).

## Header Facets

Grounded in [05_object_page_header.md](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/05_object_page_header.md).

### Data points — key value, rating, progress

```
@UI.facet: [{ purpose: #HEADER, type: #DATAPOINT_REFERENCE, targetQualifier: 'fieldWithPrice' }]

// Key value (default when visualization is omitted)      #KeyValue
@UI.dataPoint: { qualifier: 'fieldWithPrice', title: 'Field with Price' }
FieldWithPrice;

// Rating stars                                            #DataPointRating
@UI.dataPoint: { qualifier: 'StarsValue', targetValue: 4,
                 visualization: #RATING, title: 'Rating' }
StarsValue;

// Progress bar                                            #DataPointProgress
@UI.dataPoint: { qualifier: 'ProgressIntegerValue', targetValue: 100,
                 visualization: #PROGRESS, criticality: 'CriticalityCode',
                 title: 'Progress' }
ProgressIntegerValue;
```

Hard rule from the showcase: **the dataPoint qualifier must equal the element name**
for ratings, progress indicators, and micro-chart measures. Values x.25–x.74 render
as half stars.

Data points can be hidden dynamically: `@UI.dataPoint: { …, hidden: #(UpdateHidden) }`
(showcase `#DatapointHidden`, referenced from `#DATAPOINT_REFERENCE` facets).

### Header field group, plain text, address

```
@UI.facet: [
  { purpose: #HEADER, type: #FIELDGROUP_REFERENCE,
    label: 'General Data', targetQualifier: 'HeaderData' },     // #HeaderFieldGroup
  { purpose: #HEADER, type: #FIELDGROUP_REFERENCE,
    label: 'Plain Text', targetQualifier: 'plainText' },        // #PlainText
  { purpose: #HEADER, type: #ADDRESS_REFERENCE,
    label: 'Address', targetElement: '_Contact',
    targetQualifier: 'pref' }                                    // #AddressFacet
]
```

- Address facets read the association target's element annotated with
  `@Semantics.address.label: true`; the label must be pre-formatted (`\n` for breaks);
  default qualifier is `'pref'`.
- A long text in a header field group pairs well with `@UI.multiLineText: true`.

### Micro charts — @UI.chart + #CHART_REFERENCE

Micro charts are header-only. Pattern: `@UI.dataPoint` on the measure element
(qualifier = element name) + `@UI.chart` (entity level) + facet:

```
@UI.facet: [{ purpose: #HEADER, type: #CHART_REFERENCE,
              targetQualifier: 'bulletChart' }]
// targetElement: '_Chart' additionally, when the chart is annotated on an associated entity
```

| Chart | `chartType:` | Mandatory extras (per showcase) |
|---|---|---|
| Bullet | `#BULLET` | dataPoint: `targetValue`/`targetValueElement`, `forecastValue`, `minimumValue` |
| Radial | `#DONUT` | dataPoint: `targetValue`/`targetValueElement` (renders a percentage) |
| Area | `#AREA` | `dimensions`; dataPoint `criticalityCalculation` (improvementDirection `#TARGET`, tolerance/deviation range elements) |
| Line | `#LINE` | `dimensions`; ≤3 measures recommended; last data point's criticality colors the line |
| Column | `#COLUMN` | `dimensions` |
| Stacked bar | `#BAR_STACKED` | `dimensions` |
| Comparison | `#BAR` | `dimensions` (values beyond three appear in the tooltip) |
| Harvey | `#PIE` | dataPoint `maximumValue`; only `criticality` (no calculation) |

All chart definitions require `measures` and `measureAttributes`
(`{ measure: '…', role: #AXIS_1, asDataPoint: true }`); where both `criticality` and
`criticalityCalculation` are given, `criticality` wins. If the measure element carries
a unit (`@Semantics.*`), the unit shows in the facet footer.

### Header actions — @UI.identification

```
@UI.identification: [
  { type: #FOR_ACTION,                     // button next to Edit  #OPHeaderAction
    label: 'Change Criticality',
    criticality: 'CriticalityCode',        // supports only 0 (normal), 1 (red), 3 (green)
    criticalityRepresentation: #WITH_ICON,
    dataAction: 'changeCriticality' },
  { type: #FOR_ACTION,                     // Copy button           #OPCopyAction
    dataAction: 'copyInstance',
    isCopyAction: true },
  { type: #FOR_ACTION,                     // footer button         #OPDetermineAction
    label: 'Approve',
    dataAction: 'changeCriticality',
    determining: true }
]
```

### Hiding standard operations

```
@UI.updateHidden: #(UpdateHidden)     // #DynamicCRUD — element path or fixed true/false
@UI.deleteHidden: #(DeleteHidden)
```

Hides the Edit/Delete buttons. This is *visibility only* — actually disabling the
operation is BDEF feature control (`delete ( features : instance )`).

## Content Sections

Grounded in [06_object_page_content.md](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/06_object_page_content.md).

### Forms — @UI.fieldGroup and @UI.identification

```
@UI.facet: [{ purpose: #STANDARD, type: #FIELDGROUP_REFERENCE,
              label: 'FieldGroup', targetQualifier: 'OPForm', id: 'SubSectionID' }]

@UI.fieldGroup: [{ qualifier: 'OPForm', position: 10 }]
IntegerValue;
```

`@UI.identification` entries with a `position` fill the `#IDENTIFICATION_REFERENCE`
facet the same way (showcase treeview example uses
`identification: [{ position: 10 }]` per element).

Field-group entries accept the same `type:` values as lineItem where meaningful:
`#FOR_ACTION` (section action, `inline: true` for in-form placement, `emphasized`),
`#WITH_ACTION`, `#AS_CONTACT` (`value: '_Contact'`),
`#WITH_INTENT_BASED_NAVIGATION` / `#FOR_INTENT_BASED_NAVIGATION`
(`semanticObject`, `semanticObjectAction`, `semanticObjectBinding:
[{ localElement: 'Country', element: 'Country' }]`), and `#AS_CONNECTED_FIELDS`.

### Multi-line text

```
@UI.multiLineText: true      // #MultiLineText
Description;
```

### Connected fields

Two elements under one label (showcase `#ConnectedFields`):

```
@UI.connectedFields: [{
  qualifier: 'ConnectedFields',
  groupLabel: 'Connected Fields',
  name: 'integer',
  template: '{integer} / {target}'     // rendering template
}]
IntegerValue;

@UI.connectedFields: [{ qualifier: 'ConnectedFields', name: 'target' }]
TargetValue;

// Rendered through a field group:
@UI.fieldGroup: [{ qualifier: 'OPForm', type: #AS_CONNECTED_FIELDS,
                   valueQualifier: 'ConnectedFields', position: 10 }]
IntegerValue;
```

Restriction: only in field groups / `#STANDARD` facets — not in tables,
`@UI.identification`, or header facets.

### Multi input field (values from an association)

```
@UI.fieldGroup: [{
  label: 'Multi Input Field',          // #MultiInputField
  qualifier: 'OPForm',
  value: '_Child.StringProperty',      // association path as source
  position: 40
}]
Child;
```

### Child-entity tables

Two halves. Child MDE — columns and title:

```
@UI.lineItem: [{ position: 10 }]                  // #OPTable
StringProperty;

@UI.headerInfo: { typeNamePlural: 'Children' }    // table title
```

Parent MDE — the facet:

```
@UI.facet: [{
  purpose: #STANDARD,
  type: #LINEITEM_REFERENCE,          // or #PRESENTATIONVARIANT_REFERENCE /
  targetElement: '_Child',            //    #SELECTIONPRESENTATIONVARIANT_REFERENCE
  label: 'Child Entity (1..n)',
  id: 'childEntitiesSection'
}]
```

With `#PRESENTATIONVARIANT_REFERENCE`, add `targetQualifier: 'pVariant'` and define
`@UI.presentationVariant` in the *child's* MDE; `#SELECTIONPRESENTATIONVARIANT_REFERENCE`
additionally applies the child's `@UI.selectionPresentationVariant` (filter + sort).

### Action overload — another entity's action on this table

```
@UI.lineItem: [{
  type: #FOR_ACTION,                              // #ActionOverload
  dataAction: '/DMO/FSA_C_RootTP.createChildFromRoot',   // Entity.action
  label: 'Create Child from Root'
}]
StringProperty;
```

### Quick views

An associated entity becomes a popup card via a facet with `purpose: #QUICK_VIEW`
*on the associated entity itself* (showcase `#QuickView`):

```
@UI.headerInfo: { typeName: 'Navigation', typeNamePlural: 'Navigations',
                  title.value: 'StringProperty', typeImageUrl: 'sap-icon://blank-tag' }
define view entity /DMO/FSA_I_Navigation ... {
  @UI.facet: [{ type: #FIELDGROUP_REFERENCE, label: 'Navigation',
                targetQualifier: 'data', purpose: #QUICK_VIEW }]
  @ObjectModel.text.element: ['StringProperty']
  key id as ID,
  @UI.fieldGroup: [{ qualifier: 'data', position: 10 }]
  string_property as StringProperty,
  ...
}
```

Then any plain data field on the referencing element (with a referential constraint
via `@ObjectModel.foreignKey.association`) shows the link. Non-UUID keys need a null
value indicator to get the constraint generated
(`@Semantics.nullValueIndicatorFor: 'CriticalityCode'`, showcase
`#QuickViewNullValueIndicator`).

### Treeview (hierarchy) section

A read-only tree of a CDS hierarchy inside the object page (showcase `#RAPTreeview`):
the hierarchy source view carries `@OData.hierarchy.recursiveHierarchy:
[{ entity.name: '…HN' }]`, its own `@UI.lineItem`/`@UI.identification`/
`@UI.presentationVariant`, and the parent MDE adds a `#LINEITEM_REFERENCE` facet with
`targetElement: '_Folder'`. Cloud release only.

### Analytical chart section (V4 caveat)

`@UI.chart` with `dimensions`, `dimensionAttributes` (`role: #CATEGORY`),
`measureAttributes`, and toolbar `actions:` can target a `#CHART_REFERENCE` facet with
`targetElement`. The measures must be elements with `@Aggregation.default`
(`#MIN`/`#MAX`/`#AVG`…) on a non-transactional view — and since **aggregation is not
yet available for OData V4 RAP services**, this section is annotated but disabled in
the showcase. Dimension coloring: `@UI.valueCriticality:
[{ value: '1', criticality: #NEGATIVE }, { value: '3', criticality: #POSITIVE }]`.

## What Is NOT Here (BDEF territory)

From [04_object_page_general.md](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/04_object_page_general.md)
and [01_general_features.md](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/01_general_features.md):
side effects (`side effects { field A affects field B; }`, `… affects entity`,
`… affects permissions`, `… affects messages` — remember `use side effects;` in the
projection BDEF), static/dynamic feature control, default values functions,
`mandatory:execute` action parameters. The UI merely *reflects* these through
`$metadata` field-control annotations; nothing to annotate in CDS.
