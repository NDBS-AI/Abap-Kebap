# abapGit Repository Configuration — Deep Dive

Companion to the main skill (`../SKILL.md`). Covers `.abapgit.xml` setting by setting,
folder logic edge cases, the serialization file format, and how packages and transports
interact with a repository. Everything here is grounded in the official docs at
https://docs.abapgit.org/ (page links inline).

## 1. `.abapgit.xml` — setting by setting

Source: https://docs.abapgit.org/user-guide/repo-settings/dot-abapgit.html

The file must sit in the **root folder** of the git repository (not in the starting
folder). It is an ABAP `asXML` document; abapGit reads and writes it itself. The
supported way to change it is the **Repository Settings** page in the abapGit UI.
Direct XML edits are for exceptional cases (e.g. repairing a broken repo via
*Utilities → Database Util*), because several settings interact with objects that are
already deserialized in the systems linking the repo.

### MASTER_LANGUAGE

- A `sy-langu` single-character value (`E`, `D`, `T`, …).
- Declares the original language of *all* objects in the repository. abapGit
  serializes object texts in this language.
- **Changing it after the fact is not an edit — it is a migration.** The documented
  procedure is: uninstall the repository (remove objects), change the value, pull
  again. Objects created under the old master language keep it otherwise.
- Pick `E` for anything that might ever be shared publicly or across regions.

### I18N_LANGUAGES (translation languages)

- Optional, comma-separated ISO language codes (e.g. `DE,TR,FR`).
- Enables serialization of translations in addition to the master language.
- Documented as **experimental** — verify round-trips before relying on it for
  translation-heavy objects.

### STARTING_FOLDER

- The folder inside the repo where deserialization begins; `/src/` by strong
  convention. `/` means the repo root itself.
- Everything *outside* the starting folder is invisible to abapGit deserialization —
  which is exactly where `README.md`, `LICENSE`, CI configs, and docs belong. That is
  why most repos need only a short `IGNORE` list.

### FOLDER_LOGIC — PREFIX, FULL, MIXED

Source: https://docs.abapgit.org/user-guide/reference/folders-filenames.html

| Logic | Folder name for subpackage | Constraint | Portability |
|---|---|---|---|
| `PREFIX` | Child package name minus parent package name | Every child package name must start with its parent's name | High — installing system may choose any top package name |
| `FULL` | Complete package name, lower-cased | None on naming | Low — every installing system must use identical package names |
| `MIXED` | Combination of both behaviors | Partial prefix convention | Medium |

Worked example, top package `ZFOO`, starting folder `/src/`:

```
Package hierarchy          PREFIX                 FULL
ZFOO                       /src/                  /src/
├── ZFOO_CORE              /src/core/             /src/zfoo_core/
│   └── ZFOO_CORE_UTIL     /src/core/util/        /src/zfoo_core_util/
└── ZFOO_UI                /src/ui/               /src/zfoo_ui/
```

Practical guidance:

- **PREFIX** is the default choice for new development: another team can install the
  repo under `YFOO` or `/CUST/FOO` and abapGit derives `YFOO_CORE` etc.
- **PREFIX + 30-character limit:** SAP package names cap at 30 characters. Deep folder
  trees concatenate onto the installing top package name — a long top package plus
  long suffixes can exceed the limit at install time even though the origin system was
  fine. Keep suffixes short.
- **FULL** fits existing package landscapes whose names do not follow a strict prefix
  convention, and repos that will only ever live in system copies of the same
  landscape (names must match everywhere).
- Changing folder logic on a populated repo changes every file path — git sees a
  delete + add of the whole tree. Decide before the first push.

### IGNORE

- A list of file patterns abapGit will not deserialize (and offers as the *Ignore*
  option during staging).
- Matching uses ABAP's `CP` ("covers pattern") semantics: `*` = any string,
  `+` = any single character. **Not regex.**
- Patterns match against the full path inside the repo:
  - `/README.md` — one specific file
  - `*.prog.abap` — every program source anywhere
  - `/src/hr/zcl_confidential*` — subtree-scoped prefix match
- Typical minimal list: `/.gitignore`, `/LICENSE`, `/README.md`, CI config files —
  anything at root outside the starting folder technically does not even need it, but
  listing them keeps staging output clean.

### REQUIREMENTS

- Declares minimum software component versions (component, minimum release, patch
  level) that a target system must satisfy before the repository may be pulled.
- Use it when serialized objects depend on a specific SAP_BASIS / S4CORE level —
  the pull fails fast with a clear message instead of half-deserializing.

