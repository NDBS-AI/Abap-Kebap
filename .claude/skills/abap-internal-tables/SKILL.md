---
name: abap-internal-tables
description: Use when declaring or working with internal tables — choosing between STANDARD, SORTED, and HASHED table kinds; defining primary or secondary keys; reading lines with READ TABLE, table expressions itab[ ], or LOOP AT (with WHERE / FROM TO / USING KEY); modifying with MODIFY, INSERT, APPEND, DELETE, or COLLECT; deduplicating with SORT and DELETE ADJACENT DUPLICATES; grouping with LOOP AT ... GROUP BY; or fixing a slow linear key search. Covers ABAP Cloud as well as classic.
---

# ABAP Internal Tables

## Overview

Internal tables hold a variable number of same-typed lines in working memory — ABAP's in-memory collection type. The single most consequential decision is the **table kind and key you pick at declaration time**, because it fixes how every later read, write, and loop performs.

**Core principle:** declare for the access pattern. A keyed lookup on a STANDARD table is a linear scan; the same lookup on a SORTED or HASHED table (or via a secondary key) is logarithmic or constant. You cannot fix a wrong table kind with clever statements later.

## When to Use

- Declaring any `TYPE TABLE OF` / `TYPE STANDARD|SORTED|HASHED TABLE OF`.
- Reading single lines (`READ TABLE`, table expression `itab[ ... ]`).
- Iterating with `LOOP AT` and restricting with `WHERE` / `FROM ... TO` / `USING KEY` / `STEP`.
- Adding rows (`APPEND`, `INSERT`, constructor expressions) or changing them (`MODIFY`).
- Removing rows (`DELETE`, `DELETE [ADJACENT] DUPLICATES`, `CLEAR`, `FREE`).
- Aggregating into one line per key with `COLLECT`.
- Grouping lines with `LOOP AT ... GROUP BY` (→ [references/grouping.md](references/grouping.md)).
- Diagnosing a slow keyed read on a large STANDARD table — the secondary-key fix.

**When NOT to use:**
- Building a table from a SELECT — that is SQL; see [abap-sql-performance](../abap-sql-performance/SKILL.md) (`SELECT ... INTO TABLE`, FAE).
- Constructing tables with `VALUE`/`FOR`/`REDUCE`/`CORRESPONDING`/`FILTER` — see [abap-constructor-expressions](../abap-constructor-expressions/SKILL.md). This skill shows the entry points; that skill is the deep dive.
- General naming/readability rules → [abap-clean-style](../abap-clean-style/SKILL.md).
- The full statement catalog (every READ/LOOP/INSERT/MODIFY/DELETE variant) → [references/operations.md](references/operations.md).

## Quick Reference

| Want | Use | Note |
|---|---|---|
| Append/iterate, no keyed lookup | `STANDARD TABLE ... WITH EMPTY KEY` | the default workhorse; index access is fastest |
| Ordered + keyed lookup (binary search) | `SORTED TABLE ... WITH [NON-]UNIQUE KEY` | auto-sorted on insert; log(n) key access |
| Pure keyed lookup, unique, large | `HASHED TABLE ... WITH UNIQUE KEY` | constant-time key access; no primary index |
| Keyed lookup on an existing STANDARD table | add `WITH ... SORTED KEY sk COMPONENTS ...` | secondary key — optimized access without changing the kind |
| Read one line by key | `lt_itab[ key = v ]` or `READ TABLE ... WITH [TABLE] KEY ...` | table expression raises `CX_SY_ITAB_LINE_NOT_FOUND` |
| Read one line by index | `lt_itab[ i ]` or `READ TABLE ... INDEX i` | index tables only |
| Test existence | `line_exists( lt_itab[ ... ] )` or `READ ... TRANSPORTING NO FIELDS` | |
| Count lines | `lines( lt_itab )` | |
| One line per key, summing numerics | `COLLECT ls_wa INTO lt_itab` | use with a unique key (ideally HASHED) |
| Remove duplicates | `SORT` then `DELETE ADJACENT DUPLICATES ... COMPARING ...` | portable default; `DELETE DUPLICATES` (no sort needed) is a newer statement — verify it's supported in the target release/ADT first |

## The three table kinds

```abap
" Default workhorse — append/iterate; no keyed-lookup need
DATA lt_log_lines TYPE STANDARD TABLE OF zlog WITH EMPTY KEY.

" Ordered iteration AND optimized keyed lookup (binary search)
DATA lt_invoices TYPE SORTED TABLE OF zinvoice
  WITH NON-UNIQUE KEY customer_id sortkey.

" Pure keyed lookup, must be unique — constant-time access
DATA lt_orders TYPE HASHED TABLE OF zorder WITH UNIQUE KEY id.
```

| Kind | Managed by | Primary key | Access | When |
|---|---|---|---|---|
| `STANDARD` | primary table index | always non-unique (or empty) | index (fast); key = **linear** scan | sequential / index processing; appending logs |
| `SORTED` | primary table index | unique or non-unique | index; key = binary search (log n) | mainly keyed access, no unique key possible; need order |
| `HASHED` | hash algorithm | always unique | key only (constant); no primary index | large tables, mainly unique-key access |

- `... TYPE TABLE OF ...` with no kind = `STANDARD`.
- A keyed read on a large STANDARD table (more than ~100 lines) is the classic slow path — the search is linear. Declare SORTED/HASHED, or add a secondary key (see below).
- HASHED has no primary index: no `INDEX i`, no `SORT`, no `READ ... INDEX`. Index access to a HASHED table is only possible via a *sorted secondary* key.

## Keys: primary, standard, empty, secondary

**Primary key** — every internal table has one.
- Sorted tables: primary key is sorted and **read-only** (modifying a key field dumps at runtime).
- Hashed tables: primary key is hashed and read-only; must be `UNIQUE`.
- Standard tables: primary key is always non-unique; key fields are *not* read-only.
- Addressable by the predefined name `primary_key`; specifying it is usually optional.

**Standard key** — the implicit key when you specify none: *all* character-like and byte-like components (or `table_line` for an elementary line type). This is a trap:
- `SORT lt_itab` without `BY` then sorts by every character field — rarely what you want.
- Key fields become read-only on sorted/hashed tables, so accidental standard keys cause surprise dumps.
- **Always declare the key explicitly** (even `WITH EMPTY KEY`) to make intent clear and avoid the standard key by accident.

**Empty key** — `WITH EMPTY KEY`, standard tables only. States "no key needed" cleanly instead of inheriting the standard key. Inline `SELECT ... INTO TABLE @DATA(lt_itab)` produces a standard table with empty key.

```abap
DATA lt_it1 TYPE TABLE OF zdemo_abap_flsch.                         " standard key — avoid
DATA lt_it2 TYPE TABLE OF zdemo_abap_flsch WITH EMPTY KEY.          " explicit, clear
DATA lt_it3 TYPE TABLE OF zdemo_abap_flsch WITH NON-UNIQUE KEY carrid.
DATA lt_it4 TYPE SORTED TABLE OF zdemo_abap_flsch WITH UNIQUE KEY carrid connid.
DATA lt_it5 TYPE HASHED TABLE OF zdemo_abap_flsch WITH UNIQUE KEY carrid.
```

**Secondary keys** — the performance escape hatch. Optional for *any* kind (up to 15), with self-defined names; unique/non-unique sorted, or unique hashed.

```abap
" Standard table you append to, but also need fast lookup by customer
DATA lt_items TYPE STANDARD TABLE OF zitem
  WITH EMPTY KEY
  WITH NON-UNIQUE SORTED KEY by_customer COMPONENTS customer_id.
```

- Access via a secondary key is **always optimized** — this is how you make keyed reads on a STANDARD table fast without changing its kind.
- A *sorted* secondary key adds a secondary index, which is the only way to do index access on a HASHED table (and sets `sy-tabix`).
- Secondary keys are **never used automatically** — you must name them (`USING KEY sk`, `WITH TABLE KEY sk COMPONENTS ...`, or `lt_itab[ KEY sk ... ]`). Without a name, the primary key/index is used.
- Cost: extra memory and key maintenance. Unique secondary keys update immediately; non-unique ones update lazily on first keyed access. Best for large tables populated once and read often — not tiny or churn-heavy tables.

> Source: [abap-cheat-sheets/01_Internal_Tables.md — Table Keys](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/01_Internal_Tables.md)

## Reading single lines

Three ways to address a line — **by index** (index tables only), **by table key**, **by free key** — and three target areas.

```abap
" By index
DATA(ls_line1) = lt_itab[ 5 ].                          " table expression; dumps if not found
READ TABLE lt_itab INTO ls_wa INDEX 5.                  " sets sy-subrc / sy-tabix

" By table key (all key components required)
DATA(ls_line2) = lt_itab[ KEY primary_key COMPONENTS carrid = 'LH' connid = '0400' ].
READ TABLE lt_itab INTO ls_wa WITH TABLE KEY sec_key COMPONENTS city = 'BERLIN'.

" By free key (any components)
DATA(ls_line3) = lt_itab[ carrid = 'LH' ].
READ TABLE lt_itab INTO ls_wa WITH KEY carrid = 'LH'.
```

**Target area — pick deliberately:**

| Target | Syntax | Semantics |
|---|---|---|
| Work area | `INTO ls_wa` / `INTO DATA(ls_wa)` | a **copy**; changing it does not change the table. Supports `TRANSPORTING`. |
| Field symbol | `ASSIGNING <fs_line>` / `ASSIGNING FIELD-SYMBOL(<fs_line>)` | a **reference** — changing `<fs_line>` edits the line in place. No copy. |
| Data reference | `REFERENCE INTO lr_dref` / `REFERENCE INTO DATA(lr_dref)` | a **reference** — edit via `lr_dref->comp`. No copy. |

- Prefer `ASSIGNING`/`REFERENCE INTO` for wide or nested line types — avoids copying the whole row, and lets you modify the line directly.
- Use `INTO ls_wa` when you specifically want an isolated copy you can mutate without touching the table.
- Table expressions do **not** set `sy-subrc`/`sy-tabix`; they raise `CX_SY_ITAB_LINE_NOT_FOUND` instead. Exception: `ASSIGN lt_itab[ ... ] TO <fs_line>` sets both system fields and does not raise — a miss leaves `<fs_line>` unassigned with `sy-subrc` <> 0. Use `VALUE #( lt_itab[ ... ] OPTIONAL )` (initial line on miss) or `... DEFAULT ...` to avoid the exception.

```abap
DATA(ls_maybe) = VALUE #( lt_itab[ carrid = 'ZZ' ] OPTIONAL ).   " initial line, no dump
IF line_exists( lt_itab[ carrid = 'LH' ] ). ... ENDIF.
DATA(lv_idx) = line_index( lt_itab[ carrid = 'LH' ] ).           " 0 if not found
```

**`WITH KEY` beats `WHERE` for a single read.** `READ TABLE ... WHERE ...` is unoptimized on a plain standard table and triggers a syntax warning; rewrite as `WITH KEY` when you can (suppress with `##read_where_ok` only if `WHERE` is genuinely needed). The old `READ TABLE ... BINARY SEARCH` works but is discouraged — declare a SORTED table or a sorted secondary key instead; both give optimized access without manual pre-sorting.

## Looping

```abap
LOOP AT lt_itab ASSIGNING FIELD-SYMBOL(<fs_line>).        " reference — modify in place
  <fs_line>-amount = <fs_line>-amount + 1.
ENDLOOP.

LOOP AT lt_itab INTO DATA(ls_wa) WHERE status = 'O'.    " restrict by condition
  ...
ENDLOOP.

LOOP AT lt_itab INTO ls_wa FROM 2 TO 5.                 " index range (index tables)
LOOP AT lt_itab INTO ls_wa USING KEY sec_key.           " iterate in secondary-key order
LOOP AT lt_itab INTO ls_wa STEP -1.                      " reverse; STEP n = every nth line
LOOP AT lt_itab TRANSPORTING NO FIELDS WHERE a < 5.  " only set system fields
```

- Iteration order: index tables ascending by index; hashed-table order is **unspecified** — do not rely on it (`sy-tabix` is `0`). Need a stable order over a hashed table? Add a sorted secondary key and `LOOP ... USING KEY`, or use a SORTED table instead. `USING KEY sk` iterates in that key's order.
- `sy-tabix` is the current line number — capture it into a variable on the line right after `LOOP AT` if you need it later; later statements can overwrite it.
- Modifying inside a loop: changing the current line's components is fine (use `ASSIGNING`/`REFERENCE INTO`). You may `INSERT`/`DELETE` lines, but you **cannot** `CLEAR`/replace the whole table body in a loop (syntax error if detected). Watch for non-terminating loops when inserting after the current line. See [references/operations.md](references/operations.md) for the index-shift rules.

## Modifying, inserting, deleting

```abap
APPEND VALUE #( a = 1 b = 2 ) TO lt_itab.            " standard tables; not for hashed
INSERT VALUE #( a = 1 b = 2 ) INTO TABLE lt_itab.    " all kinds; correct position for sorted/hashed
INSERT ls_line INTO lt_itab INDEX 3.                     " index tables: before line 3

MODIFY TABLE lt_itab FROM ls_line.                       " key-based: line carries the key
MODIFY lt_itab FROM ls_line INDEX 1 TRANSPORTING b c.    " index-based, only fields b and c

DELETE lt_itab INDEX 1.                               " by index
DELETE TABLE lt_itab WITH TABLE KEY a = 1.            " by key
DELETE lt_itab WHERE a < 6.                            " by condition
```

- Prefer `INSERT ... INTO TABLE` over `APPEND` in new code: it works for every kind and key, so a later change of table kind won't break it. `APPEND` is fine and idiomatic for standard tables where you genuinely append.
- `APPEND` sets `sy-tabix`; `INSERT` does not. `APPEND` cannot be used on hashed tables.
- `MODIFY TABLE` = key access; `MODIFY ... INDEX` = index access. Use `TRANSPORTING` to change only specific fields — **required** when you must avoid touching read-only key fields of sorted/hashed primary keys (a write attempt dumps at runtime).
- `MODIFY TABLE lt_std_tab FROM ls_line` on a standard table with **empty key** silently modifies the *first line* — avoid; it triggers a warning for good reason.
- `CLEAR lt_itab` empties but keeps allocated memory (faster to refill); `FREE lt_itab` also releases the memory. `lt_itab = VALUE #( ).` also clears.

`COLLECT` — sum numeric components into one line per key:

```abap
" One line per (carrid, connid); seatsocc summed across source rows
DATA lt_seats_tab TYPE HASHED TABLE OF seats WITH UNIQUE KEY carrid connid.
SELECT carrid, connid, seatsocc FROM zdemo_abap_fli INTO @DATA(ls_seats).
  COLLECT ls_seats INTO lt_seats_tab.
ENDSELECT.
```

Use `COLLECT` with a unique primary key (ideally HASHED). Equivalent to a `LOOP AT ... GROUP BY` that sums members — but more compact.

## Sorting and deduplication

```abap
SORT lt_itab BY customer_id ASCENDING amount DESCENDING.   " always specify BY
SORT lt_itab STABLE BY city.                                " preserve order of equal keys
DELETE ADJACENT DUPLICATES FROM lt_itab COMPARING customer_id.
```

- SORTED tables cannot be `SORT`ed (they are already ordered); only STANDARD/HASHED can.
- **Always use `SORT ... BY`** with explicit fields. Bare `SORT lt_itab` uses the (often unintended) standard key; on a numeric-only or empty-key line it does nothing.
- `SORT` is **unstable** by default — equal-key lines may reorder between runs. Add `STABLE` when relative order matters.
- `DELETE ADJACENT DUPLICATES` only removes *adjacent* equal lines → `SORT` first by the same `COMPARING` fields. `DELETE DUPLICATES` (no `ADJACENT`) does not need a prior sort but uses the table key by default — it is a newer statement than `DELETE ADJACENT DUPLICATES`, so verify `DELETE ... COMPARING ...` / the target release's supported syntax in ADT before relying on it. The portable form across releases is `SORT itab BY key. DELETE ADJACENT DUPLICATES FROM itab COMPARING key.` — keep that as the default. `COMPARING ALL FIELDS` / `COMPARING table_line` compares the whole line.

This is also the FAE-driver hygiene pattern — see the FOR ALL ENTRIES checklist in [abap-sql-performance](../abap-sql-performance/SKILL.md).

## Grouping

`LOOP AT ... GROUP BY` replaces the old `AT NEW` group-level processing. It groups lines by a key, loops over groups, and (optionally) over each group's members with `LOOP AT GROUP`.

