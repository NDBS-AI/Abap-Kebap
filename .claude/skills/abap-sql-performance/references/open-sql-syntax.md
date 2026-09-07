# Open SQL Syntax Catalog

The full **syntax** reference for ABAP SQL (Open SQL). This complements `SKILL.md`, which is about
*performance decisions*; this file is about *what the syntax is*. All snippets are copied verbatim
from the SAP-samples ABAP cheat sheets and the ABAP Keyword Documentation.

Main keywords:

| Keyword  | Purpose                                                                   |
| -------- | ------------------------------------------------------------------------- |
| `SELECT` | Reads data from data sources such as database tables and others           |
| `INSERT` | Adds rows to database tables                                              |
| `UPDATE` | Changes the content of rows of database tables                            |
| `MODIFY` | Inserts rows into database tables or changes the content of existing rows |
| `DELETE` | Deletes rows from database tables                                         |

> Source: [abap-cheat-sheets/03_ABAP_SQL.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md); [ABAP Keyword Documentation — ABAP SQL](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabap_sql.htm)

For performance-decision guidance on these constructs (FAE vs JOIN vs EXISTS, buffering, aggregation push-down,
SELECT * audits, cloud restrictions), stay in [../SKILL.md](../SKILL.md).

---

## 1. SELECT — basic shape

`SELECT` has many clauses. The mandatory shape and a recommended `WHERE`:

```abap
SELECT FROM source   "What data source to read from
  FIELDS field_list  "What columns should be read
  WHERE condition    "Specifies conditions on which a row/rows should be read
  INTO target.       "Specifies the target of the result set
```

Modern arrangement notes:
- Put the `INTO` clause **after** the other clauses.
- Data objects and expressions need [host variables](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenhost_variable_glosry.htm) (`@dobj`) or host expressions (`@( ... )`).
- The field list can follow `SELECT` directly (no `FIELDS`). These two are equivalent:

```abap
SELECT FROM dbtab
  FIELDS comp1, comp2, comp3
  ...

SELECT comp1, comp2, comp3
  FROM dbtab
  ...
```

