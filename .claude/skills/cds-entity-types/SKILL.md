---
name: cds-entity-types
description: Use when choosing or implementing a CDS artifact kind beyond a plain view — deciding between define view entity, define root view entity, projection views with provider contracts (transactional_query, transactional_interface, analytical_query), abstract entities, custom entities, table functions, hierarchies, and view extensions; implementing a custom entity query provider with if_rap_query_provider (paging, filter ranges, sorting, aggregation, $count, set_data); or exposing non-database data such as a released API, application logs, change documents, or an external HTTP/OData service through CDS and RAP. Triggers include "custom entity", "if_rap_query_provider", "expose an API as CDS", "how do I call an API in RAP", "unmanaged query", "abstract entity for action parameter", "CDS table function", "define hierarchy", "extend view entity", "value help custom entity", and "@ObjectModel.query.implementedBy".
---

# CDS Entity Types — The Catalog Beyond Plain Views

## Overview

CDS is not just `define view entity`. The DDL offers a catalog of entity kinds, each with a different *source of data*: a database SELECT, an ABAP class, a SQLScript function, pure metadata, or another entity. Choosing the wrong kind is expensive — you cannot refactor a view into a custom entity without touching every consumer.

This skill owns the *entity-kind decision* and the ABAP-backed kinds in depth (custom entities with `if_rap_query_provider`, abstract entities, table functions, hierarchies, extensions). Plain view authoring — annotations, VDM layering, associations, parameters — is owned by [cds-views-authoring](../cds-views-authoring/SKILL.md); RAP behavior is owned by [rap-bo-modeling](../rap-bo-modeling/SKILL.md).

**Core principle:** the entity kind declares *where the data comes from*. If the data is in a database table, use a view entity. If the data only exists behind an API — an application log, change documents, a remote OData service — use a custom entity and write the query yourself. Do not copy API data into a Z-table just to put a view on it.

## Workflow

1. **Locate the data.** Database table or released CDS entity → view entity. ABAP API / external service → custom entity. HANA-only SQL logic → table function. No data at all (just a shape) → abstract entity.
2. **Decide the layer.** RAP BO root → `define root view entity`. Consumption layer over a BO → projection view with `provider contract transactional_query`. Stable released API layer → `transactional_interface`. Analytics → `analytical_query`.
3. **Pick from the decision table** below; then jump to the topic section.
4. **For custom entities**: write the DDL (keys + typed elements + `@ObjectModel.query.implementedBy`), then implement `if_rap_query_provider~select` honoring paging, filter, sorting, and `$count` — see [references/query-provider-contract.md](references/query-provider-contract.md).
5. **Expose** the entity in a service definition (identical for views and custom entities) and bind it.

### Decision table — all entity kinds

| DDL statement | Source of data | SQL in the DDL? | Typical use |
|---|---|---|---|
| `define view entity` | DB table / other CDS entity | Yes (joins, where, group by, unions) | General data modeling, VDM layers |
| `define root view entity` | DB table / other CDS entity | Yes | Root node of a RAP BO composition tree |
| `define view entity ... as projection on` + `provider contract transactional_query` | One underlying CDS entity | Projection only — no joins/aggregation | RAP consumption layer (OData via service binding) |
| projection + `provider contract transactional_interface` | One underlying CDS entity | Projection only | Stable, releasable transactional API layer on a BO |
| projection + `provider contract analytical_query` | Analytical cube entity | Projection only | Analytical queries (embedded analytics) |
| `define abstract entity` | **None** — metadata only | No | Typing: RAP action/event parameters, remote-proxy shapes |
| `define custom entity` | **ABAP class** (`if_rap_query_provider`) | No — your code decides | Expose an API, log, or external service as CDS/OData |
| `define table function` | **AMDP method** (SQLScript on HANA) | SQLScript in the AMDP | HANA-native logic consumable by ABAP SQL and CDS |
| `define hierarchy` | CDS view exposing a hierarchy association | Hierarchy generator clauses | Parent-child hierarchies queried from ABAP SQL |
| `extend view entity` | The extended view entity | Adds select-list fields / associations | Non-invasive extension of an existing view |

