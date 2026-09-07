# Email in ABAP Cloud — BCS Mail API, Templates, System Configuration

Deep dive companion to [../SKILL.md](../SKILL.md). Everything here is taken from the SAP BTP
documentation (SAP-docs mirror, links at the bottom), the SAP-samples reuse-services repository,
and the ABAP cheat sheets. Anything the sources do not state is marked as such.

## Scope and lineage

The SAP component `BC-SRV-COM` provides the current email APIs. They:

- use **SMTP** as the sending protocol,
- conform to **RFC 822** and **RFC 5322**,
- supersede older mail APIs (classic BCS `cl_bcs`, `SO_*` function modules). SAP: "The use of
  older mail APIs, which some SAP applications might still use, isn't recommended."

## cl_bcs_mail_message — documented surface

### Construction and envelope

| Method | Purpose |
|---|---|
| `create_instance( )` (static) | New mail request |
| `set_sender( ... )` | Sender address (`cl_bcs_mail_message=>ty_address`) |
| `add_recipient( iv_address [ iv_copy ] )` | Recipient; `iv_copy = cl_bcs_mail_message=>cc` for carbon copy (table type `tyt_recipient` exists for bulk handling) |
| `set_subject( ... )` | Subject line |
| `set_importance( cl_bcs_mail_message=>importance-... )` | e.g. `importance-low` |
| `set_sensitivity( cl_bcs_mail_message=>sensitivity-... )` | e.g. `sensitivity-confidential` |
| `set_additional_mime_headers( VALUE #( ( field_name = ... field_body = ... ) ) )` | Custom MIME headers — see restrictions below |

**MIME header restrictions (documented):** headers that can be set via dedicated set-methods,
plus `Date`, `Message-ID`, and `Content-Type`, are **not allowed** as additional headers. SAP
advises additional headers only if universally recognized and disclaims responsibility for
issues they cause.

All methods raise `cx_bcs_mail`.

### Body parts

A message = one **main** part + optional **alternatives** + optional **attachments**:

- `set_main( part )` — required. Typically HTML.
- `add_main_alternative( part )` — alternative representation of the main part; text-only
  clients fall back to it.
- `add_attachment( part )` — attached files.

Part factories:

| Factory | Content |
|---|---|
| `cl_bcs_mail_textpart=>create_text_plain( iv_content, iv_filename )` | `text/plain` |
| `cl_bcs_mail_textpart=>create_text_html( iv_content [, iv_filename ] )` | `text/html` |
| `cl_bcs_mail_textpart=>create_instance( iv_content, iv_content_type, iv_filename )` | Any text content type, e.g. `text/xml` |
| `cl_bcs_mail_binarypart=>create_instance( iv_content, iv_content_type, iv_filename )` | Binary — `iv_content` is `xstring` |

Realistic binary example from the ABAP cheat sheets (zipping generated files, then attaching):

```abap
mail->add_attachment( cl_bcs_mail_binarypart=>create_instance(
    iv_content      = zipped_file
    iv_content_type = 'application/x-zip-compressed'
    iv_filename     = 'abap_cheat_sheets.zip' ) ).
```

### Sending — synchronous

`send( )` transmits via the mail server configured in the destination (through the cloud
connector where configured). Two result styles appear in SAP material:

1. **BTP documentation:** `DATA(lo_status_monitor) = lo_mail->send( ).` — returns an
   `if_bcs_mail_status_monitor` instance; the send method "provides the same statuses as
   exporting parameters".
2. **ABAP cheat sheets / reuse-services sample:**
   `lo_mail->send( IMPORTING et_status = DATA(lt_status_table) ).` — per-recipient status table with
   status component values `E` (error), `S` (sent), `W` (waiting).

Both are SAP-published; the exact released signature can differ by release — check it in ADT
(released objects) rather than assuming one form.

### Sending — asynchronous (send_async)

Designed for RAP and other transactional contexts, for two documented reasons: external
communication is slow, and the mail should leave only when the transaction commits.

- `send_async( )` triggers a **background process** that transmits the mail.
- **Documented caution:** the surrounding process must issue `COMMIT WORK` at the end of the
  transaction; otherwise the background process never starts and the email remains in status
  **Waiting** in the Fiori app *Monitor Email Transmissions*.
