# ABAP Agent Orchestration Playbook

How the ABAP specialist agents work together. This is a guide for the **orchestrator** — the main Claude Code session (or the human driving it) — on when to dispatch which agent and in what shape.

## The hard constraint that shapes everything

**The ABAP agents are non-dispatching peers.** By design, none of them coordinates the others — the main session does. The packaged plugin variants enforce this at the tool level (`Read, Glob, Grep, Bash, WebFetch, WebSearch, Skill` — no `Agent` tool); the repo-local `.claude/agents/*` variants omit a `tools:` list and so inherit the session tool set, which makes the rule a prompt convention there rather than a tool restriction. Either way, treat it as fixed: an ABAP agent does not spawn or manage other agents.

Consequence: **the orchestrator is the only coordinator.** There is no "PM agent" and no agent hierarchy. The agents are peers. The main session decides which to run, runs them (in parallel or in sequence), and synthesizes their output. A "PM / process owner" role is filled by the orchestrator plus the planning skills (`brainstorming`, `writing-plans`), not by a separate agent.

## The roster

| Agent | Lens | Dispatch it to… |
|---|---|---|
| `abap-kebap-architect` | Solution design before code | Decide managed/unmanaged RAP, CDS layering, package/transport strategy, released-API selection, build-vs-extend. Produces a design, not code. |
| `abap-kebap-developer` | Implementation + its own ABAP Unit tests | Write/modernize the actual ABAP against an approved design, and author the ABAP Unit tests that cover it (doubles for CDS/RAP/OSQL, TEST-SEAM, red-green-refactor). The hands. |
| `abap-kebap-reviewer` | Clean ABAP + correctness + security + performance | Independent, adversarial review of existing code — naming/control-flow/OO smells, authorization/injection/exposure/secrets, and SQL/FAE/buffer/AMDP cost. Fresh eyes: the ATC + Code Vulnerability Analyzer gate in one. |

All three are advisors by prompt contract: they produce text artifacts — designs, code, findings, tests — that a human applies in ADT, and their prompts forbid releasing transports, activating objects, or running mass DML. (They do carry Bash for local inspection, so "read-only" is a prompt-enforced convention, not a tool restriction.)

## Play 1 — Review (one agent by default; add the design lens for high-stakes code)

**Trigger:** "review this class / package", "is this code OK?", "audit this before I ship".

**Shape:** `abap-kebap-reviewer` is the whole review gate — it runs Clean ABAP + correctness, security, and performance in one pass (the ATC + Code Vulnerability Analyzer gate in one agent). For high-stakes or architecturally-loaded code, add `abap-kebap-architect` **in parallel** for a design-level lens, then merge.

```
orchestrator
  ├─ abap-kebap-reviewer    (Clean ABAP + correctness + security + performance)  ┐  run concurrently
  └─ abap-kebap-architect   (design-level smells, layering — opt-in)             ┘
        ↓
  orchestrator synthesizes: dedupe overlapping findings, sort by severity,
  resolve any disagreement, emit ONE consolidated report
```

Why the reviewer alone is usually enough: it carries all three code-level lenses (correctness/Clean ABAP, security, performance) inside one context, mirroring the real ATC + CVA gate. The architect adds value only when the concern is design or layering, not line-level — and runs concurrently, so it costs no extra wall-clock over the slower of the two.

**Synthesis rules for the orchestrator:**
- Deduplicate: a line flagged under more than one heading appears once, with all rationales.
- Keep severities honest: a Security Critical outranks a Nit.
- Preserve `path:line` and citations from each agent.
- If the reviewer and architect disagree (e.g. reviewer says "fine", architect says "wrong layer"), surface both — do not silently pick one.
- Output in the standard review format (Correctness & Clean ABAP / Security / Performance, then Critical / Important / Nit / Looks good).

**Default to one agent.** For most reviews, dispatch just `abap-kebap-reviewer` — it already carries the security and performance lenses. Adding `abap-kebap-architect` is an opt-in second context — reserve it for genuinely high-stakes code, and dispatch it yourself. There is no review-panel workflow: an earlier one was removed as too token-heavy (a single ~500-line report cost ~1.2M tokens across the fan-out plus per-finding verification).

## Play 2 — Sequential Build Pipeline

**Trigger:** "build / create this RAP BO / report / class", "implement this feature end-to-end".

**Shape:** a sequence with quality gates. Each stage consumes the previous stage's output; a human approval gate sits after design.

