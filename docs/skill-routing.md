# Skill Routing Protocol

This repository uses **cluster-first, registry-backed skill routing**. There is no fixed numeric cap on how many skills a task may load — the constraint is relevance, not a budget.

> **This repo ships as a Claude Code plugin.** A dispatched agent's working directory is the *user's own project*, not this plugin's installation directory — so every reference below to `.claude/skill-index.json`, `.claude/skill-clusters.json`, or this file must be read as `${CLAUDE_PLUGIN_ROOT}/...`, never as a bare relative path, or the read resolves against the wrong project and finds nothing.

## The three tiers

```
Tier 1 — mandatory (no decision)
    ↓
Tier 2 — cluster selection (the domain/workflow decision)
    ↓
Tier 3 — standalone additions (narrow, one-off questions)
```

### Tier 1 — mandatory, no decision involved

Skills listed in this agent's `skills:` frontmatter are already injected into context at startup. They are **not** subject to routing, relevance scoring, or any "is this needed" judgment — they are always active. Never re-load them via the `Skill` tool; never omit them because a task "doesn't seem to need" them. This tier exists precisely because the alternative — deciding every time — is the mechanism that let non-negotiable guidance (Clean ABAP naming) get silently skipped in the past.

### Tier 2 — cluster selection

Before substantive work, classify the task and compare it against the cluster descriptions in **`${CLAUDE_PLUGIN_ROOT}/.claude/skill-clusters.json`**, under this agent's own role key (`abap-kebap-developer`, `abap-kebap-architect`, or `abap-kebap-reviewer` — clusters are role-scoped because the same domain needs different skills at the design stage vs. the implementation stage vs. the review stage).

1. Read the clusters for your role.
2. For each cluster, compare its `description` (and `load_when` / `do_not_load_when` hints where present) against the task.
3. Select **every cluster that is clearly relevant** — a real task (a RAP BO, a CDS model) is a *workflow*, not a single lookup, and its skills belong together. There is no cap of 1, 3, or any other number: load every skill in every selected cluster.
4. Do not select a cluster merely because one loosely related term appears — `do_not_load_when` names the common false-positive cases.

### Tier 3 — standalone additions

After cluster selection, check **`${CLAUDE_PLUGIN_ROOT}/.claude/skill-index.json`** (name + description + path for every skill) for a narrow, specific skill not already covered by a selected cluster — e.g. a one-off question ("how does `CORRESPONDING #( )` work?") that doesn't warrant a whole cluster. Load only what materially contributes; a trivial question may need no repository skill at all.

## The governing rule

**Select the smallest semantically complete set — never the narrowest one that fits a number.** Do not omit a relevant cluster or skill to satisfy a budget. Do not load an unrelated cluster merely because it shares a technology family with the real one. "Complete" and "small" are both real constraints; neither overrides the other.

## Mechanics

- **Load** every selected `SKILL.md` via the `Skill` tool before substantive work (design / implementation / review, as this agent's role defines it).
- **Deduplicate.** Never re-load a skill already active — whether from Tier 1, an already-selected cluster, or a prior standalone pick.
- **Load references progressively.** Follow a loaded skill's own links to `references/`/`examples/` only when that depth is actually needed for the current step.
- **Re-route when scope changes.** If execution reveals a new domain or concern partway through, repeat the Tier-2/Tier-3 decision for that new concern — don't preload speculative siblings up front "just in case."
- A **no-skill** outcome is valid for trivial conversation, orchestration-only work, or a task the registry genuinely doesn't cover. Don't invent a skill to fill the slot.

## Conflict precedence

When loaded guidance disagrees:

1. System/platform safety and tool constraints.
2. The active agent's role and scope (this file's own `## Scope and limits`).
3. Repository/project-specific rules (`CLAUDE.md`, `AGENTS.md`, project-local instructions) — these can intentionally override upstream general guidance, e.g. the shipped Hungarian naming convention overriding Clean ABAP's default naming style.
4. The most specific domain skill.
5. Cross-cutting/general skills.
6. Examples and non-normative references.

If two equally specific skills conflict in a way that could affect correctness, surface the conflict instead of silently picking one.

## Maintaining the registry and clusters

`.claude/skill-index.json` is **generated** — never hand-edit it. After adding, removing, or changing any skill's frontmatter:

```bash
python scripts/generate_skill_index.py
python scripts/validate_skills.py
```

`.claude/skill-clusters.json` is **hand-maintained**. When a new skill belongs in an existing workflow, add its name to that cluster's `includes` array (role-scoped — add it once per role that needs it). `scripts/validate_skills.py` fails if a cluster names a skill that doesn't exist, or an unknown role key.