- RAP placement: build + `send_async( )` in the save phase (`save_modified` / unmanaged save);
  the RAP framework's commit after the save sequence releases the send. Never in the
  interaction phase — a later validation failure would roll back the business data while the
  mail logic already ran.

### Status monitoring

`if_bcs_mail_status_monitor` reports the email status and per-recipient statuses including the
SMTP response. Obtain an instance:

- as the return value of `send( )` or `send_async( )`, or
- later via `cl_bcs_mail_message=>create_mail_status_monitor( )`.

```abap
lo_status_monitor->get_email_status(
  IMPORTING es_mail_status         = DATA(ls_mail_status)
            et_recipients_statuses = DATA(lt_recipient_statuses) ).
```

The Fiori app *Monitor Email Transmissions* is the admin-facing counterpart: read-only list of
all outgoing email requests, header + sending status per request, spreadsheet export, and a
*Send Testmail* button to verify the outbound channel.

### Address validation

`cl_mail_address` (interface `if_mail_address`) checks RFC 5322 syntax:

```abap
TRY.
    DATA(lo_mail_address) = cl_mail_address=>create_instance(
        iv_address_string = 'someone@example.com' ).
    DATA(lv_address_is_valid) = lo_mail_address->validate( ).
  CATCH cx_bcs_mail INTO DATA(lo_address_error).
    " handle
ENDTRY.
```

## Email templates

### The development object

- Created in the **ADT Email Template editor**; transportable.
- Contains subject, **Body HTML**, and **Body Plain Text**; placeholders map to **fields of a
  referenced CDS view** and are replaced at runtime using the key values passed to the
  renderer. This enables personalized mass distribution.
- Editor actions: *Edit* (with import/export of the text fields), *Tidy HTML* (shows current
  vs tidied HTML side by side), transport assignment (auto-generated transport possible).
- **Translations** are maintained in the Fiori app *Maintain Translations*; ADT shows only the
  original object language.
- Predelivered templates can be copied in the Fiori app *Maintain Email Templates*.
- The documentation does not specify the literal placeholder delimiter syntax — insert
  placeholders via the editor UI.

### Implementation checks on the CDS view

The referenced CDS view must:

1. be **released for use in cloud development**, or live in the **same package** as the
   calling API;
2. be marked for email templates via the supported-capabilities / modeling-pattern annotation
   **`OUTPUT_EMAIL_DATA_PROVIDER`**.

The template itself must be **active** (not inactive, deprecated, or obsolete).

### Runtime rendering — cl_smtg_email_templ_renderer

```abap
DATA lt_data_keys TYPE if_smtg_email_template=>ty_gt_data_key.

TRY.
    DATA(lo_mail) = cl_bcs_mail_message=>create_instance( ).
    lo_mail->set_sender( 'noreply@yourcompany.com' ).
    lo_mail->add_recipient( 'recipient@yourcompany.com' ).

    DATA(lo_template_renderer) = cl_smtg_email_templ_renderer=>create_instance(
        iv_template_id = 'YOUR_TEMPLATE_ID' ).

    lt_data_keys = VALUE #( ( name = 'Key_field1' value = 'Key_value1' ) ).

    lo_template_renderer->render_email_message(
        io_message  = lo_mail
        iv_language = sy-langu
        it_data_key = lt_data_keys ).

    lo_mail->send( ).
  CATCH cx_bcs_mail cx_smtg_email_common INTO DATA(lo_mail_error).
    " handle
ENDTRY.
```

Facts:

- `create_instance( iv_template_id = ... )` returns `if_smtg_email_templ_renderer`.
- `render_email_message( io_message, iv_language, it_data_key )` selects the field values from
  the template's CDS view **according to the key values** in `it_data_key`
  (`if_smtg_email_template=>ty_gt_data_key`, name/value rows naming the CDS key fields), then
  sets subject and content on the passed mail message.
- `iv_language` selects the translated variant.
- Exceptions: `cx_smtg_email_common` (rendering), `cx_bcs_mail` (mail assembly).
- Only `render_email_message` is documented on the renderer — treat any other method name as
  unverified.
