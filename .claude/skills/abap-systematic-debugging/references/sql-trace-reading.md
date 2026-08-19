# Reading an ST05 SQL Trace

ST05 (Performance Trace) is the single most useful tool for DB-related ABAP problems. This guide walks the typical analysis path.

## Capture

1. `ST05` → Activate Trace for "SQL" (also "Buffer" if buffer-related; "Enqueue" for lock issues).
2. Pin "Trace for own user only" unless you need cross-user (rare).
3. Reproduce the symptom in another session.
4. Return to ST05 → Deactivate.
5. Click "Display Trace" → choose time window. Save with a comment (e.g. `Order 4500001234 timeout 2026-03-05`) so the trace survives roll-over.

## First pass — aggregated view

The unaggregated trace is overwhelming. Switch to the aggregated view:

- Click **"Summarize trace by SQL statement"** (sigma icon).
- Sort by **"Duration (total)"** descending.

The top 1–5 statements are almost always where the time went. If the slowest statement is 80% of total, you have one problem to solve, not many.

## What each column means

| Column | Reading |
|---|---|
| **Executions** | How many times the statement was issued. >1 with the same bind values = redundancy or N+1. |
| **Identical** | How many had identical bind parameters. Identical >0 = wasted SELECTs that could be cached or hoisted. |
| **Records** | Rows returned across all executions. Records / Executions = avg rows per call. |
| **Time (ms)** | Total wall-clock for this statement. |
| **Mean (ms)** | Per-execution average. >100ms on a primary-key SELECT is a problem. |
| **Buffer** | Whether the statement was answered from the table buffer. `S`=single, `G`=generic, `P`=partial, blank=DB. Sudden missing buffer hits often indicate buffer bypass (`BYPASSING BUFFER`) or invalidation. |

## Pattern recognition

### Pattern A: N+1 selects
- Same statement, many executions, near-identical mean time, called from one ABAP location.
- Cause: `SELECT` inside a `LOOP AT`.
- Fix: hoist out and use FOR ALL ENTRIES (with empty check + DISTINCT) or `SELECT … INNER JOIN` over both tables.

```abap
" Before (N+1)
LOOP AT lt_invoices INTO DATA(ls_inv).
  SELECT SINGLE name1 FROM kna1 INTO @DATA(name) WHERE kunnr = @ls_inv-kunnr.
ENDLOOP.

" After (1 SELECT)
SELECT kunnr, name1 FROM kna1
  INTO TABLE @DATA(customers)
  FOR ALL ENTRIES IN @lt_invoices
  WHERE kunnr = @lt_invoices-kunnr.
```

### Pattern B: Redundant selects
- Same statement, same bind values, executed multiple times in the same business transaction.
- Cause: helpers each load the same lookup from scratch.
- Fix: cache once at the boundary; or move into a service that exposes the cached value.

### Pattern C: Slow primary-key SELECT
- 1 execution, but mean time is high (e.g. 200ms) on a SELECT by primary key.
- Cause: index missing or DB statistics outdated, or table is too large for index lookup.
- Fix: click "Explain" — does the plan show `Index unique scan`? If yes, suspect concurrent locking or DB-side issue. If no, the optimizer is choosing wrong; collect statistics or consult DBA. SAP-side action is usually limited.

### Pattern D: SELECT * on a wide table
- "Recording Layer" shows the field list. If all fields of `MARA` (>100 columns) are pulled, you are paying for buffer + network for unused columns.
- Fix: explicit field list. Often saves 30–60% on the call cost.

### Pattern E: Missing WHERE
- Trace shows `SELECT … FROM zlarge_log WHERE mandt = '100'` with millions of rows.
- Cause: client-only WHERE; no real filter.
- Fix: add a real WHERE or use `UP TO n ROWS` if exploratory.

### Pattern F: Missing leading index column
- Trace shows an index used but slow (large range scan instead of a tight index/unique scan).
- Cause: the WHERE clause doesn't supply a value for the index's leading (leftmost) column(s). This is
  about which columns are present in the WHERE clause, not the order they're written in the ABAP source —
  source-code order has no effect on the optimizer.
- Fix: add the missing leading column to WHERE if the caller can supply it, or take it to the DBA as a
  request for a supporting index. Confirm with "Explain" on the trace entry (or `EXPLAIN`) which index and
  access path the database actually chose before changing anything.

### Pattern G: Buffer bypass
- Statement on a buffered table (e.g. T001, T100) shows blank in Buffer column.
- Cause: `BYPASSING BUFFER`, `FOR ALL ENTRIES` with > 1024 rows, `ORDER BY`, certain joins, modification of the buffer just happened.
- Fix: remove `BYPASSING BUFFER` if accidentally added; respect FAE chunking; check that `ORDER BY` is really needed.

### Pattern H: Aggregation client-side
- Trace shows `SELECT field1 INTO TABLE` then ABAP `LOOP` summing.
- Fix: `SELECT SUM( field1 ) FROM …` — done in DB.

### Pattern I: ENQUEUE lock waits (only if Enqueue trace was on)
- High Enqueue Service time vs SQL time.
- Cause: contention on a shared lock object.
- Fix: shorten the critical section between ENQUEUE and DEQUEUE; redesign the locking granularity if needed.

## "Explain Plan"

Click "Explain Plan" on a slow statement. Things to look for:

- **`Index unique scan`** — primary-key lookup. Fast, expected for SELECT SINGLE by key.
- **`Index range scan`** — index used for a range filter. Fast if the index columns match WHERE.
- **`Full table scan`** — no useful index. Acceptable on small (< 10K row) tables; bad on large.
- **`Hash join`, `Nested loop join`, `Merge join`** — join strategy. Nested loop on a large outer = problem.
- **High estimated rows when actual is low (or vice versa)** — stats are stale. Note for DBA.

The exact wording differs per DB vendor (HANA shows `COLUMN SEARCH`, `JOIN`, etc.). The categories are the same.

## When ST05 doesn't help

- Problem is in ABAP CPU, not DB → use SAT (runtime analysis) instead.
- Problem is across systems / RFC → ST05 on both, correlate by user + timestamp.
- Problem is intermittent → schedule ST05 in the affected user's session, ask the user to reproduce.
- Problem is a *missing* SELECT (data not loaded) → the bug is in the ABAP filter, not the SQL itself. Read the ABAP, not the trace.

## Reading checklist

Open trace. Then:
- [ ] Switched to aggregated view
- [ ] Sorted by total duration descending
- [ ] Top statement examined: where is it called from in ABAP?
- [ ] Same statement many times → N+1 candidate (Pattern A)
- [ ] Same statement same bind values multiple times → redundancy (Pattern B)
- [ ] Slow per-execution on PK SELECT → "Explain" plan (Pattern C)
- [ ] Wide column list → narrow it (Pattern D)
- [ ] Missing WHERE → add it (Pattern E)
- [ ] Blank buffer column on buffered table → investigate bypass (Pattern G)
- [ ] ABAP-side aggregation → push to SQL (Pattern H)
- [ ] One concrete fix identified per pattern found
- [ ] Trace saved with descriptive name before closing