```
abap-kebap-architect  ──► design document (options, recommendation, data model, contract)
      │
   [GATE: human approves the design]      ← orchestrator surfaces it; do not skip
      │
abap-kebap-developer  ──► implementation + its own ABAP Unit tests (failing test first, then green/refactor)
      │
abap-kebap-reviewer   ──► independent review of the implementation + tests (Clean ABAP + correctness + security + performance)
      │
   [if Critical findings] ──► orchestrator routes back to abap-kebap-developer (max 1–2 rounds)
      │
   consolidated result to the user
```

Why sequential: design must precede code, code must precede its review, and the human gate after design prevents building the wrong thing well. This is orchestrator-driven (not a headless Workflow) precisely because of that human gate.

**Gate discipline:**
- Always surface the architect's design for approval before dispatching the developer. Use the normal plan/approval flow.
- The `abap-kebap-reviewer` gate already covers security and performance; for architecturally-loaded changes add `abap-kebap-architect` as a second review lens.
- Cap the review→fix loop at 1–2 rounds; if Critical findings persist, stop and raise it with the user rather than looping.

## Play 3 — The Development Loop (superpowers integration)

**Trigger:** the [superpowers plugin](https://github.com/obra/superpowers) is installed and you are building or fixing something end-to-end. Its process skills drive the loop from the **main session**; each ABAP agent is dispatched at the stage it serves. The agents run as subagents and never invoke an interactive process skill themselves — `superpowers:using-superpowers` self-disables in subagents by design.

**Shape:** the main session owns the process; each stage dispatches one agent.

| Stage | Superpowers skill (main session) | Dispatch → agent | Domain skills |
|---|---|---|---|
| Design a feature / RAP BO | `superpowers:brainstorming` | `abap-kebap-architect` | design-level skills per its map |
| Plan | `superpowers:writing-plans` | — (plan tasks name the domain skills) | — |
| Implement (red) | `superpowers:test-driven-development` | `abap-kebap-developer` writes the failing ABAP Unit test first | `abap-unit-tdd` |
| Implement (green/refactor) | same | `abap-kebap-developer` | `abap-clean-style` + topic skills |
| Bugfix | `superpowers:systematic-debugging` | `abap-kebap-developer` | `abap-systematic-debugging` (ST22/ST05/SAT) |
| Review gate | `superpowers:requesting-code-review` | `abap-kebap-reviewer` — Clean ABAP + security + performance | `abap-code-review` |
| Done gate | `superpowers:verification-before-completion` | — | repo gates: `scripts/validate_skills.py`, `evals/static-checks.json`, evals |

This is Play 2's pipeline with a named process skill at each seam: `brainstorming` before the architect, `writing-plans` before the developer, `test-driven-development` around the developer's red/green (failing test first, then implementation), `requesting-code-review` at the reviewer gate, and `verification-before-completion` before you claim done.

How to dispatch (examples):
```
Design stage (main session ran superpowers:brainstorming):
  Agent(subagent_type: "abap-kebap-architect", prompt: "Design a managed RAP BO for ZCUSTOMER with draft. Options + recommendation + data model + contract.")
  → surface design, get human approval

Red → green (main session holds superpowers:test-driven-development):
  Agent(subagent_type: "abap-kebap-developer", prompt: "Write a FAILING ABAP Unit test for the blocked-customer save rejection, then make it pass and refactor: <approved design>")

Review gate (main session ran superpowers:requesting-code-review):
  Agent(subagent_type: "abap-kebap-reviewer", prompt: "Independent review of the implementation + tests — Clean ABAP + correctness, security, and performance: <artifacts>")
```

**Fallback (no plugin):** hold the five gates by hand — see the root [`CLAUDE.md`](../CLAUDE.md), "Fallback — the five gates".

## Play 4 — Single-thread surfaces (Copilot, IDE chat, one agent)

On VS Code Copilot — and any surface where there is exactly one agent thread and no separate orchestrator to dispatch to — the plays above still describe the *stages*, but the hand-off between architect → developer → reviewer is a **change of hat, not a change of thread**. Nobody is going to spawn the "developer agent" for you; you are it. In that setting:

- **Don't refuse to proceed for lack of an orchestrator.** "The developer agent should do this, not me" is not a valid stop when you are the only agent in the room. Adopt the stage's discipline (design first, then test-first build, then a review pass) and continue.
- **Name the hat once, then act.** State which stage you are entering ("Switching to build — test-first"), then do it. Don't re-announce every turn, and don't loop back to ask for permission the user has already given.
- **Hold the five gates yourself:** design approved → plan → failing test → verify with evidence → independent review pass. What changes on a single thread is that *you* hold all five in one context instead of dispatching each to a peer — not that any of them is skipped.
- **"You have access — do it yourself" means proceed.** When the user says the tools are reachable and tells you to act, that is approval to run them: verify reachability once, then use them. Repeatedly deferring after the user has said "go" is the failure mode to avoid.

## Project conventions the agents honor

The default ABAP naming convention ships with the `abap-clean-style` skill at [../.claude/skills/abap-clean-style/references/naming-conventions.md](../.claude/skills/abap-clean-style/references/naming-conventions.md) — a scope+type Hungarian grid (`mv_`/`lt_`/`iv_`/`ro_`…, field symbols `<fv_>`/`<fs_>`/`<ft_>`, CDS `z<area>_i_`/`z<area>_c_`). The architect, developer, and reviewer all follow it over the Clean ABAP naming default: the developer for new identifiers, the architect for object/contract names, the reviewer as the standard it grades against (the mandated prefixes are never flagged as violations). A project may override it with a naming section in its `CLAUDE.md`/`AGENTS.md` — relative to the project root, so the wiring works for every checkout with no absolute path baked in. The agent presents the convention for the user's approval before development starts.

## Token / cost note

This architecture is **opt-in per task**, not the default for every turn.

- A simple question — "what does this line do?", "which annotation for created-at?" — goes to a **single** agent, or is answered directly from the skills. Do not convene a panel for a one-liner.
- The **panel** spends ~2 agent contexts; the **pipeline** spends ~3 sequential contexts. Worth it for "review thoroughly" or "build this feature", wasteful for trivia.
- When in doubt, start with one agent and escalate to a play only if the task is genuinely multi-dimensional.

## How to dispatch (examples)

Review, thorough (parallel — one message, multiple calls):
```
Agent(subagent_type: "abap-kebap-reviewer",  prompt: "Review ZCL_ORDER_PROCESSOR — Clean ABAP + correctness, security, and performance. <code/paths>")
Agent(subagent_type: "abap-kebap-architect", prompt: "Design-level review of ZCL_ORDER_PROCESSOR — layering, coupling, RAP/CDS fit. <code/paths>")
```

Pipeline (sequential — await each, gate after design):
```
1. Agent(subagent_type: "abap-kebap-architect", prompt: "Design a RAP BO for <requirement>. Options + recommendation + data model + contract.")
   → surface design, get human approval
2. Agent(subagent_type: "abap-kebap-developer", prompt: "Implement this approved design, test-first (failing ABAP Unit test, then green/refactor): <design>")
3. Agent(subagent_type: "abap-kebap-reviewer",  prompt: "Independent review of the implementation + tests: <artifacts>")
```

## Automation status

**Built:**
- **Two-tier evals (`evals/`)** — Tier 1 static checks (`run-static.mjs`, ~0 tokens, every change) + Tier 2 behavioral (`abap-evals` workflow, cheap model, skill-only, milestones).
- **`/abap-learn` command** — capture a correction into a permanent fix: locate the root skill, propose a skill edit + a Tier-1 static rule, confirm, apply, verify, commit. The human-in-the-loop way to keep skills correct without an expensive recurring audit.
- **Remote grounding** — agents verify uncertain syntax against authoritative public sources before asserting; see [`grounding-protocol.md`](grounding-protocol.md).

**Removed (too token-heavy):**
- `abap-review-panel` and `abap-quality-gate` workflows — the parallel-lens + per-finding-verify fan-out cost ~1.2M tokens to review one ~500-line report. Multi-lens review is now a manual, opt-in dispatch (Play 1); the build-pipeline tail (developer tests → reviewer) is manual too (Play 2). The shared findings JSON schema went with them.

**Deferred:**
- ADT MCP live grounding (live syntax check / ATC / real DDIC) — highest-precision ceiling, needs a reachable ABAP system.
- Candidate roles: a Fiori/UI5 frontend agent (would use the installed `ui5-best-practices` / `sap-fiori-mcp` skills to close RAP→Fiori end-to-end), a transport/release advisor, an explicit process-coordinator persona.
