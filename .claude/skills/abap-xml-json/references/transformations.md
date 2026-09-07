# CALL TRANSFORMATION, ST, XSLT, asXML / asJSON — Reference

Full reference for ABAP transformations between ABAP data and XML/JSON. All syntax is copied from the SAP-samples `abap-cheat-sheets` (21_XML_JSON.md). For ST/XSLT element details, see the ABAP Keyword Documentation links at the end.

---

## CALL TRANSFORMATION — full syntax

`CALL TRANSFORMATION` runs an XSL Transformation or Simple Transformation. The transformation maps between ABAP data and an XML/JSON format. With XSLT (including `ID`), ABAP data on the source/result side is implicitly mapped to/from the canonical **asXML** (or **asJSON**) format first, and that intermediate format is the actual transformation source.

### Specifying the transformation

```abap
"Static name of an XSLT or ST repository object
CALL TRANSFORMATION zsome_transformation SOURCE ... RESULT ...

"Predefined identity transformation ID (reads/writes asXML and asJSON)
CALL TRANSFORMATION id SOURCE ... RESULT ...

"Dynamic specification — raises cx_invalid_transformation if it does not exist
TRY.
    CALL TRANSFORMATION ('ID') SOURCE ... RESULT ...
  CATCH cx_invalid_transformation.
    ...
ENDTRY.
```

### Source side

**Transforming XML data — `SOURCE XML src`.** Options for `src`:
- Data object of type `string` or `xstring` containing XML data in XML 1.0 format
- Standard table with a flat character-like or byte-like line type
- Certain references to iXML and sXML libraries, e.g. an interface reference variable of type `if_sxml_reader`

```abap
CALL TRANSFORMATION ... SOURCE XML src RESULT ...
```

**Transforming ABAP data — no `XML` keyword after `SOURCE`.** Options:
- One or multiple ABAP data objects as a static parameter list, e.g. `z1 = abap1 z2 = abap2 ...`. With XSLT (such as `ID`) the data is serialized to asXML depending on the target. `z1` etc. are the names of XML elements.
- Dynamic specification via an internal table of type `abap_trans_srcbind_tab`.

```abap
CALL TRANSFORMATION ... SOURCE z1 = abap1 ... RESULT ...

DATA(lt_srctab) = VALUE abap_trans_srcbind_tab( ( name = 'A' value = REF #( lv_b ) ) ( ... ) ).
CALL TRANSFORMATION ... SOURCE (lt_srctab) RESULT ...
```

### Result side

**Transforming to XML data — `RESULT XML res`.** Options for `res`:
- Data object of type `string` or `xstring`
- Data object declared inline (`DATA(xml_result)` / `FINAL(xml_result)`) — then has type `xstring`
- Standard table with a flat character-like or byte-like line type
- References for objects in iXML and sXML (e.g. sXML writers)

```abap
CALL TRANSFORMATION ... SOURCE ... RESULT XML res.
```

**Transforming to ABAP data — no `XML` keyword after `RESULT`.** Options:
- Multiple ABAP data objects as a static parameter list (`y1 = abap1 ...`)
- An internal table of type `abap_trans_resbind_tab`

```abap
CALL TRANSFORMATION ... SOURCE ... RESULT y1 = abap1 ...

DATA(lt_restab) = VALUE abap_trans_resbind_tab( ( name = 'A' value = REF #( lv_b ) ) ( ... ) ).
CALL TRANSFORMATION ... SOURCE ... RESULT (lt_restab).
```

### JSON additions

`SOURCE JSON` and `RESULT JSON` make JSON the format directly (JSON is processed internally as JSON-XML). JSON sources are also handled implicitly when passed after `SOURCE XML`.

```abap
"ABAP (elementary) -> JSON
DATA lv_num TYPE i VALUE 123.
CALL TRANSFORMATION id SOURCE var = lv_num RESULT JSON DATA(lv_json).

"JSON -> ABAP (elementary)
DATA lv_int TYPE i.
CALL TRANSFORMATION id SOURCE JSON lv_json RESULT var = lv_int.

"ABAP (structure) -> JSON / back
CALL TRANSFORMATION id SOURCE structure = ls_struct RESULT JSON lv_json.
CALL TRANSFORMATION id SOURCE JSON lv_json RESULT structure = ls_struct2.

"ABAP (internal table) -> JSON / back
CALL TRANSFORMATION id SOURCE table = lt_itab RESULT JSON lv_json.
CALL TRANSFORMATION id SOURCE JSON lv_json RESULT table = lt_itab2.

"ABAP (data reference) -> JSON / back
DATA lr_dref TYPE REF TO string.
lr_dref = NEW #( `ABAP` ).
CALL TRANSFORMATION id SOURCE ref = lr_dref RESULT JSON lv_json.
CALL TRANSFORMATION id SOURCE JSON lv_json RESULT ref = lr_dref2.
```

### Further additions

- `OPTIONS` — predefined transformation options, e.g. `OPTIONS xml_header = 'NO'` to suppress the `<?xml ...?>` declaration.
- `PARAMETERS` — bind parameters for XSLT/ST.
- Catchable exceptions: see the *Catchable Exceptions* section of the `CALL TRANSFORMATION` doc (e.g. `cx_invalid_transformation`, `cx_transformation_error`, `cx_st_*`, `cx_xslt_*`).

```abap
CALL TRANSFORMATION id SOURCE itab = lt_tab RESULT XML lt_chartab OPTIONS xml_header = 'NO'.
```

---

## Possible transformation categories

| Transformation  | XSLT  | ST |
|---|---|---|
| XML <-> XML  | X  | - |
| ABAP <-> XML | X  | X |
| ABAP <-> ABAP | X  | - |

