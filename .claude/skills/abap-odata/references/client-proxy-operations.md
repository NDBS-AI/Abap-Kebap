# OData V4 Client Proxy — Navigation, `$expand`, Bound Actions, and the Payload Escape Hatch

The verified call chains for the `/iwbep` client proxy beyond a plain entity-set read:
navigating along associations (including 0..1), nested `$expand`, filters and eTags,
invoking **bound** actions and functions, and what to do when the typed parameter
structure cannot express the payload the server wants. Companion to
[consuming-odata-services.md](consuming-odata-services.md) (proxy creation, HTTP client,
CSRF basics).

> **Verification status.** The rules here were confirmed against a live S/4HANA Cloud Public
> Edition system consuming an SAP-delivered A2X V4 API. The navigation/`bind_action` facts in
> §2 are *not* in public SAP documentation — they come from reading the framework source
> (`/iwbep/cl_cp_resource`, `/iwbep/if_cp_request_action`) in-system. Re-read those two
> objects in your release before relying on them; the path is in §7. The object names in the
> snippets (`zsc_travel`, `booking`, `payment`, `confirm_payment`) are illustrative —
> take yours from the generated consumption-model class (§1).

## 1. Read the generated model class first

The service consumption model generates a class that is the **authoritative dictionary**
for every name you will type. Read it before writing any proxy code; do not infer names
from the EDMX by eye:

| Constant / type in the generated class | Gives you |
|---|---|
| `gcs_entity_set-<name>` | entity-set names for `create_resource_for_entity_set` |
| `gcs_entity_type-<type>-navigation-<nav>` | navigation-property names for `navigate_to_*` / `add_expand` |
| `gcs_bound_action-<name>` / `gcs_bound_function-<name>` | action / function names for `bind_action` / `bind_function` |
| `tys_<type>` / `tyt_<type>` | typed structure / table for `get_business_data` |
| `tys_<type>_key` | key structure for `navigate_with_key` |
| `tys_value_controls_<n>` | **which properties the proxy can omit** (only nullable ones appear here — see §5) |

## 2. Navigating — pick the method that matches the modelled multiplicity

| Navigation method | Validates | Static return type | `bind_action` visible? |
|---|---|---|---|
| `navigate_with_key( is_key )` | key | `/iwbep/if_cp_resource_entity` | yes |
| `navigate_to_single( iv_nav )` | **to-one (1:1) only** | `/iwbep/if_cp_resource_entity` | yes |
| `navigate_to_optional( iv_nav )` | **0..1** | `/iwbep/if_cp_resource_entity01` | **no** — narrow interface |
| `navigate_to_many( iv_nav )` | to-many | `/iwbep/if_cp_resource_list` | yes (collection-bound) |

**Runtime trap:** `navigate_to_single` on a 0..1 navigation raises `/IWBEP/CX_CP_RUNTIME`
`Wrong method call: Navigation property '…' has multiplicity 'O'`. For 0..1 you **must**
use `navigate_to_optional`.

**The narrow `entity01` interface is a compile-time restriction only.** One class
(`/iwbep/cl_cp_resource`) implements `if_cp_resource_entity`, `_entity01`, `_list`,
`_action`, and `_function`. The runtime guard `check_for_casting( )` is called by
`create_request_for_read/update/delete` and the `navigate_*` methods — **not** by
`bind_action`. `bind_action_int` checks only that the action is bound, that its binding
parameter's entity type equals the resource's entity type, and that collection-ness matches.
Navigation multiplicity is irrelevant. So a downcast is legal and works:

```abap
DATA(lo_optional_resource) = mo_client_proxy
  ->create_resource_for_entity_set( zsc_travel=>gcs_entity_set-booking )
  ->navigate_with_key( VALUE zsc_travel=>tys_booking_type_key(
       travel_id  = iv_travel_id
       booking_id = iv_booking_id ) )
  ->navigate_to_optional(                       " the only legal call for multiplicity 'O'
       zsc_travel=>gcs_entity_type-booking_type-navigation-payment ).

" Same object, wider static type — bind_action has no casting guard
DATA(lo_entity_resource) = CAST /iwbep/if_cp_resource_entity( lo_optional_resource ).
```

Rule to apply: **a bound action is reachable through any navigation the model allows.**
Navigate with the method matching the modelled multiplicity, downcast to
`/iwbep/if_cp_resource_entity`, then bind. Do not reach for raw HTTP because of the
narrow interface — only the *payload* (§5) can force that.

## 3. Reading — nested `$expand`, filter, eTag, response shape

