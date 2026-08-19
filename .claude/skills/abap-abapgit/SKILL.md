---
name: abap-abapgit
description: Use when putting ABAP code under git version control with abapGit — linking or cloning repositories, installing abapGit (standalone report or developer version), configuring .abapgit.xml (starting folder, folder logic PREFIX/FULL/MIXED, ignore patterns, requirements), mapping SAP packages to repositories, pulling, staging, committing and pushing changes, switching branches, resolving overwrite prompts and serialization errors, deciding between transports, abapGit, and gCTS, using the abapGit Repositories view in ADT for the SAP BTP ABAP environment, checking which object types serialize, or wiring abapGit repositories into CI with abaplint. Triggers include "set up abapGit", "pull this repo", "serialize this package", "push ABAP to GitHub", "link a repository", ".abapgit.xml", "folder logic", "export to zip", "abapGit vs gCTS", "transport vs git", "SSL handshake error", and "run abaplint on my ABAP". Covers on-premise systems (BASIS 702+) and the SAP-distributed abapGit in ABAP Cloud / BTP.
---

# abapGit — Git-Based Version Control for ABAP

## Overview

abapGit is an open-source git client written in ABAP that runs *inside* the SAP system
(BASIS 702 SP8 or higher). It **serializes** ABAP development objects — classes, CDS
views, tables, function groups, and 200+ other types — into plain text files that live
in a git repository, and **deserializes** them back into ABAP objects on pull. It works
with GitHub, GitLab, Bitbucket, Azure DevOps, and any standard git server.

Its stated design goals: easy installation, easy upgrade, small system footprint, and
code that stays *readable in the git repository* — diffs of `.clas.abap` files look like
ABAP, not like a binary blob.

**What abapGit is not:**
- Not a replacement for the Change and Transport System (CTS) in a classic
  DEV → QAS → PRD landscape. Transports still move changes between systems;
  abapGit gives you git history, branches, and pull-request review on top.
- Not gCTS. gCTS (Git-enabled CTS) is SAP's own, separately licensed/configured
  product that puts git *behind* the transport system. abapGit is the community
  client that works at object/package level. See §transports-vs-git.

**Core mental model:** one git repository ↔ one SAP package (plus its subpackages).
Everything else — folder layout, file names, what gets ignored — is controlled by one
file at the repository root: `.abapgit.xml`.

## Workflow

1. **Identify the environment:**
   - On-premise / private cloud AS ABAP → community abapGit (standalone report or
     developer version), SAP GUI or ADT.
   - SAP BTP ABAP environment (Steampunk) → the SAP-distributed abapGit that is
     preinstalled in the system, driven from the **abapGit Repositories** view in ADT.
     The community standalone report cannot be installed there. See §abap-cloud.
   - gCTS in play → different product; clarify which one the user actually means.
2. **Identify the operation:**
   - First-time setup → §installing.
   - Put an existing package under git → §package-mapping, then the walkthrough in
     [examples/workflow-walkthrough.md](examples/workflow-walkthrough.md).
   - Daily pull / stage / commit / push → §flows.
   - Configuration questions (`.abapgit.xml`, folder logic, ignores) → §dot-abapgit
     and [references/repo-configuration.md](references/repo-configuration.md).
   - Errors (SSL, 401/404, locks) → §errors.
   - Landscape strategy, BTP, CI → §transports-vs-git, §abap-cloud, §ci and
     [references/environments-and-ci.md](references/environments-and-ci.md).
3. **Cross-load related skills** when the question extends beyond abapGit itself:
   [abap-cloud-development](../abap-cloud-development/SKILL.md) for what is allowed in
   ABAP Cloud, [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md)
   for using abapGit as the on-ramp when modernizing legacy code.

## Online vs Offline Repositories {#online-offline}

