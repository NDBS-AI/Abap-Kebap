---
name: abap-business-configuration
description: "Use when building or maintaining business configuration (customizing) in ABAP Cloud — creating a RAP-based Business Configuration Maintenance Object (BCMO) so business users can maintain a customizing table in ABAP Cloud through the Custom Business Configurations Fiori app, generating the objects with the ADT Generate ABAP Repository Objects wizard, registering a service binding through the mbc_cp_api Maintain Business Configurations API, recording changes on customizing transport requests inside the RAP save sequence, or activating Business Configuration Sets with the runtime API. Covers delivery-class-C client-dependent tables, language-dependent text tables, S_TABU_NAM authorization and IAM apps, transport patterns across software components, and CL_SCPR_CD_BCSET_ACTIVATION. Triggers include business configuration maintenance object, customizing table in ABAP Cloud, Custom Business Configurations app, transport customizing, BC set, MBC, SMBC, delivery class C, and record changes on transport request."
---

# Business Configuration in ABAP Cloud

## Overview

Business configuration (customizing) is content in client-dependent tables that changes how an application behaves — status codes, calendars, thresholds, mappings. In ABAP Cloud there is no SM30: the documented pattern is to build a draft-enabled RAP business object on top of the customizing table, expose it as an OData V4 UI service, and declare that service binding as a **Business Configuration Maintenance Object (BCMO)**. The standard **Custom Business Configurations** (CUBCO) Fiori app then renders a Fiori Elements List Report for it — no custom Fiori app needed.

Three pillars, all covered here:

1. **BCMO + CUBCO app** — the maintenance UI: customizing table → RAP BO → service binding → BCMO registration → IAM authorization.
2. **Transport handling** — customizing content is client-dependent data; changes must be recorded on transport requests of type *Customizing* inside the RAP save sequence (`mbc_cp_api=>rap_tdat_cts`).
3. **Business Configuration Sets (BC sets)** — containers that group customizing data; activated at runtime with `CL_SCPR_CD_BCSET_ACTIVATION`, created/changed via ADT wizard or XCO generation APIs.

This skill covers the ABAP-Cloud (BTP ABAP Environment / S/4HANA Cloud) model. For the RAP mechanics themselves, defer to [rap-bo-modeling](../rap-bo-modeling/SKILL.md) (BDEF basics) and [rap-saves-and-numbering](../rap-saves-and-numbering/SKILL.md) (save sequence, `with additional save`).

## Workflow

End-to-end for a new maintainable customizing table:

1. **Define the customizing table(s)** — delivery class C, client key field, `@AbapCatalog.dataMaintenance` allowed or restricted, `abp_lastchange_tstmpl` / `abp_locinst_lastchange_tstmpl` timestamp fields, optional text tables with a `#TEXT_KEY` foreign key.
2. **Generate or build the RAP BO** — preferably run the ADT *Generate ABAP Repository Objects* wizard on the basis table (category *Business Configuration Management* → *Maintenance Object*); it creates the whole stack. Manual alternative: draft-enabled managed BO + OData V4 UI service binding, then create the BCMO yourself.
3. **Wire transport handling** — `with additional save` recording via `record_changes`, per-entity validations calling `validate_changes`, a transport-selection action with parameter entity `D_SelectCustomizingTransptReqP`. (The wizard generates all of this.)
4. **Register the BCMO** — via the ADT wizard (*New > Other ABAP Repository Object > Business Configuration Management > Business Configuration Maintenance Object*) or programmatically with `mbc_cp_api=>business_configuration_api( ... )->create( ... )`. Registration is a workbench-transported object of type SMBC.
5. **Authorize** — IAM app of type *Business Configurations* app for the service binding, authorization object (recommended: `S_TABU_NAM` with the CDS root entity name), business catalog → business role → users.
6. **Hand over to the business process configuration expert** — they maintain content in the *Custom Business Configurations* app, record it on a customizing transport, release it in *Export Customizing Transports*, and import by pulling the software component in the target tenant/client.

## Customizing tables — the foundation

Business configuration objects are based on database tables with **delivery class C** (`@AbapCatalog.deliveryClass : #C`) — content transportable between tenants — and every table in the data model must be **client-dependent**. From the SAP docs' /DMO/ status example:

```
@EndUserText.label : 'Status Class'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #C
@AbapCatalog.dataMaintenance : #ALLOWED
define table /dmo/statusclass {
  key client            : abap.clnt not null;
  key status_class_id   : /dmo/status_class_id not null;
  last_changed_at       : abp_lastchange_tstmpl;
  local_last_changed_at : abp_locinst_lastchange_tstmpl;
}
```

Language-dependent texts live in a text table with a `abap.lang` key and a `#TEXT_KEY` foreign key back to the parent:

```
@EndUserText.label : 'Status Class Text'
@AbapCatalog.deliveryClass : #C
@AbapCatalog.dataMaintenance : #ALLOWED
define table /dmo/stclasstext {
  key client            : abap.clnt not null;
  key lang              : abap.lang not null;
  @AbapCatalog.foreignKey.keyType : #TEXT_KEY
  key status_class_id   : /dmo/status_class_id not null
    with foreign key /dmo/statusclass
    where client = /dmo/stclasstext.client
      and status_class_id = /dmo/stclasstext.status_class_id;
  description           : /dmo/description;
  local_last_changed_at : abp_locinst_lastchange_tstmpl;
}
```

Wizard-relevant table requirements (all tables): client key field, delivery class C, data maintenance allowed or restricted, and optionally `abp_locinst_lastchange_tstmpl` (without it, concurrency control is not active). The **basis table** should additionally carry `abp_lastchange_tstmpl` — without it, the entire ETag is handled by CDS entity `I_CstmBizConfignLastChgd`. Additional (child) tables need a `#KEY` foreign key fully matching the basis table's primary key. See [abap-dictionary-ddic](../abap-dictionary-ddic/SKILL.md) for DDIC details and [cds-views-authoring](../cds-views-authoring/SKILL.md) for the CDS layer on top.

## Business Configuration Maintenance Object (BCMO)

A BCMO **declares a service binding as relevant for business configuration**. Once it exists (and the user is authorized), the configuration appears in the list of the *Custom Business Configurations* app. Repository object type: **SMBC**; inventory query: CDS view `I_CustABAPObjDirectoryEntry` with `ABAPObjectType = 'SMBC'`.

Documented prerequisites:

- The service binding must be of type **OData V4 – UI** and expose a CDS root entity with a **draft-enabled** behavior definition.
- Supported composition tree shapes:
  - height **≤ 2** (root A with children B, C; C may have child D; D must be a leaf), or
  - height **≤ 3** only when the option *skip root entity list report* is enabled — then the root must be a **singleton** with exactly one child entity.
- The data model must consist **only of client-dependent tables**.

Creation paths:

- **ADT wizard**: *New > Other ABAP Repository Object > Business Configuration Management > Business Configuration Maintenance Object* — enter name + description.
- **API**: `mbc_cp_api` (next section).
- **Generator**: created automatically by the *Generate ABAP Repository Objects* wizard together with everything else.

## Generator wizard vs manual implementation

**Prefer the wizard.** Run *Generate ABAP Repository Objects* from the context menu of the basis database table, folder *Business Configuration Management*, type *Maintenance Object*. It generates the full stack (it cannot overwrite existing objects or generate a subset). The generated RAP BO has these documented properties:

- draft-enabled, **managed**;
- authorization control via `S_TABU_NAM` with the CDS view entity name of the basis table;
- concurrency control based on the table timestamp fields;
- integration of the BC transport API (`validate_changes` / `record_changes`) against a customizing transport request;
- a **singleton root entity** for mass editing and manual transport selection;
- internal numbering for key fields typed `raw(16)` (UUID).

Wizard scenario options (select per need): *Add Copy Action* (factory copy action, with an abstract parameter entity for user input unless all non-client keys are `raw(16)`), *Add Deprecate Actions* (requires field `CONFIGDEPRECATIONCODE` typed `CONFIG_DEPRECATION_CODE`; foreign-key checks then warn on deprecated / error on invalidated entries), *Add Data Consistency Check* (a validation on the draft `Prepare` action: type checks, fixed values, foreign-key checks where `@AbapCatalog.foreignKey.screenCheck : true` and the check table is outside the BO, invalid trailing characters in character-like keys), *Enable Transport Selection Strip* (header-toolbar transport display; auto-triggers selection on save when mandatory), and *Transport Selection* = *Manual* / *Manual with preselection* (auto-determines a request on Edit; logic documented in ABAP Doc of `if_mbc_cp_rap_tdat_cts` method `get_transport_request`) / *No Transport* (for configuration adjusted directly in the productive client). You also name the **BC Maintenance Object** and a **Transport Object** of type *Individual Transaction* under which content changes are recorded.