## View entities, root view entities, projection views

Covered in depth by [cds-views-authoring](../cds-views-authoring/SKILL.md) (authoring, annotations, associations) and [rap-bo-modeling](../rap-bo-modeling/SKILL.md) (composition trees, BDEFs). Here only the entity-kind distinctions:

- `define view entity` — the default. Full SQL feature set in the DDL.
- `define root view entity` — same syntax plus `root`; marks the root of a RAP BO. Exactly one root per composition tree; children use `composition of` / `association to parent`.
- `define view entity ... as projection on X` — a *projection view*: renames, subsets, and annotates elements of exactly one underlying entity. No joins, no aggregation. The `provider contract` keyword declares which runtime serves it:

```sql
define root view entity Z_C_Order
  provider contract transactional_query
  as projection on Z_I_Order
{
  key OrderId,
      Status,
      _Items : redirected to composition child Z_C_OrderItem
}
```

| Provider contract | Runtime / purpose |
|---|---|
| `transactional_query` | RAP transactional queries — the OData-facing projection of a BO |
| `transactional_interface` | Stable transactional interface layer — the releasable API surface of a BO, itself projectable |
| `analytical_query` | Analytical query on a cube for analytical clients |

The contract restricts which CDS features are allowed in the projection so the declared runtime can actually serve it (documented per contract in the [PROVIDER CONTRACT keyword docs](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENCDS_PV_PROVIDER_CONTRACT.html)).

## Custom entities — CDS backed by ABAP code

A custom entity has **no data source in the DDL**. It declares the shape (keys, elements, annotations) and delegates data retrieval to an ABAP class — the *unmanaged query*. This is the answer to "how do I call an API behind CDS/RAP" for the read side: application logs, change documents, released BAPI-style APIs, or a remote HTTP/OData service.

### DDL syntax

Real example (SAP-samples application-jobs, reading the application log):

```sql
@EndUserText.label: 'Application Log Entries'
@ObjectModel.query.implementedBy: 'ABAP:ZCL_APPLICATION_LOG_QUERY'
define custom entity ZI_ApplicationLogEntry
{
  key log_handle      : balloghndl;
  key log_item_number : balmnr;
      severity        : symsgty;
      criticality     : abap.int1;
      detail_level    : ballevel;
      timestamp       : abap.utclong;
      message_text    : abap.sstring( 512 );
}
```

Rules (from the [DEFINE CUSTOM ENTITY keyword docs](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENCDS_F1_DEFINE_CUSTOM_ENTITY.html) and the samples):

- `@ObjectModel.query.implementedBy: 'ABAP:UPPERCASE_CLASS_NAME'` binds the query class. **Mandatory in ABAP Cloud.**
- Elements are typed with DDIC data elements (`balloghndl`, `symsgty`) or built-in types (`abap.char(n)`, `abap.sstring(n)`, `abap.curr`, `abap.utclong`, ...). At least one `key` element.
- `root` and input parameters are allowed (`[define] [root] custom entity name [parameter_list] element_list`).
- UI/semantic annotations (`@UI.lineItem`, `@Semantics.amount.currencyCode`, `@UI.hidden`) go directly on the elements — same annotation vocabulary as views.
- A custom entity **cannot** be used as a data source in other CDS entities or in ABAP SQL. It **can** be used as a global structured type in ABAP (`DATA lt_log_entries TYPE TABLE OF zi_applicationlogentry.`) — the query classes in the samples type their result tables exactly this way.

### The query implementation class

The class implements `if_rap_query_provider` with a single method:

```abap
METHODS select IMPORTING io_request  TYPE REF TO if_rap_query_request
                         io_response TYPE REF TO if_rap_query_response
               RAISING   cx_rap_query_provider.
```

Inside `select` you must honor what the consumer requested — paging, filter, sort, `$count` — and answer through `io_response`. The full contract, with the failure modes, is in [references/query-provider-contract.md](references/query-provider-contract.md). The short version, grounded in the three SAP-samples classes:

