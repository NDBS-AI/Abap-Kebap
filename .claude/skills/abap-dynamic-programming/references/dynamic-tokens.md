# Dynamic Tokens — Catalog of Statements Accepting Dynamic Operands

Many ABAP statements let you supply a name, clause, or key in parentheses as a **character-like data object** evaluated at runtime, instead of hard-coding it. The general form is `... (char_dobj) ...` where `char_dobj` is a literal, named variable, or (for some clauses) a `string_table`. All syntax below is from `06_Dynamic_Programming.md`.

> The name is **not case-sensitive** in field/component/SQL contexts, but **is case-sensitive** in dynamic method/attribute names (`('IN_METH')`, not `('in_meth')`).

## ASSIGN — memory area, components, attributes

```abap
"Memory area by name
ASSIGN ('DOBJ') TO FIELD-SYMBOL(<fv_dobj>).
ASSIGN lr_dref->* TO <fv_dobj>.

"Structure component by name / position
ASSIGN ls_st-('COL1') TO <fv_dobj>.
ASSIGN ls_st-(3)      TO <fv_dobj>.       "position; 0 = whole structure
ASSIGN lt_it[ 1 ]-('COL1') TO <fv_dobj>.
ASSIGN lr_dref->('COL1') TO <fv_dobj>.

"Fully dynamic
ASSIGN ('ST-COL1') TO <fv_dobj>.

"Class / interface attributes (visible attributes only)
ASSIGN lo_oref->('STRING') TO <fv_dobj>.
ASSIGN lo_iref->('IN_STR') TO <fv_dobj>.
ASSIGN zcl_demo=>('PUBLIC_STRING') TO <fv_dobj>.
ASSIGN ('ZCL_DEMO')=>('PUBLIC_STRING') TO <fv_dobj>.

"Dynamic casting
ASSIGN dobj TO <fv_dobj> CASTING TYPE ('CLEN5').
ASSIGN dobj TO <fv_dobj> CASTING TYPE HANDLE lo_tdo.

"ELSE UNASSIGN — dynamic only; unassigns the field symbol on failure
ASSIGN ('NOPE') TO <fv_dobj> ELSE UNASSIGN.
```

`sy-subrc` is set for **dynamic** assignments (0 success, 4 failure). For static assignments it is generally not set (except with table expressions). Older equivalents `ASSIGN COMPONENT 'COL1' OF STRUCTURE ls_st TO <fv_dobj>` / `ASSIGN COMPONENT 3 ...` are superseded by `ls_st-('COL1')` / `ls_st-(3)`.

## CREATE DATA — dynamic anonymous data objects

```abap
CREATE DATA lr_dref TYPE (lv_typename).
CREATE DATA lr_dref TYPE TABLE OF (lv_typename) WITH EMPTY KEY.
CREATE DATA lr_dref TYPE SORTED TABLE OF ('ZDEMO_ABAP_FLI') WITH UNIQUE KEY (lt_key_table).
CREATE DATA lr_dref TYPE REF TO (lv_typename).
CREATE DATA lr_dref TYPE LINE OF (lv_typename).
CREATE DATA lr_dref LIKE ls_struc-(lv_compname).
CREATE DATA lr_dref TYPE (lv_absolute_name).
CREATE DATA lr_dref TYPE HANDLE lo_type_description_object.
```

`(lt_key_table)` is a `string_table` of key component names. Secondary keys are **not** possible with `CREATE DATA ... TYPE (name)` — use RTTC `get_with_keys`. `NEW` cannot take a dynamic type name.

## CREATE OBJECT — dynamic instances

```abap
DATA lo_oref TYPE REF TO object.
CREATE OBJECT lo_oref TYPE ('ZCL_DEMO_ABAP_OBJECTS').
CREATE OBJECT lo_oref TYPE (lv_cl).                       "name in a variable
CREATE OBJECT lo_oref TYPE ('\CLASS=ZCL_DEMO').        "absolute name
CREATE OBJECT lo_oref TYPE (...) EXPORTING p1 = a1.    "static params
CREATE OBJECT lo_oref TYPE (...) PARAMETER-TABLE lt_ptab. "dynamic params
```

