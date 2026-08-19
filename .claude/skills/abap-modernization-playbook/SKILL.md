---
name: abap-modernization-playbook
description: Use when deciding whether to modernize a piece of legacy ABAP — converting FORM/PERFORM to a method, MACRO to a method, classical DB SELECT to a CDS view, function module to a class, classic ALV to RAP/Fiori, modification to BAdI/enhancement, or migrating to ABAP Cloud / Steampunk. Includes "do not touch" signals so you don't break working code for the sake of style.
---

# ABAP Modernization Playbook

## Overview

A decision-driven playbook for converting legacy ABAP into modern equivalents. Modernization is not "make every old thing match Clean ABAP." It is: **the right transformation at the right time for the right reason**. A perfectly working report should not be modernized just because someone wants to remove `PERFORM`; a critical bug-fix path should not be modernized at the same time as the fix.

**Core principle:** every modernization is a *risk transaction*. You pay risk (test surface, ABI change, transport coordination, possible regression) for benefit (testability, maintainability, performance, cloud readiness). Modernize only when the benefit is concrete and the risk is acceptable.

## When to Use

- You are touching legacy ABAP for a feature, fix, or migration and wondering "should I clean this up while I'm here?"
- You are scoping a sprint that includes "refactor X to OO" and need a sober estimate.
- You are planning S/4HANA conversion or ABAP Cloud migration.
- Someone has asked for a "Clean ABAP refactor" of a working subsystem and you want to scope it honestly.

**When NOT to use:**
- For greenfield code — there is nothing to modernize, just write Clean ABAP from the start.
- For purely stylistic tweaks — that's Clean ABAP, use [abap-clean-style](../abap-clean-style/SKILL.md).
- When you're deep in a bug fix and tempted to "while I'm here" — finish the bug fix as a minimum invasive change, file the modernization as a follow-up.

## The Decision Tree

See [references/decision-tree.md](references/decision-tree.md) for the full chart. Summary:

```
Should I modernize THIS code RIGHT NOW?
│
├── Is it actively producing wrong results / hard outages?
│     YES → Fix the bug first; modernization is a separate TR. Skip below.
│     NO  ↓
│
├── Will someone touch this code again in the next 6 months?
│     NO  → Leave it. Risk > benefit.
│     YES ↓
│
├── Is there test coverage (ABAP Unit, integration)?
│     NO  → Add minimal characterization tests FIRST, then proceed.
│     YES ↓
│
├── Is the public API exposed across packages, RFC, ODP, BAPI?
│     YES → Plan a deprecation-then-replace strategy; do not break the API in this TR.
│     NO  ↓
│
├── Will the modernized form genuinely be easier to read / extend / test?
│     NO  → Stop. "Modernized" is not a goal in itself.
│     YES ↓
│
├── Is there a target deadline (e.g. SP upgrade, S/4 conversion)?
│     YES → Sequence transports to land before the deadline; communicate dependencies.
│     NO  → Proceed at sustainable pace; one transformation per TR.
```

## "Do not touch" signals

Strong reasons to *leave existing code alone*:

| Signal | Why |
|---|---|
| No test coverage and nobody understands the original behavior | Any change is a roulette spin |
| Code is exposed via RFC, BAPI, ODP, OData and other systems depend on the signature | Refactor breaks consumers |
| The author is gone and the customizing setup is unique to one customer | Reverse-engineering > free; high risk |
| Modification of SAP-owned code (object key change) | Upgrade-day pain; route via BAdI / enhancement instead |
| Production hotfix in progress on the same file | Wait. Modernization will collide with the cherry-pick |
| Performance-critical, time-budgeted (sub-second loops) | "Modern" constructs sometimes have measurable overhead — profile first |
| The code is generated (e.g. from BRFplus, Form Builder, smartform) | Don't modernize generated artifacts; modernize the generator if anything |

If you see two of these signals, default to "don't touch" unless the modernization is a hard requirement (e.g. ABAP Cloud migration).

## Common transformations

### 1. `FORM` / `PERFORM` → method

**Why:** PERFORM has no encapsulation, no testability, no real visibility control. Method does.