```abap
METHOD if_rap_query_provider~select.
  DATA lt_log_entries TYPE TABLE OF zi_applicationlogentry.

  " Paging: page_size_unlimited (-1) means no $top was requested
  DATA(lo_paging)    = io_request->get_paging( ).
  DATA(lv_page_size) = lo_paging->get_page_size( ).
  DATA(lv_offset)    = lo_paging->get_offset( ).

  " Filter: ranges for driving the API call, SQL string for post-filtering
  TRY.
      DATA(lt_filter_ranges) = io_request->get_filter( )->get_as_ranges( ).
    CATCH cx_rap_query_filter_no_range INTO DATA(lo_no_range_error).
      " Filter not convertible to ranges (e.g. OR across elements)
  ENDTRY.
  DATA(lv_filter_sql) = io_request->get_filter( )->get_as_sql_string( ).

  " ... call the API, fill lt_log_entries (see examples/) ...

  " Apply the OData filter to the in-memory result — SELECT from itab
  SELECT log_handle, log_item_number, severity, criticality, detail_level, timestamp, message_text FROM @lt_log_entries AS entries
    WHERE (lv_filter_sql)
    INTO TABLE @lt_log_entries.

  IF io_request->is_total_numb_of_rec_requested( ).
    io_response->set_total_number_of_records( lines( lt_log_entries ) ).
  ENDIF.
  IF io_request->is_data_requested( ).
    io_response->set_data( lt_log_entries ).
  ENDIF.
ENDMETHOD.
```

A complete, Clean-ABAP pair (DDL + class) modeled on the samples is in [examples/custom-entity-query-provider.md](examples/custom-entity-query-provider.md).

### Calling an API or external service behind the custom entity

The `select` method is plain ABAP — anything callable from ABAP can feed the entity:

- **Released local APIs.** The samples read the application log via `cl_bali_log_db=>get_instance( )->load_log( ... )` (see [abap-background-processing](../abap-background-processing/SKILL.md) for the BAL API itself) and change documents via `cl_chdo_read_tools=>changedocument_read( ... )`. Pattern: convert the OData filter ranges into the API's importing parameters, call the API, map the result into the custom-entity row type.
- **External HTTP/OData services.** Call the HTTP or OData client inside `select` and map the response — this makes a remote service look like a local CDS entity to Fiori/RAP. The HTTP client itself (destinations, `cl_web_http_client_manager`, service consumption model) is owned by [abap-odata](../abap-odata/SKILL.md).
- **Modifying data** through the same entity requires an unmanaged RAP BO on top ([rap-bo-modeling](../rap-bo-modeling/SKILL.md)); the custom entity + query provider covers only the read side.

### Value-help custom entity

A value help does not need a database table either. The SAP-samples reuse-services repo backs a product value help with a hard-coded table (real systems: an API call):

```sql
@ObjectModel.query.implementedBy: 'ABAP:ZCL_PRODUCT_VALUE_HELP'
@EndUserText.label: 'Value help for products'
define custom entity ZI_ProductValueHelp
{
  key Product : abap.char( 40 );
  ProductText : abap.char( 40 );
  ProductGroup : abap.char( 40 );
  @Semantics.amount.currencyCode: 'Currency'
  Price : abap.curr( 15, 2 );
  Currency : abap.cuky( 5 );
  BaseUnit : abap.unit( 3 );
}
```

The provider fills the table and applies the requested filter with the `SELECT ... FROM @itab WHERE (filter_sql)` trick. Consuming views reference it via `@Consumption.valueHelpDefinition` like any other value-help entity.

### Exposure in a RAP service

Service definition syntax is identical for views and custom entities — the reuse-services sample exposes both in one service:

```sql
define service ZUI_SalesOrder {
  expose ZC_SalesOrderTP     as SalesOrder;   " projection view
  expose ZI_ProductValueHelp as Product;      " custom entity (value help)
  expose ZI_ChangeDocument   as ChangeDocs;   " custom entity (API-backed)
}
```

The service binding does not care where the data comes from; the RAP runtime dispatches reads on custom entities to the `implementedBy` class.

