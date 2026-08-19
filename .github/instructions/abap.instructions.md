---
applyTo: "**/*.abap"
---

# ABAP code rules

- Follow Clean ABAP — the full reference is `.claude/skills/abap-clean-style/SKILL.md`.
- No single-letter identifiers: loop variables, field symbols, `FOR`/`LET`/`INIT`
  helpers, and parameters get descriptive names (`VALUE(result)`,
  `FIELD-SYMBOL(<customer>)`; never `DATA(c)` or `<r>`).
- Lowercase keywords in new code; string templates `|...{ }...|` over
  `CONCATENATE`; `NEW #( )` / `VALUE #( )` over `CREATE OBJECT` / `MOVE`.
- `xsdbool( )` for boolean results, not `boolc( )`.
- Read-only loops use `ASSIGNING FIELD-SYMBOL(<...>)` or `REFERENCE INTO`,
  not work-area copies.
- Exceptions: `CX_STATIC_CHECK` for expected/recoverable, `CX_DYNAMIC_CHECK`
  for environmental, `CX_NO_CHECK` only for truly exceptional.
- ABAP Cloud: released APIs only (`.claude/skills/abap-cloud-development/SKILL.md`);
  no classic `WRITE` lists — use `if_oo_adt_classrun` `out->write`.
- SQL: no `SELECT *`; complete `WHERE` clauses; aggregate in the database;
  `FOR ALL ENTRIES` only after checking the driver table is non-empty.
- One assertion per ABAP Unit test method; `given_x_when_y_then_z` names;
  no real database access in unit tests (`cl_osql_test_environment` /
  `cl_cds_test_environment`).