> Source: [03_ABAP_SQL.md — Basic Syntax / Notes on Modern SELECT](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

---

## 2. SELECT list / FIELDS clause

| Syntax | Notes |
|---|---|
| `SELECT * ...` / `SELECT ... FIELDS * ...` | All columns, in source order |
| `SELECT col1, col2, col3 ...` | Comma-separated column list |
| `SELECT data_source~col1, ... ...` | Column selector `~` prefixes the data source name |
| `SELECT data_source~* ...` | All columns of one named source |
| `SELECT col1 AS al1, ... ...` | Alias names with `AS` (use each alias once; required for SQL expressions) |

```abap
"Comma-separated list, data source explicitly specified
SELECT dbtab~col1, dbtab~col2, col3
  FROM dbtab
  WHERE ...
  INTO ...

"Alias names — match a target component name, or name an SQL expression
SELECT comp1 AS comp_a, comp2 AS comp_b, comp3 AS comp_c
  FROM dbtab
  WHERE ...
  INTO CORRESPONDING FIELDS OF TABLE @lt_itab.

"Alias name also possible for the data source
SELECT ds~col1, ds~col2, ds~col3
  FROM dbtab AS ds
  WHERE ...
  INTO ...
```

> Source: [03_ABAP_SQL.md — Specifying the SELECT List or FIELDS Clause](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

---

## 3. INTO — targets and related additions

Reading the result into a structure, internal table, individual elementary objects, or an anonymous data
object. Inline declaration (`@DATA(...)`, `@FINAL(...)`, `NEW @DATA(...)`) creates the target in place.
See [abap-internal-tables](../../abap-internal-tables/SKILL.md) for the resulting table type (standard, empty key).

```abap
"Single row into a structure
SELECT SINGLE comp1, comp2, comp3
  FROM dbtab
  WHERE ...
  INTO @ls_struc.

"Multiple rows into an internal table (declared inline)
SELECT comp1, comp2, comp3
  FROM dbtab
  WHERE ...
  INTO TABLE @DATA(lt_itab).

"INTO CORRESPONDING FIELDS OF — assign by name, not position
SELECT FROM dbtab
  FIELDS comp1, comp2, comp3
  WHERE ...
  INTO CORRESPONDING FIELDS OF TABLE @lt_itab.

"APPENDING keeps existing rows (INTO initializes the target)
SELECT comp1, comp2, comp3 FROM dbtab
  WHERE ...
  APPENDING TABLE @lt_itab.

"NEW — anonymous data object as target
SELECT carrid, connid, cityfrom, cityto
  FROM zdemo_abap_flsch
  INTO TABLE NEW @DATA(lr_itab_ref).

"INTO a parenthesized list of elementary objects (order = SELECT list order)
SELECT SINGLE FROM zdemo_abap_carr
  FIELDS carrid, carrname, url
  WHERE carrid = char`LH`
  INTO ( @lv_id, @DATA(lv_name2), NEW @FINAL(lr_dref) ).
```

**Basic rule:** Without `CORRESPONDING ...`, column **position** matters, not name. With `CORRESPONDING ...`,
column **name** matters, not position.

### SELECT loop, existence check, DISTINCT

```abap
"SELECT loop — assignment to a structure, no SINGLE; close with ENDSELECT
SELECT FROM dbtab
  FIELDS *
  WHERE ...
  INTO @ls_struc.
    IF sy-subrc = 0.
      ...
    ENDIF.
ENDSELECT.

"Existence check
SELECT SINGLE @abap_true
  FROM dbtab
  WHERE ...
  INTO @DATA(lv_exists).

"DISTINCT — remove duplicate rows (not allowed with SINGLE)
SELECT DISTINCT cityfrom
  FROM zdemo_abap_flsch
  WHERE carrid = 'LH' AND cityto = 'NEW YORK'
  INTO TABLE @DATA(lt_itab_distinct).
```

> Source: [03_ABAP_SQL.md — Specifying the Target and Related Additions](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

---

## 4. UP TO n ROWS / OFFSET / PACKAGE SIZE

```abap
"At most n rows. If INTO is the last clause, UP TO follows it.
SELECT comp1, comp2, comp3 FROM dbtab
  WHERE ...
  INTO TABLE @DATA(lt_itab_upto)
  UP TO 5 ROWS.

"OFFSET — skip the first n rows of the result set. Requires ORDER BY.
SELECT carrid, connid, cityfrom, cityto, fltime
  FROM ztest_abap_flsch
  WHERE carrid = 'LH'
  ORDER BY fltime ASCENDING
  INTO TABLE @DATA(lt_itab)
  OFFSET 2.

"PACKAGE SIZE — opens a SELECT loop, n rows per iteration; close with ENDSELECT
SELECT FROM dbtab
  FIELDS comp1, comp2, comp3
  WHERE ...
  INTO TABLE @DATA(lt_itab_pack) PACKAGE SIZE n.
...
ENDSELECT.
```

`UP TO 10 ROWS OFFSET 20` = page 3 of 10 (requires `ORDER BY`). For `PACKAGE SIZE` as a memory-control and
chunked-driver pattern, see [../SKILL.md](../SKILL.md) (PACKAGE SIZE section).

> Source: [03_ABAP_SQL.md — UP TO n ROWS / OFFSET n / PACKAGE SIZE](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

---

## 5. FROM — single source

Data sources: DDIC database tables, CDS entities (view entities, table functions), and internal tables.
An internal table source must be a host variable (`@itab`) with a mandatory alias.

```abap
"Database table
SELECT comp1, comp2, comp3 FROM dbtab WHERE ... INTO ...

"CDS view entity
SELECT comp1, comp2, comp3 FROM cds_view WHERE ... INTO ...

"Internal table as data source — host variable + alias mandatory
SELECT FROM @lt_itab AS it
  FIELDS *
  INTO TABLE @DATA(lt_itab_it).
```

> Source: [03_ABAP_SQL.md — Specifying the FROM Clause](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

---

## 6. JOINs

Combine columns of two or more data sources. Use the column selector `~` for ambiguous column names.

### INNER JOIN

```abap
SELECT a~comp1, a~comp2, b~comp3, c~comp4
  FROM dbtab1 AS a
  INNER JOIN dbtab2 AS b ON a~comp1 = b~comp1 AND a~comp2 = b~comp2
  INNER JOIN dbtab3 AS c ON a~comp1 = c~comp1
  WHERE ...
  INTO ...
```

### LEFT / RIGHT OUTER JOIN

Same result set as the inner join, but for each row on the preserved side at least one result row is
created even when the other side has no match; the unmatched columns are filled with [null values](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abennull_value_glosry.htm).

```abap
"Left outer join
SELECT a~comp1, a~comp2, b~comp3
  FROM dbtab1 AS a
  LEFT OUTER JOIN dbtab2 AS b ON a~comp1 = b~comp1
  WHERE ...
  INTO ...
```

`RIGHT OUTER JOIN` is the mirror image (rows on the right side are preserved). There are also `CROSS JOIN`
and further variants — see the [joins documentation](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapselect_join.htm).

Null values produced by an outer join can be detected with `IS [NOT] NULL` (section 8), replaced with
`coalesce( ... )` (section 11), or captured with the `INDICATORS NULL STRUCTURE` addition to `INTO`.

> Source: [03_ABAP_SQL.md — Combining Data of Multiple Data Sources](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md); [ABAP Keyword Documentation — joins](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapselect_join.htm)

---

## 7. WHERE — operators

Logical expressions restrict the rows in the result set (or the rows to be modified). Without `WHERE`,
**all** rows are processed. Combine with `AND` / `OR` / `NOT` / parentheses. Columns of types like `string`
and `rawstring` cannot be used in the condition.

Operator overview (symbolic and keyword forms are equivalent):

```abap
... a = b ...   / ... a EQ b ...    "equal
... a <> b ...  / ... a NE b ...    "not equal
... a < b ...   / ... a LT b ...    "less than
... a > b ...   / ... a GT b ...    "greater than
... a <= b ...  / ... a LE b ...    "less than or equal
... a >= b ...  / ... a GE b ...    "greater than or equal
... AND ... / ... OR ... / ... ( ... ) ...
... a [=|<>|>|<|...] [ALL|ANY|SOME] ( SELECT ... ) ...
... a [NOT] BETWEEN b AND c ...
... a [NOT] LIKE b [ESCAPE c] ...
... a IS [NOT] INITIAL ...
... a [NOT] IN (b, c, ...) ...
... a [NOT] IN ( SELECT ... ) ...
... ( a, b, ... ) IN ( ( d, e, ... ) ( f, g, ...) ... ) ...
... ( a, b, ... ) IN ( SELECT ... ) ...
... a [NOT] IN @ranges_table ...
... EXISTS ( SELECT ... ) ...
... a IS [NOT] NULL ...
... (dynamic_where_clause) ...
```

> Source: [03_ABAP_SQL.md — SQL Conditions](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md); [31_WHERE_Conditions.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/31_WHERE_Conditions.md)

### Comparison, AND/OR/NOT, parentheses

```abap
SELECT FROM dbtab
  FIELDS comp1, comp2, comp3
  WHERE comp1 = 'abc'
    AND comp2 < 123
  INTO ...

SELECT id FROM @lt_itab AS tab
  WHERE ( animal = 'bear' AND count = 5 )
    OR ( animal = 'lion' AND count = 20 )
  INTO TABLE @lt_it.

SELECT id FROM @lt_itab AS tab
  WHERE count > 10
    OR NOT ( animal = 'kangaroo' AND count = 8 )
  INTO TABLE @lt_it.
```

### BETWEEN

```abap
SELECT id FROM @lt_itab AS tab
  WHERE count BETWEEN 1 AND 10
  INTO TABLE @lt_it.

SELECT id FROM @lt_itab AS tab
  WHERE count NOT BETWEEN 1 AND 10
  INTO TABLE @lt_it.
```

### LIKE (+ ESCAPE)

`%` = any character string (including empty), `_` = any single character. `ESCAPE c` escapes a wildcard so
it is matched literally.

```abap
SELECT animal FROM @lt_itab AS tab
  WHERE animal LIKE '%ee%'
     OR animal LIKE '_e%'
  INTO TABLE @DATA(lt_animals).

"ESCAPE: match any sequence followed by a literal % character
SELECT animal FROM @lt_itab AS tab
  WHERE animal LIKE '%#%' ESCAPE '#'
  INTO TABLE @lt_animals.
```

### IS [NOT] INITIAL

```abap
SELECT id FROM @lt_itab AS tab
  WHERE count IS INITIAL
  INTO TABLE @lt_it.

SELECT id FROM @lt_itab AS tab
  WHERE count IS NOT INITIAL
  INTO TABLE @lt_it.
```

### IN (value list) and IN (subquery)

```abap
"Value list
SELECT id FROM @lt_itab AS tab
  WHERE animal IN ( 'elephant', 'gorilla', 'dog', 'snake' )
  INTO TABLE @lt_it.

SELECT id FROM @lt_itab AS tab
  WHERE animal NOT IN ( 'chimpanzee', 'dog', 'snake' )
  INTO TABLE @lt_it.

"Subquery (scalar — single column in the subquery SELECT list)
SELECT id FROM @lt_itab AS tab
  WHERE count IN ( SELECT key_field FROM zdemo_abap_tab1 WHERE num1 <= 40 )
  INTO TABLE @lt_it.
```

### Tuple IN — value tuples and subquery

```abap
"Tuple against a list of value tuples (NOT not supported here)
SELECT id FROM @lt_itab AS tab
  WHERE ( id, animal ) IN ( ( 1, 'bear' ), ( 3, 'giraffe' ), ( 987, 'flamingo' ), ( 2, 'dog' ) )
  INTO TABLE @lt_it.

"Tuple against a subquery (same element count and order)
SELECT id FROM @lt_itab AS tab
  WHERE ( id, count ) IN ( SELECT key_field, num1 FROM zdemo_abap_tab1 )
  INTO TABLE @lt_it.
```

### Comparison against a subquery (ALL / ANY / SOME)

The additions `ALL`, `ANY`, `SOME` may be omitted only if the subquery result set has a single row.
`= ANY` / `= SOME` is like `IN ( SELECT ... )`.

```abap
"Single-row result set — no addition needed
SELECT id FROM @lt_itab AS tab
  WHERE count = ( SELECT key_field FROM zdemo_abap_tab1 WHERE num1 = 40 )
  INTO TABLE @lt_it.

"ALL — true if comparison holds for every row of the result set
SELECT id FROM @lt_itab AS tab
  WHERE count > ALL ( SELECT key_field FROM zdemo_abap_tab1 )
  INTO TABLE @lt_it.

"ANY / SOME — true if comparison holds for at least one row
SELECT id FROM @lt_itab AS tab
  WHERE count = ANY ( SELECT key_field FROM zdemo_abap_tab1 WHERE num1 <= 40 )
  INTO TABLE @lt_it.
```

### Ranges table — IN @ranges_table

`CP` and `NP` operators are transformed into case-sensitive `LIKE` conditions.

```abap
DATA lt_rangestab TYPE RANGE OF i.
lt_rangestab = VALUE #( ( sign = 'I' option = 'BT' low = 1 high = 10 ) ).

SELECT id FROM @lt_itab AS tab
  WHERE count IN @lt_rangestab
  INTO TABLE @lt_it.

"Lower than 5 OR greater than/equal to 25
lt_rangestab = VALUE #( ( sign = 'I' option = 'LT' low = 5 )
                     ( sign = 'I' option = 'GE' low = 25 ) ).
SELECT id FROM @lt_itab AS tab
  WHERE count IN @lt_rangestab
  INTO TABLE @lt_it.
```

### EXISTS subquery

True if the subquery result set has at least one row; the fields in the subquery are irrelevant.

```abap
SELECT comp1, comp2, comp3
  FROM dbtab1 AS tab1
  WHERE EXISTS
    ( SELECT comp1 FROM dbtab2
      WHERE comp1 = tab1~comp1 AND comp2 = tab1~comp2 )
  INTO ...
```

`WHERE EXISTS` is the preferred existence-check alternative to FOR ALL ENTRIES — see
[../SKILL.md](../SKILL.md) (FAE vs JOIN vs EXISTS).

### IS [NOT] NULL

```abap
SELECT tab2~key_field, tab1~char2
  FROM zdemo_abap_tab2 AS tab2
  LEFT OUTER JOIN zdemo_abap_tab1 AS tab1 ON tab1~char1 = tab2~char1
  WHERE tab1~char1 IS NULL
  INTO TABLE @DATA(lt_joined_tab).
```

### Dynamic WHERE

A character-like data object or a standard table with character-like line type containing the logical
expression. Not case-sensitive. Mind the injection risk — see [abap-dynamic-programming](../../abap-dynamic-programming/SKILL.md).

```abap
DATA(lv_dynamic_where_clause) = `count > 15`.
SELECT id FROM @lt_itab AS tab
  WHERE (lv_dynamic_where_clause)
  INTO TABLE @lt_it.

DATA(lt_dyn_where_cl_as_tab) = VALUE string_table( ( `animal = 'kangaroo'` )
                                                ( `OR` )
                                                ( `count = 4` ) ).
SELECT id FROM @lt_itab AS tab
  WHERE (lt_dyn_where_cl_as_tab)
  INTO TABLE @lt_it.
```

> Source: [31_WHERE_Conditions.md — WHERE Conditions in ABAP SQL Statements](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/31_WHERE_Conditions.md)

---

## 8. GROUP BY / HAVING / ORDER BY

`GROUP BY` requires every column directly in the `SELECT` list (or as an argument of an SQL expression)
except aggregate-function arguments. `HAVING` filters groups and works only together with `GROUP BY`.
Without `ORDER BY` the result-set order is undefined.

```abap
"GROUP BY with aggregates
SELECT FROM dbtab
  FIELDS comp1, MIN( comp2 ) AS min, MAX( comp2 ) AS max
  WHERE ...
  GROUP BY comp1
  INTO ...

"HAVING — filter groups
SELECT FROM dbtab
  FIELDS comp1, MIN( comp2 ) AS min, MAX( comp3 ) AS max
  WHERE ...
  GROUP BY comp1
  HAVING comp1 LIKE '%XYZ%' AND SUM( comp4 ) > 100
  INTO ...

"ORDER BY — by primary key, or named columns ASCENDING/DESCENDING
SELECT FROM dbtab
  FIELDS comp1, comp2, comp3
  WHERE ...
  ORDER BY PRIMARY KEY
           "comp2 ASCENDING
           "comp2 DESCENDING
  INTO ...
```

Notes:
- If `ORDER BY` and `GROUP BY` are both used, all `ORDER BY` columns must also appear after `GROUP BY`.
- With aggregate functions after `SELECT`, every non-aliased `ORDER BY` column must appear after `SELECT` and `GROUP BY`.

> Source: [03_ABAP_SQL.md — Specifying Clauses to Order, Group and Set Conditions](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

---

## 9. FOR ALL ENTRIES

Components of an internal table are used in the `WHERE` clause for comparison with a column of the data
source; the logical expression is evaluated for every driver row, and the union of the result sets is
returned (with duplicate rows removed automatically). At least one comparison with a driver column is
required, and the driver must not be initial.

```abap
"Checking that the driver table is not initial
IF ( 0 < lines( lt_itab2 ) ).
  SELECT comp1, comp2, comp3
    FROM dbtab
    FOR ALL ENTRIES IN @lt_itab2      "Host variable before internal table
    WHERE comp1 = @lt_itab2-comp1 ... "Comparison with a driver column
    INTO TABLE @lt_itab1
ENDIF.
```

FAE is the most error-prone Open SQL construct. The mandatory empty-check / dedup / key-in-SELECT / sort
discipline lives in **[fae-checklist.md](fae-checklist.md)**, and the FAE-vs-JOIN-vs-EXISTS decision is in
[../SKILL.md](../SKILL.md). In modern ABAP, prefer an internal table as a `SELECT` data source (in `WHERE`
or a join) over FAE where possible.

> Source: [03_ABAP_SQL.md — Selecting Data by Evaluating the Content of Other Tables](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

---

## 10. Set operators — UNION / INTERSECT / EXCEPT

`UNION` appends the second result set to the first. `INTERSECT` returns distinct rows present in both.
`EXCEPT` returns distinct rows of the first query not present in the second.

```abap
"UNION
SELECT FROM dbtab1
  FIELDS ...
  WHERE ...
UNION
SELECT FROM dbtab2
  FIELDS ...
  WHERE ...
  INTO ...

"INTERSECT — distinct rows in both result sets
SELECT zdemo_abap_flsch~carrid, zdemo_abap_carr~carrname
    FROM zdemo_abap_flsch
    INNER JOIN zdemo_abap_carr ON zdemo_abap_carr~carrid = zdemo_abap_flsch~carrid
INTERSECT
SELECT carrid, carrname
    FROM zdemo_abap_carr
    ORDER BY carrid
    INTO TABLE @DATA(lt_itab_w_intersect).

"EXCEPT — rows of the first query not in the second
SELECT carrid
    FROM zdemo_abap_carr
    EXCEPT
        SELECT it~carrid
        FROM @lt_itab AS it
            INNER JOIN zdemo_abap_carr ON zdemo_abap_carr~carrid = it~carrid
    ORDER BY carrid ASCENDING
    INTO TABLE @DATA(lt_itab_w_except).
```

> Source: [03_ABAP_SQL.md — Combining Data of Multiple Data Sources](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md); [ABAP Keyword Documentation — UNION](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapunion.htm)

---

## 11. SELECT column list — SQL expressions and functions

SQL expressions are evaluated on the database and can appear as columns in the `SELECT` list. They can be
enclosed in parentheses to control evaluation priority.

### Arithmetic ( + - * / )

```abap
SELECT SINGLE
  carrid,
  ( 1 + 2 ) * 3 AS calc,                          "+ - * (note: / not allowed in integer expressions)
  CAST( 1 AS D34N ) / CAST( 2 AS D34N ) AS ratio  "/ with type adjustment via CAST
FROM zdemo_abap_carr
WHERE carrid = 'AA'
INTO @DATA(ls_arithmetic_sql_expr).
```

### CAST

```abap
SELECT SINGLE
  carrid,
  CAST( 1 AS D34N ) / CAST( 2 AS D34N ) AS ratio,
  CAST( connid AS INT4 ) AS connidnum,
  CAST( @( cl_abap_context_info=>get_system_date( ) ) AS CHAR ) AS dat
FROM zdemo_abap_fli
WHERE carrid = 'AA'
INTO @DATA(ls_cast_expr).
```

### String expression ( && )

```abap
SELECT SINGLE
  carrid,
  carrid && char`_` && carrname AS concat   "result must be <= 255 chars
FROM zdemo_abap_carr
WHERE carrid = 'AA'
INTO @DATA(ls_string_expr).
```

### CASE (simple and searched)

Without `ELSE`, the result is the null value (which can be made explicit with `NULL`).

```abap
SELECT SINGLE
  carrid,
  "Simple — compares one operand against values
  CASE currcode
    WHEN 'EUR' THEN 'A'
    WHEN 'USD' THEN 'B'
    ELSE 'C'
  END AS case_simple,
  "Searched — evaluates logical expressions
  CASE WHEN length( carrname ) <= 5 THEN 'small'
       WHEN length( carrname ) BETWEEN 6 AND 10 THEN 'mid'
       WHEN length( carrname ) BETWEEN 11 AND 15 THEN 'large'
       ELSE 'huge'
  END AS case_complex
FROM zdemo_abap_carr
WHERE carrid = 'AA'
INTO @DATA(ls_case_expr).
```

### Aggregate expressions

```abap
SELECT
  carrid,
  AVG( fltime ) AS fltime1,
  AVG( fltime AS DEC( 14,4 ) ) AS fltime2,    "with result type
  MAX( fltime ) AS max,
  MIN( fltime ) AS min,
  SUM( fltime ) AS sum,
  COUNT( * ) AS count2,
  COUNT(*) AS count3,                         "same meaning as COUNT( * )
  STRING_AGG( airpfrom, ', ' ) AS string_agg  "chains values, optional separator
FROM zdemo_abap_flsch
WHERE carrid = 'LH'
GROUP BY carrid
INTO TABLE @DATA(lt_agg_exp).
```

### Window expressions ( OVER )

A window function (e.g. an aggregate) followed by `OVER( ... )`. Inside the parentheses: optional
`PARTITION BY` (defines the windows; omitted = all rows), optional `ORDER BY` (order + frame), and an
optional window frame (`ROWS BETWEEN ... AND ...`).

```abap
"Simple windows with PARTITION BY
SELECT carrid, currency,
  SUM( paymentsum ) OVER( PARTITION BY carrid ) AS sum,
  AVG( price AS DEC( 14,2 ) ) OVER( PARTITION BY carrid ) AS avg,
  MAX( price ) OVER( PARTITION BY carrid ) AS max
  FROM zdemo_abap_fli
  ORDER BY carrid
  INTO TABLE @DATA(lt_win).

"Running count with an explicit frame
SELECT carrid, currency, fldate,
  COUNT( * ) OVER( ORDER BY currency, fldate
                   ROWS BETWEEN UNBOUNDED PRECEDING
                            AND CURRENT ROW ) AS count1,
  "Default frame is BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  COUNT( * ) OVER( ORDER BY currency, fldate ) AS count2,
  "Rolling 3-row average (1 preceding + current + 1 following)
  AVG( price AS DEC( 14,2 ) ) OVER( ORDER BY currency, fldate
       ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING ) AS avg
  FROM zdemo_abap_fli
  INTO TABLE @DATA(lt_result).
```

### Built-in functions (selection)

Numeric: `div`, `division`, `ceil`, `mod`, `floor`, `abs`, `round`.
String: `concat`, `concat_with_space`, `initcap`, `instr`, `left`, `length`, `like_regexpr`, `locate`,
`locate_regexpr`, `ltrim`, `occurrences_regexpr`, `replace`, `replace_regexpr`, `right`, `rpad`, `rtrim`,
`substring`, `substring_regexpr`, `upper`. Plus `coalesce`, conversion functions (`bintohex`, `hextobin`,
`to_blob`, `to_clob`, `unit_conversion`, `currency_conversion`, `as_geo_json`), date/time (`add_days`,
`add_months`, `is_valid`), and `uuid( )`.

```abap
"String functions (selection)
SELECT SINGLE
  carrid,
  concat( carrid, carrname ) AS concat,
  substring( carrname, 3, 3 ) AS substring,
  replace( carrname, 'a', '#' ) AS replace,
  upper( carrname ) AS upper,
  length( url ) AS length
  FROM zdemo_abap_carr
  WHERE carrid = 'LH'
  INTO @DATA(ls_string_functions).

"coalesce — replace null values produced by an outer join
SELECT tab2~key_field,
       coalesce( tab1~char1, '-' ) AS coalesced1,
       coalesce( tab1~char2, '#' ) AS coalesced2
    FROM zdemo_abap_tab2 AS tab2
    LEFT OUTER JOIN zdemo_abap_tab1 AS tab1 ON tab1~char1 = tab2~char1
    INTO TABLE @DATA(lt_join_w_null).
```

Built-in functions are also covered in [abap-builtin-functions](../../abap-builtin-functions/SKILL.md) and
[abap-strings-regex](../../abap-strings-regex/SKILL.md).

> Source: [03_ABAP_SQL.md — SQL Expressions / Built-In SQL Functions](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

---

## 12. Common Table Expressions ( WITH )

`WITH` introduces named intermediate result sets (CTEs) reusable in the same statement, and lets you select
directly from a subquery (which plain ABAP SQL does not allow). Each CTE name starts with `+`; the final
main query must reference at least one CTE; a `SELECT` loop in the main query is closed with `ENDWITH.`. A
CTE's result set never has a client column.

```abap
WITH
+connections AS (
  SELECT zdemo_abap_flsch~carrid, carrname, connid, cityfrom, cityto
    FROM zdemo_abap_flsch
    INNER JOIN zdemo_abap_carr
    ON zdemo_abap_carr~carrid = zdemo_abap_flsch~carrid
    WHERE zdemo_abap_flsch~carrid BETWEEN 'AA' AND 'JL' ),
+sum_seats AS (
  SELECT carrid, connid, SUM( seatsocc ) AS sum_seats
    FROM zdemo_abap_fli
    WHERE carrid BETWEEN 'AA' AND 'JL'
    GROUP BY carrid, connid ),
+result( name, connection, departure, arrival, occupied ) AS (
  SELECT carrname, c~connid, cityfrom, cityto, sum_seats
    FROM +connections AS c
    INNER JOIN +sum_seats AS s
    ON c~carrid = s~carrid AND c~connid = s~connid )
SELECT name, connection, departure, arrival, occupied
  FROM +result
  ORDER BY name, connection
  INTO TABLE @DATA(lt_result).
```

> Source: [03_ABAP_SQL.md — Common Table Expressions (CTE)](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md); [ABAP Keyword Documentation — WITH](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapwith.htm)

---

## 13. DML — INSERT / UPDATE / MODIFY / DELETE

Source rows come from a structure, an internal table, or an embedded subquery (`( SELECT ... )`).
Structures and internal tables are host variables (`@row`, `@itab`) or host expressions (`@( ... )`).
All four set `sy-subrc` (0 = success, 4 = not / not all rows processed) and `sy-dbcnt` (rows processed).

### INSERT

```abap
"Single row
INSERT dbtab FROM @ls_row.
INSERT INTO dbtab VALUES @ls_row.                 "alternative syntax, same effect
INSERT dbtab FROM @( VALUE #( comp1 = ... comp2 = ... ) ).

"Multiple rows from an internal table
INSERT dbtab FROM TABLE @lt_itab.

"Avoid the duplicate-key runtime error: discard duplicates, set sy-subrc = 4
INSERT dbtab FROM TABLE @lt_itab ACCEPTING DUPLICATE KEYS.

"From the result set of an embedded subquery
INSERT dbtab FROM ( SELECT ... ).
```

### UPDATE

```abap
"Overwrite entire rows
UPDATE dbtab FROM @ls_row.
UPDATE dbtab FROM TABLE @lt_itab.

"SET — change specific fields without overwriting the others
UPDATE dbtab SET comp2 = 'X'.                              "all rows
UPDATE dbtab SET comp2 = 'X', comp3 = 'Y' WHERE comp4 > 100.
UPDATE dbtab SET comp2 = 'X' WHERE key_field = 'Y'.        "single row by key

"INDICATORS — change only flagged fields (key fields must be present)
TYPES ty_ind_wa TYPE dbtab WITH INDICATORS comp_ind TYPE abap_bool.
DATA lt_ind_tab TYPE TABLE OF ty_ind_wa.
UPDATE dbtab FROM TABLE @lt_ind_tab INDICATORS SET STRUCTURE comp_ind.
UPDATE dbtab FROM TABLE @lt_ind_tab INDICATORS NOT SET STRUCTURE comp_ind.
```

### MODIFY (upsert: insert if absent, overwrite if present)

```abap
MODIFY dbtab FROM @ls_row.
MODIFY dbtab FROM TABLE @lt_itab.
MODIFY dbtab FROM ( SELECT ... ).
```

### DELETE

```abap
"DELETE FROM ... variant
DELETE FROM dbtab.              "all rows
DELETE FROM dbtab WHERE ....    "by condition

"DELETE ... FROM ... variant (by key in a structure / internal table)
DELETE dbtab FROM @ls_row.
DELETE dbtab FROM TABLE @lt_itab.
```

For the slow→fast DML rewrites (UPDATE in a loop → `UPDATE FROM TABLE`), see
[sql-rewrites.md](sql-rewrites.md).

> Source: [03_ABAP_SQL.md — Create, Update, and Delete Operations](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

### MERGE — modify a target by evaluating another source

`MERGE` combines insert/update/delete in one statement based on a right-outer-join match condition.

```abap
MERGE INTO target [AS target_alias]
    USING { source [AS source_alias] | @itab AS itab_alias [DECLARE CLIENT clnt] } ON join_condition
    WHEN MATCHED [AND match_condition ... ] THEN { UPDATE { ALL | SET set_condition } | DELETE }
    WHEN NOT MATCHED [AND match_condition ...] THEN INSERT { ALL | ( columns_list ) VALUES ( values_expressions ) } ... .
```

If both clauses are used, `WHEN MATCHED` must precede `WHEN NOT MATCHED` (the upsert pattern).

> Source: [03_ABAP_SQL.md — MERGE](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

---

## 14. Constructor expressions in ABAP SQL

`VALUE`, `VALUE ... BASE`, and `CORRESPONDING` (with `MAPPING` / `EXCEPT`) build the rows/tables inline as
host expressions. See [abap-constructor-expressions](../../abap-constructor-expressions/SKILL.md).

```abap
"VALUE — internal table in place
INSERT dbtab FROM TABLE @( VALUE #( ( key_field = 1 comp1 = ... )
                                    ( key_field = 2 comp1 = ... ) ) ).

"VALUE + BASE — keep non-modified components on UPDATE
"Read every column explicitly (all of them are needed as BASE for the partial UPDATE below —
"this is not a case for a narrower field list since the row is rebuilt component-for-component)
SELECT SINGLE key_field, comp1, comp2, comp3, comp4 FROM dbtab WHERE key_field = ... INTO @DATA(ls_read_line).
UPDATE dbtab FROM @( VALUE #( BASE ls_read_line comp2 = ... comp4 = ... ) ).

"CORRESPONDING with MAPPING / EXCEPT
INSERT dbtab FROM TABLE @( CORRESPONDING #( lt_another_itab MAPPING key_field = key comp1 = compZ EXCEPT comp2 ) ).
```

> Source: [03_ABAP_SQL.md — Using Constructor Expressions in ABAP SQL Statements](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

---

## 15. Host variables and host expressions ( @ )

SQL operands are columns, literals (untyped or [typed](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abentyped_literal_glosry.htm)),
host variables (`@dobj`), or host expressions (`@( ... )`). Literals are not prefixed with `@`. Typed
literals (`char\`X\``, `int8\`...\``, `datn\`20240102\``, etc.) are passed to and evaluated on the database
without ABAP-side conversion.

```abap
DATA lv_number TYPE i VALUE 3.
SELECT FROM zdemo_abap_flsch
  FIELDS
  cityfrom,                                              "column
  zdemo_abap_flsch~cityto,                               "column with selector
  'Lufthansa' AS name,                                   "untyped literal
  char`X` AS flag,                                       "typed literal
  @lv_number AS num,                                     "host variable
  @( cl_abap_context_info=>get_system_date( ) ) as date  "host expression
  WHERE carrid = 'LH'
    AND countryfr = char`DE`
  INTO TABLE @DATA(lt_it)
  UP TO 3 ROWS.
```

> Source: [03_ABAP_SQL.md — SQL Operands / Typed Literals](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

---

## 16. Dynamic ABAP SQL

The data source (and other tokens) can be specified dynamically with parentheses. See
[abap-dynamic-programming](../../abap-dynamic-programming/SKILL.md) for the full dynamic-token catalog and
the injection-risk discussion.

```abap
DATA(lv_dbtab) = 'ZDEMO_ABAP_FLSCH'.
SELECT carrid, connid, cityfrom, cityto
  FROM (lv_dbtab)
  WHERE ...
  INTO ...
```

> Source: [03_ABAP_SQL.md — Dynamic ABAP SQL Statements](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

---

## 17. Client handling

ABAP SQL does implicit client handling — the current client is used automatically; you cannot (and must
not) filter the client column in `WHERE`.

```abap
"Using the current client implicitly
SELECT carrid, carrname, url FROM zdemo_abap_carr INTO TABLE @DATA(lt_itab1).
"SELECT carrid, carrname, url FROM zdemo_abap_carr WHERE mandt = '123' ...  "syntax error
```

In **classic ABAP only**, `USING CLIENT` disables implicit handling (`CLIENT SPECIFIED` is obsolete). This
is **not** allowed in ABAP Cloud, where you are limited to your own client.

```abap
"---- classic ABAP only ----
SELECT carrid, carrname, url FROM zdemo_abap_carr USING CLIENT '000' INTO TABLE @DATA(lt_itab3).
SELECT carrid, carrname, url FROM zdemo_abap_carr USING CLIENTS IN @lt_client_range INTO TABLE @DATA(lt_itab5).
SELECT carrid, carrname, url FROM zdemo_abap_carr USING ALL CLIENTS INTO TABLE @DATA(lt_itab7).
```

Native SQL / AMDP have no implicit client handling — in ABAP Cloud, AMDP must be client-safe. See
[abap-amdp-hierarchies](../../abap-amdp-hierarchies/SKILL.md). For the cloud SQL restriction list, see
[../SKILL.md](../SKILL.md) (ABAP Cloud / Steampunk constraints).

> Source: [03_ABAP_SQL.md — ABAP SQL and Client Handling](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

---

## 18. Hierarchies (pointer)

Hierarchy data can be used as a data source in `SELECT`. The full SQL-hierarchy syntax
(`HIERARCHY( ... )`, hierarchy navigators, generated columns) is its own topic — see
[abap-amdp-hierarchies](../../abap-amdp-hierarchies/SKILL.md) and the
[ABAP SQL: Working with Hierarchies cheat sheet](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/10_ABAP_SQL_Hierarchies.md)
/ [ABAP Keyword Documentation](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenselect_hierarchy_data.htm).

---

## 19. CRUD on CDS artifacts

Beyond DDIC tables, `define table entity ...` and `define writable view entity ...` support the same
`SELECT` / `INSERT` / `UPDATE` / `MODIFY` / `DELETE` statements shown above. A writable view entity cannot
select from multiple data sources or use joins. For CDS view design, see
[cds-views-authoring](../../cds-views-authoring/SKILL.md).

```abap
@AccessControl.authorizationCheck: #NOT_REQUIRED
@Metadata.ignorePropagatedAnnotations: true
define writable view entity zdemo_abap_animals_we
  as select from zdemo_abap_animals_te
{
  key id,
  animal_name,
  species,
  age
}
```

> Source: [03_ABAP_SQL.md — CRUD Operations Using CDS Artifacts](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

---

## See also

- [../SKILL.md](../SKILL.md) — performance decisions, buffering, cloud constraints, top-10 rules
- [fae-checklist.md](fae-checklist.md) — FOR ALL ENTRIES mandatory checks
- [sql-rewrites.md](sql-rewrites.md) — slow pattern → fast pattern table
- [abap-internal-tables](../../abap-internal-tables/SKILL.md) — `INTO TABLE` result types, keys
- [abap-amdp-hierarchies](../../abap-amdp-hierarchies/SKILL.md) — AMDP / Native SQL / hierarchies
- [abap-dynamic-programming](../../abap-dynamic-programming/SKILL.md) — dynamic FROM / WHERE / tokens
- **ABAP Keyword Documentation — ABAP SQL:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abenabap_sql.htm
- **SAP-samples/abap-cheat-sheets — 03_ABAP_SQL.md:** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md
- **SAP-samples/abap-cheat-sheets — 31_WHERE_Conditions.md:** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/31_WHERE_Conditions.md
