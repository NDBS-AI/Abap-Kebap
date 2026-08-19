---
name: abap-classic-ui
description: Use when reading, maintaining, or debugging classic SAP GUI UIs — dynpros (screens with PBO/PAI flow logic, OK_CODE/sy-ucomm, CALL/SET/LEAVE SCREEN, LOOP AT SCREEN), selection screens (PARAMETERS, SELECT-OPTIONS, SELECTION-SCREEN blocks/comments/pushbuttons, AT SELECTION-SCREEN events, variants, the ranges/selection table with sign/option/low/high), and classic lists (WRITE, FORMAT, AT LINE-SELECTION, HIDE, READ LINE, interactive lists). Also for understanding REUSE_ALV / CL_GUI_ALV_GRID / CL_SALV_TABLE in legacy reports. This is LEGACY maintenance territory — for new UI use RAP + Fiori.
---

# ABAP Classic UI (Legacy Maintenance)

> [!IMPORTANT]
> **This is LEGACY territory.** Classic dynpros, selection screens, and classic lists are the SAP GUI UI technologies of the pre-OO era. They are **outdated for new application programs** and **cannot be created in ABAP Cloud / Steampunk** at all. New development should use **RAP + Fiori** (OData-exposed business objects rendered by Fiori Elements or freestyle UI5).
>
> Use this skill to **read, understand, debug, and minimally maintain** existing classic UI — not to build new screens. If you find yourself writing a brand-new dynpro from scratch, stop and reconsider:
> - For a new transactional app → [rap-bo-modeling](../rap-bo-modeling/SKILL.md) (RAP business object + Fiori).
> - For converting an existing classic report/dialog to modern UI → [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md) (it has the "classic ALV report → RAP + Fiori" decision and "do not touch" signals).

## Overview

Classic ABAP offers three UI families, all integrated into Standard ABAP:

| Family | What it is | Created via |
|---|---|---|
| **Dynpro** (dynamic program) | Free-layout screen with flow logic (PBO/PAI) | Screen Painter (SE51) + flow logic; only in function groups, module pools, executable programs — **not** class pools |
| **Selection screen** | Special dynpro for parameter/criteria entry in reports | ABAP statements (`PARAMETERS`, `SELECT-OPTIONS`, `SELECTION-SCREEN`) — no Screen Painter; auto-generated |
| **Classic list** | Formatted text output in the list buffer, optionally interactive | `WRITE`, `FORMAT`, list events |

A typical executable program (report) chains all three: a **selection screen** collects input, `START-OF-SELECTION` does the work, and a **classic list** (or ALV) displays the result.

## When to Use

- You are reading or fixing an existing module pool, dialog transaction, or classic report.
- You hit a screen with `PROCESS BEFORE OUTPUT` / `PROCESS AFTER INPUT` flow logic and need to understand the data transport.
- You are debugging why a selection screen field is empty, required, or behaving oddly.
- You need to understand a `WRITE`-based list, an interactive `AT LINE-SELECTION`, or a `HIDE` mechanism.
- You are scoping a migration of a classic UI to RAP/Fiori (read this for the "as-is", then go to the modernization playbook).

**When NOT to use:** greenfield UI work, ABAP Cloud, or anything where Fiori is an option — go straight to RAP/Fiori.

## Classic Dynpro Essentials

A dynpro = a four-digit screen (e.g. 9000) attached to a program, plus its **flow logic**. Screen 1000 is reserved. The current dynpro number is in `sy-dynnr`.

### Flow logic: PBO and PAI

Flow logic is the procedural part of a dynpro, maintained on the *Flow Logic* tab. Its statements (`MODULE`, `FIELD`, `CHAIN`, `LOOP`, `CALL SUBSCREEN`) are dynpro-specific, not ABAP. Processing blocks:

```abap
PROCESS BEFORE OUTPUT.            "PBO: runs before the screen is shown
  MODULE pbo_9000.                "prepare display, prefill fields

PROCESS AFTER INPUT.             "PAI: runs after a user action
  MODULE pai_9000.                "evaluate entries, react to function code

PROCESS ON HELP-REQUEST.         "POH: F1 field help
  FIELD dynp_field MODULE help_mod.

PROCESS ON VALUE-REQUEST.        "POV: F4 input help
  FIELD dynp_field MODULE f4_mod.
```

