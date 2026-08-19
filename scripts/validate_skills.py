#!/usr/bin/env python3
"""Validate skill and agent manifests under .claude/ (frontmatter, links, wiring).

Hard errors (exit 1): broken/hazardous YAML frontmatter, over-limit or
low-quality descriptions, broken local links anywhere in a skill directory,
dangling skill references in agent files, skills unreachable from any agent.
Warnings (exit 0): reference/example files not mentioned in their SKILL.md.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

try:
    import yaml
except ImportError:
    print("PyYAML is required to validate frontmatter: pip install pyyaml", file=sys.stderr)
    raise SystemExit(2)


ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / ".claude" / "skills"
AGENTS_DIR = ROOT / ".claude" / "agents"
FRONTMATTER_PATTERN = re.compile(r"\A---\n(.*?)\n---(?:\n|\Z)", re.DOTALL)
MARKDOWN_LINK_PATTERN = re.compile(r"(?<!!)\[[^]]*]\(([^)]+)\)")

# Claude Code caps skill descriptions; anything longer is truncated or dropped
# at load time, silently killing the skill's trigger.
MAX_DESCRIPTION_CHARS = 1024

# Backticked tokens with these shapes are treated as skill/agent references in
# agent files and must resolve to an existing skill directory or agent file.
BACKTICK_REF_PATTERN = re.compile(r"`((?:abap|rap|cds|fiori|enhancements)-[a-z0-9-]+)`")

# Clean ABAP (project policy): no single-letter identifiers in example code.
# Keywords are matched uppercase as written in the skill code blocks.
SINGLE_LETTER_PATTERNS = [
    re.compile(r"(?:INTO\s+)?@?DATA\([a-zA-Z]\)"),
    re.compile(r"FIELD-SYMBOL\(<[a-zA-Z]>\)"),
    re.compile(r"\bFOR [a-zA-Z] IN\b"),
    re.compile(r"\bFOR <[a-zA-Z]> IN\b"),
    # Conditional-iteration FOR (e.g. `FOR x = 1 WHILE x <= 20 ( x )`), as
    # distinct from the table-iteration `FOR ... IN` forms above.
    re.compile(r"\bFOR [a-zA-Z] =(?!=)"),
    # Grouping FOR (e.g. `FOR GROUPS g OF line IN tab`): a bare single-letter
    # group key. A multi-char key such as `FOR GROUPS group OF` is not matched.
    re.compile(r"\bFOR GROUPS [a-zA-Z] OF\b"),
    re.compile(r"VALUE\([a-zA-Z]\)"),
    re.compile(r"\bLET [a-zA-Z] =(?!=)"),
    re.compile(r"\bINIT [a-zA-Z] =(?!=)"),
]


def check_single_letter_identifiers(file_path: Path, relative_path: Path) -> list[str]:
    """Flag single-letter ABAP identifiers (loop vars, field symbols, params)."""
    errors: list[str] = []
    for line_number, line in enumerate(
        file_path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        for pattern in SINGLE_LETTER_PATTERNS:
            match = pattern.search(line)
            if match:
                errors.append(
                    f"{relative_path}:{line_number}: single-letter identifier "
                    f"{match.group(0)!r} violates Clean ABAP naming"
                )
    return errors


def parse_frontmatter(text: str, relative_path: Path) -> tuple[dict | None, str | None, list[str]]:
    """Parse YAML frontmatter. Returns (parsed dict, raw block, errors)."""
    match = FRONTMATTER_PATTERN.match(text)
    if not match:
        return None, None, [f"{relative_path}: missing YAML frontmatter"]

    raw = match.group(1)
    try:
        parsed = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        message = str(exc).splitlines()[0]
        return None, raw, [
            f"{relative_path}: frontmatter is not valid YAML ({message}) - "
            f"quote scalar values containing ': ' or ' #'"
        ]
    if not isinstance(parsed, dict):
        return None, raw, [f"{relative_path}: frontmatter must be a YAML mapping"]
    return parsed, raw, []


def unquoted_hash_error(raw_frontmatter: str, key: str, relative_path: Path) -> str | None:
    """Detect an unquoted ' #' in a plain scalar — YAML silently truncates there."""
    match = re.search(rf"^{re.escape(key)}:\s*(.+)$", raw_frontmatter, re.MULTILINE)
    if not match:
        return None
    raw_value = match.group(1).strip()
    if raw_value and raw_value[0] not in "\"'>|" and " #" in raw_value:
        return (
            f"{relative_path}: unquoted ' #' in {key} starts a YAML comment and "
            f"silently truncates the value - quote the whole string"
        )
    return None


def strip_code(text: str) -> str:
    """Remove fenced code blocks and inline code spans (ABAP syntax notation
    like [pos](len) inside them is not a markdown link)."""
    text = re.sub(r"^```.*?^```", "", text, flags=re.DOTALL | re.MULTILINE)
    return re.sub(r"`[^`\n]*`", "", text)


def check_local_links(md_file: Path, base_relative: Path) -> list[str]:
    """Validate that markdown links in md_file resolve to existing local files."""
    errors: list[str] = []
    text = strip_code(md_file.read_text(encoding="utf-8"))
    for raw_target in MARKDOWN_LINK_PATTERN.findall(text):
        target = unquote(raw_target.split("#", 1)[0].strip())
        # Skip external URLs (start with protocol) and anchor-only links
        if not target or re.match(r"^[a-z][a-z0-9+.-]*:", target, re.IGNORECASE):
            continue
        resolved_path = (md_file.parent / target).resolve()
        if not resolved_path.exists():
            errors.append(f"{base_relative}: broken local link {raw_target!r}")
    return errors


def validate_skill(skill_file: Path) -> tuple[list[str], list[str]]:
    """Validate a single SKILL.md file. Returns (errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []
    relative_path = skill_file.relative_to(ROOT)
    text = skill_file.read_text(encoding="utf-8")

    parsed, raw, fm_errors = parse_frontmatter(text, relative_path)
    errors.extend(fm_errors)
    if raw is not None:
        for key in ("name", "description"):
            hash_error = unquoted_hash_error(raw, key, relative_path)
            if hash_error:
                errors.append(hash_error)
    if parsed is None:
        return errors, warnings

    # Frontmatter must have exactly the required fields (name and description)
    fm_keys = set(parsed.keys())
    if fm_keys != {"name", "description"}:
        unexpected = fm_keys - {"name", "description"}
        missing = {"name", "description"} - fm_keys
        if unexpected:
            errors.append(f"{relative_path}: unexpected frontmatter fields: {unexpected}")
        if missing:
            errors.append(f"{relative_path}: missing frontmatter fields: {missing}")

    name = parsed.get("name")
    description = parsed.get("description")

    # Validate name matches directory name
    if not name:
        errors.append(f"{relative_path}: missing frontmatter name")
    elif str(name) != skill_file.parent.name:
        errors.append(
            f"{relative_path}: name {name!r} must match folder "
            f"{skill_file.parent.name!r}"
        )

    # Validate description exists and its trigger quality
    if not description:
        errors.append(f"{relative_path}: missing frontmatter description")
    else:
        description = str(description)
        if not description.startswith("Use when"):
            errors.append(f"{relative_path}: description must start with 'Use when'")
        if len(description.split()) < 50:
            errors.append(f"{relative_path}: description is short (< 50 words)")
        if len(description) > MAX_DESCRIPTION_CHARS:
            errors.append(
                f"{relative_path}: description is {len(description)} chars "
                f"(max {MAX_DESCRIPTION_CHARS} - Claude Code drops longer ones at load)"
            )

    # Check for @skills/ references (should use relative paths instead)
    if "@skills/" in text:
        errors.append(
            f"{relative_path}: use paths relative to SKILL.md instead of @skills/"
        )

    # Validate markdown links and identifier naming in SKILL.md and every
    # .md/.abap file under the skill directory
    skill_dir = skill_file.parent
    errors.extend(check_local_links(skill_file, relative_path))
    errors.extend(check_single_letter_identifiers(skill_file, relative_path))
    for subdir in ["references", "examples"]:
        subdir_path = skill_dir / subdir
        if not subdir_path.exists():
            continue
        for file_path in sorted(subdir_path.rglob("*.abap")):
            errors.extend(
                check_single_letter_identifiers(file_path, file_path.relative_to(ROOT))
            )
        for file_path in sorted(subdir_path.rglob("*.md")):
            errors.extend(check_local_links(file_path, file_path.relative_to(ROOT)))
            errors.extend(
                check_single_letter_identifiers(file_path, file_path.relative_to(ROOT))
            )
            # Check that the file is mentioned in SKILL.md (README.md exempt)
            if file_path.name == "README.md":
                continue
            mention_pattern = str(file_path.relative_to(skill_dir)).replace("\\", "/")
            if mention_pattern not in text:
                warnings.append(
                    f"{relative_path}: file {mention_pattern} not mentioned in SKILL.md"
                )

    return errors, warnings


def validate_agents(skill_names: set[str]) -> tuple[list[str], list[str]]:
    """Validate agent manifests and the agent↔skill wiring."""
    errors: list[str] = []
    warnings: list[str] = []

    agent_files = sorted(AGENTS_DIR.glob("*.md")) if AGENTS_DIR.exists() else []
    if not agent_files:
        return [f"No agent manifests found in {AGENTS_DIR.relative_to(ROOT)}"], warnings

    agent_names = {agent_file.stem for agent_file in agent_files}
    combined_text = ""

    for agent_file in agent_files:
        relative_path = agent_file.relative_to(ROOT)
        text = agent_file.read_text(encoding="utf-8")
        combined_text += text

        parsed, raw, fm_errors = parse_frontmatter(text, relative_path)
        errors.extend(fm_errors)
        if raw is not None:
            hash_error = unquoted_hash_error(raw, "description", relative_path)
            if hash_error:
                errors.append(hash_error)
        if parsed is None:
            continue

        name = parsed.get("name")
        if not name:
            errors.append(f"{relative_path}: missing frontmatter name")
        elif str(name) != agent_file.stem:
            errors.append(
                f"{relative_path}: name {name!r} must match file stem {agent_file.stem!r}"
            )
        if not parsed.get("description"):
            errors.append(f"{relative_path}: missing frontmatter description")

        # Every backticked skill-shaped token must resolve to a skill or agent
        for token in sorted(set(BACKTICK_REF_PATTERN.findall(text))):
            if token not in skill_names and token not in agent_names:
                errors.append(
                    f"{relative_path}: reference `{token}` matches no skill "
                    f"directory or agent file"
                )

    # Every skill must be reachable from at least one agent's skill map
    for skill_name in sorted(skill_names):
        if skill_name not in combined_text:
            errors.append(
                f".claude/agents: skill {skill_name!r} is not referenced by any agent"
            )

    return errors, warnings


def validate_plugin_manifests() -> list[str]:
    """Validate the Claude Code plugin and marketplace manifests."""
    errors: list[str] = []
    plugin_dir = ROOT / ".claude-plugin"

    for filename in ("plugin.json", "marketplace.json"):
        path = plugin_dir / filename
        if not path.exists():
            errors.append(f".claude-plugin/{filename}: missing")
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f".claude-plugin/{filename}: invalid JSON ({exc})")
            continue
        name = data.get("name", "")
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name):
            errors.append(
                f".claude-plugin/{filename}: name {name!r} must be kebab-case"
            )
        if filename == "plugin.json":
            for key in ("skills", "commands"):
                component_path = data.get(key)
                if component_path and not (ROOT / component_path).exists():
                    errors.append(
                        f".claude-plugin/{filename}: {key} path "
                        f"{component_path!r} does not exist"
                    )
            # The CLI schema requires agents as explicit .md file paths, so the
            # list must stay in exact sync with .claude/agents/*.md.
            agents_value = data.get("agents", [])
            if isinstance(agents_value, str):
                agents_value = [agents_value]
            declared = {Path(agent_path).name for agent_path in agents_value}
            actual = {agent_file.name for agent_file in AGENTS_DIR.glob("*.md")}
            if declared != actual:
                missing = actual - declared
                extra = declared - actual
                if missing:
                    errors.append(
                        f".claude-plugin/{filename}: agents list is missing {sorted(missing)}"
                    )
                if extra:
                    errors.append(
                        f".claude-plugin/{filename}: agents list has entries "
                        f"with no source file: {sorted(extra)}"
                    )
        else:
            for entry in data.get("plugins", []):
                source = entry.get("source")
                if isinstance(source, str) and source.startswith("./"):
                    if not (ROOT / source).exists():
                        errors.append(
                            f".claude-plugin/{filename}: plugin source "
                            f"{source!r} does not exist"
                        )

    return errors


