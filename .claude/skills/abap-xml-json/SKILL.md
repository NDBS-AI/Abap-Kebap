---
name: abap-xml-json
description: Use when serializing or deserializing XML or JSON in ABAP — converting ABAP data (structures, internal tables, objects, references) to and from XML or JSON and back. Covers CALL TRANSFORMATION (SOURCE/RESULT, SOURCE XML / RESULT XML, SOURCE JSON / RESULT JSON), the predefined identity transformation ID, asXML and asJSON intermediate formats, Simple Transformations (ST) and XSL Transformations (XSLT) and when to pick each, the sXML serial library (cl_sxml_string_writer / cl_sxml_string_reader, token-based and object-oriented readers/writers, JSON-XML), the iXML DOM library, JSON via the ID transformation, /ui2/cl_json (serialize/deserialize, format_output, pretty_mode, name_mappings, generate), and XCO JSON (xco_cp_json) for ABAP Cloud. Also for serializing IF_SERIALIZABLE_OBJECT instances, choosing between transformation / sXML / JSON class, and string<->xstring conversion for binary XML/JSON payloads.
---

# Working with XML and JSON in ABAP

## Overview

ABAP offers several layers for XML and JSON. From highest to lowest abstraction:

1. **`CALL TRANSFORMATION`** — declarative serialization/deserialization between ABAP data and XML or JSON. The predefined **identity transformation `ID`** maps ABAP data to the canonical **asXML** / **asJSON** format and back with no code. Custom **Simple Transformations (ST)** or **XSL Transformations (XSLT)** reshape the format.
2. **sXML** (Serial XML library) — token-based / object-based streaming readers and writers (`cl_sxml_string_reader` / `cl_sxml_string_writer`). Handles XML *and* JSON (the latter via the internal JSON-XML representation). Sequential, low memory — for large documents and fine-grained control.
3. **iXML** (Integrated XML library) — builds a full DOM tree in memory. Random access, supports DTDs. Higher memory cost; XML only.
4. **JSON-specific classes** — `/ui2/cl_json` (classic + most systems) and `xco_cp_json` (ABAP Cloud) for ergonomic JSON serialize/deserialize with formatting and name mapping.

**Core principle:** for ABAP↔XML and ABAP↔JSON round-trips, reach for `CALL TRANSFORMATION id` first — it is the canonical, zero-boilerplate path and the same statement does both directions. Drop to sXML only when you need streaming or token-level control; use a JSON class when you want camelCase/name-mapping ergonomics; use iXML only when you genuinely need a navigable DOM or DTDs.

## When to Use

- Convert an ABAP structure / internal table / object to JSON or XML and back — `CALL TRANSFORMATION id`.
- Reshape ABAP data into a *specific* XML/JSON layout (renamed elements, attributes, nesting) — a custom ST or XSLT.
- Stream a large XML/JSON document node by node without holding a DOM — sXML reader/writer.
- Produce camelCase JSON, pretty-print, or map ABAP field names to JSON names — `/ui2/cl_json` or `xco_cp_json`.
- Serialize/deserialize class instances — `CALL TRANSFORMATION id` with `IF_SERIALIZABLE_OBJECT`.
- Navigate / edit an XML document with random access or validate against a DTD — iXML.

**When NOT to use:**
- Plain string/`xstring` building and codepage conversion (no markup) → [abap-strings-regex](../abap-strings-regex/SKILL.md).
- Generic, type-unknown serialization driven by RTTI (e.g. `/ui2/cl_json=>generate`, then inspect with RTTS) → [abap-dynamic-programming](../abap-dynamic-programming/SKILL.md).
- Deciding which API is released for ABAP Cloud → [abap-cloud-development](../abap-cloud-development/SKILL.md).

## Decision guide — which API