## Abstract entities — typing without data

`define abstract entity` declares **only metadata**: on activation no database object is created, and it cannot be selected from — not in CDS, not in ABAP SQL. Its elements define a global structured type usable in ABAP via `TYPE`.

```sql
@EndUserText.label: 'Approve action parameters'
define abstract entity Z_A_ApproveParameters
{
  approval_comment : abap.char( 120 );
  notify_requester : abap_boolean;
}
```

Typical uses (grounded in the RAP BDL cheat sheet):

- **RAP action parameters** — `action approve parameter Z_A_ApproveParameters;` — a flat parameter references a CDS abstract entity or a DDIC type; deep parameters reference an abstract BDEF defined `with hierarchy`.
- **RAP business event payloads** — `event order_approved parameter Z_A_ApproveParameters;`.
- **Remote-shape proxies** — abstract entities describe data shapes that live elsewhere (e.g. artifacts generated for consuming remote OData services; see [abap-odata](../abap-odata/SKILL.md)).

Rule of thumb: abstract entity = "a structure the framework needs to see as CDS"; custom entity = "a queryable entity whose data comes from code". If nobody ever queries it, abstract is correct — no query class needed or possible.

## Table functions — CDS backed by SQLScript (AMDP)

`define table function` declares the interface; a static AMDP method implements it in SQLScript on HANA (syntax verified against the AMDP cheat sheet):

```sql
@ClientHandling.type: #CLIENT_DEPENDENT
@ClientHandling.algorithm: #SESSION_VARIABLE
define table function Z_TF_OverdueInvoices
  with parameters
    reference_date : abap.dats
  returns
  {
    client       : abap.clnt;
    invoice_id   : abap.char(10);
    days_overdue : abap.int4;
  }
  implemented by method zcl_invoice_amdp=>get_overdue_invoices;
```

```abap
CLASS-METHODS get_overdue_invoices FOR TABLE FUNCTION z_tf_overdueinvoices.
```

- No ABAP parameter interface: inputs come from the DDL `with parameters`; the return type is generated from the `returns` element list (elementary types; `key` allowed).
- The implementing method must be a **static method in the public section of an AMDP class** and is written `BY DATABASE FUNCTION FOR HDB LANGUAGE SQLSCRIPT`.
- Unlike custom entities, a table function **is** a valid data source: other CDS entities can select from it and so can ABAP SQL (`SELECT client, invoice_id, days_overdue FROM z_tf_overdueinvoices( reference_date = @today ) ...`). It is also a global structured type (but not usable for typing in DDIC).
- ABAP Cloud: pay attention to client handling — table functions need a client-safety annotation (`@ClientHandling.type` / `@ClientHandling.algorithm`; `@ClientHandling.clientSafe` checks are enforced automatically in ABAP for Cloud Development), and everything in the AMDP `USING` list must be client-safe.

SQLScript authoring, `USING`, and AMDP restrictions are owned by [abap-amdp-hierarchies](../abap-amdp-hierarchies/SKILL.md).

## CDS hierarchies

`define hierarchy` turns a parent-child relationship into a reusable SQL hierarchy. Prerequisite: a CDS view that exposes a *hierarchy association* — usually a self-association from child to parent:

```sql
define view entity Z_I_OrgUnitTree
  as select from zorg_unit
  association [1..1] to Z_I_OrgUnitTree as _parent
    on $projection.parent_unit_id = _parent.org_unit_id
{
      _parent,
  key org_unit_id,
      parent_unit_id,
      org_unit_name
}

define hierarchy Z_H_OrgUnits
  with parameters
    root_unit_id : abap.char(10)
  as parent child hierarchy(
    source Z_I_OrgUnitTree
    child to parent association _parent
    start where org_unit_id = :root_unit_id
    siblings order by org_unit_id ascending
  )
  {
    org_unit_id,
    parent_unit_id,
    org_unit_name
  }
```

Consume it directly in ABAP SQL — hierarchy columns such as `hierarchy_rank`, `hierarchy_level`, `hierarchy_parent_rank`, `hierarchy_is_cycle` can be selected even though they are not in the element list:

```abap
SELECT FROM z_h_orgunits( root_unit_id = @root_unit )
  FIELDS org_unit_id, org_unit_name, hierarchy_level, hierarchy_rank
  INTO TABLE @DATA(org_hierarchy).
```

`START WHERE` defines the root node set; the runtime then adds descendants transitively via the association's `ON` condition. Further additions control orphans, cycles, and multiple parents. Depth on hierarchies (plus the ABAP SQL hierarchy generator and HANA hierarchy functions) lives in [abap-amdp-hierarchies](../abap-amdp-hierarchies/SKILL.md).

## Extending view entities

`extend view entity` adds select-list fields (and optionally associations) to an existing view entity or projection view without modifying it (available since ABAP 7.55 / ABAP Cloud):

```sql
extend view entity Z_I_SalesOrder with
{
  zsalesorder.zz_priority as ZzPriority
}
```

Skeleton from the keyword docs: `EXTEND VIEW ENTITY entity [WITH association1 ...] { select_list_extension } [GROUP BY ...] [EXCEPT|INTERSECT|UNION [ALL] {...}]`. The extended view must permit extension (`@AbapCatalog.viewEnhancementCategory`); extensions of aggregating views must extend the `GROUP BY` accordingly. Field extensibility strategy (when to extend vs. wrap) belongs to the enhancements-extensibility skill.

## ABAP Cloud capability matrix

| Kind | Data source in other CDS? | ABAP SQL SELECT? | Global type in ABAP? | ABAP Cloud notes |
|---|---|---|---|---|
| view entity / root view entity | Yes | Yes | Yes | Only released objects as sources |
| projection view | Yes (per contract) | Yes | Yes | Contract restricts features |
| abstract entity | **No** | **No** | Yes | Pure typing artifact |
| custom entity | **No** | **No** | Yes | `implementedBy` mandatory; query class must use released APIs |
| table function | Yes | Yes | Yes (not in DDIC) | HANA-only; client-safety annotations required |
| hierarchy | As SQL hierarchy source | Yes (with hierarchy columns) | — | Source view must expose hierarchy association |
| extend view entity | (extends existing) | — | — | Extended entity must allow enhancement |

## Quick Reference

| I need to... | Use | Key syntax |
|---|---|---|
| Model a table for reuse | `define view entity` | `as select from dbtab` |
| Root a RAP BO | `define root view entity` | `composition [0..*] of ...` |
| Expose a BO to OData | projection view | `provider contract transactional_query` |
| Publish a stable BO API | projection view | `provider contract transactional_interface` |
| Serve API/log/remote data as OData | `define custom entity` | `@ObjectModel.query.implementedBy: 'ABAP:ZCL_...'` + `if_rap_query_provider` |
| Type a RAP action/event parameter | `define abstract entity` | flat `parameter Z_A_...` in the BDEF |
| Push logic to HANA SQLScript | `define table function` | `implemented by method class=>method` + `FOR TABLE FUNCTION` |
| Query a parent-child tree | `define hierarchy` | `parent child hierarchy( source ... start where ... )` |
| Add fields to a delivered view | `extend view entity` | `with { source.field as Alias }` |
| Read paging in a query provider | `io_request->get_paging( )` | `get_page_size( )` = `if_rap_query_paging=>page_size_unlimited` (-1) if unrestricted |
| Read filters in a query provider | `io_request->get_filter( )` | `get_as_ranges( )` raising `cx_rap_query_filter_no_range`; `get_as_sql_string( )` |
| Answer `$count` | `io_response` | `set_total_number_of_records( )` paired with `is_total_numb_of_rec_requested( )` |

## Common Mistakes

