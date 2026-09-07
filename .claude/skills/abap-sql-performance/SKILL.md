---
name: abap-sql-performance
description: Use when writing or reviewing ABAP SQL (also historically called Open SQL) — choosing between FOR ALL ENTRIES (FAE), INNER JOIN, and subquery; investigating an ST05 trace that shows slow or N+1 selects; deciding whether to push aggregation to the database; handling table buffering correctly; or auditing for SELECT *, missing WHERE, and unbounded reads. Includes ABAP Cloud (Steampunk) SQL restrictions. For the hypothesis-driven diagnosis workflow that produces the trace in the first place, use abap-systematic-debugging.
---

# ABAP SQL Performance

## Overview

ABAP SQL hygiene and performance patterns. ABAP's database access layer is powerful but unforgiving: a missing WHERE clause, a wrong join strategy, or a forgotten FAE empty-check turns a 50ms operation into a runaway. This skill collects the rules that catch 90% of real-world ABAP SQL problems.

**Core principle:** read less data, less often. Every column you don't need is network, buffer, and CPU you didn't have to spend.

For the full ABAP SQL **syntax** catalog (SELECT/JOIN/WHERE/aggregation/CTE/set operators/DML), see [references/open-sql-syntax.md](references/open-sql-syntax.md). This SKILL.md stays focused on performance decisions.

## When to Use

- Writing or reviewing any `SELECT`, `UPDATE`, `INSERT`, `DELETE`, `MODIFY`.
- Investigating an ST05 trace that shows redundancy, N+1, or slow per-execution time.
- Deciding between FOR ALL ENTRIES, INNER JOIN, and subquery for a multi-table read.
- Working with buffered tables (T001, T100, etc.) and wondering whether the buffer is being used.
- Refactoring an ABAP `LOOP` that does aggregation into a SQL `GROUP BY`.
- Writing CDS-backed reports and deciding what stays in CDS vs ABAP.
- Targeting ABAP Cloud / Steampunk and checking which SQL is even allowed.

**When NOT to use:**
- For CDS view design itself → [cds-views-authoring](../cds-views-authoring/SKILL.md).
- For investigating a *non-DB* performance problem (CPU-bound ABAP) → SAT, [abap-systematic-debugging](../abap-systematic-debugging/SKILL.md).
- For NewSQL features specific to a particular DB vendor (HANA AMDP, vendor-specific hints) — see vendor docs; this skill stays on ABAP SQL.

## Top 10 Rules

| # | Rule | Why |
|---|---|---|
| 1 | Never `SELECT *`. Always explicit field list. | Buffers + network for unused columns |
| 2 | Never SELECT without WHERE on a transparent business table | Full table scans dominate response time |
| 3 | Never put SELECT inside a LOOP | N+1 pattern — see Pattern A in trace reading |
| 4 | FOR ALL ENTRIES: check driver non-empty AND deduplicate AND include key fields | One forgotten check turns FAE into full table read |
| 5 | Choose the right table type for the access pattern at declaration time | Re-sorting a STANDARD before BINARY SEARCH is wasteful |
| 6 | Aggregate in SQL (`SUM`, `COUNT`, `GROUP BY`) not in ABAP | DB does it in one statement; ABAP does it row by row |
| 7 | Prefer JOIN over FAE when the row count is bounded and ≤ a few hundred per side | Single round trip vs FAE chunked round trips |
| 8 | Don't `BYPASSING BUFFER` without a reason; note FAE bypasses the buffer on single-record-buffered tables and on generic buffering with an incompletely specified generic key | Loses 10–100x speedup on buffered tables |
| 9 | Read once, cache the result, especially for lookup/text tables | Repeated identical SELECTs are pure waste |
| 10 | Use `UP TO n ROWS` when you only need the first n; add `OFFSET n` for pagination | `UP TO 10 ROWS OFFSET 20` = page 3 of 10 (requires `ORDER BY`); avoids fetching & discarding rows in ABAP |

## FOR ALL ENTRIES — the field where most bugs happen

FAE is ABAP's "SELECT … WHERE column IN (list)" — it lets you read child rows for a list of parent keys. It is also the single most error-prone construct in ABAP SQL.

