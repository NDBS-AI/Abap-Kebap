# ABAP Agent Team — Development Process

This repo ships an ABAP agent team (3 agents + 36 skills) for SAP ABAP work. When the
[superpowers plugin](https://github.com/obra/superpowers) is installed, development follows its
process loop: the **main session** drives the loop and dispatches an ABAP agent at each stage.

## The development loop

| Stage | Superpowers skill (main session) | Dispatch → agent | Domain skills |
|---|---|---|---|
| Design a feature / RAP BO | `superpowers:brainstorming` — during approach exploration | `abap-architect` | design-level skills per its map |
| Plan | `superpowers:writing-plans` | — (plan tasks name the domain skills) | — |
| Implement (red) | `superpowers:test-driven-development` discipline | `abap-developer` writes the failing ABAP Unit test first | `abap-unit-tdd` |
| Implement (green/refactor) | same | `abap-developer` | `abap-clean-style` before generating ABAP, plus topic skills |
| Bugfix | `superpowers:systematic-debugging` (generic discipline) | `abap-developer` | `abap-systematic-debugging` — the ABAP adaptation (ST22/ST05/SAT) |
| Review gate | `superpowers:requesting-code-review` pattern | `abap-reviewer` — Clean ABAP + security + performance in one gate | `abap-code-review` |
| Done gate | `superpowers:verification-before-completion` | — | repo gates: `python scripts/validate_skills.py`, `node evals/run-static.mjs`; behavioral evals at milestones only |

## The subagent rule

The ABAP agents run as **subagents**. Interactive process skills (brainstorming, writing-plans,
executing-plans) belong to the **main session** that dispatches them — agents never invoke them.
`superpowers:using-superpowers` self-disables in subagents by design; do not fight it.

## Fallback — the five gates (no plugin installed)

Without the plugin, hold these gates by hand:

1. Present the design and get approval before writing any code.
2. Write the plan before implementing multi-step work.
3. Test-first: a failing test before the implementation.
4. Verify with evidence (run the thing) before claiming done.
5. Independent review before merge.

## More

Dispatch patterns and worked examples: [docs/agent-orchestration.md](docs/agent-orchestration.md)
Play 3. Plugin: https://github.com/obra/superpowers
