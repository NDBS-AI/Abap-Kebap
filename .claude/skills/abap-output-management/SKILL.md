---
name: abap-output-management
description: "Use when ABAP Cloud code must produce output for people — sending email with the BCS mail API (cl_bcs_mail_message recipients, HTML/plain body parts, binary attachments, send vs send_async and the COMMIT WORK dependency); creating and rendering email templates (ADT editor, CDS-backed placeholders, cl_smtg_email_templ_renderer); knowing the SMTP configuration boundary (communication arrangement SAP_COM_0548, allowlists via cl_bcs_mail_system_config); printing through print queues (cl_print_queue_utils); rendering Adobe/ADS print forms from XDP templates (cl_fp_ads_util, cl_fp_form_reader, RAP form data via cl_fp_fdp_services); and merging PDFs (cl_rspo_pdf_merger). Triggers include send an email from ABAP, email template, email attachment, send_async, cl_bcs_mail_message, print a PDF, print queue, adobe form, ADS rendering, XDP form template, form data provider, merge PDF files, SAP_COM_0548, Monitor Email Transmissions, and output management in ABAP Cloud."
---

# ABAP Output Management — Email, Print Queues, ADS Print Forms, PDF Merger

## Overview

A guide to producing human-facing output from ABAP Cloud (SAP BTP ABAP environment / S/4HANA Cloud ABAP environment). Four released building blocks cover the space:

- **BCS mail API (`cl_bcs_mail_message`)** — the current email API of component `BC-SRV-COM`. Sends via SMTP (RFC 822 / RFC 5322 compliant), synchronously with `send( )` or decoupled with `send_async( )`. Older mail APIs (classic `cl_bcs`, `SO_*` function modules) are explicitly not recommended anymore.
- **Email templates (`cl_smtg_email_templ_renderer`)** — transportable ADT development objects with HTML + plain-text bodies and placeholders bound to a CDS view. At runtime the renderer selects the CDS data by key and fills subject and body into a `cl_bcs_mail_message` instance — standardized, translatable mass mailing.
- **Print queues (`cl_print_queue_utils`) + ADS print forms (`cl_fp_ads_util`)** — printing in the cloud goes through print queues, which local printers consume via SAP Cloud Print Manager. The Adobe Document Services (ADS) render an XDP form template plus XML data into a PDF (`render_pdf`) or directly into the print format a queue expects (`render_4_pq`). Form data comes from a RAP service definition via `cl_fp_fdp_services`; uploaded templates are read with `cl_fp_form_reader`.
- **PDF merger (`cl_rspo_pdf_merger`)** — merges several PDF files into one, preserving page order of the sources.

**Core principle:** output is *external communication* — it does not belong in the interaction phase of a transaction. Send email and render forms after (or during) the save, never inside a RAP action or determination handler; long-running rendering belongs in a background unit (see [abap-sap-luw](../abap-sap-luw/SKILL.md) and [abap-background-processing](../abap-background-processing/SKILL.md)).

## Workflow

1. **Pick the channel** with the decision guide below (plain email vs template email vs print vs PDF).
2. **Email path:** verify the SMTP communication arrangement (`SAP_COM_0548`) exists — that is admin territory, not code. Build the message with `cl_bcs_mail_message=>create_instance( )`: sender, recipients, subject, main body part, attachments. For recurring business mails, create an email template in ADT and render it with `cl_smtg_email_templ_renderer` instead of concatenating HTML in code.
3. **Decide sync vs async:** `send( )` transmits synchronously and returns status information; `send_async( )` registers a background send that only starts when the surrounding transaction issues `COMMIT WORK`. In RAP, that means: trigger the mail from the save phase and let the RAP framework's commit release it.
4. **Print path:** design the XDP template (Adobe LiveCycle Designer, downloadable via the *Install Additional Software* app), upload it (ADT *Working with Forms* or the SAP Forms Service template store), expose the business data as a RAP service definition, then at runtime: `cl_fp_fdp_services` → XML data, `cl_fp_form_reader` → XDP layout, `cl_fp_ads_util=>render_pdf` / `render_4_pq` → document, `cl_print_queue_utils=>create_queue_item_by_data` → queue item.
5. **Offload rendering:** ADS calls are remote round trips. From a RAP BO, set a marker in the action, start a bgPF operation in `save_modified`, render there, and write the PDF back via EML — the pattern of the SAP reuse-services sample.
6. **Post-process:** combine cover sheets, annexes, or per-item PDFs with `cl_rspo_pdf_merger` before mailing or printing the result.
7. **Monitor:** emails in the Fiori app *Monitor Email Transmissions* (send a test mail from there, too); print items in *Maintain Print Queues* (statuses *New*, *Failed*, *Transmitted*, *Successful*, *Warning*).

