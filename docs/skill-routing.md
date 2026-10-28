# Skill Routing Protocol

Agents load skills **themselves**. Nobody invokes a skill by hand, and GitHub Copilot has no `Skill` tool and preloads nothing, so each agent carries a trigger table, generated from the routing data, that says which skills to load for which kind of task and how. There is no fixed cap on how many skills a task may load: the constraint is relevance, not a budget.

> **Paths.** Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}` (the plugin's install directory) in agent files; GitHub Copilot does not. In Copilot the agent finds a skill through the `<file>` path listed for it in its skills list. Either way, never read a bare relative path: a dispatched agent's working directory is the user's own project, not this plugin.

## How skills get loaded

| | Claude Code | GitHub Copilot (VS Code) |
|---|---|---|
| Tier-1 skills (the agent's `skills:` frontmatter) | injected at start | **not** injected: the agent reads them, as the table's lead-in says (`preload_cues`) |
| Any other skill | the `Skill` tool | `read_file` on the `<file>` path from the skills list, at least the first 150 lines, **before the first edit** |
| Routing aid | the generated table, plus `skill-index.json` for the rest | the generated table, plus the skills-list descriptions for the rest |

Measured in real Copilot chats before this design existed: skills were opened 7 times in about 1,580 model rounds, and the RAP, EML and LUW skills never. The cluster file was read once, and the agent concluded "I have enough grounding". An instruction that works only through the `Skill` tool, or that asks the agent to read and interpret a 12,000-character JSON file, is not followed in Copilot.

## The tiers

### Tier 1 — always, no decision

Skills in an agent's `skills:` frontmatter are not subject to relevance scoring. Claude Code preloads them; in Copilot the agent reads each one at the moment its cue says (`preload_cues` in `.claude/skill-clusters.json`: for example `abap-clean-style` before it generates or changes any ABAP). Never skip one because a task "doesn't seem to need" it.

### Tier 2 — the generated table

Each agent's *Skill routing* section holds a table between the markers `<!-- BEGIN generated skill triggers -->` and `<!-- END generated skill triggers -->`. `scripts/build_agent_routing.py` writes it from `.claude/skill-clusters.json`: one row per cluster of the agent's role (the cluster's `triggers` are the cues, `read_first` is *Load first*, the rest of `includes` is *Then, when needed*), plus one row per `additions` entry for that role. `additions` route skills that no cluster of the role includes (for example `abap-cloud-development` or `abap-strings-regex` for the developer).

1. For every row whose cue appears in the task, load the skills under *Load first*.
2. Load *Then, when needed* only if the task needs them.
3. Treat the cues as hints to your judgement, not a keyword filter. A task that merely *mentions* a cue in order to exclude it ("no RAP context") does not match the row.
4. Check the table again when the task changes shape: a helper class that uses EML, or a class that a RAP handler calls, is a RAP task even if it started as something else.

### Tier 3 — everything else

For anything the table does not cover, take the skill whose description in your skills list fits best. Claude Code additionally has `${CLAUDE_PLUGIN_ROOT}/.claude/skill-index.json` (name, description and path of every skill). A task that no skill covers needs none; say so before you write code instead of inventing a fit.

## The governing rule

**Select the smallest semantically complete set — never the narrowest one that fits a number.** Do not omit a relevant skill to satisfy a budget. Do not load an unrelated cluster merely because it shares a technology family with the real one. "Complete" and "small" are both real constraints; neither overrides the other.

## Mechanics

- **Load** every selected skill before substantive work (design, implementation or review, as the agent's role defines it).
- **Deduplicate.** Never re-load a skill that is already active.
- **Load references progressively.** Follow a loaded skill's own links to `references/` and `examples/` only when that depth is needed for the current step.
- **Re-route when scope changes** instead of preloading speculative siblings.

## Safety nets that do not depend on routing

Routing can still be skipped by a model that believes it already knows the answer, so the rules that have cost real incidents do not rely on it:

- **Red lines** at the top of each agent, always in context (for example: no `COMMIT ENTITIES`, `COMMIT WORK` or `ROLLBACK` in a RAP handler or saver or any code they call).
- **The PreToolUse hook** `hooks/abap-guard.mjs`, registered in `hooks/hooks.json`. Before an edit that *adds* such a statement to ABAP code, in Claude Code and in GitHub Copilot, it asks for confirmation and gives the model the rule. It never blocks: a commit is legal in a report, a test, a job or a worker task. VS Code runs plugin hooks when `chat.useHooks` is on.
- **Static rules** in `evals/static-checks.json` and the tests in `scripts/test_build_agent_routing.py`, which replay every case in `evals/cases/abap-routing.json` through the same cues.

## Copilot settings that help

These are user settings; a plugin cannot ship them.

- **Configure Skills:** switch off the skills of plugins you do not use for ABAP. Every installed skill's name and description is in the system prompt on every model round, which can reach tens of thousands of tokens and buries these skills.
- **Hooks:** keep `chat.useHooks` on, or the guard does not run.
- **`chat.experimental.useSkillAdherencePrompt`:** an experimental VS Code setting that adds an explicit "load the matching skill first" instruction to Copilot's own prompt.

## Measuring whether it works

Turn on `github.copilot.chat.agentDebugLog.fileLogging.enabled` (it writes the tool calls and requests of each chat as JSONL). For each request that involves RAP, EML or LUW, count the `read_file` calls on `.../.claude/skills/<name>/SKILL.md` that happen before the first edit, and how many lines they read. Before this design the answer was almost always none.

## Conflict precedence

When loaded guidance disagrees:

1. System/platform safety and tool constraints.
2. The active agent's role and scope (this file's own `## Scope and limits`).
3. Repository/project-specific rules (`CLAUDE.md`, `AGENTS.md`, project-local instructions) — these can intentionally override upstream general guidance, e.g. the shipped Hungarian naming convention overriding Clean ABAP's default naming style.
4. The most specific domain skill.
5. Cross-cutting/general skills.
6. Examples and non-normative references.

If two equally specific skills conflict in a way that could affect correctness, surface the conflict instead of silently picking one.

## Maintaining the routing data

`.claude/skill-index.json` is **generated** — never hand-edit it. `.claude/skill-clusters.json` is **hand-maintained**. After adding, removing or changing a skill, or a cluster's cues:

```bash
python scripts/generate_skill_index.py
python scripts/build_agent_routing.py
python scripts/validate_skills.py
python -m unittest discover -s scripts -p "test_*.py"
```

- A new skill that belongs in an existing workflow goes into that cluster's `includes` (role-scoped: once per role that needs it) and, if it should not be loaded for every match, out of `read_first`.
- Every cluster needs `triggers`: the cues an agent sees in the table, most important first (the table shows the first ten). Keep cues specific: a cue that appears in unrelated tasks sends agents to the wrong skills. Add a case to `evals/cases/abap-routing.json` when a boundary matters.
- A skill that no cluster of a role includes, but that the role should find, goes into `additions` with the roles it applies to and its cues.
- `scripts/validate_skills.py` fails on unknown skills or roles, a missing `triggers`, a `read_first` outside `includes`, an addition that duplicates a route, and a Tier-1 skill without a `preload_cues` entry.
