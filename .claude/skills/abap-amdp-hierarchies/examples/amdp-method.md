# AMDP — Complete Examples

All code is sourced from / aligned with SAP-samples/abap-cheat-sheets `12_AMDP.md`. AMDP classes can only be created and edited in ADT. After activating all artifacts, run the executable class with **F9** in ADT (console output).

---

## Example 1 — Runnable AMDP class (scalar function, procedure, ABAP SQL usage)

This single executable class (implements `if_oo_adt_classrun`, so F9 runs it) demonstrates three things at once:

- `get_max_fltime` — an **AMDP scalar function for an AMDP method** (callable like a regular ABAP method). Returns the longest flight time for a carrier.
- `select_entries_w_max_fltime` — an **AMDP procedure** whose SQLScript body **calls** the scalar function above.
- `execute_scalar_func` — an **AMDP scalar function for a CDS scalar function** (`FOR SCALAR FUNCTION`), computing a ratio.

It also shows calling `get_max_fltime` from plain ABAP SQL via a host expression, and from a CDS scalar function in a `SELECT`.

```abap
CLASS zcl_demo_abap DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC .

  PUBLIC SECTION.
    INTERFACES: if_oo_adt_classrun,
      if_amdp_marker_hdb.        "Mandatory marker interface for an AMDP class

    CLASS-METHODS class_constructor.

    TYPES occ_rate_type TYPE p LENGTH 8 DECIMALS 2.

    "AMDP scalar function for AMDP method
    METHODS get_max_fltime
      AMDP OPTIONS READ-ONLY CDS SESSION CLIENT DEPENDENT
      IMPORTING VALUE(carrid)     TYPE zdemo_abap_flsch_ve-carrid
      RETURNING VALUE(max_fltime) TYPE zdemo_abap_flsch_ve-fltime.

    "AMDP procedure whose implementation calls an AMDP scalar function
    TYPES: BEGIN OF flight_struc_type,
             carrid   TYPE zdemo_abap_flsch_ve-carrid,
             connid   TYPE zdemo_abap_flsch_ve-connid,
             cityfrom TYPE zdemo_abap_flsch_ve-cityfrom,
             cityto   TYPE zdemo_abap_flsch_ve-cityto,
             fltime   TYPE zdemo_abap_flsch_ve-fltime,
           END OF flight_struc_type,
           flight_tab_type TYPE TABLE OF flight_struc_type WITH EMPTY KEY.

    METHODS select_entries_w_max_fltime
      AMDP OPTIONS READ-ONLY CDS SESSION CLIENT DEPENDENT
      IMPORTING VALUE(carrid)     TYPE zdemo_abap_flsch_ve-carrid
      EXPORTING VALUE(flight_tab) TYPE flight_tab_type.

    "AMDP scalar function for CDS scalar function
    CLASS-METHODS execute_scalar_func FOR SCALAR FUNCTION zdemo_abap_scalar_func.

  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.


CLASS zcl_demo_abap IMPLEMENTATION.

  METHOD if_oo_adt_classrun~main.

    "--- Call the AMDP scalar function like a normal ABAP method ---
    DATA(oref) = NEW zcl_demo_abap( ).
    DATA(max_fltime_lh) = oref->get_max_fltime( carrid = 'LH' ).
    out->write( max_fltime_lh ).

    "--- Use the AMDP scalar function inside ABAP SQL (host expression) ---
    DATA carrid_tab TYPE TABLE OF zdemo_abap_flsch_ve-carrid WITH EMPTY KEY.
    carrid_tab = VALUE #( ( 'LH' ) ( 'AZ' ) ( 'DL' ) ).

    LOOP AT carrid_tab INTO DATA(carrid).
      SELECT carrid, connid, cityfrom, cityto, fltime
             FROM zdemo_abap_flsch_ve
             WHERE carrid = @carrid AND
                   fltime = @( NEW zcl_demo_abap( )->get_max_fltime( carrid = carrid ) )
             INTO TABLE @DATA(selection_result).
      out->write( selection_result ).
    ENDLOOP.

    "--- Call the AMDP procedure that itself calls the scalar function ---
    LOOP AT carrid_tab INTO carrid.
      NEW zcl_demo_abap( )->select_entries_w_max_fltime(
           EXPORTING carrid = carrid
           IMPORTING flight_tab = DATA(flights) ).
      out->write( flights ).
    ENDLOOP.

    "--- Use the CDS scalar function (backed by execute_scalar_func) in ABAP SQL ---
    MODIFY zdemo_abap_tab1 FROM TABLE @( VALUE #(
      ( key_field = 1 num1 = 3  num2 = 10 )
      ( key_field = 2 num1 = 12 num2 = 123 )
      ( key_field = 3 num1 = 5  num2 = 39 )
      ( key_field = 4 num1 = 98 num2 = 9876 ) ) ).

    SELECT FROM zdemo_abap_tab1
       FIELDS key_field, num1, num2,
              zdemo_abap_scalar_func(
                num   = num1,
                total = num2 ) AS rate
       ORDER BY key_field
       INTO TABLE @DATA(res_dbtab).
    out->write( res_dbtab ).

  ENDMETHOD.

  "AMDP procedure — calls the AMDP scalar function from SQLScript
  METHOD select_entries_w_max_fltime BY DATABASE PROCEDURE
         FOR HDB
         LANGUAGE SQLSCRIPT
         OPTIONS READ-ONLY
         USING zdemo_abap_flsch_ve
               zcl_demo_abap=>get_max_fltime.

    flight_tab = select carrid, connid, cityfrom, cityto, fltime
                        from zdemo_abap_flsch_ve
                        where fltime = "ZCL_DEMO_ABAP=>GET_MAX_FLTIME"( carrid => :carrid );

  ENDMETHOD.

  "AMDP scalar function for CDS scalar function
  METHOD execute_scalar_func BY DATABASE FUNCTION
         FOR HDB
         LANGUAGE SQLSCRIPT
         OPTIONS READ-ONLY.

    result = num / total * 100;

  ENDMETHOD.

  "AMDP scalar function for AMDP method
  METHOD get_max_fltime BY DATABASE FUNCTION
         FOR HDB
         LANGUAGE SQLSCRIPT
         OPTIONS READ-ONLY
         USING zdemo_abap_flsch_ve.

    SELECT MAX(fltime)
           INTO max_fltime
           FROM zdemo_abap_flsch_ve
           WHERE carrid = :carrid;

  ENDMETHOD.

  METHOD class_constructor.
    "Preparing demo data
    zcl_demo_abap_aux=>fill_dbtabs( ).
    DELETE FROM zdemo_abap_tab1.
  ENDMETHOD.

ENDCLASS.
```