| Aspect | Online repository | Offline repository |
|---|---|---|
| Connection | Direct HTTPS to the git host from the SAP system | None — SAP system never talks to the git host |
| Transfer | Pull / stage / commit / push in abapGit | Import ZIP / Export ZIP (files moved manually) |
| Prerequisites | SSL certificates in STRUST, user/token auth | None beyond abapGit itself |
| Typical use | Normal development against GitHub/GitLab/… | Isolated or firewalled systems, one-off code transfer |
| Branch awareness | Yes — select and switch branches | No — you exchange snapshots as ZIPs |

- **Online**: create with *New Online*, enter the HTTPS repository URL, pick (or let
  abapGit create) the target package, select a branch, pull.
- **Offline**: create with *New Offline*, name the repo and package, then either add
  objects to the package or *Import ZIP* to bring files in; *Export ZIP* produces a
  file you can commit from any machine with normal git tooling. A *Compare RFC*
  feature can diff against a remote system instead of a file.
- Both directions of an offline repo use exactly the same serialization format as an
  online repo — a ZIP exported offline can be pushed to GitHub from a laptop and later
  linked online.

**Rule that applies to both:** use a **new, dedicated SAP package** for each abapGit
repository. Do not link a package that already contains unrelated objects — the repo
would claim them all.

## Installing abapGit {#installing}

Two variants exist; most users only ever need the first.

**Standalone version** — one large generated report, for using abapGit:

1. Download the source from
   `https://raw.githubusercontent.com/abapGit/build/main/zabapgit_standalone.prog.abap`
   (the file is >100k lines; save it locally rather than viewing it in the browser).
2. Create a report named `ZABAPGIT_STANDALONE` in SE38 / SE80 / ADT.
   Do **not** name it `ZABAPGIT` if you may ever install the developer version — the
   developer version claims that name.
3. Paste/upload the source (SE38: *Utilities → More Utilities → Upload/Download*),
   activate, run.

**Developer version** — the full abapGit codebase as individual objects, for
contributing to abapGit or getting the newest features plus parallel serialization:

1. Install the standalone version first.
2. Then either clone `https://github.com/abapGit/abapGit.git` online into a package
   (recommended; requires SSL setup), or import the repository ZIP offline.

**SSL setup (required for any online operation):** import the git host's root and
intermediate certificates into transaction `STRUST` under *SSL Client (Anonymous)* —
some setups also need *SSL Client (Standard)* — then restart the ICM. Details and the
common error signatures are in §errors and
[references/environments-and-ci.md](references/environments-and-ci.md).

**Upgrading standalone:** replace the report source with the newest build and
reactivate — or let abapGit update itself via its built-in option.

**ADT plugin (optional, on-premise; mandatory UI on BTP):** install from update site
`https://eclipse.abapgit.org/updatesite/` via *Help → Install New Software* in Eclipse
to get the abapGit Repositories view inside ADT.

## Package ↔ Repository Mapping {#package-mapping}

- A repository is linked to exactly **one top-level SAP package**. The package name is
  *not* stored in the repository — each system linking the repo chooses its own target
  package (folder logic permitting; FULL/MIXED pin subpackage names, see below).
- **Subpackages** are created automatically on pull, inheriting the settings
  (transport layer, software component) of the top package.
- The **package type drives transport behavior**:

| Package | Transport behavior on pull/creation |
|---|---|
| Local `$…` package | No transport, or a local (non-transportable) workbench request |
| Transportable `Z…` package | abapGit prompts for a transportable workbench request |
| Namespaced `/…/` package | As transportable; namespace must exist in the system |

- With multiple transport layers configured, you may need to pick the layer explicitly
  when abapGit creates packages.
- Everything pulled into a transportable package lands on a normal transport request —
  abapGit *cooperates* with CTS, it does not bypass it.

## .abapgit.xml {#dot-abapgit}

The control file at the repository root. It defines how files map to packages and what
abapGit should leave alone. Edit it through **Repository Settings** in the abapGit UI —
hand-editing is for exceptional cases only, because the settings interact with objects
already deserialized in linking systems.