| Goal | Use |
|---|---|
| ABAP ↔ XML, canonical mapping, no custom layout | `CALL TRANSFORMATION id ... RESULT XML` |
| ABAP ↔ JSON, canonical mapping | `CALL TRANSFORMATION id ... RESULT JSON` (or a JSON sXML writer as target) |
| ABAP → custom XML layout / XML ↔ XML | XSLT |
| ABAP ↔ custom XML or JSON layout (renamed/restructured) | Simple Transformation (ST) |
| Large document, streaming, token-level read/write | sXML (`cl_sxml_string_reader` / `cl_sxml_string_writer`) |
| Random access, edit a DOM tree, DTD validation | iXML (`cl_ixml_core`) |
| JSON with camelCase / pretty print / name mapping | `/ui2/cl_json` |
| JSON in ABAP Cloud (released, fluent builder) | `xco_cp_json` |
| Serialize an object instance | `CALL TRANSFORMATION id` + `IF_SERIALIZABLE_OBJECT` |

> XSLT can do XML↔XML, ABAP↔XML, ABAP↔ABAP. ST does only ABAP↔XML (and ABAP↔JSON). With XSLT (including `ID`), ABAP data is implicitly mapped to asXML/asJSON first, and that intermediate format is the actual transformation source.

## CALL TRANSFORMATION — the workhorse

One statement, both directions. The transformation name is `id` (predefined identity), a custom ST/XSLT name, or a dynamic `('NAME')`.

```abap
"Static name (ST or XSLT repository object)
CALL TRANSFORMATION zsome_transformation SOURCE ... RESULT ...

"Predefined identity transformation
CALL TRANSFORMATION id SOURCE ... RESULT ...

"Dynamic name — raises cx_invalid_transformation if it does not exist
TRY.
    CALL TRANSFORMATION ('ID') SOURCE ... RESULT ...
  CATCH cx_invalid_transformation.
ENDTRY.
```

**Source side:**
- `SOURCE XML src` — `src` *is* XML/JSON data: a `string`/`xstring` (XML 1.0), a flat char/byte standard table, or an `if_sxml_reader` reference. (JSON sources are handled implicitly — see below.)
- `SOURCE n1 = abap1 n2 = abap2 ...` — ABAP data objects; `n1` etc. become XML element names. ABAP is serialized to asXML/asJSON.
- `SOURCE (srctab)` — dynamic, an `abap_trans_srcbind_tab`.

**Result side:**
- `RESULT XML res` — `res` receives the XML/JSON: `string`, `xstring`, inline `DATA(xml_result)` (becomes `xstring`), flat table, or an iXML/sXML writer reference.
- `RESULT n1 = abap1 ...` — deserialize into ABAP data objects.
- `RESULT (restab)` — dynamic, an `abap_trans_resbind_tab`.

```abap
"ABAP -> asXML (xstring), itab becomes the <ITAB> element name
CALL TRANSFORMATION id SOURCE itab = tab RESULT XML DATA(xml_xstr).

"Dynamic source binding
DATA(srctab) = VALUE abap_trans_srcbind_tab( ( name = 'ITAB' value = REF #( tab ) ) ).
CALL TRANSFORMATION id SOURCE (srctab) RESULT XML DATA(xml_b).

"asXML -> ABAP
DATA tab_b LIKE tab.
CALL TRANSFORMATION id SOURCE XML xml_xstr RESULT itab = tab_b.

"Dynamic result binding
DATA(restab) = VALUE abap_trans_resbind_tab( ( name = 'ITAB' value = REF #( tab_b ) ) ).
CALL TRANSFORMATION id SOURCE XML xml_xstr RESULT (restab).

"Suppress the XML declaration when writing to a flat table
CALL TRANSFORMATION id SOURCE itab = tab RESULT XML chartab OPTIONS xml_header = 'NO'.
```

> More additions exist: `PARAMETERS` (bind XSLT/ST parameters) and `OPTIONS` (e.g. `xml_header`). Use appropriate exception classes — see the `CALL TRANSFORMATION` doc. Full syntax in [references/transformations.md](references/transformations.md).

### asXML and asJSON

- **asXML** (*ABAP Serialization XML*) is the canonical XML produced when serializing ABAP data with `ID`. It is the **prerequisite for deserialization**: to deserialize arbitrary XML into ABAP, you must first bring it into asXML form (typically via a custom ST/XSLT). `ID` does not reshape your data — write your own ST/XSLT to do that.
- **asJSON** is the analogous canonical JSON representation. JSON is processed internally as **JSON-XML** (an SAP-specific mapping of JSON onto XML), which is why every XML transformation category is also available for JSON.