### Decision guide — email vs template vs print vs PDF

| Requirement | Pick |
|---|---|
| One-off notification, layout built in code | `cl_bcs_mail_message` + `cl_bcs_mail_textpart=>create_text_html` |
| Recurring, standardized, translated business email (order confirmation, reminder) | Email template (ADT) + `cl_smtg_email_templ_renderer` |
| Email with generated files attached (PDF, XML, ZIP) | `cl_bcs_mail_message` + `cl_bcs_mail_binarypart` |
| Mail triggered by a RAP transaction, sent only if the save succeeds | Build in save phase + `send_async( )` (starts on `COMMIT WORK`) |
| Formatted document for screen download or as attachment | ADS `cl_fp_ads_util=>render_pdf` → xstring PDF |
| Paper output on a customer's printer | `render_4_pq` (or `render_pdf`) → `cl_print_queue_utils=>create_queue_item_by_data` → SAP Cloud Print Manager pulls the queue |
| One document from several PDFs (cover + form + annex) | `cl_rspo_pdf_merger` |
| Validate an address before using it | `cl_mail_address=>create_instance( ... )->validate( )` (RFC 5322 syntax check) |
| Restrict who may receive/send system mail, default sender | `cl_bcs_mail_system_config` (system customizing, not application code) |

## Sending email — cl_bcs_mail_message

The complete documented surface, from the SAP BTP "Sending Mails Using SMTP" page:

```abap
TRY.
    DATA(lo_mail) = cl_bcs_mail_message=>create_instance( ).
    lo_mail->set_sender( 'noreply@yourcompany.com' ).
    lo_mail->add_recipient( 'recipient1@yourcompany.com' ).
    lo_mail->add_recipient( iv_address = 'recipient2@yourcompany.com'
                            iv_copy    = cl_bcs_mail_message=>cc ).
    lo_mail->set_subject( 'Order confirmation' ).
    lo_mail->set_importance( cl_bcs_mail_message=>importance-low ).
    lo_mail->set_sensitivity( cl_bcs_mail_message=>sensitivity-confidential ).
    lo_mail->set_main( cl_bcs_mail_textpart=>create_text_html(
        '<h1>Hello</h1><p>Your order was created.</p>' ) ).
    lo_mail->add_attachment( cl_bcs_mail_textpart=>create_text_plain(
        iv_content  = 'Plain text attachment'
        iv_filename = 'info.txt' ) ).

    DATA(lo_status_monitor) = lo_mail->send( ).
    lo_status_monitor->get_email_status(
      IMPORTING es_mail_status         = DATA(ls_mail_status)
                et_recipients_statuses = DATA(lt_recipient_statuses) ).
  CATCH cx_bcs_mail INTO DATA(lo_mail_error).
    " handle / report — never swallow silently
ENDTRY.
```

Key points:

- `send( )` transmits **synchronously** through the mail server configured in the destination (via cloud connector where applicable). It returns an `if_bcs_mail_status_monitor` instance; the same statuses are also available as exporting parameters. The ABAP cheat sheets show the variant `mail->send( IMPORTING et_status = DATA(lt_status_table) )` with status values `E` (error), `S` (sent), `W` (waiting) — both forms appear in SAP material, so check the released signature in your system.
- Typed constants live on the class: `cl_bcs_mail_message=>ty_address`, `tyt_recipient`, `cc`, `importance-*`, `sensitivity-*`.
- `set_additional_mime_headers( )` adds custom MIME headers — but `Date`, `Message-ID`, `Content-Type`, and any header that has its own set-method are **not allowed**, and SAP disclaims responsibility for issues caused by nonstandard headers.
- Everything raises `cx_bcs_mail`.
- Address syntax can be pre-validated with `cl_mail_address=>create_instance( iv_address_string = ... )->validate( )` (interface `if_mail_address`, RFC 5322).

