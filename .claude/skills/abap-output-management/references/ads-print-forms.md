# Printing in ABAP Cloud — Print Queues, ADS Form Rendering, PDF Merger

Deep dive companion to [../SKILL.md](../SKILL.md). Sources: SAP BTP documentation (SAP-docs
mirror) and the SAP-samples reuse-services repository (links at the bottom). Anything the
sources do not state is marked as such.

## Architecture at a glance

```
RAP service definition ──cl_fp_fdp_services──▶ XML data ─┐
                                                         ├─▶ cl_fp_ads_util ──▶ PDF (render_pdf)
XDP template (LiveCycle Designer)                        │        │
  ├─ uploaded in ADT ──cl_fp_form_reader──▶ XDP xstring ─┘        └──▶ PDL (render_4_pq)
  └─ or SAP Forms Service template store (HTTP client)                     │
                                                                           ▼
                             cl_print_queue_utils=>create_queue_item_by_data
                                                                           │
                                     Maintain Print Queues ◀── SAP Cloud Print Manager (pull)
```

Adobe Document Services (ADS) render **Adobe XML Forms (XFA)** to PDF and other print formats.
The application sends form data + template over a secure connection; the service returns the
rendered document, usable for screen output or the print queue.

## Print queues — cl_print_queue_utils

### The documented API

`CL_PRINT_QUEUE_UTILS`, method `CREATE_QUEUE_ITEM_BY_DATA`. One queue item = one main document
plus zero or more attachments.

| Parameter | Direction | Meaning |
|---|---|---|
| `IV_QNAME` | importing | Name of the print queue |
| `IV_PRINT_DATA` | importing | Print document as `xstring` |
| `IV_NAME_OF_MAIN_DOC` | importing | Name of the main document |
| `IV_NUMBER_OF_COPIES` | importing | Number of copies |
| `IV_PAGES` | importing | Number of pages |
| `IT_ATTACHMENT_DATA` | importing | Attachment list — name + `xstring` data per row |
| `RV_ITEMID` | returning | ID of the created queue item (on success) |
| `EV_ERR_MSG` | exporting | Error messages (on failure) |

Documented minimal call (from the Printing page, trimmed):

```abap
DATA print_data TYPE xstring.
DATA(queue_item_id) = cl_print_queue_utils=>create_queue_item_by_data(
    iv_qname            = 'MY_QUEUE'
    iv_print_data       = print_data
    iv_name_of_main_doc = 'Sales order 4711' ).
```

Only this method is documented — do not assume other methods of the class exist or are
released without checking ADT.

### Administration side

- Queues are created/managed in the Fiori app **Maintain Print Queues**: create, delete,
  pause (stop collection during repairs), restart, reassign items between queues, and inspect
  item statuses — *New*, *Failed*, *Transmitted*, *Successful*, *Warning*.
- Local printers integrate via the **SAP Cloud Print Manager for Pull Integration** and
  communication scenarios **`SAP_COM_0466`** / **`SAP_COM_0467`** (plus `SAP_COM_0A86` per the
  docs TOC).
- Support components: `BC-CCM-PRN-OM-PQ` / `BC-CCM-PRN-OM-PM`.

## Form data — cl_fp_fdp_services (RAP Data Services for Print Forms)

Form data is modeled as a **RAP service definition** (no service binding required for FDP use).
The class provides XML data for rendering and the XSD for form design.

### Getting an instance and keys

```abap
DATA(form_data_provider) = cl_fp_fdp_services=>get_instance( `FP_FDP_SERVICE_EX1` ).
DATA(selection_keys) = form_data_provider->get_keys( ).
selection_keys[ name = 'UUID' ]-value = 'FA163EE47BDD1ED9A682A2E6F1ECF696'.
```

`get_keys( )` returns all key fields of the service definition
(`if_fp_fdp_api=>tt_select_keys`); assign the values identifying the document to output. The
reuse-services sample additionally passes `iv_root_node` (the leading entity name) to
`get_instance` — the documentation page shows only the service-definition parameter, so treat
`iv_root_node`/`iv_max_depth` as sample-observed, not doc-guaranteed.

### read_to_xml_v2 — data for rendering

| Parameter | Meaning |
|---|---|
| `IT_SELECT` | Key parameters (from `get_keys( )`, values filled) |
| `IV_LANGUAGE` (optional) | Overrides the locale language — controls how dynamic values such as units are resolved |
| `RV_XML` (returning) | Resulting XML as `xstring` |

