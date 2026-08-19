---
name: abap-dictionary-ddic
description: "Use when working with the ABAP Dictionary (DDIC) — defining database tables, data elements, domains, structures, table types, or search helps; setting technical settings (delivery class, data class, size category, buffering); handling currency/quantity fields with their CUKY/UNIT reference fields; choosing built-in DDIC types vs ABAP types; or deciding whether to model something in DDIC or in ABAP CDS. Triggers: ABAP Dictionary, DDIC, database tables, data elements, domains, structures, table types, search helps, technical settings, buffering, currency field, quantity field, DDIC vs CDS, released DDIC, ADT table definition."
---

# ABAP Dictionary (DDIC) — Authoring Guide

## Overview

The ABAP Dictionary (DDIC) is ABAP's persistent repository of global type definitions. Its objects — database tables, data elements, domains, structures, table types, search helps — are *global types* accessible by every other repository object (CDS, ABAP programs, other DDIC objects), subject to the package concept.

**Core principle:** DDIC is the *single source of truth* for a type. Define a type once; reference it everywhere. A change to a domain ripples — through every data element that uses it, every table field, every CDS element, every ABAP `TYPES`/`DATA` that references it. That power is also the hazard: before changing a shared DDIC object, run *Get Where-Used List* in ADT.

**Modern guidance:** In ABAP Cloud / ABAP for Cloud Development, many classic DDIC objects (classic views, classic search helps, lock objects bound to dynpros) are obsolete or unsupported. Prefer ABAP CDS-based successors for new development — but **DDIC database tables remain the persistence layer.** CDS sits on top of tables; it never replaces them for storage.

## When to Use

- Creating the **persistence** for an application — a database table to store data.
- Defining a **reusable elementary type** (data element + domain) shared across tables, CDS, and ABAP.
- Defining a **structured type** (DDIC structure) or **internal-table type** (DDIC table type) to be referenced globally.
- Adding a **search help** / value list (classic stack) — though in Cloud prefer CDS-based search helps.
- Reviewing a table's **technical settings**: delivery class, data class, size category, buffering.

**When NOT to use:**
- For a **read model / projection** over existing tables — use a CDS view ([cds-views-authoring](../cds-views-authoring/SKILL.md)). CDS is read-only; it does not persist.
- For a **local, single-program type** — a `TYPES` statement in the program is enough; don't pollute the global namespace.
- For **classic-only objects in ABAP Cloud** (classic DDIC views, dynpro search helps, maintenance views) — they are not released; use CDS-based successors.

## DDIC object types — overview

| Object | Defines | Used as | Cloud successor |
|---|---|---|---|
| **Database table** | A physical table in the DB + its structured type | Persistence; structured type in ABAP/CDS | Still the persistence layer (also CDS table entities) |
| **Data element** | An elementary or reference type + semantics (labels, docs) | Field types in tables, components, `TYPES`/`DATA` | CDS simple type |
| **Domain** | Technical type + value range, reused by data elements | Building block for data elements only | CDS enumerated type (for fixed values) |
| **Structure** | A structured type (flat / nested / deep) | Type for tables, components, ABAP structures | CDS abstract entity (for RAP modeling) |
| **Table type** | An internal-table type (line type + category + key) | `TYPES`/`DATA` for internal tables | — (still used) |
| **Search help** | A value list for input fields | Value help (classic stack) | CDS-based search help / `@Consumption.valueHelp` |

DDIC can define **elementary types** (data elements describing built-in/elementary and reference types), **structured types** (structures, and the structured types that tables also represent), and **table types**. They provide the same functionality as local types defined with `TYPES` in a program — but global.

## Built-in DDIC types vs ABAP types

Built-in ABAP Dictionary types are the foundation for every elementary type in every repository object. **They cannot be used directly in ABAP** (e.g. to type a local data object) — except inside ABAP SQL via typed literals. In ABAP programs the built-in dictionary types map to corresponding ABAP types. In data-definition languages you reference them as `abap.type`.

