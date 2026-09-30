Closes #

## What changed

<!-- One or two sentences. For a new skill: its name and what it covers. -->

## Gates

Run these before opening the pull request; CI runs the same gates.

- [ ] `python scripts/generate_skill_index.py`
- [ ] `python scripts/validate_skills.py`
- [ ] `node evals/run-static.mjs`
- [ ] `python scripts/build_issue_forms.py`
- [ ] `python -m unittest discover -s scripts -p "test_*.py"`
- [ ] `node --test scripts/issue-triage/*.test.mjs`
- [ ] `cd mcp/released-objects && npm test` (only if the MCP server changed)

## Confirmations

- [ ] All content is in English.
- [ ] Sources are public, including at least one public SAP source.
- [ ] No customer or project names, hostnames, user names or credentials.