```abap
TRY.
    DATA(form_xml_data) = form_data_provider->read_to_xml_v2( selection_keys ).
  CATCH cx_fp_fdp_error INTO DATA(form_data_error).
ENDTRY.
```

**Draft-enabled services:** the implicitly exported `IsActiveEntity` property defaults to
false, so by default draft data would be addressed. To read **active** data, override it:

```abap
DATA(form_xml_data) = form_data_provider->read_to_xml_v2(
    it_select     = selection_keys
    it_select_add = VALUE if_fp_fdp_api=>tt_select_keys(
        ( name = 'IsActiveEntity' value = 'X' data_type = 'ABAP_BOOL' ) ) ).
```

### get_xsd_v2 — schema for form design

`get_xsd_v2( )` returns the XML Schema Definition (XSD, as `xstring`) that the form template
binds against in Adobe LiveCycle Designer. Same exception, `cx_fp_fdp_error`.

**Version note:** the reuse-services sample calls `read_to_xml( )` and `get_xsd( )` (without
`_v2`); the current documentation describes `read_to_xml_v2` / `get_xsd_v2`. Prefer the
documented `_v2` methods and verify what is released in your system.

## Form templates

### Designer

XDP form templates describe the form layout in Adobe XFA format; the supported data binding
type is an XML data schema (the XSD above). Design tool: **Adobe LiveCycle Designer for SAP
solutions**, downloadable via the *Install Additional Software* app (link to SAP ONE Support
Launchpad).

### Option A — upload in ADT, read with cl_fp_form_reader

Templates uploaded through ADT (*Working with Forms* in the ADT user guide) are read at
runtime:

```abap
DATA(form_reader) = cl_fp_form_reader=>create_form_reader( 'MY_FORM' ).
DATA(xdp_layout) = form_reader->get_layout( ).   " RV_LAYOUT: XDP as xstring
```

Further read-only getters (no import parameters): `get_fdp_name` (connected Form Data
Provider), `get_data_optimized` (data optimization enabled?), `get_font_embed` (automatic font
embedding when rendering?).

### Option B — SAP Forms Service template store (reuse-services pattern)

The SAP-samples reuse-services repository manages templates in the **SAP Forms Service** (BTP)
template store instead: a custom HTTP client class (`zreusecl_fp_tmpl_store_client` in the
sample) calls the store's REST API through a communication arrangement / service instance and
offers `list_forms`, `get_template_by_name` (XDP as `xstring`), `set_schema` (upload the XSD
from `get_xsd`), version history, and friends. This is **sample code, not a released SAP
API** — copy and adapt it if you manage templates outside the ABAP system.

## Rendering — cl_fp_ads_util

Runtime API for ADS rendering calls; both methods raise `cx_fp_ads_util`.

### render_pdf

| Parameter | Direction | Meaning |
|---|---|---|
| `IV_XML_DATA` | importing | XML data |
| `IV_XDP_LAYOUT` | importing | Adobe XDP form template |
| `IV_LOCALE` | importing | `language_COUNTRY`, e.g. `en_US` |
| `IS_OPTIONS` | importing | PDF rendering parameters (optional) |
| `EV_PDF` | exporting | Rendered PDF |
| `EV_PAGES` | exporting | (number of pages) |
| `EV_TRACE_STRING` | exporting | Trace string |

```abap
TRY.
    cl_fp_ads_util=>render_pdf(
      EXPORTING iv_xml_data     = form_xml_data
                iv_xdp_layout   = xdp_layout
                iv_locale       = 'de_DE'
                is_options      = VALUE #( trace_level = 0 )  " sample used 4 for debugging
      IMPORTING ev_pdf          = rendered_pdf
                ev_pages        = page_count
                ev_trace_string = ads_trace ).
  CATCH cx_fp_ads_util INTO DATA(rendering_error).
ENDTRY.
```

The documentation labels `IS_OPTIONS` only as "PDF rendering parameters (optional)"; the
reuse-services sample sets `trace_level` in it (with a comment to use `0` in production). The
full options structure is not documented on the mirrored page — inspect the released type in
ADT before relying on other fields.

### render_4_pq

Renders directly in the print output format required by the target queue; the supported *Print
Definition Language* (PDL) is taken from the print queue properties.

