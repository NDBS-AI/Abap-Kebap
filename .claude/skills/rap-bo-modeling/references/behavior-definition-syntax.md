# RAP Behavior Definition (BDL) — Quick Reference

The grammar that lives in `.bdef` files, condensed to quick tables — the full grammar and every addition live in the deep-dive skills linked per row.

## Header clauses

| Clause | Meaning | Deep dive |
|---|---|---|
| `managed \| unmanaged \| abstract implementation in class zbp_... [unique]` | Who owns buffer + persistence: framework (managed, the default choice), your code (unmanaged, e.g. wrapping a legacy API), none (abstract, e.g. parameter hierarchies) | [rap-saves-and-numbering](../../rap-saves-and-numbering/SKILL.md) |
| `with additional save [with full data] [and cleanup]` / `with unmanaged save` | Framework saves + your `save_modified` does side work / your `save_modified` owns all persistence (no `persistent table` allowed then) | [rap-saves-and-numbering](../../rap-saves-and-numbering/SKILL.md) |
| `strict ( 1 \| 2 )` | Syntax-check strictness; `strict ( 2 )` recommended for new BOs — most checks | — |
| `with draft` | Enables draft persistence (requires `draft table`, enables draft actions) | [rap-bo-modeling](../SKILL.md) |
| `persistent table ztab` / `draft table ztab_d` | Where active / draft rows live | [rap-saves-and-numbering](../../rap-saves-and-numbering/SKILL.md) |
| `lock master` / `lock dependent by _assoc` | Root owns the exclusive lock / child inherits it through the association | — |
| `etag master <Field>` / `etag dependent by _assoc` | Optimistic locking; the etag field must change on every update (admin field or a determination) | — |
| `authorization master ( global \| instance )` / `authorization dependent by _assoc` | Where authorization is checked: BO-wide, per instance, or inherited from the parent | [abap-authorization](../../abap-authorization/SKILL.md) |
| `early numbering` / `late numbering` / `field ( numbering : managed )` | Who assigns primary keys and when: your `FOR NUMBERING` handler / your `adjust_numbers` saver method / a framework UUID | [rap-saves-and-numbering](../../rap-saves-and-numbering/SKILL.md) |
| `mapping for ztab [control zx] corresponding { ... }` | CDS element ↔ DDIC column names; powers `MAPPING FROM ENTITY` | [rap-eml](../../rap-eml/SKILL.md), [rap-saves-and-numbering](../../rap-saves-and-numbering/SKILL.md) |

BDL minor syntax: comments are CDS-style (`//` and `/* ... */`, not ABAP's `"`); keywords are case-insensitive (lowercase by convention); identifiers are case-sensitive — match the CDS names exactly; most clauses end with a semicolon.

## Behavior-part elements

| Element | Purpose | Deep dive |
|---|---|---|
| `create; update; delete;` | Enable standard CRUD — read is always implicitly enabled, there is no `read;` | [rap-actions-validations-determinations](../../rap-actions-validations-determinations/SKILL.md) |
| `field ( readonly \| mandatory \| suppress [ : create \| : update ] ) f;` | Static field control; `field ( mandatory : create, readonly : update )` is the external-numbering key idiom | [rap-actions-validations-determinations](../../rap-actions-validations-determinations/SKILL.md) |
| `association _Item { create; [with draft;] }` | Enable create-by-association for child entities | [rap-actions-validations-determinations](../../rap-actions-validations-determinations/SKILL.md) |
| `action a [parameter P] [result [1] $self];` (+ `static`, `factory`, `internal`, `repeatable`, `save( ... )`) | Consumer-triggered state change beyond CRUD; factory actions create instances (cardinality after the name, no `result`) | [rap-actions-validations-determinations](../../rap-actions-validations-determinations/SKILL.md) |
| `function f result [1] $self;` | Read-only cousin of an action; `result` is mandatory | [rap-actions-validations-determinations](../../rap-actions-validations-determinations/SKILL.md) |
| `validation v on save { create; field F; }` | Reject inconsistent data at save time (only `on save` exists); a failure blocks the whole save | [rap-actions-validations-determinations](../../rap-actions-validations-determinations/SKILL.md) |
| `determination d on modify \| on save { ... }` | Compute or default fields when triggers fire — `on modify` is visible before save, `on save` runs in `finalize` | [rap-actions-validations-determinations](../../rap-actions-validations-determinations/SKILL.md) |
| `determine action da { determination d; validation v; }` | Run assigned on-save determinations + validations on request; executed like any action via EML `EXECUTE` | [rap-actions-validations-determinations](../../rap-actions-validations-determinations/SKILL.md) |
| `( features : instance \| global )` on fields, operations, actions | Dynamic feature control — enable/disable per instance state or BO-wide | [rap-actions-validations-determinations](../../rap-actions-validations-determinations/SKILL.md) |
| `( precheck )` on operations and actions | Filter bad input before it reaches the buffer; failed rows are dropped, the rest proceeds | [rap-actions-validations-determinations](../../rap-actions-validations-determinations/SKILL.md) |
| `side effects { field a affects field b; ... }` | Declare UI reload dependencies — no ABAP needed | [rap-business-events-side-effects](../../rap-business-events-side-effects/SKILL.md) |
| `event e [parameter P \| deep parameter P \| for side effects];` (+ `managed event`) | RAP business events for asynchronous consumers | [rap-business-events-side-effects](../../rap-business-events-side-effects/SKILL.md) |
| Projection BDEF: `projection; ... use create; use action a; ...` | Only `use`d operations/actions/functions/events surface in the service; validations and determinations are never `use`d — they always run in the base BO; `internal` elements cannot surface | [rap-actions-validations-determinations](../../rap-actions-validations-determinations/SKILL.md) |

## Standard draft actions

With `with draft`, expose the framework-implemented lifecycle set:

- `draft action Edit;` — copy the active instance into an edit draft.
- `draft action Activate optimized;` — persist the draft as the active instance; `optimized` skips re-running checks on unchanged data (preferred for managed BOs).
- `draft action Discard;` — throw the draft away.
- `draft action Resume;` — pick up an interrupted draft (e.g. after the exclusive lock expired).
- `draft determine action Prepare { ... }` — run assigned on-save determinations/validations while editing; `Activate` runs it implicitly.

Draft actions optionally take `with additional implementation` — you then also implement a `FOR MODIFY ... FOR ACTION` method that runs in addition to the framework logic.

## Deep dives

- Full behavior grammar (every action/validation/determination/feature/precheck addition): [rap-actions-validations-determinations/references/bdef-behavior-grammar.md](../../rap-actions-validations-determinations/references/bdef-behavior-grammar.md)
- Matching handler signatures (`METHODS ... FOR ...`): [rap-actions-validations-determinations/references/handler-signatures.md](../../rap-actions-validations-determinations/references/handler-signatures.md)
- Save variants, save sequence, numbering matrix: [rap-saves-and-numbering](../../rap-saves-and-numbering/SKILL.md)
- Side effects and business events grammar: [rap-business-events-side-effects](../../rap-business-events-side-effects/SKILL.md)
- Scaffolding the whole BO (header example with commentary): [rap-bo-modeling](../SKILL.md)