### Mandatory checklist before every FAE

```abap
" 1. Check the driver table is not empty — else FAE = no WHERE = read everything
IF lt_parents IS INITIAL.
  RETURN.   " or whatever no-data action you want
ENDIF.

" 2. Deduplicate the driver — duplicate keys waste database work
"    (each driver row is evaluated; the result set itself is de-duplicated automatically)
SORT lt_parents BY id.
DELETE ADJACENT DUPLICATES FROM lt_parents COMPARING id.
" (or use a SORTED / HASHED table to start with)

" 3. Select with the driver — include the key fields in the SELECT list
"    (FAE removes duplicate result rows automatically; without the key fields,
"    distinct child rows can collapse into one and be lost)
SELECT parent_id, child_id, amount
  FROM child_table
  FOR ALL ENTRIES IN @lt_parents
  WHERE parent_id = @lt_parents-id
  INTO TABLE @DATA(lt_children).

" 4. The result is unsorted — sort if order matters
SORT lt_children BY parent_id child_id.
```

See [references/fae-checklist.md](references/fae-checklist.md) for the full one-page checklist.

### FAE vs JOIN vs EXISTS — when to pick which

| Situation | Pick |
|---|---|
| Driver table comes from prior business logic and is small (< ~100 rows) | FAE |
| Driver is itself a SELECT result and you can rewrite the whole thing as one JOIN | JOIN |
| Driver may be empty | FAE (with empty-check) OR conditional JOIN |
| Driver could grow unboundedly (e.g. customer list) | JOIN, with WHERE constraints |
| The "child" table is buffered | FAE is fine with full-table buffering; it bypasses single-record buffering and incompletely keyed generic buffering — check the buffering type first |
| You only need aggregate on the child side | JOIN + GROUP BY in SQL |
| You only need to know **whether** a child row exists (not retrieve it) | `WHERE EXISTS ( SELECT ... )` |

**EXISTS subquery — when FAE is overkill:**

`WHERE EXISTS` is a clean alternative to FAE for pure existence checks. It carries none of the FAE risks (no empty-driver danger, no duplicate issue) and is a single round trip:

```abap
" Select parent rows that have at least one open child item
SELECT comp1, comp2, comp3
  FROM dbtab1 AS tab1
  WHERE EXISTS
    ( SELECT comp1 FROM dbtab2
      WHERE comp1 = tab1~comp1 AND comp2 = tab1~comp2 )
  INTO TABLE @DATA(lt_result).
```

Use EXISTS when:
- You need a filtered parent set based on child existence — the child data itself is not needed.
- The driver-based FAE would require an empty-check, dedup, and you'd throw the child result away anyway.
- A JOIN would generate duplicate parent rows when multiple children match.

> Source: [ABAP Keyword Documentation — EXISTS](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenwhere_logexp_exists.htm)

### FAE bugs to look for in review

- Driver not checked for empty — selected the whole child table on first run with empty driver
- Driver has duplicates — every duplicate row is evaluated against the database again for nothing (the result set itself is de-duplicated automatically)
- FAE on a single-record-buffered (or incompletely keyed generically buffered) table — buffer bypass without realizing
- Result not sorted but consumer assumed it was
- Result joins multiple key columns but FAE WHERE only mentions one

## PACKAGE SIZE — batch reads

Use `PACKAGE SIZE n` when reading a large result set that would overflow memory if loaded in a single `SELECT … INTO TABLE`. It opens a `SELECT` loop: each iteration fills the target table with at most `n` rows and you process that chunk before the next fetch.

```abap
" Read zdemo_abap_flsch in chunks of 100 rows to avoid memory overruns
SELECT carrid, connid, cityfrom, cityto
  FROM zdemo_abap_flsch
  WHERE carrid BETWEEN 'AA' AND 'LH'
  INTO TABLE @DATA(lt_chunk) PACKAGE SIZE 100.

  " Process this chunk — lt_chunk is replaced on each iteration
  LOOP AT lt_chunk INTO DATA(ls_row).
    " ... business logic per row ...
  ENDLOOP.

ENDSELECT.
```

