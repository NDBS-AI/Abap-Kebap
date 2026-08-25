# ABAP Agent Team — instructions for AI agents

This repository is an SAP ABAP agent team: 36 deep skills under `.claude/skills/`
(Agent Skills standard — load the matching `SKILL.md` before writing or reviewing
ABAP; each skill's `references/` and `examples/` hold the depth) and 3 role agents.
All content is grounded in public SAP sources only.

## Non-negotiables when writing ABAP

- **Clean ABAP first.** Read `.claude/skills/abap-clean-style/SKILL.md` before
  generating any ABAP — including test classes and snippets inside explanations.
- **No single-letter identifiers** — loop variables, field symbols, `FOR`
  iteration variables, `LET`/`INIT` helpers, and parameters all get descriptive
  names (`VALUE(result)`, `FIELD-SYMBOL(<customer>)`, never `DATA(c)`).
- Lowercase keywords; string templates `|...{ }...|` over `CONCATENATE`;
  `NEW #( )` / `VALUE #( )` over `CREATE OBJECT` / `MOVE`; `xsdbool( )` over
  `boolc( )`; `ASSIGNING FIELD-SYMBOL` or `REFERENCE INTO` over work-area
  copies in read-only loops.
- **ABAP Cloud:** released APIs only — check
  `.claude/skills/abap-cloud-development/SKILL.md`. No classic `WRITE` lists
  (use `if_oo_adt_classrun` `out->write`).
- **RAP audit fields** use `@Semantics.systemDateTime.createdAt` /
  `lastChangedAt` — `@Semantics.systemDate.*` is only for genuine date-only fields.
- Never `COMMIT ENTITIES` / `COMMIT WORK` inside a RAP handler or saver
  (runtime error `BEHAVIOR_ILLEGAL_STMT_IN_CALL`).
- SQL: no `SELECT *`; push aggregation to the database; `FOR ALL ENTRIES`
  only after a non-empty driver-table check.

## Repo gates — run before claiming any change done

```
python scripts/validate_skills.py
node evals/run-static.mjs
```

Both must exit 0. Skill frontmatter rules: quoted `description` scalar,
starts with "Use when", ≤ 1024 chars, ≥ 50 words; no single-letter
identifiers anywhere in skill content or examples.

## Development process

Five gates, in order: (1) design presented and approved before code,
(2) plan before multi-step work, (3) failing ABAP Unit test before the
implementation, (4) evidence-based verification before claiming done,
(5) independent review before merge. Roles: architect designs, developer
implements and writes the failing ABAP Unit test first, reviewer
independently checks Clean ABAP, security, and performance.
Details: `docs/agent-orchestration.md`, `CLAUDE.md`.

## Layout

- `.claude/skills/<name>/` — the 36 skills (single source of truth)
- `.claude/agents/` — role agents (`abap-kebap-architect`,
  `abap-kebap-developer`, `abap-kebap-reviewer`); single source, read natively
  by both Claude Code and VS Code Copilot (no `.github/agents` mirror)
- `.claude-plugin/` — Claude Code plugin + marketplace manifests (plugin name: `abap-kebap`)
- `evals/`, `scripts/` — the free verification gates
- `docs/lessons.md` — corrections captured via `/abap-learn`, each locked by a static rule
