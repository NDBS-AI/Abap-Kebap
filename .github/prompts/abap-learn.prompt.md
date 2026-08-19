---
description: "Capture a correction you spotted in ABAP agent output — fix the root skill and lock it with a free static check so it cannot regress. Propose → confirm → apply."
agent: 'agent'
---

<!-- GENERATED from .claude/commands/abap-learn.md by scripts/build_copilot.py - edit the source, then regenerate. -->

The user invoked `/abap-learn` because they caught an error in ABAP output produced by this agent/skill set. Turn that one correction into a permanent fix: correct the root **skill** and lock it with a free **Tier‑1 static check**. Use a strict **propose → confirm → apply** flow — never edit a skill before the user confirms.

Correction reported: ${input:args:what was wrong / what the correct answer is}

Follow these steps in order:

1. **Understand the error.** From the argument above plus the recent conversation, determine: (a) the exact wrong token or claim, (b) the correct value, (c) the affected topic/skill. If any of these is unclear, ask ONE focused question and stop — do not guess.

2. **Sanity-check the correction (cheaply).** The user is an expert and is usually right — trust them by default. Verify only if *you* are unsure the proposed correct value is right, and then with at most one targeted source check per `docs/grounding-protocol.md` (skill first, narrow fetch, no routine fetching). If you find concrete evidence the reported "error" is actually correct or is a context-dependent nuance (e.g. valid only for date-only fields, as with `@Semantics.systemDate.*`), say so plainly and stop — do not change anything on a false premise.

3. **Locate the root.** Search across `.claude/skills/` (and `.claude/agents/`, `docs/` when relevant) to find every place that teaches the wrong token or topic. List them as `path:line`.

4. **Build a proposal — do not apply yet:**
   - **Skill edit(s):** the exact before → after for each affected file, fixing the root cause (not a band-aid).
   - **A Tier‑1 static rule** for `evals/static-checks.json` that locks the lesson:
     - **Dedup first:** grep `evals/static-checks.json` for an existing rule on the same token or topic. If one exists, extend it (pattern, `exclude`, `note`) instead of adding a near-duplicate.
     - a `forbidden` rule for the wrong token (add `exclude` for any file that legitimately discusses the anti-pattern — **always include `docs/lessons.md`**, since the ledger names the wrong token by design, and often `docs/grounding-protocol.md`), and/or
     - a `required` rule for the correct token in the file that should teach it.
     - Give each rule a clear `id` and a `note`. If the correct usage is nuanced (valid in some contexts), encode it as a *project convention* and say so in the note — never a blanket rule that would flag legitimate uses.
     - **Provenance is mandatory:** end every new/extended `note` with either `(grounded: <public SAP source URL or SAP-samples file>)` for an SAP fact — spend the one narrow fetch from step 2 to obtain the citation if you don't already have it — or `(project convention)` when the rule rests on the user's/team's own decision. A locked rule with no provenance cannot be re-verified later.

5. **Present the proposal and STOP.** Show the affected files, the diffs, and the new static rule(s). Ask the user to confirm. Edit nothing yet.

6. **On confirmation, apply** the skill edit(s) and add the static rule(s).

7. **Verify with BOTH gates:** run `python scripts/validate_skills.py` **and** `node evals/run-static.mjs`. Both must pass (exit 0). The validator matters here too: a skill edit can break a description (quoting, 1024-char limit) or introduce a single-letter identifier in example code — static checks alone will not catch that. If a gate fails, fix the content until both pass.

8. **Record the decision and commit.** Append one row to the ledger in `docs/lessons.md` (date | wrong → correct | root file(s) | static rule id(s) | source), then **commit** everything together with a clear message that states the correction and the new guard. Report what changed in one short summary. (If the user prefers, leave the changes staged instead.)

Scope notes:
- Default scope is **skill content + a static rule**. If the error is *behavioral* (faulty reasoning or routing, not wrong content), there may be nothing to grep-lock — say so, and *offer* to add a Tier‑2 behavioral case to `evals/cases/abap-core.json` rather than adding it automatically (Tier 2 is milestone-grade and costs tokens to run).
- If no skill actually teaches the wrong thing (a one-off slip), say "no skill change needed" rather than inventing a change.
- Keep the change minimal and focused on the reported error; do not refactor unrelated content.