Things to notice:
- `INTERFACES if_amdp_marker_hdb` makes it an AMDP class.
- The method bodies are **SQLScript**, not ABAP. Method parameters are referenced with a leading colon (`:carrid`).
- An AMDP procedure calls another AMDP function via its quoted DB name `"ZCL_DEMO_ABAP=>GET_MAX_FLTIME"( carrid => :carrid )`, with the callee listed in `USING`.
- `OPTIONS READ-ONLY` everywhere; `AMDP OPTIONS READ-ONLY CDS SESSION CLIENT DEPENDENT` on declarations adapts client handling for ABAP Cloud.

### Companion CDS scalar function + implementation reference

The `execute_scalar_func` AMDP method backs a CDS scalar function. Two more artifacts are needed (created via ADT *New → Other ABAP Repository Objects*):

CDS scalar function definition (`zdemo_abap_scalar_func`):

```sql
define scalar function zdemo_abap_scalar_func
  with parameters
    num    : numeric,
    total  : type of num
  returns abap.dec( 8, 2 )
```

Scalar function implementation reference (`zdemo_abap_scalar_func_sql` — name = CDS scalar function + `_sql`; engine: *SQL Engine*; AMDP reference: `zcl_demo_abap=>execute_scalar_func`).

Optional CDS view entity using the scalar function:

```sql
@AccessControl.authorizationCheck: #NOT_REQUIRED
define view entity zdemo_abap_cds_ve_w_scalar
  as select from zdemo_abap_fli
{
  key carrid,
  key connid,
  key fldate,
      seatsmax,
      seatsocc,
      zdemo_abap_scalar_func(
        num     => seatsocc,
        total   => seatsmax ) as occrate
}
```

---

## Example 2 — CDS table function backed by an AMDP function

The most common, ABAP-Cloud-relevant pattern: a **CDS table function** whose body is an **AMDP function** (`FOR TABLE FUNCTION`). Once activated, the CDS table function is a plain ABAP SQL data source.

### Artifact 1 — CDS table function (DDL source)

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

- `with parameters` — optional elementary input parameters.
- `returns { ... }` — element list (semicolon-separated, elementary types; `key` allowed) defining the returned row type.
- `implemented by method amdp_class=>amdp_method` — the AMDP class/method that implements it.

### Artifact 2 — AMDP class implementing the table function

```abap
CLASS amdp_class DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.

    "No parameter interface: input params and return row type are
    "derived from the CDS table function some_ddl_source.
    CLASS-METHODS amdp_method FOR TABLE FUNCTION some_ddl_source.

  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.


CLASS amdp_class IMPLEMENTATION.

  METHOD amdp_method BY DATABASE FUNCTION
    FOR HDB
    LANGUAGE SQLSCRIPT
    OPTIONS READ-ONLY
    USING some_table.

    "SQLScript: return a result set matching the returns{} element list.
    "The input parameter 'param' is referenced with a leading colon.
    RETURN SELECT client, field1, field2
                  FROM some_table
                  WHERE field1 = :param;

  ENDMETHOD.

ENDCLASS.
```

Key points for `FOR TABLE FUNCTION`:
- Declared as a **public static** method (`CLASS-METHODS`).
- **No parameter interface** — names/types come from the CDS table function; the return is a standard table with an empty key built from `returns { ... }`.
- The SQLScript body must produce a result matching the element list.

### Artifact 3 — consume it in ABAP SQL

```abap
SELECT client, field1, field2
  FROM some_ddl_source( param = 'abc' )
  INTO TABLE @DATA(result).
```

A CDS table function can also be used as a source inside other CDS entities, and represents a globally available structured type (not usable for typing in the ABAP Dictionary).

### ABAP Cloud note

In ABAP for Cloud Development (see [abap-cloud-development](../../abap-cloud-development/SKILL.md) for cloud restrictions), make the table function client-safe:
- Annotate the CDS table function `@ClientHandling.type: #CLIENT_DEPENDENT` + `@ClientHandling.algorithm: #SESSION_VARIABLE` (or `#CLIENT_INDEPENDENT`).
- Use `CDS SESSION CLIENT DEPENDENT` / `CLIENT INDEPENDENT` on the AMDP declaration and list only client-safe objects in `USING` (e.g. CDS view entities rather than raw tables). See [../references/amdp-syntax.md](../references/amdp-syntax.md) §6.

---

## Sources

- SAP-samples/abap-cheat-sheets — `12_AMDP.md`: https://github.com/SAP-samples/abap-cheat-sheets
- Executable example `zcl_demo_abap_amdp` (in that repo's `src/`).
- ABAP Keyword Documentation — AMDP: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenamdp.htm
- CDS table functions: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abencds_table_functions.htm
