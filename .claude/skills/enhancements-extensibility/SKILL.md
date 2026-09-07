---
name: enhancements-extensibility
description: Use when choosing how to extend standard SAP behavior — picking between classic BAdI, new BAdI, implicit enhancement, customer exit, user-exit, modification, RAP extension (virtual element / association / determination / action), or side-by-side (BTP) extension. Covers ABAP Cloud / Steampunk restrictions and provides a decision tree so you do not pick the wrong tool and pay for it at the next upgrade.
---

# Enhancements & Extensibility

## Overview

A decision-driven guide for *how* to extend or modify standard SAP behavior. There are at least six classical extension mechanisms and several modern (RAP / Cloud) ones; choosing the wrong one means painful upgrades, surprised consumers, or an extension that isn't even allowed in your system.

**Core principle:** prefer the extension type SAP intended for the extension point. Falling back to "stronger" mechanisms (modification, implicit enhancement) when a "weaker" one (BAdI, BTP extension) was provided trades short-term convenience for long-term cost.

## When to Use

- Adding custom logic to a standard SAP transaction, BAPI, or screen behavior.
- Reviewing a proposed enhancement implementation.
- Migrating modifications to enhancements before S/4HANA conversion.
- Adding custom fields/behavior to a RAP BO (key user, classic developer, or side-by-side).
- Choosing the extension technology for ABAP Cloud / Steampunk.

**When NOT to use:**
- For pure custom code that doesn't extend SAP — write Z* code with the usual structure.
- For UI-only adjustments to Fiori (CSS, layout) — that's a UI5 extension, not ABAP.

## The decision tree

See [references/decision-tree.md](references/decision-tree.md) for the long form. Summary:

```
Want to extend / modify SAP standard?
│
├── Modern stack (S/4HANA Cloud, BTP ABAP, ABAP Cloud)?
│     YES → 1. Key user extensibility (config) if it covers the need.
│              2. Developer extensibility (classic developer in cloud) for code-based.
│              3. Side-by-side (BTP, separate microservice) for heavy logic / independence.
│              4. RAP BO extension (virtual elements, associations, behavior projections).
│     NO  ↓
│
├── On-premise / classic stack?
│     ↓
│
└── Look for, in order:
    1. New BAdI (Enhancement Spot with definition) — preferred.
    2. Classic BAdI (SE19) — fine for older SAP code.
    3. Customer / User Exit (SMOD) — last resort of the "intended" mechanisms.
    4. Explicit enhancement point / section — declared by SAP, safe.
    5. Implicit enhancement (begin/end of routine) — risky; only when above absent.
    6. Modification (object key) — almost never; only when no other path exists.

For #5 and #6, document the upgrade risk and the upgrade-adjustment plan.
```

## Classical mechanisms in detail

### New BAdI (Enhancement Spot — recommended classic)

> **Terminology note:** The SAP ABAP cheat sheet (and the ABAP keyword documentation) call this the **kernel-based BAdI concept**. The term "new BAdI" is informal and common in project teams. The older mechanism available before enhancement spots (pre-ABAP 7.0, maintained via SE18/SE19 without the enhancement framework) is referred to as the **legacy classic BAdI** and is not covered here.

- SAP defines an Enhancement Spot in `SE18`.
- Spot contains one or more BAdI definitions (interfaces).
- You implement via `SE19` → New BAdI → assign your implementation class to the BAdI.
- Filter-enabled BAdIs let multiple implementations coexist (one per filter value).
- Every BAdI interface **must include the tag interface `IF_BADI_INTERFACE`** as a mandatory component interface. Declaration of variable attributes is not allowed in a BAdI interface.

When to use: any time SAP provides one. Standard, safe through upgrade, multiple-implementation-aware.

### Dynamic BAdI access

Use the `TYPE` addition of `GET BADI` when the BAdI name is not known at compile time — for example, in framework code that dispatches different BAdIs at runtime based on configuration or a parameter.

```abap
DATA lv_badi_name TYPE string VALUE 'ZBADI_MY_BADI'.  " name comes from config / parameter
DATA lo_badi_ref  TYPE REF TO cl_badi_base.           " static type MUST be CL_BADI_BASE

" Dynamic instantiation — BAdI name is resolved at runtime
GET BADI lo_badi_ref TYPE (lv_badi_name) FILTERS operator = '-'.

" Dynamic method call — method name also from a variable
DATA lv_method_name TYPE string VALUE 'CALCULATE'.
CALL BADI lo_badi_ref->(lv_method_name)
  EXPORTING num1 = 10
            num2 = 8
  RECEIVING rv_result = DATA(lv_result).
```

