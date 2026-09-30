#!/usr/bin/env python3
"""Regenerate the skill dropdowns in the issue forms from .claude/skills/*.

Source of truth:
  .claude/skills/<name>/SKILL.md -> the lines between each marker pair in
  .github/ISSUE_TEMPLATE/*.yml:
      # BEGIN generated skills (scripts/build_issue_forms.py)
      # END generated skills

Deterministic - CI regenerates and fails on git diff, so adding a skill without refreshing
the forms fails CI. Only the lines between markers are rewritten, at the BEGIN line's
indentation; an unbalanced or nested marker pair exits non-zero.

Usage: python scripts/build_issue_forms.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / ".claude" / "skills"
FORMS_DIR = ROOT / ".github" / "ISSUE_TEMPLATE"
BEGIN_PATTERN = re.compile(r"^(?P<indent>[ ]*)# BEGIN generated skills\b")
END_PATTERN = re.compile(r"^[ ]*# END generated skills\b")


class MarkerError(ValueError):
    """A form has an unbalanced or nested marker pair."""


def skill_slugs(skills_dir: Path = SKILLS_DIR) -> list[str]:
    return sorted(skill_file.parent.name for skill_file in skills_dir.glob("*/SKILL.md"))


def render(text: str, slugs: list[str]) -> str:
    out: list[str] = []
    indent: str | None = None
    for number, line in enumerate(text.splitlines(), start=1):
        begin = BEGIN_PATTERN.match(line)
        if begin:
            if indent is not None:
                raise MarkerError(f"line {number}: BEGIN inside an open marker pair")
            indent = begin.group("indent")
            out.append(line)
            out.extend(f"{indent}- {slug}" for slug in slugs)
        elif END_PATTERN.match(line):
            if indent is None:
                raise MarkerError(f"line {number}: END without BEGIN")
            indent = None
            out.append(line)
        elif indent is None:
            out.append(line)
    if indent is not None:
        raise MarkerError("BEGIN without END")
    return "\n".join(out) + "\n"


def main() -> int:
    slugs = skill_slugs()
    for form in sorted(FORMS_DIR.glob("*.yml")):
        text = form.read_text(encoding="utf-8")
        try:
            rendered = render(text, slugs)
        except MarkerError as error:
            print(f"{form.relative_to(ROOT).as_posix()}: {error}", file=sys.stderr)
            return 1
        if rendered != text:
            form.write_text(rendered, encoding="utf-8", newline="\n")
            print(f"generated {form.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