**When to use:**
- Reading tables that may return millions of rows (logs, document items, aggregation sources).
- Avoiding `MEMORY_NO_MORE_PAGING` dumps caused by a single unbounded read.
- Streaming results through a pipeline (read → transform → write) without holding everything in memory.

**PACKAGE SIZE vs FAE — complementary, not competing:**
- `PACKAGE SIZE` controls *how many rows the SELECT itself delivers per round trip* — useful for the outer/driver read.
- FAE reduces *round trips for child data* by batching key lookups.
- Combine them: use `PACKAGE SIZE` on the driver SELECT to stay within memory, then fire one FAE per chunk.

```abap
" Pattern: chunked driver → FAE per chunk
SELECT id FROM ztransaction_header
  INTO TABLE @DATA(lt_driver_chunk) PACKAGE SIZE 500.

  IF lt_driver_chunk IS INITIAL.
    CONTINUE.
  ENDIF.
  SORT lt_driver_chunk BY id.
  DELETE ADJACENT DUPLICATES FROM lt_driver_chunk COMPARING id.

  SELECT header_id, line_no, amount
    FROM ztransaction_item
    FOR ALL ENTRIES IN @lt_driver_chunk
    WHERE header_id = @lt_driver_chunk-id
    INTO TABLE @DATA(lt_items).

  " ... process items for this chunk ...

ENDSELECT.
```

> Source: [ABAP Keyword Documentation — INTO clause / PACKAGE SIZE](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapinto_clause.htm)

## Table types — pick at declaration

```abap
" Read by key, no order needed — fastest, but key must be unique
DATA lt_orders TYPE HASHED TABLE OF zorder WITH UNIQUE KEY id.

" Need ordered iteration AND keyed lookup
DATA lt_invoices TYPE SORTED TABLE OF zinvoice
  WITH NON-UNIQUE KEY customer_id sortkey.

" Default workhorse — append/iterate; no keyed lookup needs
DATA lt_log_lines TYPE STANDARD TABLE OF zlog.

" Generic secondary key — modern ABAP, mix benefits of both
DATA lt_items TYPE STANDARD TABLE OF zitem
  WITH NON-UNIQUE SORTED KEY by_customer COMPONENTS customer_id.
```

The cost of sorting a 1M-row STANDARD TABLE before a binary search dwarfs the cost of declaring it SORTED in the first place.

## Aggregation — push to SQL

```abap
" Bad
SELECT customer_id, amount FROM zinvoice
  WHERE open = 'X' INTO TABLE @DATA(lt_invoices).
DATA lt_totals TYPE TABLE OF customer_total.
LOOP AT lt_invoices INTO DATA(ls_inv).
  READ TABLE lt_totals ASSIGNING FIELD-SYMBOL(<fs_row>) WITH KEY customer_id = ls_inv-customer_id.
  IF sy-subrc <> 0.
    APPEND VALUE #( customer_id = ls_inv-customer_id total = 0 ) TO lt_totals ASSIGNING <fs_row>.
  ENDIF.
  <fs_row>-total = <fs_row>-total + ls_inv-amount.
ENDLOOP.

" Good — one statement, runs in DB
SELECT customer_id, SUM( amount ) AS total
  FROM zinvoice
  WHERE open = 'X'
  GROUP BY customer_id
  INTO TABLE @DATA(lt_totals).
```

The DB has indexed access, columnar storage (on HANA), and a query optimizer. ABAP has none of those. When the operation is expressible in SQL, write it there.

## Common Table Expressions (WITH)

CTEs let you name intermediate result sets and reuse them in the same statement — the ABAP SQL equivalent of a temporary view that exists only for the duration of one database access.

**When useful:**
- You need the same derived result in more than one place in a query (e.g., aggregated seats joined back to connection data).
- The alternative would be a deeply nested subquery or multiple separate SELECTs into intermediate tables.
- You want to select from a subquery directly, which plain ABAP SQL does not otherwise allow.

**Syntax rules:**
- `WITH` replaces `SELECT` as the outermost keyword.
- Each CTE name starts with `+` (e.g. `+connections`).
- The final clause is a normal `SELECT` that must reference at least one CTE.
- If the main query opens a `SELECT` loop, close it with `ENDWITH.`
- Each CTE's result set has no client column.