Dialog modules live in the ABAP program. PBO modules use `OUTPUT`, PAI modules use `INPUT`:

```abap
MODULE pbo_9000 OUTPUT.
  some_input_field = 'Hallo'.     "prefill a screen field
ENDMODULE.

MODULE pai_9000 INPUT.
  ...
ENDMODULE.
```

> Dialog modules have **no parameter interface and no local data area** — data moves only through program-global variables of the same name as the dynpro fields. A `DATA` declared inside a module becomes global.

### Dynpro fields and data transport

Each screen element has a **dynpro field**; create a program-global variable of the **same name** to exchange data. PBO transports program → screen; PAI transports screen → program automatically at the start of PAI, before the modules run.

```abap
PROGRAM some_program.
DATA some_dobj TYPE abap_bool.
TABLES some_struct.               "table work area; brings DDIC semantics (labels, F1/F4)
```

`FIELD` controls *when* a field is transported during PAI (fields named after `FIELD` are transported only when that statement runs):

```abap
PROCESS AFTER INPUT.
  MODULE pai_9000.                "neither field_a nor field_b available yet
  FIELD field_a.
  MODULE module_a.                "field_a available
  FIELD field_b MODULE mod ON INPUT.   "call mod only if field_b is filled
```

### OK_CODE and sy-ucomm

Every dynpro has a 20-char **OK field** (not bound to a screen element; name it e.g. `ok_code`). When a function-code-bearing control is used, the code lands in the OK field and `sy-ucomm`. **Prefer the OK field over `sy-ucomm`** — and save+clear it so a stale code doesn't fire on the next PBO:

```abap
DATA: ok_code LIKE sy-ucomm,
      save_ok LIKE ok_code.

MODULE pai_9000 INPUT.
  save_ok = ok_code.
  CLEAR ok_code.
  CASE save_ok.
    WHEN 'PUSH'.   ...
    WHEN 'ENTER'.  ...
    WHEN 'CANCEL'. ...
    WHEN OTHERS.   ...
  ENDCASE.
ENDMODULE.
```

### Calling and leaving dynpros

Each dynpro statically defines its **next dynpro** (0 = end of sequence). ABAP statements override this:

```abap
SET SCREEN 9200.        "set next dynpro; called when PAI ends. 0 ends the sequence
CALL SCREEN 9300.       "start a NEW (nested) dynpro sequence
CALL SCREEN 9400 STARTING AT 10 10 ENDING AT 60 20.  "modal dialog box (popup)
LEAVE SCREEN.           "exit current dynpro now, go to the set next dynpro
LEAVE TO SCREEN 9200.   "short form of: SET SCREEN 9200. LEAVE SCREEN.
LEAVE TO SCREEN 0.      "end the dynpro sequence
```

### GUI status and title

The menu bar, toolbars, and function keys are a separate **GUI status** (Menu Painter); the title is a separate **GUI title**. Set both in PBO:

```abap
SET PF-STATUS 'STATUS'.
SET PF-STATUS 'STATUS' EXCLUDING fcode.   "deactivate listed function codes
SET TITLEBAR 'TITLE' WITH text1 text2.    "WITH replaces &1 &2 placeholders
```

### Modifying screen elements dynamically (LOOP AT SCREEN / MODIFY SCREEN)

Override static element attributes in PBO. Note dynpro uses `'0'`/`'1'`, not `abap_true`:

```abap
MODULE pbo_9000 OUTPUT.
  LOOP AT SCREEN INTO DATA(scr).
    IF scr-name = 'SOME_INPUT_FIELD'.
      scr-required = '1'.           "also: -active, -input, -invisible, -intensified
      MODIFY SCREEN FROM scr.
    ENDIF.
  ENDLOOP.
ENDMODULE.
```

The `MODIF ID` attribute groups elements (`scr-group1`) so you can modify many at once — heavily used on selection screens too.

For controls (table controls, tabstrips, GUI controls like `CL_GUI_ALV_GRID`), modal/subscreen dynpros, `CHAIN`/`ENDCHAIN`, and input checks (`AT EXIT-COMMAND`), see **[references/dynpro.md](references/dynpro.md)**.

