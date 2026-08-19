# BCMO Scaffold Walkthrough — Status-Class Customizing

End-to-end walkthrough of making a customizing table maintainable in the *Custom Business Configurations* (CUBCO) app, based on the /DMO status-class scenario from the SAP documentation. Object names in the tables are the documented /DMO ones; the registration and IAM steps use Z-namespace stand-ins.

Scenario: four editable entities with 1:N cardinality at each level — Status Class, Status Class Text, Status Code, Status Code Text.

## Step 1 — Customizing tables

All four tables share the customizing prerequisites: client key, delivery class C, data maintenance allowed, `abp_locinst_lastchange_tstmpl` for per-row concurrency; the basis table additionally carries `abp_lastchange_tstmpl` for the ETag.

Basis table:

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

Text table for the basis table — language key + `#TEXT_KEY` foreign key:

```
@EndUserText.label : 'Status Class Text'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
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

Additional (child) table — `#KEY` foreign key fully matching the basis table's primary key:

```
@EndUserText.label : 'Status Code'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #C
@AbapCatalog.dataMaintenance : #ALLOWED
define table /dmo/statuscode {
  key client            : abap.clnt not null;
  @AbapCatalog.foreignKey.keyType : #KEY
  key status_class_id   : /dmo/status_class_id not null
    with foreign key /dmo/statusclass
    where client = /dmo/statuscode.client
      and status_class_id = /dmo/statuscode.status_class_id;
  key status_code_id    : /dmo/status_code_id not null;
  local_last_changed_at : abp_locinst_lastchange_tstmpl;
}
```

`/dmo/stcodetext` follows the same text-table pattern against `/dmo/statuscode` (see the wizard documentation page for the full source).

## Step 2 — Run the Generate ABAP Repository Objects wizard

1. Context menu on `/dmo/statusclass` → *Generate ABAP Repository Objects*.
2. Folder *Business Configuration Management* → *Maintenance Object* → *Next*; enter target package → *Next*.
3. *Configure Generator*: names are proposed from the basis-table description. Because of the foreign-key definitions, `/dmo/stclasstext` is auto-added as text table; add `/dmo/statuscode` and `/dmo/stcodetext` manually. Set the scenario options:
   - *Transport Selection* = *Manual with preselection* (auto-determines a customizing request on Edit; logic in ABAP Doc of `if_mbc_cp_rap_tdat_cts` → `get_transport_request`).
   - *Enable Transport Selection Strip* = on (default).
   - Optionally *Add Copy Action*, *Add Deprecate Actions* (needs field `CONFIGDEPRECATIONCODE` typed `CONFIG_DEPRECATION_CODE`), *Add Data Consistency Check*.
   - *BC Management*: name the BC Maintenance Object and the Transport Object (type *Individual Transaction*).
4. *Preview Generator Output* → *Next* → assign a (workbench) transport request → *Finish*.

The wizard cannot overwrite existing objects or generate a subset; generated objects inherit the ABAP language version of the target package.

## Step 3 — What gets generated

Per the documentation, the generated RAP BO is:

- **draft-enabled, managed** — with a **singleton root entity** above Status Class to enable mass editing and manual transport selection (this is also what allows the 3-level tree with *skip root entity list report*);
- protected by **`S_TABU_NAM`** with the CDS view entity name of the basis table (DCL + `get_global_authorizations`);
- concurrency-controlled through the timestamp fields;
- wired to the **BC transport API**: additional save calling `record_changes`, per-entity on-save validations calling `validate_changes`, transport selection via abstract entity `D_SelectCustomizingTransptReqP` stored in a draft virtual field;
- using **internal numbering** for any `raw(16)` (UUID) key fields;
- exposed through a service definition + **OData V4 – UI service binding**, declared by a generated **Business Configuration Maintenance Object** (SMBC).

The exact generated source (entity names, action names, saver class) is release-dependent — inspect it in ADT rather than assuming names. The concepts map to [rap-bo-modeling](../../../rap-bo-modeling/SKILL.md) (BDEF), [rap-saves-and-numbering](../../../rap-saves-and-numbering/SKILL.md) (additional save), and [rap-actions-validations-determinations](../../../rap-actions-validations-determinations/SKILL.md) (validations, actions).

## Step 4 — Manual registration alternative (mbc_cp_api)

If you built the BO yourself (or want to script registration), register the service binding as a BCMO. Prerequisites: OData V4 – UI binding, draft-enabled root entity, only client-dependent tables, tree height ≤ 2 (the API supports one level of sub nodes below the chosen root entity set).

