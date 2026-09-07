# XML / JSON Round-Trip Examples

Complete, runnable examples sourced from the SAP-samples `abap-cheat-sheets` (21_XML_JSON.md). Each class implements `if_oo_adt_classrun`; create a class `zcl_demo_abap` (or adjust the name), paste, activate, and run with F9 in ADT to see console output.

---

## 1. ABAP structure / table ↔ JSON with the identity transformation

ABAP data → asJSON via a JSON sXML writer, then asJSON → ABAP. Field names come out upper case (the asJSON convention), and `abap_boolean` serializes as `"X"` / `""`.

```abap
CLASS zcl_demo_abap DEFINITION
  PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_demo_abap IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.

    TYPES: BEGIN OF ty_demo_struc,
             comp1 TYPE i,
             comp2 TYPE string,
             comp3 TYPE abap_boolean,
           END OF ty_demo_struc,
           tt_tab_type TYPE TABLE OF ty_demo_struc WITH EMPTY KEY.
    DATA(lt_it) = VALUE tt_tab_type( ( comp1 = 1 comp2 = `abc` comp3 = abap_true )
                               ( comp1 = 2 comp2 = `def` comp3 = abap_false )
                               ( comp1 = 3 comp2 = `ghi` comp3 = abap_true ) ).

    "---------- ABAP -> JSON (unformatted) ----------
    DATA(lo_json_wr) = cl_sxml_string_writer=>create( type = if_sxml=>co_xt_json ).
    CALL TRANSFORMATION id SOURCE itab = lt_it RESULT XML lo_json_wr.
    DATA(lv_json_unformatted) = cl_abap_conv_codepage=>create_in( )->convert( lo_json_wr->get_output( ) ).
    out->write( lv_json_unformatted ).
    "{"ITAB":[{"COMP1":1,"COMP2":"abc","COMP3":"X"},{"COMP1":2,"COMP2":"def","COMP3":""},
    " {"COMP1":3,"COMP2":"ghi","COMP3":"X"}]}

    "---------- ABAP -> JSON (formatted) ----------
    "Cast to if_sxml_writer to reach set_option
    DATA(lo_json_wr_f) = CAST if_sxml_writer( cl_sxml_string_writer=>create( type = if_sxml=>co_xt_json ) ).
    lo_json_wr_f->set_option( option = if_sxml_writer=>co_opt_linebreaks ).
    lo_json_wr_f->set_option( option = if_sxml_writer=>co_opt_indent ).
    CALL TRANSFORMATION id SOURCE itab = lt_it RESULT XML lo_json_wr_f.
    DATA(lv_json_formatted) =
      cl_abap_conv_codepage=>create_in( )->convert(
        CAST cl_sxml_string_writer( lo_json_wr_f )->get_output( ) ).
    out->write( lv_json_formatted ).

    "---------- JSON -> ABAP ----------
    "CALL TRANSFORMATION handles the JSON source implicitly
    DATA(lv_json_xstr) = lo_json_wr->get_output( ).
    DATA lt_it_back TYPE tt_tab_type.
    CALL TRANSFORMATION id SOURCE XML lv_json_xstr RESULT itab = lt_it_back.
    out->write( lt_it_back ).

  ENDMETHOD.
ENDCLASS.
```

### Same round-trip with the SOURCE JSON / RESULT JSON additions

```abap
"ABAP (structure) -> JSON
DATA: BEGIN OF ls_struct,
        num  TYPE i      VALUE 987,
        text TYPE string VALUE `hello world`,
        date TYPE d      VALUE '20260102',
        time TYPE t      VALUE '123456',
      END OF ls_struct.

CALL TRANSFORMATION id SOURCE structure = ls_struct RESULT JSON DATA(lv_json).
DATA(lv_res_json) = cl_abap_conv_codepage=>create_in( )->convert( lv_json ).

"JSON -> ABAP (structure)
DATA ls_struct2 LIKE ls_struct.
CALL TRANSFORMATION id SOURCE JSON lv_json RESULT structure = ls_struct2.
```

---

## 2. ABAP ↔ JSON with /ui2/cl_json (formatting, camelCase, name mapping, generate)

```abap
CLASS zcl_demo_abap DEFINITION
  PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_demo_abap IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.

    TYPES: BEGIN OF ty_demo_struc,
             carrier_id    TYPE c LENGTH 3,
             connection_id TYPE n LENGTH 4,
             city_from     TYPE c LENGTH 20,
             city_to       TYPE c LENGTH 20,
           END OF ty_demo_struc.
    DATA lt_itab TYPE TABLE OF ty_demo_struc WITH EMPTY KEY.
    lt_itab = VALUE #( ( carrier_id = 'AA' connection_id = '0017' city_from = 'New York' city_to = 'San Francisco' )
                    ( carrier_id = 'AZ' connection_id = '0789' city_from = 'Tokyo'    city_to = 'Rome' ) ).

    "---------------- Serializing ----------------
    DATA(lv_abap_to_json)        = /ui2/cl_json=>serialize( data = lt_itab ).
    DATA(lv_abap_to_json_pretty) = /ui2/cl_json=>serialize( data = lt_itab format_output = abap_true ).
    DATA(lv_abap_to_json_camel)  = /ui2/cl_json=>serialize( data = lt_itab
                                                         format_output = abap_true
                                                         pretty_name   = /ui2/cl_json=>pretty_mode-camel_case ).
    out->write( lv_abap_to_json ).
    out->write( lv_abap_to_json_pretty ).
    out->write( lv_abap_to_json_camel ).

    "---------------- Deserializing (CHANGING target) ----------------
    DATA lt_itab_back LIKE lt_itab.
    /ui2/cl_json=>deserialize( EXPORTING json = lv_abap_to_json
                               CHANGING  data = lt_itab_back ).
    out->write( lt_itab_back ).

    "---------------- Deserializing with name mapping ----------------
    TYPES: BEGIN OF ty_demo_struc4map,
             carr TYPE c LENGTH 3,
             conn TYPE n LENGTH 4,
             from TYPE c LENGTH 20,
             to   TYPE c LENGTH 20,
           END OF ty_demo_struc4map.
    DATA lt_itab4map TYPE TABLE OF ty_demo_struc4map WITH EMPTY KEY.
    /ui2/cl_json=>deserialize( EXPORTING json = lv_abap_to_json
                               name_mappings = VALUE #( ( abap = 'CARR' json = `CARRIER_ID` )
                                                        ( abap = 'CONN' json = `CONNECTION_ID` )
                                                        ( abap = 'FROM' json = `CITY_FROM` )
                                                        ( abap = 'TO'   json = `CITY_TO` ) )
                               CHANGING  data = lt_itab4map ).
    out->write( lt_itab4map ).

    "---------------- Deserializing JSON as xstring ----------------
    DATA(lv_json_xstring) = cl_abap_conv_codepage=>create_out( )->convert(
      `[{"carrier_id":"LH","connection_id":"400","city_from":"Frankfurt","city_to":"Berlin"}]` ).
    DATA lt_itab_from_xstr LIKE lt_itab.
    /ui2/cl_json=>deserialize( EXPORTING jsonx = lv_json_xstring
                               CHANGING  data  = lt_itab_from_xstr ).
    out->write( lt_itab_from_xstr ).

    "---------------- No equivalent ABAP type: generate ----------------
    "generate returns a generic REF TO data; inspect it via RTTS (see abap-dynamic-programming)
    DATA(lv_json) = `[{"CARRIER_ID":"AA","CONNECTION_ID":17,"CITY_FROM":"New York","CITY_TO":"San Francisco"}]`.
    DATA(lr_dref) = /ui2/cl_json=>generate( json = lv_json ).
    IF lr_dref IS BOUND.
      out->write( lr_dref->* ).
    ENDIF.

  ENDMETHOD.
ENDCLASS.
```

