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
    TYPES tt_log_entries TYPE STANDARD TABLE OF zi_applicationlogentry
      WITH EMPTY KEY.

    METHODS read_log_entries
      IMPORTING iv_log_handle         TYPE if_bali_log=>ty_handle
      RETURNING VALUE(rt_log_entries) TYPE tt_log_entries
      RAISING   cx_bali_runtime.

    METHODS derive_criticality
      IMPORTING iv_severity           TYPE symsgty
      RETURNING VALUE(rv_criticality) TYPE i.
ENDCLASS.


CLASS zcl_application_log_query IMPLEMENTATION.

  METHOD if_rap_query_provider~select.
    DATA lt_log_entries TYPE tt_log_entries.

    " --- 1. Read the request: paging, filter, sort ---------------------
    DATA(lo_paging)    = io_request->get_paging( ).
    DATA(lv_offset)    = lo_paging->get_offset( ).
    DATA(lv_page_size) = lo_paging->get_page_size( ).

    TRY.
        DATA(lt_filter_ranges) = io_request->get_filter( )->get_as_ranges( ).
        DATA(lv_filter_sql)    = io_request->get_filter( )->get_as_sql_string( ).
      CATCH cx_rap_query_filter_no_range INTO DATA(lo_no_range_error).
        " Filter not convertible to ranges (e.g. OR across elements):
        " this provider needs the key ranges, so report the problem.
        RAISE EXCEPTION TYPE zcx_application_log_query
          EXPORTING previous = lo_no_range_error.
    ENDTRY.

    DATA lv_order_by_clause TYPE string.
    LOOP AT io_request->get_sort_elements( ) INTO DATA(ls_sort_element).
      lv_order_by_clause =
        |{ lv_order_by_clause } { ls_sort_element-element_name }| &&
        COND #( WHEN ls_sort_element-descending = abap_true
                THEN ` DESCENDING` ELSE ` ASCENDING` ).
    ENDLOOP.

    " --- 2. Call the backing API driven by the key filter ---------------
    " The consumer must filter on LOG_HANDLE (element names are uppercase).
    READ TABLE lt_filter_ranges WITH KEY name = 'LOG_HANDLE'
      INTO DATA(ls_handle_filter).
    IF sy-subrc <> 0 OR ls_handle_filter-range IS INITIAL.
      io_response->set_total_number_of_records( 0 ).
      io_response->set_data( lt_log_entries ).
      RETURN.
    ENDIF.

    TRY.
        LOOP AT ls_handle_filter-range INTO DATA(ls_handle_range)
             WHERE sign = 'I' AND option = 'EQ'.
          DATA(lv_requested_handle) = CONV if_bali_log=>ty_handle(
                                     ls_handle_range-low ).
          APPEND LINES OF read_log_entries( lv_requested_handle )
            TO lt_log_entries.
        ENDLOOP.
      CATCH cx_bali_runtime INTO DATA(lo_log_read_error).
        RAISE EXCEPTION TYPE zcx_application_log_query
          EXPORTING previous = lo_log_read_error.
    ENDTRY.

    " --- 3. Apply $filter and $orderby to the in-memory result ----------
    IF lv_filter_sql IS NOT INITIAL OR lv_order_by_clause IS NOT INITIAL.
      SELECT log_handle, log_item_number, severity, criticality, detail_level, timestamp, message_text FROM @lt_log_entries AS entries
        WHERE (lv_filter_sql)
        ORDER BY (lv_order_by_clause)
        INTO TABLE @lt_log_entries.
    ENDIF.

    " --- 4. Total count BEFORE paging, then slice the page --------------
    DATA(lv_total_count) = lines( lt_log_entries ).

    IF lv_page_size <> if_rap_query_paging=>page_size_unlimited.
      DATA(lv_first_row_beyond_page) = lv_offset + lv_page_size + 1.
      DELETE lt_log_entries FROM lv_first_row_beyond_page.
    ENDIF.
    IF lv_offset > 0.
      DELETE lt_log_entries TO lv_offset.
    ENDIF.

    " --- 5. Answer exactly what was requested ---------------------------
    IF io_request->is_total_numb_of_rec_requested( ).
      io_response->set_total_number_of_records( lv_total_count ).
    ENDIF.
    IF io_request->is_data_requested( ).
      io_response->set_data( lt_log_entries ).
    ENDIF.
  ENDMETHOD.

  METHOD read_log_entries.
    DATA(lo_log) = cl_bali_log_db=>get_instance( )->load_log(
                  handle           = iv_log_handle
                  read_only_header = abap_true ).

    LOOP AT lo_log->get_all_items( ) INTO DATA(ls_log_item).
      APPEND VALUE #(
        log_handle      = iv_log_handle
        log_item_number = ls_log_item-log_item_number
        severity        = ls_log_item-item->severity
        criticality     = derive_criticality( ls_log_item-item->severity )
        detail_level    = ls_log_item-item->detail_level
        timestamp       = ls_log_item-item->timestamp
        message_text    = ls_log_item-item->get_message_text( ) )
        TO rt_log_entries.
    ENDLOOP.
  ENDMETHOD.

  METHOD derive_criticality.
    " Fiori criticality: 1 = error, 2 = warning, 3 = success/neutral
    rv_criticality = SWITCH #( iv_severity
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
