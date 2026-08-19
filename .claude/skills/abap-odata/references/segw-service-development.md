# SEGW Service Development — Deep Dive

Classic SAP Gateway Service Builder (transaction `SEGW`) development for OData V2
services on-premise: artifact map, provider class method catalog, request context
handling, registration/activation, and the troubleshooting workflow. Companion to
the main [SKILL.md](../SKILL.md); a runnable `GET_ENTITYSET` implementation is in
[../examples/segw_dpc_ext_get_entityset.abap](../examples/segw_dpc_ext_get_entityset.abap).

Scope note: SEGW does not exist in ABAP Cloud. Use it to maintain existing V2
services; for new development prefer RAP wherever the release allows (see
[abap-modernization-playbook](../../abap-modernization-playbook/SKILL.md) for the
migration decision).

## 1. Artifact map

A SEGW *project* consolidates everything one service needs; generation produces:

| Artifact | Naming pattern | Who owns it |
|---|---|---|
| Model provider class (base) | `ZCL_<PROJECT>_MPC` | Generator — regenerated on every model change, never edit |
| Model provider class (extension) | `ZCL_<PROJECT>_MPC_EXT` | You — redefine `DEFINE` for model tweaks (e.g. annotations, complex defaults) |
| Data provider class (base) | `ZCL_<PROJECT>_DPC` | Generator — never edit |
| Data provider class (extension) | `ZCL_<PROJECT>_DPC_EXT` | You — all runtime logic lives here |
| Annotation provider class (APC) | project-dependent | Generator, for vocabulary annotations |
| Technical service name | `Z<PROJECT>_SRV` | Registered on the gateway hub |

Data model sources inside SEGW:

- **Manual modeling** — entity types, properties, keys, associations, navigation
  properties, entity sets.
- **Import > DDIC structure** — derive an entity type from a table/structure.
- **Reference > Data Source** — point at a CDS view; runtime is delegated to SADL
  (see the CDS + SADL path in [SKILL.md](../SKILL.md)).
- **Redefine > OData Service** — wrap/extend an existing service.
- **Include > OData Service** — reuse another project's model, e.g. for shared
  associations.

Deployment options: *embedded* (gateway components on the business system — one
system, simpler) or *central hub* (dedicated gateway frontend — service
registration, error log, and caches live on the hub while your DPC code runs in the
backend). As of AS ABAP 7.40, `SAP_GWFND` ships in the standard stack.

## 2. DPC_EXT method catalog

For each entity set the generator creates redefinable methods on the DPC base:

| Method (per entity set) | Handles | OData request |
|---|---|---|
| `<ENTITYSET>_GET_ENTITYSET` | Query | `GET .../TravelSet?$filter=...&$top=...` |
| `<ENTITYSET>_GET_ENTITY` | Single read | `GET .../TravelSet('00000123')` |
| `<ENTITYSET>_CREATE_ENTITY` | Create | `POST .../TravelSet` |
| `<ENTITYSET>_UPDATE_ENTITY` | Update | `PUT`/`MERGE .../TravelSet('00000123')` |
| `<ENTITYSET>_DELETE_ENTITY` | Delete | `DELETE .../TravelSet('00000123')` |

Cross-entity methods (redefine from the framework interface when needed):

| Method | Handles |
|---|---|
| `GET_EXPANDED_ENTITY` / `GET_EXPANDED_ENTITYSET` | `$expand` in one round trip instead of N GETs |
| `CREATE_DEEP_ENTITY` | Deep insert (header + items in one POST) |
| `EXECUTE_ACTION` | Function imports |

If you do not implement the expanded variants, the framework falls back to calling
`GET_ENTITY`/`GET_ENTITYSET` per navigation — correct but slow; implement the deep
variants for header-item models.

## 3. The request context — honor the query options

`io_tech_request_context` (query: `/iwbep/if_mgw_req_entityset`) carries what the
client asked for. A provider that ignores it returns the full table to every
client and breaks paging in Fiori lists.

| Client sends | Read via | Apply as |
|---|---|---|
| `$top` / `$skip` | `get_top( )` / `get_skip( )` | `UP TO @limit ROWS OFFSET @offset` |
| `$filter` | `get_osql_where_clause( )` | Dynamic `WHERE (where_clause)` on the SELECT |
| `$orderby` | `get_orderby( )` | Dynamic `ORDER BY` |
| `$inlinecount` | `has_inlinecount( )` | Fill `es_response_context-inlinecount` with the total |
| Key values (single read) | `get_converted_keys( )` | `WHERE` on key fields |

