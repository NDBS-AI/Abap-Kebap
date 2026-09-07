---
name: abap-amdp-hierarchies
description: Use when writing or reviewing AMDP (ABAP Managed Database Procedures) and SQL hierarchies — implementing a database procedure or database function in SQLScript, building a CDS table function or CDS scalar function backend, deciding AMDP vs Open SQL vs CDS, pushing complex logic down to SAP HANA, marking a class with IF_AMDP_MARKER_HDB, handling READ-ONLY / USING / FOR HDB LANGUAGE SQLSCRIPT additions, making AMDP client-safe for ABAP Cloud, or working with parent-child / recursive hierarchical data via the ABAP SQL HIERARCHY generator, HIERARCHY_DESCENDANTS / HIERARCHY_ANCESTORS / HIERARCHY_SIBLINGS navigators, or CDS define hierarchy.
---

# AMDP & SQL Hierarchies — Guide

## Overview

Two ways to do work *on the SAP HANA database* instead of in the ABAP application server:

- **AMDP** (ABAP Managed Database Procedure) — write a database procedure or function in **SQLScript**, managed inside an ABAP class. The SQLScript code runs *only on the HANA database*, not in AS ABAP; method calls are sent down to the DB.
- **SQL hierarchies** — express parent-child / recursive data directly in ABAP SQL or CDS by wrapping HANA's built-in hierarchy functions. No AMDP needed: ABAP SQL and CDS support hierarchies natively without loss of performance.

**Core principle:** Stay in Open SQL / CDS whenever you can. Push down to AMDP *only* when the logic genuinely needs SQLScript that Open SQL and CDS cannot express. The ABAP Keyword Documentation states plainly: *"The use of AMDP is not recommended if the same task can be achieved using ABAP SQL."*

## When to Use

- Implementing a **CDS table function** backend (the most prominent ABAP-Cloud-relevant AMDP use).
- Implementing a **CDS scalar function** backend.
- Complex *procedural* DB logic — multi-step SQLScript with intermediate table variables, loops, imperative branching that Open SQL cannot express.
- Set operations or HANA-specific calculations not expressible in CDS DDL or Open SQL.
- Working with **hierarchical data** (org charts, BOMs, category trees): descendants, ancestors, siblings, subtree aggregation.

**When NOT to use AMDP:**
- The query is expressible in Open SQL or a CDS view → use those. They are portable, statically checked, and buffered.
- You only need a hierarchy → use the ABAP SQL `HIERARCHY` generator or a CDS `define hierarchy`; no AMDP required.
- ABAP for Cloud Development and the logic writes data → AMDP is read-only there (`OPTIONS READ-ONLY` mandatory).

## Decision guide — AMDP vs CDS vs Open SQL

| Need | Reach for | Why |
|---|---|---|
| Single read, joins, aggregation | **Open SQL** / **CDS view** | Portable, statically checked, table-buffer aware |
| Reusable declarative model, associations, hierarchies | **CDS** | VDM layering, DCL authorization, consumable everywhere |
| Parent-child / recursive traversal | **CDS `define hierarchy`** or **ABAP SQL `HIERARCHY`** | Native HANA hierarchy functions, no AMDP needed |
| Complex *procedural* SQLScript (table variables, multi-step) | **AMDP procedure / function** | Logic genuinely needs SQLScript imperative flow |
| A read-only table-valued source for ABAP SQL that needs SQLScript | **CDS table function + AMDP** | `SELECT FROM` a function whose body is native SQLScript |
| A scalar computation usable in CDS / ABAP SQL that needs SQLScript | **CDS scalar function + AMDP** | Function callable in element lists, `WHERE`, etc. |

Order of preference: **Open SQL → CDS → SQL hierarchy → AMDP**. Drop to AMDP only when the rung above cannot express the logic.

## AMDP concept

- AMDP is a **class-based framework** for managing database procedures (stored procedures) and database functions (SQLScript functions) in AS ABAP.
- "ABAP managed": the framework **replicates** the procedure/function to the database. You write it in an AMDP class (an ABAP Repository object), but the SQLScript executes only on HANA.
- Currently HANA-only — indicated by `HDB`. SQLScript is the implementation language.
- AMDP classes can **only be edited in ADT** (ABAP development tools for Eclipse), not SE80.

## AMDP class requirements

An AMDP class is a normal global class that **must specify the marker interface** `IF_AMDP_MARKER_HDB`. It may contain both AMDP and non-AMDP methods.

```abap
CLASS cl_some_amdp_class DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    "Specifying the interface is mandatory
    INTERFACES if_amdp_marker_hdb.
...
ENDCLASS.
```

## AMDP methods

