---
name: fiori-elements-ui-annotations
description: "Use when shaping a RAP/CDS-based Fiori Elements List Report or Object Page with CDS annotations — placing @UI.* in metadata extensions and wiring the @Search, @Consumption, and @ObjectModel.text companions. Covers @UI.lineItem, add a column to the list report, object page facet, @UI.facet, field group, header info, selection field, presentation variant, value help annotation, @Consumption.valueHelpDefinition, criticality color, criticalityRepresentation, data point, rating or progress indicator, micro chart, field shows ID instead of text, @UI.textArrangement, @UI.hidden, intent-based navigation, and action buttons via type #FOR_ACTION. Also disambiguates what is NOT an annotation — side effects, draft indicators, mandatory/read-only field control, and action enable/disable live in the behavior definition. Applies to OData V4 RAP apps with metadata extensions on the projection view; grounded in SAP's Fiori Elements Feature Showcase for the ABAP platform."
---

# Fiori Elements UI Annotations (RAP / CDS)

## Overview

SAP Fiori Elements renders a full List Report and Object Page from OData metadata — no
freestyle UI5 code. In the RAP stack that metadata comes from CDS annotations: `@UI.*`
shapes the layout, `@Search.*` enables free-text search, `@Consumption.*` wires value
helps and filter defaults, and `@ObjectModel.text.element` swaps IDs for readable text.

