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

    TYPES: BEGIN OF demo_struc,
             comp1 TYPE i,
             comp2 TYPE string,
             comp3 TYPE abap_boolean,
           END OF demo_struc,
           tab_type TYPE TABLE OF demo_struc WITH EMPTY KEY.
    DATA(it) = VALUE tab_type( ( comp1 = 1 comp2 = `abc` comp3 = abap_true )
                               ( comp1 = 2 comp2 = `def` comp3 = abap_false )
                               ( comp1 = 3 comp2 = `ghi` comp3 = abap_true ) ).

    "---------- ABAP -> JSON (unformatted) ----------
    DATA(json_wr) = cl_sxml_string_writer=>create( type = if_sxml=>co_xt_json ).
    CALL TRANSFORMATION id SOURCE itab = it RESULT XML json_wr.
    DATA(json_unformatted) = cl_abap_conv_codepage=>create_in( )->convert( json_wr->get_output( ) ).
    out->write( json_unformatted ).
    "{"ITAB":[{"COMP1":1,"COMP2":"abc","COMP3":"X"},{"COMP1":2,"COMP2":"def","COMP3":""},
    " {"COMP1":3,"COMP2":"ghi","COMP3":"X"}]}

    "---------- ABAP -> JSON (formatted) ----------
    "Cast to if_sxml_writer to reach set_option
    DATA(json_wr_f) = CAST if_sxml_writer( cl_sxml_string_writer=>create( type = if_sxml=>co_xt_json ) ).
    json_wr_f->set_option( option = if_sxml_writer=>co_opt_linebreaks ).
    json_wr_f->set_option( option = if_sxml_writer=>co_opt_indent ).
    CALL TRANSFORMATION id SOURCE itab = it RESULT XML json_wr_f.
    DATA(json_formatted) =
      cl_abap_conv_codepage=>create_in( )->convert(
        CAST cl_sxml_string_writer( json_wr_f )->get_output( ) ).
    out->write( json_formatted ).

    "---------- JSON -> ABAP ----------
    "CALL TRANSFORMATION handles the JSON source implicitly
    DATA(json_xstr) = json_wr->get_output( ).
    DATA it_back TYPE tab_type.
    CALL TRANSFORMATION id SOURCE XML json_xstr RESULT itab = it_back.
    out->write( it_back ).

  ENDMETHOD.
ENDCLASS.
```

### Same round-trip with the SOURCE JSON / RESULT JSON additions

```abap
"ABAP (structure) -> JSON
DATA: BEGIN OF struct,
        num  TYPE i      VALUE 987,
        text TYPE string VALUE `hello world`,
        date TYPE d      VALUE '20260102',
        time TYPE t      VALUE '123456',
      END OF struct.

CALL TRANSFORMATION id SOURCE structure = struct RESULT JSON DATA(json).
DATA(res_json) = cl_abap_conv_codepage=>create_in( )->convert( json ).

