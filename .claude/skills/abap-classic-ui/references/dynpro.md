# Dynpro — Deep Dive

Reference companion to [../SKILL.md](../SKILL.md). Source: SAP cheat sheet `18_Dynpro.md`. **Legacy** technology — dynpros cannot be created in ABAP Cloud. Use this to understand and maintain existing screens.

## What a dynpro is

- **Dynpro** = *dynamic program*: program flow driven by user interaction. The classic ABAP UI technology from before classes/methods/events existed.
- Defined only in **function groups, module pools, and executable programs** — **not** in class pools.
- Identified by a unique four-digit **dynpro number** (leading zeros optional when calling). Number 1000 is reserved; current dynpro is `sy-dynnr`.
- Created in the **Screen Painter** (layout editor for screen elements; Flow Logic tab for flow logic). Displayed in a SAP GUI window.
- Dynpro type set at creation: *Normal* (full window), *Modal Dialog Box* (popup), or *Subscreen* (area within another dynpro).
- Each dynpro has a static **Next dynpro** (0 or blank = last in sequence; same number = loops).

Special dynpros — **selection screens** and **classic lists** — are created implicitly (see [selection-screens.md](selection-screens.md)).

## Flow logic statements

Flow logic is the procedural part on the *Flow Logic* tab. Its statements run on AS ABAP but are dynpro-specific (not ABAP statements):

| Statement | Purpose |
|---|---|
| `MODULE` | Call a dialog module |
| `FIELD` | Control data transport of a specific dynpro field during PAI |
| `CHAIN` / `ENDCHAIN` | Combine module calls into a processing chain |
| `LOOP` / `ENDLOOP` | Process lines of a table control |
| `CALL SUBSCREEN` | Call the flow logic of a subscreen |

The four processing blocks, triggered by the runtime as PBO/PAI/POH/POV events:

```abap
PROCESS BEFORE OUTPUT.       "PBO — before the screen is shown
  MODULE pbo_9000.

PROCESS AFTER INPUT.         "PAI — after a user action
  MODULE pai_9000.

PROCESS ON HELP-REQUEST.     "POH — F1 help
  FIELD dynp_field MODULE help_mod.

PROCESS ON VALUE-REQUEST.    "POV — F4 help
  FIELD dynp_field MODULE f4_mod.
```

> PAI of the current dynpro and PBO of the next dynpro run consecutively in the same work process — together they form one **dialog step**. While the screen waits for input, no work process is occupied.

## Dialog modules

- Processing blocks between `MODULE ... ENDMODULE` in the ABAP program — the procedural link between dynpro and program.
- Called from flow logic via `MODULE name.`. PBO can only call modules defined with `OUTPUT`; PAI/POH/POV can only call modules defined with `INPUT`.
- **No parameter interface, no local data area.** Data flows only through program-global variables; any `DATA` declared inside a module becomes global. For local data, call a method of a local class instead.
- Not bound to one dynpro — a module can be called from several dynpros.

```abap
"Flow Logic tab
PROCESS BEFORE OUTPUT.
  MODULE pbo_9000.
PROCESS AFTER INPUT.
  MODULE pai_9000.
```

```abap
"ABAP program
MODULE pbo_9000 OUTPUT.
  ...
ENDMODULE.

MODULE pai_9000 INPUT.
  ...
ENDMODULE.
```

## Dynpro fields and data transport

- **Dynpro fields** are the dynpro's data objects. Every screen element (except the OK field) maps to one. Types come from built-in DDIC types (except `CLNT`, `FLTP`) or from program global data objects.
- Transport requires a **program-global variable of the same name** as the dynpro field. PBO: program → screen (prefill). PAI: screen → program (automatic at the start of PAI, before modules run).
- Declare those variables in the global part:

```abap
PROGRAM some_program.
DATA some_dobj TYPE abap_bool.        "with DATA / CLASS-DATA
TABLES some_struct.                   "table work area: a flat DDIC structure;
                                      "brings labels, F1/F4 — a CDS entity cannot follow TABLES

CLASS local_class DEFINITION.
  PUBLIC SECTION.
    CLASS-DATA another_dobj TYPE i.   "public static attribute also works
ENDCLASS.
```

### Program-controlled transport with FIELD

By default all fields transport at the start of PAI. `FIELD` lets you stage transport so a module sees a field only after its `FIELD` statement:

```abap
PROCESS AFTER INPUT.
  MODULE pai_9000.        "neither field_a nor field_b available
  FIELD field_a.
  MODULE module_a.        "field_a available, field_b not
  FIELD field_b.
  MODULE module_b.        "both available
```

### Conditional module calls

```abap
FIELD dynp_field MODULE mod ON INPUT.    "call mod only if dynp_field is not empty
FIELD dynp_field MODULE mod ON REQUEST.  "call mod only if user changed/retyped the field since last PBO
```

Combine across fields with a processing chain:

```abap
CHAIN.
  FIELD dynp_field1.
  FIELD dynp_field2.
  MODULE mod ON CHAIN-INPUT.   "also: ON REQUEST
ENDCHAIN.
```

## OK field and function codes

- Every dynpro has an implicit 20-char **OK field** (not tied to a screen element; last entry on the *Element List* tab; must be named, e.g. `ok_code`).
- A control with a function code places that code in the OK field (and in `sy-ucomm`) and triggers PAI.
- **Recommended: use the OK field, not `sy-ucomm`** — you own the field, and you shouldn't mutate a system field. Store it in an auxiliary variable and clear the OK field so a stale code doesn't fire on the next PBO. Use the same OK field name on every dynpro of the program.

```abap
PROGRAM zdemo_program.
DATA: ok_code LIKE sy-ucomm,
      save_ok LIKE ok_code.

MODULE pbo_9000 OUTPUT.
  some_input_field = 'Hallo'.
ENDMODULE.

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

## Input checks

**Automatic checks** run at the start of PAI, before transport and modules. Errors show in the status bar; the field stays ready for input. E.g. fields marked `required` in the Screen Painter must be filled.

**Exit command** (function type `E`) bypasses the automatic checks — needed for *Cancel*-type actions. It routes to a special module:

```abap
MODULE mod AT EXIT-COMMAND.
```

End that module with a `LEAVE` statement; otherwise normal PAI (with the checks) resumes after it.

**Self-programmed checks** issue a warning (`W`) or error (`E`) via `MESSAGE` inside a module called with `FIELD`/`CHAIN`:

```abap
FIELD dynp_field MODULE mod.    "single field — only that field re-opens for input

CHAIN.                          "related fields — all listed fields re-open on error
  FIELD dynp_field1.
  FIELD dynp_field2.
  MODULE mod.
ENDCHAIN.
```

## Field help (F1) and input help (F4)

```abap
PROCESS ON HELP-REQUEST.        "F1
  FIELD dynp_field MODULE mod.  "no data transport; show help yourself (e.g. HELP_OBJECT_SHOW)

PROCESS ON VALUE-REQUEST.       "F4
  FIELD dynp_field MODULE mod.  "no transport; use DYNP_VALUES_READ / DYNP_VALUES_UPDATE,
                                "or F4IF_INT_TABLE_VALUE_REQUEST for a value list
```

DDIC-typed fields get F1 (data element documentation) and F4 (search helps, check tables, fixed values, calendar/clock) automatically. A **dropdown list box** restricts input to a fixed list.

## Dynpro sequence; calling and leaving

A **dynpro sequence** is shown one screen at a time in the same GUI window. The first is the **initial dynpro**. Each dynpro's next dynpro chains the flow; next dynpro 0 ends the sequence. Started by a transaction code or `CALL SCREEN`; the simplest sequence is one dynpro with next dynpro 0.

```abap
SET SCREEN 9200.        "override the next dynpro (temporary, dynamic); called when PAI ends
SET SCREEN 0.           "next dynpro 0 → terminate the sequence

CALL SCREEN 9300.       "start a NEW, nested dynpro sequence (9300 = its initial dynpro)
CALL SCREEN 9300 STARTING AT col_up_left line_up.                          "modal popup
CALL SCREEN 9300 STARTING AT col_up_left line_up ENDING AT col_up_right line_low.

LEAVE SCREEN.           "exit current dynpro now → go to the (statically or SET) next dynpro
LEAVE TO SCREEN 9200.   "short form of: SET SCREEN 9200. LEAVE SCREEN.
LEAVE TO SCREEN 0.      "end the sequence
```

Related: `CALL TRANSACTION` / `LEAVE TO TRANSACTION` start a dialog transaction; `LEAVE PROGRAM` terminates the program.

## Modifying static attributes (LOOP AT SCREEN / MODIFY SCREEN)

Override element attributes during **PBO**. The work area is of type `SCREEN`; dynpro uses `'0'`/`'1'`, not ABAP boolean:

```abap
MODULE pbo_9000 OUTPUT.
  LOOP AT SCREEN INTO DATA(gs_scr).
    IF gs_scr-name = 'SOME_INPUT_FIELD'.
      gs_scr-required = '1'.        "common components: active, input, invisible, intensified, required, group1..group4
      MODIFY SCREEN FROM gs_scr.
    ENDIF.
  ENDLOOP.
