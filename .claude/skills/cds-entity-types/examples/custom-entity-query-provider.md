# Example — Custom Entity with an ABAP Query Provider

A complete, working pair: a custom entity exposing application-log entries plus
its `if_rap_query_provider` implementation. Modeled on
SAP-samples/abap-platform-application-jobs (`zappi_appl_log` +
`zapp_cl_show_appl_log`), reworked to Clean ABAP naming. The same skeleton serves
any API-backed entity — swap the BAL calls for a change-document read, an HTTP
client call, or a released BAPI wrapper.

## 1. Custom entity DDL (`ZI_APPLICATIONLOGENTRY`)

```sql
@EndUserText.label: 'Application Log Entries'
@ObjectModel.query.implementedBy: 'ABAP:ZCL_APPLICATION_LOG_QUERY'
@UI.headerInfo: {
  typeName: 'Log Entry',
  typeNamePlural: 'Log Entries',
  title: { type: #STANDARD, value: 'log_item_number' }
}
define custom entity ZI_ApplicationLogEntry
{
      @UI.selectionField: [ { position: 10 } ]
  key log_handle      : balloghndl;

      @UI.lineItem: [ { position: 10, importance: #HIGH, label: 'Item' } ]
  key log_item_number : balmnr;

      @UI.lineItem: [ { position: 20, importance: #HIGH,
                        criticality: 'criticality', label: 'Severity' } ]
      severity        : symsgty;

      // 1 = negative, 2 = critical, 3 = positive (Fiori criticality contract)
      criticality     : abap.int1;

      @UI.lineItem: [ { position: 30, label: 'Detail level' } ]
      detail_level    : ballevel;

      timestamp       : abap.utclong;

      @UI.lineItem: [ { position: 40, importance: #HIGH, label: 'Message' } ]
      message_text    : abap.sstring( 512 );
}
```

Notes:

- `@ObjectModel.query.implementedBy: 'ABAP:...'` — uppercase class name after
  `ABAP:`; mandatory in ABAP Cloud.
- No `select from` — the shape is declared, the data comes from the class.
- UI annotations work exactly as on views; the `criticality` element drives the
  severity color on the Fiori list.

## 2. Query provider class (`ZCL_APPLICATION_LOG_QUERY`)