"JSON -> ABAP (structure)
DATA struct2 LIKE struct.
CALL TRANSFORMATION id SOURCE JSON json RESULT structure = struct2.
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

    TYPES: BEGIN OF demo_struc,
             carrier_id    TYPE c LENGTH 3,
             connection_id TYPE n LENGTH 4,
             city_from     TYPE c LENGTH 20,
             city_to       TYPE c LENGTH 20,
           END OF demo_struc.
    DATA itab TYPE TABLE OF demo_struc WITH EMPTY KEY.
    itab = VALUE #( ( carrier_id = 'AA' connection_id = '0017' city_from = 'New York' city_to = 'San Francisco' )
                    ( carrier_id = 'AZ' connection_id = '0789' city_from = 'Tokyo'    city_to = 'Rome' ) ).

    "---------------- Serializing ----------------
    DATA(abap_to_json)        = /ui2/cl_json=>serialize( data = itab ).
    DATA(abap_to_json_pretty) = /ui2/cl_json=>serialize( data = itab format_output = abap_true ).
    DATA(abap_to_json_camel)  = /ui2/cl_json=>serialize( data = itab
                                                         format_output = abap_true
                                                         pretty_name   = /ui2/cl_json=>pretty_mode-camel_case ).
    out->write( abap_to_json ).
    out->write( abap_to_json_pretty ).
    out->write( abap_to_json_camel ).

    "---------------- Deserializing (CHANGING target) ----------------
    DATA itab_back LIKE itab.
    /ui2/cl_json=>deserialize( EXPORTING json = abap_to_json
                               CHANGING  data = itab_back ).
    out->write( itab_back ).

    "---------------- Deserializing with name mapping ----------------
    TYPES: BEGIN OF demo_struc4map,
             carr TYPE c LENGTH 3,
             conn TYPE n LENGTH 4,
             from TYPE c LENGTH 20,
             to   TYPE c LENGTH 20,
           END OF demo_struc4map.
    DATA itab4map TYPE TABLE OF demo_struc4map WITH EMPTY KEY.
    /ui2/cl_json=>deserialize( EXPORTING json = abap_to_json
                               name_mappings = VALUE #( ( abap = 'CARR' json = `CARRIER_ID` )
                                                        ( abap = 'CONN' json = `CONNECTION_ID` )
                                                        ( abap = 'FROM' json = `CITY_FROM` )
                                                        ( abap = 'TO'   json = `CITY_TO` ) )
                               CHANGING  data = itab4map ).
    out->write( itab4map ).

    "---------------- Deserializing JSON as xstring ----------------
    DATA(json_xstring) = cl_abap_conv_codepage=>create_out( )->convert(
      `[{"carrier_id":"LH","connection_id":"400","city_from":"Frankfurt","city_to":"Berlin"}]` ).
    DATA itab_from_xstr LIKE itab.
    /ui2/cl_json=>deserialize( EXPORTING jsonx = json_xstring
                               CHANGING  data  = itab_from_xstr ).
    out->write( itab_from_xstr ).

    "---------------- No equivalent ABAP type: generate ----------------
    "generate returns a generic REF TO data; inspect it via RTTS (see abap-dynamic-programming)
    DATA(json) = `[{"CARRIER_ID":"AA","CONNECTION_ID":17,"CITY_FROM":"New York","CITY_TO":"San Francisco"}]`.
    DATA(dref) = /ui2/cl_json=>generate( json = json ).
    IF dref IS BOUND.
      out->write( dref->* ).
    ENDIF.

  ENDMETHOD.
ENDCLASS.
```

---

## 3. ABAP ↔ JSON with XCO (ABAP Cloud)

```abap
"Setup
DATA: BEGIN OF carrier_struc,
        carrier_id    TYPE c LENGTH 3,
        connection_id TYPE n LENGTH 4,
        city_from     TYPE c LENGTH 20,
        city_to       TYPE c LENGTH 20,
      END OF carrier_struc.
carrier_struc = VALUE #( carrier_id = 'AA' connection_id = '17'
                         city_from = 'New York' city_to = 'San Francisco' ).

"ABAP (structure) -> JSON
DATA(struc2json) = xco_cp_json=>data->from_abap( carrier_struc )->to_string( ).
"{"CARRIER_ID":"AA","CONNECTION_ID":"0017","CITY_FROM":"New York","CITY_TO":"San Francisco"}