Rules:
- The static type of the BAdI reference variable **must be `CL_BADI_BASE`** (the superclass of all BAdI classes). A specific BAdI type ref will not compile with the `TYPE` addition.
- Filters can be supplied via `FILTERS` (same as static) or via `FILTER-TABLE` with a table of type `badi_filter_bindings` (components: `name TYPE badi_filter_name`, `value TYPE REF TO data`).
- When to use: configuration-driven dispatch, generic extension frameworks, or test utilities that exercise multiple BAdIs in a loop.

### BAdI exception handling

Both `GET BADI` and `CALL BADI` can raise catchable exceptions. Always handle these in framework or framework-adjacent code:

| Exception class | When raised |
|---|---|
| `CX_BADI_FILTER_ERROR` | Filter value errors — e.g. a required filter is not bound, the filter table is empty, or a non-existent BAdI name is specified in a dynamic `GET BADI` |
| `CX_BADI_INITIAL_REFERENCE` | Calling a method via `CALL BADI` on an initial (uninstantiated) BAdI reference variable whose static type is a single-use BAdI |
| `CX_SY_DYN_CALL_PARAM_MISSING` | Wrong or missing parameters in a dynamic `CALL BADI` statement |

```abap
TRY.
    GET BADI lo_badi_ref TYPE (lv_badi_name) FILTER-TABLE lt_filter_tab.
    CALL BADI lo_badi_ref->(lv_method_name)
      EXPORTING num1 = 10 num2 = 5
      RECEIVING rv_result = DATA(lv_res).
  CATCH cx_badi_filter_error            " bad filter / name
        cx_badi_initial_reference       " ref not bound
        cx_sy_dyn_call_param_missing    " wrong params
        INTO DATA(lo_error).
    " log / handle, e.g. lo_error->get_text( )
ENDTRY.
```

> **Note:** For multiple-use BAdIs, calling `CALL BADI` on an initial reference variable silently does nothing (no exception); for single-use BAdIs it raises `CX_BADI_INITIAL_REFERENCE`.

### Classic BAdI

- Older mechanism using `SE18` (definition) and `SE19` (implementation).
- Pre-OO; fewer features than new BAdI.
- Coexist with new BAdI infrastructure.

When to use: only when SAP gave you a classic BAdI as the extension point. Don't create new ones.

### Customer Exit (SMOD / CMOD)

- Designated function modules with `EXIT_*` names.
- You activate via `CMOD` project, fill in the include source.
- One implementation per exit per system.

When to use: legacy SAP modules (FI, MM, SD) where this is the documented extension. Don't avoid them just because they're old.

### User Exit