- Prerequisite: an active email template created in ADT or copied from a predelivered one in
  *Maintain Email Templates*.

## System email outbound configuration — cl_bcs_mail_system_config

This API is **system customizing**. Documented rule: "It's not allowed to set the
configuration in a session together with any email outbound." Exceptions raise
`cx_bcs_mail_config`.

### Outbound address check

- `set_address_check_active( abap_true | abap_false )` — activates/deactivates the sender +
  recipient check; **inactive by default**.
- When active, addresses are checked at send time against two allow tables. If an address does
  not match, the email **is not sent and is not displayed** in the monitoring app.
- `add_allowed_recipient_domains( )` / `add_allowed_sender_domains( )` — fill the allow tables
  with domains or full addresses (types `tyt_recipient_domains` / `tyt_sender_domains` on the
  class). A `'*'` row allows all senders or recipients.
- Read/delete counterparts: `read_allowed_recipient_domains( )`,
  `read_allowed_sender_domains( )`, `delete_allowed_rec_domains( )`,
  `delete_allowed_sender_domains( )`.

### Default sender

- `modify_default_sender_address( iv_default_address = ... iv_default_name = ... )` — used
  whenever an outgoing mail has no sender set. Only **one default sender per system**.
- If no default sender is maintained and none is set on the mail, the sender falls back to
  `do.not.reply@(system-default-domain)`.
- The default sender applies **only while the outbound check is active**; otherwise a missing
  sender can make the mail fail.
- Read/delete: `read_default_sender_address( )`, `delete_default_sender_addr( )`.

### Expiry

- `set_days_until_mail_expires( )` — default **30 days**; after expiry, sent and failed
  attempts disappear from *Monitor Email Transmissions*.
- `delete_days_until_mail_expires( )` resets to 30 days.

### Upload Business Configuration entities

`SMAIL_VM_DF_ADDR` (default sender), `SMAIL_VM_RCV_DOM` (recipient domains),
`SMAIL_VM_SND_DOM` (sender domains) can be maintained via the *Upload Business Configuration*
app instead of the API.

## The configuration boundary — admin vs code

| Step | Who / where |
|---|---|
| Communication system: SMTP host, port, cloud connector flag, *SCC Location ID* (several cloud connectors per subaccount), OAuth 2.0 token endpoint + outbound user | Administrator |
| Communication arrangement for scenario **`SAP_COM_0548`** (OAuth: authorized user as additional property, provider scope such as `https://outlook.office365.com/.default` under *Additional Scopes*) | Administrator |
| Smoke test via *Monitor Email Transmissions* → *Send Testmail* | Administrator |
| Allowlists / default sender / expiry (`cl_bcs_mail_system_config`) | System customizing (not application sessions) |
| Message construction, template rendering, `send` / `send_async` | Application code |

Two ways to connect the SMTP server are documented: a **publicly available server** (host,
port, cloud connector disabled) or an **internal server via cloud connector** (host, port,
cloud connector enabled, optional SCC location ID).

## Sources

- Emailing: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/emailing-36b602d.md
- Sending Mails Using SMTP: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/sending-mails-using-smtp-a3d3f38.md
- Email Templates: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/email-templates-4f03fd5.md
- Email Templates Editor: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/email-templates-editor-659df8d.md
- Email Template Rendering: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/email-template-rendering-b11428e.md
- Configuration of the System Email Outbound: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/configuration-of-the-system-email-outbound-26f9400.md
- Email Address Check: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/email-address-check-578c4de.md
- Integrating Outbound Emails Using SMTP: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/integrating-outbound-emails-using-smtp-b880078.md
- Monitor Email Transmissions: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/50-administration-and-ops/monitor-email-transmissions-8cf1ac9.md
- ABAP cheat sheets, Released ABAP Classes (`cl_bcs_mail_message`, `cl_bcs_mail_textpart`, `cl_bcs_mail_binarypart` usage): https://github.com/SAP-samples/abap-cheat-sheets/blob/main/22_Released_ABAP_Classes.md
- Reuse-services sample (email test class): https://github.com/SAP-samples/abap-platform-reuse-services
