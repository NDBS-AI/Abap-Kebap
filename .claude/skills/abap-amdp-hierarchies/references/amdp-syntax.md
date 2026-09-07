# AMDP — Full Syntax Reference

Sourced from SAP-samples/abap-cheat-sheets `12_AMDP.md`. AMDP classes can **only** be edited in ADT (ABAP development tools for Eclipse). All syntax here is HANA-only (`FOR HDB`, `LANGUAGE SQLSCRIPT`).

## 1. AMDP class declaration

An AMDP class is an ordinary ABAP Repository global class that **must** include the marker interface `IF_AMDP_MARKER_HDB` (the `HDB` suffix marks the SAP HANA database, currently the only supported DB). It may contain AMDP and non-AMDP methods.

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

## 2. AMDP methods — general

- Instance methods (`METHODS`) or static methods (`CLASS-METHODS`), in any visibility section.
- Cannot be recognized as AMDP methods from the declaration part — there are no special method additions. Exceptions:
  - AMDP functions implementing **CDS table functions** (`FOR TABLE FUNCTION`).
  - AMDP functions implementing **CDS scalar functions** (`FOR SCALAR FUNCTION`).
  - Method declarations using `AMDP OPTIONS` (e.g. `AMDP OPTIONS READ-ONLY CDS SESSION CLIENT DEPENDENT`).

```abap
PUBLIC SECTION.
  METHODS some_amdp_meth
    ... "parameters

PRIVATE SECTION.
  CLASS-METHODS another_amdp_meth
    ... "parameters
```

## 3. AMDP procedures — `BY DATABASE PROCEDURE`

### Declaration part rules

- Parameters must be **passed by value** with `VALUE(...)`. Pass-by-reference is **not** allowed.
- Parameter types:
  - must **not** be generic;
  - can only be **elementary data types** and **table types with a structured row type** (the row type may contain only elementary components).
- Return values **cannot** be declared with `RETURNING`.
- Only **input** parameters can be flagged optional.

```abap
PUBLIC SECTION.
  "Table type with a structured row type
  TYPES tt_tab_type TYPE STANDARD TABLE OF dbtab WITH EMPTY KEY.

  METHODS amdp_meth
    IMPORTING VALUE(iv_num) TYPE i,
    EXPORTING VALUE(et_tab) TYPE tt_tab_type.
```

### Implementation part

```abap
METHOD amdp_meth
  BY DATABASE PROCEDURE
  FOR HDB
  LANGUAGE SQLSCRIPT
  OPTIONS READ-ONLY
  USING db_object.   "see comments below

"Beginning of the SQLScript code (NOT ABAP code although it looks similar)

  ... "Here goes SQLScript code.
      "An AMDP method implementation must not be empty.

"End of the SQLScript code

ENDMETHOD.
```

| Addition | Meaning |
|---|---|
| `BY DATABASE PROCEDURE` | Flags the AMDP method as an AMDP **procedure** |
| `FOR HDB` | Database system where the method runs; currently only `HDB` (SAP HANA database) |
| `LANGUAGE SQLSCRIPT` | Programming language of the database system |
| `OPTIONS READ-ONLY` | Database-specific options |
| `USING db_object` | Optional; specifies database objects used — can also be other AMDP procedures and functions |

Notes:
- In **ABAP for Cloud Development** (restricted version) only reads are allowed, so `OPTIONS READ-ONLY` is **mandatory**, and objects after `USING` must be accessible (released and client-safe).
- In **Standard ABAP** (unrestricted version) more syntax options exist — see the ABAP Keyword Documentation.

## 4. AMDP functions — `BY DATABASE FUNCTION`

Scalar and table functions can be AMDP functions. Table functions return a tabular value; scalar functions return an elementary value. They allow complex custom calculations directly on HANA for performance and reuse.

The implementation differs from a procedure only by `BY DATABASE FUNCTION`:

```abap
METHOD amdp_func
  BY DATABASE FUNCTION    "<- Flags the AMDP method as AMDP function
  FOR HDB
  LANGUAGE SQLSCRIPT
  OPTIONS READ-ONLY
  USING db_object.

"SQLScript code
  ...

ENDMETHOD.
```

### 4a. AMDP table functions for AMDP methods

Callable **only from other AMDP methods** (other AMDP functions or procedures); not directly callable in ABAP.

Declaration:
- Static or instance method, any visibility section.
- Must include a `RETURNING` value with a **tabular** type.
- May include elementary and tabular input parameters.
- No class-based exceptions (`RAISING` not allowed).