```xml
<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
 <asx:values>
  <DATA>
   <MASTER_LANGUAGE>E</MASTER_LANGUAGE>
   <STARTING_FOLDER>/src/</STARTING_FOLDER>
   <FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>
   <IGNORE>
    <item>/.gitignore</item>
    <item>/LICENSE</item>
    <item>/README.md</item>
   </IGNORE>
  </DATA>
 </asx:values>
</asx:abap>
```

| Setting | Values | Meaning |
|---|---|---|
| `MASTER_LANGUAGE` | `sy-langu` value (`E`, `D`, …) | Original language of all objects in the repo. Changing it requires uninstall + reinstall of the repo. |
| `I18N_LANGUAGES` | ISO codes, comma-separated | Serialize translations for these languages (experimental). |
| `STARTING_FOLDER` | e.g. `/src/` | Folder where serialization starts; everything outside is ignored for deserialization. |
| `FOLDER_LOGIC` | `PREFIX` / `FULL` / `MIXED` | How package hierarchy maps to folders (below). |
| `IGNORE` | List of patterns | Files abapGit never deserializes. Matching uses ABAP `CP` "covers pattern" logic (`*`, `+`), **not** regex. |
| `REQUIREMENTS` | Component + release + patch | Minimum software component versions a system must have before the repo may be pulled. |

**Folder logic** decides the folder name for each (sub)package:

- `PREFIX` — child packages must *start with* the parent package name; only the suffix
  becomes the folder. `ZFOO_BAR` under `ZFOO` → `/src/bar/`. Portable: another system
  can install under a different top package (`YFOO` → `YFOO_BAR`). Watch the 30-char
  package name limit — deep folder trees can push generated names past it.
- `FULL` — the complete package name is the folder: `ZFOO_BAR` → `/src/zfoo_bar/`.
  Works with any naming convention, but forces identical package names in every system
  that installs the repo.
- `MIXED` — combination of both behaviors for repos whose package names only partly
  follow a prefix convention.

Fully annotated example: [examples/dot-abapgit-annotated.xml](examples/dot-abapgit-annotated.xml).
Setting-by-setting deep dive: [references/repo-configuration.md](references/repo-configuration.md).

## Serialization: Files and Object Types {#serialization}

File naming follows `<object_name>.<object_type>.<extension>`, optionally with an
object part: `<object_name>.<object_type>.<part>.<extension>`.

```
/src/
  package.devc.xml                 package metadata (one per folder)
  zcl_invoice.clas.abap            class source
  zcl_invoice.clas.xml             class metadata
  zcl_invoice.clas.testclasses.abap  local test classes (object part)
  zif_invoice.intf.abap
  zinvoice.tabl.xml                table definition (metadata only)
  zi_invoice.ddls.asddls           CDS data definition
```

- `.abap` = source code, `.xml`/`.json` = metadata, other extensions for special
  content (e.g. MIME objects). Characters not valid in file names (`% # . = ? < >`)
  are escaped.
- Folders are identified by their `package.devc.xml`, not by the folder name alone.
- abapGit supports **over 200 object types** — `PROG`, `CLAS`, `INTF`, `FUGR`, `TABL`,
  `DTEL`, `DOMA`, `DDLS`, `BDEF`, `SRVD`, `SRVB`, `MSAG`, `TRAN`, and many more. The
  authoritative list is https://docs.abapgit.org/user-guide/reference/supported.html.
- Some object types are deliberately *not* serialized because they are generated
  artifacts that reappear on activation. Genuinely unsupported types fail the pull
  or push for that object; support is community-driven via the abapGit GitHub issues.

## Pull, Stage, Commit, Push {#flows}