def main() -> int:
    """Validate all skills and agents."""
    if not SKILLS_DIR.exists():
        print(f"Skills directory not found: {SKILLS_DIR}", file=sys.stderr)
        return 1

    skill_files = sorted(SKILLS_DIR.glob("*/SKILL.md"))
    if not skill_files:
        print(f"No skill manifests found in {SKILLS_DIR}", file=sys.stderr)
        return 1

    errors: list[str] = []
    warnings: list[str] = []
    for skill_file in skill_files:
        skill_errors, skill_warnings = validate_skill(skill_file)
        errors.extend(skill_errors)
        warnings.extend(skill_warnings)

    skill_names = {skill_file.parent.name for skill_file in skill_files}
    agent_errors, agent_warnings = validate_agents(skill_names)
    errors.extend(agent_errors)
    warnings.extend(agent_warnings)
    errors.extend(validate_plugin_manifests())

    if errors:
        print("Validation FAILED:", file=sys.stderr)
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        print(file=sys.stderr)

    if warnings:
        print("Validation WARNINGS:", file=sys.stderr)
        for warning in warnings:
            print(f"WARN: {warning}", file=sys.stderr)
        print(file=sys.stderr)

    if not errors:
        agent_count = len(list(AGENTS_DIR.glob("*.md"))) if AGENTS_DIR.exists() else 0
        print(f"Validated {len(skill_files)} skill manifests and {agent_count} agent manifests.")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
