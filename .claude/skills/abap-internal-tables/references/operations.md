# Internal Tables — Full Statement Catalog

Every variant of the line-level statements, too detailed for SKILL.md. Syntax is copied/adapted from [01_Internal_Tables.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/01_Internal_Tables.md). Demo tables assume a structured line type with components `a b c d ...` or `comp1 comp2 ...`.

---

## Declaring tables and keys

```abap
TYPES tt_itab_type1 TYPE STANDARD TABLE OF data_type ...   " standard table type
TYPES tt_itab_type2 LIKE SORTED   TABLE OF data_object ... " sorted table type

DATA lt_itab1 TYPE          TABLE OF data_type ...   " STANDARD by default
DATA lt_itab2 TYPE HASHED   TABLE OF data_type ...   " hashed
DATA lt_itab3 TYPE tt_itab_type1 ...                    " from an existing table type
DATA lt_itab4 LIKE lt_itab1 ...                          " from an existing table
```

Key specifications:

```abap
" Standard key (all char/byte fields) — implicit and explicit forms; equivalent
DATA lt_it1 TYPE TABLE OF zdemo_abap_flsch.
DATA lt_it2 TYPE STANDARD TABLE OF zdemo_abap_flsch WITH DEFAULT KEY.
DATA lt_it3 TYPE HASHED   TABLE OF zdemo_abap_flsch WITH UNIQUE DEFAULT KEY.
DATA lt_it4 TYPE SORTED   TABLE OF zdemo_abap_flsch WITH NON-UNIQUE DEFAULT KEY.

" Primary key — NON-UNIQUE is the only option for standard; it can be omitted
DATA lt_it5 TYPE TABLE OF zdemo_abap_flsch WITH NON-UNIQUE KEY carrid.
DATA lt_it6 TYPE TABLE OF zdemo_abap_flsch WITH KEY carrid.                       " same as lt_it5
DATA lt_it7 TYPE SORTED TABLE OF zdemo_abap_flsch WITH UNIQUE KEY carrid connid.
DATA lt_it8 TYPE SORTED TABLE OF zdemo_abap_flsch WITH NON-UNIQUE KEY carrid connid cityfrom.
DATA lt_it9 TYPE HASHED TABLE OF zdemo_abap_flsch WITH UNIQUE KEY carrid.         " hashed must be UNIQUE

" Predefined name primary_key, alias, table_line (whole line as key)
DATA lt_it10 TYPE TABLE OF zdemo_abap_flsch WITH KEY primary_key COMPONENTS carrid.
DATA lt_it12 TYPE SORTED TABLE OF zdemo_abap_flsch
  WITH NON-UNIQUE KEY primary_key ALIAS p1 COMPONENTS carrid connid cityfrom.
DATA lt_it13 TYPE HASHED TABLE OF zdemo_abap_flsch
  WITH UNIQUE KEY primary_key ALIAS p2 COMPONENTS table_line.

" Empty key (standard only)
DATA lt_it14 TYPE TABLE OF zdemo_abap_flsch WITH EMPTY KEY.

" Secondary keys — any kind, up to 15, named, sorted/hashed, optional alias
DATA lt_it17 TYPE TABLE OF zdemo_abap_flsch
  WITH NON-UNIQUE KEY carrid connid
  WITH UNIQUE SORTED KEY cities COMPONENTS cityfrom cityto.
DATA lt_it20 TYPE TABLE OF zdemo_abap_flsch
  WITH NON-UNIQUE KEY primary_key COMPONENTS carrid connid
  WITH NON-UNIQUE SORTED KEY cities COMPONENTS cityfrom cityto
  WITH UNIQUE HASHED KEY airports COMPONENTS airpfrom airpto.
```

- Elementary line type: the key can only be `table_line` (the whole line).
- `WITH DEFAULT KEY` = standard key explicitly; avoid relying on it implicitly.
- Inline `SELECT ... INTO TABLE @DATA(lt_itab)` → standard table, empty key.

---

## APPEND — add at the bottom

```abap
APPEND VALUE #( comp1 = a comp2 = b ) TO lt_itab.
APPEND ls_struc TO lt_itab.
APPEND INITIAL LINE TO lt_itab.

" Capture the added line by reference (inline targets allowed)
APPEND VALUE #( ... ) TO lt_itab ASSIGNING FIELD-SYMBOL(<fs_line>).
APPEND INITIAL LINE TO lt_itab REFERENCE INTO DATA(lr_dref).

" Add all / a range of lines from another table
APPEND LINES OF lt_itab2 TO lt_itab.
APPEND LINES OF lt_itab2 FROM 3 TO 5 TO lt_itab.      " FROM or TO alone also allowed
APPEND LINES OF lt_itab2 FROM 3 TO lt_itab.
APPEND LINES OF lt_itab2 TO 7 TO lt_itab.
```

- Sets `sy-tabix` to the index of the appended line (primary table index).
- **Cannot** be used on hashed tables. For sorted tables, only appends if it matches the sort order — prefer `INSERT`.

## INSERT — add at a position or by key order

```abap
INSERT VALUE #( comp1 = a ) INTO TABLE lt_itab.    " standard: appended; sorted/hashed: correct position
INSERT ls_struc INTO TABLE lt_itab.
INSERT INITIAL LINE INTO TABLE lt_itab.
INSERT INITIAL LINE INTO TABLE lt_itab REFERENCE INTO DATA(lr_dref).

" Index tables: insert before line n
INSERT ls_struc INTO lt_itab INDEX 3.
INSERT LINES OF lt_itab2 INTO lt_itab INDEX 5.

" From another table (key order)
INSERT LINES OF lt_itab2 INTO TABLE lt_itab.
INSERT LINES OF lt_itab2 FROM 5 TO 9 INTO TABLE lt_itab.
```

- `INSERT ... INTO TABLE lt_itab` covers every kind/key → prefer it in new code.
- Does **not** set `sy-tabix` (unlike `APPEND`).
- Unique primary/secondary key + duplicate → insertion fails, `sy-subrc = 4`.

---

## READ TABLE — read one line

Target areas:

```abap
READ TABLE lt_itab INTO ls_wa ...                       " copy; supports TRANSPORTING
READ TABLE lt_itab INTO DATA(ls_wa_inl) ...
READ TABLE lt_itab ASSIGNING <fs_line> ...                " reference (no copy)
READ TABLE lt_itab ASSIGNING FIELD-SYMBOL(<fs_line>) ...
READ TABLE lt_itab REFERENCE INTO lr_dref ...           " reference (dereference to use)
READ TABLE lt_itab REFERENCE INTO DATA(lr_dref_inl) ...
```

By index:

```abap
READ TABLE lt_itab INTO ls_wa INDEX i.
READ TABLE lt_itab INTO ls_wa INDEX i USING KEY primary_key.   " explicit primary index
READ TABLE lt_itab INTO ls_wa INDEX i USING KEY sec_key.       " secondary table index
```

By table key (all key components required):

```abap
READ TABLE lt_it INTO ls_wa WITH TABLE KEY primary_key COMPONENTS a = 1 b = 2.
READ TABLE lt_it INTO ls_wa WITH TABLE KEY pk COMPONENTS a = 1 b = 2.       " alias
READ TABLE lt_it INTO ls_wa WITH TABLE KEY sec_key COMPONENTS c = 3 d = 4.
READ TABLE lt_it FROM ls_pr_keys INTO ls_wa.                                   " keys from a work area
READ TABLE lt_it FROM lt_sec_keys USING KEY sec_key INTO ls_wa.
```

By free key (any components):

```abap
READ TABLE lt_it INTO ls_wa WITH KEY b = 2.
```

Additions:

```abap
" Existence / index only — no target area
READ TABLE lt_it WITH KEY b = 2 TRANSPORTING NO FIELDS.   " sets sy-subrc, sy-tabix

" Restrict copied fields (INTO target only; not with ASSIGNING/REFERENCE)
READ TABLE lt_it INTO ls_wa INDEX 1 TRANSPORTING comp2.
READ TABLE lt_it INTO ls_wa INDEX 1 TRANSPORTING ALL FIELDS.

" Compare fields after read: sy-subrc 0 = equal, 2 = differ (line still assigned)
READ TABLE lt_it INTO ls_wa INDEX 1 COMPARING comp1.
READ TABLE lt_it INTO ls_wa INDEX 1 COMPARING comp3 TRANSPORTING comp2 comp3.

" Field-symbol target extras
READ TABLE lt_it ASSIGNING <fs_line> CASTING INDEX 2.          " <fs_line> typed c/n/p/x or fully typed
READ TABLE lt_it ASSIGNING <fs_line> ELSE UNASSIGN INDEX i.    " unassign on miss

" WHERE — first matching line; slower, syntax warning on plain standard tables
READ TABLE lt_it INTO ls_wa WHERE comp1 > 3.
READ TABLE lt_it INTO ls_wa WHERE comp4 IS INITIAL ##read_where_ok.   " pragma suppresses warning
READ TABLE lt_it USING KEY sk INTO ls_wa WHERE comp3 > 40.
READ TABLE lt_it INTO ls_wa WHERE (lv_dyn_where_string).                 " dynamic WHERE
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

## Table expressions — lt_itab[ ... ]

Concise `READ TABLE` in operand position. Do **not** set `sy-subrc`/`sy-tabix`; raise `CX_SY_ITAB_LINE_NOT_FOUND` on a miss. Exception: with `ASSIGN lt_itab[ ... ] TO <fs_line>` both system fields are set and no exception is raised — a miss sets `sy-subrc` 4 (or 8 when a binary search in a sorted table reaches the table end, with `sy-tabix` = lines + 1).

```abap
" By index (index tables; KEY ... INDEX picks which index)
ls_line = lt_itab[ 2 ].
ls_line = lt_itab[ KEY primary_key INDEX 2 ].
ls_line = lt_itab[ KEY sk INDEX 1 ].                  " secondary index (works for hashed)

" By table key (all components required)
ls_line = lt_itab[ TABLE KEY primary_key COMPONENTS comp1 = 1 ].
ls_line = lt_itab[ TABLE KEY sk comp2 = 20 comp3 = 21 ].     " COMPONENTS optional

" By KEY (partial sorted-key prefix allowed; non-key comps allowed too)
ls_line = lt_itab[ KEY sk comp2 = 20 ].
ls_line = lt_itab[ KEY primary_key comp1 = 1 comp4 = 'aaa' ].

" Free key (optimized for sorted/hashed when key comps given)
ls_line = lt_itab[ comp1 = 1 ].

" Chaining a component / nested access
DATA(lv_comp_c) = lt_itab[ b = 2 ]-c.

" Avoiding the exception
DATA(ls_l1) = VALUE #( lt_itab[ 6 ] OPTIONAL ).               " initial line on miss
DATA(ls_l2) = VALUE #( lt_itab[ 7 ] DEFAULT lt_itab[ 1 ] ).      " default on miss
DATA(lr_line_ref) = REF #( lt_itab[ 5 ] ).                     " reference

" Write access
lt_itab[ 1 ] = ls_line.
lt_itab[ 1 ]-comp1 = 'X'.
```

- Binary search cannot be forced (it is automatic for sorted/hashed when applicable).
- Key names can be dynamic: `lt_itab[ KEY (key_name) ... ]`.

---

## LOOP AT — iterate

```abap
LOOP AT lt_it INTO ls_wa. ... ENDLOOP.
LOOP AT lt_it INTO DATA(ls_wa_inl). ... ENDLOOP.
LOOP AT lt_it ASSIGNING FIELD-SYMBOL(<fs_line>). ... ENDLOOP.      " modify in place
LOOP AT lt_it REFERENCE INTO DATA(lr_dref). ... ENDLOOP.

" Key order
LOOP AT lt_it INTO ls_wa USING KEY primary_key.
LOOP AT lt_it INTO ls_wa USING KEY sk.                            " secondary-key order

" Restrict the area looped over
LOOP AT lt_it INTO ls_wa FROM 2 TO 5.                             " index range (index tables)
LOOP AT lt_it INTO ls_wa FROM 2.                                  " from index 2 to end
LOOP AT lt_it INTO ls_wa TO 5.                                    " from start to index 5
LOOP AT lt_it INTO ls_wa WHERE a > 1 AND b < 4.                   " logical condition
LOOP AT lt_it TRANSPORTING NO FIELDS WHERE a < 5.             " system fields only (WHERE mandatory)

" Step size / direction (STEP n: every nth; negative = reverse)
LOOP AT lt_it INTO ls_wa STEP -1.
LOOP AT lt_it INTO ls_wa STEP 2.
LOOP AT lt_it INTO ls_wa FROM 6 TO 3 STEP -2.                     " reverse range
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
| Delete **current** line (`DELETE lt_itab INDEX sy-tabix`) | next line moves up; `sy-tabix` unchanged |

- You **cannot** `CLEAR lt_itab` / `lt_itab = VALUE #( )` (replace whole body) inside its own loop — syntax error if detected statically.
- Short form `DELETE lt_itab.` (no addition) deletes the current line — only inside a LOOP on the same table.
- With `LOOP ... USING KEY`, delete the current line via `DELETE lt_itab USING KEY loop_key.` (`loop_key` is the only name allowed there).

---

## MODIFY — change existing lines

```abap
" By key — 'ls_line' carries the key values
MODIFY TABLE lt_it FROM ls_line.
MODIFY TABLE lt_it FROM VALUE #( a = 1 b = 2 ).

" By index — note: MODIFY, not MODIFY TABLE
MODIFY lt_it FROM ls_line INDEX 1.

" Restrict changed fields (required to skip read-only key fields of sorted/hashed)
MODIFY TABLE lt_it FROM ls_line TRANSPORTING b c.
MODIFY lt_it FROM ls_line INDEX 1 TRANSPORTING b c.

" USING KEY (primary/secondary). Index after a secondary key = secondary index.
MODIFY lt_it FROM ls_line USING KEY primary_key INDEX 1.
MODIFY lt_it FROM ls_line USING KEY sec_key INDEX 1 TRANSPORTING c d.

" Capture the modified line
MODIFY lt_it INDEX 1 FROM ls_line ASSIGNING FIELD-SYMBOL(<fs_line>).
MODIFY lt_it INDEX 2 FROM ls_line REFERENCE INTO DATA(lr_dref).

" Multiple lines — TRANSPORTING and WHERE both mandatory; USING KEY optional
MODIFY lt_it FROM ls_line TRANSPORTING b c WHERE a < 5.
```

- `sy-subrc` = 0 if ≥1 line changed, 4 if none.
- `MODIFY TABLE` = key access; `MODIFY ... INDEX` = index access (not for hashed).
- Primary key fields of sorted/hashed tables are read-only → writing them dumps at runtime (only checked at runtime). Exclude them with `TRANSPORTING`.
- Secondary-key fields are read-only only while that key is in use (LOOP/MODIFY with `USING KEY`).
- `MODIFY TABLE lt_std_tab FROM ls_line` on an empty-key standard table modifies the **first** line — avoid.
- Modify-via-READ alternatives: read with `ASSIGNING`/`REFERENCE INTO` and edit the reference directly; or read `INTO ls_wa`, edit `ls_wa`, then `MODIFY TABLE lt_it FROM ls_wa`.

---

## DELETE — remove lines

```abap
" By index
DELETE lt_it INDEX 1.
DELETE lt_it INDEX 1 USING KEY primary_key.
DELETE lt_it FROM 2 TO 5.                            " index range (FROM or TO alone allowed)

" By key
DELETE TABLE lt_it FROM ls_line.                         " first line matching line's key
DELETE TABLE lt_it WITH TABLE KEY a = 1.
DELETE TABLE lt_it WITH TABLE KEY primary_key COMPONENTS a = 1.
DELETE TABLE lt_it_sec WITH TABLE KEY sec_key COMPONENTS c = 3.

" By condition (USING KEY / FROM / TO also allowed)
DELETE lt_it WHERE a < 6.
DELETE lt_str_table WHERE table_line CP `Z*`.         " pattern via CP (no LIKE in itab DELETE)
```

### Deleting duplicates

