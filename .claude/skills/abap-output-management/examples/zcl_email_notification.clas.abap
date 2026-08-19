"! <p class="shorttext synchronized">Email notifications via the BCS mail API (ABAP Cloud)</p>
"! Demonstrates the documented cl_bcs_mail_message surface:
"! - direct mail with HTML main part, plain-text alternative, PDF attachment
"! - email-template-rendered mail (cl_smtg_email_templ_renderer)
"! - asynchronous send for transactional (RAP) contexts
"!
"! Sources:
"! - https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/sending-mails-using-smtp-a3d3f38.md
"! - https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/email-template-rendering-b11428e.md
"! - https://github.com/SAP-samples/abap-cheat-sheets/blob/main/22_Released_ABAP_Classes.md
CLASS zcl_email_notification DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    TYPES sales_order_id TYPE c LENGTH 10.

    "! Sends an order confirmation with the rendered PDF attached.
    "! Synchronous send - use only outside user round trips.
    METHODS send_confirmation_with_pdf
      IMPORTING sales_order    TYPE sales_order_id
                order_pdf      TYPE xstring
                recipient      TYPE cl_bcs_mail_message=>ty_address
      RETURNING VALUE(is_sent) TYPE abap_bool
      RAISING   cx_bcs_mail.

    "! Renders the mail body and subject from an ADT email template.
    "! The template's CDS view is read with the given key values.
    METHODS send_from_template
      IMPORTING template_id TYPE string
                sales_order TYPE sales_order_id
                recipient   TYPE cl_bcs_mail_message=>ty_address
      RAISING   cx_bcs_mail
                cx_smtg_email_common.

    "! Registers an asynchronous send. The mail leaves only when the
    "! surrounding transaction issues COMMIT WORK - in RAP, call this
    "! from the save phase and let the framework's commit release it.
    "! Until then the mail shows as "Waiting" in Monitor Email Transmissions.
    METHODS send_async_on_commit
      IMPORTING sales_order TYPE sales_order_id
                recipient   TYPE cl_bcs_mail_message=>ty_address
      RAISING   cx_bcs_mail.

  PRIVATE SECTION.
    CONSTANTS sender_address TYPE cl_bcs_mail_message=>ty_address
      VALUE 'noreply@yourcompany.com'.

    METHODS create_base_message
      IMPORTING recipient      TYPE cl_bcs_mail_message=>ty_address
      RETURNING VALUE(message) TYPE REF TO cl_bcs_mail_message
      RAISING   cx_bcs_mail.
ENDCLASS.


CLASS zcl_email_notification IMPLEMENTATION.

  METHOD create_base_message.
    message = cl_bcs_mail_message=>create_instance( ).
    message->set_sender( sender_address ).
    message->add_recipient( recipient ).
  ENDMETHOD.

  METHOD send_confirmation_with_pdf.
    DATA(message) = create_base_message( recipient ).

    message->set_subject( |Order confirmation { sales_order }| ).

    " Main part: HTML. Alternative: plain text for text-only clients.
    message->set_main( cl_bcs_mail_textpart=>create_text_html(
        |<h1>Thank you!</h1><p>Your order { sales_order } was created.</p>| ) ).
    message->add_main_alternative( cl_bcs_mail_textpart=>create_text_plain(
        iv_content = |Thank you! Your order { sales_order } was created.| ) ).

    " Binary attachment: the rendered ADS PDF, kept as xstring end to end.
    message->add_attachment( cl_bcs_mail_binarypart=>create_instance(
        iv_content      = order_pdf
        iv_content_type = 'application/pdf'
        iv_filename     = |order_{ sales_order }.pdf| ) ).

    " Synchronous send; the status monitor reports overall and
    " per-recipient statuses including the SMTP response.
    DATA(status_monitor) = message->send( ).
    status_monitor->get_email_status(
      IMPORTING es_mail_status         = DATA(mail_status)
                et_recipients_statuses = DATA(recipient_statuses) ).

    " Per the ABAP cheat sheets, recipient statuses use
    " E (error), S (sent), W (waiting).
    is_sent = xsdbool( NOT line_exists( recipient_statuses[ status = 'E' ] ) ).
  ENDMETHOD.

  METHOD send_from_template.
    DATA(message) = create_base_message( recipient ).

    DATA(template_renderer) = cl_smtg_email_templ_renderer=>create_instance(
        iv_template_id = template_id ).

    " Key values of the template's CDS view; the renderer selects the
    " row and replaces the placeholders in subject and both bodies.
    DATA(data_keys) = VALUE if_smtg_email_template=>ty_gt_data_key(
        ( name = 'SalesOrderId' value = sales_order ) ).

    template_renderer->render_email_message(
        io_message  = message
        iv_language = sy-langu
        it_data_key = data_keys ).

    message->send( ).
  ENDMETHOD.

  METHOD send_async_on_commit.
    DATA(message) = create_base_message( recipient ).

    message->set_subject( |Order { sales_order } saved| ).
    message->set_main( cl_bcs_mail_textpart=>create_text_html(
        |<p>Order { sales_order } was saved successfully.</p>| ) ).

    " Registers a background send. Documented caution: without a
    " COMMIT WORK at the end of the transaction the background process
    " never starts. In a RAP BO, call this method in save_modified /
    " the additional save - never in an action or determination.
    message->send_async( ).
  ENDMETHOD.

ENDCLASS.