### Simple Transformations (ST) vs XSLT — when each

- **ST** — SAP-specific, declarative, ABAP↔XML and ABAP↔JSON only. Faster and simpler for plain serialization with a fixed layout. Symmetric: the same ST serializes and deserializes. Reach for ST when you map ABAP data to a known XML/JSON schema.
- **XSLT** — full XSL transformation language; can do XML↔XML and ABAP↔ABAP in addition to ABAP↔XML. Use when you need arbitrary restructuring, conditionals/loops over nodes, or pure XML-to-XML work that ST cannot express.

ST element basics (`tt:` namespace) and XSLT basics are in [references/transformations.md](references/transformations.md).

## sXML — streaming readers and writers

sXML processes documents **sequentially**, no DOM. Supports XML 1.0, XOP, binary XML, **and JSON**. Two styles: *token-based* (a method per node type) and *object-oriented* (wraps the tokens as node objects). The writer interface is `IF_SXML_WRITER`, the reader `IF_SXML_READER`; a cast is needed to reach the specialized methods.

```abap
"Token-based XML writer (UTF-8 XML 1.0)
DATA(writer) = CAST if_sxml_writer( cl_sxml_string_writer=>create(
                       type = if_sxml=>co_xt_xml10 encoding = 'UTF-8' ) ).
TRY.
    writer->open_element( name = 'flights' ).
    writer->open_element( name = 'flight' ).
    writer->open_element( name = 'carrier' ).
    writer->write_value( 'LH' ).
    writer->close_element( ).
    writer->close_element( ).
    writer->close_element( ).
  CATCH cx_sxml_state_error.
ENDTRY.
"Output is xstring; another cast to reach get_output
DATA(xml) = CAST cl_sxml_string_writer( writer )->get_output( ).
```

```abap
"Token-based reader — iterate every node with next_node
DATA(reader) = cl_sxml_string_reader=>create( xml_to_parse ).  "xstring in
DO.
  reader->next_node( ).
  IF reader->node_type = if_sxml_node=>co_nt_final.
    EXIT.
  ENDIF.
  "reader->node_type, reader->name, reader->value are directly available
  IF reader->node_type = if_sxml_node=>co_nt_element_open.
    DO.  "walk this element's attributes
      reader->next_attribute( ).
      IF reader->node_type <> if_sxml_node=>co_nt_attribute. EXIT. ENDIF.
      "reader->name / reader->value hold the attribute
    ENDDO.
  ENDIF.
ENDDO.
```

Node types live in `if_sxml_node`: `co_nt_element_open`, `co_nt_element_close`, `co_nt_value`, `co_nt_attribute`, `co_nt_final`, `co_nt_initial`. The object-oriented style uses `read_next_node( )` returning node objects you down-cast to `if_sxml_open_element`, `if_sxml_close_element`, `if_sxml_value_node`. Full API in [references/sxml.md](references/sxml.md); a streaming parse walk-through is in [examples/roundtrip.md](examples/roundtrip.md).

## JSON

### JSON via the identity transformation

`CALL TRANSFORMATION id` produces/consumes JSON either by targeting a JSON sXML writer or with the `SOURCE JSON` / `RESULT JSON` additions. CALL TRANSFORMATION handles JSON sources implicitly.

```abap
"ABAP -> JSON via a JSON writer
DATA str_a TYPE string VALUE `Hello`.
DATA(writer) = cl_sxml_string_writer=>create( type = if_sxml=>co_xt_json ).
CALL TRANSFORMATION id SOURCE hi = str_a RESULT XML writer.
DATA(json) = cl_abap_conv_codepage=>create_in( )->convert( writer->get_output( ) ).
"json: {"HI":"Hello"}

"JSON -> ABAP (source is JSON; handled implicitly)
DATA str_b TYPE string.
CALL TRANSFORMATION id SOURCE XML json RESULT hi = str_b.   "str_b: Hello

"Using the SOURCE JSON / RESULT JSON additions
DATA num TYPE i VALUE 123.
CALL TRANSFORMATION id SOURCE var = num RESULT JSON DATA(json2).  "{"VAR":123}
DATA int TYPE i.
CALL TRANSFORMATION id SOURCE JSON json2 RESULT var = int.        "int: 123
```

