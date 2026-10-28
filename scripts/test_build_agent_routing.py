"""Tests for scripts/build_agent_routing.py and the routing data it renders.

The skill-trigger table in each agent is generated from .claude/skill-clusters.json. In GitHub Copilot
nobody invokes a skill by hand and there is no Skill tool, so this table is the agent's deterministic
routing aid: these tests prove that it selects the right skills for real tasks (including the incident
that motivated it, a commit hidden in a helper class that a RAP action calls) and that every agent
carries the current table. Run: python -m unittest discover -s scripts -p "test_*.py"
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

import build_agent_routing as routing

ROOT = Path(__file__).resolve().parents[1]
DEVELOPER = "abap-kebap-developer"
ARCHITECT = "abap-kebap-architect"
REVIEWER = "abap-kebap-reviewer"

BEGIN = "<!-- BEGIN generated skill triggers (scripts/build_agent_routing.py) -->\n"
END = "<!-- END generated skill triggers -->\n"
MINI = {
    "preload_cues": {"abap-clean-style": "before you generate any ABAP"},
    "clusters": {
        "role-a": {
            "alpha": {
                "description": "d",
                "triggers": ["Alpha", "two words"],
                "includes": ["skill-one", "skill-two"],
                "read_first": ["skill-one"],
            },
            "beta": {"description": "d", "triggers": ["beta"], "includes": ["skill-three"]},
        }
    },
    "additions": {"skill-extra": {"roles": ["role-a"], "triggers": ["extra"]}},
}


def real() -> dict:
    return routing.load_clusters()


class RenderTests(unittest.TestCase):
    def render(self, text: str) -> str:
        return routing.render(text, "role-a", MINI, ["abap-clean-style"])

    def test_replaces_only_between_markers(self) -> None:
        out = self.render("before\n" + BEGIN + "old\n" + END + "after\n")
        self.assertTrue(out.startswith("before\n" + BEGIN))
        self.assertTrue(out.endswith(END + "after\n"))
        self.assertNotIn("old\n", out)

    def test_is_idempotent(self) -> None:
        once = self.render(BEGIN + END)
        self.assertEqual(self.render(once), once)

    def test_text_without_markers_is_unchanged(self) -> None:
        self.assertEqual(self.render("name: x\nbody\n"), "name: x\nbody\n")

    def test_unbalanced_or_nested_markers_raise(self) -> None:
        for text in (END, BEGIN, BEGIN + BEGIN + END):
            with self.assertRaises(routing.MarkerError, msg=text):
                self.render(text)

    def test_cluster_rows_show_cues_and_what_to_load(self) -> None:
        out = self.render(BEGIN + END)
        self.assertIn("| Alpha, two words | `skill-one` | `skill-two` |", out)
        self.assertIn("| beta | `skill-three` | - |", out)

    def test_additions_get_their_own_row(self) -> None:
        self.assertIn("| extra | `skill-extra` | - |", self.render(BEGIN + END))

    def test_additions_of_other_roles_are_left_out(self) -> None:
        out = routing.render(BEGIN + END, "role-b", {**MINI, "clusters": {"role-b": {}}}, [])
        self.assertNotIn("skill-extra", out)

    def test_preloaded_skills_get_a_copilot_line(self) -> None:
        self.assertIn("- `abap-clean-style` - before you generate any ABAP", self.render(BEGIN + END))

    def test_a_preloaded_skill_without_a_cue_is_an_error(self) -> None:
        with self.assertRaises(routing.RoutingError):
            routing.render(BEGIN + END, "role-a", MINI, ["abap-unit-tdd"])

    def test_the_two_runtimes_are_both_named(self) -> None:
        out = self.render(BEGIN + END)
        self.assertIn("`Skill` tool", out)
        self.assertIn("`read_file`", out)


class SelectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = real()

    def clusters(self, role: str, text: str) -> set[str]:
        return set(routing.select_clusters(role, text, self.data))

    def skills(self, role: str, text: str) -> set[str]:
        return set(routing.select_skills(role, text, self.data))

    def test_the_incident_task_loads_the_commit_rules(self) -> None:
        task = "Build a helper class that uses EML against a released RAP business object and is called from a RAP action."
        skills = self.skills(DEVELOPER, task)
        self.assertLessEqual({"rap-eml", "rap-actions-validations-determinations"}, skills)
        self.assertIn("abap-cloud-development", skills)
        self.assertNotIn("async-processing", self.clusters(DEVELOPER, task))

    def test_a_bare_commit_task_loads_the_luw_skill(self) -> None:
        self.assertIn("abap-sap-luw", self.skills(DEVELOPER, "Add COMMIT ENTITIES after the update in this class."))

    def test_negated_mentions_do_not_select(self) -> None:
        text = "Explain CORRESPONDING - purely the language construct, no CDS or RAP context."
        self.assertFalse(self.clusters(DEVELOPER, text) & {"cds-data-model", "rap-business-object"})
        text = "Add an association between two CDS views. There is no RAP behavior involved - pure data model."
        self.assertNotIn("rap-business-object", self.clusters(DEVELOPER, text))

    def test_matching_is_whole_word(self) -> None:
        self.assertNotIn("rap-business-object", self.clusters(DEVELOPER, "Review this transaction report for typos."))

    def test_matching_ignores_case(self) -> None:
        self.assertIn("rap-business-object", self.clusters(DEVELOPER, "write the eml for the managed bo"))

    def test_additions_are_role_scoped(self) -> None:
        task = "How do named regex capture groups work?"
        self.assertIn("abap-strings-regex", self.skills(DEVELOPER, task))
        self.assertNotIn("abap-strings-regex", self.skills(ARCHITECT, task))

    def test_the_reviewer_gets_the_commit_rules_too(self) -> None:
        task = "Review this class: the action handler calls a helper that runs COMMIT ENTITIES."
        self.assertLessEqual({"rap-actions-validations-determinations", "abap-sap-luw"}, self.skills(REVIEWER, task))

    def test_generic_words_do_not_drag_the_rap_skills_into_a_reviewer_task(self) -> None:
        task = "Review this include; it should include input validation of the interface parameters."
        self.assertFalse(
            self.skills(REVIEWER, task) & {"rap-actions-validations-determinations", "rap-eml", "abap-modernization-playbook"}
        )

    def test_serialize_to_json_does_not_load_the_repository_tooling(self) -> None:
        self.assertNotIn("abap-xco-library", self.skills(DEVELOPER, "Serialize this structure to JSON."))

    def test_everyday_prose_does_not_select_the_architect_lock_cluster(self) -> None:
        self.assertNotIn("transaction-architecture", self.clusters(ARCHITECT, "Keep the design consistent with the API and lock it."))

    def test_only_the_cues_the_agent_sees_can_select(self) -> None:
        cues = [f"cue{n}" for n in range(routing.MAX_CUES)] + ["hiddencue"]
        data = {
            "clusters": {"role-a": {"c": {"description": "d", "triggers": cues, "includes": ["skill-one"]}}},
            "additions": {"skill-x": {"roles": ["role-a"], "triggers": cues}},
        }
        self.assertEqual(routing.select_clusters("role-a", "cue1", data), ["c"])
        self.assertEqual(routing.select_clusters("role-a", "hiddencue", data), [])
        self.assertEqual(routing.select_skills("role-a", "hiddencue", data), [])

    def test_nothing_matches_nothing(self) -> None:
        self.assertEqual(self.skills(DEVELOPER, "Say hello."), set())


class DataTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = real()
        self.skill_names = {p.parent.name for p in (ROOT / ".claude" / "skills").glob("*/SKILL.md")}
        self.agents = {p.stem for p in (ROOT / ".claude" / "agents").glob("*.md")}

    def test_every_cluster_has_triggers_and_a_valid_read_first(self) -> None:
        for role, clusters in self.data["clusters"].items():
            for name, cluster in clusters.items():
                with self.subTest(cluster=f"{role}/{name}"):
                    triggers = cluster.get("triggers")
                    self.assertTrue(isinstance(triggers, list) and triggers, "triggers must be a non-empty list")
                    self.assertTrue(all(isinstance(t, str) and t.strip() for t in triggers))
                    self.assertLessEqual(set(cluster.get("read_first", [])), set(cluster["includes"]))

    def test_every_addition_is_a_real_skill_for_real_roles(self) -> None:
        for skill, entry in self.data["additions"].items():
            with self.subTest(skill=skill):
                self.assertIn(skill, self.skill_names)
                self.assertTrue(entry["roles"] and set(entry["roles"]) <= self.agents)
                self.assertTrue(entry["triggers"] and all(isinstance(t, str) and t.strip() for t in entry["triggers"]))

    def test_every_preloaded_skill_has_a_cue(self) -> None:
        for agent in sorted((ROOT / ".claude" / "agents").glob("*.md")):
            for skill in routing.preloaded_skills(agent.read_text(encoding="utf-8")):
                with self.subTest(agent=agent.stem, skill=skill):
                    self.assertIn(skill, self.data["preload_cues"])


class EvalReplayTests(unittest.TestCase):
    """The 13 routing cases written for the paid behavioural eval, replayed for free."""

    def test_every_routing_case_selects_what_it_requires_and_nothing_it_forbids(self) -> None:
        data = real()
        cases = json.loads((ROOT / "evals" / "cases" / "abap-routing.json").read_text(encoding="utf-8"))
        for case in cases:
            expected = case.get("routing")
            if not expected:
                continue
            with self.subTest(case=case["id"]):
                role, prompt = case["target_agent"], case["prompt"]
                clusters = set(routing.select_clusters(role, prompt, data))
                skills = set(routing.select_skills(role, prompt, data))
                self.assertLessEqual(set(expected.get("required_clusters", [])), clusters)
                self.assertFalse(set(expected.get("forbidden_clusters", [])) & clusters)
                self.assertLessEqual(set(expected.get("required_standalone_skills", [])), skills)
                self.assertFalse(set(expected.get("forbidden_standalone_skills", [])) & skills)


class AgentsInSyncTests(unittest.TestCase):
    def test_every_agent_carries_the_current_table(self) -> None:
        data = real()
        agents = sorted((ROOT / ".claude" / "agents").glob("*.md"))
        self.assertEqual(len(agents), 3)
        for agent in agents:
            with self.subTest(agent=agent.name):
                text = agent.read_text(encoding="utf-8")
                self.assertIn(BEGIN.strip(), text, "agent has no generated-table markers")
                rendered = routing.render(text, agent.stem, data, routing.preloaded_skills(text))
                self.assertEqual(rendered, text, "run: python scripts/build_agent_routing.py")


if __name__ == "__main__":
    unittest.main()