**Pull (git → SAP):**
1. Open the repository in abapGit — it automatically compares local and remote state.
2. If the remote has newer content, a *Pull* action appears. Review the object list.
3. abapGit asks for a transport request if the package is transportable, and shows
   **overwrite confirmations** for objects that differ locally.
4. After deserialization, **activate** the pulled objects (abapGit triggers mass
   activation; check the log for activation errors).

**Stage → Commit → Push (SAP → git):**
1. *Stage* — abapGit lists every changed/new/deleted file. Per file choose:
   **Add** (create/update in git), **Remove** (delete from git), or **Ignore**
   (put on the ignore list, never touch in git). *Add All and Commit* stages
   everything at once.
2. *Commit* — mandatory fields: comment (message), committer name, committer email.
   Optional: body (long description) and separate author name/email. Keep messages in
   imperative mood; the repo history is your changelog.
3. abapGit pushes the commit to the current branch immediately — commit and push are
   one step. Afterwards the committed objects show as unchanged.

**Deleting objects:** delete in SAP first, then stage the deletion (file shows as
removed) and commit — or remove the file in git and pull, which deletes the object in
SAP after confirmation.

A start-to-finish session (new repo, first push, daily loop) is in
[examples/workflow-walkthrough.md](examples/workflow-walkthrough.md).

## Branches {#branches}

- The branch is chosen when the repo is linked and shown in the repo view; you can
  **switch branches** there, and create new ones from the current head.
- One ABAP system holds exactly **one working state per repo** — checking out a branch
  overwrites the package content with that branch's state. There is no concurrent
  multi-branch working copy in a single system/package.