- **XSLT** — repository objects written in XSLT. XSLT processes ABAP data because the data is first implicitly transformed into asXML; that asXML is the actual transformation source.
- **Identity transformation `ID`** — predefined XSLT named `ID`. Reads and writes the asXML (and asJSON) format. When called, the intermediate asXML/asJSON is the direct output. It does **not** change the structure of your data; write your own XSLT/ST to reshape.
- **Simple Transformation (ST)** — repository objects in an SAP-specific language for transformations between XML formats and ABAP data.

---

## asXML and asJSON

### asXML — ABAP Serialization XML

- Describes the format of XML data created when serializing ABAP data (ABAP → XML) with the identity transformation.
- This format is a **prerequisite for deserializations** (XML → ABAP) using identity transformations.
- Used as an intermediate format that defines a mapping between ABAP data and XML.
- Therefore, to deserialize XML data in ABAP, you must first transform it into asXML.

Example asXML for an ABAP value (root wrapper produced by `ID`):

```xml
<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <STRING>Hello World</STRING>
  </asx:values>
</asx:abap>
```

### asJSON

- The canonical JSON representation of ABAP data, used by the identity transformation for JSON.
- JSON is processed in **JSON-XML** form (an SAP-specific mapping of JSON onto XML), which is why all XML transformation categories are also available for JSON.

asJSON name convention — ABAP component names appear verbatim, in upper case:

```text
{"ITAB":[{"COMP1":1,"COMP2":"abc","COMP3":"X"},{"COMP1":2,"COMP2":"def","COMP3":""}]}
```

Formatted (writer options `co_opt_linebreaks` + `co_opt_indent`):

```text
{
 "ITAB":
 [
  {
   "COMP1":1,
   "COMP2":"abc",
   "COMP3":"X"
  }
 ]
}
```

`abap_boolean` (`abap_true`/`abap_false`) serializes as `"X"` / `""` under asJSON.

---

## Simple Transformations (ST) — basics

ST is an SAP-specific, declarative language. A single ST is **symmetric** — the same program serializes (ABAP → XML/JSON) and deserializes (XML/JSON → ABAP). It maps ABAP data to a fixed XML/JSON layout. Use ST when you have a known schema and need plain mapping; it is faster and simpler than XSLT for that.

Core `tt:` (transformation template) elements:

| Element | Purpose |
|---|---|
| `<tt:transform>` | Root element of every ST program; declares the `tt` namespace. |
| `<tt:root name="...">` | Declares a root data root (the ABAP data passed via `CALL TRANSFORMATION ... SOURCE name = ...`). |
| `<tt:value ref="..."/>` | Binds an ABAP value (by reference into the data root) to the current XML position. |
| `<tt:loop ref="..." name="...">` | Iterates an internal table; `name` is the loop variable. |
| `<tt:attribute name="..." value-ref="..."/>` | Maps an ABAP value to an XML attribute. |
| `<tt:cond>` / `<tt:group>` | Conditional / grouped output. |
| `<tt:skip>` | Skip nodes during deserialization. |

Skeleton (illustrative — see ST doc/examples for full syntax):

```xml
<tt:transform xmlns:tt="http://www.sap.com/transformation-templates">
  <tt:root name="ROOT"/>
  <tt:template>
    <flight>
      <tt:loop ref=".ROOT" name="line">
        <row>
          <carrier><tt:value ref="$line.CARRIER"/></carrier>
        </row>
      </tt:loop>
    </flight>
  </tt:template>
</tt:transform>
```

---

## XSL Transformations (XSLT) — basics

XSLT is the full XSL transformation language. Use it when ST is not expressive enough: XML↔XML, ABAP↔ABAP, conditionals/loops over arbitrary nodes, or restructuring beyond a flat schema mapping. Because ABAP data arrives as asXML, an XSLT for ABAP↔XML transforms *the asXML*, not the raw ABAP.

Core XSLT constructs:

| Element | Purpose |
|---|---|
| `<xsl:transform version="1.0">` | Root; declares the `xsl` (and usually `asx`) namespaces. |
| `<xsl:template match="...">` | Rule fired for nodes matching an XPath pattern. |
| `<xsl:apply-templates select="..."/>` | Recurse into matching child nodes. |
| `<xsl:value-of select="..."/>` | Output the value of an XPath selection. |
| `<xsl:for-each select="...">` | Loop over a node set. |
| `<xsl:if test="..."/>` / `<xsl:choose>` | Conditional output. |
| `sap:` extension functions | SAP-specific helpers in the XSLT processor. |

Skeleton (illustrative):

```xml
<xsl:transform version="1.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:asx="http://www.sap.com/abapxml">
  <xsl:template match="/">
    <root>
      <xsl:apply-templates select="asx:abap/asx:values/*"/>
    </root>
  </xsl:template>
</xsl:transform>
```

> The demo XSLT/ST programs in the executable example are not role models for proper design — consult the XSLT/ST documentation for production templates.

---

## More information

- **CALL TRANSFORMATION:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapcall_transformation.htm
  - Examples: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abencall_transformation_abexas.htm
- **asXML:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabap_xslt_asxml.htm
- **asJSON:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabap_asjson.htm
- **ABAP and JSON transformations:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENABAP_JSON_TRAFOS.html
- **ST:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabap_st.htm · Examples: ?file=abenst_abexas.htm
- **XSLT:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabap_xslt.htm
- **SAP XSLT Processor Reference:** https://help.sap.com/docs/ABAP_PLATFORM_NEW/31bfc625c2674acdb9aa7547b62db9cc/3cb7463c32a3fe13e10000000a114084.html
- **Serializing class instances:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenasxml_class_instances.htm