### Body parts — main, alternatives, attachments

A message consists of MIME body parts:

| Part | Method | Notes |
|---|---|---|
| Main body (required) | `set_main( ... )` | Exactly one; typically HTML |
| Alternative representation | `add_main_alternative( ... )` | e.g. plain-text fallback of an HTML main part for text-only clients |
| Attachment | `add_attachment( ... )` | Files attached to the mail |

Part factories:

| Factory | Use for |
|---|---|
| `cl_bcs_mail_textpart=>create_text_plain( iv_content, iv_filename )` | Plain text |
| `cl_bcs_mail_textpart=>create_text_html( ... )` | HTML |
| `cl_bcs_mail_textpart=>create_instance( iv_content, iv_content_type, iv_filename )` | Any other text content type (e.g. `text/xml`) |
| `cl_bcs_mail_binarypart=>create_instance( iv_content, iv_content_type, iv_filename )` | Binary content — `iv_content` is an `xstring` (PDF, ZIP, images) |

The rendered ADS PDF (an `xstring`) plugs straight into `cl_bcs_mail_binarypart=>create_instance( iv_content_type = 'application/pdf' ... )`.

### send_async — the LUW interaction

`send_async( )` exists for transactional contexts (RAP and others): external communication is slow, and you usually want the mail to go out only when the transaction commits.

```abap
TRY.
    DATA(lo_mail) = cl_bcs_mail_message=>create_instance( ).
    lo_mail->set_sender( 'noreply@yourcompany.com' ).
    lo_mail->add_recipient( 'recipient1@yourcompany.com' ).
    " ... subject, main part ...
    lo_mail->send_async( ).
  CATCH cx_bcs_mail INTO DATA(lo_mail_error).
    " handle
ENDTRY.
```

- `send_async( )` triggers a **background process** that performs the actual transmission.
- **Caution (verbatim from SAP):** the process must call `COMMIT WORK` at the end of the transaction, otherwise the background process never starts and the email stays in status **Waiting** in *Monitor Email Transmissions*.
- In a RAP BO this maps cleanly onto the save phase: call `send_async( )` in `save_modified` / the unmanaged save, and the RAP framework's own `COMMIT WORK` releases the send. Calling it in the interaction phase couples output to a transaction that may still roll back — see [abap-sap-luw](../abap-sap-luw/SKILL.md).
- A status monitor is returned by `send_async( )` too, or can be created later with `cl_bcs_mail_message=>create_mail_status_monitor( )`; `if_bcs_mail_status_monitor` reports the overall status plus per-recipient SMTP responses.

## Email templates — CDS-backed, edited in ADT

An email template is a **transportable development object** (created with the ADT Email Template editor) holding a subject, an HTML body, and a plain-text body. Placeholders in subject and body correspond to **fields of a referenced CDS view**; at runtime they are replaced with values read via the key you pass in. That enables personalized mass mail without string surgery.

Documented constraints on the CDS view:

- It must be **released for cloud development** or live in the same package as the calling API.
- It must be flagged as usable for email templates via the supported-capabilities / modeling-pattern annotation **`OUTPUT_EMAIL_DATA_PROVIDER`**.
- The template must be active — not inactive, deprecated, or obsolete.

Editor facilities: *Edit* for both bodies (with import/export), *Tidy HTML*, transport assignment, and translations via the Fiori app *Maintain Translations* (ADT shows only the original language). Predelivered templates can also be copied in the Fiori app *Maintain Email Templates*. The docs do not spell out the literal placeholder syntax — insert placeholders through the editor rather than guessing a delimiter convention.

## Email template rendering — cl_smtg_email_templ_renderer

The renderer fills subject and content of an existing mail request from the template:

```abap
DATA lt_data_keys TYPE if_smtg_email_template=>ty_gt_data_key.

TRY.
    DATA(lo_mail) = cl_bcs_mail_message=>create_instance( ).
    lo_mail->set_sender( 'noreply@yourcompany.com' ).
    lo_mail->add_recipient( 'recipient@yourcompany.com' ).

    DATA(lo_template_renderer) = cl_smtg_email_templ_renderer=>create_instance(
        iv_template_id = 'ZOM_ORDER_CONFIRMATION' ).

    lt_data_keys = VALUE #( ( name = 'SalesOrderId' value = lv_order_id ) ).

    lo_template_renderer->render_email_message(
        io_message  = lo_mail
        iv_language = sy-langu
        it_data_key = lt_data_keys ).

    lo_mail->send( ).
  CATCH cx_bcs_mail cx_smtg_email_common INTO DATA(lo_render_error).
    " handle
ENDTRY.
```