- Declared as instance (`METHODS`) or static (`CLASS-METHODS`) in any visibility section.
- AMDP methods **cannot be identified as such in the declaration part** — there is no special addition. (Exceptions: methods that implement CDS table/scalar functions, and `AMDP OPTIONS` declarations.)
- The *implementation part* carries the AMDP-specific additions after `METHOD`.

### AMDP procedure — `BY DATABASE PROCEDURE`

Declaration part of an AMDP procedure has special rules:
- Parameters must be **passed by value** with `VALUE(...)`; pass-by-reference is not allowed.
- Parameter types must not be generic; only elementary types and table types with a structured row type of elementary components.
- Return values **cannot** be declared with `RETURNING`.
- Only input parameters may be optional.

```abap
"Table type with a structured row type
TYPES tt_tab_type TYPE STANDARD TABLE OF dbtab WITH EMPTY KEY.

METHODS amdp_meth
  IMPORTING VALUE(iv_num) TYPE i,
  EXPORTING VALUE(et_tab) TYPE tt_tab_type.
```

Implementation part:

```abap
METHOD amdp_meth
  BY DATABASE PROCEDURE
  FOR HDB
  LANGUAGE SQLSCRIPT
  OPTIONS READ-ONLY
  USING db_object.

  "Beginning of the SQLScript code (NOT ABAP, though it looks similar)
  ... "Here goes SQLScript code; the implementation must not be empty.
  "End of the SQLScript code

ENDMETHOD.
```

| Addition | Meaning |
|---|---|
| `BY DATABASE PROCEDURE` | Flags the method as an AMDP **procedure** |
| `FOR HDB` | Target database system; currently only `HDB` (SAP HANA) |
| `LANGUAGE SQLSCRIPT` | Implementation language on the DB |
| `OPTIONS READ-ONLY` | Database-specific options; **mandatory in ABAP Cloud** |
| `USING db_object` | Optional; lists DB objects used (tables, views, other AMDP procedures/functions) |

### AMDP function — `BY DATABASE FUNCTION`

Same shape as a procedure, but `BY DATABASE FUNCTION`. Two flavours of table function and two of scalar function — see [references/amdp-syntax.md](references/amdp-syntax.md).

```abap
METHOD amdp_func
  BY DATABASE FUNCTION    "<- Flags the AMDP method as AMDP function
  FOR HDB
  LANGUAGE SQLSCRIPT
  OPTIONS READ-ONLY
  USING db_object.

  ... "SQLScript code
ENDMETHOD.
```

## AMDP for CDS table functions — `FOR TABLE FUNCTION`

This is the most important AMDP pattern: a CDS table function whose body is an AMDP function. The CDS entity becomes a normal ABAP SQL data source (`SELECT FROM ...`).

You need two artifacts:

1. A **CDS table function** defined with `define table function`:

```sql
//Here go annotations.
define table function some_ddl_source
  with parameters
    param  : abap.char(3)
  returns
  {
    client : abap.clnt;
    field1 : abap.char(5);
    field2 : abap.int4;
  }
  implemented by method amdp_class=>amdp_method;
```

2. An **AMDP function** that implements it. The method:
   - Can only be a **static method in the public section** (`CLASS-METHODS`).
   - Uses the special declaration form `FOR TABLE FUNCTION`.
   - Has **no parameter interface** — input parameters and the returned row type are derived from the CDS table function. The return is a standard table with an empty key built from the `returns { ... }` element list.

```abap
CLASS-METHODS table_func FOR TABLE FUNCTION some_ddl_source.
```

```abap
METHOD table_func BY DATABASE FUNCTION
  FOR HDB
  LANGUAGE SQLSCRIPT
  OPTIONS READ-ONLY
  USING some_table.

  RETURN SELECT ... FROM some_table WHERE field = :param;
ENDMETHOD.
```

Then consume it like any data source: `SELECT client, field1, field2 FROM some_ddl_source( param = '...' ) INTO ...`. A CDS table function is also a globally available structured type (but cannot be used for typing in the ABAP Dictionary).

See [examples/amdp-method.md](examples/amdp-method.md) for a complete runnable example.

## AMDP for CDS scalar functions — `FOR SCALAR FUNCTION`

A CDS scalar function returns a single elementary value and is usable in CDS element lists, `ON`/`WHERE` conditions, and ABAP SQL. Three artifacts:

- CDS scalar function (`define scalar function ...`).
- A **scalar function implementation reference** binding it to the SQL engine and the AMDP method.
- An AMDP function declared `CLASS-METHODS some_meth FOR SCALAR FUNCTION some_cds_scalar_func.` (public, static; no parameter interface — derived from the CDS scalar function).