```abap
PUBLIC SECTION.
  TYPES tt_tab_type TYPE STANDARD TABLE OF dbtab WITH EMPTY KEY.

  METHODS amdp_func
    IMPORTING VALUE(iv_num)       TYPE i,
              VALUE(iv_some_elem) TYPE c LENGTH 3,
    RETURNING VALUE(rt_tab)       TYPE tt_tab_type.
```

### 4b. AMDP table functions for CDS table functions — `FOR TABLE FUNCTION`

Each CDS table function is linked with an AMDP function that implements it in SQLScript. The CDS table function can then be used as a data source in ABAP SQL `SELECT` statements.

- Method can only be a **static method in the public visibility section** (`CLASS-METHODS`).
- Special declaration form with `FOR TABLE FUNCTION`.
- **No parameter interface** is specified. Input parameters are derived from the CDS table function (names and elementary data types). The return value is a standard table with an empty key, built from the structured row type defined in the CDS table function.

```abap
CLASS-METHODS table_func FOR TABLE FUNCTION some_ddl_source.
```

Required development objects:
1. CDS table function (CDS entity) defined with `define table function`.
2. AMDP function implementing it (`FOR TABLE FUNCTION some_ddl_source`).
3. Usage: `SELECT client, field1, field2 FROM some_ddl_source INTO ...`; usable in CDS entities too. CDS table functions are globally available structured types (not usable for typing in the ABAP Dictionary).

### CDS table function syntax

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

- `define table function` — defines a CDS DDL source / CDS entity.
- `with parameters ...` — optional, comma-separated input parameters; elementary types only.
- `returns { element1; element2; ...; }` — mandatory element list; semicolon-separated; elementary types; `key` addition allowed.
- `implemented by method amdp_class=>amdp_method` — fully qualified AMDP class/method name.
- In ABAP for Cloud Development, mind client handling/safety annotations (see §6).

### 4c. AMDP scalar functions for AMDP methods

Similar to AMDP table functions, but:
- Return value and input parameters must have an **elementary** type.
- Can be called like a regular method in ABAP.

```abap
METHODS get_max_fltime
  AMDP OPTIONS READ-ONLY CDS SESSION CLIENT DEPENDENT
  IMPORTING VALUE(iv_carrid)     TYPE zdemo_abap_flsch_ve-carrid
  RETURNING VALUE(rv_max_fltime) TYPE zdemo_abap_flsch_ve-fltime.
```

```abap
METHOD get_max_fltime BY DATABASE FUNCTION
       FOR HDB
       LANGUAGE SQLSCRIPT
       OPTIONS READ-ONLY
       USING zdemo_abap_flsch_ve.

  SELECT MAX(fltime)
         INTO rv_max_fltime
         FROM zdemo_abap_flsch_ve
         WHERE carrid = :iv_carrid;

ENDMETHOD.
```

### 4d. AMDP scalar functions for CDS scalar functions — `FOR SCALAR FUNCTION`

Unlike scalar functions for AMDP methods, these:
- Must be **public static** methods (`CLASS-METHODS`).
- **Cannot** be called in ABAP like a regular method.
- Use the special form `FOR SCALAR FUNCTION`.
- Have **no parameter interface** — parameters are derived from the CDS scalar function. Input parameters (optional) and a return value, all elementary.

Usable in CDS view entities (element list, `ON`/`WHERE`, ...) and in ABAP SQL (for SQL-based scalar functions).

```abap
CLASS-METHODS execute_scalar_func FOR SCALAR FUNCTION zdemo_abap_scalar_func.
```

```abap
METHOD execute_scalar_func BY DATABASE FUNCTION
       FOR HDB
       LANGUAGE SQLSCRIPT
       OPTIONS READ-ONLY.

  result = num / total * 100;

ENDMETHOD.
```

Three required artifacts:
1. CDS scalar function (`define scalar function ...`).
2. CDS scalar function implementation reference (binds it to the SQL environment and the AMDP function). Name = CDS scalar function name + suffix `_sql` (SQL engine) or `_ana` (analytical).
3. AMDP function implementing it (`FOR SCALAR FUNCTION ...`).

### CDS scalar function syntax (typing options)

```sql
define scalar function zdemo_abap_scalar_func
  with parameters
    // Built-in DDIC types
    param1 : abap.char(3),
    param2 : abap.decfloat34,
    param3 : abap.int4,
    // DDIC data elements
    param4 : abap_boolean,
    param5 : land1,
    // CDS simple types
    param6 : calendar_fiscal_operation,
    // Generic types
    param7 : numeric,
    param8 : any,
    // Referencing types from input parameters
    param9 : type of param1,
    param10: type of param2,
    // Reference to currency key, unit key, calculated unit, or none
    param11: numeric
      with reference type [ #CUKY ],
    param12: numeric
      with reference type [ #CUKY, #UNIT, #CALC ],
    param13: numeric
      with reference type [ #NONE ],
    // Mandatory reference to unit key / currency key
    param14: abap.quan(8,2)
      with reference type [ #UNIT ],
    param15: abap.curr(8,2)
      with reference type [ #CUKY ]
  returns abap.dec(8,2)
```

