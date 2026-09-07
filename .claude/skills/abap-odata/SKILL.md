---
name: abap-odata
description: "Use when creating, exposing, or consuming OData services in ABAP beyond RAP business-object modeling — choosing between a classic SEGW project (OData V2, on-premise), CDS-based exposure via SADL (@OData.publish, referenced data source), and a RAP service definition plus service binding; understanding OData V2 vs V4 differences that matter in ABAP; activating and registering services on-premise via /IWFND/MAINT_SERVICE and ICF versus publishing service bindings and communication arrangements in ABAP Cloud; consuming external OData through a service consumption model in ADT, the OData client proxy factories, or plain HTTP clients (cl_web_http_client_manager versus cl_http_client); and testing with /IWFND/GW_CLIENT, /IWFND/ERROR_LOG, or the ADT preview. Triggers include create OData service, SEGW, expose CDS view as OData, service binding, OData V2 vs V4, consume external OData, OData client proxy, service consumption model, communication arrangement, CSRF token, $batch, and $metadata error."
---

# ABAP OData Services — Create, Expose, Consume

## Overview

A guide for OData in ABAP as a protocol topic, not a modeling topic: which of the three creation paths to use (classic SEGW, CDS + SADL, RAP service binding), how services get activated and registered on-premise vs in ABAP Cloud, and how ABAP code consumes OData services — its own and external ones — via the service consumption model, the OData client proxy, or a raw HTTP client.

**Core principle:** the creation paths differ in *who writes the runtime*. In SEGW you write the data provider yourself (DPC methods). With CDS + SADL the framework derives the runtime from the view (read-mostly). With RAP the framework derives runtime *and* transactional behavior from the behavior definition. Newer paths need less code but demand more modeling; pick the newest path your release and scenario allow.

For modeling the RAP BO behind a service binding, defer to [rap-bo-modeling](../rap-bo-modeling/SKILL.md) — this skill only covers the exposure and consumption surface. For what is allowed in ABAP Cloud at all, see [abap-cloud-development](../abap-cloud-development/SKILL.md).

**Beyond OData.** OData is not the ABAP environment's only integration surface — the environment consumes services from and provides services to other systems over further protocols as well (such as SOAP web services and RFC); see the Integration and Connectivity guide in the references. This skill stays OData-focused.

For data-integration scenarios, CDS view entities can also be exposed via the **SQL service** and accessed externally through ODBC: unrestricted SQL read access to all exposed entities (ad-hoc joins, aggregation) with ABAP-level authentication, authorization, access control, and read access logging intact — used for data federation and for replication (e.g. into SAP Datasphere). That is what the *SQL* binding type in the table below serves; direct SQL access to the underlying HANA database is not recommended because it bypasses these ABAP-level concepts.

## Workflow

Decide along two axes: **direction** (provide vs consume) and **stack** (ABAP Cloud vs on-premise).

```
Provide a service?
├── ABAP Cloud (BTP ABAP Environment, S/4HANA Cloud public)
│   └── RAP: service definition + service binding.       ← only option for OData business
│       services (for read-only external SQL federation see the SQL service option above);
│       SEGW does not exist
├── On-premise / private cloud, new development
│   └── RAP if the release supports your scenario
│       (feature scope grows per release — the Fiori feature showcase
│        ships branches for ABAP Platform 2022 / 7.57 and 2023 / 7.58)
├── On-premise, read-mostly exposure of an existing CDS view, small scope
│   └── CDS + SADL: @OData.publish: true, or SEGW project
│       with "Reference > Data Source" on the CDS view
└── On-premise, maintaining an existing SEGW service
    └── Stay in SEGW for maintenance; plan migration to RAP for rework
        (see abap-modernization-playbook)

Consume a service?
├── ABAP Cloud
│   └── Service consumption model (ADT) → OData client proxy
│       + cl_web_http_client_manager over a communication arrangement
└── On-premise (Standard ABAP)
    └── OData client proxy factories where available,
        or cl_http_client over an SM59 destination + manual JSON/XML handling
```

