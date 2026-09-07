# Selection Screens and Classic Lists — Full Reference

Reference companion to [../SKILL.md](../SKILL.md). Source: SAP cheat sheet `20_Selection_Screens_Lists.md`. **Legacy** — these classic ABAP UIs cannot be created in ABAP Cloud. Use this to read and maintain existing reports.

## Two kinds of selection screen

- **Standard selection screen** — every executable program has one with dynpro number **1000**, built from all `PARAMETERS`/`SELECT-OPTIONS`/`SELECTION-SCREEN` statements **not** inside a `BEGIN OF SCREEN ... END OF SCREEN` block. (If you create a standalone screen, you can't reuse number 1000.)
- **Standalone selection screen** — defined between `SELECTION-SCREEN BEGIN OF SCREEN n` and `END OF SCREEN n`; called with `CALL SELECTION-SCREEN n`.

Selection screens are generated automatically (no Screen Painter); only the ABAP Editor defines them. Layout, modification, and function codes are more limited than regular dynpros, and you cannot define dialog modules.

---

## PARAMETERS

Creates a program-global variable **and** an input field. Name ≤ 8 chars.

### Typing

```abap
PARAMETERS p_str    TYPE string.
PARAMETERS p_num    LIKE some_number.
PARAMETERS p_clen10 TYPE c LENGTH 10.       "c, n, p, x need a length
PARAMETERS p_nlen5  TYPE n LENGTH 5.
PARAMETERS p_lenpar(3) TYPE c.              "length in parens (LENGTH preferred)
PARAMETERS p_wo_len TYPE c.                 "no length → LENGTH 1
PARAMETERS p_wo_c_a(20).                    "no type → TYPE c
PARAMETERS p_woclen.                        "neither → TYPE c LENGTH 1
PARAMETERS p_dyn1 LIKE (some_dobj).         "dynamic type: c-field naming a DDIC component (uppercase)
```

DDIC types carry screen-relevant properties: F1 doc, F4 (search helps, check tables, fixed values, calendar/clock for `DATS`/`TIMS`). Without `LOWER CASE`, character input is uppercased.

### Value additions

| Addition | Effect |
|---|---|
| `DEFAULT v` | Start value (literal or data object) |
| `LOWER CASE` | Don't uppercase input |
| `MATCHCODE OBJECT shlp` | Link a DDIC search help |
| `MEMORY ID pid` | Link an SPA/GPA parameter (`SET`/`GET PARAMETER`; see table `TPARA`) |
| `VALUE CHECK` | Check against domain fixed values / foreign-key check table (DDIC types only; pair with `OBLIGATORY` since empty fields are also checked) |

### Screen additions

| Addition | Effect |
|---|---|
| `OBLIGATORY` | Required field |
| `NO-DISPLAY` | Hidden; value via `SUBMIT ... WITH`. Any type except reference/enum allowed |
| `VISIBLE LENGTH n` | Visible width (data length unchanged) |
| `AS CHECKBOX` | Checkbox; type `c` length 1 (no explicit length); `'X'`/`'x'` = selected |
| `RADIOBUTTON GROUP g` | Radio button (group name ≤ 4 chars); first/`DEFAULT 'X'` one selected |
| `AS LISTBOX VISIBLE LENGTH n` | Dropdown; fill via `VRM_SET_VALUES` |
| `USER-COMMAND fc` | Assign function code (with `AS CHECKBOX`/`RADIOBUTTON GROUP`/`AS LISTBOX`); needs `TABLES sscrfields`, evaluate `sscrfields-ucomm` |
| `MODIF ID id` | 3-char modification group (`screen-group1`) for batch `MODIFY SCREEN` |

```abap
TABLES sscrfields.
PARAMETERS: p_rb1 RADIOBUTTON GROUP rbg DEFAULT 'X',
            p_rb2 RADIOBUTTON GROUP rbg.
PARAMETERS p_list TYPE i AS LISTBOX VISIBLE LENGTH 10 USER-COMMAND list_cmd.

AT SELECTION-SCREEN OUTPUT.
  CALL FUNCTION 'VRM_SET_VALUES'
    EXPORTING
      id     = CONV vrm_id( 'P_LIST' )
      values = VALUE vrm_values( FOR lv_index = 1 UNTIL lv_index > 10 ( key = lv_index text = |Value { lv_index }| ) ).
```

The technical parameter name shows on screen unless you maintain **Selection Texts** (Text Elements → Selection Texts tab) or a `SELECTION-SCREEN COMMENT`.

---

## SELECT-OPTIONS and the selection / ranges table

`SELECT-OPTIONS s FOR f` declares **complex selection criteria** (ranges, lists, include/exclude) bound to a **selection table** — same layout as `TYPE RANGE OF`. Each row is one condition; used with `IN` in a `WHERE` clause. Empty table = no restriction.

| Column | Meaning |
|---|---|
| `SIGN` | `I` include / `E` exclude (default `I`) |
| `OPTION` | `EQ NE GE GT LE LT CP NP BT NB` (default `EQ`, or `BT` with `TO`) |
| `LOW` | single value / interval lower bound |
| `HIGH` | interval upper bound (`BT`/`NB`) |

For `CP`/`NP` patterns use wildcards `*` / `+`. The selection table has a **header line** (historical); address its body with `s[]`.

```abap
DATA: BEGIN OF gs_demo_structure, carrid TYPE c LENGTH 3, num TYPE i, END OF gs_demo_structure.
DATA gt_itab LIKE TABLE OF gs_demo_structure WITH EMPTY KEY.

SELECT-OPTIONS sel1 FOR gs_demo_structure-num.                  "static FOR target
DATA gv_dyn_spec TYPE c LENGTH 12.
SELECT-OPTIONS sel2 FOR (gv_dyn_spec).                          "dynamic DDIC type (c length 45 cols)

SELECT-OPTIONS sel_dfl3 FOR gs_demo_structure-num DEFAULT 5 TO 10 OPTION BT SIGN I.
SELECT-OPTIONS sel_dfl5 FOR gs_demo_structure-carrid DEFAULT 'A*' OPTION CP SIGN I.

START-OF-SELECTION.
  SELECT carrid, num FROM @gt_itab AS tab WHERE num IN @sel1 INTO @gs_demo_structure.
    WRITE / |{ gs_demo_structure-carrid } { gs_demo_structure-num }|.
  ENDSELECT.

  LOOP AT sel_dfl3 ASSIGNING FIELD-SYMBOL(<fs_st>).
    WRITE / |low: { <fs_st>-low }, high: { <fs_st>-high }, option: { <fs_st>-option }, sign: { <fs_st>-sign }|.
  ENDLOOP.
```

Additions: `OBLIGATORY` (first field required), `NO-DISPLAY` (any flat type via `SUBMIT`), `VISIBLE LENGTH`, `NO-EXTENSION` (no multiple selection), `NO INTERVALS` (drop second field), `LOWER CASE`, `MATCHCODE OBJECT`, `MEMORY ID`, `MODIF ID`, `DEFAULT a [TO b] [OPTION c] [SIGN d]`. See [abap-internal-tables](../../abap-internal-tables/SKILL.md) for ranges-table use beyond selection screens.

---

## SELECTION-SCREEN — layout and structure

Most `SELECTION-SCREEN` variants don't create a screen — they shape one. A selection screen fails to generate if elements overlap (positioning conflict).

### Creating screens

```abap
SELECTION-SCREEN BEGIN OF SCREEN 9000.                 "standalone, regular dynpro
  PARAMETERS param TYPE string.
SELECTION-SCREEN END OF SCREEN 9000.

SELECTION-SCREEN BEGIN OF SCREEN 9001 TITLE TEXT-001 AS WINDOW.  "titled, modal
  PARAMETERS param TYPE string.
SELECTION-SCREEN END OF SCREEN 9001.

SELECTION-SCREEN BEGIN OF SCREEN 9002 AS SUBSCREEN [NO INTERVALS] [NESTING LEVEL n].
  PARAMETERS param TYPE c LENGTH 20.                   "for tabstrips/subscreen areas; not callable directly
SELECTION-SCREEN END OF SCREEN 9002.
```

### Layout elements

```abap
SELECTION-SCREEN SKIP [n].                  "blank line(s)
SELECTION-SCREEN ULINE [/][pos](len).       "horizontal line; / = new line; POS_LOW/POS_HIGH allowed
SELECTION-SCREEN COMMENT /1(20) txt [FOR FIELD p] [VISIBLE LENGTH n] [MODIF ID id].  "text/output field
SELECTION-SCREEN PUSHBUTTON /1(15) btn USER-COMMAND cmd [VISIBLE LENGTH n].          "needs TABLES sscrfields
SELECTION-SCREEN FUNCTION KEY n.            "toolbar button FC0n (n = 1..5); needs TABLES sscrfields

SELECTION-SCREEN BEGIN OF LINE.             "put several elements on one line, no spaces
  SELECTION-SCREEN COMMENT (10) txt1.
  SELECTION-SCREEN POSITION 15.             "position the next element
  PARAMETERS param1 TYPE c LENGTH 3.
SELECTION-SCREEN END OF LINE.

SELECTION-SCREEN BEGIN OF BLOCK b1 WITH FRAME TITLE titl [NO INTERVALS].  "blocks nest; raise ON BLOCK
  PARAMETERS p_a TYPE c LENGTH 10.
SELECTION-SCREEN END OF BLOCK b1.
```

A `COMMENT`/`PUSHBUTTON` name (≤ 8 chars) implicitly creates a `c` length 83 global variable; assign its text in `INITIALIZATION` or `AT SELECTION-SCREEN OUTPUT`. `PUSHBUTTON` text/icon can be set via `ICON_CREATE`.

### Tabstrips on a selection screen

```abap
SELECTION-SCREEN: BEGIN OF TABBED BLOCK tabbl FOR 2 LINES,
                  TAB (20) tab1 USER-COMMAND push1 DEFAULT SCREEN 9001,
                  TAB (20) tab2 USER-COMMAND push2 DEFAULT SCREEN 9002,
                  END OF BLOCK tabbl.
"Implicit structure tabbl with prog / dynnr / activetab.
"Without DEFAULT SCREEN, set tabbl-prog/-dynnr/-activetab before the screen is sent.
```

### Reusing elements from another screen

```abap
SELECTION-SCREEN: BEGIN OF SCREEN 9000 AS WINDOW,
                  INCLUDE PARAMETERS param1,
                  INCLUDE SELECT-OPTIONS sel,
                  INCLUDE COMMENT /1(10) txt2,
                  INCLUDE PUSHBUTTON /1(15) btn,
                  INCLUDE BLOCKS blck,
                  END OF SCREEN 9000.
```

### Calling

```abap
CALL SELECTION-SCREEN 9000.
CALL SELECTION-SCREEN 9000 STARTING AT 10 10 [ENDING AT 60 20].   "modal
CALL SELECTION-SCREEN 9000 USING SELECTION-SET 'VARIANT'.         "preset with a variant
```

---

## Event order (selection screen + reporting)

```abap
LOAD-OF-PROGRAM.                 "program loaded into the session
INITIALIZATION.                  "after LOAD-OF-PROGRAM, before the screen; set non-DEFAULT start values
AT SELECTION-SCREEN OUTPUT.      "= PBO of the selection screen; MODIFY SCREEN here
AT SELECTION-SCREEN ON p.        "one parameter/criterion passed; ON END OF s for full sel table
AT SELECTION-SCREEN ON BLOCK b.  "a block's input passed
AT SELECTION-SCREEN ON RADIOBUTTON GROUP g.
AT SELECTION-SCREEN ON HELP-REQUEST | VALUE-REQUEST.   "F1 / F4
AT SELECTION-SCREEN ON EXIT-COMMAND.                   "Back / Exit / Cancel (cleanup)
AT SELECTION-SCREEN.             "LAST selection-screen event; all values transported; eval sscrfields-ucomm
START-OF-SELECTION.              "after selection-screen processing; implicit/default block
```

Validate input in `AT SELECTION-SCREEN ON ...` and raise `MESSAGE 'E'` to let the user correct in place — don't defer validation to `START-OF-SELECTION`. Evaluate **`sscrfields-ucomm`** for `USER-COMMAND`/`FUNCTION KEY`/`PUSHBUTTON` (declare `TABLES sscrfields.`); `sscrfields-functxt_0n` sets toolbar button texts.

---

## SUBMIT — calling reports / passing values

`SUBMIT` runs an executable program (and its selection screen); the selection screen acts as the parameter interface. Authorization is checked via `S_PROGRAM`.

```abap
SUBMIT prog.                                   "ends current SAP LUW (no AND RETURN)
SUBMIT prog AND RETURN.                         "interrupt + return; current LUW kept
SUBMIT prog USING SELECTION-SCREEN 9000 AND RETURN.   "specific screen (default 1000)
SUBMIT prog VIA SELECTION-SCREEN AND RETURN.    "display the screen to the user

"Passing values
SUBMIT prog WITH param1 = 'ABAP' AND RETURN.                       "single value
SUBMIT prog WITH sel1 = 'A' SIGN 'I' AND RETURN.                   "ranges single
SUBMIT prog WITH sel1 BETWEEN 'A' AND 'M' SIGN 'I' AND RETURN.     "ranges interval
SUBMIT prog WITH sel1 IN rangetab AND RETURN.                      "pass a ranges table
SUBMIT prog WITH SELECTION-TABLE gt_seltab AND RETURN.             "RSPARAMS table

"RSPARAMS row: selname (uppercase name), kind ('P' param / 'S' select-option),
"sign, option, low, high. For parameters, put the value in LOW.
DATA gt_seltab TYPE TABLE OF rsparams WITH EMPTY KEY.
gt_seltab = VALUE #( ( selname = 'PARAM2' kind = 'P' low = 'Test' )
                  ( selname = 'SEL1'   kind = 'S' low = 'A' high = 'M' option = 'BT' sign = 'I' ) ).
```

Other additions: `USING SELECTION-SET 'VAR'` (variant), `WITH FREE SELECTIONS`, `EXPORTING LIST TO MEMORY AND RETURN` (capture the called list — retrieve with `LIST_FROM_MEMORY` then `WRITE_LIST`/`DISPLAY_LIST`/`LIST_TO_ASCI`), `TO SAP-SPOOL`, `LINE-SIZE`/`LINE-COUNT`, `VIA JOB name NUMBER n` (background; with `JOB_OPEN`/`JOB_CLOSE`). There is no returning-parameter mechanism — pass results back via `EXPORT/IMPORT ... TO/FROM MEMORY ID`.

---

## Classic lists

Output to the **list buffer**, shown on an implicit list dynpro. Built with `WRITE`.

### WRITE — content and positioning

```abap
WRITE 'Hello'. WRITE 'world'.        "same line (separating blank)
WRITE / 'New line'.                   "/ = new line; WRITE /. ≈ SKIP
WRITE 20 'test'.                      "position 20
WRITE /(10) 'truncated text'.         "length 10 from column 1
WRITE /5(30) 'from column 5, length 30'.
WRITE AT /position(length) text.      "AT required when pos/len are variables
WRITE /(*) value.                     "* = minimum width for the value's type; ** = maximum
WRITE / |Today: { sy-datum }|.        "string templates; control chars like \n ignored
WRITE: / to_upper( 'abap' ), / repeat( val = `*` occ = 50 ).
WRITE / 'AB' NO-GAP. WRITE 'AP'.      "NO-GAP: no separating blank → ABAP
WRITE / 'fghij' UNDER abc.            "UNDER: align below a previous output
```

You can write flat data objects (incl. flat structures with char components), `string`/`xstring`, enums, and the result of function/method/string-expression calls. Internal tables and nested structures cannot be written directly.

### WRITE formatting and list elements

```abap
WRITE /(10) 'X' RIGHT-JUSTIFIED.   "also CENTERED, LEFT-JUSTIFIED
WRITE /(10) numc10 NO-ZERO.
WRITE /(*) packed_num DECIMALS 2.
WRITE / 'text' COLOR col_positive. "col_heading/normal/total/key/positive/negative/group/background; or COLOR n [OFF] [INTENSIFIED|INVERSE ON|OFF]
WRITE: /(*) sy-uname QUICKINFO 'User name'.   "tooltip
WRITE: / flag AS CHECKBOX, (10) name.         "evaluable checkbox in the list
WRITE / icon_green_light AS ICON.             "type pool ICON
WRITE / sym_caution AS SYMBOL.                "type pool SYM
WRITE / line_horizontal_line AS LINE.         "type pool LINE
```

### FORMAT — sticky formatting until OFF/RESET

```abap
FORMAT COLOR col_positive.  WRITE / 'green-ish'.  FORMAT COLOR OFF.
FORMAT HOTSPOT.  WRITE / 'clickable (single click = F2)' COLOR 5.  FORMAT HOTSPOT OFF.
FORMAT INPUT.    WRITE / some_text.  FORMAT INPUT OFF.   "editable list field
FORMAT FRAMES ON.  WRITE: / '----', / '|  |', / '----'.  FORMAT FRAMES OFF.
FORMAT RESET.    "all formats except FRAMES set to OFF (note: INTENSIFIED is ON by default at start)
```

### List helpers

```abap
ULINE.  ULINE AT 5(20).
SKIP [n].  SKIP TO LINE n.
NEW-LINE.
SET BLANK LINES ON | OFF.    "blank lines are suppressed by default
RESERVE n LINES.             "keep a line block together; triggers END-OF-PAGE on break
BACK.                        "cursor to first line of a logical unit (e.g. a RESERVE block)
```

### HIDE — stash data with a line

```abap
START-OF-SELECTION.
  FORMAT HOTSPOT.
  LOOP AT gt_itab INTO DATA(gs_wa).
    gv_addition_result = gs_wa-num1 + gs_wa-num2.
    WRITE / |{ gs_wa-num1 } + { gs_wa-num2 } = ...|.
    HIDE gv_addition_result.           "restored automatically for the clicked line
  ENDLOOP.

AT LINE-SELECTION.
  WRITE (*) gv_addition_result.
```

### Reading / modifying buffered lines

```abap
READ LINE sy-lilli.                              "content → sy-lisel; sy-subrc set
READ CURRENT LINE.
READ LINE n LINE VALUE INTO wa.                  "whole line into target
READ LINE n FIELD VALUE f INTO t [g INTO t2].    "specific field(s) into target(s)

MODIFY CURRENT LINE LINE VALUE FROM 'Overwritten'.
MODIFY CURRENT LINE FIELD VALUE f FROM 'ABAP'.
MODIFY CURRENT LINE FIELD FORMAT f COLOR 3.
MODIFY CURRENT LINE LINE FORMAT COLOR 4.
```

### List events

```abap
TOP-OF-PAGE.                        "page header on a basic list / new page
TOP-OF-PAGE DURING LINE-SELECTION.  "header for details lists
END-OF-PAGE.                        "page footer (e.g. PROGRAM LINE-COUNT 20(3).)
AT LINE-SELECTION.                  "double-click / F2 (function code PICK)
AT USER-COMMAND.                    "custom function codes; CASE sy-ucomm. SET USER-COMMAND 'FC' fires it programmatically
```

Unlike dynpros, classic lists have **no OK_CODE field** — use `sy-ucomm`. Key list system fields: `sy-lilli` (clicked line), `sy-lisel` (clicked line content), `sy-lsind` (list level), `sy-linno`, `sy-colno`, `sy-pagno`.

---

## ALV (SAP List Viewer) — modern alternative to WRITE lists

ALV gives sorting, filtering, totals, layout variants, and export for free. Prefer **`CL_SALV_TABLE`** (the cleanest classic option, encapsulating the grid). The older `CL_GUI_ALV_GRID` should not be used directly for new code; the `REUSE_ALV_*` function modules are the oldest, field-catalog-driven generation still common in legacy reports.

Minimal:

```abap
TRY.
    cl_salv_table=>factory( IMPORTING r_salv_table = DATA(lo_alv)
                            CHANGING  t_table      = gt_itab ).
    lo_alv->display( ).
  CATCH cx_salv_msg INTO DATA(lo_err).
    MESSAGE lo_err->get_text( ) TYPE 'I' DISPLAY LIKE 'E'.
ENDTRY.
```

Common follow-ups: `lo_alv->get_display_settings( )->set_list_header( 'Title' )`; `lo_alv->get_columns( )->get_column( 'COL1' )`; `lo_alv->set_data( CHANGING t_table = gt_itab )` then `lo_alv->refresh( )` to rebuild output; events via `cl_salv_events_table` (`double_click`, `link_click`) and `cl_salv_events` (`added_function`). The `factory` `list_display` parameter shows ALV as a classic list; other parameters embed it in a container (e.g. on a dynpro).

> SALV is still SAP GUI. New apps target RAP + Fiori — see [abap-modernization-playbook](../../abap-modernization-playbook/SKILL.md).

## See also

- [../SKILL.md](../SKILL.md) — overview and the classic-UI decision
- [dynpro.md](dynpro.md) — regular dynpros (selection screens are special, implicit dynpros)
- [abap-internal-tables](../../abap-internal-tables/SKILL.md) — ranges/selection table semantics in depth
- [abap-modernization-playbook](../../abap-modernization-playbook/SKILL.md), [rap-bo-modeling](../../rap-bo-modeling/SKILL.md) — moving classic reports to RAP/Fiori
- SAP cheat sheet: https://github.com/SAP-samples/abap-cheat-sheets/blob/main/20_Selection_Screens_Lists.md