| Mistake | Fix |
|---|---|
| Replicating API data into a Z-table to build a view on it | Use a custom entity — the query provider calls the API live |
| `SELECT` from a custom entity in ABAP SQL or another CDS view | Not possible — custom entities are only reachable via OData/RAP; use the entity name only as a structured type |
| Custom entity without `@ObjectModel.query.implementedBy` in ABAP Cloud | The annotation is mandatory — bind the query class as `'ABAP:UPPERCASE_NAME'` |
| Ignoring paging in `select` — returning everything always | Read `get_page_size( )`/`get_offset( )`; treat `page_size_unlimited` (-1) as "no `$top`" |
| Calling `get_as_ranges( )` without a `TRY` | It raises `cx_rap_query_filter_no_range` for filters not representable as ranges — catch it and fall back to `get_as_sql_string( )` |
| Setting data but never `set_total_number_of_records` | List UIs request `$count`; answer `is_total_numb_of_rec_requested( )` with the total *before* paging is applied |
| Applying `$filter` manually with loops | `SELECT ... FROM @itab AS alias WHERE (filter_sql_string)` applies the OData filter to in-memory data in one statement |
| Abstract entity with a query class | Abstract entities are never queried — if it needs data, it must be a custom entity |
| Table function used like a custom entity (no AMDP) | `implemented by method` requires an AMDP class method `FOR TABLE FUNCTION`; custom entities require `if_rap_query_provider` — the kinds are not interchangeable |
| Missing client-safety annotation on a cloud table function | Add `@ClientHandling.type` / `@ClientHandling.algorithm`; ensure `USING` objects are client-safe |
| `provider contract` omitted on a RAP projection | The framework will not serve it as a transactional query — declare `provider contract transactional_query` |

## References

- [references/query-provider-contract.md](references/query-provider-contract.md) — full `if_rap_query_provider` / request / response contract with failure modes
- [examples/custom-entity-query-provider.md](examples/custom-entity-query-provider.md) — complete custom entity DDL + Clean-ABAP query provider class
- **IF_RAP_QUERY_PROVIDER:** https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/c49089658a294e36a260f912a84d3eb7.html
- **IF_RAP_QUERY_REQUEST:** https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/dcc3fe5b4dd24d5f909733a7c00ff281.html
- **IF_RAP_QUERY_RESPONSE:** https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/f6f51009e2504e6bbbc1b22220e9c32a.html
- **IF_RAP_QUERY_PAGING:** https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/c9e191cc92e54ca2bfec677037780c03.html
- **IF_RAP_QUERY_FILTER:** https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/5a4ea75def544e30a7dc24350a446f0e.html
- **IF_RAP_QUERY_AGGREGATION:** https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/02a976f77de44374be361d9df48610c5.html
- **Implementing an Unmanaged Query:** https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/254f68c7d5374e94a88241b7ce3bd414.html
- **Keyword docs — DEFINE CUSTOM ENTITY:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENCDS_F1_DEFINE_CUSTOM_ENTITY.html
- **Keyword docs — DEFINE ABSTRACT ENTITY:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENCDS_F1_DEFINE_ABSTRACT_ENTITY.html
- **Keyword docs — DEFINE HIERARCHY:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENCDS_F1_DEFINE_HIERARCHY.html
- **Keyword docs — EXTEND VIEW ENTITY:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENCDS_EXTEND_VIEW_ENTITY.html
- **Keyword docs — Table Functions:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENCDS_TABLE_FUNCTIONS.html
- **Keyword docs — PROVIDER CONTRACT:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENCDS_PV_PROVIDER_CONTRACT.html
- **SAP-samples/abap-platform-application-jobs** — real BAL-backed custom entity: https://github.com/SAP-samples/abap-platform-application-jobs
- **SAP-samples/abap-platform-reuse-services** — change-document and value-help custom entities: https://github.com/SAP-samples/abap-platform-reuse-services
- **SAP-samples/abap-cheat-sheets** — AMDP (12), SQL hierarchies (10), RAP BDL (36): https://github.com/SAP-samples/abap-cheat-sheets
- Linked skills: [cds-views-authoring](../cds-views-authoring/SKILL.md), [rap-bo-modeling](../rap-bo-modeling/SKILL.md), [abap-odata](../abap-odata/SKILL.md), [abap-amdp-hierarchies](../abap-amdp-hierarchies/SKILL.md), [abap-background-processing](../abap-background-processing/SKILL.md)
