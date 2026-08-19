---
name: abap-code-review
description: Use when reviewing ABAP code — a diff, a class, a function group, an enhancement, or a CDS view. Produces a disciplined, severity-scored review (Critical / Important / Nit) with file:line citations, confidence threshold, and one concrete fix per finding. Pulls in clean-style, sql-performance, oo-patterns, and modernization skills as the code under review demands.
---

# ABAP Code Review

## Overview

A repeatable review process for ABAP. The goal is **high-signal findings** — every issue you report should be defensible (cite a rule, an SAP Note, or a measurable cost) and actionable (a one-line fix). The output is sorted by severity, capped by confidence, and grouped so the developer fixing it can work top-to-bottom.

**Core principle:** quality is the number of *real* findings the developer accepts, not the count of findings you wrote. Reject your own borderline observations before sending. A 5-finding review where 5 land is more useful than a 30-finding review where 6 land and 24 generate pushback.

## When to Use

- Reviewing a pull request, transport, or diff in development.
- Pre-release audit of a custom Z* package, BAdI implementation, RAP BO, or CDS view set.
- Onboarding to an unfamiliar codebase — produce a review-style map of issues to prioritize.
- After running ATC: cross-checking ATC findings with judgment-driven review (ATC catches the mechanical; humans catch design).

**When NOT to use:**
- For "just explain this code to me" — that's a read, not a review. Skip the scoring overhead.
- For "what is the right architecture for X" — that's a design question, use [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md) or domain skills.

## Process

### 0. Automated checks first — gate before peer review

Before a human reviewer reads a single line, automated checks should be clean. This is not a nice-to-have; it is the correct sequencing. Machines are cheaper than humans at catching mechanical issues (unused variables, naming violations, syntax warnings, unreachable code).

- **ATC** (ABAP Test Cockpit) — run with the project's check variant. No high/very-high findings should reach peer review.
- **abaplint / code-pal-for-abap** — if configured in CI, a failed pipeline is the gate, not a reviewer.
- **Pretty-printer** — code formatting (indentation, line length ≤120 chars) should be normalized before review; large formatting diffs obscure real changes.

If ATC findings exist: the author fixes them first, then requests review. Do not review code that hasn't passed its automated gate.

**Review velocity:** Code reviews block other developers. The rule of thumb for the maximum delay from review request to first response is **one day** (SAP ABAPCodeReview guide §3.2). Balance your own work against blocking a colleague's transport.

**Higher scrutiny for:** DDIC changes, security-relevant objects (authorization checks, encryption, RFC destinations), public API changes (CDS with `@AccessControl`, RAP BO with released BDEF, released classes), and cross-package boundary changes. These warrant an additional reviewer or an explicit sign-off from the component owner.

### 1. Establish scope

Before reading, decide what you are reviewing and **why**.

| Scope | Look at | Read order |
|---|---|---|
| Diff (e.g. transport delta, PR) | Changed lines + 30 lines context above/below; called methods if changed | Diff first, then the surrounding class for context |
| Whole class | The class as a unit | Public section → constructor → public methods → private helpers → local types |
| Function group | All function modules, then the global include | Global include first (state), then each FM |
| CDS view set | Lowest layer (basic) up to consumption | `Z_I_*` → `Z_C_*` → `Z_P_*`. Plus the DCL and the BDEF if RAP |
| RAP BO | Behavior + projection + behavior implementation | BDEF → impl class → projection BDEF → service binding |

Write down the scope in the first line of the review output. It anchors the rest.

### 2. Pass 1 — Read for understanding

Read the code *without scoring*. Build a mental model:
- What does this code do (in one sentence)?
- What are its inputs and outputs?
- What are its side effects (DB writes, MESSAGE, RFC calls, transport-relevant ops)?
- What is the change boundary — what does the existing API guarantee that the change must preserve?

Many bad reviews start with "this method is too long" before the reviewer understood what the method is for. Avoid that.

### 3. Pass 2 — Score findings

Now go through and collect candidate findings. For each, assign:

**Confidence (0–100):**

| Score | Meaning |
|---|---|
| 0 | Not a real issue. Discard. |
| 25 | *Might* be an issue. Not enough to report unless the cost is high. |
| 50 | Real issue but a nit or rare in practice. Report only if budget allows. |
| 75 | Real, will hit in practice, directly cited rule or measured cost. |
| 100 | Certain bug or certain Clean ABAP / SAP Note violation. |

**Only report findings with confidence ≥ 80.** Borderline observations dilute the review.

**Severity:**

| Severity | Definition |
|---|---|
| Critical | Causes wrong results, data loss, dump, security issue, or breaks an existing consumer's contract |
| Important | Significant performance, maintenance, or readability cost; or directly violates Clean ABAP / project standard |
| Nit | Minor readability or convention nit — worth fixing but not blocking |

Use the rule below to settle ambiguous cases:
- *If wrong, does it produce wrong data or a dump?* → Critical
- *If wrong, would it surface in production within a quarter?* → Important
- *If wrong, would only another reviewer notice?* → Nit

### 4. Run the checklist

For every review, walk through the bullets below. Each maps to a deeper skill — load it on demand.

| Check | Skill | What to look for |
|---|---|---|
| Naming + style | [abap-clean-style](../abap-clean-style/SKILL.md) | Hungarian leakage, `CREATE OBJECT`, `CASE TYPE OF` in business logic, magic literals, `MESSAGE 'X' TYPE 'E'` in business code |
| SQL hygiene | [abap-sql-performance](../abap-sql-performance/SKILL.md) | `SELECT *`, `SELECT … INTO TABLE` without `WHERE`, FAE without empty-check, FAE without DISTINCT, JOIN abuse, missing `ORDER BY` on top-N reads |
| OO design | [abap-oo-patterns](../abap-oo-patterns/SKILL.md) | God classes (> ~500 LOC), public attributes, switch-on-type, public mutators that should be commands, missing `FINAL`, exception type mismatched to recoverability |
| Error handling | [abap-clean-style](../abap-clean-style/SKILL.md#errors) | Empty `CATCH`, wrong exception base, `RAISE` with no `previous`, swallowed `cx_root`, `MESSAGE` instead of `RAISE` |
| Testability | [abap-unit-tdd](../abap-unit-tdd/SKILL.md) | No test class, tests that hit live DB, tests with sequential dependencies, missing `DURATION SHORT` / `RISK LEVEL HARMLESS` |
| Modernization opportunity | [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md) | FORM/PERFORM where method works, MACRO, manual DB access where CDS exists, classic ALV where RAP-Fiori would fit. Note as opportunity, *not* as blocker unless contractually required |
| Extensibility | [enhancements-extensibility](../enhancements-extensibility/SKILL.md) | Implicit enhancement modifying an SAP public form's behavior, user-exit when a BAdI exists, BAdI implementation with side effects on cross-instance state |
| Internal table use | [abap-internal-tables](../abap-internal-tables/SKILL.md) | Wrong table kind for the access pattern, `READ … INTO wa` not modified, re-sorting before binary search, nested loops where a hashed/sorted key fits |
| Transactional correctness | [abap-sap-luw](../abap-sap-luw/SKILL.md) | `COMMIT WORK` in a helper method, missing lock, lock not released on error path, DB write outside the update task, partial-failure inconsistency |
| Authorization / security | [abap-authorization](../abap-authorization/SKILL.md) | Missing `AUTHORITY-CHECK`, check after the operation, `sy-subrc` not evaluated, missing `ACTVT`, hardcoded credentials, auth bypass |
| Dynamic code | [abap-dynamic-programming](../abap-dynamic-programming/SKILL.md) | Unnecessary dynamic where static works, unvalidated dynamic SQL/WHERE (injection), lost type safety, RTTI without guards |
| Strings | [abap-strings-regex](../abap-strings-regex/SKILL.md) | `CONCATENATE` for new code, deprecated POSIX regex instead of PCRE, building messages by string concat instead of templates |
| ABAP Cloud compatibility (Steampunk targets only) | [abap-cloud-development](../abap-cloud-development/SKILL.md) | Use of unreleased DDIC, native SQL/`EXEC SQL`, classic dynpro, MODIFY on SAP-owned table, non-released class/FM/BAPI — see its forbidden-vs-allowed table |

See [references/review-checklist.md](references/review-checklist.md) for a step-by-step manual checklist you can copy into a transport note.

### 5. Write the report

Use this exact structure. The developer scrolls top-to-bottom; the most important fixes come first.

```
# Code review: <scope>

## Critical
- **path/to/object.clas.abap:42** — `SELECT * FROM kna1 WHERE kunnr = lv_kunnr` inside a `LOOP` over invoices.
  Causes N+1 SELECTs; with 5000 rows this trace took 6.4s in dev. Move to a single FAE before the loop, with the empty-check and DISTINCT. See [abap-sql-performance](../abap-sql-performance/SKILL.md#fae).

## Important
- **…/zcl_pricing.clas.abap:178** — exception `cx_pricing_input_missing` is declared as `CX_DYNAMIC_CHECK`. Callers must handle it (validation error). Should be `CX_STATIC_CHECK`. Clean ABAP §errors.
- **…/zcl_pricing.clas.abap:212** — method `do_processing` does three things (validate, compute, persist). Extract to `validate`, `compute`, `persist`. Clean ABAP §methods.

## Nit
- **…/zcl_pricing.clas.abap:55** — `CREATE OBJECT lo_strategy …` — `NEW #( … )` reads cleaner.

## Looks good
- New `cl_overdue_invoice_finder` is a clean responsibility extraction from `cl_invoice_processor`.

## Confidence & gaps
Confidence: high on Critical and Important; Nit findings are stylistic.
Not checked: behavior tests (BO is unmanaged; suggest a unit test for the determination, see abap-unit-tdd).
```

### 6. Sign off

End with one of three states:
- **Approve** — no Critical, no Important, only Nits.
- **Approve with comments** — no Critical, ≤ 3 Important, all have a concrete fix.
- **Request changes** — any Critical, or > 3 Important.

State it explicitly. Reviewers who leave the verdict implicit add a turn to the conversation.

## Common Mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Scoring every observation | 30-line review, developer pushes back on most | Cap at confidence ≥ 80. If unsure, drop. |
| No fix proposed | "This is bad. Fix it." | Always end the finding with one concrete sentence: "Replace with X" |
| Scope drift | Reviewing the diff but commenting on the whole file | Re-read step 1. State the scope. Stay in it. |
| Style war | Three Nits about prefixes, none about the real bug | Critical/Important first. If style dominates, the review is mis-prioritized. |
| Missing the *why* on a finding | "Use NEW #" without saying it is Clean ABAP §objects | Always cite: Clean ABAP section, SAP Note, measurable cost |
| Reviewing only what changed | Misses bug in the unchanged code the changes now expose | Read the surrounding 30 lines (especially callers) |
| Reviewing without running the code mentally | Misses the fact that the change leaves the system in an inconsistent state on partial failure | Trace the failure paths — what happens if step 3 of 5 dumps? |
| Bundling unrelated topics | "Also rename this 50 other things" | Keep scope tight. Out-of-scope nits go in a follow-up TR. |

## References

- **Clean ABAP:** https://github.com/SAP/styleguides/blob/main/clean-abap/CleanABAP.md
- **ABAP Test Cockpit (ATC):** https://help.sap.com/docs/btp/sap-abap-development-tools-user-guide/abap-test-cockpit
- **Code Pal for ABAP** (extra ATC checks): https://github.com/SAP/code-pal-for-abap
- **SAP-samples/abap-cheat-sheets** — examples to point to when a Clean ABAP rule is contested: https://github.com/SAP-samples/abap-cheat-sheets
- Local: [references/review-checklist.md](references/review-checklist.md)
- Linked skills: [abap-clean-style](../abap-clean-style/SKILL.md), [abap-sql-performance](../abap-sql-performance/SKILL.md), [abap-oo-patterns](../abap-oo-patterns/SKILL.md), [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md), [abap-unit-tdd](../abap-unit-tdd/SKILL.md), [enhancements-extensibility](../enhancements-extensibility/SKILL.md)
