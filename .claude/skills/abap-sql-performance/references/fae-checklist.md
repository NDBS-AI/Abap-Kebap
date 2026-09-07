# FOR ALL ENTRIES — Mandatory Checklist

For every FAE in a code review or in new code, verify:

## 1. Empty driver guard

```abap
IF lt_parents IS INITIAL.
  CLEAR lt_children.   " or RETURN, or whatever no-data behavior
  RETURN.
ENDIF.
```

**Why:** With an empty driver table the FAE condition is dropped and **all rows** of the data source are read (SAP: "if the internal table is empty, all data will be read"). The guard is cheap; a full table read is not.

## 2. Deduplicated driver

```abap
SORT lt_parents BY id.
DELETE ADJACENT DUPLICATES FROM lt_parents COMPARING id.
```

Or declare the driver as `SORTED TABLE … WITH UNIQUE KEY id` from the start.

**Why:** Duplicates in the driver do **not** duplicate the result — FAE removes duplicate result rows automatically — but every duplicate driver row is evaluated against the database again, inflating the generated IN lists and round trips for nothing.

## 3. Driver key in SELECT field list

```abap
SELECT parent_id, child_id, amount   " include parent_id
  FROM child_table
  FOR ALL ENTRIES IN @lt_parents
  WHERE parent_id = @lt_parents-id
  INTO TABLE @DATA(lt_children).
```

**Why:** Without `parent_id` in the SELECT list, you cannot map child rows back to the right parent in the consuming code. Worse: FAE removes duplicate rows from the result set automatically ("the entire content of a row is respected") — if the SELECT list omits key fields, distinct child rows can collapse into one and silently disappear.

## 4. WHERE matches a useful index

The condition `parent_id = @lt_parents-id` should be a leading column of an index on `child_table`. If not:
- The DB will fall back to full-table scan per chunk → catastrophic slow.
- Either add an index (consult DBA), or restructure (CDS view with proper joins, denormalize at write time, etc.).

Check via SE11 → table → "Indexes". Confirm with ST05 → "Explain Plan".

## 5. Bounded driver size

The driver size determines chunking and round-trip count. A driver of 50,000 rows is technically allowed but slow:
- SAP splits the IN list into chunks (kernel param, often around 5–10 per chunk on older releases; HANA does better).
- Each chunk is one round trip.
- 50,000 rows ÷ 10 per chunk = 5,000 round trips.

If the driver may be that large, either:
- Pre-filter the driver to the rows you actually need;
- Use a JOIN instead of FAE;
- Use `PACKAGE SIZE` to process in batches and emit results progressively.

Alternatively, use `PACKAGE SIZE n` in the outer SELECT to process the driver itself in chunks rather than loading it all into memory first. Each `ENDSELECT` iteration gives you a manageable driver slice to pass into one FAE call:

```abap
SELECT id FROM ztransaction_header
  WHERE status = 'OPEN'
  INTO TABLE @DATA(lt_driver_chunk) PACKAGE SIZE 500.

  IF lt_driver_chunk IS INITIAL. CONTINUE. ENDIF.
  SORT lt_driver_chunk BY id.
  DELETE ADJACENT DUPLICATES FROM lt_driver_chunk COMPARING id.

  SELECT header_id, line_no, amount
    FROM ztransaction_item
    FOR ALL ENTRIES IN @lt_driver_chunk
    WHERE header_id = @lt_driver_chunk-id
    INTO TABLE @DATA(lt_items).

  " process items ...

ENDSELECT.
```

## 6. Buffer awareness

If `child_table` is **buffered** (SE11 → Technical Settings → Buffering = Single record / Generic / Full):
- Buffer bypass is decided by the buffering type, not driver size: FAE bypasses single-record buffering and generic buffering whose generic key is not fully specified. The ~1024 blocking factor only splits the driver into multiple DB round trips.
- For small drivers FAE uses the buffer.
- For buffered tables, when driver is small, consider individual `SELECT SINGLE` in a loop (each hits the buffer) instead of FAE — counterintuitive but sometimes faster.

## 7. Result sorting (if order matters)

```abap
SORT lt_children BY parent_id child_id.
```

FAE does **not** preserve order — even within a single driver. The DB optimizer is free to return rows in any order. If your consumer iterates assuming order, the bug is intermittent and platform-dependent.

If you sort, use the secondary sort key columns explicitly. Don't trust "it usually comes back in insert order".

## 8. NULL handling

In Open SQL, NULL columns vs `IS INITIAL` ABAP semantics differ:
- ABAP fills NULL with the type's initial value on read (`SPACE`, `'0'`, etc.).
- A WHERE comparison with `@lt_parents-id IS NULL` is not the same as `column IS NULL`.

For FAE this matters when the driver has rows where `id` itself is the initial value. Those rows still pass to the FAE WHERE — which then matches DB rows with the initial value. Decide whether that's what you want, and filter if not.

## 9. ABAP Cloud variant

In ABAP Cloud / Steampunk:
- Only released DDIC objects can appear in `FROM`.
- The `WHERE` and `IN` parts work the same.
- No `BYPASSING BUFFER` (not allowed).

## 10. Code review one-liner

For every FAE in the diff, ask out loud:
> "What happens if `<driver>` is empty? What if it has duplicates? What if it has 100K rows? Did the SELECT field list include the driver key? Is the result sorted?"

If you can't answer all five, the finding is real.

## Anti-pattern → Fix table

| Anti-pattern | Fix |
|---|---|
| `… FOR ALL ENTRIES IN @lt_parents WHERE id = @lt_parents-id.` with no empty-check | Add `IF lt_parents IS INITIAL. RETURN. ENDIF.` |
| Same FAE, driver computed without `DISTINCT` | `SORT … BY id. DELETE ADJACENT DUPLICATES …` before |
| FAE on `t001` (fully buffered) with 5000 parents | Fully buffered tables are served from the buffer regardless of driver size — just deduplicate the driver table first |
| FAE result iterated assuming insertion order | `SORT result BY parent_id child_id` after |
| FAE SELECT list omits `parent_id` | Add it back; you cannot reconstruct the mapping otherwise |
| FAE inside a LOOP | Restructure — collect *all* parents first, then *one* FAE |