### ABAP language version and source system (newer, partly experimental)

- The settings page documents optional restrictions on ABAP language version and an
  origin-system assignment. Both are marked experimental/limited in the docs; check
  https://docs.abapgit.org/user-guide/repo-settings/dot-abapgit.html for current state
  before building a process on them.

## 2. Local vs remote repository settings

Not everything lives in `.abapgit.xml`:

- `.abapgit.xml` = **remote settings**, shared with everyone via git.
- **Local settings** (per system, stored in the abapGit database, *not* in git):
  display name, write-protection, ignore-subpackage behavior, serialization options
  such as parallelization. See
  https://docs.abapgit.org/user-guide/repo-settings/local.html and
  https://docs.abapgit.org/user-guide/repo-settings/remote.html.
- Consequence for support questions: if two systems behave differently on the same
  repo, compare their *local* settings first — the remote ones are identical by
  construction.

## 3. Serialization format

Source: https://docs.abapgit.org/user-guide/reference/folders-filenames.html

### File naming

```
<object_name>.<object_type>.<extension>
<object_name>.<object_type>.<object_part>.<extension>
```

- `<object_type>` is the lower-cased TADIR type: `clas`, `intf`, `prog`, `fugr`,
  `tabl`, `dtel`, `doma`, `ddls`, `bdef`, `srvd`, `srvb`, `devc`, …
- Extensions: `.abap` for source, `.xml` (and `.json` for some types) for metadata,
  further extensions for binary-ish content such as MIME objects.
- Object parts split multi-source objects, e.g. a class serializes as:
  - `zcl_invoice.clas.abap` — main source
  - `zcl_invoice.clas.xml` — metadata (description, attributes)
  - `zcl_invoice.clas.testclasses.abap` — local test include (when present)
  - `zcl_invoice.clas.locals_imp.abap` — local types/implementations (when present)
- Characters that are legal in ABAP object names but hostile to file systems
  (`% # . = ? < >`, namespace slashes) are escaped in file names — expect `#` escapes
  for namespaced objects.

### Folder metadata

- Every package folder contains a `package.devc.xml` holding the package metadata.
  The folder *name* is derived via folder logic; the folder *identity* is the DEVC
  file.
- Optional `.apack-manifest.xml` at root declares APACK dependencies (a lightweight
  dependency mechanism among abapGit projects).

### Supported object types

Source: https://docs.abapgit.org/user-guide/reference/supported.html

- 200+ object types are serializable; the table on that page is the single source of
  truth, per abapGit version.
- Types marked unsupported have open GitHub issues; new type support is contributed by
  the community (requests are collected in a pinned abapGit issue).
- Two distinct failure modes to keep apart:
  1. **Unsupported type** — abapGit refuses/errors on the object.
  2. **Deliberately skipped generated artifacts** — some compiled/generated objects
     are not exported by design and are regenerated on activation in the target
     system. Missing-after-pull does not always mean broken.

## 4. Packages and transports

Source: https://docs.abapgit.org/user-guide/reference/packages.html

- The repository stores **no SAP package names** (under PREFIX logic). The link
  "repo → top package" exists only in each system's abapGit persistence.
- Subpackages are auto-created on pull with the parent's properties (transport layer,
  software component).
- Transport prompting on pull is driven entirely by standard CTS configuration:

| Target package | What abapGit does |
|---|---|
| `$TMP` / local `$…` | No transport request |
| Local package w/o transport layer | Local (non-transportable) workbench request, if the system demands one |
| Transportable `Z…`/`Y…` | Prompts for a transportable workbench request; objects are recorded on it |
| Namespaced `/ns/…` | As transportable; the namespace and its repair license must exist |

- With several transport layers configured, package creation may ask you to choose the
  layer — a wrong pick here silently routes future transports down the wrong route.
- **Design rule: one repo = one dedicated package tree.** Never point a repo at a
  package containing unrelated objects; abapGit would treat them as part of the repo
  (serialize them on push, or mark them for deletion when they are absent from git).

## 5. Checklist when creating a new repository

1. Create a fresh package (decide transportable vs `$…` consciously).
2. Choose folder logic **before** first push (PREFIX unless names forbid it).
3. Set master language `E` unless there is a hard reason otherwise.
4. Keep starting folder `/src/`; put README/LICENSE/CI at root.
5. Add an `IGNORE` entry for any root files that leak into staging.
6. Add `REQUIREMENTS` if the code needs a minimum component level.
7. First push: stage all, commit with a meaningful message, verify the tree on the
   git host looks like §3 above.