## Selection Screens

Three statements build them in the program's global declaration part. The **standard selection screen** is number 1000 (auto-created); **standalone** screens use `SELECTION-SCREEN BEGIN OF SCREEN n`.

### PARAMETERS — single input field + global variable

```abap
PARAMETERS p_str   TYPE string.
PARAMETERS p_carr  TYPE s_carr_id.            "DDIC type → F4 help inherited
PARAMETERS p_clen  TYPE c LENGTH 10.
PARAMETERS p_dflt  TYPE i DEFAULT 12345.
PARAMETERS p_low   TYPE string LOWER CASE.    "keep lowercase
PARAMETERS p_oblig TYPE c LENGTH 10 OBLIGATORY.
PARAMETERS p_hide  TYPE c LENGTH 10 NO-DISPLAY.        "not shown; fill via SUBMIT ... WITH
PARAMETERS p_check AS CHECKBOX.                        "'X'/'x' = selected
PARAMETERS: p_rb1 RADIOBUTTON GROUP rbg DEFAULT 'X',   "first/DEFAULT one is selected
            p_rb2 RADIOBUTTON GROUP rbg.
PARAMETERS p_list TYPE i AS LISTBOX VISIBLE LENGTH 10. "fill via VRM_SET_VALUES
```

Other additions: `MATCHCODE OBJECT shlp` (search help), `MEMORY ID pid` (SPA/GPA), `VALUE CHECK` (against domain fixed values — pair with `OBLIGATORY`), `VISIBLE LENGTH`, `MODIF ID`, and `USER-COMMAND fcode` (assigns a function code; requires `TABLES sscrfields.` and is evaluated via `sscrfields-ucomm`).

### SELECT-OPTIONS — selection criteria (the ranges/selection table)

`SELECT-OPTIONS s FOR f` creates a **selection table** (same layout as `TYPE RANGE OF`): a table with header line and four columns. Each row is one condition; used with `IN` in `WHERE`.

| Column | Meaning |
|---|---|
| `SIGN` | `I` include / `E` exclude |
| `OPTION` | comparison: `EQ NE GE GT LE LT CP NP BT NB` |
| `LOW` | single value, or interval lower bound |
| `HIGH` | interval upper bound (for `BT`/`NB`) |

```abap
DATA: BEGIN OF demo_structure, carrid TYPE c LENGTH 3, num TYPE i, END OF demo_structure.
DATA itab LIKE TABLE OF demo_structure WITH EMPTY KEY.

SELECT-OPTIONS sel1 FOR demo_structure-num.
SELECT-OPTIONS sel2 FOR demo_structure-num DEFAULT 5 TO 10 OPTION BT SIGN I.
SELECT-OPTIONS sel3 FOR demo_structure-carrid DEFAULT 'A*' OPTION CP SIGN I.

START-OF-SELECTION.
  SELECT carrid, num FROM @itab AS tab WHERE num IN @sel1 INTO @demo_structure.
    WRITE / |{ demo_structure-carrid } { demo_structure-num }|.
  ENDSELECT.
```

> The selection table has a **header line** for historical reasons — to address the body (e.g. `LOOP AT`), use `sel1[]`. Empty selection table = no restriction (all rows match). See [abap-internal-tables](../abap-internal-tables/SKILL.md) for ranges-table semantics in detail.

Additions: `OBLIGATORY`, `NO-DISPLAY`, `NO-EXTENSION` (no multiple selection), `NO INTERVALS` (no second field), `VISIBLE LENGTH`, `LOWER CASE`, `MATCHCODE OBJECT`, `MEMORY ID`, `MODIF ID`.

### SELECTION-SCREEN — layout

```abap
SELECTION-SCREEN BEGIN OF BLOCK b1 WITH FRAME TITLE titl.
  PARAMETERS p_a TYPE c LENGTH 10.
  SELECTION-SCREEN SKIP 1.
  SELECTION-SCREEN ULINE.
SELECTION-SCREEN END OF BLOCK b1.

SELECTION-SCREEN BEGIN OF LINE.
  SELECTION-SCREEN COMMENT (15) txt FOR FIELD p_b.
  PARAMETERS p_b TYPE c LENGTH 10.
SELECTION-SCREEN END OF LINE.

SELECTION-SCREEN PUSHBUTTON /1(15) btn USER-COMMAND cmd1.   "needs TABLES sscrfields
SELECTION-SCREEN FUNCTION KEY 1.                            "toolbar button FC01

SELECTION-SCREEN BEGIN OF SCREEN 9000 TITLE TEXT-001 AS WINDOW.  "standalone, modal
  PARAMETERS param TYPE string.
SELECTION-SCREEN END OF SCREEN 9000.
```

