# Application Log — BALI API deep dive

The Application Log (BAL) is the durable, structured log store of the ABAP platform. In ABAP Cloud you use it through the released **BALI** classes (`cl_bali_*` / `if_bali_*`) — the classic `BAL_LOG_*` function modules are not available. Background code (application jobs, bgPF operations) has no console, so BALI is where its output belongs; logs can be attached to the job log and displayed in your own Fiori apps.

## Object model

```
Log object (APLO)            repository object, e.g. ZINVENTORY_LOG — the log's "namespace"
  └─ Subobject               e.g. ZINVENTORY_SUB — a category within the object
Log (if_bali_log)            one log instance: header + items; identified by a handle
  └─ Item (if_bali_item)     one message: free text, T100 message, or exception
```

## Creating the log object (once, design time)

ADT: *New → Other → Application Log Object* — a JSON artifact of type `APLO`:

```json
{
  "formatVersion": "1",
  "header": { "description": "Inventory job log", "abapLanguageVersion": "cloudDevelopment" },
  "subobjects": [ { "name": "ZINVENTORY_SUB", "description": "Calculation" } ]
}
```

Or programmatically with the released object handler (used by the sample's setup class):

```abap
DATA(subobjects) = VALUE if_bali_object_handler=>ty_tab_subobject(
    ( subobject = 'ZINVENTORY_SUB' subobject_text = 'Calculation' ) ).

TRY.
    cl_bali_object_handler=>get_instance( )->create_object(
        iv_object            = 'ZINVENTORY_LOG'
        iv_object_text       = 'Inventory job log'
        it_subobjects        = subobjects
        iv_package           = package_name
        iv_transport_request = transport_request ).
  CATCH cx_bali_objects INTO DATA(object_creation_error).
    " the sample treats message BL 602 ("already exists") as success
ENDTRY.
```

## Writing a log

```abap
" 1. Create a log with a header (object + subobject + free-text external id)
DATA(application_log) = cl_bali_log=>create_with_header(
    header = cl_bali_header_setter=>create( object      = 'ZINVENTORY_LOG'
                                            subobject   = 'ZINVENTORY_SUB'
                                            external_id = CONV #( inventory_uuid ) ) ).

" 2. Create items and add them
DATA(log_item) = cl_bali_free_text_setter=>create(
    severity = if_bali_constants=>c_severity_status
    text     = |Recalculation started for { inventory_uuid }| ).   " max 200 characters
log_item->set_detail_level( '1' ).
application_log->add_item( item = log_item ).

" 3. Persist
cl_bali_log_db=>get_instance( )->save_log(
    log                         = application_log
    assign_to_current_appl_job = abap_true ).   " attach to the running application job
```

Notes:

- `cl_bali_free_text_setter=>ty_text` is a character field of length **200** — longer strings must be split.
- `assign_to_current_appl_job = abap_true` links the log to the currently running application job so it shows up as the job's log; only meaningful when actually running as a job (`sy-batch = abap_true`).
- Besides free text, item setters exist for T100 messages and exceptions — the free-text setter is what both SAP samples use.
- All runtime errors raise `cx_bali_runtime`. In a job's `execute`, catch it and re-raise as `cx_apj_rt_content` (the sample does exactly this) so the job framework records the failure.

### Severities (if_bali_constants)

| Constant | Value | Meaning | Typical Fiori criticality |
|---|---|---|---|
| `c_severity_status` | `S` | Status | 3 (green) |
| `c_severity_information` | `I` | Information | 3 (green) |
| `c_severity_warning` | `W` | Warning | 2 (orange) |
| `c_severity_error` | `E` | Error | 1 (red) |
| `c_severity_termination` | `A` | Termination | 1 (red) |
| `c_severity_exit` | `X` | Exit | 2 (orange) |

(The criticality mapping is the one the sample's query provider applies for UI coloring.)

## Reading a log

A log is addressed by its **handle** (`if_bali_log=>ty_handle`, DDIC type `balloghndl`). Get it from a live log with `application_log->get_handle( )` — the samples persist it on the business entity (field `LogHandle`) during the save phase, so the UI can find the log later.

```abap
TRY.
    DATA(log) = cl_bali_log_db=>get_instance( )->load_log(
        handle           = log_handle
        read_only_header = abap_true ).

    LOOP AT log->get_all_items( ) INTO DATA(loaded_item).
      " loaded_item-log_item_number
      " loaded_item-item->severity / ->category / ->detail_level / ->timestamp
      " loaded_item-item->get_message_text( )
    ENDLOOP.

    " single item by number:
    DATA(single_item) = log->get_item( log_item_number ).
  CATCH cx_bali_runtime INTO DATA(log_read_error).
    " e.g. handle unknown or no authorization
ENDTRY.
```

## Displaying the log in a Fiori Elements app

The Application Jobs sample integrates the log into the BO's object page without any UI development:

1. **Custom entity** keyed by `log_handle : balloghndl` and `log_item_number : balmnr`, annotated `@ObjectModel.query.implementedBy: 'ABAP:ZCL_SHOW_APPL_LOG'`, with elements for severity, category, criticality, detail level, timestamp, and message text.
2. **Unmanaged query** (`if_rap_query_provider~select`): read the `LOG_HANDLE` filter, `load_log`, map `get_all_items( )` to the entity structure, derive criticality from severity, apply paging/sorting, `io_response->set_data( ... )`.
3. **Association** from the BO root view to the custom entity on `LogHandle = _ApplicationLog.Log_handle`.
4. **`@UI.facet`** of type `#LINEITEM_REFERENCE` targeting `_ApplicationLog` — the log items appear as a table on the object page.

## Authorization

Reading application logs requires authorization object **`S_APPL_LOG`** (fields: log object, subobject, activity). Without it, `load_log` fails for end users even though writing from the job worked — grant it via the business role. See [abap-authorization](../../abap-authorization/SKILL.md).

## Verified sources

- Create a New Application Log: https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/f7c20f7b2fce4fbaba79ae0c5182d869.html
- Writing Application Logs to the Database: https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/d15d974dfca34671ae3b62ddf0baf8ae.html
- Classes and Interfaces of the Application Log API: https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/59023fcd95ec459d8259c1e2840b816a.html
- CL_BALI_LOG (Interface IF_BALI_LOG): https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/5e25cf7682d9432b840aa11144f2c2ac.html
- CL_BALI_LOG_DB (Interface IF_BALI_LOG_DB): https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/069179d957b345e1bbf3f43da31fa446.html
- Sample repos: https://github.com/SAP-samples/abap-platform-application-jobs · https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects
