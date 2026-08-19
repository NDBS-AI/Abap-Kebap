# Internal Tables — Full Statement Catalog

Every variant of the line-level statements, too detailed for SKILL.md. Syntax is copied/adapted from [01_Internal_Tables.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/01_Internal_Tables.md). Demo tables assume a structured line type with components `a b c d ...` or `comp1 comp2 ...`.

---

## Declaring tables and keys

```abap
TYPES itab_type1 TYPE STANDARD TABLE OF data_type ...   " standard table type
TYPES itab_type2 LIKE SORTED   TABLE OF data_object ... " sorted table type

DATA itab1 TYPE          TABLE OF data_type ...   " STANDARD by default
DATA itab2 TYPE HASHED   TABLE OF data_type ...   " hashed
DATA itab3 TYPE itab_type1 ...                    " from an existing table type
DATA itab4 LIKE itab1 ...                          " from an existing table
```

Key specifications:

```abap
" Standard key (all char/byte fields) — implicit and explicit forms; equivalent
DATA it1 TYPE TABLE OF zdemo_abap_flsch.
DATA it2 TYPE STANDARD TABLE OF zdemo_abap_flsch WITH DEFAULT KEY.
DATA it3 TYPE HASHED   TABLE OF zdemo_abap_flsch WITH UNIQUE DEFAULT KEY.
DATA it4 TYPE SORTED   TABLE OF zdemo_abap_flsch WITH NON-UNIQUE DEFAULT KEY.

" Primary key — NON-UNIQUE is the only option for standard; it can be omitted
DATA it5 TYPE TABLE OF zdemo_abap_flsch WITH NON-UNIQUE KEY carrid.
DATA it6 TYPE TABLE OF zdemo_abap_flsch WITH KEY carrid.                       " same as it5
DATA it7 TYPE SORTED TABLE OF zdemo_abap_flsch WITH UNIQUE KEY carrid connid.
DATA it8 TYPE SORTED TABLE OF zdemo_abap_flsch WITH NON-UNIQUE KEY carrid connid cityfrom.
DATA it9 TYPE HASHED TABLE OF zdemo_abap_flsch WITH UNIQUE KEY carrid.         " hashed must be UNIQUE

" Predefined name primary_key, alias, table_line (whole line as key)
DATA it10 TYPE TABLE OF zdemo_abap_flsch WITH KEY primary_key COMPONENTS carrid.
DATA it12 TYPE SORTED TABLE OF zdemo_abap_flsch
  WITH NON-UNIQUE KEY primary_key ALIAS p1 COMPONENTS carrid connid cityfrom.
DATA it13 TYPE HASHED TABLE OF zdemo_abap_flsch
  WITH UNIQUE KEY primary_key ALIAS p2 COMPONENTS table_line.

" Empty key (standard only)
DATA it14 TYPE TABLE OF zdemo_abap_flsch WITH EMPTY KEY.

" Secondary keys — any kind, up to 15, named, sorted/hashed, optional alias
DATA it17 TYPE TABLE OF zdemo_abap_flsch
  WITH NON-UNIQUE KEY carrid connid
  WITH UNIQUE SORTED KEY cities COMPONENTS cityfrom cityto.
DATA it20 TYPE TABLE OF zdemo_abap_flsch
  WITH NON-UNIQUE KEY primary_key COMPONENTS carrid connid
  WITH NON-UNIQUE SORTED KEY cities COMPONENTS cityfrom cityto
  WITH UNIQUE HASHED KEY airports COMPONENTS airpfrom airpto.
```

- Elementary line type: the key can only be `table_line` (the whole line).
- `WITH DEFAULT KEY` = standard key explicitly; avoid relying on it implicitly.
- Inline `SELECT ... INTO TABLE @DATA(itab)` → standard table, empty key.

---

## APPEND — add at the bottom

```abap
APPEND VALUE #( comp1 = a comp2 = b ) TO itab.
APPEND struc TO itab.
APPEND INITIAL LINE TO itab.

" Capture the added line by reference (inline targets allowed)
APPEND VALUE #( ... ) TO itab ASSIGNING FIELD-SYMBOL(<fs>).
APPEND INITIAL LINE TO itab REFERENCE INTO DATA(dref).

" Add all / a range of lines from another table
APPEND LINES OF itab2 TO itab.
APPEND LINES OF itab2 FROM 3 TO 5 TO itab.      " FROM or TO alone also allowed
APPEND LINES OF itab2 FROM 3 TO itab.
APPEND LINES OF itab2 TO 7 TO itab.
```

- Sets `sy-tabix` to the index of the appended line (primary table index).
- **Cannot** be used on hashed tables. For sorted tables, only appends if it matches the sort order — prefer `INSERT`.

## INSERT — add at a position or by key order

```abap
INSERT VALUE #( comp1 = a ) INTO TABLE itab.    " standard: appended; sorted/hashed: correct position
INSERT struc INTO TABLE itab.
INSERT INITIAL LINE INTO TABLE itab.
INSERT INITIAL LINE INTO TABLE itab REFERENCE INTO DATA(dref).

" Index tables: insert before line n
INSERT struc INTO itab INDEX 3.
INSERT LINES OF itab2 INTO itab INDEX 5.

" From another table (key order)
INSERT LINES OF itab2 INTO TABLE itab.
INSERT LINES OF itab2 FROM 5 TO 9 INTO TABLE itab.
```

- `INSERT ... INTO TABLE itab` covers every kind/key → prefer it in new code.
- Does **not** set `sy-tabix` (unlike `APPEND`).
- Unique primary/secondary key + duplicate → insertion fails, `sy-subrc = 4`.

---

## READ TABLE — read one line

Target areas:

```abap
READ TABLE itab INTO wa ...                       " copy; supports TRANSPORTING
READ TABLE itab INTO DATA(wa_inl) ...
READ TABLE itab ASSIGNING <fs> ...                " reference (no copy)
READ TABLE itab ASSIGNING FIELD-SYMBOL(<fs>) ...
READ TABLE itab REFERENCE INTO dref ...           " reference (dereference to use)
READ TABLE itab REFERENCE INTO DATA(dref_inl) ...
```

By index:

```abap
READ TABLE itab INTO wa INDEX i.
READ TABLE itab INTO wa INDEX i USING KEY primary_key.   " explicit primary index
READ TABLE itab INTO wa INDEX i USING KEY sec_key.       " secondary table index
```

By table key (all key components required):

```abap
READ TABLE it INTO wa WITH TABLE KEY primary_key COMPONENTS a = 1 b = 2.
READ TABLE it INTO wa WITH TABLE KEY pk COMPONENTS a = 1 b = 2.       " alias
READ TABLE it INTO wa WITH TABLE KEY sec_key COMPONENTS c = 3 d = 4.
READ TABLE it FROM pr_keys INTO wa.                                   " keys from a work area
READ TABLE it FROM sec_keys USING KEY sec_key INTO wa.
```

By free key (any components):

```abap
READ TABLE it INTO wa WITH KEY b = 2.
```

Additions:

```abap
" Existence / index only — no target area
READ TABLE it WITH KEY b = 2 TRANSPORTING NO FIELDS.   " sets sy-subrc, sy-tabix

" Restrict copied fields (INTO target only; not with ASSIGNING/REFERENCE)
READ TABLE it INTO wa INDEX 1 TRANSPORTING comp2.
READ TABLE it INTO wa INDEX 1 TRANSPORTING ALL FIELDS.

" Compare fields after read: sy-subrc 0 = equal, 2 = differ (line still assigned)
READ TABLE it INTO wa INDEX 1 COMPARING comp1.
READ TABLE it INTO wa INDEX 1 COMPARING comp3 TRANSPORTING comp2 comp3.

" Field-symbol target extras
READ TABLE it ASSIGNING <fs> CASTING INDEX 2.          " <fs> typed c/n/p/x or fully typed
READ TABLE it ASSIGNING <fs> ELSE UNASSIGN INDEX i.    " unassign on miss

" WHERE — first matching line; slower, syntax warning on plain standard tables
READ TABLE it INTO wa WHERE comp1 > 3.
READ TABLE it INTO wa WHERE comp4 IS INITIAL ##read_where_ok.   " pragma suppresses warning
READ TABLE it USING KEY sk INTO wa WHERE comp3 > 40.
READ TABLE it INTO wa WHERE (dyn_where_string).                 " dynamic WHERE
```