| Built-in DDIC type | ABAP type | Notes |
|---|---|---|
| `int4` | `i` | 4-byte integer (also `int1`, `int2`, `int8`) |
| `char` | `c` (fixed length) | Max 1333 in tables/CDS elements. `clnt` is the special client column, mapped to `c` length 3 |
| `string` | `string` | Variable length, CLOB-like; **cannot be a key field**. `sstring` (max 1333) is handled like `char` and *can* be a key |
| `datn` / `timn` | `d` / `t` | Preferred over older `dats`/`tims`, which need conversion |
| `utclong` | `utclong` | Time stamp |
| `numc` | `n` | Numeric text |
| `raw` / `rawstring` | `x` / `xstring` | Byte strings; `rawstring` cannot be a key field |
| `dec`, `curr`, `quan`, `cuky`, `unit` | `p` / `c` | Packed/currency/quantity/key fields (see currency & quantity below) |

In data definitions, length/decimals go in parentheses: `abap.char(3)`, `abap.curr(8,2)`, `abap.dec(8,2)`, `abap.string(0)` (0 = unrestricted, 256 = capped at 256).

```abap
"Built-in DDIC types map to ABAP types via data elements that share the name:
DATA int4_val TYPE int4.    "-> i
DATA date_val TYPE datn.    "-> d
DATA utc_val  TYPE utcl.    "-> utclong

"A built-in DDIC type CANNOT be used directly in ABAP:
"DATA raw_val TYPE rawstring.   "not possible
"Local types hide identically named global types:
TYPES rawstring TYPE xstring.
DATA raw_val TYPE rawstring.
```

See [references/objects-catalog.md](references/objects-catalog.md) for the full built-in type table.

## Data elements

A data element creates an **elementary or reference type** plus semantic properties.

- **Technical properties** — either specified directly (predefined type: built-in type + length/decimals) or **inherited from a domain**.
- **Reference types** — a data element can be `REFERENCE TO` a DDIC type / built-in type / generic `data`, or to a class/interface / generic `object`. Reference types **cannot type database table fields**.
- **Semantic properties** — field labels (Short / Medium / Long / Heading). The **Medium Text label is exposed to OData.** Documentation can be attached. Some semantics apply only to classic UIs and are unavailable in Cloud.

