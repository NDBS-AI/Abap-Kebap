# DDIC Objects — Reference Catalog

Lookup material for DDIC object types and their settings. The built-in type table, table-field rules, and source syntax come verbatim from the SAP `abap-cheat-sheets` *26 ABAP Dictionary*. The classic technical-setting catalogs (delivery class, data class, size category, buffering, conversion routines, search-help types) are standard SAP DDIC values — relevant chiefly for classic ABAP and maintenance contexts; in ABAP for Cloud Development prefer CDS-based successors.

---

## Built-in ABAP Dictionary types (selection)

In data definitions, reference these as `abap.<type>`; length/decimals in parentheses. They are **not** directly usable in ABAP (except as typed literals in ABAP SQL); they map to ABAP types.

| Built-in DDIC type | Maps to ABAP | Notes |
|---|---|---|
| `int1` / `int2` / `int4` / `int8` | `b` / `s` / `i` / `int8` | Integers of increasing width |
| `dec(len,dec)` | `p` (packed) | Output length includes decimal point and sign if used (e.g. `dec(5,2)` → output 6, +sign → 7) |
| `char(len)` | `c` (fixed) | Max 1333 in tables/CDS elements |
| `clnt` | `c` length 3 | Client column; special semantics; key field of client-dependent tables |
| `string` | `string` | Variable length, CLOB-like; **no upper limit**; **cannot be a key field**; in tables a max length ≥ 256 may be set |
| `sstring` | `string` | Short string, max 1333; handled like `char`; **can be a key field** (trailing blanks removed) |
| `numc` | `n` | Numeric text |
| `datn` / `timn` | `d` / `t` | Preferred; `dats`/`tims` are older and need conversion |
| `dats` / `tims` | `d` / `t` | Older date/time types |
| `utclong` | `utclong` | Time stamp |
| `raw(len)` | `x` (fixed) | Byte string |
| `rawstring` | `xstring` | Variable byte string; **cannot be a key field** |
| `curr(len,dec)` | `p` | Currency amount — **requires a `cuky` reference field** |
| `quan(len,dec)` | `p` | Quantity — **requires a `unit` reference field** |
| `cuky` | `c` | Currency key (reference for `curr`) |
| `unit` | `c` | Unit of measure (reference for `quan`) |

Length specification examples: `abap.char(3)`, `abap.curr(8,2)`, `abap.dec(8,2)`, `abap.int4`, `abap.string(0)` (0 = unrestricted; `abap.string(256)` = capped at 256, checked on read/write).

Predefined data elements share the built-in type name and **are** usable in ABAP: `int1`, `int2`, `int4`, `d16n`, `d34n`, `datn`, `timn`, `utcl`, `abap_boolean`, …

---

## Database table — catalog (`@AbapCatalog`) annotations

From the cheat sheet; added by default on a new table.

| Annotation | Default | Purpose |
|---|---|---|
| `@EndUserText.label : '…'` | — | Short description |
| `@AbapCatalog.enhancement.category : #…` | `#NOT_EXTENSIBLE` | Enhanceability (`CTRL+Space` after `#` for options) |
| `@AbapCatalog.tableCategory : #…` | `#TRANSPARENT` | Table category |
| `@AbapCatalog.deliveryClass : #…` | `#A` | Delivery class (transport of data) |
| `@AbapCatalog.dataMaintenance : #…` | `#RESTRICTED` | Display/maintenance (Data Preview); other values e.g. `#ALLOWED`, `#NOT_ALLOWED` |

### Table-field rules (verbatim constraints)

- Field names must be **unique**.
- **Not allowed** as fields: reference types, substructures, table types.
- One or more **key fields at the beginning**; key fields cannot be `string` or `rawstring`.
- `NOT NULL` is always set for key fields (no null value).
- First column typically `client : abap.clnt not null` → client-dependent table.
- `curr` / `quan` fields require reference fields (see below).
- Typed with built-in types or data elements; non-nested structures may be `include`d.

---

## Delivery class

Controls transport of table **data** during installation, upgrade, client copy, transport.

| Class | Meaning |
|---|---|
| `A` | Application table — master and transaction data (cheat-sheet default) |
| `C` | Customizing table — maintained by the customer |
| `L` | Table for temporary data |
| `G` | Customizing table, SAP delivers entries (customer may add in own namespace) |
| `E` | System table, SAP and customer have separate key ranges |
| `S` | System table — maintained by SAP only |
| `W` | System table for system administration data |

---

## Data class

Physical area (tablespace) of the table. On HANA the physical impact is reduced, but the classification remains.

| Data class | Typical use |
|---|---|
| `APPL0` | Master data — read often, changed rarely |
| `APPL1` | Transaction data — changed frequently |
| `APPL2` | Organizational / customizing data — changed rarely |
| `USR` / `USR1` | Customer-reserved tablespaces |

---

## Size category

Estimated number of rows; sizes the initial DB extent. Larger category → larger initial space.

| Category | Indicative row count |
|---|---|
| `0` | Up to a few thousand |
| `1` | Several thousand |
| `2` | Tens of thousands |
| `3` | Hundreds of thousands |
| `4` (and higher) | Millions+ |

The category is an order-of-magnitude hint, not a hard limit; the DB grows as needed.

---

## Buffering