`get_osql_where_clause( )` translates the OData `$filter` into an Open SQL WHERE
string on the entity property names — the cheapest correct way to push filters to
the database. (The `..._convert` variant maps to the underlying field names when
they differ.)

Never build that WHERE string yourself by concatenating the raw `$filter` or
`$search` request text — that reintroduces SQL injection. Only the string
`get_osql_where_clause( )` / `get_osql_where_clause_convert( )` returns is safe
to splice into a dynamic `WHERE`; it has already been parsed and validated
against the entity's known properties, unlike hand-assembled client text.

## 4. Messages and exceptions

Business errors travel through the message container and
`/iwbep/cx_mgw_busi_exception`:

```abap
DATA(message_container) = mo_context->get_message_container( ).
message_container->add_message(
  iv_msg_type   = /iwbep/cl_cos_logger=>error
  iv_msg_id     = 'ZTRAVEL_MSG'
  iv_msg_number = '001'
  iv_msg_v1     = |{ travel_id }| ).

RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
  EXPORTING message_container = message_container.
```

- `/iwbep/cx_mgw_busi_exception` → HTTP 4xx with your message payload (client's fault).
- `/iwbep/cx_mgw_tech_exception` → technical failure (framework/model problem); if
  you see it without raising it yourself, check model consistency and regenerate.
- Never swallow exceptions in the DPC and return empty data — the consumer cannot
  distinguish "no data" from "broken service".

## 5. Registration and activation

1. In SEGW: **Generate** (creates/refreshes MPC/DPC), fix syntax, activate classes.
2. On the gateway hub: `/IWFND/MAINT_SERVICE` → **Add Service** → select the system
   alias pointing to the backend → pick the technical service → assign package.
   This puts the service into the hub's service catalog.
3. Check the **ICF node**: the service's ICF path must be active, otherwise the URL
   answers 403/404 despite a successful registration.
4. Smoke test: `GET /sap/opu/odata/sap/Z<PROJECT>_SRV/$metadata` in
   `/IWFND/GW_CLIENT` or a browser.

After any model change: regenerate in SEGW **and** clear the metadata caches —
`/IWFND/CACHE_CLEANUP` (hub) and `/IWBEP/CACHE_CLEANUP` (backend). Stale hub cache
is the number-one "my change is not there" cause.

## 6. Troubleshooting workflow

1. **Reproduce** the failing call in `/IWFND/GW_CLIENT` (hub): enter the request
   URI, choose the HTTP method, add headers (`X-CSRF-Token: Fetch` on GET, the
   returned token on POST/PUT/DELETE). Save it as a test case so the repro is
   one click next time.
2. **Read the error** in `/IWFND/ERROR_LOG` (hub; the backend has its own error log
   in central-hub landscapes). Entries carry the full request context and a
   **Replay > Gateway Client** button that reconstructs the exact failing request.
3. **Debug**: set a breakpoint in the DPC_EXT method and replay from the error log
   or GW_CLIENT.
4. **Trace performance and payloads** with the gateway trace tools (`/IWFND/TRACES`)
   when the problem is latency rather than errors.
5. **Escalate to model level** if `$metadata` itself is wrong: regenerate, clear
   caches, re-register.

## 7. SEGW quality checklist

1. All logic in `*_EXT` classes; base classes untouched.
2. `GET_ENTITYSET` pushes `$filter`/`$top`/`$skip`/`$orderby` to the database.
3. `$expand`-heavy models implement `GET_EXPANDED_ENTITYSET` / `CREATE_DEEP_ENTITY`.
4. Errors raised as `/iwbep/cx_mgw_busi_exception` with T100-backed messages —
   no silent empty responses.
5. Service registered on the hub, ICF node active, caches cleared after changes.
6. A saved `/IWFND/GW_CLIENT` test case exists per entity set and per bug fixed.
7. Rework planned? Evaluate migration to RAP instead of extending the SEGW project
   ([abap-modernization-playbook](../../abap-modernization-playbook/SKILL.md)).
