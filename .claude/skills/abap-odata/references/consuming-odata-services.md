# Consuming OData Services from ABAP — Deep Dive

How ABAP code calls OData services: the service consumption model in ADT, the OData
client proxy (V2/V4, remote/local), the HTTP client layer in ABAP Cloud vs Standard
ABAP, CSRF handling, and error handling. Companion to the main
[SKILL.md](../SKILL.md); the runnable class is in
[../examples/zcl_travel_odata_consumer.clas.abap](../examples/zcl_travel_odata_consumer.clas.abap).

## 1. Service consumption model (SRVC) in ADT

The service consumption model is the design-time artifact that turns a remote
service's metadata into typed ABAP proxy artifacts.

Creation: **New > Other ABAP Repository Object > Business Services > Service
Consumption Model**, then choose the *Remote Consumption Mode*:

| Mode | Input | Generates |
|---|---|---|
| OData | `$metadata` file (download from `<service root>/$metadata`) | Abstract entities per entity type, a service definition for the proxy model, code templates per operation |
| RFC | Function module metadata | Typed RFC proxy (SRVC optional — `CALL FUNCTION ... IN REMOTE SESSION` works without it) |
| Web Service | WSDL | SOAP proxy |

Notes:

- The generated proxy model is internally always an OData **V4** model, even when
  the consumed service is V2 — the client proxy translates on the wire.
- ADT shows ready-made **code templates** on the consumption model editor page for
  each operation (read list, read by key, create, ...). Start from those templates;
  they are release-correct for your system.
- Free-style HTTP services (no OData/RFC/SOAP contract) cannot use a consumption
  model — use the HTTP client library directly (section 3).

## 2. Destination and HTTP client

### ABAP Cloud

The configuration lives in communication management, not in code:

```
outbound service (type HTTP — also required for OData)
  → bundled into a communication scenario
    → administrator creates a communication arrangement
      → code resolves it at runtime
```

```abap
DATA(http_destination) = cl_http_destination_provider=>create_by_comm_arrangement(
                           comm_scenario = 'Z_OUTBOUND_TRAVEL'      " scenario ID
                           service_id    = 'Z_OUTBOUND_TRAVEL_HTTP' " outbound service ID
                           comm_system_id = 'ZTRAVEL_BACKEND' ).    " optional disambiguation

DATA(http_client) = cl_web_http_client_manager=>create_by_http_destination( http_destination ).
```

For quick prototyping only, `cl_http_destination_provider=>create_by_url( )` builds
a destination from a literal URL — never ship that: credentials and endpoints belong
in the communication arrangement.

An outbound *communication user* supplies credentials; authentication methods valid
for HTTP apply to OData as well. The outbound service can carry a *default path
prefix* that the scenario or arrangement may override.

### Standard ABAP (on-premise)

```abap
" Destination maintained in SM59 (type G: HTTP to external server)
cl_http_client=>create_by_destination(
  EXPORTING destination = 'ZTRAVEL_BACKEND'
  IMPORTING client      = DATA(http_client) ).

http_client->request->set_method( if_http_request=>co_request_method_get ).
cl_http_utility=>set_request_uri(
  request = http_client->request
  uri     = '/sap/opu/odata/sap/ZTRAVEL_SRV/TravelSet?$top=10&$format=json' ).

http_client->send( ).
http_client->receive( ).
DATA(response_body) = http_client->response->get_cdata( ).
http_client->close( ).
```

`cl_http_client` (interface `if_http_client`) is **not released for ABAP Cloud**;
in cloud code use `cl_web_http_client_manager` (interface `if_web_http_client`)
exclusively. On newer on-premise releases the web client API is also available and
preferable for new code.

## 3. Raw HTTP consumption (no proxy)

When no consumption model is possible (ad-hoc integration, non-SAP service), build
OData URLs yourself and parse the payload (see
[abap-xml-json](../../abap-xml-json/SKILL.md) for parsing):

```abap
DATA(http_request) = http_client->get_http_request( ).
http_request->set_uri_path(
  '/sap/opu/odata4/sap/api_business_partner/srvd_a2x/sap/api_business_partner/0001/'
  && 'A_BusinessPartner?$top=10&$select=BusinessPartner,BusinessPartnerName' ).
http_request->set_header_field( i_name = 'Accept' i_value = 'application/json' ).

DATA(http_response) = http_client->execute( if_web_http_client=>get ).
DATA(response_json) = http_response->get_text( ).
http_client->close( ).
```

Costs of the raw approach: you hand-code `$filter` escaping, paging, error payload
parsing, and CSRF. Prefer the client proxy whenever a `$metadata` file exists.

## 4. OData client proxy

The client proxy sits on top of the HTTP client and gives you typed request/response
objects instead of strings.

### Instantiation — the three factories

```abap
" (a) ABAP Cloud, RAP guide: from the service consumption model's proxy model key
DATA(client_proxy) = /iwbep/cl_cp_factory_remote=>create_v4_remote_proxy(
  is_proxy_model_key       = VALUE #( repository_id       = 'DEFAULT'
                                      proxy_model_id      = 'ZSC_TRAVEL'
                                      proxy_model_version = '0001' )
  io_http_client           = http_client
  iv_relative_service_root = '/sap/opu/odata4/sap/zapi_travel/srvd_a2x/sap/zapi_travel/0001/' ).
```