**When safe:**
- The form's parameters are clear (`USING`, `CHANGING`, `TABLES`).
- Callers are inside the same compilation unit (no external `PERFORM … IN PROGRAM`).
- No `PERFORM` from external systems via RFC (rare but possible in classic batch input).

**Transformation:**
```abap
" Before
FORM calculate_total USING p_inv TYPE invoice
                     CHANGING p_total TYPE decfloat34.
  p_total = p_inv-amount + p_inv-tax.
ENDFORM.

" call site
PERFORM calculate_total USING ls_inv CHANGING lv_total.

" After
CLASS lcl_invoice_calc DEFINITION.
  PUBLIC SECTION.
    METHODS calculate_total
      IMPORTING invoice       TYPE invoice
      RETURNING VALUE(result) TYPE decfloat34.
ENDCLASS.

CLASS lcl_invoice_calc IMPLEMENTATION.
  METHOD calculate_total.
    result = invoice-amount + invoice-tax.
  ENDMETHOD.
ENDCLASS.

" call site
DATA(calc) = NEW lcl_invoice_calc( ).
DATA(total) = calc->calculate_total( ls_inv ).
```

**Don't:**
- Convert `PERFORM` that uses program-global state without first extracting that state.
- Move PERFORMs into a new class while leaving the rest of the report procedural — partial extraction is its own debt.

### 2. `MACRO` → method (or constant)

Macros have no scope, no debugger support, no IDE awareness. **Avoid writing *new* macros.** For existing/legacy macros: assess against the risk criteria in [references/decision-tree.md](references/decision-tree.md) before converting — a working macro with no active bugs may not be worth the modernization risk.

```abap
" Before
DEFINE add_log_line.
  APPEND VALUE #( msg = &1 severity = &2 ) TO log_lines.
END-OF-DEFINITION.

add_log_line 'Started' 'I'.
add_log_line 'Done' 'I'.

" After
METHODS add_log_line
  IMPORTING msg TYPE string severity TYPE log_severity.

METHOD add_log_line.
  APPEND VALUE #( msg = msg severity = severity ) TO log_lines.
ENDMETHOD.

add_log_line( msg = 'Started' severity = 'I' ).
```

### 3. Procedural DB SELECT → CDS view (when appropriate)

**Why:** CDS pushes joins and aggregations to the DB; can be exposed via OData / RAP; reusable.