`DELETE DUPLICATES` (no `ADJACENT`) is a newer statement than `DELETE ADJACENT DUPLICATES` — verify `DELETE ... COMPARING ...` / the target release's supported syntax in ADT before relying on it. The portable form across releases is `SORT lt_itab BY key. DELETE ADJACENT DUPLICATES FROM lt_itab COMPARING key.`; keep that as the default and reach for `DELETE DUPLICATES` only once the release is confirmed to support it.

```abap
" DELETE DUPLICATES — no prior sort needed; uses table key unless COMPARING/USING KEY given
DELETE DUPLICATES FROM lt_it.
DELETE DUPLICATES FROM lt_it COMPARING ALL FIELDS.    " whole line (= COMPARING table_line)
DELETE DUPLICATES FROM lt_it COMPARING a c.
DELETE DUPLICATES FROM lt_it USING KEY sec_key.
DELETE DUPLICATES FROM lt_it USING KEY primary_key COMPARING a.

" DELETE ADJACENT DUPLICATES — only adjacent equals; SORT first
SORT lt_it BY a b.
DELETE ADJACENT DUPLICATES FROM lt_it.
DELETE ADJACENT DUPLICATES FROM lt_it COMPARING ALL FIELDS.
DELETE ADJACENT DUPLICATES FROM lt_it COMPARING a c.
DELETE ADJACENT DUPLICATES FROM lt_it USING KEY sec_key.
```

- `sy-subrc` = 0 if ≥1 line deleted, else 4.
- Don't run duplicate-deletes that implicitly use the primary key on an empty-key standard table — results are surprising. Specify `COMPARING` explicitly.

### Clearing the whole table

```abap
CLEAR lt_it.            " empties content, keeps allocated memory (faster refill)
FREE lt_it.             " empties content AND releases memory
lt_it = VALUE #( ).     " also clears
lr_it_ref = NEW #( ).   " clears a referenced table
```

---

## COLLECT — one line per key, summing numerics

```abap
DATA lt_seats_tab TYPE HASHED TABLE OF seats WITH UNIQUE KEY carrid connid.
SELECT carrid, connid, seatsocc FROM zdemo_abap_fli INTO @DATA(ls_seats).
  COLLECT ls_seats INTO lt_seats_tab.        " adds seatsocc into the matching key's line
ENDSELECT.
```

- Use with a unique primary key, ideally HASHED.
- Numeric components are summed into the existing line for that key; non-numeric components form the key.

---

## SORT

```abap
SORT lt_itab.                                  " primary/standard key, ascending — AVOID bare form
SORT lt_itab ASCENDING.
SORT lt_itab DESCENDING.
SORT lt_itab BY a.                              " explicit — recommended
SORT lt_itab BY a b ASCENDING c DESCENDING.     " per-component order
SORT lt_itab BY table_line.                     " whole line (e.g. empty/standard key tables)
SORT lt_itab STABLE BY city.                    " preserve order of equal keys
```

- SORTED tables cannot be sorted (already ordered). HASHED can.
- Default sort is **unstable**; add `STABLE` to keep relative order of equal-key lines.
- Bare `SORT lt_itab` uses the standard key (all char/byte fields) → surprising; on numeric-only/empty-key lines it does nothing. Always use `BY`.
- Secondary keys cannot drive `SORT`.

---

## Info functions

```abap
DATA(lv_row_count) = lines( lt_itab ).                      " line count
DATA(lv_ok)    = line_exists( lt_itab[ b = 2 ] ).           " existence (no sy fields)
DATA(lv_idx)   = line_index( lt_itab[ b = 2 ] ).            " index, 0 if missing, -1 for hashed primary
READ TABLE lt_itab WITH KEY b = 2 TRANSPORTING NO FIELDS. " classic existence (sets sy-subrc/sy-tabix)
```

RTTI for table metadata (see [abap-dynamic-programming](../../abap-dynamic-programming/SKILL.md)):

```abap
DATA(lo_tdo) = CAST cl_abap_tabledescr( cl_abap_typedescr=>describe_by_data( lt_itab ) ).
DATA(lv_kind)   = lo_tdo->table_kind.
DATA(lt_keys)   = lo_tdo->get_keys( ).
DATA(lv_unique) = lo_tdo->has_unique_key.
DATA(lo_line_type) = lo_tdo->get_table_line_type( ).
```
</content>