```abap
" For each LH/AA…JL connection, compute total occupied seats
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

> Source: [ABAP Keyword Documentation — WITH](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abapwith.htm); [abap-cheat-sheets/03_ABAP_SQL.md — Common Table Expressions](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/03_ABAP_SQL.md)

## Buffering — don't fight it

- Buffered tables (T001 — company codes, T100 — messages, customizing tables) are loaded once per server and answered from memory.
- Buffer is bypassed by: `BYPASSING BUFFER`, `FOR ALL ENTRIES` on single-record-buffered tables or incompletely keyed generic buffering, `ORDER BY`, many JOIN forms, certain aggregate functions. Driver row count does not decide buffer use — the ~1024 FAE blocking factor only splits the driver into multiple DB round trips.
- Check whether a table is buffered: SE11 → table → "Technical Settings" → "Buffering Type".
- Don't add `BYPASSING BUFFER` without a strong reason. The buffer can be 10–100x faster than even an indexed DB read.

## ABAP Cloud / Steampunk constraints

- **Only released DDIC objects.** Use the SAP API Hub (`api.sap.com`) to find released tables and CDS views. Direct access to non-released DDIC is forbidden.
- **No native SQL.** `EXEC SQL` is not allowed.
- **No `MODIFY` on SAP-owned tables.** Use released BAPIs / RAP behaviors.
- **CDS over direct table access.** Even for released tables, CDS views are usually the right entry point.
- **No `CLIENT SPECIFIED`** — client handling is implicit and forbidden to override.

For a current list, see the ABAP Cloud development guide: https://help.sap.com/docs/abap-cloud/

## Common SQL Rewrites

See [references/sql-rewrites.md](references/sql-rewrites.md) for a one-page table of common slow patterns and their fast replacements.

## Common Mistakes

| Mistake | Cost | Fix |
|---|---|---|
| `SELECT *` on a wide table you only need 3 columns from | 30–60% wasted call cost | Explicit field list |
| SELECT in a LOOP | N+1 — quadratic | FAE outside the loop or JOIN |
| FAE without empty-check | Driver empty → full table read | Add the empty-check |
| FAE without DISTINCT / sort | Duplicate driver rows re-evaluated on the DB for nothing | De-dup the driver first |
| BYPASSING BUFFER for "safety" | 10–100x slower lookups | Remove the bypass; trust the buffer |
| `SELECT … INTO TABLE @lt_itab` without WHERE | Unbounded growth, dump TIME_OUT | Always include a real WHERE |
| Aggregation in ABAP `LOOP` | Row-by-row vs single SQL statement | Push to SQL with `SUM`, `GROUP BY` |
| `INNER JOIN` of 5+ tables on the DB side, expecting "the DB is fast" | Query optimizer struggles; high plan cost | Pre-filter to small driver, then FAE the rest |
| `READ TABLE … WITH KEY` on STANDARD TABLE without `BINARY SEARCH` | O(n) instead of O(log n) | Declare as SORTED, or add secondary key |
| Using `ORDER BY` on buffered table | Loses buffer | Sort in ABAP if buffer matters more than DB-side sort |
| Stale ABAP-side cache of master data | Wrong results on master data change | Re-read at transaction boundary, or use BC sets / invalidation |

## References

- [references/open-sql-syntax.md](references/open-sql-syntax.md) — full ABAP SQL syntax catalog (SELECT/JOIN/WHERE/aggregation/CTE/set operators/DML)
- [references/fae-checklist.md](references/fae-checklist.md) — FOR ALL ENTRIES mandatory checks
- [references/sql-rewrites.md](references/sql-rewrites.md) — slow pattern → fast pattern table
- **ABAP Keyword Documentation — ABAP SQL:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm
- **SAP-samples/abap-cheat-sheets — ABAP SQL examples:** https://github.com/SAP-samples/abap-cheat-sheets
- **ABAP Cloud restrictions:** https://help.sap.com/docs/abap-cloud/
- **API Hub (released APIs for Cloud):** https://api.sap.com
- Linked skills: [abap-systematic-debugging](../abap-systematic-debugging/SKILL.md) (ST05 trace reading), [cds-views-authoring](../cds-views-authoring/SKILL.md)