System fields after READ:

| Case | `sy-subrc` | `sy-tabix` |
|---|---|---|
| Found (index/standard/sorted/sorted-sec-key) | 0 | line number |
| Found via hash key (primary or secondary) | 0 | 0 (no index) |
| Not found, standard/hashed | 4 | 0 |
| Not found, sorted/sorted-sec-key (binary search) | 8 | n+1 |

- `READ TABLE ... BINARY SEARCH` (optimized linear → binary on a pre-sorted standard table) still exists but is **discouraged** — declare a SORTED table or a sorted secondary key instead. Not available for table expressions.

---

## Table expressions — itab[ ... ]

Concise `READ TABLE` in operand position. Do **not** set `sy-subrc`/`sy-tabix`; raise `CX_SY_ITAB_LINE_NOT_FOUND` on a miss. Exception: with `ASSIGN itab[ ... ] TO <fs>` both system fields are set and no exception is raised — a miss sets `sy-subrc` 4 (or 8 when a binary search in a sorted table reaches the table end, with `sy-tabix` = lines + 1).

```abap
" By index (index tables; KEY ... INDEX picks which index)
line = itab[ 2 ].
line = itab[ KEY primary_key INDEX 2 ].
line = itab[ KEY sk INDEX 1 ].                  " secondary index (works for hashed)

" By table key (all components required)
line = itab[ TABLE KEY primary_key COMPONENTS comp1 = 1 ].
line = itab[ TABLE KEY sk comp2 = 20 comp3 = 21 ].     " COMPONENTS optional

" By KEY (partial sorted-key prefix allowed; non-key comps allowed too)
line = itab[ KEY sk comp2 = 20 ].
line = itab[ KEY primary_key comp1 = 1 comp4 = 'aaa' ].

" Free key (optimized for sorted/hashed when key comps given)
line = itab[ comp1 = 1 ].

" Chaining a component / nested access
DATA(comp_c) = itab[ b = 2 ]-c.

" Avoiding the exception
DATA(l1) = VALUE #( itab[ 6 ] OPTIONAL ).               " initial line on miss
DATA(l2) = VALUE #( itab[ 7 ] DEFAULT itab[ 1 ] ).      " default on miss
DATA(line_ref) = REF #( itab[ 5 ] ).                     " reference

" Write access
itab[ 1 ] = line.
itab[ 1 ]-comp1 = 'X'.
```

- Binary search cannot be forced (it is automatic for sorted/hashed when applicable).
- Key names can be dynamic: `itab[ KEY (key_name) ... ]`.

---

## LOOP AT — iterate

```abap
LOOP AT it INTO wa. ... ENDLOOP.
LOOP AT it INTO DATA(wa_inl). ... ENDLOOP.
LOOP AT it ASSIGNING FIELD-SYMBOL(<fs>). ... ENDLOOP.      " modify in place
LOOP AT it REFERENCE INTO DATA(dref). ... ENDLOOP.

" Key order
LOOP AT it INTO wa USING KEY primary_key.
LOOP AT it INTO wa USING KEY sk.                            " secondary-key order

" Restrict the area looped over
LOOP AT it INTO wa FROM 2 TO 5.                             " index range (index tables)
LOOP AT it INTO wa FROM 2.                                  " from index 2 to end
LOOP AT it INTO wa TO 5.                                    " from start to index 5
LOOP AT it INTO wa WHERE a > 1 AND b < 4.                   " logical condition
LOOP AT it TRANSPORTING NO FIELDS WHERE a < 5.             " system fields only (WHERE mandatory)

" Step size / direction (STEP n: every nth; negative = reverse)
LOOP AT it INTO wa STEP -1.
LOOP AT it INTO wa STEP 2.
LOOP AT it INTO wa FROM 6 TO 3 STEP -2.                     " reverse range
```