```abap
METHOD execute_scalar_func BY DATABASE FUNCTION
       FOR HDB
       LANGUAGE SQLSCRIPT
       OPTIONS READ-ONLY.

  result = num / total * 100;
ENDMETHOD.
```

Usage in ABAP SQL: `SELECT ..., zdemo_abap_scalar_func( num = num1, total = num2 ) AS rate FROM ...`. Full syntax (typing options, `with reference type`) is in [references/amdp-syntax.md](references/amdp-syntax.md).

## AMDP restrictions

| Restriction | Detail |
|---|---|
| HANA-only | `FOR HDB` only; check support with `cl_abap_dbfeatures=>use_features( ... call_amdp_method )` in classic ABAP |
| ADT only | AMDP classes cannot be edited in SE80 |
| No ABAP inside | The method body is **SQLScript**, not ABAP — no ABAP statements, no host variables beyond the method parameters (referenced with a leading `:`) |
| Read-only in Cloud | In ABAP for Cloud Development only reads are allowed; `OPTIONS READ-ONLY` is mandatory |
| No implicit client handling | Native SQL / AMDP has no implicit client handling — you must ensure client safety yourself |
| `USING` accessibility | Objects after `USING` must be accessible and (in Cloud) released and client-safe |
| Replication / transport | The procedure/function is replicated to the DB on activation; treat as a transportable Repository object |

## AMDP in ABAP Cloud — client safety

ABAP SQL has implicit client handling; **Native SQL/AMDP does not**. In ABAP for Cloud Development you can only access your own client, so AMDP methods must be **client-safe** — accessing only client-dependent sources of the current client, or client-independent sources.

**AMDP method declarations** use one of these additions plus a client-safe `USING` list:
- `CDS SESSION CLIENT DEPENDENT` — for methods using at least one client-dependent object; `USING` may list client-dependent CDS view entities (filtered by `CDS_CLIENT`), client-dependent DDIC tables (an implicit DB view restricts to `CDS_CLIENT`), client-safe CDS table functions, other client-dependent/`CLIENT INDEPENDENT` AMDP methods, and client-independent objects.
- `CLIENT INDEPENDENT` — for methods using only client-independent objects.

**CDS table functions** must be annotated for client safety:
- `@ClientHandling.type: #CLIENT_DEPENDENT` together with `@ClientHandling.algorithm: #SESSION_VARIABLE`, or
- `@ClientHandling.type: #CLIENT_INDEPENDENT`.
- Parameters should not be `@Environment.systemField: #CLIENT`. (`@ClientHandling.clientSafe` is unnecessary in Cloud — checks are automatic.)

**SQLScript** must not access objects outside the `USING` list, must not call HANA built-ins that take a client ID, and should drop the client parameter. See [references/amdp-syntax.md](references/amdp-syntax.md) and [abap-cloud-development](../abap-cloud-development/SKILL.md) (ABAP Cloud restrictions).

## SQL hierarchies

Hierarchical data = rows connected by **parent-child relationships**. A **SQL hierarchy** is a tabular set of rows (the hierarchy nodes) usable in the `FROM` clause, enriched with **hierarchy columns** (rank, level, etc.). ABAP SQL and CDS wrap HANA's hierarchy functions directly — **no AMDP required**.

To create one you need: a **data source** (DB table, CDS view, or CTE), a **parent-child relation** defined by a self-association (the *hierarchy association*), and **hierarchy creation** — either a CDS `define hierarchy` or the ABAP SQL `HIERARCHY` generator.

### CDS hierarchy vs ABAP SQL HIERARCHY

| | CDS `define hierarchy` | ABAP SQL `HIERARCHY( ... )` |
|---|---|---|
| Where it lives | A reusable CDS entity, outside the program | Inline in the `FROM` clause of one program |
| Reuse | Many programs / data models; can carry DCL authorization | One program only |
| Analogy | Like a CDS join | Like an ABAP SQL join |

The syntax inside `HIERARCHY( ... )` mirrors `define hierarchy` and does exactly the same thing.

### The HIERARCHY generator

```abap
SELECT FROM HIERARCHY( SOURCE demo_cds_simple_tree_view
                       CHILD TO PARENT ASSOCIATION _tree
                       START WHERE id = @root_id
                       SIBLINGS ORDER BY id
                       MULTIPLE PARENTS NOT ALLOWED ) "hierarchy
       FIELDS id,
              parent,
              name,
              hierarchy_rank,
              hierarchy_tree_size,
              hierarchy_parent_rank,
              hierarchy_level,
              hierarchy_is_cycle,
              hierarchy_is_orphan,
              node_id,
              parent_id
       INTO TABLE @FINAL(lt_result).
```