```abap
DATA(lo_read_request) = mo_client_proxy
  ->create_resource_for_entity_set( zsc_travel=>gcs_entity_set-booking )
  ->navigate_with_key( is_booking_key )
  ->navigate_to_optional(                       " 0..1 read tolerates a missing target
       zsc_travel=>gcs_entity_type-booking_type-navigation-payment )
  ->create_request_for_read( ).

" Nested $expand: each add_expand returns the child node you expand further
DATA(lo_expand_root)      = lo_read_request->create_expand_node( ).
DATA(lo_installment_node) = lo_expand_root->add_expand( CONV #(
    zsc_travel=>gcs_entity_type-payment_type-navigation-installment ) ).
lo_installment_node->add_expand( CONV #(
    zsc_travel=>gcs_entity_type-installment_type-navigation-fee ) ).
lo_read_request->set_expand( lo_expand_root ).

DATA(lo_read_response) = lo_read_request->execute( ).

" get_business_data fills a TABLE (et_business_data) even for a to-one / 0..1 read
DATA lt_payment TYPE STANDARD TABLE OF ty_payment WITH EMPTY KEY.
lo_read_response->get_business_data( IMPORTING et_business_data = lt_payment ).
DATA(ls_payment) = COND #( WHEN lt_payment IS NOT INITIAL THEN lt_payment[ 1 ] ).
DATA(lv_etag)    = lo_read_response->get_etag( ).   " raw value, e.g. '2407' — no W/"…"
```

Facts worth keeping:

- Expand builder chain is `create_expand_node( )` → `add_expand( CONV #( nav ) )` → `set_expand( )`.
  Methods named `create_expand_node_factory` or `create_by_property_path` do **not** exist.
- `get_business_data` returns `et_business_data` (a table) for `navigate_to_optional` reads
  (response type `/iwbep/if_cp_response_read_01`) and for collection reads
  (`/iwbep/if_cp_response_read_list`) alike. Read into a 1-row table and take `[ 1 ]`.
- Filter: `create_filter_factory( )->create_by_range( iv_property_path = … it_range = … )` →
  `set_filter( )`. Property paths use the proxy model's upper-case names.
- To-many read: `navigate_to_many( nav )->create_request_for_read( )->execute( )->get_business_data( )`
  into the generated `tyt_<type>` table type.

## 4. Invoking a bound action or bound function

```abap
DATA(lo_action_request) = lo_entity_resource
  ->bind_action( zsc_travel=>gcs_bound_action-confirm_payment )
  ->create_request( ).

lo_action_request->set_parameter( is_parameter = ls_action_parameters ).  " generated tys_parameters_<n>
lo_action_request->set_if_match( lv_etag ).      " RAW eTag from get_etag( ) — the proxy wraps it W/"…"
lo_action_request->execute( ).                    " no HTTP-method argument
```

- `/iwbep/if_cp_request_action` exposes `set_parameter( is_parameter TYPE any )`,
  `set_if_match( iv_etag )`, `execute( )`, `check_execution( )`, `get_response( )`. It has
  **no** data-description / provided-properties node — that exists only on **create** requests.
- `set_if_match` wants the **unwrapped** eTag (`'2407'`), which is exactly what `get_etag( )`
  returns. Pass it straight through.
- Proxy-level `create_resource_for_action( )` / `create_resource_for_function( )` are for
  **unbound** action / function **imports** only (the interface documentation says so).
- Bound **functions** follow the same shape with `bind_function( … )->create_request( )` and
  a read-style response.

Decision rule:

```
Operation to invoke?
├─ Unbound action / function import                 → proxy: create_resource_for_action / _function
└─ Bound to an entity
   ├─ Binding entity reachable (key / to-one / 0..1) → proxy: navigate (+ downcast) → bind_action
   │    └─ server answers 400 "Property X cannot be used …" / mutually-exclusive members?
   │         → payload escape hatch (§5 + §6)
   └─ Bound to a collection                          → navigate_to_many → bind_action on the list
```

## 5. When the typed parameter structure cannot express the payload

**Symptom.** The proxy call reaches the server, the action *executes* (gateway log), and the
server answers with a **business** error — a message-class message such as
`400 Property PaymentPercentage cannot be used for a voucher payment`. A business message
means the transport already worked — stop touching the transport layer.

**Root cause pattern.** The action's parameter complex type declares several value
properties `Nullable="false"`, but the provider treats them as a **discriminated union**
("exactly one present"):

```xml
<ComplexType Name="PaymentValue">
  <Property Name="PaymentVoucher"    Type="Edm.String"  Nullable="false"/>
  <Property Name="PaymentAmount"     Type="Edm.Decimal" Nullable="false"/>
  <Property Name="PaymentPercentage" Type="Edm.Decimal" Nullable="false"/>
  <Property Name="PaymentDate"       Type="Edm.Date"/>                    <!-- the only nullable -->
</ComplexType>
```