```abap
" (b) Integration & connectivity guide: from a service definition name
DATA(client_proxy_v4) = cl_web_odata_client_factory=>create_v4_remote_proxy(
  iv_service_definition_name = 'ZSC_TRAVEL'
  io_http_client             = http_client
  iv_do_fetch_csrf_token     = abap_true
  iv_relative_service_root   = '/sap/opu/odata4/sap/zapi_travel/srvd_a2x/sap/zapi_travel/0001/' ).

" Same class offers CREATE_V2_REMOTE_PROXY for OData V2 targets.
" V2 relative service roots follow /sap/opu/odata/<service_id>.
DATA(client_proxy_v2) = cl_web_odata_client_factory=>create_v2_remote_proxy(
  iv_service_definition_name = 'ZSC_TRAVEL_V2'
  io_http_client             = http_client
  iv_relative_service_root   = '/sap/opu/odata/sap/ZTRAVEL_SRV' ).
```

```abap
" (c) Standard ABAP variant used in SAP samples
DATA(client_proxy_onprem) = /iwbep/cl_cp_client_proxy_fact=>create_v4_remote_proxy(
  iv_service_definition_name = 'ZSC_TRAVEL'
  io_http_client             = http_client
  iv_relative_service_root   = '/sap/opu/odata4/sap/zapi_travel/srvd_a2x/sap/zapi_travel/0001/' ).
```

Rules:

- The concatenation of HTTP destination and `iv_relative_service_root` must point at
  the **service document** of the target service.
- The proxy model is always V4-shaped; the V2 remote proxy translates to V2 syntax
  on the wire.
- Instantiate the proxy once and reuse it (helper/factory class) — the CSRF token is
  cached per proxy instance.

### Reading an entity set

```abap
DATA(read_request) = client_proxy->create_resource_for_entity_set( 'TRAVEL'
                       )->create_request_for_read( ).

read_request->set_top( 50 ).
read_request->set_skip( 0 ).

" Server-side filtering via the filter factory (ranges → $filter)
DATA(filter_factory) = read_request->create_filter_factory( ).
DATA(agency_filter)  = filter_factory->create_by_range(
                         iv_property_path = 'AGENCY_ID'
                         it_range         = VALUE #( ( sign   = 'I'
                                                       option = 'EQ'
                                                       low    = '070001' ) ) ).
read_request->set_filter( agency_filter ).

DATA travels TYPE STANDARD TABLE OF zsc_travel WITH EMPTY KEY.
DATA(read_response) = read_request->execute( ).
read_response->get_business_data( IMPORTING et_business_data = travels ).
```

`zsc_travel` is the abstract entity the consumption model generated. Property paths
in the filter factory use the proxy model's (upper-case) property names.

### Writes, single reads, functions

The resource/request API is symmetric: from
`create_resource_for_entity_set( ... )` you create requests for the other
operations (create with `set_business_data( )`, read by key via a key structure,
update, delete); the ADT code templates of your consumption model show the exact
variant for your release. Modifying requests are where CSRF matters — see below.

### Local client proxy

A *local* client proxy (V2 and V4) consumes a service on the same application
server without HTTP — useful for integration tests of your own services. It cannot
be used to consume SAP-delivered OData services.

## 5. CSRF tokens

SAP Gateway requires a CSRF token on modifying requests (POST/PUT/PATCH/DELETE).

- **With client proxy:** automatic. The proxy fetches the token via a HEAD request
  to the service and reuses it for all requests of that proxy instance. Disable
  with `iv_do_fetch_csrf_token = abap_false` (e.g. when the target does not use
  CSRF protection).
- **With raw HTTP:** do it manually —

```abap
" Step 1: fetch token on a safe request
token_request->set_header_field( i_name = 'X-CSRF-Token' i_value = 'Fetch' ).
DATA(token_response) = http_client->execute( if_web_http_client=>get ).
DATA(csrf_token)     = token_response->get_header_field( 'X-CSRF-Token' ).

" Step 2: send it on the modifying request — same client instance,
" because the token is only valid together with the session cookies.
modify_request->set_header_field( i_name = 'X-CSRF-Token' i_value = csrf_token ).
```

The classic failure is fetching the token with one HTTP session and posting with
another: the server answers `403 CSRF token validation failed` even though the
token string is "correct".

## 6. Error handling

| Exception | Raised by | Meaning |
|---|---|---|
| `cx_web_http_client_error` | Web HTTP client | Transport-level failure: destination broken, TLS trust missing, timeout |
| `cx_http_dest_provider_error` | Destination provider | Communication arrangement/scenario not found or misconfigured |
| `/iwbep/cx_cp_remote` | Client proxy | Remote service returned an OData error (4xx/5xx with OData error payload) |
| `/iwbep/cx_gateway` | Client proxy framework | Local proxy/framework errors |

Pattern:

```abap
TRY.
    DATA(read_response) = read_request->execute( ).
  CATCH /iwbep/cx_cp_remote INTO DATA(remote_error).
    " OData error payload from the provider — log message, map to your error model
  CATCH /iwbep/cx_gateway cx_web_http_client_error INTO DATA(technical_error).
    " infrastructure problem — retry/alert, do not show raw text to end users
ENDTRY.
```

Always `http_client->close( )` when done (also in the error path) — leaked HTTP
sessions exhaust the connection pool.

## 7. Consumption checklist

1. `$metadata` of the target downloaded and imported into a service consumption model.
2. Destination configured (communication arrangement / SM59) — no URLs in code.
3. Proxy instantiated once, in a helper class, with the correct relative service root.
4. Server-side `$filter`/`$top` set on every list read — never "read all, filter in ABAP".
5. CSRF left to the proxy; manual flow only for raw HTTP.
6. All four exception types handled; client closed in all paths.
7. V2 targets: messages read from the `sap-message` response header on 2xx.