- Original mechanism: SAP provides empty subroutines (`USEREXIT_*`) in special includes; you fill them in.
- Per-system, no namespace conflict possible.
- Object key still in customer namespace (you don't modify SAP code).

When to use: SAP module documentation says "use user exit X" — same answer as customer exit, just older.

### Explicit Enhancement Point / Section

- SAP marks code locations with `ENHANCEMENT-POINT` (a hook) or `ENHANCEMENT-SECTION` (replace existing block) explicitly.
- You implement an enhancement implementation in your namespace.
- Survives upgrade — SAP committed to keeping the hook stable.

When to use: SAP-marked points; safe in cloud and on-prem.

### Implicit Enhancement

- Insert code at the *begin* or *end* of any SAP form, function module, method, include.
- Powerful — works almost everywhere.
- **Risky** — SAP can refactor the routine; your enhancement may end up in the wrong place or stop running at all.
- Often visible only via `Editor → Enhance` mode (Ctrl+F4 in SE38, or via ADT).

When to use: when no other mechanism exists *and* the upgrade risk is documented. Don't use just for convenience.

### Modification (last resort)

- Direct change to SAP-delivered code via object key.
- Survives until next upgrade; then SPDD/SPAU prompts you to re-apply.
- High ongoing cost.

When to use: emergency, when no alternative; and you accept upgrade-adjustment maintenance. Document the *why* in the modification's comment.

## Modern / Cloud mechanisms

### Key User Extensibility (S/4HANA / BTP)

- Config-driven extension via the Fiori app "Custom Fields and Logic" / "Custom Business Object".
- No ABAP code; rules expressed in a sandboxed scripting language (similar to JavaScript subset) or as drag-and-drop logic.
- Limited but very upgrade-safe.

When to use: simple field-level / rule-level customizations; non-technical users own them.

### Classic Developer Extensibility (S/4HANA Cloud, ABAP Cloud)

- Released APIs only (`api.sap.com`).
- Custom ABAP code in classic-developer-extensibility tenant of a cloud system.
- Same coding model as on-premise but restricted to released language elements + APIs.

When to use: code-based extensions in cloud where key user is not enough.

### Side-by-Side (BTP)

- Build a separate microservice in BTP (or another cloud) and integrate via OData / REST / events.
- Standard SAP system untouched; extension lives in a separate runtime.
- Highest independence; deployment lifecycle decoupled from S/4HANA.

When to use: heavy logic, long-running processes, language other than ABAP, or when the team owns BTP infrastructure already.

### RAP BO extension

Within RAP, several specific extension types:

- **Virtual element** — computed field exposed on a CDS projection without changing the persistence model.
  ```sql
  @ObjectModel.virtualElement: true
  @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZCL_PRICE_AT_HORIZON'
  abap.dec(16,2) PriceAtHorizon
  ```
- **Association** — additional association exposed on the projection.
- **Determination / Validation extension** — adding logic on top of standard RAP BOs (where SAP exposed it).
- **Behavior projection extension** — extending an exposed RAP service with custom actions / determinations.

These are upgrade-safe within RAP versioning rules.

## Cross-cutting rules

### Namespace

- Custom enhancements live in Z*, Y*, or registered namespace.
- Implementation class for a BAdI: e.g. `ZCL_IM_DOC_VALIDATE_PRICING` (`IM_` for implementation, by convention).
- Implicit enhancement implementation name: `Z_*` with descriptive suffix.

### Transport

- Each enhancement is a transportable object; bundle by feature, not by extension type.
- Implicit enhancements transport with the enhancement implementation, not with the modified object.
- Cross-package dependencies: declare in the implementation's package.

### Authority and side effects

- BAdI implementations run with the calling user's authority; don't bypass auth checks.
- Don't introduce hidden side effects in a BAdI — the SAP transaction commits / rolls back as a unit; your BAdI must not leave dangling state.

### Multiple implementations

- New BAdIs can have multiple implementations (filtered or unfiltered).
- Customer exits and user exits: typically one implementation per system.
- Implicit enhancements: multiple implementations possible; order is not deterministic — design assuming concurrency.

## ABAP Cloud constraints

- No modifications.
- No classical user-exits / customer-exits (those interfaces are not available in cloud).
- No explicit enhancement points in non-released code (you can only enhance released artifacts).
- Implicit enhancements not allowed (with rare exceptions).
- **Use:** Key user extensibility → classic developer extensibility → side-by-side, in that order.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Modifying SAP code when a BAdI exists | Use the BAdI; modifications cost forever |
| Implicit enhancement to "rename a variable" | If you're modifying SAP intent that deeply, modification is more honest. Usually the right answer is to step back. |
| Multiple BAdI implementations stomping each other | Use filtered BAdIs or document the order; better — split the responsibilities |
| Side-effect in BAdI implementation (DB write, MESSAGE, etc.) | BAdIs run inside a SAP LUW. Keep effects local; raise events to outside the LUW if needed |
| Using customer exit in a new development on a fresh system | Customer exit is a legacy bridge. For new code use BAdI |
| Implementing a BAdI but not reading its semantic notes (SE18 documentation) | The BAdI fires before/after some specific event; the exact timing matters for the logic |
| Implicit enhancement that ran on SP12 stopped running on SP18 | SAP refactored the routine; the enhancement is now orphaned. SPAU shows it; re-place it |
| Mixing key user customization and developer extensibility | They can collide; document which mechanism owns which behavior |
| Side-by-side extension that requires a synchronous round-trip during a high-frequency transaction | Performance disaster; cache or fire-and-forget where possible |
| In-app extension exceeding the script sandbox | Move to developer extensibility; key user isn't intended for it |

## Examples

See [examples/badi-implementation/README.md](examples/badi-implementation/README.md) for a minimal new BAdI implementation walkthrough (spot lookup, implementation class, enhancement implementation, filter values, and common mistakes).

## References

- [references/decision-tree.md](references/decision-tree.md) — full extension-mechanism decision tree
- [examples/badi-implementation/README.md](examples/badi-implementation/README.md) — minimal BAdI implementation
- **SAP Help — Enhancement Framework:** https://help.sap.com/docs/abap-platform/enhancement-framework
- **ABAP Cloud extensibility model:** https://help.sap.com/docs/abap-cloud/
- **SAP-samples extensibility repositories:** https://github.com/SAP-samples/abap-platform-rap620 (RAP620 — side-by-side extensibility with SAP BTP ABAP Environment). For ABAP Cloud developer extensibility, see the `abap-platform-rap630` citation below. For BAdI/enhancement-specific examples, see [examples/badi-implementation/README.md](examples/badi-implementation/README.md) in this skill.
- **SAP-samples/abap-platform-rap630** — ABAP Cloud developer extensibility hands-on: https://github.com/SAP-samples/abap-platform-rap630
- Linked skills: [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md), [rap-bo-modeling](../rap-bo-modeling/SKILL.md), [abap-clean-style](../abap-clean-style/SKILL.md)