---

## 3. ABAP ↔ JSON with XCO (ABAP Cloud)

```abap
"Setup
DATA: BEGIN OF ls_carrier_struc,
        carrier_id    TYPE c LENGTH 3,
        connection_id TYPE n LENGTH 4,
        city_from     TYPE c LENGTH 20,
        city_to       TYPE c LENGTH 20,
      END OF ls_carrier_struc.
ls_carrier_struc = VALUE #( carrier_id = 'AA' connection_id = '17'
                         city_from = 'New York' city_to = 'San Francisco' ).

"ABAP (structure) -> JSON
DATA(lv_struc2json) = xco_cp_json=>data->from_abap( ls_carrier_struc )->to_string( ).
"{"CARRIER_ID":"AA","CONNECTION_ID":"0017","CITY_FROM":"New York","CITY_TO":"San Francisco"}

"JSON -> ABAP (structure) — write_to takes a data reference
DATA ls_json2struc LIKE ls_carrier_struc.
xco_cp_json=>data->from_string( lv_struc2json )->write_to( REF #( ls_json2struc ) ).

"Build JSON with the fluent builder
DATA(lo_builder) = xco_cp_json=>data->builder( ).
lo_builder->begin_object(
  )->add_member( 'CarrierId' )->add_string( 'DL'
  )->add_member( 'ConnectionId' )->add_string( '1984'
  )->add_member( 'CityFrom' )->add_string( 'San Francisco'
  )->add_member( 'CityTo' )->add_string( 'New York'
  )->end_object( ).
DATA(lv_built_json) = lo_builder->get_data( )->to_string( ).
"{"CarrierId":"DL","ConnectionId":"1984","CityFrom":"San Francisco","CityTo":"New York"}

"Apply a name-style transformation while reading (PascalCase -> underscore)
CLEAR ls_json2struc.
xco_cp_json=>data->from_string( lv_built_json )->apply( VALUE #(
  ( xco_cp_json=>transformation->pascal_case_to_underscore ) ) )->write_to( REF #( ls_json2struc ) ).
```

---

## 4. sXML streaming parse (token-based)

Iterate every node of a document without building a DOM. Works identically for XML and JSON (only the reader source differs). Here, JSON is parsed and each node's type/name/value collected into a table.

```abap
CLASS zcl_demo_abap DEFINITION
  PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_demo_abap IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.

    "Demo JSON as xstring
    DATA(lv_json) = cl_abap_conv_codepage=>create_out( )->convert(
      `[` &&
      `  { "carrier_id": "LH", "connection_id": "400", "city_from": "Frankfurt", "city_to": "Berlin" },` &&
      `  { "carrier_id": "DL", "connection_id": "1984", "city_from": "San Francisco", "city_to": "New York" }` &&
      `]` ).

    DATA: BEGIN OF ls_node_info,
            node_type TYPE string,
            name      TYPE string,
            value     TYPE string,
          END OF ls_node_info,
          lt_nodes_tab LIKE TABLE OF ls_node_info.

    "Create a reader (JSON detected from the data; no cast needed here)
    DATA(lo_reader) = cl_sxml_string_reader=>create( lv_json ).

    TRY.
        DO.
          CLEAR ls_node_info.
          lo_reader->next_node( ).
          IF lo_reader->node_type = if_sxml_node=>co_nt_final.
            EXIT.
          ENDIF.

          ls_node_info-node_type = SWITCH #( lo_reader->node_type
            WHEN if_sxml_node=>co_nt_initial       THEN `CO_NT_INITIAL`
            WHEN if_sxml_node=>co_nt_element_open  THEN `CO_NT_ELEMENT_OPEN`
            WHEN if_sxml_node=>co_nt_element_close THEN `CO_NT_ELEMENT_CLOSE`
            WHEN if_sxml_node=>co_nt_value         THEN `CO_NT_VALUE`
            WHEN if_sxml_node=>co_nt_attribute     THEN `CO_NT_ATTRIBUTE`
            ELSE `Error` ).
          ls_node_info-name  = lo_reader->name.
          ls_node_info-value = COND #( WHEN lo_reader->node_type = if_sxml_node=>co_nt_value THEN lo_reader->value ).
          APPEND ls_node_info TO lt_nodes_tab.

          "On an opening element, iterate its attributes
          IF lo_reader->node_type = if_sxml_node=>co_nt_element_open.
            DO.
              lo_reader->next_attribute( ).
              IF lo_reader->node_type <> if_sxml_node=>co_nt_attribute.
                EXIT.
              ENDIF.
              APPEND VALUE #( node_type = `CO_NT_ATTRIBUTE`
                              name      = lo_reader->name
                              value     = lo_reader->value ) TO lt_nodes_tab.
            ENDDO.
          ENDIF.
        ENDDO.
      CATCH cx_sxml_state_error INTO DATA(lo_error_parse).
        out->write( lo_error_parse->get_text( ) ).
    ENDTRY.

    out->write( lt_nodes_tab ).
  ENDMETHOD.
ENDCLASS.
```