**When safe:**
- The SELECT is read-only (CDS is read-only).
- It maps cleanly to entities (rows of one logical thing).
- The fields are deterministic (not driven by runtime parameters in a way CDS can't express — though CDS views with parameters or table functions handle most cases).

**Don't:**
- Convert a single one-shot SELECT used in one place — overhead exceeds benefit.
- Convert a SELECT that uses ABAP-side dynamic WHERE that CDS can't represent.
- Convert a SELECT whose business logic between the SELECT and the consumer is non-trivial — extract the logic before extracting the SELECT.

### 4. Function module → class

**Why:** Function modules have weak typing (no `RETURNING`), no constructor injection, no inheritance. Classes have all of these.

**When safe:**
- FM is internal (not consumed by RFC or by released APIs of another product).
- Caller code is changeable in the same TR.

**Strategy:**
- For internal-only FMs: extract a class, deprecate the FM by replacing its body with a delegating call to the new class, plan removal in a future release.
- For RFC-exposed FMs: keep the FM signature as the public API; refactor the *body* to call a class.

### 5. Classic ALV report → RAP + Fiori

Large jump. Usually scoped as its own project, not a "while I'm here" task.

**When justified:**
- The report is owned, frequently changed, and increasingly painful to extend.
- There's a strategic move to Fiori for end-user UX.
- The data behind it is suitable for a RAP BO (an entity with a clear identity).

**When NOT justified:**
- One-off operational reports for a single admin.
- Reports against legacy DB structures where modeling a RAP BO would distort the domain.

See [rap-bo-modeling](../rap-bo-modeling/SKILL.md) for the target architecture.

### 6. SE38 modification → enhancement / BAdI

**Why:** Modifications are upgrade-dangerous; enhancements/BAdIs survive upgrades.

**When safe:** Almost always, unless the modification is intentional and you accept upgrade adjustment.

See [enhancements-extensibility](../enhancements-extensibility/SKILL.md) for the decision tree on which enhancement to use.

### 7. Migration to ABAP Cloud / Steampunk

The largest modernization. Constraints:

- No native SQL, no MODIFY on SAP-owned tables, only released DDIC.
- Only released APIs (`api.sap.com`).
- No classical dynpro (`DIALOG`, screens). Frontend is Fiori via RAP / OData.
- No SAP GUI artifacts (SmartForms, classical ALV) — replaced by Forms Service for Adobe, RAP-Fiori.
- Custom DDIC must be cloud-released.

Approach:
1. **Inventory.** Use ATC with the `ABAP_CLOUD_READINESS` check variant to find non-cloud-ready code.
2. **Categorize.** Per finding: (a) released alternative exists → swap; (b) released alternative pending → wait or work around; (c) no path → escalate.
3. **Prioritize.** Frontline business logic before utilities; APIs that other systems consume before internal helpers.
4. **Refactor in dev cloud system.** Don't backport cloud-only patterns to on-prem without reason — keep the bridge minimal.

The full cloud migration playbook exceeds this skill; see SAP's official guide and [SAP-samples/cloud-abap-rap](https://github.com/SAP-samples/cloud-abap-rap) for reference scenarios.

## Sequencing transports

Each modernization is one transport (or a small sequenced family). Mixing modernization with a feature change makes the diff illegible.

- **TR n:** Bug fix (no style changes).
- **TR n+1:** Test coverage for the area (characterization tests).
- **TR n+2:** Modernization step 1 (e.g. PERFORM → method).
- **TR n+3:** Modernization step 2 (e.g. extract class).

Each TR independently transportable to QA and verifiable.

## Examples

See [examples/transformations.md](examples/transformations.md) for before/after pairs:
- PERFORM/FORM → method extraction
- Procedural DB SELECT → CDS view + consumption
- MACRO → method

## Common Mistakes

| Mistake | Cost | Fix |
|---|---|---|
| Modernize during a bug fix | Long TR, hard review, regression risk on top of fix | One concern per TR |
| Modernize without tests | Latent regressions surface in production | Add characterization tests *first* |
| Modernize without consumer audit | Break callers in other packages | Where-used; coordinate transports |
| "Full rewrite" instead of incremental | Six months of no value before value lands | Strangler pattern: new code in classes, old code calls into new |
| Replace working SQL with CDS for "modernization" | Performance regression if CDS view fan-out is unexpected | Compare ST05 trace before / after; reject if slower |
| Convert MACRO to method without checking shared state | Different semantics if the macro referenced caller locals via name | Read the macro body line by line, confirm all references |
| Remove `PERFORM … IN PROGRAM` without checking all programs | Run-time dump | Where-used across all programs in the system |
| ABAP Cloud migration without ATC variant audit | Discover non-cloud-ready code mid-migration | Run the `ABAP_CLOUD_READINESS` ATC variant first; plan from findings |
| Extracting classes too small ("class per method") | Cognitive overhead exceeds the benefit | Group methods that operate on the same data |
| Skipping the "do not touch" signals | Spent time on something that didn't need touching | Apply the table at the top of this skill before estimating |

## References

- [references/decision-tree.md](references/decision-tree.md) — full "should I modernize" decision tree
- [examples/transformations.md](examples/transformations.md) — before/after pairs for common transformations
- **Clean ABAP:** https://github.com/SAP/styleguides/blob/main/clean-abap/CleanABAP.md
- **ABAP Cloud development guide:** https://help.sap.com/docs/abap-cloud/
- **SAP-samples/cloud-abap-rap** — cloud-ready scenarios: https://github.com/SAP-samples/cloud-abap-rap
- **SAP-samples/abap-platform-refscen-flight** — Flight Reference Scenario showing modernization end-to-end (multiple release branches available): https://github.com/SAP-samples/abap-platform-refscen-flight
- Linked skills: [abap-clean-style](../abap-clean-style/SKILL.md), [abap-code-review](../abap-code-review/SKILL.md), [cds-views-authoring](../cds-views-authoring/SKILL.md), [rap-bo-modeling](../rap-bo-modeling/SKILL.md), [enhancements-extensibility](../enhancements-extensibility/SKILL.md), [abap-unit-tdd](../abap-unit-tdd/SKILL.md)