- The renderer selects the field values **from the template's CDS view** using the key values in `it_data_key` (type `if_smtg_email_template=>ty_gt_data_key`, name/value pairs of the CDS key fields).
- `iv_language` picks the template translation.
- Errors raise `cx_smtg_email_common` (mail assembly still raises `cx_bcs_mail`).
- The instance interface is `if_smtg_email_templ_renderer`; only `render_email_message` is documented — don't invent further methods.

## SMTP configuration — what is code and what is not

Sending mail from code presupposes admin-side configuration. Keep the boundary straight:

| Concern | Where it lives |
|---|---|
| SMTP server host/port, cloud connector on/off, SCC location ID, OAuth 2.0 token endpoint | **Communication system** (admin) |
| Activating outbound email | **Communication arrangement for scenario `SAP_COM_0548`** referencing that system (admin) |
| Test mail, transmission monitoring | Fiori app *Monitor Email Transmissions* (read-only; has a *Send Testmail* button) |
| Sender/recipient allowlists, default sender, mail expiry | `cl_bcs_mail_system_config` — but run as **system customizing**, never in the same session as an email send |
| Building and sending the message | Your code: `cl_bcs_mail_message`, templates, renderer |

`cl_bcs_mail_system_config` (exceptions: `cx_bcs_mail_config`) provides `set_address_check_active( abap_true )`, `add_allowed_recipient_domains( )`, `add_allowed_sender_domains( )` (a `'*'` entry allows all), `modify_default_sender_address( )`, matching `read_*`/`delete_*` methods, and `set_days_until_mail_expires( )` (default 30 days). When the check is active and no sender was set, the default sender is used — otherwise a missing sender can fail the send. If an address is not on the allowlist, the mail is not sent and does not even appear in the monitoring app. Details in [references/email-and-templates.md](references/email-and-templates.md).

## Printing — print queues and cl_print_queue_utils

Cloud printing is queue-based: code puts finished documents into a **print queue**; SAP Cloud Print Manager (or another pull client) fetches and prints them. Queues are created and monitored in the Fiori app *Maintain Print Queues*; connecting local printers uses communication scenarios `SAP_COM_0466`/`SAP_COM_0467`.

The documented API is `cl_print_queue_utils=>create_queue_item_by_data`:

| Parameter | Meaning |
|---|---|
| `iv_qname` | Name of the (existing) print queue |
| `iv_print_data` | The document as `xstring` |
| `iv_name_of_main_doc` | Name of the main document |
| `iv_number_of_copies` | Number of copies |
| `iv_pages` | Number of pages |
| `it_attachment_data` | Attachments — name + `xstring` data per row |
| `rv_itemid` (returning) | ID of the created queue item |
| `ev_err_msg` (exporting) | Error messages on failure |

One queue item = one main document + any number of attachments. The docs describe only this method of the class — treat other methods as unverified. Check `rv_itemid`/`ev_err_msg` instead of assuming success; the queue name must exist beforehand (admin-created).

## ADS print forms — templates, data, rendering

The Adobe Document Services (ADS) rendering capability turns **Adobe XML Forms (XFA/XDP)** plus **XML data** into PDF or other print formats. Your application sends template + data over a secure connection; ADS returns the rendered document for screen output or the print queue. Three released classes form the call path:

1. **Data — `cl_fp_fdp_services`** ("RAP Data Services for Print Forms"). Expose the form data as a RAP **service definition** (no service binding needed). Then:
   ```abap
   DATA(lo_form_data_provider) = cl_fp_fdp_services=>get_instance( `ZOM_SALESORDER_FORM` ).
   DATA(lt_selection_keys) = lo_form_data_provider->get_keys( ).
   lt_selection_keys[ name = 'SALESORDERID' ]-value = lv_sales_order_id.
   DATA(lv_form_xml_data) = lo_form_data_provider->read_to_xml_v2( lt_selection_keys ).
   ```
   `get_xsd_v2( )` returns the XML Schema (XSD) that the form designer binds against. For **draft-enabled** services, `IsActiveEntity` defaults to false — pass `it_select_add` with `name = 'IsActiveEntity' value = 'X'` to read active data. Errors raise `cx_fp_fdp_error`. (The reuse-services sample calls `read_to_xml`/`get_xsd` without the `_v2` suffix; the current documentation describes the `_v2` methods — prefer those and verify in your release.)
