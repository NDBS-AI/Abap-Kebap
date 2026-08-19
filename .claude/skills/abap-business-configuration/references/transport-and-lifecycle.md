# Customizing Transport Handling and Lifecycle — Deep Dive

How business configuration content travels from the development tenant to test and production in ABAP Cloud: the in-BO transport API, the transport-request model, the three landscape patterns, and the safeguards. Sources are listed at the end; anything the docs delegate to inline ABAP Doc is flagged "verify in ADT".

## The two transport worlds

| Aspect | Registration (BCMO, SMBC) | Content (table rows) |
|---|---|---|
| Transport request type | **Workbench** | **Customizing** |
| What travels | The repository object declaring the service binding as business configuration | Client-dependent rows of the delivery-class-C tables |
| Who typically owns it | Developer (`SAP_BR_DEVELOPER`) | Business process configuration expert (`SAP_BR_BPC_EXPERT`) |
| Where created | ADT (wizard / Transport Organizer) | *Export Customizing Transports* app (or ADT Transport Organizer) |
| Client dependency | Client-independent (development object) | Client-dependent — import lands only in the import client |

Releasing either kind pushes the changes to the Git repository of the associated software component; target systems import by **pulling** that software component (for customizing: into the target client, e.g. client 100).

## In-BO transport API (`mbc_cp_api=>rap_tdat_cts`)

The factory class `mbc_cp_api` instantiates a transport API used to **validate** and **record** entity keys of a RAP BO on a customizing transport request:

```abap
DATA(transport_api) = mbc_cp_api=>rap_tdat_cts(
  tdat_name              = '/ITAPC1/CODE'
  table_entity_relations = VALUE #(
    ( entity = '/ITAPC1/I_Status'     table = '/ITAPC1/STATUS' )
    ( entity = '/ITAPC1/I_StatusText' table = '/ITAPC1/STATUST' ) ) ).
```

- `tdat_name` is the transport object; the generator wizard creates one of type **Individual Transaction** under which configuration changes are recorded.
- `table_entity_relations` maps each CDS entity of the BO to its database table.

### Recording — `record_changes`

Declare an **additional save** in the BDEF header directly after the keyword `managed` (`managed with additional save implementation in class ... unique;`). In the saver class's `save_modified` method, call `record_changes` on the transport API. The framework has already written the table rows (managed persistence); `record_changes` adds the changed entity keys to the customizing transport request. The docs point to the ABAP Doc of `record_changes` for the exact signature and an example implementation — verify in ADT. For `save_modified` mechanics and the save sequence overall, see [rap-saves-and-numbering](../../rap-saves-and-numbering/SKILL.md).

### Validating — `validate_changes`

For **each entity** of the RAP BO, define a validation on save reacting to create, update, and delete, and call `validate_changes` inside it. This rejects the save when no valid customizing transport request is available/selected. Signature per ABAP Doc of `validate_changes` — verify in ADT. Validation grammar: [rap-actions-validations-determinations](../../rap-actions-validations-determinations/SKILL.md).

### Selecting — `D_SelectCustomizingTransptReqP`

Both methods need a transport request as input. The documented UI pattern:

- Define an **action** whose parameter is the abstract CDS entity `D_SelectCustomizingTransptReqP`.
- That entity returns all modifiable transport requests of type *Customizing* where the user owns the request or owns at least one open task, and whose attribute `SAP_CUS_TRANSPORT_CATEGORY` is `MANUAL_CUST` or `DEFAULT_CUST`.
- Store the selected request in a **virtual field of the draft entity**; read it back in `validate_changes` / `record_changes`.

### Wizard transport-selection modes

| Mode | Behavior |
|---|---|
| *Manual* | *Select Transport* action; user picks an existing customizing request before saving |
| *Manual with preselection* | Same action, plus automatic determination of a request on *Edit* — logic documented in ABAP Doc of method `get_transport_request` of interface `if_mbc_cp_rap_tdat_cts` (verify in ADT) |
| *No Transport* | No transport option in the app — for configuration adjusted directly in the productive client |

The wizard option *Enable Transport Selection Strip* (default on) renders selection in the header toolbar: selection action only in edit mode, request shown in the toolbar, and if save runs without a selected request while transport is mandatory, the selection dialog is auto-triggered and the save continues afterwards. Without the strip, selection happens via an action button.