- Order: index tables ascending by index; hashed-table order is **unspecified** — never rely on it (`sy-tabix = 0`). `USING KEY` overrides with a defined, chosen order.
- `CONTINUE` (next pass), `CHECK cond` (skip rest of pass if false), `EXIT` (leave loop).

### Insert / delete lines during a loop

| Action | Effect |
|---|---|
| Insert **after** current line | new line processed in next pass (risk of infinite loop) |
| Delete **after** current line | that line is skipped |
| Insert **before** current line | `sy-tabix` increases accordingly |
| Delete **before** current line | `sy-tabix` decreases accordingly |
| Delete **current** line (`DELETE itab INDEX sy-tabix`) | next line moves up; `sy-tabix` unchanged |

- You **cannot** `CLEAR itab` / `itab = VALUE #( )` (replace whole body) inside its own loop — syntax error if detected statically.
- Short form `DELETE itab.` (no addition) deletes the current line — only inside a LOOP on the same table.
- With `LOOP ... USING KEY`, delete the current line via `DELETE itab USING KEY loop_key.` (`loop_key` is the only name allowed there).

---

## MODIFY — change existing lines

```abap
" By key — 'line' carries the key values
MODIFY TABLE it FROM line.
MODIFY TABLE it FROM VALUE #( a = 1 b = 2 ).

" By index — note: MODIFY, not MODIFY TABLE
MODIFY it FROM line INDEX 1.

" Restrict changed fields (required to skip read-only key fields of sorted/hashed)
MODIFY TABLE it FROM line TRANSPORTING b c.
MODIFY it FROM line INDEX 1 TRANSPORTING b c.

" USING KEY (primary/secondary). Index after a secondary key = secondary index.
MODIFY it FROM line USING KEY primary_key INDEX 1.
MODIFY it FROM line USING KEY sec_key INDEX 1 TRANSPORTING c d.

" Capture the modified line
MODIFY it INDEX 1 FROM line ASSIGNING FIELD-SYMBOL(<fs>).
MODIFY it INDEX 2 FROM line REFERENCE INTO DATA(dref).

" Multiple lines — TRANSPORTING and WHERE both mandatory; USING KEY optional
MODIFY it FROM line TRANSPORTING b c WHERE a < 5.
```

- `sy-subrc` = 0 if ≥1 line changed, 4 if none.
- `MODIFY TABLE` = key access; `MODIFY ... INDEX` = index access (not for hashed).
- Primary key fields of sorted/hashed tables are read-only → writing them dumps at runtime (only checked at runtime). Exclude them with `TRANSPORTING`.
- Secondary-key fields are read-only only while that key is in use (LOOP/MODIFY with `USING KEY`).
- `MODIFY TABLE std_tab FROM line` on an empty-key standard table modifies the **first** line — avoid.
- Modify-via-READ alternatives: read with `ASSIGNING`/`REFERENCE INTO` and edit the reference directly; or read `INTO wa`, edit `wa`, then `MODIFY TABLE it FROM wa`.

---

## DELETE — remove lines

```abap
" By index
DELETE it INDEX 1.
DELETE it INDEX 1 USING KEY primary_key.
DELETE it FROM 2 TO 5.                            " index range (FROM or TO alone allowed)

" By key
DELETE TABLE it FROM line.                         " first line matching line's key
DELETE TABLE it WITH TABLE KEY a = 1.
DELETE TABLE it WITH TABLE KEY primary_key COMPONENTS a = 1.
DELETE TABLE it_sec WITH TABLE KEY sec_key COMPONENTS c = 3.

" By condition (USING KEY / FROM / TO also allowed)
DELETE it WHERE a < 6.
DELETE str_table WHERE table_line CP `Z*`.         " pattern via CP (no LIKE in itab DELETE)
```

### Deleting duplicates