```abap
CLASS zcl_application_log_query DEFINITION
  PUBLIC FINAL CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES if_rap_query_provider.

  PRIVATE SECTION.
    TYPES log_entries_type TYPE STANDARD TABLE OF zi_applicationlogentry
      WITH EMPTY KEY.

    METHODS read_log_entries
      IMPORTING log_handle         TYPE if_bali_log=>ty_handle
      RETURNING VALUE(log_entries) TYPE log_entries_type
      RAISING   cx_bali_runtime.

    METHODS derive_criticality
      IMPORTING severity           TYPE symsgty
      RETURNING VALUE(criticality) TYPE i.
ENDCLASS.


CLASS zcl_application_log_query IMPLEMENTATION.

  METHOD if_rap_query_provider~select.
    DATA log_entries TYPE log_entries_type.

    " --- 1. Read the request: paging, filter, sort ---------------------
    DATA(paging)    = io_request->get_paging( ).
    DATA(offset)    = paging->get_offset( ).
    DATA(page_size) = paging->get_page_size( ).

    TRY.
        DATA(filter_ranges) = io_request->get_filter( )->get_as_ranges( ).
        DATA(filter_sql)    = io_request->get_filter( )->get_as_sql_string( ).
      CATCH cx_rap_query_filter_no_range INTO DATA(no_range_error).
        " Filter not convertible to ranges (e.g. OR across elements):
        " this provider needs the key ranges, so report the problem.
        RAISE EXCEPTION TYPE zcx_application_log_query
          EXPORTING previous = no_range_error.
    ENDTRY.

    DATA order_by_clause TYPE string.
    LOOP AT io_request->get_sort_elements( ) INTO DATA(sort_element).
      order_by_clause =
        |{ order_by_clause } { sort_element-element_name }| &&
        COND #( WHEN sort_element-descending = abap_true
                THEN ` DESCENDING` ELSE ` ASCENDING` ).
    ENDLOOP.

    " --- 2. Call the backing API driven by the key filter ---------------
    " The consumer must filter on LOG_HANDLE (element names are uppercase).
    READ TABLE filter_ranges WITH KEY name = 'LOG_HANDLE'
      INTO DATA(handle_filter).
    IF sy-subrc <> 0 OR handle_filter-range IS INITIAL.
      io_response->set_total_number_of_records( 0 ).
      io_response->set_data( log_entries ).
      RETURN.
    ENDIF.

    TRY.
        LOOP AT handle_filter-range INTO DATA(handle_range)
             WHERE sign = 'I' AND option = 'EQ'.
          DATA(requested_handle) = CONV if_bali_log=>ty_handle(
                                     handle_range-low ).
          APPEND LINES OF read_log_entries( requested_handle )
            TO log_entries.
        ENDLOOP.
      CATCH cx_bali_runtime INTO DATA(log_read_error).
        RAISE EXCEPTION TYPE zcx_application_log_query
          EXPORTING previous = log_read_error.
    ENDTRY.

    " --- 3. Apply $filter and $orderby to the in-memory result ----------
    IF filter_sql IS NOT INITIAL OR order_by_clause IS NOT INITIAL.
      SELECT log_handle, log_item_number, severity, criticality, detail_level, timestamp, message_text FROM @log_entries AS entries
        WHERE (filter_sql)
        ORDER BY (order_by_clause)
        INTO TABLE @log_entries.
    ENDIF.

    " --- 4. Total count BEFORE paging, then slice the page --------------
    DATA(total_count) = lines( log_entries ).

    IF page_size <> if_rap_query_paging=>page_size_unlimited.
      DATA(first_row_beyond_page) = offset + page_size + 1.
      DELETE log_entries FROM first_row_beyond_page.
    ENDIF.
    IF offset > 0.
      DELETE log_entries TO offset.
    ENDIF.

    " --- 5. Answer exactly what was requested ---------------------------
    IF io_request->is_total_numb_of_rec_requested( ).
      io_response->set_total_number_of_records( total_count ).
    ENDIF.
    IF io_request->is_data_requested( ).
      io_response->set_data( log_entries ).
    ENDIF.
  ENDMETHOD.

  METHOD read_log_entries.
    DATA(log) = cl_bali_log_db=>get_instance( )->load_log(
                  handle           = log_handle
                  read_only_header = abap_true ).

    LOOP AT log->get_all_items( ) INTO DATA(log_item).
      APPEND VALUE #(
        log_handle      = log_handle
        log_item_number = log_item-log_item_number
        severity        = log_item-item->severity
        criticality     = derive_criticality( log_item-item->severity )
        detail_level    = log_item-item->detail_level
        timestamp       = log_item-item->timestamp
        message_text    = log_item-item->get_message_text( ) )
        TO log_entries.
    ENDLOOP.
  ENDMETHOD.

  METHOD derive_criticality.
    " Fiori criticality: 1 = error, 2 = warning, 3 = success/neutral
    criticality = SWITCH #( severity
                            WHEN 'E' OR 'A' THEN 1
                            WHEN 'W' OR 'X' THEN 2
                            WHEN 'S' OR 'I' THEN 3
                            ELSE 0 ).
  ENDMETHOD.

ENDCLASS.
```

`zcx_application_log_query` is a T100-based subclass of
`cx_rap_query_provider`, so the framework turns it into a proper OData error
(the SAP sample builds the `textid` from
`cl_message_helper=>get_latest_t100_exception( previous )->t100key`).

## 3. Exposure — identical to a view

```sql
define service ZUI_ApplicationLog {
  expose ZI_ApplicationLogEntry as LogEntry;
}
```

Bind the service definition (OData V4 UI binding) and the entity appears in the
Fiori Elements list report; every read the UI issues arrives in
`if_rap_query_provider~select`.

## Variations seen in the SAP samples

| Variation | Sample | What changes |
|---|---|---|
| Released API with range input | `zreusecl_get_change_docs_002` | Filter ranges (`OBJECTID`) are copied into `cl_chdo_read_tools=>changedocument_read`'s range table; result is `MOVE-CORRESPONDING`-mapped |
| Fixed-value value help | `zreusecl_vh_product_002` | No API at all — a `VALUE #( ... )` table, then the itab-SELECT filter trick |
| Single-read fast path | `zapp_cl_show_appl_log` | If every key element is filtered with one `I EQ` range, read one item (`log->get_item( ... )`) and return early with total = 1 |
