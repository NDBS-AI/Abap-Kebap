# Example — Complete Metadata Extension for a Travel Entity

A worked example for a travel-like RAP business object (root `ZC_Travel`, child
`ZC_Booking`), showing a full List Report + Object Page defined purely through
annotations. The annotation vocabulary and placement follow the
[SAP Fiori Elements Feature Showcase](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase)
(see the `#SearchTerm` hints in comments).

Files in a real system:

| Object | Type | Carries |
|---|---|---|
| `ZC_TRAVEL` | Metadata extension (`.ddlx`) | All `@UI.*`, `@Consumption.filter.*` |
| `ZC_TRAVEL` | Projection view (`.ddls`) | `@Search.*`, `@ObjectModel.text.element`, `@Consumption.valueHelpDefinition`, `@Semantics.*`, `@Metadata.allowExtensions: true` |
| `ZC_BOOKING` | Child MDE | Child `@UI.lineItem`, `@UI.headerInfo` |
| `ZC_TRAVEL` | Projection BDEF | Actions, draft, feature control, side effects |

## 1. Root metadata extension ZC_TRAVEL

```
@Metadata.layer: #CORE   // #CUSTOMER would override this layer in an extension MDE

// ---------------------------------------------------------------------------
// Entity-level annotations: titles, default sorting, predefined filter variant
// ---------------------------------------------------------------------------

// Object page title area AND list report / OP table titles       (#HeaderInfo)
@UI.headerInfo: {
  typeName: 'Travel',
  typeNamePlural: 'Travels',
  typeImageUrl: 'sap-icon://flight',
  title:       { type: #STANDARD, value: 'TravelId' },
  description: { type: #STANDARD, value: 'Description' }
}

// Default sort order for the list report                          (#DefaultSort)
@UI.presentationVariant: [{
  sortOrder: [{ by: 'BeginDate', direction: #DESC }],
  visualizations: [{ type: #AS_LINEITEM }]
}]

// A named filter users can pick                                   (#SelectionVariant)
@UI.selectionVariant: [{
  qualifier: 'openTravels',
  text: 'Open Travels',
  filter: 'OverallStatus EQ ''O'''
}]

// Row highlight: color the whole line by criticality              (#LineItemHighlight)
@UI.lineItem: [{ criticality: 'StatusCriticality' }]

// Hide the standard Delete button when the flag says so           (#DynamicCRUD)
@UI.deleteHidden: #(DeleteHidden)

annotate entity ZC_Travel with
{
  // -------------------------------------------------------------------------
  // Facets: object page structure (header + sections)
  // -------------------------------------------------------------------------
  @UI.facet: [
    // --- header ---
    { purpose: #HEADER,                          // KPI in the header (#KeyValue)
      type: #DATAPOINT_REFERENCE,
      targetQualifier: 'TotalPrice' },
    { purpose: #HEADER,                          // progress data point (#DataPointProgress)
      type: #DATAPOINT_REFERENCE,
      targetQualifier: 'BookingProgress' },
    { purpose: #HEADER,                          // header form (#HeaderFieldGroup)
      type: #FIELDGROUP_REFERENCE,
      label: 'Key Dates',
      targetQualifier: 'TravelDates' },

    // --- body sections ---
    { purpose: #STANDARD,                        // main form from @UI.identification
      type: #IDENTIFICATION_REFERENCE,
      label: 'General Information',
      id: 'GeneralInfo' },
    { purpose: #STANDARD,                        // nested sub-section (#NestedTabs)
      type: #FIELDGROUP_REFERENCE,
      label: 'Prices',
      targetQualifier: 'Prices',
      parentId: 'GeneralInfo',
      isPartOfPreview: false },                  // behind "Show More" (#Preview)
    { purpose: #STANDARD,                        // child table (#OPTable)
      type: #LINEITEM_REFERENCE,
      label: 'Bookings',
      targetElement: '_Booking',
      id: 'BookingsSection' },

    // --- filter bar grouping in the list report (#FilterGrouping) ---
    { purpose: #FILTER,
      type: #FIELDGROUP_REFERENCE,
      label: 'Status Filters',
      targetQualifier: 'StatusFilters' }
  ]

  // -------------------------------------------------------------------------
  // Elements
  // -------------------------------------------------------------------------

  // Key column; semantic key bold + draft status comes from the view's
  // @ObjectModel.semanticKey, not from here                       (#SemanticKey)
  @UI: {
    lineItem:       [{ position: 10, importance: #HIGH }],
    identification: [{ position: 10 }],
    selectionField: [{ position: 10 }]           // default filter (#VisibleFilters)
  }
  TravelId;

  // ID with text: view has @ObjectModel.text.element: ['AgencyName']
  @UI: {
    lineItem:        [{ position: 20, importance: #HIGH }],
    identification:  [{ position: 20 }],
    selectionField:  [{ position: 20 }],
    textArrangement: #TEXT_FIRST                 // (#DisplayTextAndID)
  }
  AgencyId;

  @UI: {
    lineItem:       [{ position: 30, importance: #MEDIUM }],
    identification: [{ position: 30 }]
  }
  CustomerId;

  // Header field group + column
  @UI: {
    lineItem:   [{ position: 40, importance: #MEDIUM }],
    fieldGroup: [{ qualifier: 'TravelDates', position: 10 }]
  }
  BeginDate;

  @UI.fieldGroup: [{ qualifier: 'TravelDates', position: 20 }]
  EndDate;

  // Amount column: currency rendering comes from the view's
  // @Semantics.amount.currencyCode: 'CurrencyCode'                (#Units)
  // plus a key-value data point for the header                    (#KeyValue)
  @UI: {
    lineItem:   [{ position: 50, importance: #HIGH }],
    fieldGroup: [{ qualifier: 'Prices', position: 10 }],
    dataPoint:  { qualifier: 'TotalPrice', title: 'Total Price' }
  }
  TotalPrice;

  // Colored status cell + filter default                         (#WithActionInLineItem-style criticality)
  @UI: {
    lineItem: [{ position: 60, importance: #HIGH,
                 criticality: 'StatusCriticality',
                 criticalityRepresentation: #WITH_ICON }],
    identification: [{ position: 40 }],
    fieldGroup: [{ qualifier: 'StatusFilters' }],
    textArrangement: #TEXT_ONLY
  }
  @Consumption.filter.defaultValue: 'O'          // (#FilterDefault)
  OverallStatus;

  // Pure helper element: holds 0/1/2/3 for coloring — hide it     (#Stream-style hiding)
  @UI.hidden: true
  StatusCriticality;

  // Progress data point: qualifier MUST equal the element name    (#DataPointProgress)
  @UI.dataPoint: {
    qualifier: 'BookingProgress',
    targetValue: 100,
    visualization: #PROGRESS,
    criticality: 'StatusCriticality'
  }
  BookingProgress;

  // Long text as text area                                        (#MultiLineText)
  @UI: {
    identification: [{ position: 50 }],
    multiLineText: true
  }
  Description;

  // Action buttons:
  // - list report toolbar                                         (#ActionInLineItem)
  // - object page header, colored, footer variant possible        (#OPHeaderAction)
  @UI: {
    lineItem: [{ type: #FOR_ACTION,
                 dataAction: 'acceptTravel',     // must exist in the (projection) BDEF
                 label: 'Accept Travel',
                 invocationGrouping: #CHANGE_SET,
                 position: 70 }],
    identification: [{ type: #FOR_ACTION,
                       dataAction: 'acceptTravel',
                       label: 'Accept Travel',
                       criticality: 'StatusCriticality' },
                     { type: #FOR_ACTION,        // Copy next to Edit/Delete (#OPCopyAction)
                       dataAction: 'copyTravel',
                       isCopyAction: true }]
  }
  LastChangedAt;

  // Admin fields: keep out of the UI entirely
  @UI.hidden: true
  LocalLastChangedAt;
}
```