Call standalone screens with `CALL SELECTION-SCREEN 9000 [STARTING AT c l]`.

### AT SELECTION-SCREEN events (order matters)

```abap
INITIALIZATION.                  "set start values that DEFAULT can't express
AT SELECTION-SCREEN OUTPUT.      "= PBO of the selection screen; do MODIFY SCREEN here
AT SELECTION-SCREEN ON p_field.  "validate one field/criterion; raise MESSAGE 'E' to reject
AT SELECTION-SCREEN ON BLOCK b1.
AT SELECTION-SCREEN ON RADIOBUTTON GROUP rbg.
AT SELECTION-SCREEN.             "LAST event; all values transported. Evaluate sscrfields-ucomm
START-OF-SELECTION.              "after selection screen processing
```

For `USER-COMMAND`, evaluate **`sscrfields-ucomm`** (not `sy-ucomm`) after declaring `TABLES sscrfields.`.

**Variants** are saved sets of selection-screen values (transaction-bound, reusable defaults). Pass them with `SUBMIT ... USING SELECTION-SET 'VAR'`.

For the full SELECTION-SCREEN reference (all additions, subscreens, `TABBED BLOCK`, `INCLUDE`, `SUBMIT` and `WITH SELECTION-TABLE`/ranges passing), see **[references/selection-screens.md](references/selection-screens.md)**.

## Classic Lists

Output goes to the **list buffer** and is shown on an implicit list dynpro. Built line by line with `WRITE`.

```abap
WRITE 'Hello'.                   "same line
WRITE / 'New line'.              "/ = new line; WRITE /. acts like SKIP
WRITE /5(30) 'Text from column 5, length 30'.
WRITE AT /position(length) some_text.       "AT required when pos/len are variables
WRITE / |Today: { sy-datum }|.   "string templates work
WRITE: / to_upper( 'abap' ), / repeat( val = `*` occ = 50 ).
```

Formatting: `WRITE ... COLOR col_positive`, `... RIGHT-JUSTIFIED|CENTERED`, `... NO-ZERO`, `... QUICKINFO 'tip'`, `... AS CHECKBOX|AS ICON|AS SYMBOL`. `FORMAT COLOR ... / HOTSPOT / INPUT / FRAMES` sets formatting until `OFF`/`RESET`. Helpers: `ULINE`, `SKIP [n]`, `SKIP TO LINE n`, `NEW-LINE`, `SET BLANK LINES ON` (blank lines are suppressed by default).

### Interactive lists

```abap
START-OF-SELECTION.
  FORMAT HOTSPOT.
  LOOP AT itab INTO DATA(wa).
    addition_result = wa-num1 + wa-num2.
    WRITE / |{ wa-num1 } + { wa-num2 } = ...|.
    HIDE addition_result.        "stash a value with the current line
  ENDLOOP.

AT LINE-SELECTION.               "raised by double-click / F2 (function code PICK)
  WRITE / |You clicked line { sy-lilli }.|.
  WRITE / |Clicked line content (sy-lisel): { sy-lisel }|.
  WRITE (*) addition_result.     "HIDE value restored automatically for the clicked line

AT USER-COMMAND.                 "raised by custom function codes
  CASE sy-ucomm.
    WHEN 'REFRESH'. ...
  ENDCASE.
```

Key list system fields: `sy-lilli` (clicked line number), `sy-lisel` (clicked line content), `sy-lsind` (list level), `sy-linno`/`sy-colno`/`sy-pagno`. Read/modify buffered lines with `READ [CURRENT] LINE ... [FIELD VALUE f INTO t]` and `MODIFY [CURRENT] LINE`. List page events: `TOP-OF-PAGE`, `TOP-OF-PAGE DURING LINE-SELECTION`, `END-OF-PAGE`.

