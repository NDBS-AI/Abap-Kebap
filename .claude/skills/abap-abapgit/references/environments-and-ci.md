# abapGit Environments, gCTS, and CI — Deep Dive

Companion to the main skill (`../SKILL.md`). Covers installation and SSL in detail,
abapGit in the SAP BTP ABAP environment (ADT integration), the abapGit / gCTS / CTS
decision, and CI patterns on abapGit-serialized repositories.

## 1. Installation, in detail

Source: https://docs.abapgit.org/user-guide/getting-started/install.html

### Standalone vs developer version

| | Standalone | Developer version |
|---|---|---|
| Form | One generated report (`ZABAPGIT_STANDALONE`) | Full codebase as individual classes/objects in a package |
| Audience | Everyone using abapGit | Contributors; users needing newest features |
| Extras | — | Parallel serialization, latest fixes, debuggable code |
| Install | Paste source, activate | Clone `https://github.com/abapGit/abapGit.git` online, or import ZIP offline |
| Upgrade | Replace report source (or built-in self-update) | Pull the abapGit repository |

Rules worth repeating:

- Install the **standalone version first** in every case — it is the bootstrap for the
  developer version.
- Never name the standalone report `ZABAPGIT`; that name belongs to the developer
  version's program.
- Minimum platform: SAP BASIS 702. SAP GUI for Windows is the best-tested frontend;
  Java GUI has known rendering issues with the abapGit HTML UI.

### SSL setup (STRUST)

Sources: https://docs.abapgit.org/user-guide/setup/ssl-setup.html,
https://docs.abapgit.org/user-guide/getting-started/troubleshooting.html

1. Get the git host's certificate chain (root + intermediates) — from the browser's
   certificate viewer or the host's docs.
2. `STRUST` → *SSL Client SSL Client (Anonymous)* — import and add each certificate to
   the list. Some configurations also require *SSL Client (Standard)*.
3. Restart the ICM (`SMICM` → Administration) so it picks up the new list.
4. Error signatures that mean "SSL not set up": `ICM_HTTP_SSL_ERROR`,
   `SSSLERROR_SSL_READ`, `SSSLRC_CONN_CLOSED`, HTTP 421. SAP Note 510007 covers the
   application-server SSL parameters.
5. Corporate proxies: maintain host/port (and credentials, if HTTP 407 appears) in
   abapGit *Global Settings*; a TLS-intercepting proxy means you must import the
   *proxy's* CA, not the git host's.

### Authentication

Source: https://docs.abapgit.org/user-guide/projects/online/authentication.html (and
troubleshooting page)

- HTTPS only; abapGit does not use SSH.
- GitHub and most modern hosts reject account passwords for git operations — use a
  **personal access token** as the password (fine-grained tokens scoped to the repo
  are the sensible default).
- 2FA on the account does not affect token-based authentication.

## 2. abapGit in the SAP BTP ABAP environment

Sources:
https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/working-with-abapgit-d62ed9d.md,
https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/import-content-from-abapgit-repository-into-the-abap-environment-0b0d894.md

The picture differs fundamentally from on-premise:

| | On-premise | BTP ABAP environment (Steampunk) |
|---|---|---|
| abapGit code | Community version you install yourself | SAP-distributed cloud version, **preinstalled** |
| UI | SAP GUI report and/or ADT plugin | **ADT only** — abapGit Repositories view |
| Support | Community (GitHub issues, Slack) | SAP supports the Git integration of the ABAP environment (not community abapGit) |
| Connectivity | Whatever the ICM can reach | Repository must be **reachable from the internet**; Cloud Connector is **not supported** |
| Objects | 200+ types | Only ABAP-Cloud-allowed objects import and activate |

Working in ADT:

1. Install the abapGit ADT plugin: *Help → Install New Software* →
   `https://eclipse.abapgit.org/updatesite/` → *abapGit for ABAP Development Tools*.
2. Select the cloud project in Project Explorer, open
   *Window → Show View → Other → abapGit Repositories*.
3. *Link* (clone icon) → repository HTTPS URL → choose branch → choose target package
   → pull. Credentials for private repos are entered in the wizard.
4. Pull and push (stage/commit) are available from the view's context menu; the view
   shows the linked branch and last action status per repository.

