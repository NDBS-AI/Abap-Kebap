# The if_rap_query_provider Contract — Deep Dive

How the RAP unmanaged query works end-to-end: what the framework hands you in
`io_request`, what you owe it in `io_response`, and the failure modes. Every claim
here is grounded in the SAP Help pages linked at the bottom and in three
SAP-samples query providers:

- `zapp_cl_show_appl_log` (abap-platform-application-jobs) — application-log reader
- `zreusecl_get_change_docs_002` (abap-platform-reuse-services) — change documents
- `zreusecl_vh_product_002` (abap-platform-reuse-services) — value help

## The single method

```abap
METHODS select IMPORTING io_request  TYPE REF TO if_rap_query_request
                         io_response TYPE REF TO if_rap_query_response
               RAISING   cx_rap_query_provider.
```

The framework calls `select` for **every** OData read on the custom entity: list
reads, single reads (key access), value-help dropdowns, `$count` requests. Your
implementation must distinguish those cases from the request object alone — there
is no separate "read by key" method.

## Reading the request

### Paging — get_paging( )

Returns an `if_rap_query_paging` instance:

| Method | Meaning |
|---|---|
| `get_offset( )` | Number of rows to skip (OData `$skip`). First returned row = offset + 1. |
| `get_page_size( )` | Maximum rows to return (OData `$top`), typed `int8`. Returns the constant `if_rap_query_paging=>page_size_unlimited` — value **-1** — if no limit was requested. |

Standard handling:

```abap
DATA(lo_paging)    = io_request->get_paging( ).
DATA(lv_offset)    = lo_paging->get_offset( ).
DATA(lv_page_size) = lo_paging->get_page_size( ).

DATA(lv_max_rows) = COND #( WHEN lv_page_size = if_rap_query_paging=>page_size_unlimited
                           THEN 0            " 0 = no restriction in the API call
                           ELSE lv_page_size ).
```

The application-log sample computes `max_index = top + skip`, selects `UP TO
max_index ROWS` from the in-memory table, and then removes the first `skip` rows
with `DELETE lt_business_data TO skip.` — a workable pattern when the backing API
cannot page natively.

**Contract:** return *exactly* the requested page, not the full result. The
framework does not slice for you.

### Filter — get_filter( )

Returns an `if_rap_query_filter` instance with two representations of the same
`$filter`:

| Method | Returns | Fails when |
|---|---|---|
| `get_as_ranges( )` | `if_rap_query_filter=>tt_name_range_pairs` — one entry per element name, each with a classic ranges table (`sign`/`option`/`low`/`high`) that applies simultaneously (AND) with the others | Raises `cx_rap_query_filter_no_range` when the filter cannot be represented as simultaneously applicable range tables (e.g. OR conditions spanning different elements) |
| `get_as_sql_string( )` | The filter as a dynamic SQL condition string | — |

Use **ranges** to drive the backing API (they map naturally to importing range
parameters) and the **SQL string** to post-filter in-memory data:

```abap
TRY.
    DATA(lt_filter_ranges) = io_request->get_filter( )->get_as_ranges( ).
  CATCH cx_rap_query_filter_no_range INTO DATA(lo_no_range_error).
    " Fall back: fetch a superset and rely on the SQL string below,
    " or raise cx_rap_query_provider if the filter is mandatory.
ENDTRY.

DATA(lv_filter_sql) = io_request->get_filter( )->get_as_sql_string( ).

" The itab-SELECT trick: apply the OData filter to in-memory data
" (fields vary by sample: application-log uses log_handle/log_item_number; change-documents use OBJECTID/CHNGCNTR; value-help varies)
SELECT key_field, field1, field2 FROM @lt_business_data AS data_source
  WHERE (lv_filter_sql)
  INTO TABLE @lt_business_data.
```

Both reuse-services samples use exactly this `SELECT ... FROM @itab WHERE
(dynamic)` statement; the change-documents sample additionally converts the
`OBJECTID` range rows into `cl_chdo_read_tools` range lines before calling the API.

#### Detecting a single read (key access)

Fiori object pages read one instance by key. The application-log sample detects
this by checking whether the filter contains, for every key element, exactly one
range line with `sign = 'I'`, `option = 'EQ'`, and a non-initial `low`:

```abap
READ TABLE lt_filter_ranges WITH KEY name = 'LOG_HANDLE' INTO DATA(ls_handle_filter).
IF sy-subrc = 0 AND lines( ls_handle_filter-range ) = 1
   AND ls_handle_filter-range[ 1 ]-sign = 'I'
   AND ls_handle_filter-range[ 1 ]-option = 'EQ'
   AND ls_handle_filter-range[ 1 ]-low IS NOT INITIAL.
  " single read for this key element
ENDIF.
```

Note: element names in the ranges table are **uppercase** (`'LOG_HANDLE'`,
`'OBJECTID'` in the samples).

### Sorting — get_sort_elements( )

Returns the requested `$orderby` as a list of element name + descending flag.
The application-log sample turns it into a dynamic `ORDER BY`:

```abap
DATA lv_order_by_clause TYPE string.
LOOP AT io_request->get_sort_elements( ) INTO DATA(ls_sort_element).
  lv_order_by_clause = |{ lv_order_by_clause } { ls_sort_element-element_name }| &&
                    COND #( WHEN ls_sort_element-descending = abap_true
                            THEN ` DESCENDING` ELSE ` ASCENDING` ).
ENDLOOP.

SELECT key_field, field1, field2 FROM @lt_business_data AS data_source
  WHERE (lv_filter_sql)
  ORDER BY (lv_order_by_clause)
  INTO TABLE @lt_business_data.
```

### Requested elements — get_requested_elements( )

Returns the element names the consumer asked for (`$select`). Optimization
opportunity: skip expensive lookups (e.g. long-text reads) when the element is
not requested. The samples read it but return full rows — acceptable, since
returning more elements than requested is not an error.

### Aggregation — get_aggregation( )

Returns an `if_rap_query_aggregation` instance describing requested aggregation
and grouping. Only relevant if the custom entity is used in analytical-style
consumption; plain list reports never populate it. If you do not support
aggregation, you can ignore it (the samples do).

### Other request methods

`get_parameters( )` returns values for input parameters declared in the custom
entity DDL (`define custom entity ... with parameters` skeleton).

## Answering via io_response

| Method | Pairs with (on the request) | Contract |
|---|---|---|
| `set_data( itab )` | `is_data_requested( )` | The rows for this page, typed as the custom entity (`TYPE TABLE OF zi_...`). |
| `set_total_number_of_records( count )` | `is_total_numb_of_rec_requested( )` | Total row count **before paging** — this answers `$count` / `$inlinecount`. |

Per the IF_RAP_QUERY_RESPONSE documentation, `set_data` provides the response for
`is_data_requested` and `set_total_number_of_records` for
`is_total_numb_of_rec_requested`. Guard the expensive branches:

```abap
IF io_request->is_total_numb_of_rec_requested( ).
  io_response->set_total_number_of_records( lv_total_count ).
ENDIF.
IF io_request->is_data_requested( ).
  io_response->set_data( lt_business_data ).
ENDIF.
```

(The SAP samples call both setters unconditionally — harmless for small data, but
a pure `$count` request should not pay for full data retrieval.)

Common bug: computing the total *after* slicing the page — the UI then shows
"20 items" for every page. Capture `lines( result )` before applying
offset/page-size, as the application-log sample does
(`lv_total_number_of_records = lines( lt_business_data ).` before the paging cuts).

## Error handling

Declare and raise `cx_rap_query_provider` (or a subclass) to signal query
failure; the framework maps it to an OData error response. The samples wrap API
exceptions into a T100-based subclass, extracting the message via
`cl_message_helper=>get_latest_t100_exception( exception )->t100key` and passing
it as `textid` with `previous = exception` — this preserves both the message and
the stack for supportability. Never swallow exceptions and return an empty table:
the consumer cannot distinguish "no data" from "broken backend".

## Implementation checklist

1. Type the result table with the custom entity name (`TYPE TABLE OF zi_...`).
2. Read paging; map `page_size_unlimited` (-1) to "unrestricted" in the backing API.
3. Read filter as ranges inside `TRY ... CATCH cx_rap_query_filter_no_range`.
4. Detect single reads (all keys filtered with one `I EQ` range each) and take the fast path.
5. Call the API / service; map results into the entity row type.
6. Post-apply filter and sort with `SELECT ... FROM @itab WHERE (sql) ORDER BY (sort)`.
7. Capture the total count, then slice the page (offset + page size).
8. Answer `is_total_numb_of_rec_requested` / `is_data_requested`.
9. Convert backend errors to `cx_rap_query_provider` (keep `previous`).

## Sources

- IF_RAP_QUERY_PROVIDER: https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/c49089658a294e36a260f912a84d3eb7.html
- IF_RAP_QUERY_REQUEST: https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/dcc3fe5b4dd24d5f909733a7c00ff281.html
- IF_RAP_QUERY_RESPONSE: https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/f6f51009e2504e6bbbc1b22220e9c32a.html
- IF_RAP_QUERY_PAGING: https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/c9e191cc92e54ca2bfec677037780c03.html
- IF_RAP_QUERY_FILTER: https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/5a4ea75def544e30a7dc24350a446f0e.html
- IF_RAP_QUERY_AGGREGATION: https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/02a976f77de44374be361d9df48610c5.html
- Implementing an Unmanaged Query: https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/254f68c7d5374e94a88241b7ce3bd414.html
- Implementing Paging in an Unmanaged Query: https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/6e61d176b14a48d8904a28d2653ae94f.html
- Implementing Filtering in an Unmanaged Query: https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/aac0986d5c054a4cb2db43ec8a49caf3.html
- Sample classes: SAP-samples/abap-platform-application-jobs (`zapp_cl_show_appl_log`), SAP-samples/abap-platform-reuse-services (`zreusecl_get_change_docs_002`, `zreusecl_vh_product_002`)
