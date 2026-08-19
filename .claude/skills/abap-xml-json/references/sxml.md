# sXML — Serial XML Library Reference

The sXML library provides XML readers and writers for different sources and targets. It processes data **sequentially** (no DOM), supports more formats than iXML (standard XML 1.0, XOP, binary XML, and **JSON**), and is the more performant choice when you do not need a DOM representation or DTDs. All syntax is copied from the SAP-samples `abap-cheat-sheets` (21_XML_JSON.md).

sXML offers two processing styles:
- **Token-based** — iterate node by node; one method per node type.
- **Object-oriented** — wraps the token-based access; node objects represent the current node.

JSON is processed via **JSON-XML** (an SAP-specific JSON representation in XML format), used for both reading and creating JSON. The reader/writer API is identical to XML; only the `type` differs.

---

## Classes and interfaces

| Name | Role |
|---|---|
| `cl_sxml_string_writer` | Writer that renders to a byte string (`xstring`). `create` returns it; cast to `if_sxml_writer` to use, cast back to `cl_sxml_string_writer` for `get_output`. |
| `cl_sxml_string_reader` | Reader over an `xstring` source. `create( xml )` returns it (often usable as `if_sxml_reader` without a cast). |
| `if_sxml_writer` | Common writer interface (super class `cl_sxml_writer` implements it). Holds the writing methods. |
| `if_sxml_reader` | Common reader interface. |
| `if_sxml` | Holds the format constants used in `create`. |
| `if_sxml_node` | Node-type constants (`co_nt_*`). |
| `if_sxml_open_element` / `if_sxml_close_element` / `if_sxml_value_node` | Node object types in OO parsing (down-cast targets). |
| `if_sxml_value` | Value-type constants (`co_vt_text`, ...). |
| `cx_sxml_state_error` | Exception raised for invalid writer/reader state. |

### Format constants (`if_sxml`, used in `create( type = ... )`)

| Constant | Format |
|---|---|
| `if_sxml=>co_xt_xml10` | Standard XML 1.0 |
| `if_sxml=>co_xt_json` | JSON (via JSON-XML) |

```abap
"XML writer
DATA(writer) = CAST if_sxml_writer( cl_sxml_string_writer=>create(
                       type = if_sxml=>co_xt_xml10 encoding = 'UTF-8' ) ).
"JSON writer
DATA(json_writer) = CAST if_sxml_writer( cl_sxml_string_writer=>create(
                       type = if_sxml=>co_xt_json ) ).
"Reader (over an xstring)
DATA(reader) = cl_sxml_string_reader=>create( some_xstring ).
```

### Node-type constants (`if_sxml_node`)

| Constant | Meaning |
|---|---|
| `co_nt_initial` | Initial state |
| `co_nt_element_open` | Opening element |
| `co_nt_element_close` | Closing element |
| `co_nt_value` | Value (text content) |
| `co_nt_attribute` | Attribute |
| `co_nt_final` | End of document — exit the loop |

---

## Writer API

### Token-based writing

One method call per node. Order matters.

| Method | Purpose |
|---|---|
| `open_element( name = )` | Start an element |
| `close_element( )` | End the current element |
| `write_value( value = )` | Write a text value into the current element |
| `write_attribute( name = value = )` | Write an attribute on the current open element |
| `set_option( option = )` | Set a formatting option (see below) |

```abap
TRY.
    writer->open_element( name = 'flights' ).
    writer->open_element( name = 'flight' ).
    writer->open_element( name = 'carrier' ).
    writer->write_value( 'LH' ).
    writer->close_element( ).
    writer->open_element( name = 'flightnumber' ).
    writer->write_value( '400' ).
    writer->close_element( ).
    writer->close_element( ).
    writer->close_element( ).
  CATCH cx_sxml_state_error.
ENDTRY.

"Retrieve the rendered xstring (cast back to the concrete class)
DATA(xml) = CAST cl_sxml_string_writer( writer )->get_output( ).
```

For JSON, a `str` element with a `name` attribute maps to a JSON member; nested `object` / `array` elements form the JSON structure:

```abap
DATA(json_writer) = CAST if_sxml_writer( cl_sxml_string_writer=>create( type = if_sxml=>co_xt_json ) ).
json_writer->open_element( name = 'array' ).
json_writer->open_element( name = 'object' ).
json_writer->open_element( name = 'str' ).
json_writer->write_attribute( name = 'name' value = 'carrier_id' ).
json_writer->write_value( value = 'LH' ).
json_writer->close_element( ).
json_writer->close_element( ).
json_writer->close_element( ).
"-> [{"carrier_id":"LH"}]
```

### Writer formatting options (`if_sxml_writer`)

| Option | Effect |
|---|---|
| `co_opt_linebreaks` | Insert line breaks |
| `co_opt_indent` | Indent nested nodes |

```abap
json_wr->set_option( option = if_sxml_writer=>co_opt_linebreaks ).
json_wr->set_option( option = if_sxml_writer=>co_opt_indent ).
```

### Object-oriented writing

Build node objects and feed them to `write_node`.

| Method | Purpose |
|---|---|
| `new_open_element( name = )` | Create an open-element node |
| `new_close_element( )` | Create a close-element node |
| `new_value( )` | Create a value node (`set_value` on it) |
| `write_node( node )` | Write a node object |