"JSON -> ABAP (structure) — write_to takes a data reference
DATA json2struc LIKE carrier_struc.
xco_cp_json=>data->from_string( struc2json )->write_to( REF #( json2struc ) ).

"Build JSON with the fluent builder
DATA(builder) = xco_cp_json=>data->builder( ).
builder->begin_object(
  )->add_member( 'CarrierId' )->add_string( 'DL'
  )->add_member( 'ConnectionId' )->add_string( '1984'
  )->add_member( 'CityFrom' )->add_string( 'San Francisco'
  )->add_member( 'CityTo' )->add_string( 'New York'
  )->end_object( ).
DATA(built_json) = builder->get_data( )->to_string( ).
"{"CarrierId":"DL","ConnectionId":"1984","CityFrom":"San Francisco","CityTo":"New York"}

"Apply a name-style transformation while reading (PascalCase -> underscore)
CLEAR json2struc.
xco_cp_json=>data->from_string( built_json )->apply( VALUE #(
  ( xco_cp_json=>transformation->pascal_case_to_underscore ) ) )->write_to( REF #( json2struc ) ).
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
    DATA(json) = cl_abap_conv_codepage=>create_out( )->convert(
      `[` &&
      `  { "carrier_id": "LH", "connection_id": "400", "city_from": "Frankfurt", "city_to": "Berlin" },` &&
      `  { "carrier_id": "DL", "connection_id": "1984", "city_from": "San Francisco", "city_to": "New York" }` &&
      `]` ).

    DATA: BEGIN OF node_info,
            node_type TYPE string,
            name      TYPE string,
            value     TYPE string,
          END OF node_info,
          nodes_tab LIKE TABLE OF node_info.

    "Create a reader (JSON detected from the data; no cast needed here)
    DATA(reader) = cl_sxml_string_reader=>create( json ).

    TRY.
        DO.
          CLEAR node_info.
          reader->next_node( ).
          IF reader->node_type = if_sxml_node=>co_nt_final.
            EXIT.
          ENDIF.

          node_info-node_type = SWITCH #( reader->node_type
            WHEN if_sxml_node=>co_nt_initial       THEN `CO_NT_INITIAL`
            WHEN if_sxml_node=>co_nt_element_open  THEN `CO_NT_ELEMENT_OPEN`
            WHEN if_sxml_node=>co_nt_element_close THEN `CO_NT_ELEMENT_CLOSE`
            WHEN if_sxml_node=>co_nt_value         THEN `CO_NT_VALUE`
            WHEN if_sxml_node=>co_nt_attribute     THEN `CO_NT_ATTRIBUTE`
            ELSE `Error` ).
          node_info-name  = reader->name.
          node_info-value = COND #( WHEN reader->node_type = if_sxml_node=>co_nt_value THEN reader->value ).
          APPEND node_info TO nodes_tab.

          "On an opening element, iterate its attributes
          IF reader->node_type = if_sxml_node=>co_nt_element_open.
            DO.
              reader->next_attribute( ).
              IF reader->node_type <> if_sxml_node=>co_nt_attribute.
                EXIT.
              ENDIF.
              APPEND VALUE #( node_type = `CO_NT_ATTRIBUTE`
                              name      = reader->name
                              value     = reader->value ) TO nodes_tab.
            ENDDO.
          ENDIF.
        ENDDO.
      CATCH cx_sxml_state_error INTO DATA(error_parse).
        out->write( error_parse->get_text( ) ).
    ENDTRY.

    out->write( nodes_tab ).
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
    DATA timestamp     TYPE utclong.
    DATA random_number TYPE i.
    DATA uuid          TYPE sysuuid_x16.
ENDCLASS.

CLASS zcl_demo_abap IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.

    DATA serialized_obj_tab TYPE string_table.
    TYPES: BEGIN OF row,
             timestamp     TYPE utclong,
             random_number TYPE i,
             uuid          TYPE sysuuid_x16,
           END OF row.
    DATA result_tab TYPE TABLE OF row WITH EMPTY KEY.

    "Create + serialize three instances
    DO 3 TIMES.
      DATA(oref) = NEW zcl_demo_abap( ).
      oref->timestamp     = utclong_current( ).
      oref->random_number = cl_abap_random_int=>create( seed = cl_abap_random=>seed( )
                                                        min = 1 max = 100 )->get_next( ).
      TRY.
          oref->uuid = cl_system_uuid=>create_uuid_x16_static( ).
        CATCH cx_uuid_error.
      ENDTRY.

      DATA serialized_obj TYPE string.
      CALL TRANSFORMATION id SOURCE obj = oref RESULT XML serialized_obj.
      APPEND serialized_obj TO serialized_obj_tab.
    ENDDO.

    "Deserialize
    LOOP AT serialized_obj_tab INTO DATA(wa).
      DATA deserialized_obj TYPE REF TO zcl_demo_abap.
      CALL TRANSFORMATION id SOURCE XML wa RESULT obj = deserialized_obj.
      APPEND VALUE #( timestamp     = deserialized_obj->timestamp
                      random_number = deserialized_obj->random_number
                      uuid          = deserialized_obj->uuid ) TO result_tab.
    ENDLOOP.

    out->write( result_tab ).
  ENDMETHOD.
ENDCLASS.
```

To exclude attributes from (de)serialization, add the private instance methods `SERIALIZE_HELPER` (output params only) and `DESERIALIZE_HELPER` (input params only) — both or neither, with identically named and typed parameters — and copy only the attributes you want to persist.
