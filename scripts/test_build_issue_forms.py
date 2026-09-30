"""Tests for scripts/build_issue_forms.py and the shape of the issue forms.

GitHub silently drops a malformed issue form from the New issue chooser, so the structure it
requires is checked here. Run: python -m unittest discover -s scripts -p "test_*.py"
"""
from __future__ import annotations

import re
import tempfile
import unittest
from pathlib import Path

import yaml

import build_issue_forms as forms

ELEMENT_TYPES = {"markdown", "input", "textarea", "dropdown", "checkboxes"}
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
BEGIN = "        # BEGIN generated skills (scripts/build_issue_forms.py)\n"
END = "        # END generated skills\n"
FORM_TEXT = "      options:\n        - Not sure\n" + BEGIN + "        - old-skill\n" + END + "  - type: input\n"


class RenderTests(unittest.TestCase):
    def test_replaces_only_between_markers_and_keeps_indentation(self) -> None:
        self.assertEqual(
            forms.render(FORM_TEXT, ["abap-a", "rap-b"]),
            "      options:\n        - Not sure\n" + BEGIN
            + "        - abap-a\n        - rap-b\n" + END + "  - type: input\n",
        )

    def test_is_idempotent(self) -> None:
        once = forms.render(FORM_TEXT, ["abap-a"])
        self.assertEqual(forms.render(once, ["abap-a"]), once)

    def test_fills_an_empty_block(self) -> None:
        self.assertEqual(forms.render(BEGIN + END, ["abap-a"]), BEGIN + "        - abap-a\n" + END)

    def test_text_without_markers_is_unchanged(self) -> None:
        text = "name: x\nbody: []\n"
        self.assertEqual(forms.render(text, ["abap-a"]), text)

    def test_end_without_begin_raises(self) -> None:
        with self.assertRaises(forms.MarkerError):
            forms.render(END, ["abap-a"])

    def test_begin_without_end_raises(self) -> None:
        with self.assertRaises(forms.MarkerError):
            forms.render(BEGIN, ["abap-a"])

    def test_nested_begin_raises(self) -> None:
        with self.assertRaises(forms.MarkerError):
            forms.render(BEGIN + BEGIN + END, ["abap-a"])

    def test_skill_slugs_lists_sorted_folders_with_skill_md(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ("rap-eml", "abap-odata", "no-skill-md"):
                (root / name).mkdir()
            (root / "rap-eml" / "SKILL.md").write_text("", encoding="utf-8")
            (root / "abap-odata" / "SKILL.md").write_text("", encoding="utf-8")
            self.assertEqual(forms.skill_slugs(root), ["abap-odata", "rap-eml"])


class FormShapeTests(unittest.TestCase):
    @staticmethod
    def form_paths() -> list[Path]:
        return sorted(p for p in forms.FORMS_DIR.glob("*.yml") if p.name != "config.yml")

    @staticmethod
    def load(path: Path) -> dict:
        return yaml.safe_load(path.read_text(encoding="utf-8"))

    def test_four_forms_exist(self) -> None:
        self.assertEqual(
            [p.name for p in self.form_paths()],
            ["1-wrong-output.yml", "2-improve-skill.yml", "3-request-skill.yml", "4-contribute-skill.yml"],
        )

    def test_top_level_keys(self) -> None:
        for path in self.form_paths():
            with self.subTest(form=path.name):
                form = self.load(path)
                for key in ("name", "description", "body"):
                    self.assertTrue(form.get(key), f"missing {key}")
                self.assertIsInstance(form.get("labels"), list)
                self.assertEqual(len(form["labels"]), 1)

    def test_elements_are_well_formed(self) -> None:
        for path in self.form_paths():
            with self.subTest(form=path.name):
                ids: list[str] = []
                labels: list[str] = []
                for element in self.load(path)["body"]:
                    kind = element.get("type")
                    self.assertIn(kind, ELEMENT_TYPES)
                    attributes = element.get("attributes") or {}
                    if kind == "markdown":
                        self.assertTrue(attributes.get("value"))
                        continue
                    self.assertRegex(element.get("id", ""), ID_PATTERN)
                    self.assertIsInstance(attributes.get("label"), str)
                    ids.append(element["id"])
                    labels.append(attributes["label"])
                    options = attributes.get("options")
                    if kind == "dropdown":
                        self.assertIsInstance(options, list)
                        self.assertTrue(options, f"{element['id']}: no options")
                        self.assertTrue(all(isinstance(o, str) and o for o in options))
                        self.assertEqual(len(options), len(set(options)), f"{element['id']}: duplicate option")
                    if kind == "checkboxes":
                        self.assertTrue(options, f"{element['id']}: no options")
                        self.assertTrue(all(isinstance(o.get("label"), str) and o["label"] for o in options))
                self.assertEqual(len(ids), len(set(ids)), "duplicate id")
                self.assertEqual(len(labels), len(set(labels)), "duplicate label")

    def test_every_form_ends_with_the_sanitisation_checkbox(self) -> None:
        for path in self.form_paths():
            with self.subTest(form=path.name):
                last = self.load(path)["body"][-1]
                self.assertEqual(last["id"], "sanitized")
                self.assertTrue(all(o.get("required") for o in last["attributes"]["options"]))

    def test_config_disables_blank_issues(self) -> None:
        config = yaml.safe_load((forms.FORMS_DIR / "config.yml").read_text(encoding="utf-8"))
        self.assertIs(config["blank_issues_enabled"], False)
        self.assertTrue(config["contact_links"])

    def test_forms_are_in_sync_with_the_skills(self) -> None:
        slugs = forms.skill_slugs()
        self.assertTrue(slugs)
        for path in self.form_paths():
            with self.subTest(form=path.name):
                text = path.read_text(encoding="utf-8")
                self.assertEqual(forms.render(text, slugs), text, "run: python scripts/build_issue_forms.py")


if __name__ == "__main__":
    unittest.main()
