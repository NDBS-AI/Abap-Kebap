# ABAP Kebap — SAP ABAP Agent Team & Skills for Claude Code + GitHub Copilot

A team of **3 focused Claude Code agents** for SAP ABAP, backed by **36 in-depth skills** spanning the full ABAP language and platform surface: the core language (internal tables, data objects, constructor expressions, strings/regex, dynamic programming, built-in functions), data & persistence (Open SQL, DDIC, AMDP, SAP LUW), modern stack (CDS, RAP, ABAP Cloud, OData, RAP events), cross-cutting concerns (authorization, XML/JSON), quality (Clean ABAP, code review, ABAP Unit, debugging), and legacy maintenance (classic UI, modernization, enhancements, version control).

`abap-developer` is the hands-on implementer (and writes the ABAP Unit tests that cover its own code); two specialist agents add independent expert perspectives — `abap-architect` for design before code, and `abap-reviewer` for an independent Clean ABAP + security + performance review — so the same code is looked at through more than one lens and the gaps one lens misses get caught by another. The skills behind every agent are loaded on demand via the `Skill` tool, so each agent stays small in context but can pull in deep knowledge when a task requires it. Each skill is distilled from the official [SAP-samples/abap-cheat-sheets](https://github.com/SAP-samples/abap-cheat-sheets) — decision-oriented `SKILL.md` (≤500 lines) with full syntax catalogs in `references/`.

---

## Install

**As a Claude Code plugin** (plugin name: `abap-kebap`):

```
/plugin marketplace add abgunes/Abap-Kebap
/plugin install abap-kebap@abgunes
```

Skills are then invoked as `/abap-kebap:<skill-name>` and agents as `abap-kebap:<agent-name>`.
The `/abap-learn` command is deliberately **not** part of the plugin — it edits this
repo's skills and static-check rules, so it is a contributor tool; clone the repo to use it.
For GitHub Copilot users it also ships as a VS Code prompt file
([`.github/prompts/abap-learn.prompt.md`](.github/prompts/abap-learn.prompt.md)), invocable
as `/abap-learn` in Copilot Chat — generated from the Claude command by
`scripts/build_copilot.py` (CI regenerates and fails on drift, same as the agent mirrors).

**With GitHub Copilot** — no plugin to install; Copilot reads what this repo already
ships. Put the repo where Copilot runs, and it picks these up:

| What Copilot reads | Copilot feature | Where it applies |
|---|---|---|
| [`AGENTS.md`](AGENTS.md) (root) | Agent instructions — the ABAP non-negotiables, plus the cue to open the matching `.claude/skills/<name>/SKILL.md` before writing or reviewing ABAP | Coding agent (github.com), Copilot CLI, IDEs |
| [`.github/copilot-instructions.md`](.github/copilot-instructions.md) | Repository-wide custom instructions | Chat, code review, coding agent |
| [`.github/instructions/`](.github/instructions/) (`applyTo` globs — `**/*.abap`, CDS) | Path-specific instructions | VS Code / Visual Studio Chat, coding agent, code review |
| [`.github/agents/*.agent.md`](.github/agents/) | Custom agents — `abap-architect` / `abap-developer` / `abap-reviewer` | Coding agent (github.com), Copilot CLI, VS Code |

**Setup:**

1. **Make the files reachable.** In an IDE (VS Code, Visual Studio, JetBrains), clone the
   repo and open it as the workspace — or copy its `AGENTS.md`, `.github/`, and `.claude/`
   into your own project. For the **github.com coding agent**, just have them committed on
   the branch; it reads them straight from the repository.
2. **Instructions apply on their own** — nothing to toggle. `AGENTS.md` and
   `.github/copilot-instructions.md` are used together, and the `.github/instructions/`
   rules fire when you touch a matching file (`*.abap`, CDS). In VS Code, if custom
   instructions aren't picked up, confirm the `github.copilot.chat.codeGeneration.useInstructionFiles`
   setting is on (it is by default).
3. **Pick a role agent** when you want one specific lens:
   - **Copilot CLI:** run `/agent` and choose the agent, or `copilot --agent=abap-reviewer -p "review ZCL_ORDER_PROCESSOR"`.
   - **github.com:** select the agent from the dropdown in the agents panel before dispatching a task.
   - **VS Code:** choose it from the agent picker in the Chat view.

The `.github/agents/*.agent.md` mirrors are **generated** from the Claude sources by
`scripts/build_copilot.py` (CI regenerates and fails on drift) — never edit them by hand:
edit `.claude/agents/*.md`, then run `python scripts/build_copilot.py`. Each generated body
stays under Copilot's 30,000-character custom-agent prompt cap.

**Optional — live SAP content search via MCP.** Local `sap-devs` CLI — tutorial search
with guided walkthroughs, tips, canonical samples, error lookup (CAP/BTP-centric), and
CF/BTP inspection tools. It is a Go binary from
[SAP-samples/sap-devs-cli](https://github.com/SAP-samples/sap-devs-cli) — install via
Scoop (Windows), Homebrew (macOS), or a GitHub Releases binary (the `npm i -g sap-devs`
shown on SAP's api-docs page is stale — no such npm package). Then:

```
sap-devs sync --force
claude mcp add sap-devs-server -- <path-to>/sap-devs mcp serve
```

(SAP's hosted `https://developers.sap.com/mcp/search` server answers anonymously at the
protocol level, but Claude Code's client-side OAuth discovery still gates its tools behind
a login — and that login is unusable: SAP's edge network hard-blocks the dynamic
client-registration endpoint the flow depends on. Not included here for that reason.)

When to use these vs. the default grounding sources:
[`docs/grounding-protocol.md`](docs/grounding-protocol.md).

---

## What's inside

### The agent team

Three peer agents under `.claude/agents/`. All are read-only advisors that share the same scope limits (never release transports, activate to production, or run mass DML). None can dispatch another agent — the **main Claude Code session is the only orchestrator** that decides which to run and synthesizes their output.

| Agent | Role / distinct lens |
|---|---|
| `abap-developer` | The hands-on implementer — writes, modernizes, debugs ABAP against an agreed design, and authors the ABAP Unit tests (doubles for CDS/RAP/OSQL, TEST-SEAM) that cover it. |
| `abap-architect` | Solution design *before* code — managed/unmanaged RAP, CDS VDM layering, package/transport strategy, released-API selection. Produces a design, not code. |
| `abap-reviewer` | The independent quality gate — Clean ABAP + correctness, security, and performance in one adversarial pass (the ATC + Code Vulnerability Analyzer gate in one agent). Critical / Important / Nit findings with `path:line`. |

You dispatch these agents yourself — there is no automatic multi-agent orchestration. For most work that means a **single agent** (usually `abap-reviewer`); you *can* run several in parallel for a thorough multi-lens pass on high-stakes code, at the cost of N agent contexts. The dispatch patterns are in [`docs/agent-orchestration.md`](docs/agent-orchestration.md). Each agent carries its own persona, output format, scope limits, and a role-specific skill-use map.

### The skills

**Core language**

| Skill | Role |
|---|---|
| `abap-clean-style` | Clean ABAP — naming, control flow, logical expressions, OO defaults, errors. |
| `abap-internal-tables` | Table kinds, key design, READ/LOOP/MODIFY/INSERT/DELETE, table expressions, GROUP BY. |
| `abap-data-objects` | Data types, structures, MOVE-CORRESPONDING, references, generic types, bit/byte ops. |
| `abap-constructor-expressions` | VALUE/CORRESPONDING/NEW/REDUCE/FILTER/COND/SWITCH/CONV/CAST/EXACT/LET/FOR. |
| `abap-strings-regex` | String templates, string functions, FIND/REPLACE PCRE, regular expressions. |
| `abap-dynamic-programming` | Field symbols, data refs, ASSIGN, RTTI/RTTC, dynamic SQL/calls/CREATE. |
| `abap-builtin-functions` | Date/time/timestamp, numeric ops & rounding, built-in function catalog. |

**Data & persistence**

| Skill | Role |
|---|---|
| `abap-sql-performance` | Open SQL hygiene + full SELECT/JOIN/WHERE/CTE syntax, FOR ALL ENTRIES, buffer, push-down. |
| `abap-dictionary-ddic` | DDIC tables, data elements, domains, search helps, buffering, currency/quantity. |
| `abap-amdp-hierarchies` | AMDP / SQLScript, CDS table function backends, SQL hierarchies. |
| `abap-sap-luw` | SAP LUW, COMMIT/ROLLBACK WORK, bundling, ENQUEUE/DEQUEUE locking. |

**Modern stack (S/4HANA + Cloud)**

| Skill | Role |
|---|---|
| `abap-background-processing` | bgPF, Application Jobs API, and Application Log (BALI) — running and monitoring asynchronous work in ABAP Cloud. |
| `abap-business-configuration` | Business Configuration Maintenance Objects (RAP), Custom Business Configurations app, customizing transport, BC Sets API. |
| `abap-cloud-development` | ABAP Cloud / Steampunk restrictions, released APIs, release news, ABAP GenAI. |
| `abap-odata` | OData V2/V4 beyond RAP — SEGW, CDS/SADL exposure, service activation, and consuming external OData services. |
| `abap-output-management` | Email (BCS mail, templates, SMTP), print queues, ADS print forms, PDF merger in ABAP Cloud. |
| `abap-parallel-processing` | CL_ABAP_PARALLEL / IF_ABAP_PARALLEL — fanning work out across work processes, sizing tasks, merging results; vs bgPF/aRFC/SPTA. |
| `abap-xco-library` | XCO library — XLSX read/write, generation APIs (tables/classes/CDS/RAP BOs from code), CTS, standard library. |
| `cds-views-authoring` | CDS views: VDM layers, annotations, associations, RAP root/composition, performance. |
| `fiori-elements-ui-annotations` | @UI.* annotations for Fiori Elements List Report / Object Page — metadata extensions, facets, value helps, criticality. |
| `cds-entity-types` | CDS artifact kinds beyond plain views — custom and abstract entities, table functions, hierarchies, if_rap_query_provider query providers. |
| `rap-bo-modeling` | RAP business objects: managed/unmanaged/draft, behavior, actions, EML. |
| `rap-actions-validations-determinations` | RAP behavior deep dive — actions, validations, determinations, feature control, prechecks (BDEF grammar + handler implementations). |
| `rap-eml` | EML statement catalog and BDEF derived types (%cid, %tky, %control, %param) — consuming and testing RAP BOs from code. |
| `rap-saves-and-numbering` | RAP save sequence, additional/unmanaged save, early/late numbering, wrapping legacy BAPIs. |
| `rap-business-events-side-effects` | RAP business events (define/raise/consume) and side effects for Fiori Elements UI refresh. |

**Cross-cutting**

| Skill | Role |
|---|---|
| `abap-oo-patterns` | OO language + GoF patterns adapted to ABAP, exception design. |
| `abap-authorization` | AUTHORITY-CHECK, auth objects, CDS DCL, RAP authorization, security. |
| `abap-xml-json` | CALL TRANSFORMATION (ST/XSLT), sXML, /ui2/cl_json, serialization. |

**Quality**

| Skill | Role |
|---|---|
| `abap-code-review` | Disciplined code review with severity scoring + checklist. |
| `abap-unit-tdd` | ABAP Unit TDD, test doubles (OO/CDS/RAP), TEST-SEAM. |
| `abap-systematic-debugging` | Hypothesis-driven debug: dumps, ST05 traces, SAT, classical debugger. |

**Legacy & change**

| Skill | Role |
|---|---|
| `abap-abapgit` | abapGit version control — repo setup, .abapgit.xml, pull/push, transports vs git vs gCTS, ABAP Cloud usage. |
| `abap-modernization-playbook` | Legacy → modern decision tree (FORM → method, DB SELECT → CDS, …). |
| `abap-classic-ui` | Classic dynpro, selection screens, classic lists, classic ALV (maintenance). |
| `enhancements-extensibility` | BAdI / implicit / user-exit / RAP extension decision tree. |

### Quality infrastructure

Beyond agents and skills, the repo ships the machinery that makes the output precise and token-efficient:

| Piece | What it does |
|---|---|
| **Remote grounding** | Agents verify uncertain syntax/annotations/released-API names against authoritative public sources (`raw.githubusercontent.com`, `help.sap.com`, …) **before asserting**, and cite the URL — instead of trusting frozen skill text. See [`docs/grounding-protocol.md`](docs/grounding-protocol.md). Enabled by the WebFetch/WebSearch allowlist in [`.claude/settings.json`](.claude/settings.json). |
| **Two-tier evals (`evals/`)** | **Tier 1 — static** (`run-static.mjs`): deterministic token checks over the files, ~0 tokens, run on every change — catches content regressions like the `@Semantics.systemDate.*` drift. **Tier 2 — behavioral** (`abap-evals` workflow): Q&A cases dispatched to agents on a cheap model, skill-only, run at milestones. |
| **`/abap-learn` command** | Capture a correction you spot in agent output. It locates the root skill, proposes the fix **plus** a Tier-1 static rule (with a mandatory `grounded:` citation or `project convention` marker), and on your confirmation applies, verifies with both gates, records the decision in [`docs/lessons.md`](docs/lessons.md), and commits — so each mistake you catch is locked against regression. Human-in-the-loop, no background cost. See [`.claude/commands/abap-learn.md`](.claude/commands/abap-learn.md). |

This set is deliberately lean: free static checks and on-demand grounding do the heavy lifting, and the only workflow is the milestone eval runner. There are **no multi-agent review workflows** — earlier parallel ones (review-panel, quality-gate) were removed as too token-heavy.

---

## Install alternatives (without the plugin)

The plugin install at the top of this README is the recommended path. If you prefer
not to use plugins, two alternatives:

### Prerequisites
- [Claude Code](https://claude.ai/code)
- For live ABAP system access (optional): the `sapse.adt-vscode` VS Code extension and a local ADT MCP server that bridges Claude Code to your ABAP system. Setup is environment-specific and out of scope for this repo.

### Clone (project-local, also enables the contributor tools)

```bash
git clone https://github.com/abgunes/Abap-Kebap.git
cd Abap-Kebap
```

Open the folder in Claude Code. The agents and skills under `.claude/` are auto-discovered
for this project, and contributor tools (`/abap-learn`, the gates, `scripts/`) work here —
they are not part of the plugin.

### Global install (use across all projects)

Copy the agent and skills into your global Claude Code config:

```bash
# Linux / macOS
cp -r .claude/agents/abap-*.md ~/.claude/agents/
cp -r .claude/skills/* ~/.claude/skills/

# Windows (PowerShell)
Copy-Item .claude\agents\abap-*.md $HOME\.claude\agents\
Copy-Item .claude\skills\* $HOME\.claude\skills\ -Recurse
```

This copies all **3 agents** (`abap-developer`, `abap-architect`, `abap-reviewer`) and the 36 skills. The orchestration playbook (`docs/agent-orchestration.md`) is reference material — keep it in the cloned repo or copy it somewhere handy.

---

## Usage

### Dispatch a single agent
Pick the agent whose lens fits the task:
```
Use the abap-reviewer agent to review this class for Clean ABAP issues:
<paste ABAP>
```

- **Implement / debug / modernize / write tests** → `abap-developer`
- **Design before building** → `abap-architect`
- **Independent review (Clean ABAP + security + performance)** → `abap-reviewer`

### Dispatching the team
You orchestrate the agents yourself — there is no auto-orchestration. See [`docs/agent-orchestration.md`](docs/agent-orchestration.md).

- **Review** — for most reviews, dispatch a single `abap-reviewer` — it already covers Clean ABAP + correctness, security, and performance. For a design-level lens on high-stakes code you *can* add `abap-architect` in parallel and merge — but that is a second agent context, so reserve it.
- **Build** — `abap-architect` → *(you approve the design)* → `abap-developer` (implements + tests, test-first) → `abap-reviewer`, each a manual dispatch, looping back on Critical findings.

Default to one agent; escalate to several only when the stakes justify the cost.

### Common tasks
- **Review** — "Review the diff against Clean ABAP." → `abap-reviewer` (add `abap-architect` for a thorough pass)
- **Audit** — "Audit ZCL_PRICE_CALC for auth gaps and SQL cost." → `abap-reviewer`
- **Debug** — "Dump ST22 says TIME_OUT in ZCL_PRICE_CALC. Why?" → `abap-developer`
- **Modernize** — "Refactor this FORM-based report into a class." → `abap-developer`
- **Design** — "How should I structure a RAP BO for ZCUSTOMER with draft and attachments?" → `abap-architect`
- **Build RAP BO** — "Scaffold a managed RAP BO for ZCUSTOMER with draft." → build pipeline
- **Test** — "Write ABAP Unit tests with a CDS test double for ZCL_PRICE_CALC." → `abap-developer`

### Load a skill directly (without the agent)
You can also load a single skill in the main thread by typing its name as a slash command:
```
/abap-code-review
```
…then ask the question (or just ask — Claude Code auto-triggers skills whose description matches). Useful when you want quick checklist-driven help in your current context.

---

## Development process

For development discipline — design-before-code, plan-before-implement, test-first, verify-before-done, independent review — install the [superpowers plugin](https://github.com/obra/superpowers). The **main session** drives its process loop and dispatches an ABAP agent at each stage: `brainstorming` → `abap-architect`, `writing-plans`, `test-driven-development` → `abap-developer` (writes the failing test first, then makes it pass), `systematic-debugging` → `abap-developer`, `requesting-code-review` → `abap-reviewer`, and `verification-before-completion` → the repo gates. The agents run as subagents, so they never invoke those interactive process skills themselves.

The full mapping and dispatch examples are in [`docs/agent-orchestration.md`](docs/agent-orchestration.md) Play 3. Without the plugin, a built-in fallback — five inline gates — lives in the root [`CLAUDE.md`](CLAUDE.md), which auto-loads in every clone.

---

## Design principles

1. **Agent = persona, skills = knowledge.** Each agent describes *how* to work (cite `file:line`, prefer skills over guessing, "is" vs "appears to be", Clean ABAP defaults). The skills hold *what* to know (CDS annotations, RAP BDL syntax, dump catalog, SQL rewrites).
2. **Specialist team, single orchestrator.** Independent lenses (design, implementation-with-tests, and an independent Clean ABAP + security + performance review) catch what one perspective misses. Because Claude Code subagents cannot dispatch other subagents, the agents are peers and the **main session is the only coordinator** — there is no "PM" agent. The two orchestration plays live in [`docs/agent-orchestration.md`](docs/agent-orchestration.md).
3. **Progressive disclosure.** Each `SKILL.md` is a short overview + quick reference. Deep content (cheat sheets, decision trees, examples) lives in `references/` and `examples/`, loaded only when the skill needs them.
4. **Public sources, concretely linked.** All references point to authoritative public material — SAP `styleguides/clean-abap`, [SAP-samples/abap-cheat-sheets](https://github.com/SAP-samples/abap-cheat-sheets), [SAP-samples/abap-platform-rap100](https://github.com/SAP-samples/abap-platform-rap100), `help.sap.com`, and `community.sap.com`. No proprietary code.
5. **Safe by default.** Every agent will *never* release transports, activate to production, or run mass DML. Actions like transport creation, namespace changes, or RAP behavior edits require explicit confirmation.
6. **Topic categorization (4 axes).** Every skill maps to one axis: **Process** (rigid disciplines like code review, debugging), **Pattern** (flexible decision trees like modernization, extensibility), **Reference** (lookup material like Clean ABAP rules, CDS annotations), **Tooling** (effective use of a specific tool). When proposing a new skill, the first question is "which axis?".

---

## Adding your own conventions

The skills are written from public sources only. If you want to add company-specific conventions (anonymized naming rules, known dump patterns, transport procedure), add markdown files under the relevant skill's `references/` folder. Example layout:

```
.claude/skills/abap-clean-style/references/company-naming.md
.claude/skills/abap-systematic-debugging/references/known-dumps.md
```

Then reference the new file from the `## References` section of the skill's `SKILL.md`. Keep anonymized — no customer names, real TR numbers, or production URLs.

To add a whole new skill, start from the scaffold in [`templates/skill/`](templates/skill/) (SKILL.md + `references/` + `examples/` layout), then run `python scripts/validate_skills.py` — it enforces the frontmatter rules (quoted description, `Use when` prefix, ≤ 1024 chars) and link integrity, and requires the skill to be wired into at least one agent's skill map.

---

## Roadmap

Deferred improvements (content lift for thin skills, missing `examples/`, and the
next skills to add — RFC/BAPI connectivity, ATC operations, CDS analytics, ALV
authoring) are tracked in [`docs/roadmap.md`](docs/roadmap.md).

---

## License

MIT — see [LICENSE](LICENSE).

---

## Author

Created by Abdullah Güneş for SAP ABAP development workflows in Claude Code.
