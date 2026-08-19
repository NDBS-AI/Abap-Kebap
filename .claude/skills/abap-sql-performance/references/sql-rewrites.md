# Slow → Fast SQL Rewrites

Common ABAP SQL anti-patterns with their fast replacements.

## 1. SELECT * → explicit field list

```abap
" Slow
SELECT * FROM mara WHERE matkl = 'X1' INTO TABLE @DATA(materials).

" Fast
SELECT matnr, matkl, meins, mtart
  FROM mara
  WHERE matkl = 'X1'
  INTO TABLE @DATA(materials).
```

## 2. SELECT in LOOP → FAE outside

```abap
" Slow — N selects
LOOP AT lt_orders INTO DATA(ls_o).
  SELECT SINGLE name1 FROM kna1 WHERE kunnr = @ls_o-kunnr INTO @DATA(name).
  ls_o-customer_name = name.
  MODIFY lt_orders FROM ls_o.
ENDLOOP.

" Fast — 1 FAE, then merge
IF lt_orders IS NOT INITIAL.
  TYPES customer_id_table TYPE STANDARD TABLE OF kunnr WITH EMPTY KEY.
  DATA(customer_ids) = VALUE customer_id_table( FOR <order> IN lt_orders ( <order>-kunnr ) ).
  SORT customer_ids. DELETE ADJACENT DUPLICATES FROM customer_ids.

  SELECT kunnr, name1
    FROM kna1
    FOR ALL ENTRIES IN @customer_ids
    WHERE kunnr = @customer_ids-table_line
    INTO TABLE @DATA(customers).
  " for large result sets: declare customers SORTED with key kunnr for the lookup below

  LOOP AT lt_orders ASSIGNING FIELD-SYMBOL(<order>).
    <order>-customer_name = VALUE #( customers[ kunnr = <order>-kunnr ]-name1 OPTIONAL ).
  ENDLOOP.
ENDIF.
```

## 3. ABAP-side sum → SQL aggregate

```abap
" Slow
SELECT customer_id, amount FROM zinvoice
  WHERE open = 'X' INTO TABLE @DATA(invoices).
LOOP AT invoices INTO DATA(inv).
  COLLECT VALUE customer_total( customer_id = inv-customer_id total = inv-amount )
    INTO totals.
ENDLOOP.

" Fast
SELECT customer_id, SUM( amount ) AS total
  FROM zinvoice
  WHERE open = 'X'
  GROUP BY customer_id
  INTO TABLE @DATA(totals).
```

## 4. UPDATE in LOOP → batched UPDATE FROM table

```abap
" Slow
LOOP AT lt_updates INTO DATA(upd).
  UPDATE zsomething SET status = upd-status WHERE id = upd-id.
ENDLOOP.

" Fast
UPDATE zsomething FROM TABLE @lt_updates.
```

(Caveat: the second form replaces the *entire* row from the table; use carefully if you only want to update certain fields. For partial updates, use `UPDATE ... SET` with an explicit field list, or `UPDATE dbtab FROM TABLE @itab INDICATORS SET STRUCTURE ...` to change only flagged fields — a `MODIFY` from a partially filled structure would overwrite the remaining fields with initial values.)

## 5. SELECT INTO TABLE without WHERE → bounded

```abap
" Wrong (full table read)
SELECT log_id, created_at, severity, message FROM zlog INTO TABLE @DATA(logs).

" Right (bounded by a real filter)
SELECT log_id, created_at, severity, message FROM zlog
  WHERE created_at >= @yesterday
  ORDER BY created_at DESCENDING
  INTO TABLE @DATA(logs)
  UP TO 1000 ROWS.
```

## 6. Multiple SELECTs on master data → single read with cache