Two decisions: **whether** to buffer, and **which buffering type**.

### Buffering activation

| Setting | Meaning |
|---|---|
| Buffering **switched off** | Never buffered |
| Buffering **allowed but switched off** | May be activated later (e.g. by an administrator) without a change to the table |
| Buffering **switched on** | Active; choose a buffering type below |

### Buffering type

| Type | What is held in the buffer | Best for |
|---|---|---|
| **Single-record** | Only individual rows read by **full key** | Large table, accessed by full key, few rows touched |
| **Generic** (depth *n*) | All rows sharing the leading *n* key fields of an accessed key | Reads cluster on a key prefix (e.g. client + category) |
| **Full** | The **entire** table | Small, read-mostly, rarely-changed tables |

### When to buffer / not

- **Buffer:** small, frequently read, rarely changed — configuration, text, type, customizing tables.
- **Do not buffer:** large tables; write-heavy tables; tables that must always return the latest committed data.
- **Buffer bypass:** the table buffer is bypassed by `SELECT ... BYPASSING BUFFER`, by joins, aggregates, `ORDER BY`, subqueries, and access via DB views. Plan accordingly — see `abap-sql-performance`.

---

## Conversion routines

A conversion routine (named `CONVERSION_EXIT_<name>_INPUT` / `_OUTPUT`) attaches to a **domain** (or directly to a data element) and converts between internal storage format and external display format. Examples of common routines:

| Routine | Converts |
|---|---|
| `ALPHA` | Leading-zero padding for numeric-looking char fields (e.g. document numbers) |
| `EXPDT` | Date display formatting |
| `ISOLA` | Language key ISO ↔ internal |
| `MATN1` | Material number formatting |
| `CUNIT` | Unit of measure ISO ↔ internal |

In Cloud, value formatting is increasingly handled via CDS annotations and framework metadata rather than classic conversion exits; legacy routines remain on many delivered domains.

---

## Search help types (classic stack)

| Type | Definition | Use |
|---|---|---|
| **Elementary** | One selection method (table/view) + import/export parameters + dialog behavior | A single value list |
| **Collective** | Bundles several elementary search helps under one entry point | Multiple alternatives for one field |
| **Search help exit** | A function module hooked into the search-help process | Custom runtime behavior (filtering, defaults) |

**Cloud successor:** CDS-based search helps — a CDS view annotated for value help and bound via `@Consumption.valueHelpDefinition` or a search-help association. Classic dynpro search helps are not relevant/released in ABAP for Cloud Development. See `cds-views-authoring`.

---

## Table types — properties

| Property | Options |
|---|---|
| **Line type** | Elementary, reference, or structured (DDIC structure / DB table). **CDS entities not allowed.** |
| **Table category** | Standard, Sorted, Hashed, or generic index (Index table for standard/sorted) |
| **Primary key** | Empty / Standard / Key components; Unique or Non-unique |
| **Secondary key** | Optional; e.g. Unique Sorted over selected components |
| **Key alias** | Optional alias name for a key |

A table type with an elementary line type, length 0, corresponds to the released `string_table`.

---

## DDIC structure — component kinds

| Component kind | Syntax example |
|---|---|
| Elementary (built-in) | `bt_elem1 : abap.char(5);` |
| Elementary (data element) | `dtel_elem1 : land1;` |
| Currency (needs ref) | `curr : abap.curr(8,2);` + `@Semantics.amount.currencyCode : 'struc.cuky'` |
| Data reference (built-in) | `dref1 : reference to abap.char(3);` |
| Data reference (generic) | `dref3 : reference to data;` |
| Object reference (class) | `oref1 : reference to cl_abap_math;` |
| Object reference (generic) | `oref2 : reference to object;` |
| Interface reference | `iref : reference to if_oo_adt_classrun;` |
| Substructure (table/struct) | `struc1 : zdemo_abap_tab1;` |
| Include | `include zdemo_abap_carr;` |
| Include with suffix | `include zdemo_abap_fli with suffix _in;` |
| Table type | `tab1 : string_table;` |

Includes require a suffix when two would collide on identically named components.

---

## Currency / quantity reference fields

| Amount field | Reference field needed | Semantics annotation |
|---|---|---|
| `curr` (CURR) | `cuky` (CUKY) currency key | `@Semantics.amount.currencyCode : '<table_or_struc>.<cuky_field>'` |
| `quan` (QUAN) | `unit` (UNIT) unit of measure | `@Semantics.quantity.unitOfMeasure : '<table_or_struc>.<unit_field>'` |

The reference field must exist in the same table/structure. Without the annotation the `curr`/`quan` field cannot be activated. ADT offers a quick fix to insert it.

---

## DDIC vs CDS — successor map

| DDIC object | Modern CDS successor | When the successor wins |
|---|---|---|
| Classic DDIC view | CDS view entity | Always — classic views are obsolete |
| Data element | CDS simple type | New elementary types; can still wrap a data element |
| Domain (fixed values) | CDS enumerated type | New fixed-value sets |
| Structure | CDS abstract entity | When modeling for RAP |
| Search help | CDS-based search help | Always in Cloud |
| Database table | DDIC table **or** CDS table entity | Persistence still required — CDS views never persist |
| Lock object (dynpro) | — | Not relevant in Cloud |
</content>
