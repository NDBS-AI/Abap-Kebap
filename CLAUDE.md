# ABAP Agent Team — Development Process

This repo ships an ABAP agent team (3 agents + 36 skills) for SAP ABAP work. When the
[superpowers plugin](https://github.com/obra/superpowers) is installed, development follows its
process loop: the **main session** drives the loop and dispatches an ABAP agent at each stage.

## The development loop

| Stage | Superpowers skill (main session) | Dispatch → agent | Domain skills |
|---|---|---|---|
| Design a feature / RAP BO | `superpowers:brainstorming` — during approach exploration | `abap-kebap-architect` | its Tier-1 preload + cluster routing per `.claude/skill-clusters.json` |
| Plan | `superpowers:writing-plans` | — (plan tasks name the domain skills) | — |
| Implement (red) | `superpowers:test-driven-development` discipline | `abap-kebap-developer` writes the failing ABAP Unit test first | `abap-unit-tdd` (Tier-1 preloaded) |
| Implement (green/refactor) | same | `abap-kebap-developer` | `abap-clean-style` **unconditionally** before generating ABAP (Tier-1 preloaded, never a routing decision), plus cluster/topic skills |
| Bugfix | `superpowers:systematic-debugging` (generic discipline) | `abap-kebap-developer` | `abap-systematic-debugging` — the ABAP adaptation (ST22/ST05/SAT) |
| Review gate | `superpowers:requesting-code-review` pattern | `abap-kebap-reviewer` — Clean ABAP + security + performance in one gate | `abap-code-review` (Tier-1 preloaded) |
| Done gate | `superpowers:verification-before-completion` | — | repo gates: `python scripts/generate_skill_index.py`, `python scripts/validate_skills.py`, `node evals/run-static.mjs`, `python scripts/build_issue_forms.py`, `python -m unittest discover -s scripts -p "test_*.py"`, `node --test scripts/issue-triage/*.test.mjs`, `python scripts/build_agent_routing.py`, `node --test hooks/*.test.mjs`, `cd mcp/released-objects && npm test`; behavioral evals at milestones only |

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