Format the JSON output by setting writer options before the call:

```abap
DATA(json_wr) = CAST if_sxml_writer( cl_sxml_string_writer=>create( type = if_sxml=>co_xt_json ) ).
json_wr->set_option( option = if_sxml_writer=>co_opt_linebreaks ).
json_wr->set_option( option = if_sxml_writer=>co_opt_indent ).
CALL TRANSFORMATION id SOURCE itab = it RESULT XML json_wr.
```

Field names come out **upper case** (`{"COMP1":1,...}`) — the asJSON convention. Use a JSON class below to get camelCase or custom names.

### /ui2/cl_json

Available in most systems (classic and many cloud-adjacent stacks). Static `serialize` / `deserialize`, with optional formatting and name mapping.

```abap
"ABAP -> JSON
DATA(json_str) = /ui2/cl_json=>serialize( data = itab ).
DATA(jp) = /ui2/cl_json=>serialize( data = itab format_output = abap_true ).
DATA(jc) = /ui2/cl_json=>serialize( data = itab
                                    format_output = abap_true
                                    pretty_name   = /ui2/cl_json=>pretty_mode-camel_case ).

"JSON -> ABAP (deserialize writes into a CHANGING target)
DATA result LIKE itab.
/ui2/cl_json=>deserialize( EXPORTING json = json_str CHANGING data = result ).

"Name mapping (ABAP field <-> JSON name)
/ui2/cl_json=>deserialize( EXPORTING json = json_str
  name_mappings = VALUE #( ( abap = 'CARR' json = `CARRIER_ID` )
                           ( abap = 'CONN' json = `CONNECTION_ID` ) )
  CHANGING data = itab4map ).

"JSON as xstring (jsonx), and 'generate' when no ABAP type exists
/ui2/cl_json=>deserialize( EXPORTING jsonx = json_xstring CHANGING data = result ).
DATA(dref) = /ui2/cl_json=>generate( json = some_json ).  "RETURNING ref to data
```

`generate` yields a generic `REF TO data` you can inspect via RTTS — see [abap-dynamic-programming](../abap-dynamic-programming/SKILL.md).

### XCO JSON (xco_cp_json) — ABAP Cloud

Released for ABAP Cloud; fluent API. `from_abap`/`to_string`, `from_string`/`write_to`, a builder, and `transformation` name-style conversions.

```abap
"ABAP -> JSON
DATA(json_struc) = xco_cp_json=>data->from_abap( carrier_struc )->to_string( ).
DATA(json_tab)   = xco_cp_json=>data->from_abap( carriers_tab )->to_string( ).

"JSON -> ABAP (write_to takes a data reference)
xco_cp_json=>data->from_string( json_struc )->write_to( REF #( target_struc ) ).

"Fluent builder
DATA(builder) = xco_cp_json=>data->builder( ).
builder->begin_object(
  )->add_member( 'CarrierId' )->add_string( 'DL'
  )->add_member( 'ConnectionId' )->add_string( '1984'
  )->end_object( ).
DATA(built) = builder->get_data( )->to_string( ).

"Apply a name transformation while reading (PascalCase -> underscore)
xco_cp_json=>data->from_string( built )->apply( VALUE #(
  ( xco_cp_json=>transformation->pascal_case_to_underscore ) ) )->write_to( REF #( target_struc ) ).
```

## Serializing objects

Class instances serialize via `CALL TRANSFORMATION id` once the class implements `IF_SERIALIZABLE_OBJECT`. By default all instance attributes are (de)serialized.

```abap
CLASS zcl_demo DEFINITION ... .
  PUBLIC SECTION.
    INTERFACES if_serializable_object.
    DATA timestamp TYPE utclong.
ENDCLASS.

DATA(oref) = NEW zcl_demo( ).
oref->timestamp = utclong_current( ).
CALL TRANSFORMATION id SOURCE obj = oref RESULT XML DATA(serialized_obj).  "xstring (inline declaration)

DATA deserialized TYPE REF TO zcl_demo.
CALL TRANSFORMATION id SOURCE XML serialized_obj RESULT obj = deserialized.
```