`DELETE DUPLICATES` (no `ADJACENT`) is a newer statement than `DELETE ADJACENT DUPLICATES` — verify `DELETE ... COMPARING ...` / the target release's supported syntax in ADT before relying on it. The portable form across releases is `SORT itab BY key. DELETE ADJACENT DUPLICATES FROM itab COMPARING key.`; keep that as the default and reach for `DELETE DUPLICATES` only once the release is confirmed to support it.

```abap
" DELETE DUPLICATES — no prior sort needed; uses table key unless COMPARING/USING KEY given
DELETE DUPLICATES FROM it.
DELETE DUPLICATES FROM it COMPARING ALL FIELDS.    " whole line (= COMPARING table_line)
DELETE DUPLICATES FROM it COMPARING a c.
DELETE DUPLICATES FROM it USING KEY sec_key.
DELETE DUPLICATES FROM it USING KEY primary_key COMPARING a.

" DELETE ADJACENT DUPLICATES — only adjacent equals; SORT first
SORT it BY a b.
DELETE ADJACENT DUPLICATES FROM it.
DELETE ADJACENT DUPLICATES FROM it COMPARING ALL FIELDS.
DELETE ADJACENT DUPLICATES FROM it COMPARING a c.
DELETE ADJACENT DUPLICATES FROM it USING KEY sec_key.
```

- `sy-subrc` = 0 if ≥1 line deleted, else 4.
- Don't run duplicate-deletes that implicitly use the primary key on an empty-key standard table — results are surprising. Specify `COMPARING` explicitly.

### Clearing the whole table

```abap
CLEAR it.            " empties content, keeps allocated memory (faster refill)
FREE it.             " empties content AND releases memory
it = VALUE #( ).     " also clears
it_ref = NEW #( ).   " clears a referenced table
```

---

## COLLECT — one line per key, summing numerics

```abap
DATA seats_tab TYPE HASHED TABLE OF seats WITH UNIQUE KEY carrid connid.
SELECT carrid, connid, seatsocc FROM zdemo_abap_fli INTO @DATA(seats).
  COLLECT seats INTO seats_tab.        " adds seatsocc into the matching key's line
ENDSELECT.
```

- Use with a unique primary key, ideally HASHED.
- Numeric components are summed into the existing line for that key; non-numeric components form the key.

---

## SORT

```abap
SORT itab.                                  " primary/standard key, ascending — AVOID bare form
SORT itab ASCENDING.
SORT itab DESCENDING.
SORT itab BY a.                              " explicit — recommended
SORT itab BY a b ASCENDING c DESCENDING.     " per-component order
SORT itab BY table_line.                     " whole line (e.g. empty/standard key tables)
SORT itab STABLE BY city.                    " preserve order of equal keys
```

- SORTED tables cannot be sorted (already ordered). HASHED can.
- Default sort is **unstable**; add `STABLE` to keep relative order of equal-key lines.
- Bare `SORT itab` uses the standard key (all char/byte fields) → surprising; on numeric-only/empty-key lines it does nothing. Always use `BY`.
- Secondary keys cannot drive `SORT`.

---

## Info functions

```abap
DATA(row_count) = lines( itab ).                      " line count
DATA(ok)    = line_exists( itab[ b = 2 ] ).           " existence (no sy fields)
DATA(idx)   = line_index( itab[ b = 2 ] ).            " index, 0 if missing, -1 for hashed primary
READ TABLE itab WITH KEY b = 2 TRANSPORTING NO FIELDS. " classic existence (sets sy-subrc/sy-tabix)
```

RTTI for table metadata (see [abap-dynamic-programming](../../abap-dynamic-programming/SKILL.md)):

```abap
DATA(tdo) = CAST cl_abap_tabledescr( cl_abap_typedescr=>describe_by_data( itab ) ).
DATA(kind)   = tdo->table_kind.
DATA(keys)   = tdo->get_keys( ).
DATA(unique) = tdo->has_unique_key.
DATA(lt)     = tdo->get_table_line_type( ).
```
</content>