## 2. Companion annotations in the projection view ZC_TRAVEL

These deliberately stay in the view (data-shape semantics, reused by every consumer),
not in the MDE:

```
@Metadata.allowExtensions: true          // required so the MDE above may annotate this view
@Search.searchable: true                 // enables the list report search field
@ObjectModel.semanticKey: ['TravelId']   // bold + draft editing status (#SemanticKey)
define root view entity ZC_Travel
  provider contract transactional_query
  as projection on ZR_Travel
{
  key TravelId,

      // Value help + ID-to-text                (#ValueHelps, #DisplayTextAndID)
      @Consumption.valueHelpDefinition: [{
        entity: { name: '/DMO/I_Agency', element: 'AgencyID' },
        qualifier: 'Agency',
        useForValidation: true
      }]
      @ObjectModel.text.element: ['AgencyName']
      AgencyId,
      _Agency.Name as AgencyName,

      CustomerId,
      BeginDate,
      EndDate,

      @Semantics.amount.currencyCode: 'CurrencyCode'   // (#Units)
      TotalPrice,
      CurrencyCode,

      OverallStatus,
      StatusCriticality,      // calculated 0..3 in the interface view
      BookingProgress,

      @Search.defaultSearchElement: true
      @Search.fuzzinessThreshold: 0.8
      Description,

      DeleteHidden,
      LastChangedAt,
      LocalLastChangedAt,

      _Booking : redirected to composition child ZC_Booking,
      _Agency
}
```