`NEW` cannot create instances by a dynamic type name — `CREATE OBJECT` is required.

## Internal-table statements

| Statement | Dynamic forms |
|---|---|
| `SORT` | `SORT itab BY (field_name) DESCENDING.` · `SORT itab BY (sort_tab).` where `sort_tab TYPE abap_sortorder_tab` · `SORT itab BY VALUE abap_sortorder_tab( ... ).` |
| `READ TABLE` | `... USING KEY ('SK')` · `WITH TABLE KEY ('SK') COMPONENTS ('COL2') = v` · `WITH KEY ('COL3') = v` · `TRANSPORTING ('COL1') ('COL3')` · `COMPARING ('COL3')` · `WHERE (cond)` |
| Table expressions | `itab[ KEY ('SK') INDEX 1 ]` · `itab[ ('COL2') = v ('COL3') = w ]` · `itab[ KEY ('PRIMARY_KEY') COMPONENTS ('COL1') = 1 ]` · `itab[ 1 ]-('COL2') = v` |
| `LOOP AT` | `... USING KEY ('SK')` · `WHERE (cond)` (cond = char dobj or `string_table`) |
| `INSERT` | `INSERT LINES OF ... USING KEY ('SK') INTO itab.` |
| `MODIFY` | `MODIFY TABLE itab FROM wa USING KEY ('SK') TRANSPORTING ('COL3').` · `MODIFY itab FROM wa TRANSPORTING ('COL3') WHERE (cond).` |
| `DELETE` | `DELETE TABLE itab WITH TABLE KEY ('SK') COMPONENTS ('COL2') = v.` · `DELETE itab INDEX 1 USING KEY ('SK').` · `DELETE itab WHERE (cond_tab).` · `DELETE ADJACENT DUPLICATES ... COMPARING (...)` |
| `CLEAR` | `CLEAR s-('COMP1').` |

`USING KEY` accepts the predefined `('PRIMARY_KEY')` or a secondary key name. A dynamic `WHERE` may be a single character-like object or a `string_table` of fragments.

## ABAP SQL

| Clause | Dynamic form |
|---|---|
| Field list | `SELECT (select_list) ...` (`select_list = 'CARRID, CONNID'` or `string_table`) |
| `FROM` | `SELECT (select_list) FROM (table) ...` — never leave the field list wildcarded when the table is also dynamic |
| `WHERE` | `WHERE (where_clause)` (string or `string_table`) |
| `ORDER BY` | `ORDER BY (`FLDATE`)` |
| `GROUP BY` | `GROUP BY (col)` |
| CTE | `WITH (dyn_cte) INTO TABLE NEW @DATA(lt_result).` |
| `INSERT` | `INSERT (table) FROM @struc.` |
| `UPDATE` | `UPDATE (table) FROM @struc.` · `UPDATE (table) SET (set_clause) WHERE (where).` · `UPDATE (table) FROM TABLE @itab INDICATORS (dyn_ind).` |
| `MODIFY` | `MODIFY (table) FROM @struc.` |
| `DELETE` | `DELETE FROM (table) WHERE (cond).` |
| `MERGE` | `MERGE (dyn_merge).` (string or `string_table`) |

```abap
SELECT (`CARRID, CONNID, FLDATE`)
  FROM (`ZDEMO_ABAP_FLI`)
  WHERE (`CARRID <> ``AA```)
  ORDER BY (`FLDATE`)
  INTO TABLE NEW @DATA(lt_tab).
```

Erroneous dynamic SQL raises `CX_SY_DYNAMIC_OSQL_SYNTAX` / `CX_SY_DYNAMIC_OSQL_SEMANTICS` / `CX_SY_DYNAMIC_OSQL_ERROR` — always wrap in `TRY`. **Bind external input as a host operand (`WHERE (`CARRID = @input`)`), never concatenate it into the clause.**

## Dynamic method calls — `CALL METHOD`

```abap
CALL METHOD (lv_meth).                       "same class, like me->(lv_meth)
CALL METHOD lo_oref->(lv_meth).
CALL METHOD lv_class=>(lv_meth).
CALL METHOD (lv_class)=>meth.
CALL METHOD (lv_class)=>(lv_meth).
CALL METHOD lv_class=>(lv_meth) EXPORTING p1 = a1 IMPORTING p2 = a2.
CALL METHOD lo_oref->(lv_meth) RECEIVING result = lv_r.
CALL METHOD lv_class=>(lv_meth) PARAMETER-TABLE lt_ptab.
```