A metadata-driven client cannot distinguish an *initial* ABAP `decfloat34` (serialized as
`0`) from an *intentionally supplied* `0` for a non-nullable property, so it serializes every
member and the server rejects the extra ones.

Why the proxy cannot omit them — every avenue checked:

| Avenue | Result |
|---|---|
| Value controls (`/iwbep/v4_value_control` = `indicate_omit`) | Generated **only for nullable** properties. If a property is missing from `tys_value_controls_<n>`, it will always be serialized. |
| Data-description / "provided properties" node | Exists only on **create** requests (`create_data_descripton_node`, `set_deep_business_data`). Action requests have `set_parameter( TYPE any )` only. |
| Loose structure / `REF TO data` / raw JSON into `set_parameter` | `TYPE any` still serializes per the registered parameter model. No raw-body overload. |
| Hand-editing the generated proxy model to add value controls | Unsupported; diverges from SAP-owned metadata. Not production. |

This is a metadata/implementation mismatch on the provider side and worth an SAP incident.
Until fixed, the working pattern is a **hand-built JSON body over a raw HTTP POST** for that
one action, keeping everything upstream (reads, DTOs) typed.

## 6. The raw-HTTP escape hatch — body and transport rules

```abap
" Body: string-typed struct so initial members become '' and compress drops them.
TYPES: BEGIN OF ty_json_payment_value,
         payment_voucher    TYPE string,
         payment_amount     TYPE string,
         payment_percentage TYPE string,
         payment_date       TYPE string,   " YYYY-MM-DD or ''
       END OF ty_json_payment_value.

DATA(lt_name_mappings) = VALUE /ui2/cl_json=>name_mappings(
  ( abap = 'NODE_ID'            json = 'PaymentNodeID' )
  ( abap = 'INSTALLMENTS'       json = '_Installment' )        " leading underscore: mapping mandatory
  ( abap = 'PAYMENT_VOUCHER'    json = 'PaymentVoucher' )
  ( abap = 'PAYMENT_AMOUNT'     json = 'PaymentAmount' )
  ( abap = 'PAYMENT_PERCENTAGE' json = 'PaymentPercentage' )
  ( abap = 'PAYMENT_DATE'       json = 'PaymentDate' ) ).

DATA(lv_body) = /ui2/cl_json=>serialize( data          = ls_body
                                          compress      = abap_true
                                          name_mappings = lt_name_mappings ).
```

Body rules (each one cost an iteration):

- `compress = abap_true` drops **empty-string** members only. Map initial numbers, dates and
  times to `''` yourself (`'0'` and `'00000000'` are kept). Format `Edm.Date` /
  `Edm.TimeOfDay` with `|{ lv_date DATE = ISO }|` / `|{ lv_time TIME = ISO }|`.
- Leading-underscore EDM names (`_Installment`) cannot be produced by any `pretty_name`
  mode — `name_mappings` is mandatory.
- Take EDM property names from the EDMX with a terminal `grep -o 'Name="[^"]*"'` on the
  one-line file, not by eye. See [abap-xml-json](../../abap-xml-json/SKILL.md) for `/ui2/cl_json`.

```abap
" Transport: a FRESH if_web_http_client — never the one the proxy owns.
DATA(lo_http_client) = cl_web_http_client_manager=>create_by_http_destination( mo_http_destination ).

" a) CSRF fetch on an entity GET with a RELATIVE path — the comm-arrangement destination
"    applies the service root on the FIRST request of a client.
DATA(lo_fetch_request) = lo_http_client->get_http_request( ).
lo_fetch_request->set_uri_path( i_uri_path = |Booking(TravelID='{ iv_travel_id }',BookingID='{ iv_booking_id }')| ).
lo_fetch_request->set_header_fields( VALUE #( ( name = 'X-CSRF-Token' value = 'Fetch' )
                                              ( name = 'Accept'       value = 'application/json' ) ) ).
DATA(lv_csrf_token) = lo_http_client->execute( if_web_http_client=>get )->get_header_field( 'x-csrf-token' ).

" b) POST on the SAME client (token + session cookie belong together) with the ABSOLUTE path —
"    the destination does NOT re-apply the service root on the second request.
DATA(lo_post_request) = lo_http_client->get_http_request( ).
lo_post_request->set_uri_path( i_uri_path =
  |{ c_service_root }Booking(TravelID='{ iv_travel_id }',BookingID='{ iv_booking_id }')|
  && |/_Payment/SAP__self.ConfirmPayment| ).
lo_post_request->set_header_fields( VALUE #(
  ( name = 'X-CSRF-Token' value = lv_csrf_token )
  ( name = 'Content-Type' value = 'application/json' )
  ( name = 'If-Match'     value = COND #( WHEN iv_etag IS INITIAL THEN `*`
                                          WHEN iv_etag CA `"`     THEN iv_etag
                                          ELSE |W/"{ iv_etag }"| ) ) ) ).