```abap
LOOP AT lt_flights INTO DATA(ls_wa)
     GROUP BY ( carrier = ls_wa-carrid size = GROUP SIZE index = GROUP INDEX )
     ASCENDING INTO DATA(ls_grp).
  " ls_grp-carrier, ls_grp-size, ls_grp-index available here
  LOOP AT GROUP ls_grp INTO DATA(ls_member).
    " each row of this group
  ENDLOOP.
ENDLOOP.
```

Full treatment — representative vs group-key binding, `GROUP SIZE`/`GROUP INDEX`, `WITHOUT MEMBERS`, multi-column keys, the `FOR ... IN GROUP` form — is in [references/grouping.md](references/grouping.md).

## Performance implications (cross-link)

The table-kind/key decision *is* the performance decision. For the database side of the same story — `SELECT ... INTO TABLE`, FOR ALL ENTRIES, buffering, aggregation — see [abap-sql-performance](../abap-sql-performance/SKILL.md). Rules of thumb here:

- Keyed read on a large STANDARD table without a secondary key → O(n) linear scan. Fix with SORTED/HASHED or a secondary key.
- Re-`SORT`ing a STANDARD table before every `BINARY SEARCH` is waste — declare it SORTED or add a sorted secondary key once.
- HASHED for unique-key lookups at scale (constant time); SORTED when you also need order or a non-unique key.
- Don't add secondary keys to small or frequently-mutated tables — maintenance cost outweighs benefit.

## Common Mistakes

| Mistake | Cost | Fix |
|---|---|---|
| Keyed read on a large STANDARD table | O(n) linear scan per read | SORTED/HASHED, or add a sorted secondary key |
| Omitting the key → implicit standard key | surprise sorts; surprise read-only fields | always declare the key (even `WITH EMPTY KEY`) |
| `SORT lt_itab` without `BY` | sorts by all char fields, or does nothing | `SORT lt_itab BY <fields>` explicitly |
| `DELETE ADJACENT DUPLICATES` without sorting first | only adjacent dups removed → leftovers | `SORT ... BY` the same `COMPARING` fields first |
| Table expression `lt_itab[ ... ]` on a possible miss | uncaught `CX_SY_ITAB_LINE_NOT_FOUND` | `VALUE #( lt_itab[ ... ] OPTIONAL )` or `TRY`/`line_exists` |
| `INTO ls_wa` then expecting the table to change | ls_wa is a copy — table untouched | `ASSIGNING`/`REFERENCE INTO`, or `MODIFY ... FROM ls_wa` |
| Writing a sorted/hashed primary key field via `MODIFY` | runtime dump | `TRANSPORTING` the non-key fields only |
| `APPEND` to a sorted/hashed table | runtime error (hashed) / order-dependent (sorted) | use `INSERT ... INTO TABLE` |
| `MODIFY TABLE` on empty-key standard table | silently changes the *first* line | use `INDEX`, or define a real key |
| Using a secondary key without naming it | primary key used → no speedup | `USING KEY` / `WITH TABLE KEY sk` / `lt_itab[ KEY sk ... ]` |
| Relying on `sy-tabix` set several statements after `LOOP AT` | overwritten by intervening statements | capture it immediately into a variable |
| `READ TABLE ... WHERE` on a plain standard table | unoptimized + syntax warning | rewrite as `WITH KEY`; or add a key |

## References

- [references/operations.md](references/operations.md) — full statement catalog (every READ / LOOP / INSERT / APPEND / MODIFY / DELETE variant with syntax)
- [references/grouping.md](references/grouping.md) — `LOOP AT ... GROUP BY`: group keys, member loops, `GROUP SIZE`/`GROUP INDEX`, `WITHOUT MEMBERS`
- **ABAP Keyword Documentation — Internal Tables:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abenitab_oview.htm
- **SAP-samples/abap-cheat-sheets — 01_Internal_Tables.md:** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/01_Internal_Tables.md
- **SAP-samples/abap-cheat-sheets — 11_Internal_Tables_Grouping.md:** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/11_Internal_Tables_Grouping.md
- Linked skills: [abap-constructor-expressions](../abap-constructor-expressions/SKILL.md) (VALUE/FOR/REDUCE/CORRESPONDING/FILTER), [abap-sql-performance](../abap-sql-performance/SKILL.md) (SELECT INTO TABLE, FAE, buffering), [abap-clean-style](../abap-clean-style/SKILL.md)
</content>
</invoke>
