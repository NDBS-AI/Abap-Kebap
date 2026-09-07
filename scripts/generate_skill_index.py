#!/usr/bin/env python3
"""Generate the skill discovery registry used by agent skill routing.

The registry holds only trigger metadata (name, description, path) for every
skill — never skill bodies. Agents read this small control-plane file to find
standalone skills that no cluster covers; run this after adding, removing, or
editing any skill's frontmatter.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / ".claude" / "skills"
TARGET = ROOT / ".claude" / "skill-index.json"
FRONTMATTER_PATTERN = re.compile(r"\A---\n(.*?)\n---(?:\n|\Z)", re.DOTALL)


def main() -> int:
    entries = []
    for skill_file in sorted(SKILLS_DIR.glob("*/SKILL.md")):
        text = skill_file.read_text(encoding="utf-8")
        match = FRONTMATTER_PATTERN.match(text)
        if not match:
            raise SystemExit(f"{skill_file}: missing frontmatter")
        data = yaml.safe_load(match.group(1))
        entries.append({
            "name": str(data["name"]),
            "description": str(data["description"]),
            "path": skill_file.relative_to(ROOT).as_posix(),
        })

    payload = {
        "schema_version": 1,
        "generated_from": ".claude/skills/*/SKILL.md",
        "routing_contract": "docs/skill-routing.md",
        "skill_count": len(entries),
        "skills": entries,
    }
    TARGET.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"generated {TARGET.relative_to(ROOT)} ({len(entries)} skills)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