> Unlike dynpros, classic lists have **no OK_CODE field** — evaluate `sy-ucomm` in `AT USER-COMMAND`.

For full WRITE/FORMAT additions, list-buffer processing, and event ordering, see **[references/selection-screens.md](references/selection-screens.md)** (lists live in the same cheat sheet).

## Classic ALV — brief pointer

ALV (SAP List Viewer) gives sorting, filtering, totals, export, and column config for free — vastly preferable to hand-rolled `WRITE` lists. In legacy code you will meet three generations:

| API | Status | Notes |
|---|---|---|
| `REUSE_ALV_GRID_DISPLAY` / `REUSE_ALV_LIST_DISPLAY` (function modules) | Oldest, very common in old reports | Field-catalog driven; verbose; still works |
| `CL_GUI_ALV_GRID` (control) | Older OO | **Should no longer be used directly** for new code (per SAP) |
| `CL_SALV_TABLE` (SALV) | **Cleanest classic option** | Encapsulates the grid; minimal boilerplate; use this if you must add ALV to legacy code |

Minimal SALV:

```abap
TRY.
    cl_salv_table=>factory( IMPORTING r_salv_table = DATA(alv)
                            CHANGING  t_table      = itab ).
    alv->display( ).
  CATCH cx_salv_msg INTO DATA(err).
    MESSAGE err->get_text( ) TYPE 'I' DISPLAY LIKE 'E'.
ENDTRY.
```

> SALV is still a SAP GUI technology. For new apps the target is RAP + Fiori Elements, not SALV. See [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md).

## Common Mistakes

| Mistake | Cost | Fix |
|---|---|---|
| Building a new classic dynpro for a new app | Dead-end UI, no cloud path, no Fiori | Use RAP + Fiori ([rap-bo-modeling](../rap-bo-modeling/SKILL.md)) |
| Evaluating `sy-ucomm` instead of the OK field / `sscrfields-ucomm` | Stale or wrong function code | Use named OK field (dynpro) or `sscrfields-ucomm` (selection screen) |
| Forgetting to `CLEAR ok_code` after evaluating it | A code re-fires on the next PBO | Save to `save_ok`, then `CLEAR ok_code` |
| `MODIFY SCREEN` with `abap_true` | No effect — dynpro uses `'0'`/`'1'` | Set `scr-required = '1'` etc. |
| Validating input only in `START-OF-SELECTION` | User can't correct in place | Validate in `AT SELECTION-SCREEN ON ...` with `MESSAGE 'E'` |
| Addressing a SELECT-OPTIONS table without `[]` | Hits the header line, not the body | Use `sel[]` for `LOOP AT`, comparisons |
| Declaring data inside a dialog module/event block | Becomes a hidden global | Declare globally, or call a method on a local class |
| Hand-rolling a `WRITE` grid instead of ALV | No sort/filter/export, lots of code | Use `CL_SALV_TABLE` |
| Relying on `WRITE` blank lines showing | Suppressed by default | `SET BLANK LINES ON` |

## References

- **[references/dynpro.md](references/dynpro.md)** — dynpro deep dive: flow logic (`FIELD`/`MODULE`/`CHAIN`/`LOOP`/`CALL SUBSCREEN`), input checks & `AT EXIT-COMMAND`, F1/F4 help, modal/subscreen dynpros, table controls, tabstrip controls, GUI controls.
- **[references/selection-screens.md](references/selection-screens.md)** — full selection-screen reference (all `PARAMETERS`/`SELECT-OPTIONS`/`SELECTION-SCREEN` additions, ranges semantics, event order, `SUBMIT`) and classic lists (WRITE/FORMAT, list buffer, list events).
- **SAP cheat sheet — Dynpro:** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/18_Dynpro.md
- **SAP cheat sheet — Selection Screens and Classic Lists:** https://github.com/SAP-samples/abap-cheat-sheets/blob/main/20_Selection_Screens_Lists.md
- **ABAP Keyword Documentation — SAP GUI User Dialogs:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abenabap_screens.htm
- Linked skills: [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md), [rap-bo-modeling](../rap-bo-modeling/SKILL.md), [abap-internal-tables](../abap-internal-tables/SKILL.md)