Step order for providing:

1. **Model the data** — CDS view entities ([cds-views-authoring](../cds-views-authoring/SKILL.md)); for transactional scope also a behavior definition ([rap-bo-modeling](../rap-bo-modeling/SKILL.md)).
2. **Choose the path** with the tree above. Do not start new SEGW projects when RAP is available on your release.
3. **Create the exposure artifacts** — service definition + binding (RAP), annotation/SEGW reference (SADL), or SEGW project + DPC/MPC (classic).
4. **Activate/register** — publish the binding (ADT) or register in `/IWFND/MAINT_SERVICE` (on-premise gateway).
5. **Test** — ADT preview / browser for `$metadata` and data; `/IWFND/GW_CLIENT` on-premise for request-level testing.
6. **Authorize** — inbound communication arrangement + communication user (Cloud) or ICF/authorization setup (on-premise).

Step order for consuming: create the service consumption model from the target's `$metadata`, wire an HTTP client to a destination (communication arrangement or SM59), instantiate the matching client proxy, then build typed read/write requests. Details in [references/consuming-odata-services.md](references/consuming-odata-services.md).

## OData V2 vs V4 — what actually differs in ABAP

| Feature | OData V4 | OData V2 |
|---|---|---|
| Payload default | JSON | XML (Atom) default, JSON option |
| `$batch` format | JSON batch | Multipart MIME |
| Deep create/update | Supported | Limited |
| Actions/functions | Bound and unbound | Function imports |
| `$filter` | Rich (incl. lambda operators) | Basic |
| Aggregation | `$apply` transformations | Not native |
| Draft handling (RAP) | Full support | Via extensions |
| Recommendation | New development | Maintain existing only |

ABAP-specific consequences:

- **URL namespaces differ:** V2 services live under `/sap/opu/odata/...`, V4 services under `/sap/opu/odata4/...` (e.g. `/sap/opu/odata4/sap/<group>/srvd_a2x/sap/<service>/0001/`). A consumer pointed at the wrong namespace gets 404, not a protocol error.
- **Messages:** in RAP-exposed OData V2, messages are not modeled as entities — for successful (2xx) requests they travel in the custom `sap-message` response header. V4 returns them in the response body. Parsers that only read the body silently drop V2 warnings.
- **One service definition, both protocols:** in RAP you bind the *same* service definition as V2 and V4 in parallel bindings; the protocol choice is a binding property, not a modeling decision.
- **SEGW is V2-centric:** classic SEGW projects target OData V2 (V4 project support exists in newer Service Builder versions, but RAP is the recommended V4 path).

## Path 1 — RAP service definition + service binding

The recommended path everywhere it is available, and the *only* path in ABAP Cloud (for OData business services — see the SQL service option above for read-only external SQL federation). The BO modeling itself (CDS, BDEF, behavior pool, projections) belongs to [rap-bo-modeling](../rap-bo-modeling/SKILL.md); here only the exposure surface:

```cds
@EndUserText.label: 'Travel Service'
define service ZUI_TRAVEL_O4 {
  expose ZC_Travel  as Travel;
  expose ZC_Booking as Booking;
  expose I_Currency as Currency;
  expose I_Country  as Country;
}
```

Rules that matter:

- Expose projection views (`C_` convention), not root/base views.
- Also expose the value-help views (`I_*`) the UI needs — a Fiori value help against an unexposed entity fails at runtime.
- The alias becomes the OData entity set name.
- One service definition can back multiple bindings (V2 + V4, UI + Web API).

Service binding types (ADT wizard; binding names max 26 characters):

