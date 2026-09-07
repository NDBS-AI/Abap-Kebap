"! <p class="shorttext synchronized">ADS print form output (ABAP Cloud)</p>
"! End-to-end form output modeled on the SAP reuse-services sample:
"! - XML data from a RAP service definition (cl_fp_fdp_services)
"! - XDP layout of a template uploaded via ADT (cl_fp_form_reader)
"! - ADS rendering to PDF (cl_fp_ads_util=>render_pdf) and to the
"!   print queue format (render_4_pq + cl_print_queue_utils)
"! - merging with a cover sheet (cl_rspo_pdf_merger)
"!
"! Call this from a bgPF operation or application job, never from a
"! RAP action handler: ADS rendering is a remote round trip.
"!
"! Sources:
"! - https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/runtime-api-for-ads-rendering-calls-3d8686d.md
"! - https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/rap-data-services-for-print-forms-a104660.md
"! - https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/retrieve-stored-form-templates-1ff85ee.md
"! - https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/printing-754b6cd.md
"! - https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/pdf-merger-api-57013a7.md
"! - https://github.com/SAP-samples/abap-platform-reuse-services
CLASS zcl_form_pdf_generator DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    TYPES ty_sales_order_id TYPE c LENGTH 10.

    METHODS constructor
      RAISING cx_fp_fdp_error.

    "! Renders the sales-order form to a PDF xstring
    "! (for screen download, mail attachment, or archiving).
    METHODS render_order_pdf
      IMPORTING iv_sales_order         TYPE ty_sales_order_id
      RETURNING VALUE(rv_rendered_pdf) TYPE xstring
      RAISING   cx_fp_fdp_error
                cx_fp_ads_util.

    "! Renders in the queue's print format and creates a queue item.
    "! The print queue must already exist (Maintain Print Queues app).
    METHODS print_order
      IMPORTING iv_sales_order          TYPE ty_sales_order_id
                iv_print_queue_name     TYPE string
      RETURNING VALUE(rv_queue_item_id) TYPE string
      RAISING   cx_fp_fdp_error
                cx_fp_ads_util.

    "! Prepends a cover sheet to the rendered order PDF.
    METHODS merge_with_cover_sheet
      IMPORTING iv_cover_sheet_pdf   TYPE xstring
                iv_order_pdf         TYPE xstring
      RETURNING VALUE(rv_merged_pdf) TYPE xstring
      RAISING   cx_rspo_pdf_merger.

  PRIVATE SECTION.
    CONSTANTS c_form_service_definition
      TYPE if_fp_fdp_api=>ty_service_definition VALUE 'ZOM_SALESORDER_FORM'.
    CONSTANTS c_form_template_name TYPE string VALUE `ZOM_SALESORDER_FORM`.
    CONSTANTS c_rendering_locale TYPE string VALUE `en_US`.

    DATA mo_form_data_provider TYPE REF TO if_fp_fdp_api.
    DATA mv_xdp_layout TYPE xstring.

    METHODS read_form_data_as_xml
      IMPORTING iv_sales_order          TYPE ty_sales_order_id
      RETURNING VALUE(rv_form_xml_data) TYPE xstring
      RAISING   cx_fp_fdp_error.
ENDCLASS.


CLASS zcl_form_pdf_generator IMPLEMENTATION.

  METHOD constructor.
    " Data side: the form data provider works on a RAP service
    " definition - no service binding is needed for FDP usage.
    mo_form_data_provider = cl_fp_fdp_services=>get_instance(
        CONV #( c_form_service_definition ) ).

    " Template side: XDP uploaded via ADT ("Working with Forms").
    " Alternative (reuse-services sample): fetch the XDP from the
    " SAP Forms Service template store via a custom HTTP client.
    DATA(lo_form_reader) = cl_fp_form_reader=>create_form_reader(
        CONV #( c_form_template_name ) ).
    mv_xdp_layout = lo_form_reader->get_layout( ).
  ENDMETHOD.

  METHOD read_form_data_as_xml.
    " get_keys returns every key field of the service definition;
    " fill the values that identify the document to output.
    DATA(lt_selection_keys) = mo_form_data_provider->get_keys( ).
    lt_selection_keys[ name = 'SALESORDERID' ]-value = iv_sales_order.

    " For draft-enabled services, IsActiveEntity defaults to false -
    " override it to read the ACTIVE data:
    rv_form_xml_data = mo_form_data_provider->read_to_xml_v2(
        it_select     = lt_selection_keys
        it_select_add = VALUE if_fp_fdp_api=>tt_select_keys(
            ( name = 'IsActiveEntity' value = 'X' data_type = 'ABAP_BOOL' ) ) ).
  ENDMETHOD.

  METHOD render_order_pdf.
    DATA(lv_form_xml_data) = read_form_data_as_xml( iv_sales_order ).

    cl_fp_ads_util=>render_pdf(
      EXPORTING iv_xml_data     = lv_form_xml_data
                iv_xdp_layout   = mv_xdp_layout
                iv_locale       = c_rendering_locale
                " trace_level 0 in production (sample used 4 while debugging)
                is_options      = VALUE #( trace_level = 0 )
      IMPORTING ev_pdf          = rv_rendered_pdf
                ev_pages        = DATA(lv_page_count)
                ev_trace_string = DATA(lv_ads_trace) ).
  ENDMETHOD.

  METHOD print_order.
    DATA(lv_form_xml_data) = read_form_data_as_xml( iv_sales_order ).

    " render_4_pq returns the Print Definition Language (PDL) format
    " that the target queue expects, taken from the queue properties.
    cl_fp_ads_util=>render_4_pq(
      EXPORTING iv_xml_data     = lv_form_xml_data
                iv_xdp_layout   = mv_xdp_layout
                iv_locale       = c_rendering_locale
                iv_pq_name      = iv_print_queue_name
                is_options      = VALUE #( )
      IMPORTING ev_pdl          = DATA(lv_print_document)
                ev_pages        = DATA(lv_page_count)
                ev_trace_string = DATA(lv_ads_trace) ).

    " One queue item = one main document (+ optional attachments).
    " Check rv_itemid / ev_err_msg instead of assuming success.
    rv_queue_item_id = cl_print_queue_utils=>create_queue_item_by_data(
        iv_qname            = iv_print_queue_name
        iv_print_data       = lv_print_document
        iv_name_of_main_doc = |Sales order { iv_sales_order }|
        iv_number_of_copies = 1
        iv_pages            = lv_page_count ).
  ENDMETHOD.

  METHOD merge_with_cover_sheet.
    " Restrictions: PDFs only, no encrypted and no damaged files -
    " never run PDF bytes through a codepage conversion.
    DATA(lo_pdf_merger) = cl_rspo_pdf_merger=>create_instance( ).
    lo_pdf_merger->add_document( iv_cover_sheet_pdf ).
    lo_pdf_merger->add_document( iv_order_pdf ).

    " cx_rspo_pdf_merger carries document_index, error_code, error_text.
    rv_merged_pdf = lo_pdf_merger->merge_documents( ).
  ENDMETHOD.

ENDCLASS.