```abap
writer_oo->write_node( writer_oo->new_open_element( name = 'flights' ) ).
DATA(val) = writer_oo->new_value( ).
val->set_value( 'AZ' ).
writer_oo->write_node( val ).
writer_oo->write_node( writer_oo->new_close_element( ) ).
```

---

## Reader API

### Token-based reading

| Member / Method | Purpose |
|---|---|
| `next_node( )` | Advance to the next node |
| `node_type` | Type of the current node (compare to `if_sxml_node=>co_nt_*`) |
| `name` | Name of the current element/attribute |
| `value` | Character-like value (when textual) |
| `next_attribute( )` | Advance to the next attribute of an open element |

```abap
DATA(reader) = cl_sxml_string_reader=>create( xml_to_parse ).
TRY.
    DO.
      reader->next_node( ).
      IF reader->node_type = if_sxml_node=>co_nt_final.
        EXIT.
      ENDIF.

      "reader->node_type / reader->name / reader->value are directly readable
      "Map the node type for display
      DATA(nt) = SWITCH string( reader->node_type
        WHEN if_sxml_node=>co_nt_element_open  THEN `CO_NT_ELEMENT_OPEN`
        WHEN if_sxml_node=>co_nt_element_close THEN `CO_NT_ELEMENT_CLOSE`
        WHEN if_sxml_node=>co_nt_value         THEN `CO_NT_VALUE`
        WHEN if_sxml_node=>co_nt_attribute     THEN `CO_NT_ATTRIBUTE`
        ELSE `Error` ).

      "When on an opening element, walk its attributes
      IF reader->node_type = if_sxml_node=>co_nt_element_open.
        DO.
          reader->next_attribute( ).
          IF reader->node_type <> if_sxml_node=>co_nt_attribute.
            EXIT.
          ENDIF.
          "reader->name / reader->value hold the attribute
        ENDDO.
      ENDIF.
    ENDDO.
  CATCH cx_sxml_state_error INTO DATA(err).
ENDTRY.
```

The same reader works for JSON — just create it over JSON `xstring`. JSON members surface as `co_nt_element_open` nodes carrying an attribute (the member name).

### Object-oriented reading

`read_next_node( )` returns a node object (initial when the document ends). Down-cast based on `type`.

| On `node->type` | Down-cast to | Members |
|---|---|---|
| `co_nt_element_open` | `if_sxml_open_element` | `qname-name`, `get_attributes( )` |
| `co_nt_element_close` | `if_sxml_close_element` | `qname-name` |
| `co_nt_value` | `if_sxml_value_node` | `value_type`, `get_value( )` |

Attribute objects expose `qname-name`, `value_type`, and `get_value( )`. Value type constants live in `if_sxml_value` (e.g. `co_vt_text`).

```abap
DATA(reader_oo) = cl_sxml_string_reader=>create( xml_to_parse ).
TRY.
    DO.
      DATA(node_oo) = reader_oo->read_next_node( ).
      IF node_oo IS INITIAL.
        EXIT.
      ENDIF.

      CASE node_oo->type.
        WHEN if_sxml_node=>co_nt_element_open.
          DATA(open_element) = CAST if_sxml_open_element( node_oo ).
          DATA(name)         = open_element->qname-name.
          DATA(attributes)   = open_element->get_attributes( ).
          LOOP AT attributes INTO DATA(attribute).
            DATA(attr_name) = attribute->qname-name.
            DATA(attr_val)  = SWITCH #( attribute->value_type
              WHEN if_sxml_value=>co_vt_text THEN attribute->get_value( ) ).
          ENDLOOP.

        WHEN if_sxml_node=>co_nt_element_close.
          DATA(close_element) = CAST if_sxml_close_element( node_oo ).

        WHEN if_sxml_node=>co_nt_value.
          DATA(value_node) = CAST if_sxml_value_node( node_oo ).
          DATA(text) = SWITCH #( value_node->value_type
            WHEN if_sxml_value=>co_vt_text THEN value_node->get_value( ) ).
      ENDCASE.
    ENDDO.
  CATCH cx_sxml_state_error INTO DATA(err).
ENDTRY.
```

---

## sXML as CALL TRANSFORMATION source/target

An sXML reader can be the source and an sXML writer the result of `CALL TRANSFORMATION` (see [transformations.md](transformations.md)):

```abap
"sXML reader as transformation source
DATA(sxml_reader) = cl_sxml_string_reader=>create( xml_xstr ).
CALL TRANSFORMATION id SOURCE XML sxml_reader RESULT XML DATA(out).

"sXML writer as transformation target
DATA(sxml) = CAST if_sxml_writer( cl_sxml_string_writer=>create(
                     type = if_sxml=>co_xt_xml10 encoding = 'UTF-8' ) ).
CALL TRANSFORMATION id SOURCE itab = tab RESULT XML sxml.
DATA(xml_xstr) = CAST cl_sxml_string_writer( sxml )->get_output( ).
```

---

## More information

- **sXML library:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabap_sxml_lib.htm
- **JSON-XML:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabap_json_xml.htm
- **ABAP and JSON:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabap_json.htm
