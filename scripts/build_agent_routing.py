#!/usr/bin/env python3
"""Regenerate the skill-trigger table in each agent from .claude/skill-clusters.json.

Why: GitHub Copilot has no Skill tool and preloads nothing, and nobody invokes skills by hand, so an
agent told to "read the cluster file and decide" loads nothing (measured in real Copilot chats: skills
opened 7 times in ~1,580 model rounds, the RAP and LUW skills never). A compact table in the agent
body, regenerated from the routing data, gives the model concrete cues and the exact way to load a
skill in each runtime. CI regenerates and fails on git diff, so the table cannot drift from the data.

Source of truth:
  .claude/skill-clusters.json  clusters[<role>][<cluster>] {triggers, read_first, includes},
                               additions[<skill>] {roles, triggers}, preload_cues[<skill>]
  .claude/agents/<role>.md     the `skills:` frontmatter (the Tier-1 preloads)
Only the lines between these markers are rewritten:
  <!-- BEGIN generated skill triggers (scripts/build_agent_routing.py) -->
  <!-- END generated skill triggers -->

select_clusters / select_skills are a deterministic stand-in for the model's judgement. The tests use
them to prove that the cues route real tasks correctly (including every case in
evals/cases/abap-routing.json) without paying for a model run.

Usage: python scripts/build_agent_routing.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
CLUSTERS_FILE = ROOT / ".claude" / "skill-clusters.json"
AGENTS_DIR = ROOT / ".claude" / "agents"
BEGIN_LINE = "<!-- BEGIN generated skill triggers (scripts/build_agent_routing.py) -->"
END_LINE = "<!-- END generated skill triggers -->"
BEGIN_PATTERN = re.compile(r"^<!-- BEGIN generated skill triggers\b")
END_PATTERN = re.compile(r"^<!-- END generated skill triggers\b")
FRONTMATTER_PATTERN = re.compile(r"\A---\n(.*?)\n---(?:\n|\Z)", re.DOTALL)
MAX_CUES = 12

# A negation covers the rest of its clause: "no CDS or RAP context", "no RAP behavior involved - ...".
NEGATION_PATTERN = re.compile(
    r"\b(?:no|not|without|never|excluding|except)\b(?:(?!\s-\s)[^.;\n—–])*", re.IGNORECASE
)

LOADING = (
    "**Loading skills.** Claude Code: use the `Skill` tool. GitHub Copilot has no Skill tool and preloads "
    "nothing, so use `read_file` on the skill's file: the `<file>` path listed for that name in your skills "
    "list (`.../.claude/skills/<name>/SKILL.md`). Read at least its first 150 lines, **before your first "
    "edit**. Nobody will invoke a skill for you, and a rule that lives only in a skill cannot protect you "
    "until you have read it."
)
PRELOAD_INTRO = "In Claude Code your `skills:` frontmatter already preloads these; in Copilot read each one yourself:"
TABLE_INTRO = (
    "Then, for every row whose cue appears in the task, load the skills under *Load first*; load *Then, when "
    "needed* only if the task needs them. A task often matches several rows, and it can change shape midway "
    "(a helper class that uses EML is a RAP task): check the table again when it does."
)
NO_MATCH = "No row matches? Take the skill whose description in your skills list fits best; if none does, say so before you write code."


class RoutingError(ValueError):
    """The routing data or an agent file cannot be rendered."""


class MarkerError(RoutingError):
    """An agent has an unbalanced or nested marker pair."""


def load_clusters(path: Path = CLUSTERS_FILE) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def preloaded_skills(agent_text: str) -> list[str]:
    match = FRONTMATTER_PATTERN.match(agent_text)
    if not match:
        return []
    parsed = yaml.safe_load(match.group(1)) or {}
    return [str(skill) for skill in parsed.get("skills") or []]


def strip_negations(text: str) -> str:
    return NEGATION_PATTERN.sub(" ", text)


def _hit(cue: str, text: str) -> bool:
    words = r"\s+".join(re.escape(word) for word in cue.split())
    return re.search(rf"(?<!\w){words}(?!\w)", text, re.IGNORECASE) is not None


def select_clusters(role: str, text: str, data: dict) -> list[str]:
    """Clusters of `role` with at least one *rendered* cue (the first MAX_CUES) in `text`: whole words, any case, negations ignored."""
    clean = strip_negations(text)
    return [
        name
        for name, cluster in data.get("clusters", {}).get(role, {}).items()
        if any(_hit(cue, clean) for cue in cluster["triggers"][:MAX_CUES])
    ]


def select_skills(role: str, text: str, data: dict) -> list[str]:
    """The skills to load first for `text`: matched clusters (read_first, else all includes) and matched additions."""
    clean = strip_negations(text)
    skills: list[str] = []
    for name in select_clusters(role, text, data):
        cluster = data["clusters"][role][name]
        skills.extend(cluster.get("read_first") or cluster["includes"])
    for skill, entry in data.get("additions", {}).items():
        if role in entry["roles"] and any(_hit(cue, clean) for cue in entry["triggers"][:MAX_CUES]):
            skills.append(skill)
    return list(dict.fromkeys(skills))


def _names(skills: list[str]) -> str:
    return ", ".join(f"`{skill}`" for skill in skills) or "-"


def _row(cues: list[str], first: list[str], then: list[str]) -> str:
    return f"| {', '.join(cues[:MAX_CUES])} | {_names(first)} | {_names(then)} |"


def render_block(role: str, data: dict, preloaded: list[str]) -> list[str]:
    cues = data.get("preload_cues", {})
    missing = [skill for skill in preloaded if skill not in cues]
    if missing:
        raise RoutingError(f"{role}: no preload_cues entry in skill-clusters.json for {', '.join(missing)}")
    lines = [LOADING, ""]
    if preloaded:
        lines += [PRELOAD_INTRO] + [f"- `{skill}` - {cues[skill]}" for skill in preloaded] + [""]
    lines += [TABLE_INTRO, "", "| If the task involves | Load first | Then, when needed |", "|---|---|---|"]
    for cluster in data.get("clusters", {}).get(role, {}).values():
        first = cluster.get("read_first") or cluster["includes"]
        lines.append(_row(cluster["triggers"], first, [s for s in cluster["includes"] if s not in first]))
    for skill, entry in data.get("additions", {}).items():
        if role in entry["roles"]:
            lines.append(_row(entry["triggers"], [skill], []))
    lines += ["", NO_MATCH]
    return lines


def render(text: str, role: str, data: dict, preloaded: list[str]) -> str:
    out: list[str] = []
    inside = False
    for number, line in enumerate(text.splitlines(), start=1):
        if BEGIN_PATTERN.match(line):
            if inside:
                raise MarkerError(f"line {number}: BEGIN inside an open marker pair")
            inside = True
            out.append(BEGIN_LINE)
            out.extend(render_block(role, data, preloaded))
        elif END_PATTERN.match(line):
            if not inside:
                raise MarkerError(f"line {number}: END without BEGIN")
            inside = False
            out.append(END_LINE)
        elif not inside:
            out.append(line)
    if inside:
        raise MarkerError("BEGIN without END")
    return "\n".join(out) + "\n"


def main() -> int:
    data = load_clusters()
    status = 0
    for agent in sorted(AGENTS_DIR.glob("*.md")):
        label = agent.relative_to(ROOT).as_posix()
        text = agent.read_text(encoding="utf-8")
        try:
            rendered = render(text, agent.stem, data, preloaded_skills(text))
        except RoutingError as error:
            print(f"{label}: {error}", file=sys.stderr)
            status = 1
            continue
        if BEGIN_LINE not in rendered:
            print(f"{label}: no generated skill-trigger markers", file=sys.stderr)
            status = 1
        elif rendered != text:
            agent.write_text(rendered, encoding="utf-8", newline="\n")
            print(f"generated {label}")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
