---
applyTo: "**/*.ddls,**/*.dcls,**/*.ddlx,**/*.bdef"
---

# CDS / RAP artifact rules

- Audit timestamps use `@Semantics.systemDateTime.createdAt` /
  `@Semantics.systemDateTime.lastChangedAt`; `@Semantics.systemDate.*` is
  reserved for genuine date-only fields.
- RAP UI projections declare `provider contract transactional_query`.
- `@AccessControl.authorizationCheck: #CHECK` requires a matching DCL role —
  without one, all reads correctly return zero rows.
- Association cardinality is a semantic contract: declare `[1..1]` only when
  the target row always exists; wrong cardinality breaks OData navigation
  and null-handling downstream.
- Pair every amount/quantity element with `@Semantics.amount.currencyCode` /
  `@Semantics.quantity.unitOfMeasure`.
- New behavior definitions use `strict ( 2 )`.
- Never `COMMIT ENTITIES` / `COMMIT WORK` inside a handler or saver — it dumps
  with `BEHAVIOR_ILLEGAL_STMT_IN_CALL`.
- Deep references: `.claude/skills/cds-views-authoring/`,
  `.claude/skills/rap-bo-modeling/`, and their sibling RAP/CDS skills.
