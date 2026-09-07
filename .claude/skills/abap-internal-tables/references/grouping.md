# Internal Tables — Grouping (LOOP AT ... GROUP BY)

`LOOP AT ... GROUP BY` groups internal table lines by a key, loops over the groups, and (optionally) over each group's members. It replaces the old, order-dependent `AT NEW ...` group-level processing. Syntax copied/adapted from [01_Internal_Tables.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/01_Internal_Tables.md) and [11_Internal_Tables_Grouping.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/11_Internal_Tables_Grouping.md).

The same grouping is also available as `FOR ... IN GROUP` inside constructor expressions — see [abap-constructor-expressions](../../abap-constructor-expressions/SKILL.md).

---

## Mental model

- **Group loop** (`LOOP AT itab ... GROUP BY ...`): one pass per distinct group key. Each group key represents one group; the lines that share that key are its *members*.
- **Member loop** (`LOOP AT GROUP ...`): a nested loop over the members of the current group.
- **Binding** decides what the group loop's target holds:
  - **Representative binding** (no `INTO` after `GROUP BY`): the target holds the *first line* of each group — its "representative".
  - **Group key binding** (`... GROUP BY ... INTO key`): the target holds the *group key* (a value or a structure), enabling `GROUP SIZE`, `GROUP INDEX`, and `WITHOUT MEMBERS`.

---

## Grouping by one column

### Representative binding

```abap
LOOP AT lt_spfli_tab INTO DATA(ls_wa) GROUP BY ls_wa-carrid.
  " ls_wa holds the first line of the group; ls_wa-carrid is the group key
  LOOP AT GROUP ls_wa INTO DATA(ls_member).
    " each member of this carrid group
  ENDLOOP.
ENDLOOP.
```

- Without a nested loop and without `INTO`, the work area is just the group's first line. `sy-tabix` here is the value it would have in an ungrouped loop.

### Group key binding

```abap
LOOP AT lt_spfli_tab INTO DATA(ls_wa) GROUP BY ls_wa-carrid INTO DATA(lv_key).
  " 'lv_key' is the elementary group key (the carrid value), declarable inline
  LOOP AT GROUP lv_key INTO DATA(ls_member).
    ...
  ENDLOOP.
ENDLOOP.
```

- The difference is the `INTO` after `GROUP BY`. `lv_key` represents the group instead of reusing `ls_wa`.
- Only group key binding enables `GROUP SIZE`, `GROUP INDEX`, `WITHOUT MEMBERS`.
- When a group key binding is specified, the read result (`ls_wa`) has **initial** component values — access members via `LOOP AT GROUP`.

---

## Grouping by more than one column

A structured group key — components in parentheses:

```abap
" Representative binding
LOOP AT lt_spfli_tab INTO DATA(ls_wa) GROUP BY ( key1 = ls_wa-carrid key2 = ls_wa-airpfrom ).
  ...
ENDLOOP.

" Group key binding → 'ls_key' is a structure with key1, key2
LOOP AT lt_spfli_tab INTO DATA(ls_wa)
     GROUP BY ( key1 = ls_wa-carrid key2 = ls_wa-airpfrom ) INTO DATA(ls_key).
  " ls_key-key1 ... ls_key-key2 ...
  LOOP AT GROUP ls_key INTO DATA(ls_member).
    ...
  ENDLOOP.
ENDLOOP.
```

- The right side of each `key = ...` assignment can be an expression, not just a column.
- You choose the component names freely (`key1`, `key2`, `carrier`, ...).

---

## GROUP SIZE, GROUP INDEX, WITHOUT MEMBERS

Available **only** with group key binding, as extra structured-key components:

```abap
LOOP AT lt_it INTO DATA(ls_wa)
     GROUP BY ( key = ls_wa-comp1 gi = GROUP INDEX gs = GROUP SIZE )
     ASCENDING INTO DATA(ls_grp).
  " ls_grp-key   = group key value
  " ls_grp-gi    = group index (sequence number of this group)
  " ls_grp-gs    = group size (member count)
ENDLOOP.
```

- `GROUP SIZE` — number of members in the group.
- `GROUP INDEX` — sequence number of the group within the group loop.
- `WITHOUT MEMBERS` — build the groups (key + size/index) without materializing members. No member loop is possible afterward; saves time and memory when you only need aggregates. Requires a group key binding.

```abap
LOOP AT lt_spfli_tab INTO DATA(ls_wa)
     GROUP BY ( key1 = ls_wa-carrid key2 = ls_wa-airpfrom
                index = GROUP INDEX size = GROUP SIZE )
     WITHOUT MEMBERS INTO DATA(ls_key).
  " ls_key-key1 ... ls_key-key2 ... ls_key-index ... ls_key-size ... (no LOOP AT GROUP here)
ENDLOOP.
```

---

## Sort order of the group loop

```abap
LOOP AT lt_it INTO DATA(ls_wa) GROUP BY ls_wa-comp1 ASCENDING.   ...   ENDLOOP.
LOOP AT lt_it INTO DATA(ls_wa) GROUP BY ( k1 = ls_wa-comp1 k2 = ls_wa-comp2 ) DESCENDING. ... ENDLOOP.
```

