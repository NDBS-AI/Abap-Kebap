# Roadmap — deferred improvements

Source: 4-model review panel (Fable catalog architecture, Opus depth audit, Sonnet 5
quality gates, Haiku mechanical sweep) run 2026-08-15. The mechanical and
infrastructure findings were fixed immediately; the items below cost real authoring
effort and are deliberately deferred so they can be done well, one at a time.

## Content lift — bring existing skills up to the standard

Seven skills are under the 300-line detail standard:

| Skill | Lines |
|---|---|
| `abap-code-review` | 171 |
| `abap-systematic-debugging` | 193 |
| `abap-cloud-development` | 200 |
| `abap-modernization-playbook` | 251 |
| `abap-internal-tables` | 268 |
| `enhancements-extensibility` | 269 |
| `abap-builtin-functions` | 295 |

Thirteen skills have no `examples/` directory: `abap-authorization`,
`abap-builtin-functions`, `abap-classic-ui`, `abap-code-review`,
`abap-cloud-development`, `abap-constructor-expressions`, `abap-data-objects`,
`abap-dictionary-ddic`, `abap-internal-tables`, `abap-sap-luw`,
`abap-sql-performance`, `abap-strings-regex`, `abap-systematic-debugging`.

Depth gaps flagged by the audit:

- `cds-views-authoring/references/annotations-reference.md` — DCL coverage is a
  single example; add aspect types, role inheritance, literal vs PFCG variants.
- `abap-clean-style` — no ASSERT / message-class (T100, exception texts) guidance.
- `abap-parallel-processing` — note RFC server-group / resource configuration limits.
- `abap-strings-regex` — brief codepage/normalization (`cl_abap_conv_*`) note.

## New skills — highest-value gaps in the catalog

Ranked by how often a senior ABAP developer needs them:

1. **`abap-rfc-bapi-connectivity`** — CALL FUNCTION DESTINATION, sRFC/aRFC/qRFC,
   BAPI call + COMMIT patterns, destinations and communication arrangements.
   `abap-odata` explicitly stays OData-focused, so this is unowned today.
2. **`abap-atc-quality-gates`** — ATC / Code Inspector operation: check variants,
   exemptions, baselining, ATC in CI. `abap-code-review` assumes ATC ran but
   nothing teaches it.
3. **CDS analytics** — analytical query/cube/dimension annotation authoring
   (currently only name-dropped in `cds-entity-types`).
4. **ALV authoring** — a positive-guidance home for CL_SALV_TABLE / ALV IDA
   on-premise report writing (`abap-classic-ui` is read-only legacy stance by
   design).
5. **IDoc/ALE maintenance** — legacy surface, fits the `abap-classic-ui`
   maintenance precedent. Lower priority.
6. **Messages & T100 exceptions** — MESSAGE, `if_t100_message`, bridging into RAP
   `reported`/`%msg`; today scattered with no owner. Could be a section in
   `abap-clean-style` instead of a skill.

Each new skill follows the standard: 300+ line SKILL.md from public SAP sources,
`references/`, `examples/`, wired into at least one agent's skill map (the
validator enforces the wiring).