- Practical strategies (from SAP's guidance):
  - **Feature branches**: `main` stays deployable; short-lived `feature/*` branches
    merged via pull requests with code review. Works best when each developer or
    feature has its own system/client — "one system per active branch".
  - **System-per-stage mapping**: DEV tracks feature branches, QAS a release branch,
    PRD the tagged `main`.
- Verify you are on the intended URL (original vs fork) *and* branch before staging —
  the stage page shows both.
- Merging with history, rebases, and conflict-heavy operations are better done with
  full git tooling (laptop clone, git host UI); abapGit then pulls the merged result.

## Conflicts and Common Errors {#errors}

**Local-change conflicts.** abapGit does not merge object-level changes. If an object
differs both locally and in the remote commit being pulled, abapGit asks whether to
**overwrite** the local version. Committing your local work *before* pulling is the
only safe answer to that dialog. For true branch merges, merge on the git side and
pull the result.

| Symptom | Cause → Fix |
|---|---|
| `ICM_HTTP_SSL_ERROR`, `SSSLERROR_SSL_READ` | Missing/wrong certificates → import the git host's CA chain in `STRUST` (SSL Client Anonymous/Standard), restart ICM |
| HTTP 401 / 403 | Bad credentials, or the host requires a personal access token instead of a password (GitHub does) |
| HTTP 404 | Wrong URL — some servers need the `.git` suffix; or a private repo without authentication |
| HTTP 407 | Proxy requires authentication → maintain proxy settings in abapGit *Global Settings* |
| Connection fails (411-type) | ICM/system parameters → see SAP Note 510007 (SSL setup of the application server) |
| "Object locked" on pull | Object sits in an unreleased transport → release the transport or remove the lock |
| Serialization error for one object | Object type not (fully) supported on this abapGit/SAP release combination → check the supported-types list, update abapGit |
| Everything shows as changed | Wrong branch or fork, or folder logic/starting folder changed after the fact |

More diagnostics (SSL test tool, user exits, GUI quirks):
https://docs.abapgit.org/user-guide/getting-started/troubleshooting.html

## Transports vs Git — and gCTS {#transports-vs-git}

abapGit adds git on top of a landscape; it does not remove CTS from it.

| Aspect | Transport-based (CTS) | Git-based (abapGit) |
|---|---|---|
| Versioning | Transport requests, version database | Commits with full history |
| Collaboration | Tasks on shared requests | Branches, pull requests, review tools |
| Rollback | Hard (import older version manually) | `git revert`, checkout of any commit |
| Multi-system distribution | Transport routes (STMS) | Clone/pull per system |
| CI/CD | Limited without add-ons | Native — pipelines act on the repo |

**Hybrid pattern most teams use:** develop in DEV, push every change to git (source of
truth, review, backup), and keep moving changes DEV → QAS → PRD with normal transports.
abapGit itself puts pulled objects on transport requests in transportable packages, so
the two coexist by design.

**gCTS is a different product.** Git-enabled CTS (component BC-CTS-GIT, S/4HANA /
ABAP Platform 1909+) makes the *transport system itself* store changes in git
repositories — transport releases become commits, imports become pulls, driven by SAP
tooling and licenses. Use gCTS when you want git-backed *transport management* across
a landscape; use abapGit when you want object-level git workflows, open-source
projects, or code exchange between arbitrary systems. They can coexist but do not
share repositories. Comparison table:
[references/environments-and-ci.md](references/environments-and-ci.md).

## abapGit in ABAP Cloud / BTP {#abap-cloud}

- The SAP BTP ABAP environment ships with a **preinstalled, SAP-distributed cloud
  version of abapGit**. You do not (and cannot) install the community standalone
  report there.
- The UI is the **abapGit Repositories** view in ADT (*Window → Show View → Other →
  abapGit Repositories*), provided by the abapGit ADT plugin from
  `https://eclipse.abapgit.org/updatesite/`. Link a repository with its HTTPS URL,
  choose branch and target package, pull.
- Constraints in the BTP ABAP environment:
  - The repository must be **reachable from the internet**; Cloud Connector is *not*
    supported for abapGit connections.
  - Only objects and language elements allowed in ABAP Cloud can be imported — pulls
    of classic-only object types or unreleased API usage fail activation. Check
    [abap-cloud-development](../abap-cloud-development/SKILL.md) before moving code.
  - Some generated/compiled object types are deliberately skipped on export and must
    be regenerated in the target.
- The flagship use case is **code transfer**: serialize an on-premise package with
  community abapGit, push to git, then pull into the BTP system via ADT — the standard
  first step of a cloud migration (see
  [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md)).
- SAP supports the Git integration of the ABAP environment, but not the community
  abapGit project itself.

## CI with abaplint {#ci}

Because abapGit stores objects as plain text, standard CI can run on every push.
[abaplint](https://abaplint.org/) is a TypeScript-based static analyzer that works
directly on abapGit-serialized files — no SAP system needed in the pipeline.

```jsonc
// abaplint.json — minimal example at the repository root
{
  "global": {
    "files": "/src/**/*.*"
  },
  "syntax": {
    "version": "v702",            // or "Cloud" for ABAP Cloud rules
    "errorNamespace": "^(Z|Y)"
  },
  "rules": {}                     // enable rules per project policy
}
```

```yaml
# .github/workflows/abaplint.yml
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

Patterns that build on this — lint gates on pull requests, syntax checks against a
target release before a cloud migration, running the abapGit test suite itself — are
collected in [references/environments-and-ci.md](references/environments-and-ci.md).

## Quick Reference

| Task | How |
|---|---|
| Install abapGit | Report `ZABAPGIT_STANDALONE` from the build repo; activate; run |
| Online repo | *New Online* → HTTPS URL → package → branch → pull |
| Offline repo | *New Offline* → package → *Import ZIP* / *Export ZIP* |
| SSL trust | `STRUST` → SSL Client (Anonymous/Standard) → import CA chain → restart ICM |
| Config file | `.abapgit.xml` at repo root; edit via Repository Settings UI |
| Folder logic | `PREFIX` (suffix folders, portable) / `FULL` (full names, fixed) / `MIXED` |
| Starting folder | `/src/` by convention; content outside is not deserialized |
| Ignore files | `IGNORE` list, ABAP `CP` patterns (`*`, `+`), not regex |
| Push flow | Stage (Add/Remove/Ignore per file) → Commit (msg + committer) → auto-push |
| Pull flow | Open repo → Pull → transport prompt → overwrite confirms → activate |
| Transports | Pull into transportable package prompts for a workbench request |
| BTP / Steampunk | ADT abapGit Repositories view; repo must be internet-reachable |
| Supported types | 200+; see docs.abapgit.org supported list before assuming |
| CI lint | `abaplint.json` + abaplint via npm/Docker/GitHub Actions |

## Common Mistakes

| Mistake | Why it hurts | Instead |
|---|---|---|
| Linking a repo to a package that already has other objects | The repo claims every object in the package; unrelated code gets serialized or flagged deleted | One new, dedicated package per repository |
| Naming the standalone report `ZABAPGIT` | Collides with the developer version's program name | Always `ZABAPGIT_STANDALONE` |
| Pulling with uncommitted local changes | Overwrite dialog → local work silently lost | Stage and commit local work first, then pull |
| Hand-editing `MASTER_LANGUAGE` in `.abapgit.xml` | Texts serialized in the wrong language; state inconsistent | Changing master language requires uninstall + reinstall of the repo |
| Regex in the `IGNORE` list | Patterns are ABAP `CP` logic, not regex — regex silently matches nothing | Use `*` / `+` patterns like `/src/hr/zcl_confidential*` |
| `PREFIX` folder logic on non-prefixed packages | Serialization cannot map package → folder | Use `FULL` (or rename packages to a prefix convention) |
| Expecting abapGit to deploy to QAS/PRD | abapGit versions code; CTS (or gCTS/pipelines) moves it | Hybrid: git for history/review, transports for delivery |
| Treating gCTS and abapGit as interchangeable | Different products, different repos, different support channels | abapGit = object-level community client; gCTS = git-backed CTS |
| Installing the standalone report on BTP ABAP environment | Not possible; cloud systems ship SAP's abapGit | Use the ADT abapGit Repositories view |
| Assuming every object type serializes | Unsupported types fail pull/push late and noisily | Check the supported-object-types list up front |
| Password auth against GitHub | Rejected — 401 | Personal access token as password |

## References

- abapGit documentation: https://docs.abapgit.org/
- abapGit repository and README: https://github.com/abapGit/abapGit
- Installation guide: https://docs.abapgit.org/user-guide/getting-started/install.html
- Troubleshooting: https://docs.abapgit.org/user-guide/getting-started/troubleshooting.html
- `.abapgit.xml` settings: https://docs.abapgit.org/user-guide/repo-settings/dot-abapgit.html
- Folders and file names: https://docs.abapgit.org/user-guide/reference/folders-filenames.html
- Packages and transports: https://docs.abapgit.org/user-guide/reference/packages.html
- Supported object types: https://docs.abapgit.org/user-guide/reference/supported.html
- Stage and commit: https://docs.abapgit.org/user-guide/projects/online/stage-commit.html
- Offline projects: https://docs.abapgit.org/user-guide/projects/offline/install.html
- SAP BTP: Working with abapGit (Help Portal source): https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/working-with-abapgit-d62ed9d.md
- gCTS overview (SAP Help): https://help.sap.com/docs/ABAP_PLATFORM_NEW/4a368c163b08418890a406d413933ba7/f319b168e87e42149e25e13c08d002b9.html
- abaplint: https://abaplint.org/
- Local deep dives: [references/repo-configuration.md](references/repo-configuration.md),
  [references/environments-and-ci.md](references/environments-and-ci.md)
- Local examples: [examples/dot-abapgit-annotated.xml](examples/dot-abapgit-annotated.xml),
  [examples/workflow-walkthrough.md](examples/workflow-walkthrough.md)