- `ASCENDING` / `DESCENDING` order the *group loop* by the group key. You can also pre-`SORT` the table.
- `GROUP INDEX` reflects the original position even when the group loop is sorted.

---

## Member loop (LOOP AT GROUP)

```abap
" Representative binding — address the group via the work area
LOOP AT lt_it INTO DATA(ls_wa) GROUP BY ls_wa-comp1.
  LOOP AT GROUP ls_wa INTO DATA(ls_member).
    ...
  ENDLOOP.
ENDLOOP.

" Group key binding — address the group via the key
LOOP AT lt_it INTO DATA(ls_wa) GROUP BY ls_wa-comp1 INTO DATA(ls_grp).
  LOOP AT GROUP ls_grp INTO DATA(ls_member).
    ...
  ENDLOOP.
ENDLOOP.
```

- Member loops support the usual targets (`INTO` / `ASSIGNING` / `REFERENCE INTO`), a `WHERE` condition, and even further `GROUP BY`.
- Inside `LOOP AT GROUP`, `sy-tabix` is the value the member would have in an ungrouped loop over the original table.

```abap
" Member loop with WHERE and nested re-grouping
LOOP AT lt_it INTO DATA(ls_wa) GROUP BY ls_wa-comp1 ASCENDING.
  LOOP AT GROUP ls_wa INTO DATA(ls_member) WHERE comp3 = abap_true.
    ...
  ENDLOOP.
ENDLOOP.

" "Top per group": sort members descending, take the first, EXIT
LOOP AT lt_it INTO DATA(ls_wa) GROUP BY ls_wa-comp1 ASCENDING.
  LOOP AT GROUP ls_wa INTO DATA(ls_member) GROUP BY ls_member-comp2 DESCENDING.
    APPEND ls_member TO lt_result.
    EXIT.
  ENDLOOP.
ENDLOOP.
```

---

## GROUP BY vs FOR ... IN GROUP

The constructor-expression form builds a table in one expression; `LOOP AT ... GROUP BY` is more flexible for arbitrary in-loop logic.

```abap
" LOOP AT statement
LOOP AT lt_fl_tab INTO DATA(ls_flight)
     GROUP BY ( carrier = ls_flight-carrid cityfr = ls_flight-cityfrom
                size = GROUP SIZE index = GROUP INDEX )
     ASCENDING REFERENCE INTO DATA(lr_group_ref).
  LOOP AT GROUP lr_group_ref ASSIGNING FIELD-SYMBOL(<fs_flight>).
    ...
  ENDLOOP.
ENDLOOP.

" FOR ... GROUP BY ... IN GROUP inside VALUE
DATA(lt_itab_constr) = VALUE ty_itab_constr(
  FOR GROUPS group OF line IN lt_fl_tab
    GROUP BY ( carrier = line-carrid cityfrom = line-cityfrom
               size = GROUP SIZE index = GROUP INDEX ) ASCENDING
    LET lt_members = VALUE tab_type( FOR <fs_member> IN GROUP group ( <fs_member> ) ) IN
    ( member = lt_members info = |carrid="{ group-carrier }", size="{ group-size }"| ) ).
```

See [abap-constructor-expressions](../../abap-constructor-expressions/SKILL.md) for the `FOR ... IN GROUP` deep dive.

---

## COLLECT vs GROUP BY for summation

`COLLECT` is the compact way to sum numeric components per key; a `GROUP BY` with a summing member loop is the explicit equivalent.

```abap
" COLLECT
DATA lt_seats_col TYPE HASHED TABLE OF seats WITH UNIQUE KEY carrid connid.
SELECT carrid, connid, seatsocc FROM zdemo_abap_fli INTO @DATA(ls_seats).
  COLLECT ls_seats INTO lt_seats_col.
ENDSELECT.

" Equivalent with GROUP BY
LOOP AT lt_seats_all INTO DATA(ls_wa) GROUP BY ( key1 = ls_wa-carrid key2 = ls_wa-connid ).
  INSERT VALUE #( carrid = ls_wa-carrid connid = ls_wa-connid )
    INTO TABLE lt_seats_grp ASSIGNING FIELD-SYMBOL(<fs_line>).
  LOOP AT GROUP ls_wa INTO DATA(ls_member).
    <fs_line>-seatsocc = <fs_line>-seatsocc + ls_member-seatsocc.
  ENDLOOP.
ENDLOOP.
" lt_seats_grp = lt_seats_col
```

Prefer `COLLECT` for pure numeric aggregation into a unique-key table; reach for `GROUP BY` when you need per-group logic beyond summation (group size/index, filtering members, choosing a representative).

---

## Reference

- **ABAP Keyword Documentation — LOOP AT ... GROUP BY:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abaploop_at_itab_group_by.htm
- **SAP-samples/abap-cheat-sheets — 11_Internal_Tables_Grouping.md:** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/11_Internal_Tables_Grouping.md
</content>