**Manual path** (when you already have a BO or need full control): build the draft-enabled managed RAP BO yourself ([rap-bo-modeling](../rap-bo-modeling/SKILL.md)), expose it via service definition + OData V4 UI service binding, implement transport handling as below, then create the BCMO in ADT or register it via API. UI polish happens through CDS UI annotations ([fiori-elements-ui-annotations](../fiori-elements-ui-annotations/SKILL.md)) plus the BCMO editor's Fiori Elements settings (list report / object page / table settings, e.g. *Table Creation Mode* = *New Page* vs *Creation Row*, and a *Configuration Group* data element for grouping in the app).

A full walkthrough of the generated scenario is in [examples/bcmo-scaffold/README.md](examples/bcmo-scaffold/README.md).

## Registering via the Maintain Business Configurations API (mbc_cp_api)

The ABAP API `mbc_cp_api` creates, updates, deletes, and reads BCMOs. Obtain a handle with `mbc_cp_api=>business_configuration_api( )` passing an identifier; errors raise `cx_mbc_api_exception` (read messages via `if_xco_news~get_messages`).

```abap
CLASS zcl_register_holiday_bc DEFINITION PUBLIC FINAL CREATE PUBLIC
    INHERITING FROM cl_xco_cp_adt_simple_classrun.
  PROTECTED SECTION.
    METHODS main REDEFINITION.
ENDCLASS.

CLASS zcl_register_holiday_bc IMPLEMENTATION.
  METHOD main.
    DATA(business_configuration) =
      mbc_cp_api=>business_configuration_api( '/Y123456/HOLIDAY_CALENDAR' ).

    TRY.
        business_configuration->create(
          iv_name            = 'Holiday Calendar'
          iv_description     = 'A calendar for holidays'
          iv_service_binding = '/Y123456/CAL_I_HOLIDAY_SB'
          iv_service_name    = 'Holiday'
          iv_service_version = 0001
          iv_root_entity_set = 'HolidayRoot'
          iv_transport       = 'X02K900025' ).
      CATCH cx_mbc_api_exception INTO DATA(api_error).
        LOOP AT api_error->if_xco_news~get_messages( ) INTO DATA(message).
          " message->get_text( ) carries the error text.
        ENDLOOP.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
```

Documented facts about `create`:

- Name and description are **language-dependent**; translations are maintained in the *Maintain Translations* app.
- The service binding must be OData V4 – UI and draft-enabled; the root entity set is the UI root — only it and its associations get a UI, and only **one level of sub nodes** is supported via this API.
- `iv_transport` must be a **Workbench** transport request — an entry of type SMBC is written to it. (Registration is a development artifact; the *content* later travels on *Customizing* requests.)
- Optional parameters: *skip root entity list report* (`abap_true` jumps straight to the object page; exactly one root entity must exist) and *app configuration* (deviations from standard list report / object page behavior).
- The application component shown in frontend error messages is derived from the package of the registered service binding.

Other methods on the handle: `update_name`, `update_decription` (sic — SAP's own spelling in the released API), `delete` (workbench transport required), `exists` (returns `abap_true`/`abap_false`), `read` (returns the full metadata structure). Verify method availability in ADT's code completion — see **BC Sets Runtime API** in References for the full list.

## Transport handling inside the RAP BO

Customizing content is created in a development system and transported onward; the developer must ensure changes are **recorded on a transport request of type Customizing** and the user can pick the right request. Documented recipe (see [references/transport-and-lifecycle.md](references/transport-and-lifecycle.md) for the deep dive):

**1. Instantiate the transport API** with factory `mbc_cp_api=>rap_tdat_cts`, mapping CDS entities to their tables:

```abap
DATA(transport_api) = mbc_cp_api=>rap_tdat_cts(
  tdat_name              = '/ITAPC1/CODE'
  table_entity_relations = VALUE #(
    ( entity = '/ITAPC1/I_Status'     table = '/ITAPC1/STATUS' )
    ( entity = '/ITAPC1/I_StatusText' table = '/ITAPC1/STATUST' ) ) ).
```

**2. Record changes in the save sequence.** Declare an additional save directly after `managed` in the BDEF header (`with additional save` — mechanics in [rap-saves-and-numbering](../rap-saves-and-numbering/SKILL.md)) and call the API's `record_changes` method in `save_modified`. The docs defer the exact signature to the ABAP Doc of `record_changes` — check it in ADT.

**3. Validate the transport on save.** For each entity of the BO, define a validation on save for create, update, and delete that calls the API's `validate_changes` method (again: signature per ABAP Doc, verify in ADT):

```
// BDEF sketch — exact generated names vary; inspect wizard output in ADT
managed with additional save implementation in class zbp_i_status unique;
with draft;
...
define behavior for ZI_Status alias Status
{
  ...
  validation validatetransportrequest on save { create; update; delete; }
}
```

**4. Transport selection.** Define an action whose parameter is the abstract CDS entity `D_SelectCustomizingTransptReqP`. It returns all modifiable *Customizing* transport requests where the user owns the request or at least one open task; requests must have attribute `SAP_CUS_TRANSPORT_CATEGORY` = `MANUAL_CUST` or `DEFAULT_CUST`. Save the chosen request in a **virtual field of the draft entity**, and read it back when recording/validating.

**5. No transport** is a legitimate documented mode (wizard option *No Transport*) for configuration meant to be adjusted directly in the productive client.

Landscape-level behavior (details and roles in [references/transport-and-lifecycle.md](references/transport-and-lifecycle.md)):

- Business configuration is **client-dependent** — after import it exists only in the client where the import ran (unlike development objects).
- Releasing a customizing request pushes changes to the Git repository of the associated software component; targets import by **pulling** that software component.
- Three documented patterns: isolated tenants (local default request, no transport), one software component of type *Business Configuration* (simple), or software components of type *Development* (parallel projects; keep each business configuration object in **one** software component, or you must clone components in the right order).
- Only **one open transport request of type Default** may exist at a time; additional parallel requests are category *Manual* (`SAP_CUS_TRANSPORT_CATEGORY = MANUAL_CUST`, plus `SAP_ATO_TRANSPORT_TYPE = BC` when created in ADT's Transport Organizer).

## Authorization

RAP authorization control protects the customizing data (general RAP auth: [abap-authorization](../abap-authorization/SKILL.md)). The docs recommend `S_TABU_NAM` **with the CDS root entity name** as TABLE value — then extending the BO with a new table needs no auth change. Physical table names or a custom authorization object are documented alternatives.

DCL on the root entity:

```
@MappingRole: true
define role /ITAPC1/I_Status {
  grant select on /ITAPC1/I_Status
  where ( ) = ASPECT pfcg_auth ( 'S_TABU_NAM', ACTVT = '03', TABLE = '/ITAPC1/I_STATUS' );
}
```

Global authorization in the behavior implementation:

```abap
METHOD get_global_authorizations.
  AUTHORITY-CHECK OBJECT 'S_TABU_NAM'
    ID 'TABLE' FIELD '/ITAPC1/I_STATUS'
    ID 'ACTVT' FIELD '02'.
  DATA(is_authorized) = COND #( WHEN sy-subrc = 0 THEN if_abap_behv=>auth-allowed
                                ELSE if_abap_behv=>auth-unauthorized ).
  result-%update      = is_authorized.
  result-%action-edit = is_authorized.
ENDMETHOD.
```

Frontend wiring: create an **IAM app of type *Business Configurations* app**, select service type OData V4 and the BCMO's service binding, maintain the authorization object (e.g. `S_TABU_NAM` with `ACTVT = Change, Display; TABLE = /ITAPC1/I_STATUS`) in the authorizations tab, assign the IAM app to an IAM business catalog, the catalog to a business role, the role to users. Whether a user gets write or read access is decided in the business role's General Role Details.

## The Custom Business Configurations app (user side)

- **Access**: business catalog `SAP_CORE_BC_BCT_MBC_PC`, contained in role template `SAP_BR_BPC_EXPERT`. A BCMO is listed only if the user also has the service authorizations above.
- **Usage**: open the app → list of maintainable business configurations → select one → add/update/delete entries (draft-based editing, transport selection as implemented by the BO).
- **Intent navigation**: semantic object `BusinessConfiguration`, action `maintain`, parameter `TechnicalIdentifier` — e.g. `#BusinessConfiguration-maintain?TechnicalIdentifier=ZPLANT`, or deep-link to one record when all technical keys are passed: `#BusinessConfiguration-maintain?TechnicalIdentifier=ZPLANT&PlantID=201`.
- **Display Change Logs** appears when table logging is active for at least one table of the BO and the *Business Configuration Change Logs* app is a valid navigation target (that app needs catalog `SAP_CORE_BC_BCT_LOG_PC` and `S_TABU_NAM` with *Display Change Documents*).
- **Show Documentation** appears when a knowledge transfer document exists for the BCMO.
- **Grouping**: users can group the list by *Configuration Group*; the developer supplies a data element (same software component) whose description is the group label; unmaintained objects fall under *Not Assigned*.
- Incident component: `BC-CUS-TOL-MBC`.

Alternative for mass data without a full BO: the **Upload Business Configuration** app imports .xlsx content into delivery-class-C tables (max 5000 rows per file, no `STRING`/`XSTRING` fields, needs `S_TABU_NAM` `ACTVT = 02` on the table and an open customizing transport).

## Business Configuration Sets — runtime activation API

A **BC set** (object type SCP1) is a container grouping customizing data logically; activating it deploys the content into the customizing tables. Create one with the ADT creation wizard (importing content from a customizing transport) or via the XCO generation APIs. Full API detail: [references/bc-sets-runtime-and-xco.md](references/bc-sets-runtime-and-xco.md).

Runtime activation with `CL_SCPR_CD_BCSET_ACTIVATION` — four documented steps:

```abap
TRY.
    " 1. Access the activation handler
    DATA(activate_handler) =
      cl_scpr_cd_bcset_activation=>of( 'ZMY_BC_SET' )->get_activate_handler( ).

    " 2. (Optional) customize activation options — default: all active system languages
    DATA(activation_options) =
      cl_scpr_cd_bcset_activation=>options( )->get_activate_options( ).
    activation_options->add_activation_languages( VALUE #( ( langu = 'E' ) ( langu = 'F' ) ) ).

    " 3. Activate: local( ) deploys to the tables locally — NOT captured on a transport
    DATA(activation_result) =
      activate_handler->local( )->add_activation_options( activation_options )->start( ).

    " 4. Evaluate the result
    IF activation_result->is_bcset_activation_successful( ) = abap_false.
      DATA(activation_messages) = activation_result->get_messages( ).  " BAPIRETTAB
    ENDIF.
  CATCH cx_scpr_object_not_permitted INTO DATA(activation_error).
    " BC_SET_NOT_FOUND or BC_SET_NOT_PERMITTED (object restrictions / language version)
    DATA(error_text) = activation_error->get_text( ).
ENDTRY.
```

Documented specifics: `of( iv_bcset )` raises `CX_SCPR_OBJECT_NOT_PERMITTED` if the set doesn't exist or restriction/language-version checks fail (`=>BC_SET_NOT_FOUND`, `=>BC_SET_NOT_PERMITTED`); *Activation Languages* is the customizable option (default = all active system languages); `local( )` means the deployment is not captured in a transport request; results expose `is_bcset_activation_successful( )` and `get_messages( )` returning `BAPIRETTAB`. The docs name the involved interfaces `IF_SCPR_CD_BCSET_ACTIVATION` / `IF_SCPR_CD_BCSET_ACTIV_HANDLER` / `IF_SCPR_CD_BCSET_ACTIV_OPTIONS` / `IF_SCPR_CD_BCSET_ACTIV_RESULT` (with some inconsistent spellings across pages — verify exact interface names in ADT).

## Edge cases the docs call out

- **Language-dependent texts** appear in three places: text tables (`abap.lang` key + `#TEXT_KEY` foreign key) inside the BO, the BCMO name/description (translated via *Maintain Translations*), and BC set activation languages (default all active system languages).
- **Client handling**: everything is client-dependent. Imports land only in the import client; consumer tenants (client ≥ 200) in multitenant systems are always isolated tenants — changes there go to a local default customizing request and are not exported.
- **Local-only customizing** is possible: a customizing request without transport target records changes, but releasing it has no effect.
- **Concurrency**: without `abp_locinst_lastchange_tstmpl` per table there is no concurrency control; without `abp_lastchange_tstmpl` on the basis table the whole ETag falls back to `I_CstmBizConfignLastChgd`.
- **Critical changes and semantic locks**: critical configuration changes verified against test/production create a *Semantic Business Configuration Lock Token* there; the lock blocks related business processes until the transport carrying the change is imported (or the change is reverted and that transport imported).
- **Authorizations are two-layered**: app access (catalog `SAP_CORE_BC_BCT_MBC_PC`) and per-configuration service authorization (IAM app + auth object) — users may see the app but only some configurations, or a configuration read-only.

## Quick Reference

| Item | Value / class | Role |
|---|---|---|
| Table delivery class | `@AbapCatalog.deliveryClass : #C` | Marks content as transportable customizing |
| Data maintenance | `@AbapCatalog.dataMaintenance : #ALLOWED` (or restricted) | Wizard prerequisite on every table |
| ETag fields | `abp_lastchange_tstmpl` (basis), `abp_locinst_lastchange_tstmpl` (each table) | Concurrency control; fallback entity `I_CstmBizConfignLastChgd` |
| BCMO object type | SMBC | Query via `I_CustABAPObjDirectoryEntry` (`ABAPObjectType = 'SMBC'`) |
| Registration API | `mbc_cp_api=>business_configuration_api( )` → `create` / `update_name` / `delete` / `exists` / `read` | Register service binding as BCMO; workbench transport |
| Registration error | `cx_mbc_api_exception` + `if_xco_news~get_messages` | Message retrieval |
| Transport API | `mbc_cp_api=>rap_tdat_cts( tdat_name = ... table_entity_relations = ... )` | `record_changes` in additional save, `validate_changes` in on-save validations |
| Transport preselection | `if_mbc_cp_rap_tdat_cts`, method `get_transport_request` | Determination logic for *Manual with preselection* |
| Transport selection entity | Abstract CDS entity `D_SelectCustomizingTransptReqP` | Action parameter listing modifiable customizing requests |
| Request attributes | `SAP_CUS_TRANSPORT_CATEGORY` = `DEFAULT_CUST` / `MANUAL_CUST`; `SAP_ATO_TRANSPORT_TYPE = BC` | Category of customizing requests; ADT-created manual requests |
| Recommended auth object | `S_TABU_NAM` with CDS root entity name | DCL + `get_global_authorizations` + IAM app |
| CUBCO app catalog | `SAP_CORE_BC_BCT_MBC_PC` (role template `SAP_BR_BPC_EXPERT`) | App access |
| Intent navigation | `#BusinessConfiguration-maintain?TechnicalIdentifier=<BCMO>` | Deep link into a configuration |
| BC set object type | SCP1 | XCO handle: `xco_cp_abap_repository=>object->scp1->for( ... )` |
| BC set activation | `cl_scpr_cd_bcset_activation=>of( )->get_activate_handler( )->local( )->add_activation_options( )->start( )` | Runtime deployment to customizing tables |
| BC set activation errors | `cx_scpr_object_not_permitted` (`BC_SET_NOT_FOUND`, `BC_SET_NOT_PERMITTED`) | Existence / permission checks |
| Incident components | `BC-CUS-TOL-MBC` (CUBCO), `BC-CUS-TOL-BCD` (upload), `BC-CUS-TOL-ALO` (change logs) | Support |

## Common Mistakes

| Mistake (wrong) | Symptom | Fix (right) |
|---|---|---|
| Table with delivery class A (or any non-C class) used as customizing | Content not treated as transportable customizing; wizard prerequisites fail | `@AbapCatalog.deliveryClass : #C` on every table of the data model |
| Client-independent table in the BO's data model | BCMO prerequisite violated — not supported | Only client-dependent tables (client key field) |
| Composition tree deeper than 2 levels with a normal root | BCMO can't be used for the service | Restructure to height ≤ 2, or singleton root + *skip root entity list report* (height ≤ 3) |
| Service binding OData V2, or BDEF without draft | BCMO creation/registration rejected | OData V4 – UI binding on a draft-enabled root entity |
| Registering the BCMO on a Customizing transport | `create`/`delete` need a Workbench request (SMBC is a repository object) | Workbench request for registration; Customizing requests only for content |
| Recording content changes but skipping `validate_changes` validations | Saves succeed without a valid customizing transport; content untransported | Validation on save for create + update + delete on **each** entity, calling `validate_changes` |
| Omitting `abp_lastchange_tstmpl` / `abp_locinst_lastchange_tstmpl` | No or coarse concurrency control (whole-BO ETag via `I_CstmBizConfignLastChgd`) | Add the documented timestamp fields to basis and child tables |
| Expecting imported customizing in every client | Content appears only in the import client | Business configuration is client-dependent — plan client/tenant strategy accordingly |
| `S_TABU_NAM` checked against physical table names | Every added table forces authorization rework | Check against the CDS root entity name (documented recommendation) |
| Spreading one business configuration object across software components | Imports depend on clone order; content lost or stale | Keep each business configuration object in a single software component |
| Opening a second Default customizing request | Not possible — only one open Default request at a time | Use category Manual (`MANUAL_CUST`) for parallel/urgent requests |
| Assuming BC set activation is transported | `local( )` deploys locally only — nothing recorded on a transport | Treat runtime activation as local deployment; transport content via customizing requests |
| Ignoring the BC set activation result | Silent partial/failed activation | Check `is_bcset_activation_successful( )` and log `get_messages( )` |
| User has the CUBCO catalog but sees no/greyed configuration | Missing per-service authorization | IAM app of type *Business Configurations* + auth object + catalog + role assignment |

## References

- [references/transport-and-lifecycle.md](references/transport-and-lifecycle.md) — transport API deep dive, transport patterns per landscape, Export Customizing Transports, semantic lock token
- [references/bc-sets-runtime-and-xco.md](references/bc-sets-runtime-and-xco.md) — BC set runtime activation API step by step + XCO SCP1 query/read/generation APIs
- [examples/bcmo-scaffold/README.md](examples/bcmo-scaffold/README.md) — BCMO scaffold walkthrough (status-class scenario: tables → wizard → registration → transport wiring → app)
- Related skills: [rap-bo-modeling](../rap-bo-modeling/SKILL.md), [rap-saves-and-numbering](../rap-saves-and-numbering/SKILL.md), [rap-actions-validations-determinations](../rap-actions-validations-determinations/SKILL.md), [cds-views-authoring](../cds-views-authoring/SKILL.md), [abap-authorization](../abap-authorization/SKILL.md), [fiori-elements-ui-annotations](../fiori-elements-ui-annotations/SKILL.md), [abap-dictionary-ddic](../abap-dictionary-ddic/SKILL.md)
- **Business Configuration (section root):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/business-configuration-8b101cb.md
- **Creating BC apps with RAP and CUBCO:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/creating-business-configuration-apps-with-abap-restful-application-programming-model-and-fa420dd.md
- **Business Configuration Maintenance Object:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/business-configuration-maintenance-object-61159c4.md
- **BCMO Cloud Platform API (mbc_cp_api):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/business-configuration-maintenance-object-cloud-platform-api-508d406.md
- **Creating a BCMO in ADT:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/creating-a-business-configuration-maintenance-object-in-adt-1196530.md
- **Generate ABAP Repository Objects wizard for BCMO:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/generating-a-business-configuration-maintenance-object-with-the-generate-abap-repository-047e01c.md
- **Develop Common Capabilities:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/develop-common-capabilities-d9cb8ca.md
- **Authorization Control:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/authorization-control-1503a52.md
- **Transport Handling:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/transport-handling-4d6e84a.md
- **Develop UI-Specifics / Grouping / Table Creation Mode:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/develop-ui-specifics-8951a06.md, https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/grouping-9ae7923.md, https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/table-creation-mode-fea9a53.md
- **Transport of Business Configuration (landscape):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/transport-of-business-configuration-7d7c344.md
- **Business Configuration Sets:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/business-configuration-sets-2adb1bf.md
- **BC Sets Runtime API (4 pages):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/runtime-api-9868551.md
- **XCO Business Configuration Sets APIs:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/business-configuration-sets-ec48145.md
- **Custom Business Configurations App (user guide):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/custom-business-configurations-app-76384d8.md
- **Business Configuration (admin/lifecycle):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/business-configuration-fd7dfa0.md
- **Upload Business Configuration app:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/upload-business-configuration-c8ca7be.md
- **Business Configuration Change Logs:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/business-configuration-change-logs-5c6cf20.md
- **Semantic Business Configuration Lock Token:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/semantic-business-configuration-lock-token-0253f4e.md
