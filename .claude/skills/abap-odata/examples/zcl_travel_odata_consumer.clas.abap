" Example: consuming an external OData V4 service from ABAP Cloud.
"
" Prerequisites (design time):
"   1. Service consumption model ZSC_TRAVEL created in ADT from the target
"      service's $metadata (generates the abstract entity ZSC_TRAVEL used below).
"   2. Outbound service Z_OUTBOUND_TRAVEL_HTTP (type HTTP) bundled into
"      communication scenario Z_OUTBOUND_TRAVEL; the administrator created a
"      communication arrangement for it.
"
" Pattern: instantiate the HTTP client and client proxy once (lazy, cached),
" push $top / $filter to the provider, translate proxy exceptions into one
" application-level exception. Never hardcode URLs or credentials.
CLASS zcl_travel_odata_consumer DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    TYPES tt_travel_list TYPE STANDARD TABLE OF zsc_travel WITH EMPTY KEY.

    "! Reads travels of one agency from the remote OData V4 service.
    "! @parameter iv_agency_id     | Agency to filter on (pushed as $filter)
    "! @parameter iv_max_row_count | Upper bound pushed as $top
    "! @parameter rt_travel_list   | Typed business data from the response
    "! @raising   zcx_travel_consumption | Wraps transport and provider errors
    METHODS read_travels_of_agency
      IMPORTING iv_agency_id          TYPE string
                iv_max_row_count      TYPE i DEFAULT 50
      RETURNING VALUE(rt_travel_list) TYPE tt_travel_list
      RAISING   zcx_travel_consumption.

    "! Releases the HTTP session. Call from the consumer's cleanup path.
    METHODS close.

  PRIVATE SECTION.
    CONSTANTS c_communication_scenario_id TYPE string VALUE 'Z_OUTBOUND_TRAVEL'.
    CONSTANTS c_outbound_service_id       TYPE string VALUE 'Z_OUTBOUND_TRAVEL_HTTP'.
    CONSTANTS c_relative_service_root     TYPE string
      VALUE '/sap/opu/odata4/sap/zapi_travel/srvd_a2x/sap/zapi_travel/0001/'.

    DATA mo_http_client  TYPE REF TO if_web_http_client.
    DATA mo_client_proxy TYPE REF TO /iwbep/if_cp_client_proxy.

    METHODS get_client_proxy
      RETURNING VALUE(ro_result) TYPE REF TO /iwbep/if_cp_client_proxy
      RAISING   zcx_travel_consumption.

ENDCLASS.


CLASS zcl_travel_odata_consumer IMPLEMENTATION.

  METHOD read_travels_of_agency.
    TRY.
        DATA(lo_read_request) = get_client_proxy(
                               )->create_resource_for_entity_set( 'TRAVEL'
                               )->create_request_for_read( ).

        lo_read_request->set_top( iv_max_row_count ).
        lo_read_request->set_skip( 0 ).

        " Push the filter to the provider instead of filtering in ABAP.
        DATA(lo_filter_factory) = lo_read_request->create_filter_factory( ).
        DATA(lo_agency_filter)  = lo_filter_factory->create_by_range(
                                 iv_property_path = 'AGENCY_ID'
                                 it_range         = VALUE #( ( sign   = 'I'
                                                               option = 'EQ'
                                                               low    = iv_agency_id ) ) ).
        lo_read_request->set_filter( lo_agency_filter ).

        DATA(lo_read_response) = lo_read_request->execute( ).
        lo_read_response->get_business_data( IMPORTING et_business_data = rt_travel_list ).

      CATCH /iwbep/cx_cp_remote INTO DATA(lo_remote_error).
        " Provider returned an OData error payload (4xx/5xx).
        RAISE EXCEPTION TYPE zcx_travel_consumption
          EXPORTING previous = lo_remote_error.
      CATCH /iwbep/cx_gateway INTO DATA(lo_gateway_error).
        RAISE EXCEPTION TYPE zcx_travel_consumption
          EXPORTING previous = lo_gateway_error.
      CATCH cx_web_http_client_error INTO DATA(lo_transport_error).
        " Destination, TLS, or network problem — nothing the provider saw.
        RAISE EXCEPTION TYPE zcx_travel_consumption
          EXPORTING previous = lo_transport_error.
    ENDTRY.
  ENDMETHOD.


  METHOD get_client_proxy.
    IF mo_client_proxy IS BOUND.
      ro_result = mo_client_proxy.
      RETURN.
    ENDIF.

    TRY.
        " Destination comes from the communication arrangement — never from
        " a hardcoded URL (create_by_url is for prototypes only).
        DATA(lo_http_destination) = cl_http_destination_provider=>create_by_comm_arrangement(
                                   comm_scenario = c_communication_scenario_id
                                   service_id    = c_outbound_service_id ).

        mo_http_client = cl_web_http_client_manager=>create_by_http_destination( lo_http_destination ).

        " Proxy model key = service consumption model name + version.
        " The proxy auto-fetches the X-CSRF-Token via HEAD and caches it
        " for all requests of this instance.
        mo_client_proxy = /iwbep/cl_cp_factory_remote=>create_v4_remote_proxy(
                         is_proxy_model_key       = VALUE #( repository_id       = 'DEFAULT'
                                                             proxy_model_id      = 'ZSC_TRAVEL'
                                                             proxy_model_version = '0001' )
                         io_http_client           = mo_http_client
                         iv_relative_service_root = c_relative_service_root ).

        ro_result = mo_client_proxy.

      CATCH cx_http_dest_provider_error INTO DATA(lo_destination_error).
        RAISE EXCEPTION TYPE zcx_travel_consumption
          EXPORTING previous = lo_destination_error.
      CATCH cx_web_http_client_error INTO DATA(lo_client_error).
        RAISE EXCEPTION TYPE zcx_travel_consumption
          EXPORTING previous = lo_client_error.
      CATCH /iwbep/cx_gateway INTO DATA(lo_proxy_error).
        RAISE EXCEPTION TYPE zcx_travel_consumption
          EXPORTING previous = lo_proxy_error.
    ENDTRY.
  ENDMETHOD.


  METHOD close.
    IF mo_http_client IS BOUND.
      TRY.
          mo_http_client->close( ).
        CATCH cx_web_http_client_error.
          " Closing a broken session is not an application error — ignore.
      ENDTRY.
      CLEAR: mo_http_client, mo_client_proxy.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