- Input parameters optional (`with parameters`, comma-separated); non-optional scalar return value.
- Typing: built-in DDIC types, CDS simple types, DDIC data elements; `type of <input_param>` to reference another input parameter's type; generic `any` / `numeric`.
- `with reference type [ ... ]`: `#CUKY` (currency key), `#UNIT` (unit key), `#CALC` (calculated unit), `#NONE`. Required for `abap.quan` / `abap.curr`. Can be set dynamically via `case`.

## 5. Calling AMDP procedures from SQLScript

Within an AMDP procedure/function body, you call another AMDP scalar function using its quoted fully qualified DB name and `=>` mapping:

```abap
METHOD select_entries_w_max_fltime BY DATABASE PROCEDURE
       FOR HDB
       LANGUAGE SQLSCRIPT
       OPTIONS READ-ONLY
       USING zdemo_abap_flsch_ve
             zcl_demo_abap=>get_max_fltime.

  et_flight_tab = select carrid, connid, cityfrom, cityto, fltime
                      from zdemo_abap_flsch_ve
                      where fltime = "ZCL_DEMO_ABAP=>GET_MAX_FLTIME"( iv_carrid => :iv_carrid );

ENDMETHOD.
```

- The called AMDP function/procedure is listed in `USING`.
- Method parameters are referenced in SQLScript with a leading colon (`:iv_carrid`).

## 6. ABAP for Cloud Development — client handling & safety

Native SQL / AMDP has **no implicit client handling** (ABAP SQL does). In ABAP Cloud you can only access your own client, so AMDP must be **client-safe**: read only client-dependent data of the current client, or client-independent data.

### Restrictions (Cloud)

- Implementation restricted to reads: `AMDP OPTIONS READ-ONLY` (declaration) and `OPTIONS READ-ONLY` (implementation).
- Method implementations can only use SQLScript code.
- Data sources accessed must be released for ABAP for Cloud Development.
- AMDP methods must be client-safe.

### Declaration additions (with a client-safe `USING` list)

- **`CDS SESSION CLIENT DEPENDENT`** — for a method using at least one client-dependent object. `USING` may list:
  - Client-dependent CDS view entities filtered by HANA session variable `CDS_CLIENT` (CDS `$session.client`).
  - Client-dependent DDIC database tables (an implicit DB view restricts to `CDS_CLIENT`, making them client-safe).
  - Client-safe CDS table functions.
  - Other client-dependent / `CLIENT INDEPENDENT` AMDP methods.
  - Client-independent CDS objects and DDIC tables.
- **`CLIENT INDEPENDENT`** — for a method using only client-independent objects (CDS view entities, DDIC tables, client-safe CDS table functions, `CLIENT INDEPENDENT` AMDP methods).

### CDS table function annotations for client safety

- `@ClientHandling.type: #CLIENT_DEPENDENT` together with `@ClientHandling.algorithm: #SESSION_VARIABLE`, or
- `@ClientHandling.type: #CLIENT_INDEPENDENT`.
- Parameters should **not** be `@Environment.systemField: #CLIENT`.
- `@ClientHandling.clientSafe` is unnecessary in Cloud — checks are enabled automatically.

### SQLScript rules for client safety

- Must not access database objects not managed by ABAP or not in the `USING` list.
- Must not call built-in HANA functions that include a client ID parameter.
- The client parameter should be removed from the signature; if not possible, exclude the client from the SQLScript code.

### Pre-delivered objects in Cloud

- Use only pre-delivered AMDP methods with a **C4 contract**.
- Create your own wrapper CDS view entities for pre-delivered CDS view entities with a **C1 contract**.

## 7. Checking AMDP support (classic ABAP)

```abap
IF NOT cl_abap_dbfeatures=>use_features(
    EXPORTING requested_features =
    VALUE #( ( cl_abap_dbfeatures=>call_amdp_method ) ) ).
  "Current database system does not support AMDP procedures
  RETURN.
ENDIF.
```

## Sources

- ABAP Keyword Documentation — AMDP: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenamdp.htm
- SAP-samples/abap-cheat-sheets — `12_AMDP.md`: https://github.com/SAP-samples/abap-cheat-sheets
- AMDP call matrices (client safety overview): https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENAMDP_CALL_MATRICES.html