lo_post_request->set_text( lv_body ).
DATA(lo_post_response) = lo_http_client->execute( if_web_http_client=>post ).
DATA(lv_status)        = lo_post_response->get_status( )-code.
lo_http_client->close( ).
```

Transport rules:

1. **Never share an `if_web_http_client` between the proxy and raw calls.** The proxy's
   `$expand` query option leaks into your CSRF GET (`expand path contains invalid property`).
2. **The destination applies the service root only on the first `execute` of a client.**
   GET (first) → relative path; POST (second, same client for CSRF) → absolute path. Two fresh
   clients with a copied cookie do **not** work (`CSRF token is invalid`).
3. **CSRF is required** for A2X modifying calls even with a technical communication user
   (`403 CSRF token is missing`). Fetch it with a GET on an entity; a bare service-root GET may
   return 400.
4. **eTag quoting differs by transport.** Raw `If-Match` needs `*` or `W/"…"`; the proxy's
   `get_etag( )` returns the value unquoted → wrap it (`The etag could not be parsed`
   otherwise). The proxy's own `set_if_match` wants it **unwrapped**.
5. Use the schema **alias** `SAP__self.` (from `<Schema Alias>` in the EDMX) as the action
   qualifier; the full namespace also works but the alias is what SAP's clients use.
6. Read the exact service-root path from a working reference (comm-arrangement service URL,
   service binding, an existing consumer) — a wrong root is a `404` on the raw POST only,
   because the proxy derives its own root.

Keep the proxy `bind_action` method in the class as a **reference method** even while the
raw path is in production: it documents that the obvious way was tried, and it is the path to
switch back to once the provider's metadata is fixed.

## 7. Where to read the framework source in-system

On S/4HANA Cloud and BTP ABAP the `/iwbep` client-proxy runtime is readable in the ADT
Project Explorer under *System Library*:

```
System Library/(IWBEP)FRAMEWORK/(IWBEP)MAIN/(IWBEP)CP/(IWBEP)CP_RUNTIME/Source Code Library/{Interfaces,Classes}/
```

Read `/iwbep/cl_cp_resource` (navigation guards, `bind_action_int`) and
`/iwbep/if_cp_request_action` (what an action request can and cannot set) as soon as the
**second** activation cycle fails on the same proxy method. One read answers every
"does this method exist / is this cast legal" question; ten rounds of compiler ping-pong do not.

## 8. Error patterns specific to these chains

| Error / symptom | Meaning → fix |
|---|---|
| `/IWBEP/CX_CP_RUNTIME` `Navigation property '…' has multiplicity 'O'` | Used `navigate_to_single` on a 0..1 nav → `navigate_to_optional` + downcast |
| Compile: method `bind_action` unknown on `/iwbep/if_cp_resource_entity01` | Static typing only → `CAST /iwbep/if_cp_resource_entity( … )` |
| `400 … Property X cannot be used for …` (business message class) | Payload contract, transport is fine → §5/§6, do not touch transport |
| `expand path contains invalid property` on a CSRF GET | Shared HTTP client; proxy state leaked → fresh client per raw request pair |
| `403 CSRF token is missing` / `CSRF token is invalid` | No fetch, or fetch and POST on different clients → same client, GET then POST |
| `The etag could not be parsed` | Raw `If-Match` sent unquoted → `W/"…"` or `*` |
| `400 Resource not found for segment '<Action>'` | Wrong action qualifier → `SAP__self.<Action>` |
| `404` on the raw POST while proxy reads work | Service root missing on the second request → absolute path |
| `destination not found` from `create_by_comm_arrangement` | Scenario / service-id literal truncated or misspelled → diff against the real object names |

## Verified sources

- OData Client Proxy Overview: https://help.sap.com/docs/abap-cloud/abap-integration-connectivity/odata-client-proxy-overview
- Client Proxy Examples (V2/V4 factories, CSRF): https://help.sap.com/docs/abap-cloud/abap-integration-connectivity/client-proxy-examples
- How to execute actions or function imports in remote OData services (SAP Community): https://community.sap.com/t5/technology-blog-posts-by-sap/how-to-execute-actions-or-function-imports-in-remote-odata-services-from/ba-p/13536051
- Consuming an HTTP Service (ABAP Cloud): https://help.sap.com/docs/abap-cloud/abap-integration-connectivity/consume-http-service
- In-system framework source: `/iwbep/cl_cp_resource`, `/iwbep/if_cp_request_action` (path in §7) — the only source for the §2 casting facts.