---

## 5. Object serialization round-trip (IF_SERIALIZABLE_OBJECT)

A class instance serializes via `CALL TRANSFORMATION id` once it implements `IF_SERIALIZABLE_OBJECT`. By default all instance attributes are (de)serialized.

```abap
CLASS zcl_demo_abap DEFINITION
  PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES: if_oo_adt_classrun,
                if_serializable_object.
  PRIVATE SECTION.
    DATA mv_timestamp     TYPE utclong.
    DATA mv_random_number TYPE i.
    DATA mv_uuid          TYPE sysuuid_x16.
ENDCLASS.

CLASS zcl_demo_abap IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.

    DATA lt_serialized_obj_tab TYPE string_table.
    TYPES: BEGIN OF ty_row,
             timestamp     TYPE utclong,
             random_number TYPE i,
             uuid          TYPE sysuuid_x16,
           END OF ty_row.
    DATA lt_result_tab TYPE TABLE OF ty_row WITH EMPTY KEY.

    "Create + serialize three instances
    DO 3 TIMES.
      DATA(lo_oref) = NEW zcl_demo_abap( ).
      lo_oref->mv_timestamp     = utclong_current( ).
      lo_oref->mv_random_number = cl_abap_random_int=>create( seed = cl_abap_random=>seed( )
                                                        min = 1 max = 100 )->get_next( ).
      TRY.
          lo_oref->mv_uuid = cl_system_uuid=>create_uuid_x16_static( ).
        CATCH cx_uuid_error.
      ENDTRY.

      DATA lv_serialized_obj TYPE string.
      CALL TRANSFORMATION id SOURCE obj = lo_oref RESULT XML lv_serialized_obj.
      APPEND lv_serialized_obj TO lt_serialized_obj_tab.
    ENDDO.

    "Deserialize
    LOOP AT lt_serialized_obj_tab INTO DATA(lv_wa).
      DATA lo_deserialized_obj TYPE REF TO zcl_demo_abap.
      CALL TRANSFORMATION id SOURCE XML lv_wa RESULT obj = lo_deserialized_obj.
      APPEND VALUE #( timestamp     = lo_deserialized_obj->mv_timestamp
                      random_number = lo_deserialized_obj->mv_random_number
                      uuid          = lo_deserialized_obj->mv_uuid ) TO lt_result_tab.
    ENDLOOP.

    out->write( lt_result_tab ).
  ENDMETHOD.
ENDCLASS.
```

To exclude attributes from (de)serialization, add the private instance methods `SERIALIZE_HELPER` (output params only) and `DESERIALIZE_HELPER` (input params only) — both or neither, with identically named and typed parameters — and copy only the attributes you want to persist.