```abap
" Wasteful — called from many code paths
METHOD get_company_currency.
  SELECT SINGLE waers FROM t001
    WHERE bukrs = @bukrs
    INTO @result.
ENDMETHOD.

" Better — cache at service level
CLASS cl_company_master DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    METHODS currency_for IMPORTING bukrs TYPE bukrs RETURNING VALUE(result) TYPE waers.
  PRIVATE SECTION.
    DATA cache TYPE HASHED TABLE OF currency_row WITH UNIQUE KEY bukrs.
ENDCLASS.

CLASS cl_company_master IMPLEMENTATION.
  METHOD currency_for.
    READ TABLE cache ASSIGNING FIELD-SYMBOL(<cache_entry>) WITH TABLE KEY bukrs = bukrs.
    IF sy-subrc <> 0.
      SELECT SINGLE waers FROM t001 WHERE bukrs = @bukrs INTO @DATA(waers).
      INSERT VALUE #( bukrs = bukrs waers = waers ) INTO TABLE cache.
      result = waers.
    ELSE.
      result = <cache_entry>-waers.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
```

For T001 specifically the table is already buffered, so the savings are smaller — but the pattern is general for any non-buffered lookup.

## 7. Nested LOOP join → SQL JOIN

```abap
" Slow — O(n*m)
LOOP AT lt_orders ASSIGNING FIELD-SYMBOL(<order>).
  LOOP AT lt_customers ASSIGNING FIELD-SYMBOL(<customer>)
       WHERE id = <order>-customer_id.
    APPEND VALUE #( order_id      = <order>-id
                    customer_name = <customer>-name ) TO joined.
  ENDLOOP.
ENDLOOP.

" Fast — declare customers SORTED with the key, or use SQL JOIN
SELECT o~id AS order_id, c~name AS customer_name
  FROM zorder AS o
  INNER JOIN zcustomer AS c ON c~id = o~customer_id
  INTO TABLE @joined.
```

## 8. WHERE doesn't cover the index's leading column(s) → add the leading column to WHERE, or create a supporting index

The order in which WHERE conditions are *written* in the ABAP source has no effect on the optimizer — it
parses the WHERE clause into a set of predicates, not a sequence of source lines, and is free to evaluate
them in whatever order the chosen access path calls for. What actually matters is which **columns** the
WHERE clause supplies values for, relative to the index's leading (leftmost) columns. An index on
`(bukrs, gjahr, belnr)` can only be used for an efficient range/equality scan if the query also constrains
`bukrs` (and, to benefit from the next level too, `gjahr`); a WHERE that mentions only `belnr` cannot use
that index's ordering at all, no matter where in the source the condition is placed.

```abap
" Slow if index on (bukrs, gjahr, belnr) and you don't filter bukrs
SELECT bukrs, gjahr, belnr, budat, blart FROM bkpf WHERE belnr = @doc INTO TABLE @DATA(documents).

" Fast — either add bukrs (the index's leading column) to WHERE if you know it
SELECT bukrs, gjahr, belnr, budat, blart FROM bkpf WHERE bukrs = @company AND belnr = @doc INTO TABLE @DATA(documents).

" Or accept that a different index is needed (DBA conversation)
```

Don't guess from the source code — confirm against the actual execution plan. Use ST05 (or its ADT "SQL
Trace" perspective) and click "Explain" on the captured statement, or run `EXPLAIN` directly, to see which
index the database chose and whether it produced a range/unique-index scan or a full table scan.

ABAP cannot create or alter standard indexes on SAP-delivered tables in cloud; in on-prem dev systems, use SE11 → "Indexes" → "Create" and transport carefully.

## 9. BYPASSING BUFFER without reason → trust the buffer

```abap
" Wrong
SELECT SINGLE waers FROM t001
  BYPASSING BUFFER     " no reason given
  WHERE bukrs = @bukrs
  INTO @result.

" Right
SELECT SINGLE waers FROM t001
  WHERE bukrs = @bukrs
  INTO @result.
```

The buffer is consistent within a session. Use BYPASSING BUFFER only when you genuinely need DB-fresh data (very rare for customizing).

## 10. ORDER BY in DB when buffered → sort in ABAP

```abap
" Buffer bypassed because of ORDER BY
SELECT arbgb, msgnr, text FROM t100 WHERE sprsl = 'EN'
  ORDER BY arbgb msgnr
  INTO TABLE @DATA(messages).

" Use buffer, sort after
SELECT arbgb, msgnr, text FROM t100 WHERE sprsl = 'EN'
  INTO TABLE @DATA(messages).
SORT messages BY arbgb msgnr.
```

For non-buffered tables, prefer DB sort (it's cheaper than ABAP sort on large result sets).