## 3. Child metadata extension ZC_BOOKING (columns of the Bookings table)

```
@Metadata.layer: #CORE

// Table title in the parent's Bookings section                    (#OPTableTitle)
@UI.headerInfo: {
  typeName: 'Booking',
  typeNamePlural: 'Bookings'
}

annotate entity ZC_Booking with
{
  @UI.lineItem: [{ position: 10, importance: #HIGH }]     // (#OPTable)
  BookingId;

  @UI.lineItem: [{ position: 20 }]
  FlightDate;

  @UI.lineItem: [{ position: 30, criticality: 'BookingCriticality' }]
  BookingStatus;

  @UI.hidden: true
  BookingCriticality;
}
```

## 4. What must exist in the BDEF (or nothing renders / reacts)

Annotations only *reference* behavior. The projection BDEF for the example needs:

```
projection;
strict ( 2 );
use draft;                         // draft indicator via @ObjectModel.semanticKey
use side effects;                  // required to inherit side effects in projections

define behavior for ZC_Travel alias Travel
{
  use create;
  use update;
  use delete;

  use action acceptTravel;         // -> dataAction: 'acceptTravel'
  use action copyTravel;           // -> isCopyAction button

  use association _Booking { create; with draft; }
}
```

And in the base BDEF (see
[rap-actions-validations-determinations](../../rap-actions-validations-determinations/SKILL.md),
[rap-business-events-side-effects](../../rap-business-events-side-effects/SKILL.md)):

```
define behavior for ZR_Travel alias Travel
...
{
  field ( readonly, numbering : managed ) TravelId;   // "readonly" in the UI = BDEF
  field ( mandatory ) AgencyId;                       // red asterisk = BDEF

  action ( features : instance ) acceptTravel result [1] $self;
  factory action copyTravel [1];

  side effects {
    // progress bar refresh after status change = BDEF, not annotation
    field OverallStatus affects field BookingProgress, field StatusCriticality;
  }
}
```

## Checklist when the UI does not match expectations

1. Button missing → `dataAction` name vs BDEF action name; `use action` in projection.
2. Stars/progress/micro chart empty → dataPoint qualifier ≠ element name.
3. ID instead of text → `@ObjectModel.text.element` missing in the *view*.
4. Section empty → facet `targetQualifier` does not match any fieldGroup/dataPoint/chart qualifier.
5. Field not refreshing after action → missing BDEF side effect (+ `use side effects;`).
6. Value help not validating → missing `qualifier` next to `useForValidation: true`.
7. MDE fails to activate → view lacks `@Metadata.allowExtensions: true`.