`ptab` is `abap_parmbind_tab` (line type `abap_parmbind`): `name` (formal param), `kind` (`cl_abap_objectdescr=>exporting`/`importing`/`changing`/`receiving`/`returning`), `value` (`ref to data`). Errors: `CX_SY_DYN_CALL_ILLEGAL_METHOD`, `CX_SY_DYN_CALL_PARAM_MISSING`, `CX_SY_DYN_CALL_ILLEGAL_TYPE`. Inline declarations are **not** allowed for dynamic actual parameters. `CALL METHOD` is otherwise obsolete — use it only for dynamic calls.

## Dynamic function module calls — `CALL FUNCTION`

```abap
DATA(lv_func_name) = 'Z_DEMO_ABAP_TEST_FUNC_M'.
DATA(lt_ptab) = VALUE abap_func_parmbind_tab(
  ( name = 'NUM1'   kind = abap_func_exporting value = NEW i( 3 ) )
  ( name = 'RESULT' kind = abap_func_importing value = NEW string( ) ) ).
CALL FUNCTION lv_func_name PARAMETER-TABLE lt_ptab.
```

## Dynamic BAdI statements — `GET BADI` / `CALL BADI`

```abap
DATA lo_badi_dyn TYPE REF TO cl_badi_base.       "superclass of all BAdI classes
GET BADI lo_badi_dyn TYPE (lv_badi_name) FILTERS operator = '-'.
GET BADI lo_badi_dyn TYPE (lv_badi_name) FILTER-TABLE lt_filter_tab.   "badi_filter_bindings
CALL BADI lo_badi_dyn->(lv_method_name) EXPORTING num1 = 10 RECEIVING result = lv_r.
CALL BADI lo_badi_dyn->(lv_method_name) PARAMETER-TABLE lt_ptab.       "abap_parmbind_tab
```

## Dynamic EML (RAP)

```abap
MODIFY ENTITIES OPERATIONS lt_op_tab MAPPED DATA(ls_mapped) FAILED DATA(ls_failed) REPORTED DATA(ls_reported).
READ   ENTITIES OPERATIONS lt_op_tab_read.
```

`lt_op_tab` is `abp_behv_changes_tab`; `lt_op_tab_read` is `abp_behv_retrievals_tab`. Each row carries `op` (e.g. `if_abap_behv=>op-m-create`), `entity_name`, `instances` (`REF #( ... )`), and for read `results`, `sub_name`, `links`, `full`.

## Other dynamic forms

| Context | Form |
|---|---|
| Transformations | `CALL TRANSFORMATION (t_name) SOURCE (srctab) RESULT (restab).` (`abap_trans_srcbind_tab` / `abap_trans_resbind_tab`) |
| String templates | `\|{ s WIDTH = 10 ALIGN = (1) }\|` · `CASE = (1)` (values from `cl_abap_format` constants) |
| Data clusters | `EXPORT (param_table) TO DATA BUFFER buffer.` · `IMPORT (param_table) FROM DATA BUFFER buffer.` |

## Security gate (all dynamic input)

Use `CL_ABAP_DYN_PRG` to validate external content before it enters a dynamic statement:

```abap
DATA(lv_valid) = cl_abap_dyn_prg=>check_allowlist(
  val = lv_dbtab allowlist_str = `ZDEMO_ABAP_CARR,ZDEMO_ABAP_FLI` ).   "CX_ABAP_NOT_IN_ALLOWLIST on miss
```

Other helpers: `check_char_literal`, `check_variable_name`, `check_column_name`, `escape_quotes`, plus the built-in `escape( )` function. Never trust unchecked external input in `WHERE`, `FROM`, `SET`, a dynamic call name, or `GENERATE SUBROUTINE POOL` / `INSERT REPORT`.

> Source: SAP-samples/abap-cheat-sheets — [06_Dynamic_Programming.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/06_Dynamic_Programming.md) (Dynamic ABAP Statements and Security sections).