| Parameter | Direction | Meaning |
|---|---|---|
| `IV_XML_DATA` | importing | XML data |
| `IV_XDP_LAYOUT` | importing | Adobe XDP form template |
| `IV_LOCALE` | importing | `language_COUNTRY` |
| `IV_PQ_NAME` | importing | Print queue name |
| `IS_OPTIONS` | importing | PDL rendering parameters (optional) |
| `EV_PDL` | exporting | Rendering result in the queue's print format |
| `EV_PAGES` | exporting | Number of pages |
| `EV_TRACE_STRING` | exporting | Trace string |

The doc's own sample additionally receives `ev_pdf_trace`, which is absent from the parameter
table — treat it as optional/uncertain.

## PDF Merger — cl_rspo_pdf_merger / if_rspo_pdf_merger

| Method | Signature (documented) | Notes |
|---|---|---|
| `CREATE_INSTANCE` (static) | returning `MERGER_INSTANCE` (ref to `IF_RSPO_PDF_MERGER`) | |
| `ADD_DOCUMENT` | importing `DOCUMENT` (`xstring`) | Call once per source file; result keeps source order |
| `MERGE_DOCUMENTS` | returning `MERGED_DOCUMENT` (`xstring`) | Raises `CX_RSPO_PDF_MERGER` |

Exception attributes: `DOCUMENT_INDEX` (index of the offending source), `ERROR_CODE`,
`ERROR_TEXT`.

Restrictions (documented):

- PDF files only.
- **No encrypted PDFs** — check the file's *Security* properties, or search the raw bytes for
  the keyword `Encrypt`.
- **No damaged PDFs** — missing parts or changed bytes make the file unprocessable; PDFs are
  binary, so any codepage conversion damages them.
- Further restrictions: SAP note 2264208 (https://me.sap.com/notes/2264208).

## The reuse-services sample, step by step

Repository: https://github.com/SAP-samples/abap-platform-reuse-services — a sales-order RAP BO
whose "Create PDF" action produces an Adobe-form PDF and stores it on the entity.

1. **Action (interaction phase)** — only sets `Description = 'PDF generation started'`. No
   rendering, no HTTP, no commit-relevant work here.
2. **Saver class `save_modified`** — collects sales-order IDs whose description carries the
   marker and registers a bgPF background process:
   ```abap
   DATA(background_process) = cl_bgmc_process_factory=>get_default( )->create( ).
   background_process->set_operation_tx_uncontrolled( pdf_generation_operation ).
   background_process->set_name( |PDF salesorder { sales_order_id }| ).
   background_process->save_for_execution( ).
   ```
   Uncontrolled (`if_bgmc_op_single_tx_uncontr`) because the operation must issue its own
   `COMMIT ENTITIES`. See the abap-background-processing skill for the bgPF contract.
3. **bgPF operation `execute`** — per sales order: build XML via the FDP service, fetch the
   XDP template (template store client in the sample; `cl_fp_form_reader` for ADT-uploaded
   templates), call `cl_fp_ads_util=>render_pdf`, then write back
   `Attachment` (the PDF `xstring`), `FileName` (`file_<id>.pdf`), `MimeType`
   (`application/pdf`), and a status text via `MODIFY ENTITIES ... UPDATE FIELDS` +
   `COMMIT ENTITIES`. On error, the error text lands in the status field instead.
4. **UI** — the Fiori elements app shows the attachment as a downloadable file after refresh.

Why this shape: the ADS call is a remote round trip. Doing it in the action would block the
user and couple output to a transaction that may still fail; doing it in `save_modified`
directly would stretch the save LUW. The bgPF operation runs after the successful commit in
its own LUW.

## Sources

- Printing: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/printing-754b6cd.md
- Print Forms: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/print-forms-959664f.md
- Retrieve Stored Form Templates: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/retrieve-stored-form-templates-1ff85ee.md
- Runtime API for ADS Rendering Calls: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/runtime-api-for-ads-rendering-calls-3d8686d.md
- RAP Data Services for Print Forms: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/rap-data-services-for-print-forms-a104660.md
- PDF Merger API: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/pdf-merger-api-57013a7.md
- Class and Interface of the PDF Merger API: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/class-and-interface-of-the-pdf-merger-api-f647ef4.md
- Maintain Print Queues: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/maintain-print-queues-9dd6f64.md
- SAP-samples/abap-platform-reuse-services (Adobe Forms Service sample): https://github.com/SAP-samples/abap-platform-reuse-services