```abap
CLASS zcl_register_status_bc DEFINITION PUBLIC FINAL CREATE PUBLIC
    INHERITING FROM cl_xco_cp_adt_simple_classrun.
  PROTECTED SECTION.
    METHODS main REDEFINITION.
ENDCLASS.

CLASS zcl_register_status_bc IMPLEMENTATION.
  METHOD main.
    DATA(business_configuration) =
      mbc_cp_api=>business_configuration_api( 'ZSTATUS_CLASS' ).

    TRY.
        business_configuration->create(
          iv_name            = 'Status Classes'
          iv_description     = 'Status class and status code customizing'
          iv_service_binding = 'ZUI_STATUSCLASS_O4'
          iv_service_name    = 'StatusClass'
          iv_service_version = 0001
          iv_root_entity_set = 'StatusClass'
          iv_transport       = 'X02K900025' ).   " Workbench request — SMBC entry
        out->write( 'BCMO registered.' ).
      CATCH cx_mbc_api_exception INTO DATA(api_error).
        LOOP AT api_error->if_xco_news~get_messages( ) INTO DATA(message).
          out->write( message->get_text( ) ).
        ENDLOOP.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
```

Name and description are language-dependent (translate in *Maintain Translations*). Housekeeping methods on the same handle: `exists( )`, `read( )`, `update_name( )`, `update_decription( )` (sic — SAP's own spelling in the released API), `delete( )` — updates and deletion also need a workbench request. Verify method availability in ADT's code completion. Overview of all registered BCMOs: `I_CustABAPObjDirectoryEntry` where `ABAPObjectType = 'SMBC'`.

## Step 5 — Transport wiring recap (what the wizard did for you)

If wiring manually, replicate this documented pattern (deep dive: [../../references/transport-and-lifecycle.md](../../references/transport-and-lifecycle.md)):

```abap
" In the saver / validation implementations:
DATA(transport_api) = mbc_cp_api=>rap_tdat_cts(
  tdat_name              = 'ZSTATUS_TOBJ'    " Individual Transaction transport object
  table_entity_relations = VALUE #(
    ( entity = 'ZI_StatusClass'     table = '/DMO/STATUSCLASS' )
    ( entity = 'ZI_StatusClassText' table = '/DMO/STCLASSTEXT' )
    ( entity = 'ZI_StatusCode'      table = '/DMO/STATUSCODE' )
    ( entity = 'ZI_StatusCodeText'  table = '/DMO/STCODETEXT' ) ) ).
```

- BDEF header: `managed with additional save implementation in class ... unique;` → call `record_changes` in `save_modified`.
- Each entity: `validation ... on save { create; update; delete; }` → call `validate_changes`.
- Transport selection action with parameter `D_SelectCustomizingTransptReqP`; result stored in a draft virtual field. Eligible requests: modifiable, type Customizing, owned (request or an open task), `SAP_CUS_TRANSPORT_CATEGORY` = `MANUAL_CUST` or `DEFAULT_CUST`.
- Exact method signatures are in the ABAP Doc of `record_changes` / `validate_changes` — verify in ADT.

## Step 6 — Authorize and use

1. Create an **IAM app of type *Business Configurations* app**; service tab: OData V4 + the service binding; authorizations tab: `S_TABU_NAM` with `TABLE = <CDS root entity>`, `ACTVT = Change, Display`.
2. Assign the IAM app to an IAM business catalog → business role → business users. Read vs write is decided in the business role's General Role Details.
3. The business user needs catalog `SAP_CORE_BC_BCT_MBC_PC` (role template `SAP_BR_BPC_EXPERT`) for the CUBCO app itself.
4. In the app: pick *Status Classes* from the list (group it via a *Configuration Group* data element if the list grows), edit in draft, select the customizing transport (strip auto-prompts on save if mandatory), save.
5. Lifecycle: release the customizing request in *Export Customizing Transports*; import into test/production by pulling the software component in the target client.

## UI fine-tuning

- CDS `@UI` annotations drive labels, value helps, facets ([fiori-elements-ui-annotations](../../../fiori-elements-ui-annotations/SKILL.md)).
- BCMO editor Fiori Elements settings: per-entity *Table Creation Mode* — *New Page* for attribute-rich entities like Status Class, *Creation Row* (+ Grid Table) for quick-entry entities like Status Class Text.
- Intent navigation for launchpad tiles or cross-app links: `#BusinessConfiguration-maintain?TechnicalIdentifier=ZSTATUS_CLASS`.

## Sources

- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/generating-a-business-configuration-maintenance-object-with-the-generate-abap-repository-047e01c.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/business-configuration-maintenance-object-cloud-platform-api-508d406.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/business-configuration-maintenance-object-61159c4.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/transport-handling-4d6e84a.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/authorization-control-1503a52.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/table-creation-mode-fea9a53.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/custom-business-configurations-app-76384d8.md