| Binding type | Protocol | Use case |
|---|---|---|
| OData V4 – UI | V4 | SAP Fiori Elements apps |
| OData V2 – UI | V2 | Legacy Fiori apps, older frontends |
| OData V4 – Web API | V4 | System-to-system (A2X) consumption |
| OData V2 – Web API | V2 | A2X, legacy consumers |
| InA – UI | InA | Analytical clients |
| SQL | SQL | SQL-based access (ODBC) |

Create via **New > Other ABAP Repository Object > Business Services > Service Binding**, pick the service definition and binding type, activate, then **Publish**. Publishing locally activates the service in SAP Gateway (on-premise) or registers the local endpoint (Cloud); **Preview** opens a generated Fiori Elements app against the binding. For annotation-driven V4 UIs on top of such a binding, the [SAP Fiori feature showcase](https://github.com/SAP-samples/abap-platform-fiori-feature-showcase) is the reference catalog.

## Path 2 — CDS-based exposure with SADL (on-premise)

Two variants, both generating the OData runtime from the CDS model via SADL (Service Adaptation Definition Language) instead of hand-written provider code:

**Variant A — auto-exposure annotation:**

```cds
@AbapCatalog.sqlViewName: 'ZVTRAVELEXP'
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Travel exposure'
@OData.publish: true
define view Z_Travel_Exposure
  as select from ztravel_tab
{
  key travel_id   as TravelId,
      description as Description,
      total_price as TotalPrice
}
```

Activating the view makes SADL generate the gateway artifacts (service `<CDS_VIEW>_CDS`, model, and related objects) into the same package and transport. You still must activate the generated service in `/IWFND/MAINT_SERVICE` on the gateway hub before it is consumable. Do not modify the generated artifacts.

**Variant B — SEGW referenced data source:** in SEGW choose **Reference > Data Source** and point the project at the CDS view. The data model is imported and the runtime is delegated to SADL; you keep the SEGW project shell (useful when mixing SADL entities with hand-coded ones).

When to pick this path: read-mostly exposure of an existing on-premise CDS view with minimal effort, on releases where RAP is not (fully) available. When *not*: transactional apps — the generated V2 service is read-oriented; writing requires the legacy Fiori programming model on top. For new transactional work use RAP.

## Path 3 — Classic SEGW (legacy, on-premise only)

SEGW (SAP Gateway Service Builder) is the project-based V2 workbench: you model entity types/sets/associations, generate runtime artifacts, and implement the runtime yourself. Not available in ABAP Cloud. As of AS ABAP 7.40 the gateway foundation (`SAP_GWFND`) is part of the standard stack.

```
SEGW project → Data model (entity types, sets, associations)
             → Generate → MPC/MPC_EXT (model provider), DPC/DPC_EXT (data provider)
             → Implement DPC_EXT methods (GET_ENTITYSET, GET_ENTITY, CREATE_ENTITY, ...)
             → Register + activate in /IWFND/MAINT_SERVICE
             → Test in /IWFND/GW_CLIENT
```

Key facts:

- Generated pairs: you never touch `*_MPC`/`*_DPC` (regenerated on every model change); your code lives in the `*_MPC_EXT`/`*_DPC_EXT` subclasses.
- Redefine `<ENTITY_SET>_GET_ENTITYSET`, `..._GET_ENTITY`, `..._CREATE_ENTITY`, `..._UPDATE_ENTITY`, `..._DELETE_ENTITY` per entity set.
- Query options (`$filter`, `$top`, `$skip`, `$orderby`, paging) arrive via `io_tech_request_context` — honor them or the service returns full tables to every client.
- Business errors are raised as `/iwbep/cx_mgw_busi_exception` with a message container; technical failures as `/iwbep/cx_mgw_tech_exception`.
- Deployment is either *embedded* (gateway on the business system) or *central hub* (dedicated gateway frontend); registration and the error log live on the hub.

A Clean-ABAP-style `GET_ENTITYSET` implementation honoring paging and filters is in [examples/segw_dpc_ext_get_entityset.abap](examples/segw_dpc_ext_get_entityset.abap); the full artifact map, method catalog, and registration walkthrough are in [references/segw-service-development.md](references/segw-service-development.md). For migrating a SEGW service to RAP, see [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md).

## Activation and registration

**On-premise (SEGW and SADL paths):**

1. `/IWFND/MAINT_SERVICE` — add the service to the gateway hub's service catalog (choose system alias, add service). Without this step the backend artifacts exist but no URL responds.
2. ICF — the service's ICF node must be active; 403/404 on a freshly registered service is usually an inactive node or missing authorization.
3. `/IWFND/ERROR_LOG` — first stop for runtime errors; entries can be replayed directly into `/IWFND/GW_CLIENT` for debugging.
4. Metadata is cached on the hub; after model changes, regenerate the SEGW runtime artifacts and clear the metadata caches (`/IWFND/CACHE_CLEANUP` on the hub, `/IWBEP/CACHE_CLEANUP` on the backend) before concluding your change "didn't work".

**ABAP Cloud:**

1. Publish the service binding in ADT (no `/IWFND/*` transactions exist).
2. External A2X consumers reach a Web API binding through **communication management**: expose the service in an inbound *communication scenario*; the administrator creates a *communication arrangement* from it, and a *communication user* carries the credentials. A UI binding for your own Fiori launchpad needs only an IAM app/business catalog.
3. Outbound (consuming) direction mirrors this: an *outbound service* (type HTTP — also required for OData), bundled into a communication scenario, instantiated as a communication arrangement.

## Consuming OData services from ABAP

**Step 1 — Service consumption model (ADT):** New > Service Consumption Model, remote consumption mode *OData*, upload the target service's `$metadata` file. ADT generates typed proxy artifacts (abstract entities per entity type, a service definition for the model) plus ready-to-adapt code templates. The generated proxy model is always OData-V4-shaped internally, even when the consumed service is V2.

**Step 2 — HTTP client.** This is where cloud and on-premise diverge:

| | ABAP Cloud | Standard ABAP (on-premise) |
|---|---|---|
| Client API | `cl_web_http_client_manager` → `if_web_http_client` | `cl_http_client` → `if_http_client` (also usable: the web client API on newer releases) |
| Destination | `cl_http_destination_provider=>create_by_comm_arrangement` (or `create_by_url` for prototyping) | SM59 destination via `cl_http_client=>create_by_destination`, or `create_by_url` |
| Configuration object | Communication arrangement | SM59 RFC destination (type G/H) |
| `cl_http_client` usable? | No — not released for ABAP Cloud | Yes |

```abap
" ABAP Cloud: HTTP client over a communication arrangement
DATA(lo_http_destination) = cl_http_destination_provider=>create_by_comm_arrangement(
                           comm_scenario = 'Z_OUTBOUND_TRAVEL'
                           service_id    = 'Z_OUTBOUND_TRAVEL_HTTP' ).
DATA(lo_http_client) = cl_web_http_client_manager=>create_by_http_destination( lo_http_destination ).
```

**Step 3 — Client proxy.** Instead of parsing JSON yourself, instantiate an OData client proxy over the HTTP client and work with typed requests:

```abap
" ABAP Cloud / RAP guide variant: proxy from the service consumption model
DATA(lo_client_proxy) = /iwbep/cl_cp_factory_remote=>create_v4_remote_proxy(
  is_proxy_model_key       = VALUE #( repository_id       = 'DEFAULT'
                                      proxy_model_id      = 'ZSC_TRAVEL'
                                      proxy_model_version = '0001' )
  io_http_client           = lo_http_client
  iv_relative_service_root = '/sap/opu/odata4/sap/zapi_travel/srvd_a2x/sap/zapi_travel/0001/' ).

DATA(lo_read_request) = lo_client_proxy->create_resource_for_entity_set( 'TRAVEL'
                       )->create_request_for_read( ).
lo_read_request->set_top( 50 ).

DATA lt_travels TYPE STANDARD TABLE OF zsc_travel_type.
lo_read_request->execute( )->get_business_data( IMPORTING et_business_data = lt_travels ).
lo_http_client->close( ).
```

Factory overview (all take the HTTP client plus the relative service root):

| Factory | Creates | Documented in |
|---|---|---|
| `/iwbep/cl_cp_factory_remote=>create_v4_remote_proxy` | V4 remote proxy from a proxy model key | RAP guide (ABAP Cloud) |
| `cl_web_odata_client_factory=>create_v4_remote_proxy` / `create_v2_remote_proxy` | V4/V2 remote proxy from a service definition name | Integration & connectivity guide |
| `/iwbep/cl_cp_client_proxy_fact=>create_v4_remote_proxy` | V4 remote proxy (Standard ABAP variant) | SAP OData samples |

CSRF is handled for you: the client proxy fetches an `X-CSRF-Token` via a HEAD request and reuses it for all requests of that proxy instance (`iv_do_fetch_csrf_token = abap_false` disables it). A local proxy variant exists for same-system consumption in integration tests, but it cannot consume SAP-delivered OData services.

Raw-HTTP consumption without a proxy (build the URL with `$filter`/`$top` yourself, parse JSON — see [abap-xml-json](../abap-xml-json/SKILL.md)) is the fallback when no consumption model is possible. Full request patterns — filters, CRUD, error handling, manual CSRF — in [references/consuming-odata-services.md](references/consuming-odata-services.md); a complete Clean ABAP consumer class in [examples/zcl_travel_odata_consumer.clas.abap](examples/zcl_travel_odata_consumer.clas.abap).

## Testing OData services

| Tool | Where | Best for |
|---|---|---|
| `/IWFND/GW_CLIENT` | On-premise gateway hub | Request-level testing without a UI: any HTTP method, header control, saved and replayable test cases, performance statistics |
| `/IWFND/ERROR_LOG` | On-premise gateway hub | Runtime errors with full request context; *Replay > Gateway Client* reproduces the failing call for debugging |
| ADT service binding preview | Everywhere | Instant Fiori Elements app against a published binding |
| Browser / REST client | Everywhere | `GET .../$metadata` sanity check, ad-hoc queries |

Testing discipline:

- First request after any change: `GET <service root>/$metadata` — if the model is wrong, nothing else matters.
- In `/IWFND/GW_CLIENT`, test modifying requests the way a client would: `GET` with header `X-CSRF-Token: Fetch` first, then `POST`/`PATCH` with the returned token.
- Test `$top=1` style scaled-down queries first; a `GET_ENTITYSET` that ignores paging looks fine on 10 rows and times out on production volume.

## Key error patterns

| Error / symptom | Likely cause → fix |
|---|---|
| 404 on service URL | Service not registered (`/IWFND/MAINT_SERVICE`) or binding not published; V2/V4 URL namespace mixed up |
| 403 Forbidden | Inactive ICF node, missing authorization, or (Cloud) missing communication arrangement / IAM assignment |
| 403 "CSRF token validation failed" | Modifying request without a valid `X-CSRF-Token`; fetch via GET/HEAD with `X-CSRF-Token: Fetch` and send the same session's cookies |
| `$metadata` empty or stale | Binding not published; SEGW artifacts not regenerated; hub metadata cache — clear `/IWFND/CACHE_CLEANUP` and `/IWBEP/CACHE_CLEANUP` |
| `/IWBEP/CX_MGW_BUSI_EXCEPTION` | Business error raised in DPC — check message container content, validate input |
| `/IWBEP/CX_MGW_TECH_EXCEPTION` | Model/runtime inconsistency — regenerate SEGW artifacts, check `/IWFND/ERROR_LOG` |
| `$batch` fails as a whole (V2) | Malformed multipart boundaries or a failing changeset (changesets are atomic — one error rolls back the set) |
| `CX_WEB_HTTP_CLIENT_ERROR` on consumption | Destination/communication arrangement broken, TLS trust missing |
| Deep create fails | Missing composition in CDS/BDEF (RAP) or missing `create_deep_entity` implementation (SEGW) |
| V2 consumer "loses" warnings | Messages are in the `sap-message` response header on 2xx, not in the body |

## Quick Reference

| Need | Use |
|---|---|
| New service, ABAP Cloud | RAP service definition + service binding (only option for OData business services — see the SQL service option above for read-only external SQL federation) |
| New transactional service, on-premise with RAP support | RAP service definition + binding |
| Quick read-only exposure of a CDS view, on-premise | `@OData.publish: true` or SEGW referenced data source (SADL) |
| Maintain existing V2 service | SEGW (`*_DPC_EXT` / `*_MPC_EXT` classes) |
| Fiori Elements UI | Binding type *OData V4 – UI* |
| System-to-system API | Binding type *OData V4 – Web API* + inbound communication scenario (Cloud) |
| Register service on-premise | `/IWFND/MAINT_SERVICE` |
| Debug a failing request on-premise | `/IWFND/ERROR_LOG` → replay in `/IWFND/GW_CLIENT` |
| Consume external OData, Cloud | Service consumption model + `/iwbep/cl_cp_factory_remote` proxy over `cl_web_http_client_manager` |
| Consume external OData, on-premise | Client proxy factories where available, else `cl_http_client` + manual parsing |
| HTTP without OData semantics | `cl_web_http_client_manager` (Cloud) / `cl_http_client` (on-premise) |
| Stale metadata after change | `/IWFND/CACHE_CLEANUP` + `/IWBEP/CACHE_CLEANUP`, regenerate artifacts |

## Common Mistakes

| Wrong | Right |
|---|---|
| Starting a new SEGW project on a release where RAP is available | New services via RAP service definition + binding; SEGW only for maintaining existing V2 services |
| Re-explaining persistence/behavior in the service layer | Service definition/binding stay thin; behavior belongs in the BDEF ([rap-bo-modeling](../rap-bo-modeling/SKILL.md)) |
| Editing generated `*_DPC`/`*_MPC` classes in SEGW | Implement only in `*_DPC_EXT`/`*_MPC_EXT`; base classes are overwritten on regeneration |
| `SELECT` of the full table in `GET_ENTITYSET`, ignoring `io_tech_request_context` | Apply `$filter`/`$top`/`$skip`/`$orderby` from the request context in the SELECT itself |
| Using `cl_http_client` in ABAP Cloud code | Not released — use `cl_http_destination_provider` + `cl_web_http_client_manager` |
| Hardcoding target URLs/credentials in consumer code | Communication arrangement (Cloud) or SM59 destination (on-premise); `create_by_url` only for prototypes |
| Sending POST/PATCH without a CSRF token, then "fixing" it by disabling the check | Fetch the token (`X-CSRF-Token: Fetch` on GET/HEAD) and resend; the client proxy does this automatically |
| Parsing consumed OData JSON by hand although a `$metadata` file is available | Generate a service consumption model and use the typed client proxy |
| Testing only through the Fiori app | Test at protocol level first: `$metadata`, then entity requests in `/IWFND/GW_CLIENT` or a REST client |
| Concluding a model change "didn't arrive" while the hub cache still serves old metadata | Regenerate, then clear `/IWFND/CACHE_CLEANUP` / `/IWBEP/CACHE_CLEANUP`, then retest |
| Exposing the root CDS view in the service definition | Expose the projection (`C_`) views plus needed value-help entities |
| Reading only the response body of a V2 service for messages | Also read the `sap-message` header on 2xx responses |

## References

- [references/consuming-odata-services.md](references/consuming-odata-services.md) — consumption deep dive: service consumption model, client proxy request patterns, HTTP clients, CSRF, error handling
- [references/segw-service-development.md](references/segw-service-development.md) — SEGW deep dive: artifact map, DPC/MPC method catalog, registration, troubleshooting workflow
- [examples/zcl_travel_odata_consumer.clas.abap](examples/zcl_travel_odata_consumer.clas.abap) — Clean ABAP consumer class (ABAP Cloud, V4 client proxy)
- [examples/segw_dpc_ext_get_entityset.abap](examples/segw_dpc_ext_get_entityset.abap) — SEGW DPC_EXT `GET_ENTITYSET` honoring paging and filters
- **Creating an OData Service (RAP):** https://help.sap.com/docs/abap-cloud/abap-rap/creating-odata-service
- **Creating a Service Binding:** https://help.sap.com/docs/abap-cloud/abap-rap/creating-service-binding
- **Publishing the OData Service Locally:** https://help.sap.com/docs/abap-cloud/abap-rap/publishing-odata-service-locally
- **OData V2 protocol notes in RAP (incl. `sap-message` header):** https://help.sap.com/docs/abap-cloud/abap-rap/odata-v2
- **Creating a Remote Client Proxy:** https://help.sap.com/docs/abap-cloud/abap-rap/creating-remote-client-proxy
- **Creating a Service Consumption Model (ADT):** https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/creating-service-consumption-model
- **OData Client Proxy Overview:** https://help.sap.com/docs/abap-cloud/abap-integration-connectivity/odata-client-proxy-overview
- **Client Proxy Examples (V2/V4 factories, CSRF):** https://help.sap.com/docs/abap-cloud/abap-integration-connectivity/client-proxy-examples
- **Consuming an HTTP Service (ABAP Cloud):** https://help.sap.com/docs/abap-cloud/abap-integration-connectivity/consume-http-service
- **Outbound Service (communication management):** https://help.sap.com/docs/abap-cloud/abap-integration-connectivity/outbound-service
- **Integration and Connectivity (BTP ABAP Environment overview):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/integration-and-connectivity-f6c7368.md
- **Accessing ABAP-Managed Data Using SQL Services (ODBC):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/accessing-abap-managed-data-using-sql-services-for-data-integration-scenarios-4082fe1.md
- **Data Integration (concept and architecture overview):** https://help.sap.com/docs/abap-cloud/abap-integration-connectivity/data-integration
- **SAP Gateway Service Builder (SEGW):** https://help.sap.com/docs/ABAP_PLATFORM_NEW/68bf513362174d54b58cddec28794093/cddd22512c312314e10000000a44176d.html
- **Expose CDS View as an OData Service (`@OData.publish`):** https://help.sap.com/docs/SAP_NETWEAVER_AS_ABAP_751_IP/cc0c305d2fab47bd808adcad3ca7ee9d/79cb3bf4eafd4af9b39bc6842e5be8bd.html
- **OData Service Based on a Referenced Data Source (SEGW + SADL):** https://help.sap.com/docs/SAP_NETWEAVER_AS_ABAP_752/eeaee7c1890d41c9a5e237a583bececa/d0d28697a5804135afa8d188c91dae83.html
- **Registering an OData Service (on-premise):** https://help.sap.com/docs/SAP_NETWEAVER_AS_ABAP_752/cc0c305d2fab47bd808adcad3ca7ee9d/f65634b0b2ef4a13b562d9b42fc65f0c.html
- **SAP-samples/abap-platform-fiori-feature-showcase** — OData V4 + UI annotations on RAP: https://github.com/SAP-samples/abap-platform-fiori-feature-showcase
- Linked skills: [rap-bo-modeling](../rap-bo-modeling/SKILL.md), [abap-cloud-development](../abap-cloud-development/SKILL.md), [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md), [cds-views-authoring](../cds-views-authoring/SKILL.md), [abap-xml-json](../abap-xml-json/SKILL.md)
