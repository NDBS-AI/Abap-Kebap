# ABAP Code Review — Manual Checklist

A walkable, copy-able checklist. Use it once per review. Mark items as `[x]` checked, `[-]` not applicable, `[!]` finding.

## Scope

- [ ] Scope stated explicitly (diff / class / package / RAP BO / CDS view set)
- [ ] Read the surrounding context (callers, base classes, parent CDS) before judging

## Correctness

- [ ] No unhandled exception path — every `RAISE` is either caught at a sensible layer or declared in the signature
- [ ] Empty `CATCH` blocks — none, or each has a comment explaining WHY
- [ ] Partial-failure path leaves the system consistent (no half-committed business object)
- [ ] `COMMIT WORK` / `ROLLBACK WORK` placed at the boundary, not in helper methods
- [ ] Locking (`ENQUEUE`) acquired and released; release on all error paths
- [ ] Number range / GUID generation is collision-safe
- [ ] No race condition on shared state (class attributes, ABAP memory, SHM)

## Clean ABAP

- [ ] Names reveal intent (no `lv_tmp`, `do_processing`)
- [ ] Every local, parameter, and field symbol matches the shipped scope+type grid (`lv_`/`ls_`/`lt_`/`lo_`, `<fv_>`/`<fs_>`/`<ft_>`, `rv_`/`rs_`/`rt_`/`ro_`) — **reject single-letter identifiers** (`<k>`, `x`, `ls_p`). RAP framework names (`keys`, `entities`, `failed`, `reported`, `mapped`, `RESULT result`) stay bare, but a loop variable or local *derived* from them still takes the grid (`LOOP AT keys ASSIGNING <fs_key>`). See [abap-clean-style/references/naming-conventions.md](../../abap-clean-style/references/naming-conventions.md) §5.
- [ ] No `CREATE OBJECT` on 7.40+
- [ ] No `CONCATENATE … INTO` for new strings
- [ ] No `CASE TYPE OF` in business logic
- [ ] No deep nested `IF` (3+ levels) — extract or guard-clause
- [ ] `LOOP … ASSIGNING <fs>` / `REFERENCE INTO ref` unless a copy is genuinely needed
- [ ] No `MESSAGE 'X' TYPE 'E'` in business class — raise typed exception
- [ ] Exception base class matches recoverability (static/dynamic/no-check)
- [ ] No magic literals (`'X'`, `'01'`, `'O'`) — constants extracted

## SQL & performance

- [ ] No `SELECT *` — explicit field list
- [ ] No `SELECT … INTO TABLE …` without a `WHERE` clause
- [ ] FOR ALL ENTRIES (FAE):
  - [ ] driver table is checked non-empty
  - [ ] `DISTINCT` or de-dup at the driver
  - [ ] selected fields include the key fields used in `FOR ALL ENTRIES` join
  - [ ] driver table size bounded or chunked
- [ ] Index awareness: `WHERE` first columns match a known index on the table
- [ ] `ORDER BY` present where order matters (DB does not guarantee order)
- [ ] No `LOOP AT … INNER JOIN`-style nested loops where a single SQL JOIN works
- [ ] No buffer bypass without reason (`BYPASSING BUFFER` flagged)
- [ ] No DML inside a long `LOOP` (collect and batch)
- [ ] Aggregation done in SQL (`SUM/COUNT/GROUP BY`) not in an ABAP `LOOP`

## OO design

- [ ] Class has one responsibility (one reason to change)
- [ ] Methods do one thing (no `AND` in name); Clean ABAP: fewer than 20 statements, optimal 3-5
- [ ] Visibility is correct (public is only the API, private is default for helpers)
- [ ] No public attributes — getters/setters or returning values
- [ ] Classes are `FINAL` unless inheritance is genuinely intended
- [ ] Constructor injection used for collaborators (not `cl_x=>get_instance( )` inside the constructor)
- [ ] Singletons justified — most don't need to be singletons
- [ ] Static state (`CLASS-DATA`) limited to truly global concerns

## Testability

- [ ] ABAP Unit test class exists (`for testing`) for new logic
- [ ] Tests use `RISK LEVEL HARMLESS` / `DURATION SHORT` unless intentionally otherwise
- [ ] Test method names follow `given_<state>_when_<action>_then_<outcome>`
- [ ] No live DB select in unit tests — `cl_osql_test_environment` or `cds_test_environment`
- [ ] No test depends on the order of another test
- [ ] Setup/teardown clean (`CLASS_SETUP`, `SETUP`, `TEARDOWN`)
- [ ] Boundary cases covered (empty input, single item, max items, error path)

## Security

- [ ] Auth checks present at the boundary (`AUTHORITY-CHECK` or RAP `@AccessControl`)
- [ ] Input validated before SQL (no unbounded user-supplied string concatenated into a `WHERE` clause — only an issue with dynamic SQL)
- [ ] No hardcoded credentials, hostnames, or RFC destinations
- [ ] Secrets not logged or returned in error messages
- [ ] No `AUTHORITY-CHECK` bypass via `sy-batch` / `sy-modno` games

## Maintainability

- [ ] Comments only explain *why*, not *what*
- [ ] No commented-out code left in
- [ ] No `TODO` without owner + ticket reference
- [ ] Public APIs have ABAP Doc (`"!`)
- [ ] Modifications to SAP-owned objects routed through a documented enhancement point (BAdI / implicit), not direct modification

## Transport & change scope

- [ ] Transport target system known and reviewed
- [ ] Cross-package dependencies declared explicitly
- [ ] No "while I'm here" unrelated changes (separate transport)
- [ ] DDIC changes flagged for dependency analysis (where-used)
- [ ] If touching released APIs: backward compatibility preserved or migration noted

## Cloud / RAP / CDS (only when applicable)

- [ ] Only released DDIC objects referenced (Steampunk)
- [ ] No native SQL (Steampunk)
- [ ] CDS view layer respected (basic / composite / consumption — no consumption-level annotation in a basic view)
- [ ] CDS associations exposed only where consumed — keep the cardinality honest
- [ ] RAP behavior implementation does not produce side effects across instances
- [ ] RAP determinations marked `on save` only when state must reach the database first; `on modify` for in-memory recompute
- [ ] RAP validations marked `on save` with clear failed-key reporting

## Verdict

- [ ] Decision recorded: Approve / Approve with comments / Request changes
- [ ] All Critical findings have a concrete fix
- [ ] Important findings are ≤ 3 *or* the developer has been pre-aligned on the broader cleanup
