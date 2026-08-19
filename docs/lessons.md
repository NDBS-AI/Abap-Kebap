# Lessons — corrections captured via /abap-learn

Every `/abap-learn` run that changes a skill appends one row here. The static rule
locks the lesson so it cannot regress; this ledger records the *decision* — what
was wrong, what is right, and on whose authority — so any rule can be re-verified
later without git archaeology.

| Date | Wrong → Correct | Root file(s) | Static rule id(s) | Source |
|---|---|---|---|---|
| 2026-06-16 | `@Semantics.systemDate.createdAt/lastChangedAt` on RAP audit fields → `@Semantics.systemDateTime.*` (systemDate.* is valid in SAP only for genuine date-only fields, not audit timestamps) | `cds-views-authoring` (SKILL.md + references/annotations-reference.md) | `audit-uses-systemDateTime-not-systemDate-createdAt`, `audit-uses-systemDateTime-not-systemDate-lastChangedAt`, `cds-annotations-ref-has-systemDateTime`, `cds-systemdate-nuance-documented` | grounded: help.sap.com — CDS `@Semantics` annotation documentation |
