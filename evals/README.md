# ABAP Agent Evals

A regression net for the ABAP agent system, in **two tiers** — cheap-and-frequent, then expensive-and-rare. It exists because an error already shipped once (a skill drifting to `@Semantics.systemDate.*` instead of `@Semantics.systemDateTime.*`), and the expensive agent eval alone missed a stale copy of it in an example file. The static tier catches that class for ~0 tokens.

## Two tiers

| Tier | What | Cost | When |
|---|---|---|---|
| **1 — Static** | Deterministic substring checks over skill/agent/doc files (required tokens present, forbidden tokens absent). No model at all. | ~0 tokens | **Every change** |
| **2 — Behavioral** | Dispatch each case to its target agent: an answer-content case grades the response with string assertions + a judge; a routing-decision case grades which cluster(s)/standalone skill(s) the agent's own skill-routing preflight *reports selecting*. | High (one agent per case) | **Milestones only** (before publish), on a cheap model, skill-only |

Tier 1 is the everyday net. Tier 2 is the occasional end-to-end check. The first agent eval run cost ~693K tokens for 13 cases — that is a milestone-only spend, not a per-change one.

## Layout

- `static-checks.json` — Tier 1 rules (source of truth, human-editable).
- `run-static.mjs` — Tier 1 runner (Node, no dependencies).
- `cases/abap-core.json` — Tier 2 answer-content case set (source of truth, human-editable).
- `cases/abap-routing.json` — Tier 2 **routing-decision** case set — tests whether the agent's mandatory skill-routing preflight (`.claude/skill-clusters.json` / `skill-index.json`) selects the right clusters/standalone skills for a prompt, not just whether the final answer happens to be right.
- `../.claude/workflows/abap-evals.js` — Tier 2 runner workflow (cheap model, skill-only) for both case sets.

## A case

**Answer-content case** (`cases/abap-core.json`):

```json
{
  "id": "cds-created-at-annotation",
  "target_agent": "abap-kebap-developer",
  "prompt": "…the question…",
  "must_contain": ["systemDateTime.createdAt"],
  "must_not_contain": ["systemDate.createdAt"],
  "rubric": "Optional natural-language pass criterion, graded by a judge."
}
```

- `target_agent` — which agent answers (`abap-kebap-architect`, `abap-kebap-developer`, `abap-kebap-reviewer`).
- `must_contain` / `must_not_contain` — case-insensitive substring assertions, graded deterministically in JS (no model tokens).
- `rubric` — optional; graded by a cheap judge model. A case passes when the string assertions pass **and** (no rubric, or the judge passes).

**Routing-decision case** (`cases/abap-routing.json`):

```json
{
  "id": "route-rap-fiori-composition",
  "target_agent": "abap-kebap-developer",
  "prompt": "Build a managed RAP business object and add Fiori Elements UI annotations for it.",
  "routing": {
    "required_clusters": ["rap-business-object", "rap-fiori-ui"],
    "forbidden_clusters": ["async-processing", "repository-tooling"],
    "required_standalone_skills": [],
    "forbidden_standalone_skills": []
  }
}
```

A case with a `routing` field is dispatched differently: instead of asking for a full answer, the eval prompt asks the agent to run *only* its mandatory skill-routing preflight and report the decision as structured JSON (`clusters`, `standalone_skills`) — no implementation, no free text to parse. `required_clusters` / `forbidden_clusters` / `required_standalone_skills` / `forbidden_standalone_skills` are all optional; omit whichever isn't relevant to the case (e.g. a pure Tier-3 case asserts only `required_standalone_skills`). The `forbidden_*` fields exist specifically to catch over-routing — a cluster or standalone skill the agent picks up that a narrowly-scoped prompt didn't call for.

**What a routing case does and does not prove.** It tests the semantic routing/classification decision — does the agent's own preflight step pick the right cluster names for this prompt — which an answer-content case cannot test on its own: an agent can answer correctly from pretrained knowledge without ever selecting the cluster it was supposed to, and a `must_contain` assertion would falsely pass that. What a routing case does **not** independently prove is that the reported cluster's skills actually get loaded via the `Skill` tool afterward (production instructions require that load step; this eval observes only the reported decision, not the tool-call trace). Treat routing cases and answer-content cases as complementary signals, not a substitute for each other.

## How to run

**Tier 1 (static) — run this on every change:**

```bash
node evals/run-static.mjs
```

Exit code 0 = all pass, 1 = at least one failure (with the offending `file:line`). No model, no tokens. Add `exclude` to a forbidden rule for files that legitimately discuss the anti-pattern (e.g. `docs/grounding-protocol.md`).

**Tier 2 (behavioral) — run at milestones:**

Workflow scripts have no filesystem access, so the runner takes the cases via `args`. Read the case file(s) and pass the array:

1. Read `evals/cases/abap-core.json` and/or `evals/cases/abap-routing.json` — combine into one array if running both.
2. Invoke the `abap-evals` workflow with that array as `args` (optionally `{ cases, model }` to override the cheap eval model).

The workflow dispatches each case to its target agent **on a cheap model, skill-only (no WebFetch)**, grades it, and returns `{ total, passed, failed, results, report }`. Skill-only matters: if the eval agent fetched the live web it could answer correctly even when the *skill* is wrong, masking the regression.

## When to run

- **Tier 1 (static):** after any change to a skill, agent, or doc — it is fast and free.
- **Tier 2 (behavioral):** before publishing a new version, or after a substantial agent/skill change you want to validate end-to-end.

## Extending

- **Easiest path — `/abap-learn`:** when you catch an error in agent output, run the `/abap-learn` command. It locates the root skill, proposes the fix plus a Tier-1 rule, and on your confirmation applies it, runs `run-static.mjs`, and commits — turning a correction into a locked check for you.
- **Cheap first:** if a regression can be expressed as "this token must / must not appear in this file", make it a Tier 1 rule in `static-checks.json`. That is most content regressions and costs nothing to run.
- **Behavioral only when needed:** add a Tier 2 case to `cases/abap-core.json` when the check is about answer *content* (does the agent state the right fact/annotation/clause). Add a case to `cases/abap-routing.json` when the check is about *routing* (did the agent select the right cluster(s)/standalone skill(s) for this prompt) — especially a boundary pair where two similar-sounding prompts should route differently (e.g. "add a CDS association" vs. "implement a RAP action" for the same entity).
- Favor the high-error-rate areas: exact CDS annotations, RAP BDL clauses, released-API names, FAE/SQL rules, Clean ABAP naming. Each new bug found in practice should become a check so it cannot regress silently.
