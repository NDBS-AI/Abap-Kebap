# Contributing

This repository is shared across the company. Everyone with access can report problems and propose
changes through GitHub issues; skill contributions arrive as pull requests from a fork.

## Before you write anything

Do not paste customer code, customer or system names, hostnames, SIDs, user names or credentials
into an issue or a pull request. Reduce examples to generic Z objects such as `ZCL_DEMO_ITEMS`.
Everyone with read access can see issues, and GitHub keeps every earlier revision of an edited issue.

## Pick the right form

Open **Issues → New issue** and choose one of four forms. Blank issues are turned off.

| You want to | Form | What happens next |
|---|---|---|
| Report a wrong answer from an agent, a skill or the released-objects MCP server | **Report wrong output** | A maintainer reproduces it and fixes the skill or agent. |
| Point out that an existing skill is missing something or is wrong | **Improve a skill** | A maintainer updates the skill, or you do it through a pull request if you ticked *Contribution*. |
| Ask for a skill on a topic nothing covers yet | **Request a new skill** | A maintainer decides whether and where it fits. |
| Contribute a skill you wrote | **Contribute your own skill** | See [Contributing a skill](#contributing-a-skill). |

Installation and usage are described in the [README](README.md).

## What the bot checks

A workflow checks every issue when it is opened and every time its title or text is edited.

- **Sensitive content** (all forms): passwords, keys and tokens assigned to a value,
  `Authorization` headers, private key blocks, and credentials inside URLs. Replace a value with a
  placeholder such as `<redacted>` or `****`; placeholders pass. The bot names the field but
  never repeats the value.
- **Skill slug** (*Request a new skill* if filled, *Contribute your own skill*): lowercase
  kebab-case, starting with `abap-`, `rap-`, `cds-`, `fiori-` or `enhancements-`, at most 64
  characters, and not the name of an existing skill.
- **Frontmatter description** (*Contribute your own skill*): starts with `Use when`, has at least
  50 words and at most 1024 characters. `scripts/validate_skills.py` applies the same rules to
  every skill, so a description that passes here also passes in the pull request.
- **Sources** (*Improve a skill*, *Contribute your own skill*, and *Request a new skill* if it
  contains a link): at least one public SAP link. These count: `help.sap.com`,
  `community.sap.com`, `developers.sap.com`, `api.sap.com`, `learning.sap.com`, `www.sap.com`,
  `sap.github.io`, and GitHub repositories of the `SAP`, `SAP-samples` and `SAP-docs`
  organisations. SAP Notes need a login and do not count on their own. Other public links are
  welcome alongside an SAP link.

When a check fails, the bot adds the `needs-info` label and writes one comment listing what to
fix. Edit the issue to fix it: the checks run again and the same comment updates. When everything
passes, the comment says so and `needs-info` goes away. An issue that keeps `needs-info` for 10
days without activity gets a warning, and it closes 4 days later.

If you pasted a real credential by mistake: rotate it first, then edit the issue to remove it,
then ask a maintainer to delete the old revision from the issue's edit history.

## Contributing a skill

You need Python 3.12 or later with PyYAML (`pip install pyyaml`) and Node.js 20 or later.

1. Open a **Contribute your own skill** issue. The bot checks the slug, description and sources.
2. A maintainer discusses the scope in the issue and adds the `approved` label when it fits.
3. Fork the repository and build the skill from [`templates/skill/`](templates/skill/):
   `SKILL.md` plus `references/` and `examples/`, in English, citing public sources only.
4. Wire the skill into at least one agent's skill map in
   [`.claude/skill-clusters.json`](.claude/skill-clusters.json), or list it under
   `standalone_skills`. `scripts/validate_skills.py` fails on a skill no agent can reach.
5. Run the gates:

   ```bash
   python scripts/generate_skill_index.py
   python scripts/validate_skills.py
   node evals/run-static.mjs
   python scripts/build_issue_forms.py
   python -m unittest discover -s scripts -p "test_*.py"
   node --test scripts/issue-triage/*.test.mjs
   ```

   `generate_skill_index.py` and `build_issue_forms.py` rewrite generated files
   (`.claude/skill-index.json` and the skill lists in `.github/ISSUE_TEMPLATE`). Commit those
   changes with your skill. In PowerShell with Node.js 20, pass the three `*.test.mjs` files by
   name instead of the pattern.
6. Open a pull request with `Closes #<issue number>` in the description. The pull request
   template lists the same gates and confirmations, and CI runs the gates on your pull request.
7. A maintainer reviews and merges.

Everything you contribute is licensed under the repository's [MIT license](LICENSE).

## Improving an existing skill yourself

Tick *Contribution* on the **Improve a skill** form and wait for a maintainer to agree in the
issue. Then follow steps 3 to 7 above with your change to the existing skill.