## Landscape patterns

From *Transport of Business Configuration*:

### 1. Isolated tenants — no transport

No software component of type *Business Configuration* is cloned. Content can still be created: since a customizing request is a technical prerequisite, changes are written to a **local** customizing request (system generates it, category *Default*). Release has no effect. All consumer tenants (client ≥ 200) of multitenant systems are isolated tenants.

### 2. Software component of type *Business Configuration* (simple)

Only **one** software component of this type can be cloned per system — all business configuration content is pushed to the same remote repository. Requests are created and managed in the *Export Customizing Transports* app; the system associates the request to the cloned component and sets category *Default*. Any user assigned to one of the request's tasks can record changes on it. Restriction: **only one open Default request at a time**; parallel/urgent preimports use additional requests with category switched to *Manual*.

### 3. Software components of type *Development* (parallel projects)

For multiple decoupled projects, transport configuration together with the development in the corresponding *Development* components. Steps: create/clone the components (*Manage Software Components* app, role `SAP_BR_ADMINISTRATOR`), create customizing requests per component in ADT's **Transport Organizer** with the correct target layer, then set these attributes in the Transport Editor so the requests appear in *Export Customizing Transports*:

- `SAP_ATO_TRANSPORT_TYPE = BC`
- `SAP_CUS_TRANSPORT_CATEGORY = MANUAL_CUST`

Documented recommendations:

- Store business configuration objects in **one** software component; if several are unavoidable, keep each single object always in the same component — otherwise imports depend on clone order.
- To find which component holds an object: filter the ADT Transport Organizer view in the development system, or search commits per component in *Manage Software Components* (committed-objects search needs capital letters; commits of deleted systems lose their committed-objects list).
- Give transport requests well-defined texts (they become commit descriptions) and apply the four-eyes principle when adding an existing object to a request.
- With this pattern, autofill the transport request in the app based on the software component of the business configuration object.

## Roles and apps in the lifecycle

| App | Role / catalog | Use |
|---|---|---|
| *Export Customizing Transports* | `SAP_BR_BPC_EXPERT` or `SAP_BR_ADMINISTRATOR` | Create, manage, release customizing requests |
| *Manage Software Components* | `SAP_BR_ADMINISTRATOR` | Create/clone software components |
| ADT Transport Organizer | `SAP_BR_DEVELOPER` | Developer-side request creation and object search |
| *Upload Business Configuration* | catalog `SAP_CA_BC_IC_LND_PC` (+ transport catalogs `SAP_CORE_BC_BCT_TRN_MNG_PC`, `SAP_CORE_BC_BCT_TRN_REL_PC`); all in template `SAP_BR_BPC_EXPERT` | Mass .xlsx import into C tables |
| *Business Configuration Change Logs* | catalog `SAP_CORE_BC_BCT_LOG_PC`; `S_TABU_NAM` with *Display Change Documents* | Audit who changed what and when |

## Semantic Business Configuration Lock Token

For **critical** configuration changes made in the customizing tenant of the development system, a consistency check runs in test and production. On SUCCESS the change may be saved; a lock is created in test/production with status *Preliminary | On hold*, finalized to *Active* once the change is recorded to a transport and saved. While a lock is *Active*, related business processes in test/production are blocked with an explanatory message. The lock is released by **importing the transport** that carries the change (or reverting the change in development and importing that transport).

## Verify in ADT (not fully specified in the docs)

- Exact signatures of `record_changes`, `validate_changes`, and `get_transport_request` (`if_mbc_cp_rap_tdat_cts`) — the docs defer to inline ABAP Doc.
- Full parameter list of `mbc_cp_api=>rap_tdat_cts` beyond `tdat_name` and `table_entity_relations`.
- The exact BDEF shape of the generated transport-selection action and the draft virtual field — inspect wizard output.

## Sources

- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/transport-handling-4d6e84a.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/transport-of-business-configuration-7d7c344.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/transport-business-configuration-via-software-component-of-type-business-configuration-03a3611.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/transport-business-configuration-via-software-components-of-type-development-d801854.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/generating-a-business-configuration-maintenance-object-with-the-generate-abap-repository-047e01c.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/business-configuration-fd7dfa0.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/upload-business-configuration-c8ca7be.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/business-configuration-change-logs-5c6cf20.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/semantic-business-configuration-lock-token-0253f4e.md