ENDMODULE.
```

## GUI status and title

The **GUI status** (Menu Painter) groups menu bar, standard toolbar, application toolbar, and function-key settings. The **GUI title** is the title-bar text. Set both, typically in PBO. Keeping them separate from the dynpro lets the layout stay constant while functions/title change.

```abap
SET PF-STATUS 'STATUS'.
SET PF-STATUS 'STATUS' EXCLUDING fcode.   "fcode: char field or itab of codes to deactivate
GET PF-STATUS gv_status EXCLUDING fcode.  "read current status / inactive codes
"sy-pfkey = current status

SET TITLEBAR 'TITLE'.
SET TITLEBAR 'TITLE' WITH text1 ... text9. "replace &1..&9 placeholders
"sy-title = current title
```

## Controls

Complex screen elements needing a `CONTROLS` statement. Two dynpro control types plus external GUI controls.

### Table controls

Display/edit tabular data. Declare in the program; loop in **both** PBO and PAI flow logic.

```abap
CONTROLS contr TYPE TABLEVIEW USING SCREEN dynnr.   "creates a structure named contr
```

```abap
PROCESS BEFORE OUTPUT.
  LOOP WITH CONTROL contr.
    MODULE mod_fill_table.       "read itab → screen
  ENDLOOP.

PROCESS AFTER INPUT.
  LOOP WITH CONTROL contr.
    MODULE mod_read_table.       "screen → itab
  ENDLOOP.
```

```abap
REFRESH CONTROL contr FROM SCREEN dynnr.   "reinitialize table control properties
```

> For tabular data, an ALV Grid control (or `CL_SALV_TABLE`) is usually more comfortable than a table control.

### Tabstrip controls

Tab pages over subscreens. Declare `CONTROLS tabstr TYPE TABSTRIP.` (only `activetab` is used). Set the active tab in PBO; call subscreens in flow logic:

```abap
"PBO dialog module
dynnr = '9400'.
tabstr-activetab = 'SOME_TAB'.
prog = sy-repid.
```

```abap
PROCESS BEFORE OUTPUT.
  CALL SUBSCREEN sub_area INCLUDING prog dynnr.   "include subscreen + run its PBO
PROCESS AFTER INPUT.
  CALL SUBSCREEN sub_area.                        "run subscreen PAI
```

### GUI controls

Modern presentation-server controls embedded in dynpros via container controls (e.g. a custom container). Driven by method calls; user actions raise ABAP Objects events.

| Class | Control |
|---|---|
| `CL_GUI_TOOLBAR` | App toolbar independent of GUI status (`ADD_BUTTON`; event `FUNCTION_SELECTED`) |
| `CL_GUI_PICTURE` | Images (BMP/JPG/GIF) via `LOAD_PICTURE_FROM_URL`; event `PICTURE_DBLCLICK` |
| `CL_GUI_HTML_VIEWER` | HTML/XML browser; special links raise `SAPEVENT` |
| `CL_GUI_TEXTEDIT` | Text editor (`FIND_AND_REPLACE`, etc.) |
| `CL_GUI_SIMPLE_TREE` | Tree control (various versions) |
| `CL_GUI_ALV_GRID` | ALV Grid — replaces classic lists, but **should not be used directly for new development**; prefer `CL_SALV_TABLE` which encapsulates it |

## Finding examples

In ADT, `Ctrl+Shift+A` and search `demo_dynpro*` for ABAP Keyword Documentation dynpro examples. The cheat-sheet executable example is `zdemo_abap_dynpro` (Standard ABAP branches of the repo).

## See also

- [../SKILL.md](../SKILL.md) — overview and the classic-UI decision (when to maintain vs. move to RAP/Fiori)
- [selection-screens.md](selection-screens.md) — selection screens and classic lists (the implicit special dynpros)
- [abap-modernization-playbook](../../abap-modernization-playbook/SKILL.md) — converting classic dialogs to RAP + Fiori
- SAP cheat sheet: https://github.com/SAP-samples/abap-cheat-sheets/blob/main/18_Dynpro.md
