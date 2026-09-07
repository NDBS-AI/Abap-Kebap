#!/usr/bin/env python3
"""Validate skill and agent manifests under .claude/ (frontmatter, links, wiring).

Hard errors (exit 1): broken/hazardous YAML frontmatter, over-limit or
low-quality descriptions, broken local links anywhere in a skill directory,
dangling skill references in agent files, a stale/incomplete generated skill
registry (.claude/skill-index.json), a skill-clusters.json entry naming an
unknown skill or role, a skill reachable through none of Tier-1 preload /
a cluster / standalone_skills, a standalone_skills entry that is ALSO a
Tier-1 preload or cluster member (standalone_skills must be a skill's only
route), a role's own cluster redundantly including a skill that role
already preloads (Tier-1 preload and cluster membership may otherwise
legitimately coexist — but only across DIFFERENT roles), skill-clusters.json
/ skill-index.json / a plugin manifest being syntactically valid JSON but
the wrong shape (a bare list, a cluster/`includes` of the wrong type, a
non-string `name`/`description`, a plugin manifest's `skills`/`commands`/
`agents`/`plugins` fields of the wrong type), or an agent's `skills:` list
containing a non-string entry.
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
SKILL_INDEX = ROOT / ".claude" / "skill-index.json"
SKILL_CLUSTERS = ROOT / ".claude" / "skill-clusters.json"
FRONTMATTER_PATTERN = re.compile(r"\A---\n(.*?)\n---(?:\n|\Z)", re.DOTALL)
MARKDOWN_LINK_PATTERN = re.compile(r"(?<!!)\[[^]]*]\(([^)]+)\)")

# This repo ships as a Claude Code plugin: a dispatched agent's cwd is the
# user's own project, not this plugin's install directory. Every live routing
# instruction that reads a plugin-bundled file (not a Skill-tool-addressed
# skill) must use this prefix or the read resolves against the wrong project.
PLUGIN_ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}"

# Every agent's `skills:` frontmatter (Tier-1 preload) must include at least
# these — the guarantee that a review found silently dropped once already
# when routing moved from a fixed preload to pure task-time selection.
REQUIRED_PRELOADS: dict[str, set[str]] = {
    "abap-kebap-architect": {"abap-clean-style", "rap-bo-modeling", "cds-views-authoring"},
    "abap-kebap-developer": {"abap-clean-style", "abap-unit-tdd", "abap-sql-performance"},
    "abap-kebap-reviewer": {"abap-code-review", "abap-clean-style", "abap-sql-performance"},
}

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


def check_agent_plugin_links(md_file: Path, base_relative: Path) -> list[str]:
    """Every local (non-URL) markdown link inside an agent file must be
    ${CLAUDE_PLUGIN_ROOT}-prefixed. A dispatched subagent's cwd is the
    user's own project, not this plugin's install directory, so a bare
    relative link resolves against the wrong project once installed
    elsewhere."""
    errors: list[str] = []
    text = strip_code(md_file.read_text(encoding="utf-8"))
    for raw_target in MARKDOWN_LINK_PATTERN.findall(text):
        target = unquote(raw_target.split("#", 1)[0].strip())
        if not target or re.match(r"^[a-z][a-z0-9+.-]*:", target, re.IGNORECASE):
            continue
        if not target.startswith(PLUGIN_ROOT_VAR):
            errors.append(
                f"{base_relative}: local link {raw_target!r} is not "
                f"{PLUGIN_ROOT_VAR}-prefixed - it resolves against the "
                "user's project, not this plugin, once installed elsewhere"
            )
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
    clusters_data, cluster_errors = load_skill_clusters()
    errors.extend(cluster_errors)
    clusters_by_role = clusters_data.get("clusters", {}) if clusters_data else {}
    all_preloaded: set[str] = set()
    preloads_by_role: dict[str, set[str]] = {}

    for agent_file in agent_files:
        relative_path = agent_file.relative_to(ROOT)
        text = agent_file.read_text(encoding="utf-8")
        role_cluster_names = set(clusters_by_role.get(agent_file.stem, {}).keys())

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

        # The `skills:` frontmatter (Tier-1 preload) must be a list of real
        # skill directories — a typo here silently drops that skill from the
        # subagent's startup context with no other signal.
        preloaded = parsed.get("skills", []) or []
        if not isinstance(preloaded, list):
            errors.append(f"{relative_path}: `skills:` frontmatter must be a list")
            preloaded = []
        elif not all(isinstance(skill, str) for skill in preloaded):
            errors.append(f"{relative_path}: `skills:` entries must all be strings")
            preloaded = []
        for skill in preloaded:
            if skill not in skill_names:
                errors.append(
                    f"{relative_path}: preloaded skill {skill!r} in `skills:` "
                    "frontmatter does not exist"
                )
        all_preloaded.update(preloaded)
        preloads_by_role[agent_file.stem] = set(preloaded)

        # Structural check on the parsed YAML, independent of the textual
        # locks in evals/static-checks.json — a prior external redesign
        # satisfied a textual "- abap-clean-style" pattern with an unrelated
        # bullet in prose while the frontmatter itself no longer preloaded it.
        required = REQUIRED_PRELOADS.get(agent_file.stem, set())
        missing_required = required - set(preloaded)
        for skill in sorted(missing_required):
            errors.append(
                f"{relative_path}: `skills:` frontmatter must preload {skill!r} "
                "(REQUIRED_PRELOADS in this script) - it cannot be left to "
                "task-time routing"
            )

        # Every backticked skill-shaped token must resolve to a skill, an
        # agent, or one of this agent's own cluster names.
        for token in sorted(set(BACKTICK_REF_PATTERN.findall(text))):
            if token not in skill_names and token not in agent_names and token not in role_cluster_names:
                errors.append(
                    f"{relative_path}: reference `{token}` matches no skill "
                    f"directory, agent file, or cluster name for this role"
                )

        # Every agent must link the shared routing protocol and instruct use
        # of the generated registry + cluster file — the registry is now the
        # reachability layer, replacing the old "must appear in some agent's
        # static map" text search. This repo ships as a plugin, so a dispatched
        # agent's cwd is the user's project, not this repo — every live-read
        # reference must carry the ${CLAUDE_PLUGIN_ROOT} prefix or it resolves
        # against the wrong directory once installed elsewhere.
        for required_ref, label in (
            (f"{PLUGIN_ROOT_VAR}/docs/skill-routing.md", "shared skill-routing protocol link"),
            (f"{PLUGIN_ROOT_VAR}/.claude/skill-index.json", "skill-index registry preflight instruction"),
            (f"{PLUGIN_ROOT_VAR}/.claude/skill-clusters.json", "skill-clusters preflight instruction"),
        ):
            if required_ref not in text:
                errors.append(
                    f"{relative_path}: missing {label} with the "
                    f"{PLUGIN_ROOT_VAR} prefix ({required_ref!r}) - a bare "
                    "relative path resolves against the user's project, not "
                    "this plugin, once installed elsewhere"
                )

        # General case of the same problem: ANY local (non-URL) markdown link
        # in an agent file must be ${CLAUDE_PLUGIN_ROOT}-prefixed, not just
        # the three routing resources above - a bare relative link to a
        # bundled doc (grounding-protocol.md, agent-orchestration.md, a
        # skill's own reference file) has the identical wrong-directory
        # failure mode once this plugin is installed into another project.
        errors.extend(check_agent_plugin_links(agent_file, relative_path))

    errors.extend(validate_skill_index(skill_names))
    if clusters_data is not None:
        errors.extend(validate_skill_clusters(clusters_data, skill_names, agent_names))
        errors.extend(validate_no_same_role_redundancy(clusters_by_role, preloads_by_role))
        standalone_errors, standalone_names = validate_standalone_skills(
            clusters_data, skill_names, clusters_by_role, all_preloaded
        )
        errors.extend(standalone_errors)
        errors.extend(validate_orphaned_skills(skill_names, all_preloaded, clusters_by_role, standalone_names))
        errors.extend(
            validate_routing_eval_fixtures(agent_names, clusters_by_role, skill_names)
        )

    return errors, warnings


def validate_no_same_role_redundancy(
    clusters_by_role: dict, preloads_by_role: dict[str, set[str]]
) -> list[str]:
    """Tier-1 preload and cluster membership may coexist across DIFFERENT
    roles (a skill Tier-1 for the architect can separately be cluster-routed
    for the developer — two agents independently choosing to route to it).
    But for the SAME role, a cluster listing a skill that role already
    preloads adds no knowledge and just makes the routing config misleading
    — the cluster's own note already says to omit a role's own Tier-1
    skills from `includes` for this reason; this enforces it structurally."""
    errors: list[str] = []
    for role, clusters in clusters_by_role.items():
        own_preloads = preloads_by_role.get(role, set())
        for cluster_name, cluster in clusters.items():
            overlap = own_preloads & set(cluster.get("includes", []))
            for skill in sorted(overlap):
                errors.append(
                    f".claude/skill-clusters.json: {role}/{cluster_name!r} "
                    f"includes {skill!r}, which is already a Tier-1 preload "
                    f"for {role} — remove it from this cluster's includes"
                )
    return errors


def validate_standalone_skills(
    data: dict, skill_names: set[str], clusters_by_role: dict, preloaded: set[str]
) -> tuple[list[str], set[str]]:
    """Validate the `standalone_skills` allowlist: every listed name must be a
    real skill, and `standalone_skills` must be its ONLY declared route — not
    also a cluster member, and not also a Tier-1 preload for any role. Note
    what this deliberately does NOT forbid: a skill can legitimately be a
    Tier-1 preload for one role and a cluster member for another (e.g.
    cds-views-authoring is Tier-1 for the architect and separately listed in
    the developer's rap-business-object cluster) — that is two different
    agents independently routing to the same skill, not a redundancy.
    Returns (errors, the allowlisted names)."""
    errors: list[str] = []
    entry = data.get("standalone_skills", {})
    raw_names = entry.get("skills", []) if isinstance(entry, dict) else []
    if not isinstance(raw_names, list):
        errors.append(
            ".claude/skill-clusters.json: standalone_skills.skills must be a list"
        )
        raw_names = []
    elif not all(isinstance(item, str) for item in raw_names):
        errors.append(
            ".claude/skill-clusters.json: standalone_skills.skills entries "
            "must all be strings"
        )
        raw_names = []
    names = set(raw_names)

    clustered: set[str] = set()
    for clusters in clusters_by_role.values():
        for cluster in clusters.values():
            clustered.update(cluster.get("includes", []))

    for name in sorted(names):
        if name not in skill_names:
            errors.append(
                f".claude/skill-clusters.json: standalone_skills lists "
                f"{name!r}, which does not exist"
            )
            continue
        if name in clustered:
            errors.append(
                f".claude/skill-clusters.json: {name!r} is listed in "
                "standalone_skills but is also included in a cluster — "
                "standalone_skills means no other route exists; remove it "
                "from one"
            )
        if name in preloaded:
            errors.append(
                f".claude/skill-clusters.json: {name!r} is listed in "
                "standalone_skills but is also a Tier-1 preload for some "
                "agent — standalone_skills means no other route exists; "
                "remove it from standalone_skills"
            )
    return errors, names


def validate_orphaned_skills(
    skill_names: set[str],
    preloaded: set[str],
    clusters_by_role: dict,
    standalone_names: set[str],
) -> list[str]:
    """Every skill must be reachable through at least one of three declared
    routes: a Tier-1 preload (for some role), some role's cluster `includes`,
    or the `standalone_skills` allowlist — a skill outside all three isn't an
    ambiguous case needing human judgment, it's a skill nobody routed: a
    whole cluster silently deleted, a skill dropped from every cluster it was
    ever in, or a new skill added without being wired anywhere. Hard error,
    not a warning — an undeclared gap here is exactly the kind of thing a
    warning lets a contributor learn to ignore.

    This does NOT require exactly one route: Tier-1 preload and cluster
    membership may legitimately coexist (a skill Tier-1 for one role can be
    separately cluster-routed for another). `validate_standalone_skills`
    covers the one combination that IS forbidden — standalone_skills must be
    a skill's only route, never alongside a preload or cluster entry."""
    clustered: set[str] = set()
    for clusters in clusters_by_role.values():
        for cluster in clusters.values():
            clustered.update(cluster.get("includes", []))
    covered = preloaded | clustered | standalone_names
    orphans = sorted(skill_names - covered)
    return [
        f".claude/skill-clusters.json: {name!r} is reachable through none of "
        "Tier-1 preload, a cluster's includes, or standalone_skills — add it "
        "to whichever applies"
        for name in orphans
    ]


def validate_cluster_schema(data: object) -> list[str]:
    """Defensive type-check of skill-clusters.json's full shape, run once
    right after JSON parsing succeeds. Syntactically valid JSON can still be
    the wrong shape (a bare list, a cluster that's a string, `includes` that's
    a string instead of a list of strings) — every downstream function
    assumes `.get()` / `.items()` / list-of-strings work, so an unchecked
    shape mismatch several calls deep is an unhandled crash (confirmed by
    reproducing each case), not a clean validation error."""
    if not isinstance(data, dict):
        return [".claude/skill-clusters.json: root must be an object"]

    errors: list[str] = []
    clusters = data.get("clusters", {})
    if not isinstance(clusters, dict):
        return [".claude/skill-clusters.json: `clusters` must be an object"]

    for role, role_clusters in clusters.items():
        if not isinstance(role_clusters, dict):
            errors.append(f".claude/skill-clusters.json: clusters.{role!r} must be an object")
            continue
        for cluster_name, cluster in role_clusters.items():
            if not isinstance(cluster, dict):
                errors.append(
                    f".claude/skill-clusters.json: {role}/{cluster_name!r} must be an object"
                )
                continue
            includes = cluster.get("includes", [])
            if not isinstance(includes, list):
                errors.append(
                    f".claude/skill-clusters.json: {role}/{cluster_name!r}.includes must be a list"
                )
            elif not all(isinstance(item, str) for item in includes):
                errors.append(
                    f".claude/skill-clusters.json: {role}/{cluster_name!r}.includes entries "
                    "must all be strings"
                )

    standalone = data.get("standalone_skills")
    if standalone is not None and not isinstance(standalone, dict):
        errors.append(".claude/skill-clusters.json: `standalone_skills` must be an object")

    return errors


def load_skill_clusters() -> tuple[dict | None, list[str]]:
    """Parse and schema-check .claude/skill-clusters.json once; return
    (data, errors). On any structural problem the data is None, so every
    downstream consumer treats the file as absent rather than guessing at a
    malformed shape — same pattern as the invalid-JSON case below."""
    if not SKILL_CLUSTERS.exists():
        return None, [".claude/skill-clusters.json: missing"]
    try:
        data = json.loads(SKILL_CLUSTERS.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return None, [f".claude/skill-clusters.json: invalid JSON ({exc})"]

    schema_errors = validate_cluster_schema(data)
    if schema_errors:
        return None, schema_errors
    return data, []


def validate_skill_index(skill_names: set[str]) -> list[str]:
    """The generated registry must be complete and drift-free against live frontmatter."""
    errors: list[str] = []
    if not SKILL_INDEX.exists():
        return [".claude/skill-index.json: missing; run scripts/generate_skill_index.py"]

    try:
        index = json.loads(SKILL_INDEX.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f".claude/skill-index.json: invalid JSON ({exc})"]

    if not isinstance(index, dict):
        return [".claude/skill-index.json: root must be an object"]

    entries = index.get("skills", [])
    if not isinstance(entries, list):
        return [".claude/skill-index.json: `skills` must be a list"]

    # Schema-check each entry before anything downstream builds a set/dict
    # keyed on `name` — an entry that isn't a dict, or whose name isn't a
    # hashable string, crashes that construction with an unhandled
    # TypeError rather than a clean error (confirmed by reproducing it).
    valid_entries: list[dict] = []
    seen_names: set[str] = set()
    for position, entry in enumerate(entries):
        if not isinstance(entry, dict):
            errors.append(f".claude/skill-index.json: skills[{position}] must be an object")
            continue
        for field in ("name", "description", "path"):
            if not isinstance(entry.get(field), str):
                errors.append(
                    f".claude/skill-index.json: skills[{position}].{field} must be a string"
                )
                break
        else:
            if entry["name"] in seen_names:
                errors.append(
                    f".claude/skill-index.json: duplicate skill name {entry['name']!r}"
                )
            seen_names.add(entry["name"])
            valid_entries.append(entry)
    entries = valid_entries

    indexed_names = {entry["name"] for entry in entries}
    if indexed_names != skill_names:
        missing = sorted(skill_names - indexed_names)
        extra = sorted(indexed_names - skill_names)
        if missing:
            errors.append(f".claude/skill-index.json: missing skills {missing}")
        if extra:
            errors.append(f".claude/skill-index.json: unknown skills {extra}")
    if index.get("skill_count") != len(skill_names):
        errors.append(f".claude/skill-index.json: skill_count must be {len(skill_names)}")

    by_name = {entry["name"]: entry for entry in entries}
    for skill_name in sorted(skill_names):
        skill_file = SKILLS_DIR / skill_name / "SKILL.md"
        parsed, _, fm_errors = parse_frontmatter(
            skill_file.read_text(encoding="utf-8"), skill_file.relative_to(ROOT)
        )
        if fm_errors or parsed is None:
            continue
        entry = by_name.get(skill_name, {})
        expected_path = skill_file.relative_to(ROOT).as_posix()
        if entry.get("description") != str(parsed.get("description")):
            errors.append(
                f".claude/skill-index.json: stale description for {skill_name!r}; "
                "run scripts/generate_skill_index.py"
            )
        if entry.get("path") != expected_path:
            errors.append(
                f".claude/skill-index.json: wrong path for {skill_name!r}: {entry.get('path')!r}"
            )
    return errors


ROUTING_EVAL_CASES = ROOT / "evals" / "cases" / "abap-routing.json"


def validate_routing_eval_fixtures(
    agent_names: set[str], clusters_by_role: dict, skill_names: set[str]
) -> list[str]:
    """A routing-eval case (evals/cases/abap-routing.json) asserts cluster and
    standalone-skill names that must resolve against the real configuration —
    a typo here (`rap-business-objet`) or a role mismatch (asserting an
    architect-only cluster against a developer case) would otherwise only be
    discovered by burning a real model dispatch during the expensive
    behavioral run. Catch it here for free instead.

    Standalone-skill assertions are checked against the full skill registry
    (`skill_names`), NOT the curated `standalone_skills` allowlist in
    skill-clusters.json — those are different things. The allowlist declares
    which skills are intentionally cluster-less (it exists to suppress the
    static orphan-skill hard error in validate_orphaned_skills); the Tier-3
    "standalone addition" mechanism
    an agent actually follows can pick ANY registry skill not covered by its
    selected clusters, not just the allowlisted ones. Checking against the
    allowlist would reject a perfectly legitimate assertion like "the
    architect should not pick fiori-elements-ui-annotations here" merely
    because that skill happens to live inside a cluster's `includes` rather
    than the allowlist."""
    if not ROUTING_EVAL_CASES.exists():
        return []
    try:
        cases = json.loads(ROUTING_EVAL_CASES.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"{ROUTING_EVAL_CASES.relative_to(ROOT)}: invalid JSON ({exc})"]
    if not isinstance(cases, list):
        return [f"{ROUTING_EVAL_CASES.relative_to(ROOT)}: root must be a list"]

    relative_path = ROUTING_EVAL_CASES.relative_to(ROOT)
    errors: list[str] = []
    for position, case in enumerate(cases):
        if not isinstance(case, dict):
            errors.append(f"{relative_path}: cases[{position}] must be an object")
            continue
        routing = case.get("routing")
        if not isinstance(routing, dict):
            continue  # not a routing case (or malformed — validate_skill would need a
            # separate general case-schema check if abap-core.json needed one too)

        case_id = case.get("id", f"cases[{position}]")
        role = case.get("target_agent", "abap-kebap-developer")
        if role not in agent_names:
            errors.append(f"{relative_path}: {case_id} target_agent {role!r} does not exist")
            continue

        role_cluster_names = set(clusters_by_role.get(role, {}).keys())
        for field in ("required_clusters", "forbidden_clusters"):
            for cluster_name in routing.get(field, []) or []:
                if cluster_name not in role_cluster_names:
                    errors.append(
                        f"{relative_path}: {case_id} {field} names {cluster_name!r}, "
                        f"which is not a cluster for role {role!r}"
                    )
        for field in ("required_standalone_skills", "forbidden_standalone_skills"):
            for skill_name in routing.get(field, []) or []:
                if skill_name not in skill_names:
                    errors.append(
                        f"{relative_path}: {case_id} {field} names "
                        f"{skill_name!r}, which is not a real skill"
                    )
    return errors


def validate_skill_clusters(data: dict, skill_names: set[str], agent_names: set[str]) -> list[str]:
    """Every cluster's role must be a real agent; every included skill must exist."""
    errors: list[str] = []
    clusters_by_role = data.get("clusters", {})
    for role, clusters in clusters_by_role.items():
        if role not in agent_names:
            errors.append(f".claude/skill-clusters.json: role {role!r} matches no agent file")
        for cluster_name, cluster in clusters.items():
            includes = cluster.get("includes", [])
            for skill_name in includes:
                if skill_name not in skill_names:
                    errors.append(
                        f".claude/skill-clusters.json: cluster {role}/{cluster_name!r} "
                        f"includes unknown skill {skill_name!r}"
                    )
            description = cluster.get("description")
            if not isinstance(description, str) or not description.strip():
                errors.append(
                    f".claude/skill-clusters.json: cluster {role}/{cluster_name!r} "
                    "is missing a non-empty string description"
                )
    return errors


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
        if not isinstance(data, dict):
            errors.append(f".claude-plugin/{filename}: root must be an object")
            continue
        name = data.get("name", "")
        if not isinstance(name, str):
            errors.append(f".claude-plugin/{filename}: `name` must be a string")
        elif not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name):
            errors.append(
                f".claude-plugin/{filename}: name {name!r} must be kebab-case"
            )
        if filename == "plugin.json":
            for key in ("skills", "commands"):
                component_path = data.get(key)
                if component_path is None:
                    continue
                if not isinstance(component_path, str):
                    errors.append(f".claude-plugin/{filename}: `{key}` must be a string path")
                elif not (ROOT / component_path).exists():
                    errors.append(
                        f".claude-plugin/{filename}: {key} path "
                        f"{component_path!r} does not exist"
                    )
            # The CLI schema requires agents as explicit .md file paths, so the
            # list must stay in exact sync with .claude/agents/*.md.
            agents_value = data.get("agents", [])
            if isinstance(agents_value, str):
                agents_value = [agents_value]
            if not isinstance(agents_value, list) or not all(
                isinstance(item, str) for item in agents_value
            ):
                errors.append(
                    f".claude-plugin/{filename}: `agents` must be a string or a "
                    "list of string paths"
                )
            else:
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
            plugins_value = data.get("plugins", [])
            if not isinstance(plugins_value, list):
                errors.append(f".claude-plugin/{filename}: `plugins` must be a list")
            else:
                for position, entry in enumerate(plugins_value):
                    if not isinstance(entry, dict):
                        errors.append(
                            f".claude-plugin/{filename}: plugins[{position}] must be an object"
                        )
                        continue
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