**Core principle:** a visible UI outcome typically maps to **one or more** annotations —
plus, when behavior is involved, BDEF feature-control settings and the app's runtime
manifest/metadata — not a strict one-to-one mapping. Each individual annotation still
has one correct home — almost always a *metadata extension* on the RAP *projection
(consumption) view*. Behavior (editability, mandatory fields, action
enablement, side effects) is **not** annotated; it lives in the behavior definition
(BDEF). Mixing the two up is the most common source of "why doesn't my UI react"
confusion — see [Annotation vs Behavior Definition](#annotation-vs-behavior-definition).

The single best grounded catalog of these annotations is SAP's
[Fiori Elements Feature Showcase](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase)
(OData V4, transactional, draft-enabled). Every feature there carries a search term
like `#ActionInLineItem` you can grep in the repo to find the exact source snippet.
This skill follows that app throughout.

## When to Use

- Adding or reordering columns, filters, or facets in a Fiori Elements app.
- Building a new metadata extension for a RAP projection view.
- Fixing "field shows the ID instead of the text", missing value help, wrong colors.
- Deciding whether a requirement is an annotation or a BDEF change.

**When NOT to use:**
- Modeling the CDS views themselves — [cds-views-authoring](../cds-views-authoring/SKILL.md).
- Modeling the RAP BO / BDEF — [rap-bo-modeling](../rap-bo-modeling/SKILL.md).
- Freestyle SAPUI5 apps — annotations there come from local annotation files, not CDS.

## Workflow

1. **Name the UI element** the user points at (column, filter, facet, button, chart).
2. **Map it to the annotation** using the table below (depth in the two references/ files).
3. **Check it is not a BDEF concern** — editability, mandatory, hidden operations,
   refresh-after-change are behavior, not annotation.
4. **Place it in the metadata extension** of the projection view (see next section).
5. **Companion annotations** (`@ObjectModel.text.element`, `@Semantics.*`, `@Search.*`,
   `@Consumption.valueHelpDefinition`) usually belong in the CDS view itself, not the MDE.

| UI element the user sees | Annotation | Where |
|---|---|---|
| List report column | `@UI.lineItem` | MDE, element |
| Filter field shown by default | `@UI.selectionField` | MDE, element |
| Filter default value | `@Consumption.filter.defaultValue` | MDE, element |
| Free-text search field | `@Search.searchable` + `@Search.defaultSearchElement` | CDS view |
| Value help dialog / dropdown | `@Consumption.valueHelpDefinition` | CDS view, element |
| Table/page title | `@UI.headerInfo` | MDE, entity level |
| Default sorting / max rows | `@UI.presentationVariant` | MDE, entity level |
| Predefined filter variant | `@UI.selectionVariant` | MDE, entity level |
| Object page section / tab | `@UI.facet` | MDE |
| Form fields in a section | `@UI.fieldGroup` / `@UI.identification` | MDE, element |
| Header KPI (number, rating, progress) | `@UI.dataPoint` + facet `#DATAPOINT_REFERENCE` | MDE |
| Micro chart in header | `@UI.chart` + facet `#CHART_REFERENCE` | MDE |
| Action button | `@UI.lineItem` / `@UI.identification` / `@UI.fieldGroup` with `type: #FOR_ACTION` | MDE |
| Text instead of ID | `@ObjectModel.text.element` + `@UI.textArrangement` | CDS view + MDE |
| Colored (red/yellow/green) value | `criticality:` attribute on the data field / data point | MDE |
| Hidden field | `@UI.hidden` | MDE, element |

## Where UI Annotations Live — Metadata Extensions

UI annotations *can* be written directly in a CDS view, but they should live in a
**metadata extension** (development object type "Metadata Extension", file suffix
`.ddlx`). The showcase app does exactly this: views `/DMO/FSA_C_RootTP` and
`/DMO/FSA_C_ChildTP` each have an MDE of the same name carrying all `@UI` content.

```
@Metadata.layer: #CORE
annotate entity /DMO/FSA_C_RootTP with
{
  @UI.adaptationHidden: true
  Description;
}
```

Key rules:
- `annotate entity <name> with { ... }` for CDS view entities (`annotate view` is the
  legacy form for old-style DDIC-based views).
- The annotated view must allow it: `@Metadata.allowExtensions: true` on the view.
- Entity-level annotations (`@UI.headerInfo`, `@UI.presentationVariant`, …) go *before*
  `annotate entity`; element-level annotations go inside the braces, each element ends
  with `;`.
- `@Metadata.layer` declares precedence when several MDEs annotate the same view:
  `#CORE` (SAP core development) < `#LOCALIZATION` < `#INDUSTRY` < `#PARTNER` <
  `#CUSTOMER` (highest priority — customer adaptations win). **Ownership decides the
  layer, not convenience:** `#CORE` belongs to whoever owns the base annotation —
  use it for your own primary MDE only when you also own the view it annotates. If
  you are extending a view someone else delivered (SAP-delivered, partner-delivered,
  or another team's custom view), do not default to `#CORE` — use the layer that
  matches your role instead (`#CUSTOMER` for a customer extension, `#PARTNER` for a
  partner add-on), so your changes layer on top of the original instead of competing
  for ownership of it.

**Why MDEs beat annotating the view directly:**
- Separation of concerns — the projection view stays a data-shape contract; UI churn
  (positions, labels, facets) does not touch it or force re-activation of consumers.
- Layering — several MDEs with different `@Metadata.layer` values can coexist, so
  partners/customers can override your UI without modifying your view.
- Reviewability — a UI change is a UI diff, not a data-model diff.

**Placement in the RAP stack:** annotate the **projection/consumption view** (the
`C`-view with `provider contract transactional_query`), never the interface (`I`/`R`)
layer. The interface layer is reused by other consumers; binding it to one Fiori app's
layout is the same anti-pattern as `@UI` on a basic view
(see [cds-views-authoring](../cds-views-authoring/SKILL.md) VDM layering, and
[rap-bo-modeling](../rap-bo-modeling/SKILL.md) for the projection stack).

## List Report — Filter Bar and Search

`@UI.selectionField` puts a field into the filter bar by default (users can still
adapt others in):

```
@UI.selectionField: [{ position: 10 }]
StringProperty;
```

Filter defaults and hiding (both element-level, MDE):

```
@Consumption.filter.defaultValue: '3'   // simple default; use @UI.selectionVariant for complex ones
CriticalityCode;

@Consumption.filter.hidden: true        // remove from adaptable filters entirely
InternalValue;
```

Filter *facets* group the "Adapt Filters" dialog — a `@UI.facet` with `purpose: #FILTER`
whose target is a `@UI.fieldGroup` qualifier (showcase `#FilterGrouping`).

Free-text search (`$search`) — these live in the CDS view, not the MDE:

```
@Search.searchable: true          // entity level: enables the search field
define root view entity ZC_Travel ...
{
      @Search.defaultSearchElement: true   // element level: searched by default
      @Search.fuzzinessThreshold: 0.8      // 0..1, enables fuzzy matching
      Description,
}
```

`@Search.searchable: true` without at least one `@Search.defaultSearchElement` yields
an empty search — always pair them.

## Value Help

`@Consumption.valueHelpDefinition` binds a value help provider entity to an element
(showcase `#ValueHelps`, `#DependentFilter`, `#useForValidationVH`):

```
@Consumption.valueHelpDefinition: [{
  entity: { name: 'I_RegionVH', element: 'Region' },
  qualifier: 'RegionValueHelp',          // good practice: always set one
  useForValidation: true,                // reject values not in the value help
  additionalBinding: [{ element: 'Country',
                        localElement: 'Country' }]
}]
Region,
```

- `additionalBinding.usage: #FILTER` — the local element filters the value help list.
- `additionalBinding.usage: #RESULT` — picking an entry fills the local element back.
- Omitting `usage` makes the binding act as filter *and* result.
- `useForValidation: true` needs a `qualifier` when multiple value helps exist, and
  does not work for collective value helps.
- Dropdown instead of dialog for small value sets: annotate the value help *provider*
  view with `@ObjectModel.resultSet.sizeCategory: #XS`.
- `@Consumption.valueHelpDefault.display: true|false` on provider elements controls
  which columns the dialog shows.

Collective value helps (multiple alternative search paths) use an abstract entity with
`@ObjectModel.collectiveValueHelp.for.element` — see
[references/list-report-annotations.md](references/list-report-annotations.md).

## List Report — Table Columns (@UI.lineItem)

The workhorse. Basic column (showcase `03_list_report_content.md`):

```
@UI.lineItem: [{
  position: 20,          // column order (10, 20, 30 … leaves room)
  importance: #HIGH,     // #HIGH survives small screens; #MEDIUM / #LOW get dropped
  label: 'Travel'        // overrides the element label
}]
StringProperty;
```

Criticality — color a *cell* by referencing an element that holds 0 (neutral),
1 (negative/red), 2 (critical/yellow), 3 (positive/green); 5 means "new item" where
supported:

```
@UI.lineItem: [{ position: 50, criticality: 'StatusCriticality',
                 criticalityRepresentation: #WITH_ICON }]
OverallStatus;
```

Color the whole *row* with an entity-level lineItem annotation (showcase
`#LineItemHighlight`):

```
@UI.lineItem: [{ criticality: 'StatusCriticality' }]   // before annotate entity
```

`type:` turns a lineItem entry into something other than a plain column:

| `type:` | Renders | Key attributes |
|---|---|---|
| (none) | Plain column | `position`, `label`, `importance`, `criticality` |
| `#FOR_ACTION` | Action button (toolbar; `inline: true` = per row) | `dataAction`, `label`, `emphasized`, `isCopyAction`, `invocationGrouping` |
| `#WITH_ACTION` | Value rendered as action hyperlink | `dataAction` |
| `#WITH_URL` | Value as external link | `url: 'UrlElement'` |
| `#FOR_INTENT_BASED_NAVIGATION` | Navigation button to another app | `semanticObjectAction`, `requiresContext` (+ `@Consumption.semanticObject`) |
| `#WITH_INTENT_BASED_NAVIGATION` | Value as cross-app link | `semanticObject`, `semanticObjectAction`, `semanticObjectBinding` |
| `#AS_DATAPOINT` | Rating stars / progress bar | needs `@UI.dataPoint` whose qualifier = element name |
| `#AS_CHART` | Micro chart in the cell | `valueQualifier` → `@UI.chart` qualifier |
| `#AS_FIELDGROUP` | Several fields in one column | `valueQualifier` → `@UI.fieldGroup` qualifier |
| `#AS_CONTACT` | Contact quick view | `value: '_Contact'` (association) |

Action button example (showcase `#ActionInLineItem`; the action itself must exist in
the BDEF):

```
@UI.lineItem: [{
  type: #FOR_ACTION,
  dataAction: 'changeCriticality',       // BDEF: action changeCriticality …
  label: 'Change Criticality',
  invocationGrouping: #ISOLATED          // or #CHANGE_SET for multi-select in one changeset
}]
LastChangedAt;
```

Images: annotate the URL element with `@Semantics.imageUrl: true` in the view, then a
plain lineItem entry (optionally `cssDefault.width: '5em'`) shows the picture.
Amounts/quantities render with their unit automatically when the view has
`@Semantics.amount.currencyCode` / `@Semantics.quantity.unitOfMeasure`.

Full catalog with all showcase snippets:
[references/list-report-annotations.md](references/list-report-annotations.md).

## Text Instead of ID

The number-one usability fix. In the view (or on the value-help provider's key):

```
@ObjectModel.text.element: ['AgencyName']   // which element carries the text
AgencyId,
```

In the MDE, control how ID and text combine:

```
@UI.textArrangement: #TEXT_FIRST   // #TEXT_ONLY | #TEXT_FIRST | #TEXT_LAST | #TEXT_SEPARATE
AgencyId;
```

`#TEXT_ONLY` hides the ID completely — the usual choice for value-help display and
quick views (showcase `#DisplayTextAndID`).

## Variants — Sorting, Grouping, Predefined Filters

Entity-level, in the MDE (showcase `#PresentationVariant`, `#SelectionVariant`,
`#SelectionPresentationVariant`):

```
@UI.presentationVariant: [{
  qualifier: 'pvariant',
  maxItems: 5,
  sortOrder: [{ by: 'StringProperty', direction: #ASC }],   // #ASC default
  visualizations: [{ type: #AS_LINEITEM }]
}]

@UI.selectionVariant: [{
  qualifier: 'svariant',
  text: 'Criticality between 0 and 2',
  filter: 'CriticalityCode GE 0 and CriticalityCode LE 2'
}]

@UI.selectionPresentationVariant: [{
  text: 'Combined variant',
  presentationVariantQualifier: 'pvariant',
  selectionVariantQualifier: 'svariant'
}]
```

The vocabulary also supports default grouping (`GroupBy` in the underlying
`UI.PresentationVariant` OData term); the showcase demonstrates only `sortOrder`,
`maxItems`, and `visualizations`. Selection variants render as tabs/views above the
list report table; on the object page the same three annotations shape child-entity
tables (targeted via facet types `#PRESENTATIONVARIANT_REFERENCE` /
`#SELECTIONPRESENTATIONVARIANT_REFERENCE`).

## Object Page — Header

`@UI.headerInfo` (entity level) names the object and is *also* the list report table
title (showcase `#HeaderInfo`):

```
@UI.headerInfo: {
  typeName: 'Travel',
  typeNamePlural: 'Travels',            // list report + OP table title
  typeImageUrl: 'sap-icon://flight',    // fallback icon
  imageUrl: 'ImageUrl',                 // per-instance image element
  title:       { type: #STANDARD, value: 'TravelId' },
  description: { type: #STANDARD, value: 'Description' }
}
```

`@ObjectModel.semanticKey: ['TravelId']` (view level) renders the business key in bold
and shows the draft **editing status** ("Draft", "Unsaved Changes") next to it — this,
plus draft enablement in the BDEF, is what produces draft indicators; there is no
"draft annotation".

Header content = `@UI.facet` entries with `purpose: #HEADER`:
- `#DATAPOINT_REFERENCE` → a `@UI.dataPoint` (key value, `visualization: #RATING`
  stars, `visualization: #PROGRESS` bar; `targetValue`, `criticality`; **the dataPoint
  qualifier must equal the element name**).
- `#CHART_REFERENCE` → a `@UI.chart` micro chart (`#BULLET`, `#DONUT`, `#AREA`,
  `#LINE`, `#COLUMN`, `#BAR_STACKED`, `#BAR`, `#PIE`).
- `#FIELDGROUP_REFERENCE` → a form of fields.
- `#ADDRESS_REFERENCE` → formatted address from `@Semantics.address.label`.
- `#COLLECTION` with `id:` + child facets using `parentId:` for grouping.

Header/OP actions use `@UI.identification` with `type: #FOR_ACTION`
(`determining: true` moves the button to the footer); `@UI.updateHidden` /
`@UI.deleteHidden` with `#(BooleanElement)` hide the standard Edit/Delete buttons
dynamically. Depth: [references/object-page-annotations.md](references/object-page-annotations.md).

## Object Page — Content

Sections are `@UI.facet` entries with `purpose: #STANDARD`. The facet catalog:

| Facet `type:` | Renders | Target |
|---|---|---|
| `#COLLECTION` | Tab / grouping node (nest via `parentId`) | children reference its `id` |
| `#IDENTIFICATION_REFERENCE` | Form from `@UI.identification` entries | — |
| `#FIELDGROUP_REFERENCE` | Form from a `@UI.fieldGroup` qualifier | `targetQualifier` |
| `#LINEITEM_REFERENCE` | Table of an association (child entity) | `targetElement: '_Child'` |
| `#PRESENTATIONVARIANT_REFERENCE` | Child table with sort/maxItems applied | `targetElement` + `targetQualifier` |
| `#SELECTIONPRESENTATIONVARIANT_REFERENCE` | Child table, filtered + sorted | `targetElement` (+ qualifier) |
| `#CHART_REFERENCE` | Chart / micro chart | `targetQualifier` (+ `targetElement`) |
| `#DATAPOINT_REFERENCE` | Data point (header or section) | `targetQualifier` |
| `#ADDRESS_REFERENCE` | Address | `targetElement`, `targetQualifier: 'pref'` |

Facet `purpose:` values: `#HEADER` (object page header), `#STANDARD` (body section),
`#FILTER` (filter-bar grouping), `#QUICK_VIEW` (popup card for an associated entity).
Useful facet attributes: `label`, `id`, `parentId`, `position`,
`isPartOfPreview: false` (hide behind "Show More"), `hidden: #( IsActiveEntity )`
(dynamic hiding — e.g. section only in edit mode).

Child-entity table: the child's MDE defines `@UI.lineItem` for its columns and
`@UI.headerInfo.typeNamePlural` for the table title; the parent's MDE adds the
`#LINEITEM_REFERENCE` facet with `targetElement: '_Child'` (showcase `#OPTable`).

Field-level extras: `@UI.multiLineText: true` (long text area),
`@UI.connectedFields` (two elements under one label with a
`template: '{integer} / {target}'`; render via fieldGroup `type: #AS_CONNECTED_FIELDS`
— not supported in tables, identification, or header facets).

## Hiding Things

| Annotation | Hides | Dynamic? |
|---|---|---|
| `@UI.hidden: true` | Element everywhere in the UI | Yes: `#(BooleanElement)` |
| `@UI.facet.hidden` | A whole facet/section | Yes: `#( IsActiveEntity )` |
| `@UI.dataPoint.hidden` | A data point | Yes: `#(UpdateHidden)` |
| `@Consumption.filter.hidden: true` | Only the filter, field still visible | No |
| `@UI.adaptationHidden: true` | From key-user UI adaptation, not from the UI | No |
| `@UI.updateHidden` / `@UI.deleteHidden` | Standard Edit / Delete buttons | Yes: `#(Flag)` |

`@UI.hidden` is cosmetic — it does not protect data. Authorization belongs in DCL and
the BDEF (see [abap-authorization](../abap-authorization/SKILL.md)).

## Annotation vs Behavior Definition

The showcase dedicates whole chapters to things people *expect* to be annotations but
are not. Rule of thumb: **layout is annotated, behavior is defined.**

| You want | NOT an annotation — lives in the BDEF | Cross-ref |
|---|---|---|
| Draft indicator / "Unsaved Changes" | `with draft;` in BDEF (+ `@ObjectModel.semanticKey` for display) | [rap-bo-modeling](../rap-bo-modeling/SKILL.md) |
| Refresh field B when field A changes | `side effects { field A affects field B; }` | [rap-business-events-side-effects](../rap-business-events-side-effects/SKILL.md) |
| Field read-only / mandatory | `field ( readonly )`, `field ( mandatory : create )` — static; `field ( features : instance )` + `get_instance_features` — dynamic | [rap-actions-validations-determinations](../rap-actions-validations-determinations/SKILL.md) |
| Enable/disable an action or Delete per instance | `action ( features : instance )`, `delete ( features : instance )` | [rap-actions-validations-determinations](../rap-actions-validations-determinations/SKILL.md) |
| Prefill fields on create / action popup | `default function GetDefaultsFor…` in BDEF (annotation alternative for simple cases: `@UI.defaultValue`) | [rap-bo-modeling](../rap-bo-modeling/SKILL.md) |
| Mandatory action parameter | abstract-entity BDEF `with control` + `field (mandatory:execute)` | [rap-actions-validations-determinations](../rap-actions-validations-determinations/SKILL.md) |
| Validation error popping up while typing | `determine action` + `side effects … affects messages` | [rap-business-events-side-effects](../rap-business-events-side-effects/SKILL.md) |

The annotation side only *references* behavior: `dataAction: 'changeCriticality'` in a
lineItem needs `action changeCriticality …` in the BDEF, or the button never appears.

## OData V4 vs V2 — What the Showcase States

- The showcase app is **OData V4**, transactional and draft-enabled; this skill's
  guidance targets V4 RAP service bindings.
- **Aggregation annotations (`@Aggregation.default`) are not yet available for V4
  services** — the showcase's analytical chart section (`#ChartSection`) is annotated
  but commented out for that reason. Micro charts (non-aggregating) work fine in V4.
- Several features are release-gated (marked in the showcase per backend release:
  2022, 2023, BTP/cloud) — e.g. `#WITH_ACTION`, inline actions, `isCopyAction`,
  `useForValidation`, side effects, `@UI.adaptationHidden`, treeview. When in doubt,
  check the warning box on the feature's showcase page for your release.

Do not assume other V2/V4 differences beyond what the docs state.

## Examples

[examples/travel-metadata-extension.md](examples/travel-metadata-extension.md) — a
complete, commented metadata extension for a travel-like entity (list report + object
page), plus the companion projection-view and BDEF snippets that make it work.

## Quick Reference

| Annotation | Level | Effect |
|---|---|---|
| `@UI.headerInfo` | entity | Object page title/description/image; table titles |
| `@UI.lineItem` | element (entity for row criticality) | List report / child table columns, actions |
| `@UI.selectionField` | element | Default filter bar fields |
| `@UI.presentationVariant` | entity | Default sort, maxItems, visualization |
| `@UI.selectionVariant` | entity | Named filter (`filter: '… GE … and …'`) |
| `@UI.selectionPresentationVariant` | entity | Bundles the two above |
| `@UI.facet` | (first) element | OP header + sections, filter groups, quick views |
| `@UI.fieldGroup` | element | Reusable field set for facets/columns |
| `@UI.identification` | element | OP main form + OP actions |
| `@UI.dataPoint` | element | KPI / rating / progress (qualifier = element name) |
| `@UI.chart` | entity | Micro charts and charts |
| `@UI.connectedFields` | element | Two fields under one label |
| `@UI.textArrangement` | element | `#TEXT_ONLY` / `#TEXT_FIRST` / `#TEXT_LAST` / `#TEXT_SEPARATE` |
| `@UI.multiLineText: true` | element | Text area rendering |
| `@UI.hidden` | element | Hide (static or `#(Flag)`) |
| `@UI.createHidden` / `@UI.updateHidden` / `@UI.deleteHidden` | entity | Hide standard operations |
| `@UI.defaultValue` | action parameter | Prefill (`#( 'ELEMENT_OF_REFERENCED_ENTITY: Field' )`) |
| `@UI.valueCriticality` | element | Color chart dimension values |
| `@ObjectModel.text.element` | element (view) | Text for an ID element |
| `@ObjectModel.semanticKey` | entity (view) | Bold key + draft editing status |
| `@Search.searchable` | entity (view) | Enable `$search` |
| `@Search.defaultSearchElement` | element (view) | Include element in search |
| `@Search.fuzzinessThreshold` | element (view) | Fuzzy matching 0..1 |
| `@Consumption.valueHelpDefinition` | element (view) | Value help (+ `additionalBinding`, `useForValidation`) |
| `@Consumption.filter.defaultValue` | element | Filter default |
| `@Consumption.filter.hidden` | element | Remove from filters |
| `@Consumption.semanticObject` | element | Semantic object for intent-based navigation |
| `@Semantics.imageUrl / amount.currencyCode / quantity.unitOfMeasure` | element (view) | Rendering semantics |

## Common Mistakes

| Wrong | Right |
|---|---|
| `@UI.dataPoint` qualifier differs from the element name | For ratings/progress/micro charts the qualifier **must** equal the element name |
| `@UI.*` annotations on the interface (basic/R) view | Put them in an MDE on the projection view |
| `@Search.searchable: true` alone, search finds nothing | Add `@Search.defaultSearchElement: true` on at least one element |
| `@UI.textArrangement: #TEXT_ONLY` but ID still shows | The view lacks `@ObjectModel.text.element` — arrangement needs a text to arrange |
| `useForValidation: true` on one of several value helps without qualifiers | Give every value help a `qualifier` |
| Facet `targetQualifier` without a matching `@UI.fieldGroup`/`@UI.dataPoint`/`@UI.chart` qualifier | Qualifiers must match exactly (case-sensitive) |
| Button annotated but nothing happens / never renders | `dataAction` must name an existing BDEF action (projection BDEF: `use action`) |
| Expecting a field to refresh after an action via annotation | Side effects live in the BDEF, not in `@UI` |
| Making a field mandatory with an annotation | `field ( mandatory )` in the BDEF; annotations cannot enforce input |
| `@UI.hidden` as a security measure | It only hides; use DCL / authorization in the BDEF |
| Complex filter default in `@Consumption.filter.defaultValue` | It takes simple values only; use `@UI.selectionVariant` |
| `@UI.connectedFields` in a table or header facet | Only field groups / `#STANDARD` facets support connected fields |
| Positions 1,2,3… everywhere | Use 10,20,30 so later inserts don't renumber the world |
| Same label maintained in every `@UI.lineItem` and `@UI.fieldGroup` | Maintain the label once (`@EndUserText.label` / data element); override only where it must differ |

## References

- **SAP Fiori Elements Feature Showcase (RAP, OData V4)** — the primary grounded source; search the repo for the `#SearchTerm` of any feature:
  https://github.com/SAP-samples/abap-platform-fiori-feature-showcase
  - [General features (value help, actions, feature control, quick views)](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/01_general_features.md)
  - [List report — filter bar](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/02_list_report_header.md)
  - [List report — table content](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/03_list_report_content.md)
  - [Object page — general (side effects, text/ID, hiding)](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/04_object_page_general.md)
  - [Object page — header](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/05_object_page_header.md)
  - [Object page — content](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase/blob/main/06_object_page_content.md)
- **SAP Help — Metadata Extensions (ABAP Data Models):** https://help.sap.com/docs/ABAP_Cloud/aaae421481034feab3e71dd9e0f643bf/9c6971b8e8f949b688270667d6d31416.html
- **SAP Help — RAP Back End-Driven UI Features:** https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/a20704a1e57a4efda1f26e30e00ec9fc.html
- **ABAP Keyword Documentation — Search.searchable:** https://help.sap.com/docs/ABAP_Cloud/abap-cloud-docs_abap-keyword-documentation_abap-for-cloud-development/abencds_1567884046_anno.html
- **ABAP Keyword Documentation — Search.defaultSearchElement:** https://help.sap.com/docs/ABAP_Cloud/abap-cloud-docs_abap-keyword-documentation_abap-for-cloud-development/abencds_1489485690-_anno.html
- **SAPUI5 Fiori Elements — Adding Actions to Tables (invocationGrouping):** https://help.sap.com/docs/SAPUI5/b2f662dd9d7a4ec680056733050b4d34/b623e0bbbb2b4147b2d0516c463921a0.html
- **SAPUI5 Fiori Elements — Configuring Sort Properties (PresentationVariant):** https://help.sap.com/docs/SAPUI5/b2f662dd9d7a4ec680056733050b4d34/41af842da7694ef1918fc06b75679ecc.html
- RAP topic pages linked per feature from the showcase guide (help.sap.com, "ABAP RESTful Application Programming Model"), e.g. [Providing Value Help](https://help.sap.com/docs/btp/sap-abap-restful-application-programming-model/providing-value-help), [Adding Selection Fields](https://help.sap.com/docs/btp/sap-abap-restful-application-programming-model/adding-selection-fields), [Using Facets to Change the Object Page Layout](https://help.sap.com/docs/btp/sap-abap-restful-application-programming-model/using-facets-to-change-object-page-layout), [Visualizing Data with Charts](https://help.sap.com/docs/btp/sap-abap-restful-application-programming-model/visualizing-data-with-charts), [Side Effects](https://help.sap.com/docs/btp/sap-abap-restful-application-programming-model/side-effects)
- Deep dives in this skill: [references/list-report-annotations.md](references/list-report-annotations.md), [references/object-page-annotations.md](references/object-page-annotations.md)
- Example: [examples/travel-metadata-extension.md](examples/travel-metadata-extension.md)
- Linked skills: [cds-views-authoring](../cds-views-authoring/SKILL.md), [rap-bo-modeling](../rap-bo-modeling/SKILL.md), [rap-actions-validations-determinations](../rap-actions-validations-determinations/SKILL.md), [rap-business-events-side-effects](../rap-business-events-side-effects/SKILL.md), [abap-odata](../abap-odata/SKILL.md)
