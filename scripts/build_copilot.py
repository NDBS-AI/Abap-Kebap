#!/usr/bin/env python3
"""Generate GitHub Copilot mirrors from the Claude Code sources.

Sources of truth:
  .claude/agents/<name>.md   -> .github/agents/<name>.agent.md   (custom agents)
  .claude/commands/<name>.md -> .github/prompts/<name>.prompt.md (prompt files)

Deterministic - CI regenerates and fails on git diff, so hand edits to the
mirrors cannot drift from the sources. Copilot reads the skills themselves as
files from .claude/skills/ on the cue in AGENTS.md; only the agent role prompts
and the slash commands need this translation.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("PyYAML is required: pip install pyyaml", file=sys.stderr)
    raise SystemExit(2)


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / ".claude" / "agents"
TARGET_DIR = ROOT / ".github" / "agents"
COMMAND_SOURCE_DIR = ROOT / ".claude" / "commands"
PROMPT_TARGET_DIR = ROOT / ".github" / "prompts"
FRONTMATTER_PATTERN = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)

# Copilot's cloud agent enforces a 30,000-character prompt body cap.
MAX_BODY_CHARS = 30_000

# Claude-specific phrasing -> Copilot-native equivalent. Copilot has no Skill
# tool; it auto-loads skills from .claude/skills/ and users can invoke them
# directly, so the instruction becomes "use the skill" rather than "load it".
BODY_REPLACEMENTS = [
    ("load the relevant one via the `Skill` tool",
     "use the relevant agent skill (Copilot loads them from `.claude/skills/`)"),
    ("load this skill via `Skill`", "use this skill"),
    ("via the `Skill` tool", "from your agent skills"),
    ("via `Skill`", "from your agent skills"),
    ("the `Skill` tool", "your agent skills"),
]

# Claude tool-name phrasing in slash commands -> Copilot-native.
COMMAND_BODY_REPLACEMENTS = [
    ("Use Grep over", "Search across"),
]


def build_agent(source: Path) -> str:
    text = source.read_text(encoding="utf-8")
    match = FRONTMATTER_PATTERN.match(text)
    if not match:
        raise SystemExit(f"{source}: missing frontmatter")
    frontmatter = yaml.safe_load(match.group(1))
    body = text[match.end():]

    for old, new in BODY_REPLACEMENTS:
        body = body.replace(old, new)

    if len(body) > MAX_BODY_CHARS:
        raise SystemExit(
            f"{source}: body is {len(body)} chars, over Copilot's "
            f"{MAX_BODY_CHARS} cap - trim the source agent"
        )

    # Copilot agent frontmatter: name + description only. Claude's tools/
    # model/color fields do not translate; omitting tools grants the default
    # set, which matches these agents' read-inspect-propose role.
    name = json.dumps(frontmatter["name"], ensure_ascii=False)
    description = json.dumps(frontmatter["description"], ensure_ascii=False)
    header = (
        f"---\n"
        f"name: {name}\n"
        f"description: {description}\n"
        f"---\n\n"
        f"<!-- GENERATED from .claude/agents/{source.name} by "
        f"scripts/build_copilot.py - edit the source, then regenerate. -->\n"
    )
    return header + body


def build_prompt(source: Path) -> str:
    text = source.read_text(encoding="utf-8")
    match = FRONTMATTER_PATTERN.match(text)
    if not match:
        raise SystemExit(f"{source}: missing frontmatter")
    frontmatter = yaml.safe_load(match.group(1))
    body = text[match.end():]

    for old, new in BODY_REPLACEMENTS:
        body = body.replace(old, new)
    for old, new in COMMAND_BODY_REPLACEMENTS:
        body = body.replace(old, new)

    # Claude passes free-text args as $ARGUMENTS; VS Code prompt files collect
    # them at runtime via ${input:...}. Derive the placeholder from the
    # command's argument-hint (unquoted [..] in YAML parses as a list).
    if "$ARGUMENTS" in body:
        hint = frontmatter.get("argument-hint", "your input")
        if isinstance(hint, list):
            hint = ", ".join(str(item) for item in hint)
        hint = str(hint).strip().strip("[]").strip() or "your input"
        body = body.replace("$ARGUMENTS", "${input:args:" + hint + "}")

    # Prompt-file frontmatter: description + agent mode. abap-learn edits skills
    # and runs the gates, so it needs the acting agent, not a read-only mode.
    description = json.dumps(frontmatter["description"], ensure_ascii=False)
    header = (
        f"---\n"
        f"description: {description}\n"
        f"agent: 'agent'\n"
        f"---\n\n"
        f"<!-- GENERATED from .claude/commands/{source.name} by "
        f"scripts/build_copilot.py - edit the source, then regenerate. -->\n"
    )
    return header + body


def main() -> int:
    sources = sorted(SOURCE_DIR.glob("*.md"))
    if not sources:
        print(f"No agent sources found in {SOURCE_DIR}", file=sys.stderr)
        return 1

    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    expected = {f"{source.stem}.agent.md" for source in sources}

    for source in sources:
        target = TARGET_DIR / f"{source.stem}.agent.md"
        target.write_text(build_agent(source), encoding="utf-8", newline="\n")
        print(f"generated {target.relative_to(ROOT)}")

    # Remove mirrors whose source agent was deleted
    for stale in TARGET_DIR.glob("*.agent.md"):
        if stale.name not in expected:
            stale.unlink()
            print(f"removed stale {stale.relative_to(ROOT)}")

    # Prompt-file mirrors for slash commands
    command_sources = sorted(COMMAND_SOURCE_DIR.glob("*.md")) if COMMAND_SOURCE_DIR.exists() else []
    if command_sources:
        PROMPT_TARGET_DIR.mkdir(parents=True, exist_ok=True)
        expected_prompts = {f"{source.stem}.prompt.md" for source in command_sources}
        for source in command_sources:
            target = PROMPT_TARGET_DIR / f"{source.stem}.prompt.md"
            target.write_text(build_prompt(source), encoding="utf-8", newline="\n")
            print(f"generated {target.relative_to(ROOT)}")
        for stale in PROMPT_TARGET_DIR.glob("*.prompt.md"):
            if stale.name not in expected_prompts:
                stale.unlink()
                print(f"removed stale {stale.relative_to(ROOT)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