2. **Template — `cl_fp_form_reader`**. XDP templates designed in *Adobe LiveCycle Designer* (download via *Install Additional Software*) and uploaded in ADT (*Working with Forms*) are read at runtime: `cl_fp_form_reader=>create_form_reader( 'MY_FORM' )` then `get_layout( )` → XDP as `xstring` (plus `get_fdp_name`, `get_data_optimized`, `get_font_embed`). Alternatively, the SAP-samples reuse-services repo pulls templates from the SAP Forms Service **template store** via a custom HTTP client and a communication arrangement — a valid pattern when templates are managed outside the ABAP system.
3. **Rendering — `cl_fp_ads_util`** (errors raise `cx_fp_ads_util`):
   - `render_pdf( iv_xml_data, iv_xdp_layout, iv_locale, is_options )` → `ev_pdf`, `ev_pages`, `ev_trace_string`.
   - `render_4_pq( iv_xml_data, iv_xdp_layout, iv_locale, iv_pq_name, is_options )` → `ev_pdl` (in the Page Description Language the queue's printer expects, taken from the print queue properties), `ev_pages`, `ev_trace_string`.
   - `iv_locale` uses `language_COUNTRY` format, e.g. `'en_US'`. `is_options` holds optional rendering parameters (the sample sets `trace_level = 4` for debugging — use `0` in production).

### The reuse-services sample pattern — RAP action → bgPF → ADS → EML

The SAP sample (https://github.com/SAP-samples/abap-platform-reuse-services) shows the realistic end-to-end wiring for "Create PDF" on a sales order:

1. A RAP **action** only sets a marker (`Description = 'PDF generation started'`) — no rendering in the interaction phase.
2. The saver class's `save_modified` collects the marked keys and registers a **bgPF uncontrolled operation** (`cl_bgmc_process_factory=>get_default( )->create( )` + `set_operation_tx_uncontrolled( ... )` + `save_for_execution( )`) — see [abap-background-processing](../abap-background-processing/SKILL.md).
3. The bgPF operation (implements `if_bgmc_op_single_tx_uncontr` because it must `COMMIT ENTITIES` itself) fetches the XDP template, gets XML data from `cl_fp_fdp_services`, calls `cl_fp_ads_util=>render_pdf`, and writes the PDF, filename, and MIME type (`application/pdf`) back onto the entity with `MODIFY ENTITIES` + `COMMIT ENTITIES`.
4. The Fiori app shows the PDF as an attachment field (large object) after refresh.

This keeps the slow remote ADS call out of both the user round trip and the original save LUW. The full walk-through is in [references/ads-print-forms.md](references/ads-print-forms.md); a Clean-ABAP version of the generator class is in [examples/zcl_form_pdf_generator.clas.abap](examples/zcl_form_pdf_generator.clas.abap).

## PDF Merger API — cl_rspo_pdf_merger

Merges several PDFs into one file containing all pages in the order the sources were added:

```abap
DATA(lo_pdf_merger) = cl_rspo_pdf_merger=>create_instance( ).
lo_pdf_merger->add_document( lv_cover_sheet_pdf ).
lo_pdf_merger->add_document( lv_order_form_pdf ).

TRY.
    DATA(lv_merged_pdf) = lo_pdf_merger->merge_documents( ).
  CATCH cx_rspo_pdf_merger INTO DATA(lo_merge_error).
    " lo_merge_error->document_index / error_code / error_text
ENDTRY.
```

- Interface `if_rspo_pdf_merger`; methods `create_instance` (static), `add_document( document )` (one call per source, `xstring`), `merge_documents( )` → merged `xstring`.
- `cx_rspo_pdf_merger` carries `DOCUMENT_INDEX` (which source failed), `ERROR_CODE`, `ERROR_TEXT`.
- Restrictions (documented): PDF files only; **no encrypted PDFs**; **no damaged PDFs** — any codepage conversion of the binary data corrupts a PDF. Further restrictions: SAP note 2264208.

## Quick Reference

| Task | API call |
|---|---|
| Create a mail | `cl_bcs_mail_message=>create_instance( )` |
| Sender / recipient / CC | `set_sender( ... )`, `add_recipient( ... )`, `add_recipient( iv_copy = cl_bcs_mail_message=>cc )` |
| HTML body | `set_main( cl_bcs_mail_textpart=>create_text_html( ... ) )` |
| Plain-text fallback | `add_main_alternative( cl_bcs_mail_textpart=>create_text_plain( ... ) )` |
| PDF/ZIP attachment | `add_attachment( cl_bcs_mail_binarypart=>create_instance( iv_content = xstring iv_content_type = ... iv_filename = ... ) )` |
| Send now (sync) | `send( )` → status monitor / `IMPORTING et_status` |
| Send on commit (async) | `send_async( )` — requires `COMMIT WORK` afterwards |
| Check send status | `if_bcs_mail_status_monitor->get_email_status( )`; app *Monitor Email Transmissions* |
| Validate an address | `cl_mail_address=>create_instance( iv_address_string = ... )->validate( )` |
| Render an email template | `cl_smtg_email_templ_renderer=>create_instance( iv_template_id = ... )->render_email_message( io_message = ... iv_language = ... it_data_key = ... )` |
| Template key table type | `if_smtg_email_template=>ty_gt_data_key` |
| Outbound allowlists / default sender | `cl_bcs_mail_system_config` (system customizing only) |
| Form data as XML | `cl_fp_fdp_services=>get_instance( service_definition )` → `get_keys( )` → `read_to_xml_v2( )` |
| XSD for form design | `cl_fp_fdp_services` → `get_xsd_v2( )` |
| Read uploaded XDP template | `cl_fp_form_reader=>create_form_reader( 'MY_FORM' )->get_layout( )` |
| Render PDF | `cl_fp_ads_util=>render_pdf( iv_xml_data iv_xdp_layout iv_locale is_options )` → `ev_pdf` |
| Render for a print queue | `cl_fp_ads_util=>render_4_pq( ... iv_pq_name = ... )` → `ev_pdl` |
| Put document into a queue | `cl_print_queue_utils=>create_queue_item_by_data( iv_qname iv_print_data iv_name_of_main_doc ... )` → `rv_itemid`, `ev_err_msg` |
| Merge PDFs | `cl_rspo_pdf_merger=>create_instance( )` → `add_document( ... )` × n → `merge_documents( )` |

## Common Mistakes

| Wrong | Right |
|---|---|
| Calling `send( )` / rendering ADS inside a RAP action or determination (interaction phase) | Set a marker in the action; do the output in the save phase (`save_modified`) or a bgPF operation started from it — see [rap-saves-and-numbering](../rap-saves-and-numbering/SKILL.md) and [abap-background-processing](../abap-background-processing/SKILL.md) |
| `send_async( )` and then no `COMMIT WORK` in the transaction | Ensure the transaction commits (in RAP the framework commits after the save sequence) — otherwise the mail hangs in status *Waiting* forever |
| Building recurring business mails by concatenating HTML in ABAP | Create an email template in ADT and render it with `cl_smtg_email_templ_renderer` — translated via *Maintain Translations*, maintained without code changes |
| Pointing an email template at an arbitrary CDS view | The view must be released (or same package) **and** carry the `OUTPUT_EMAIL_DATA_PROVIDER` capability annotation — the implementation checks reject it otherwise |
| Setting `Date`, `Message-ID`, or `Content-Type` via `set_additional_mime_headers( )` | Not allowed — use the dedicated set-methods; custom headers only when universally recognized |
| Using classic `cl_bcs` / `SO_*` mail APIs in new code | Use `cl_bcs_mail_message` — SAP explicitly recommends against the older mail APIs |
| Wondering why a mail neither arrives nor shows in *Monitor Email Transmissions* | Check the outbound address check: with allowlists active, non-allowed senders/recipients are dropped **without** appearing in the app (`cl_bcs_mail_system_config`) |
| Configuring allowlists in the same session that sends mail | The system-config API is customizing; SAP forbids setting it in a session together with any email outbound |
| Passing string/base64 data as a PDF, or converting PDF bytes through a codepage | Keep PDFs as `xstring` end to end — any byte-level conversion corrupts the file and the PDF merger raises `cx_rspo_pdf_merger` |
| Feeding encrypted PDFs to the merger | Documented restriction — the merger can't process them; check the file's Security properties first |
| Rendering with `iv_locale = 'DE'` | Documented locale format is `language_COUNTRY`, e.g. `'de_DE'` / `'en_US'` |
| Reading FDP data for a draft-enabled BO and getting draft/no data | `IsActiveEntity` defaults to false — pass `it_select_add = VALUE #( ( name = 'IsActiveEntity' value = 'X' ... ) )` to read active data |
| Shipping `trace_level = 4` in `is_options` to production | Use trace level `0` in production (sample's own comment) |
| Ignoring `ev_err_msg` from `create_queue_item_by_data` | Check `rv_itemid` and `ev_err_msg`; the queue must already exist in *Maintain Print Queues* |
| Treating SMTP setup as code | Host/port/OAuth/cloud connector live in a communication system + arrangement for `SAP_COM_0548` — code only builds and sends the message |

## References

- [references/email-and-templates.md](references/email-and-templates.md) — email deep dive: full `cl_bcs_mail_message` surface, body parts, status monitoring, address check, system outbound configuration, template editor and renderer details
- [references/ads-print-forms.md](references/ads-print-forms.md) — printing deep dive: print queue API and administration, ADS rendering parameters, form templates and readers, RAP form data provider, PDF merger interface, reuse-services sample walk-through
- [examples/zcl_email_notification.clas.abap](examples/zcl_email_notification.clas.abap) — Clean ABAP email sender: direct mail with PDF attachment, template-rendered mail, async send helper
- [examples/zcl_form_pdf_generator.clas.abap](examples/zcl_form_pdf_generator.clas.abap) — Clean ABAP form output: FDP data → XDP template → ADS render → print queue / merged PDF
- **Output Management (section root):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/output-management-87ea155.md
- **Printing (print queue item API):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/printing-754b6cd.md
- **Print Forms (ADS):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/print-forms-959664f.md
- **Retrieve Stored Form Templates:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/retrieve-stored-form-templates-1ff85ee.md
- **Runtime API for ADS Rendering Calls:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/runtime-api-for-ads-rendering-calls-3d8686d.md
- **RAP Data Services for Print Forms:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/rap-data-services-for-print-forms-a104660.md
- **PDF Merger API:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/pdf-merger-api-57013a7.md
- **Class and Interface of the PDF Merger API:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/class-and-interface-of-the-pdf-merger-api-f647ef4.md
- **Emailing:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/emailing-36b602d.md
- **Email Templates:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/email-templates-4f03fd5.md
- **Email Templates Editor:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/email-templates-editor-659df8d.md
- **Email Template Rendering:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/email-template-rendering-b11428e.md
- **Sending Mails Using SMTP:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/sending-mails-using-smtp-a3d3f38.md
- **Configuration of the System Email Outbound:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/configuration-of-the-system-email-outbound-26f9400.md
- **Email Address Check:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/email-address-check-578c4de.md
- **Integrating Outbound Emails Using SMTP (SAP_COM_0548):** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/integrating-outbound-emails-using-smtp-b880078.md
- **Maintain Print Queues:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/maintain-print-queues-9dd6f64.md
- **Monitor Email Transmissions:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/monitor-email-transmissions-8cf1ac9.md
- **SAP-samples/abap-platform-reuse-services** — Adobe Forms Service end-to-end sample (RAP action → bgPF → ADS render → EML update): https://github.com/SAP-samples/abap-platform-reuse-services
- **SAP-samples/abap-cheat-sheets — Released ABAP Classes** (`cl_bcs_mail_message` usage incl. ZIP attachments and `et_status`): https://github.com/SAP-samples/abap-cheat-sheets/blob/main/22_Released_ABAP_Classes.md
- Linked skills: [abap-sap-luw](../abap-sap-luw/SKILL.md), [abap-background-processing](../abap-background-processing/SKILL.md), [rap-saves-and-numbering](../rap-saves-and-numbering/SKILL.md), [abap-cloud-development](../abap-cloud-development/SKILL.md)