Three flavours (from the cheat sheet's examples):

| Category | Source | Example |
|---|---|---|
| Predefined type | built-in DDIC type + length | `CHAR`, length 3 |
| Domain | a domain name | based on `ZDEMO_ABAP_DOMA` |
| Reference to predefined type | built-in type as reference | `REFERENCE TO` `CHAR(10)` |

```abap
"Using data elements for local types and data objects
TYPES ty_dtel1 TYPE zdemo_abap_dtel_pr.    "based on a built-in dict. type
DATA char3_dtel TYPE zdemo_abap_dtel_pr.

TYPES ty_dtel2 TYPE zdemo_abap_dtel_do.    "based on a domain
DATA char1_dtel TYPE zdemo_abap_dtel_do.

TYPES ty_dtel3 TYPE zdemo_abap_dtel_ref.   "based on a reference type
DATA char10_dtel_ref TYPE zdemo_abap_dtel_ref.
```

**Successor:** CDS simple types are the successors of data elements; a CDS simple type can be based on a built-in CDS type, a DDIC data element (inheriting its properties), or another simple type.

## Domains

A domain is a **standalone** object defining technical + semantic properties that **multiple data elements reuse**. When a data element references a domain, it inherits the domain's properties.

- Domains define **data type + length/output length** and optionally a **value range** (fixed values or intervals) and a **conversion routine**.
- Domains **cannot** be used to declare types/data objects with `TYPES`/`DATA`, and cannot be reused in any repository object **other than data elements**.
- Value ranges drive input checks in classic UIs (not supported in Cloud), but **fixed values can still be used for value helps in CDS views.**

**Successor:** CDS enumerated types offer similar fixed-value functionality in modern ABAP.

See [references/objects-catalog.md](references/objects-catalog.md) for conversion-routine notes.

## Structures

A DDIC structure defines a **structured type**, composed of elementary, reference, structured, and table types — flat, nested, or deep. Structures can be reused in tables and to type ABAP structures, and can be **included** in other structures (optionally with a 3-character suffix).

Created from source with `DEFINE STRUCTURE`, preceded by annotations (`@EndUserText.label`, `@AbapCatalog.enhancement.category`).

```abap
@EndUserText.label : 'Demo flat DDIC structure'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
define structure zdemo_abap_struc_flat {

  chars : abap.char(3);
  num   : abap.int4;
  cuky  : abap.cuky;
  @Semantics.amount.currencyCode : 'zdemo_abap_struc_flat.cuky'
  curr  : abap.curr(8,2);
  id    : zdemo_abap_dtel_pr;     "data element
  flag  : zdemo_abap_dtel_do;

}
```

Component kinds available in a structure (from the deep-structure example):

- **Elementary** via data elements (`dtel_elem1 : land1;`) or built-in types (`bt_elem1 : abap.char(5);`).
- **Reference** — `dref1 : reference to abap.char(3);`, `reference to data;`, `oref1 : reference to cl_abap_math;`, `reference to object;`, `iref : reference to if_oo_adt_classrun;`.
- **Substructures** — a DDIC structure or **database table** as a component (`struc1 : zdemo_abap_tab1;`).
- **Includes** — `include zdemo_abap_carr;` or with suffix `include zdemo_abap_fli with suffix _in;`. A suffix is required when two includes would otherwise collide on identically named components.
- **Table types** — `tab1 : string_table;`.

## Table types

A DDIC table type describes an **internal table** (not a DB table). It is defined by:

- **Line type** — elementary, reference, or structured (a DDIC structure or DB table; **CDS entities are not allowed** as line type).
- **Table category** — standard, sorted, hashed, or generic index.
- **Table key** — primary key (empty / standard / components), plus optional secondary keys and an **alias**.

```abap
"Declaring internal tables / local table types from DDIC table types
TYPES ty_tab_elem  TYPE zdemo_abap_tt_str.   "elementary line type (~ string_table)
TYPES ty_tab_struc TYPE zdemo_abap_tt_so.    "flat line type, sorted, with keys
DATA  tab_struct1  TYPE zdemo_abap_tt_so.
```

A table type with an elementary line type and length 0 corresponds to the released `string_table`. A flat line type can be created sorted/unique with primary key components, a secondary unique-sorted key, and a key alias.

## Database tables

A DDIC database table describes a **physical table** in the standard database. When activated, a physical table with the same columns is created (column order may differ, allowing extra DDIC fields). A database table:

- has a non-nested structured type and **acts as a structured type** referenceable in ABAP;
- requires a **primary key** — one or more key fields at the beginning, uniquely identifying each row;
- is read/written via ABAP SQL (`SELECT`, `MODIFY`, `DELETE`, …).

**Field rules:**
- Field names must be unique; **reference types, substructures, and table types are not allowed** as fields.
- Key fields **cannot** be `string` / `rawstring`; `NOT NULL` is always set on key fields.
- The first column is typically `client : abap.clnt not null` (client-dependent table; delivery class A is generally client-dependent).
- `curr` and `quan` fields **require reference fields** (see below).
- Fields are typed with built-in types or data elements; non-nested structures can be **included**.

The default annotations added when creating a new table:

| Annotation | Purpose |
|---|---|
| `@EndUserText.label : '…'` | Short description |
| `@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE` | Whether the table can be enhanced (`CTRL+Space` after `#` for options) |
| `@AbapCatalog.tableCategory : #TRANSPARENT` | Table category — default transparent |
| `@AbapCatalog.deliveryClass : #A` | Delivery class — `A` = application table (master + transaction data) |
| `@AbapCatalog.dataMaintenance : #RESTRICTED` | Whether content can be displayed/maintained (Data Preview) |

```abap
@EndUserText.label : 'Demo DDIC database table'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table zdemo_abap_tabl1 {

  key client : abap.clnt not null;
  key num    : abap.int4 not null;
  chars      : abap.char(5);
  id         : zdemo_abap_dtel_pr;     "data element
  flag       : zdemo_abap_dtel_do;
  str        : abap.string(0);         "0 = unrestricted length
  cuky       : abap.cuky;
  @Semantics.amount.currencyCode : 'zdemo_abap_tabl1.cuky'
  curr       : abap.curr(8,2);

}
```

Including a structure avoids redeclaring fields:

```abap
@EndUserText.label : 'Demo DDIC database table'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table zdemo_abap_tabl2 {

  key client    : abap.clnt not null;
  key key_field : abap.int4 not null;
  include zdemo_abap_struc_flat;

}
```

### Technical settings — delivery class, data class, size, buffering

Beyond the source-level catalog annotations, a table carries **technical settings** (data class, size category, buffering). These govern *how* the table behaves physically. The values below are reference catalogs — see [references/objects-catalog.md](references/objects-catalog.md) for the complete tables.

- **Delivery class** — controls transport of *data* across installs/upgrades. `A` (application: master + transaction data) is the cheat-sheet default. Others include `C` (customizing), `L` (temporary), `G`/`E`/`S`/`W`. See the catalog.
- **Data class** — the physical tablespace/area (e.g. `APPL0` master data, `APPL1` transaction data, `APPL2` org/customizing). On HANA the impact is reduced but it remains a classification.
- **Size category** — expected number of rows (categories 0–4+), sizing the initial DB extent.
- **Buffering** — table buffering on the application server. **Buffering type** is the key choice:

| Buffering type | What is buffered | When to use |
|---|---|---|
| **Single-record** | Only rows actually read (by full key) | Large table, accessed by full key, few rows touched |
| **Generic** | All rows matching the leading *n* key fields of an accessed key | Reads cluster on a leading key prefix (e.g. by client + a category field) |
| **Full** | The entire table | Small, mostly-read, rarely-changed config/master tables |

**When to buffer:** small, frequently read, rarely changed tables (configuration, texts, type tables). **When not to:** large or write-heavy tables, tables needing always-current reads. Buffered tables are bypassed by certain SQL (e.g. `BYPASSING BUFFER`, joins, aggregates, `ORDER BY`) — see [abap-sql-performance](../abap-sql-performance/SKILL.md).

### Currency and quantity fields — reference fields

A `curr` (currency amount) or `quan` (quantity) field is **incomplete on its own** — it must reference a unit field:

- **`curr` (CURR)** → needs a **`cuky` (CUKY)** currency-key reference field.
- **`quan` (QUAN)** → needs a **`unit` (UNIT)** unit-of-measure reference field.

In a DDIC source definition (table or structure) the link is the `@Semantics.amount.currencyCode` (or `@Semantics.quantity.unitOfMeasure`) annotation pointing at the reference column. ADT offers a quick fix to add it.

```abap
cuky  : abap.cuky;
@Semantics.amount.currencyCode : 'zdemo_abap_struc_flat.cuky'
curr  : abap.curr(8,2);
```

Omitting the reference annotation prevents activation of a `curr`/`quan` field.

## Search helps

A search help supplies a **value list** for an input field. Two classic kinds:

- **Elementary search help** — one selection method (a table/view), import/export parameters, dialog behavior.
- **Collective search help** — bundles several elementary search helps under one entry point.
- A **search help exit** (function module) can customize behavior at runtime.

**Cloud note:** classic dynpro search helps are not relevant in ABAP Cloud. Replace them with **CDS-based search helps** (`@Consumption.valueHelpDefinition` / search help associations) — see [cds-views-authoring](../cds-views-authoring/SKILL.md). The catalog file lists the classic types for maintenance contexts.

## DDIC vs CDS — where to define what

| Need | Define in | Why |
|---|---|---|
| Persist data (a real table) | **DDIC database table** (or CDS table entity) | CDS views are read-only; only tables store rows |
| Read model / projection / join / aggregation | **CDS view** | Declarative, layered, runs on DB, consumable by RAP/OData/Fiori |
| Reusable elementary type + semantics | **DDIC data element** or **CDS simple type** | Simple type is the modern successor; data elements still ubiquitous |
| Technical type + fixed values | **DDIC domain** or **CDS enumerated type** | Enumerated type is the modern fixed-value successor |
| Structured type for ABAP/tables | **DDIC structure** | Reusable global structure |
| Structured type for RAP modeling | **CDS abstract entity** | Advanced features for RAP |
| Value help | **CDS-based search help** | Classic search helps not supported in Cloud |

DDIC objects can be used **in** CDS; the reverse is not true — a CDS entity **cannot** be used in a DDIC database table. Classic DDIC views are **obsolete**; use CDS view entities. See [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md).

## ABAP Cloud considerations

- **ADT only.** Repository objects are created in ABAP Development Tools for Eclipse, from **source code** (data-definition languages), not the classic form-based editor.
- **Released APIs only.** In ABAP for Cloud Development you may use only SAP objects **released** for that language version, plus your own. Find them in *Project Explorer → Released Objects*, or query `I_APISFORCLOUDDEVELOPMENT`:

```abap
SELECT ReleasedObjectType, ReleasedObjectName, ReleaseState
  FROM i_apisforclouddevelopment
  WHERE releasestate = 'RELEASED'
  AND ( ReleasedObjectType = 'DTEL' OR ReleasedObjectType = 'DOMA' )
  ORDER BY ReleasedObjectType, ReleasedObjectName
  INTO TABLE @DATA(released_dtel_doma).
```

- **Not in Cloud:** classic DDIC views, classic (dynpro) search helps, classic lock objects bound to dynpros, maintenance views. Use CDS-based successors.
- **Truth values:** use the `abap_boolean` data element; the released `abap` type pool provides `abap_true` ('X') / `abap_false` ('').
- **XCO library** can retrieve repository-object info and create objects programmatically.

## Naming

| Pattern | Use |
|---|---|
| `Z*` / customer namespace | All custom DDIC objects |
| `ZDEMO_ABAP_TABL*` | Database tables |
| `ZDEMO_ABAP_DTEL_*` | Data elements |
| `ZDEMO_ABAP_DOMA*` | Domains |
| `ZDEMO_ABAP_STRUC_*` | Structures |
| `ZDEMO_ABAP_TT_*` | Table types |

Key field first; `client : abap.clnt not null` as the leading field for client-dependent tables.

## Common Mistakes

| Mistake | Fix |
|---|---|
| `curr`/`quan` field without its `cuky`/`unit` reference annotation | Add `@Semantics.amount.currencyCode` / `@Semantics.quantity.unitOfMeasure`; table won't activate otherwise |
| `string` / `rawstring` used as a key field | Use `sstring` (key-capable) or a different key |
| Reference type, substructure, or table type as a DB table field | Not allowed — only built-in types, data elements, includes |
| Changing a shared domain/data element without checking usage | Run *Get Where-Used List* first; the change ripples everywhere |
| Modeling a read/projection as a DDIC structure + ABAP SELECTs | Use a CDS view — layered, reusable, runs on DB |
| Using a classic DDIC view or dynpro search help in ABAP Cloud | Not released — use CDS view entity / CDS-based search help |
| Buffering a large or write-heavy table | Buffer only small, read-mostly, rarely-changed tables |
| Expecting domain fixed-value checks to run in ABAP statements | They don't — they drive UI/value-help only |
| Putting the OData label on the wrong field label | Only the **Medium Text** data-element label is exposed to OData |
| Using a CDS entity as a table-type line type | Not allowed — use a DDIC structure or DB table |

## References

- [references/objects-catalog.md](references/objects-catalog.md) — per-object catalogs: built-in types, delivery classes, data classes, size categories, buffering types, conversion routines, search help types
- **ABAP Dictionary (Keyword Doc):** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabap_dictionary.htm
- **DDIC database tables:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenddic_database_tables.htm
- **Built-in DDIC types:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenddic_builtin_types.htm
- **SAP-samples/abap-cheat-sheets — 26 ABAP Dictionary:** https://github.com/SAP-samples/abap-cheat-sheets
- Linked skills: [cds-views-authoring](../cds-views-authoring/SKILL.md), [abap-data-objects](../abap-data-objects/SKILL.md), [abap-sql-performance](../abap-sql-performance/SKILL.md), [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md)
</content>
</invoke>