Limitations to plan around (from SAP's "Working with abapGit" page):

- Some object types are **deliberately not exported** because they are generated or
  compiled artifacts — they are regenerated upon activation in the target. Others are
  simply not exportable; the documented workaround is manual recreation in the target
  (same names, copy source, redo configuration).
- Everything pulled must pass ABAP Cloud checks (released APIs, allowed object types,
  language version `ABAP for Cloud Development`). Classic report code fails
  activation, not the pull itself — budget cleanup time. The
  [abap-cloud-development](../../abap-cloud-development/SKILL.md) skill covers the
  restrictions; [abap-modernization-playbook](../../abap-modernization-playbook/SKILL.md)
  covers the migration sequence.
- Typical flow **on-premise → cloud**: community abapGit serializes the package and
  pushes to git; the BTP system pulls via the ADT view. This is SAP's documented code
  transfer path for the ABAP environment.

## 3. abapGit vs gCTS vs classic CTS

Sources: SAP Help "Git-Enabled Change and Transport System (gCTS)"
https://help.sap.com/docs/ABAP_PLATFORM_NEW/4a368c163b08418890a406d413933ba7/f319b168e87e42149e25e13c08d002b9.html
and the abapGit docs above.

| | Classic CTS | gCTS | abapGit |
|---|---|---|---|
| Who ships it | SAP standard | SAP standard (S/4HANA / ABAP Platform 1909+, component BC-CTS-GIT) | Open-source community project |
| Unit of change | Transport request | Transport request → git commit | Object/file, staged per commit |
| Git's role | None | System of record behind the transport system | The workflow itself |
| Landscape move DEV→QAS→PRD | Transport routes (STMS) | Git pull/import per system, driven by CTS tooling and pipelines | Not its job (each system pulls, but no import queue/order management) |
| Customizing data | Yes | Yes (with registry setup) | No — workbench objects only |
| Open-source / cross-landscape code sharing | No | No | Yes — its home turf |
| Adoption | Everywhere | Optional; can start with a single project | Per repository |

Decision heuristic:

- **Version control + review + CI on your own code, any system, today** → abapGit.
- **Git as the backbone of transport management** in an S/4HANA landscape, including
  customizing, with SAP support → gCTS (note SAP Note 2821718 as the central note).
- They are not interchangeable and do not share repository formats. Running abapGit
  for developer workflows while the landscape still moves changes via classic
  transports is the common, supported hybrid.

What abapGit explicitly does **not** replace:

- Transport-based delivery, import queues, and import order (STMS).
- Transport of copies / preliminary transports for QA processes.
- Customizing transports (client-dependent data is outside abapGit's scope).
- SPAM/SAINT/add-on installation mechanics.

## 4. Branching strategies that survive contact with ABAP

Constraints first: one system+package holds exactly one checked-out state per repo,
and abapGit does not merge — merging happens on the git side.

- **Trunk-based with short-lived feature branches** (SAP's recommended shape):
  `main` stays deployable; `feature/*` branches live days, merged by pull request
  with review. Requires either developer-isolated systems or discipline about who
  has which branch checked out where — "one system per active branch".
- **Stage-mapped branches**: DEV pulls feature branches, QAS a release branch, PRD
  tags on `main`. Works when git (or gCTS) actually drives delivery; with classic
  transports it degenerates into documentation, which is still useful.
- Keep merges, rebases, and conflict resolution in full git tooling (laptop clone or
  git host UI); then pull the merged commit with abapGit. abapGit's overwrite dialog
  is a last resort, not a merge tool.

## 5. CI on abapGit repositories

Because the serialization format is plain text, any CI system can act on push events
without an SAP system in the loop.

### abaplint (static analysis)

Source: https://abaplint.org/

- Linter for ABAP written in TypeScript; parses the abapGit file format directly.
- Configured by `abaplint.json` in the repo root; runs via npm (`npx abaplint`),
  Docker, or editor extensions (VS Code).
- `syntax.version` pins the target ABAP release — set `"Cloud"` to enforce ABAP Cloud
  rules on a repo destined for BTP; `errorNamespace` limits findings to your own
  namespace.

```yaml
# .github/workflows/abaplint.yml — lint every push and PR
name: abaplint
on: [push, pull_request]
jobs:
  abaplint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npx abaplint
```

### Patterns that build on the same foundation

- **PR gate**: branch protection requires the abaplint check; ABAP code review happens
  on the pull request like any other language. Pair with the
  [abap-code-review](../../abap-code-review/SKILL.md) skill for review content; the
  SAP styleguides repo also publishes an ABAP code review whitepaper.
- **Cloud-readiness check**: run abaplint with `"version": "Cloud"` on an on-premise
  repo to measure distance from ABAP Cloud before a migration.
- **Consistency**: CI verifies that generated/serialized files are well-formed and
  that forbidden files (e.g. secrets) never enter `/src/`.
- Unit tests (ABAP Unit) still need an ABAP system; CI can only lint statically unless
  the pipeline provisions one — keep expectations straight about what runs where.