To customize, implement the **private instance** methods `SERIALIZE_HELPER` (output params only) and `DESERIALIZE_HELPER` (input params only) — both or neither. Same-named, same-typed parameters on each. Use them to exclude attributes from (de)serialization.

## ABAP Cloud notes

- **Released / preferred in ABAP Cloud:** `CALL TRANSFORMATION` with `ID` (and released ST/XSLT), the sXML classes (`cl_sxml_string_writer`/`reader`), `xco_cp_json`, `cl_abap_conv_codepage`, `cl_abap_gzip`. The iXML snippets in the cheat sheet use the cloud-enabled iXML classes (`cl_ixml_core`).
- `xco_cp_json` is the cloud-recommended JSON class. `/ui2/cl_json` is widely available but confirm its release state for your target. Verify with [abap-cloud-development](../abap-cloud-development/SKILL.md).

## string <-> xstring for payloads

XML/JSON serialization frequently produces or consumes `xstring`. Convert with a codepage (UTF-8 default).

```abap
"string -> xstring
DATA(xstr) = cl_abap_conv_codepage=>create_out( )->convert( `<TXT>ABAP</TXT>` ).
"xstring -> string
DATA(str)  = cl_abap_conv_codepage=>create_in( )->convert( xstr ).

"XCO alternative
DATA(xstr_xco) = xco_cp=>string( `<TXT>ABAP</TXT>` )->as_xstring( xco_cp_character=>code_page->utf_8 )->value.
```

See [abap-strings-regex](../abap-strings-regex/SKILL.md) for the string layer. For very large payloads, compress with `cl_abap_gzip=>compress_binary` / `decompress_binary`.

## Common Mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| Expecting `ID` to rename/restructure elements | Output is the canonical asXML/asJSON only | Write a custom ST or XSLT |
| Deserializing arbitrary XML straight into ABAP with `ID` | Fails — `ID` needs asXML | Transform to asXML first (custom ST/XSLT) |
| Forgetting the cast to `cl_sxml_string_writer` for `get_output` | Method not visible on `if_sxml_writer` | `CAST cl_sxml_string_writer( writer )->get_output( )` |
| Reading sXML output as `string` directly | It is `xstring` | Convert with `cl_abap_conv_codepage` |
| Surprised JSON field names are UPPER CASE | asJSON uses ABAP names verbatim | `/ui2/cl_json` `pretty_mode` / `xco_cp_json` transformations |
| Using iXML for a big document only to stream it | High DOM memory cost | Use sXML |
| `/ui2/cl_json=>deserialize` with `RETURNING`-style call | It uses `CHANGING data = ...` | Pass the target via `CHANGING` |
| No `IF_SERIALIZABLE_OBJECT` on a class you serialize | Transformation fails | Implement the interface |
| Implementing only one of the helper methods | Compile/behaviour error | Implement `SERIALIZE_HELPER` and `DESERIALIZE_HELPER` together or neither |

## References

- [references/transformations.md](references/transformations.md) — `CALL TRANSFORMATION` full syntax, ST (`tt:`) element reference, XSLT basics, asXML/asJSON formats.
- [references/sxml.md](references/sxml.md) — the sXML reader/writer API, node/token types, methods, for XML and JSON.
- [examples/roundtrip.md](examples/roundtrip.md) — runnable ABAP↔JSON round-trips (ID transformation and `/ui2/cl_json`) and an sXML streaming parse.
- **ABAP and XML (Keyword Documentation):** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabap_xml.htm
- **CALL TRANSFORMATION:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapcall_transformation.htm
- **asXML / asJSON:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabap_xslt_asxml.htm · https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabap_asjson.htm
- **sXML / ST / XSLT:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabap_sxml_lib.htm · ?file=abenabap_st.htm · ?file=abenabap_xslt.htm
- **XCO library:** https://help.sap.com/docs/btp/sap-business-technology-platform/xco-library?version=Cloud
- **SAP-samples/abap-cheat-sheets:** https://github.com/SAP-samples/abap-cheat-sheets (21_XML_JSON.md)
- Linked skills: [abap-strings-regex](../abap-strings-regex/SKILL.md), [abap-dynamic-programming](../abap-dynamic-programming/SKILL.md), [abap-cloud-development](../abap-cloud-development/SKILL.md)