- `SOURCE` — a data source exposing a hierarchy association (CDS view or CTE with `WITH ASSOCIATIONS`).
- `CHILD TO PARENT ASSOCIATION _tree` — the self-association defining parent-child.
- `START WHERE` — defines the root node set; descendants are retrieved recursively.
- `SIBLINGS ORDER BY` — sort order among siblings.
- Hierarchy columns (`hierarchy_rank`, `hierarchy_level`, `node_id`, ...) exist **implicitly** when a SQL hierarchy is accessed — add any of them to `FIELDS`.

### Hierarchy navigators

Navigators work on an *existing* SQL hierarchy (more performant when reused). Each adds further hierarchy columns.

- **`HIERARCHY_DESCENDANTS`** — all descendants of a node; adds `HIERARCHY_DISTANCE` (positive). A `DISTANCE` parameter can cap depth.
- **`HIERARCHY_ANCESTORS`** — all ancestors of a node; `HIERARCHY_DISTANCE` is negative.
- **`HIERARCHY_SIBLINGS`** — siblings (same parent); adds `HIERARCHY_SIBLING_DISTANCE`.
- **`HIERARCHY_DESCENDANTS_AGGREGATE` / `HIERARCHY_ANCESTORS_AGGREGATE`** — aggregate (`MEASURES SUM(...)`) over subtrees, with `WITH SUBTOTAL` / `WITH BALANCE` rows flagged by `HIERARCHY_AGGREGATE_TYPE`.

```abap
SELECT FROM HIERARCHY_DESCENDANTS(
              SOURCE demo_cds_simple_tree( p_id = @root_id )
              START WHERE id = @sub_id )
  FIELDS id, parent_id, name, hierarchy_distance
  INTO TABLE @FINAL(lt_descendants).
```

Full hierarchy syntax, the `define hierarchy` form, CTE hierarchies, and aggregate navigators are in [references/hierarchies.md](references/hierarchies.md).

### Recursive scenarios

The hierarchy is built by recursive descent: select root nodes (`START WHERE`), then for each root add every row satisfying the association `ON` condition, and repeat for each descendant until none remain. `DEFINE HIERARCHY` additions control multiple parents, orphans, and cycles (`hierarchy_is_cycle`, `hierarchy_is_orphan` columns surface these).

## Common Mistakes

| Mistake | Fix |
|---|---|
| Writing AMDP for something Open SQL/CDS can do | Use Open SQL/CDS — AMDP is "not recommended" when SQL suffices |
| Forgetting `INTERFACES if_amdp_marker_hdb` | The class is not an AMDP class without it |
| `RETURNING` on an AMDP **procedure** | Procedures cannot use `RETURNING`; use `EXPORTING VALUE(...)` |
| Pass-by-reference parameters | AMDP procedures require `VALUE(...)` |
| Treating the method body as ABAP | It is SQLScript; reference parameters with leading `:` |
| Empty AMDP implementation | The implementation must not be empty |
| Omitting `OPTIONS READ-ONLY` in ABAP Cloud | Mandatory — only reads allowed |
| Cross-client access in Cloud AMDP | Use `CDS SESSION CLIENT DEPENDENT` / `CLIENT INDEPENDENT` and client-safe `USING` objects |
| Parameter interface on a `FOR TABLE FUNCTION` method | None is specified — it is derived from the CDS table function |
| Reaching for AMDP to traverse a hierarchy | Use CDS `define hierarchy` or ABAP SQL `HIERARCHY` — they wrap HANA natively |
| Re-creating a hierarchy for each navigator call | Create once with a root set, then use navigators on it |

## References

- [references/amdp-syntax.md](references/amdp-syntax.md) — full AMDP class/method syntax, all additions, parameter rules, SQLScript essentials, client safety
- [references/hierarchies.md](references/hierarchies.md) — ABAP SQL `HIERARCHY` generator, `define hierarchy`, CTE hierarchies, navigators and hierarchy columns
- [examples/amdp-method.md](examples/amdp-method.md) — complete AMDP method + CDS-table-function-backed AMDP example
- **AMDP in ABAP Keyword Documentation:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenamdp.htm
- **SELECT, FROM hierarchy_data:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenselect_hierarchy_data.htm
- **SAP-samples/abap-cheat-sheets** (12_AMDP, 10_ABAP_SQL_Hierarchies): https://github.com/SAP-samples/abap-cheat-sheets
- Linked skills: [cds-views-authoring](../cds-views-authoring/SKILL.md) (table functions, CDS hierarchies), [abap-sql-performance](../abap-sql-performance/SKILL.md) (push-down), [abap-cloud-development](../abap-cloud-development/SKILL.md) (ABAP Cloud restrictions)
