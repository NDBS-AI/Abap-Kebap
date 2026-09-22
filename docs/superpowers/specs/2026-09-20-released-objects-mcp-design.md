# Released-Objects MCP Server — Design

Status: approved in brainstorming on 2026-09-20; not yet implemented.
Plugin version this ships in: `abap-kebap` 0.3.0.

## 1. Goal

Give the three ABAP agents a **queryable ground truth** for the question they currently
answer from prose: *"Is SAP object X usable in ABAP Cloud / Clean Core on this target, and if
not, what is the successor?"*

The truth lives in SAP's public **Cloudification Repository**
(<https://github.com/SAP/abap-atc-cr-cv-s4hc>): the JSON lists that the ATC checks
"Usage of Released APIs (Cloudification Repository)" and "Usage of APIs" consume, browsable
by humans at <https://sap.github.io/abap-atc-cr-cv-s4hc/>. abap-kebap ships a small,
self-contained MCP server named **`released-objects`** that downloads those lists once,
keeps them fresh with a daily conditional check, and exposes three tools over them.

The server is bundled with the plugin: installing abap-kebap from the marketplace installs
and auto-starts it — no extra command, no separate package.

## 2. Background

### 2.1 The source data

`src/` of the SAP repo holds one JSON per product/release plus one classification file:

| File (under `https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/`) | Product | Approx. size | What it holds |
|---|---|---|---|
| `objectReleaseInfoLatest.json` | SAP Cloud ERP (S/4HANA Cloud Public Edition) | 11 MB, ~37k entries | release state per object |
| `objectReleaseInfo_PCELatest.json` | SAP Cloud ERP Private (S/4HANA Cloud Private Edition / on-premise), latest FPS | 12 MB, ~43k entries | release state per object |
| `objectReleaseInfo_PCE<version>.json` | same, frozen per Feature Pack Stack (`PCE2022`, `PCE2023_2`, `PCE2025_1`, …) | 4–12 MB each | release state per object |
| `objectReleaseInfo_BTPLatest.json` | SAP BTP ABAP Environment (Steampunk) | 2 MB | release state per object |
| `objectClassifications_SAP.json` | SAP Cloud ERP Private only | 2.4 MB, ~8.6k entries | Clean Core classification of *classic* objects (`classicAPI`, `noAPI`) with successors and labels |
| `partner/objectClassifications_<NAMESPACE>.json` (28 files as of 2026-09; `objectClassifications_NAMESPACE.json` is SAP's empty template) | partner add-ons, one file per registered namespace `/NAMESPACE/` | ~0.4 MB in total, ~1.4k entries | partner Clean Core classifications (`classicAPI`, `noAPI`) with labels such as `remote-enabled`, `transactional-consistent` (§6.5) |

Not used: `src/archive/` (~190 MB of superseded snapshots), CSV exports and the `.toon`
variants. The viewer app is only a UI over the same JSON.

Record shape (identical in all file kinds; the top-level array is `objectReleaseInfo` or
`objectClassifications`, next to a `formatVersion` that is a number in SAP files and the
string `"2"` in partner files):

```json
{
  "tadirObject": "FUGR",  "tadirObjName": "REBD_BAPI_BUILDING",
  "objectType": "FUNC",   "objectKey": "BAPI_RE_BU_GET_DETAIL",
  "softwareComponent": "S4CORE", "applicationComponent": "RE-FX-BD",
  "state": "released",
  "successorClassification": "oneObject",
  "successors": [ { "tadirObject": "CLAS", "tadirObjName": "…", "objectType": "CLAS", "objectKey": "…" } ],
  "successorConceptName": "I_MaintenanceNotificationTP_3",
  "labels": ["…"]
}
```

`tadirObject`/`tadirObjName` is the TADIR container (a function group for a function module);
`objectType`/`objectKey` is the object itself. `successors`, `successorConceptName` and
`labels` are optional. Observed `state` values: `released`, `deprecated`, `notToBeReleased`
(release-info files) and `classicAPI`, `noAPI` (classification file). `stable` is accepted
for forward compatibility but has not been observed.

### 2.2 The viewer's filters, as evidence of the data's axes

SAP Product (4 values → the four "Latest" files above plus partner sets), Release (Latest or a
frozen FPS), State, Object Type (34 TADIR types observed, from `CLAS`/`INTF`/`TABL`/`DTEL`
to `BDEF`, `CHKV`, `BADI_DEF`), Software Component (7 values), Application Component (the
full SAP component path, e.g. `MM-PUR-SRC-SL`), Partner Namespace and Label (partner sets
only). The tools below expose exactly the axes an agent needs: target, state/level, object
type, application component, partner namespace and label.

### 2.3 Design conventions for the tools

The tool surface is derived from what the three agents need (§7), not from the viewer: three
tools, Zod input schemas whose `.describe()` text teaches the model the semantics, the Clean
Core Level A–D vocabulary, hard bounds on query length, batch size and pagination, explicit
target/version parameters, and an offline-first disk cache. The server is original code with
no third-party runtime dependency beyond the MCP SDK, Zod and undici.

### 2.4 Clean Core Levels

SAP's 2025 "Usage of APIs" check classifies objects for SAP Cloud ERP Private into cumulative
levels: **A** released APIs (ABAP Cloud, upgrade-safe) · **B** classic APIs (upgrade-stable,
governance recommended) · **C** internal / unclassified · **D** `noAPI` (not Clean Core).
For SAP Cloud ERP and BTP ABAP Environment only Level A exists: an object is released
(possibly deprecated) or it is not usable.

## 3. Non-goals

- The server never connects to an SAP system. Target detection reads the local ADT
  destinations file only (§6.4); live checks (ATC through the ADT MCP) stay with the agent and
  are optional.
- No archive snapshots, CSV or TOON inputs.
- No method-, field- or parameter-level release information — the data is TADIR-granular, and
  the agents must keep saying so ("released object ≠ every member released").
- No REST API, no hosting, no authentication — stdio MCP only.
- No new skill; existing skills gain pointers.
- No vendored data in the repository.

## 4. Architecture

```
/plugin install abap-kebap@abgunes
        │  (git clone of this repo; no build step runs on the user's machine)
        ▼
.claude-plugin/plugin.json ── mcpServers.released-objects ──► node mcp/released-objects/dist/index.js
                                                                     │  (committed single-file bundle)
                                    ┌────────────────────────────────┼─────────────────────────────────┐
                                    │  tools/ (MCP layer)            │  cache.ts (freshness)            │
                                    │  check_objects                 │  manifest.json + JSON files      │
                                    │  search_objects   ◄── query.ts │  under ${CLAUDE_PLUGIN_DATA}/    │
                                    │  dataset_info         (pure)   │  released-objects/               │
                                    └────────────────────────────────┴───────────────┬─────────────────┘
                                                                                     │ HTTPS, conditional GET,
                                                                                     │ once per local day
                                                                                     ▼
                                                        raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/…
```

Three units, each testable alone:

1. **Cache manager** (`cache.ts`) — owns the data directory and `manifest.json`; downloads,
   validates, atomically replaces files; enforces the daily check, backoff and offline rules.
2. **Query engine** (`datasets.ts`, `query.ts`) — loads a dataset into in-memory indexes and
   answers lookups, level derivation and ranked search. Pure functions over records.
3. **Tool layer** (`tools/*.ts`, `schemas.ts`) — Zod-validated MCP tools that call the engine
   and shape results and errors.

## 5. Distribution and auto-start

- Declared **inline** in `.claude-plugin/plugin.json` (no `.mcp.json` at the repo root — the
  plugin root is the repo root, and a root `.mcp.json` would register the server a second
  time):

  ```json
  "mcpServers": {
    "released-objects": {
      "command": "node",
      "args": [
        "${CLAUDE_PLUGIN_ROOT}/mcp/released-objects/dist/index.js",
        "--data-dir", "${CLAUDE_PLUGIN_DATA}/released-objects"
      ]
    }
  }
  ```

- `mcp/released-objects/dist/index.js` is a **committed, dependency-free single-file bundle** built with
  esbuild (MCP SDK, Zod and undici folded in). Runtime requirement: Node.js ≥ 20, which
  Claude Code itself already needs. The server checks `process.version` at startup and exits
  with a clear stderr message below 20.
- Tool names as seen by the model: `mcp__plugin_abap-kebap_released-objects__check_objects`,
  `…__search_objects`, `…__dataset_info`. Agent prose refers to them as "the
  `released-objects` tools".
- Local development: `claude --plugin-dir <repo>` loads the working tree as a plugin, server
  included. Users can disable the server without uninstalling the plugin via `/mcp`.
- The server logs to **stderr only** (stdout is the MCP stdio transport); `--verbose` adds
  request-level detail.

## 6. Data model

### 6.1 Targets

| `target` | Product | Release-info file | Classification file | Levels |
|---|---|---|---|---|
| `btp-abap-environment` | SAP BTP ABAP Environment (Steampunk) | `objectReleaseInfo_BTPLatest.json` | — | A only |
| `cloud-erp` | SAP Cloud ERP (S/4HANA Cloud Public Edition) | `objectReleaseInfoLatest.json` | — | A only |
| `cloud-erp-private` | SAP Cloud ERP Private / on-premise S/4HANA | `objectReleaseInfo_PCELatest.json` or `objectReleaseInfo_PCE<version>.json` | `objectClassifications_SAP.json` | A–D |

`target` accepts one of the three values above or `auto` (the default). `auto` never guesses
silently: the server resolves the target from the sources in §6.4, echoes `resolvedTarget`,
`resolvedFrom`, `confidence` and (for medium confidence) a ready-to-quote `assumption`
sentence in every result, and fails with `TARGET_AMBIGUOUS` (listing candidates) when it
cannot decide — so the agent asks the user a concrete question instead of assuming. Callers
may also pass `system` (facts about the connected system, §6.4) instead of a target.

`version` applies to `cloud-erp-private` only. Accepted: `latest` (default) or
`YYYY` / `YYYY_N` (`N` = Feature Pack Stack / SP number, e.g. `2023_2`). Resolution:
`latest` → `_PCELatest`; `YYYY_N` → `_PCE{YYYY}_{N}`; `YYYY` → `_PCE{YYYY}`, then
`_PCE{YYYY}_0`. Passing `version` for another target is an `INVALID_INPUT` error, not
silently ignored. An unknown version (upstream 404) is `UNKNOWN_VERSION` and lists the known
versions.

### 6.2 Level derivation

Lookups are case-insensitive on `objectKey`, secondarily on `tadirObjName`, optionally
filtered by `objectType`.

For `cloud-erp-private`, both files are consulted and **both raw facts are reported**
(`releaseState` from the release-info file, `classification` from the SAP classification
file or — for `/NAMESPACE/` objects not covered by SAP — the partner file, §6.5; `origin`
names the source). The derived `cleanCoreLevel` is:

| Facts found | Level | `allowed` (given `maxLevel`) |
|---|---|---|
| `releaseState` ∈ {`released`, `deprecated`} | A | true; `deprecated: true` adds a warning and the successor |
| else `classification` = `classicAPI` | B | true if `maxLevel` ≥ B |
| else `classification` = `noAPI` | D | true only if `maxLevel` = D |
| else (`notToBeReleased`, `stable`, or absent from both files) | C | true if `maxLevel` ≥ C |

For `cloud-erp` and `btp-abap-environment` only the release-info file exists:
`released`/`deprecated` → Level A, allowed; anything else **including absent** → level
`none`, blocked. Absent is never reported as released. `maxLevel` other than `A` on these
targets is an `INVALID_INPUT` error.

A name absent from the data has no record to carry a level, so its result carries
`impliedLevel` instead: `C` on `cloud-erp-private` (unclassified), `none` on the other two
targets, with `allowed` derived from it against `maxLevel` exactly as above.

### 6.3 Successors

Normalised to a list of `{ "kind": "object", "objectType", "objectKey" }` (from
`successors[]`) and `{ "kind": "concept", "name" }` (from `successorConceptName`), with the
raw `successorClassification` passed through. One hop only (§18 for chain walking).

### 6.4 Target resolution

The user's priority order: the **connected ADT MCP first**, then the prompt, then local ADT
state, then ask.

**What each source provides.** The ADT MCP server of the `sapse.adt-vscode` extension (HTTP,
`http://localhost:<port>/mcp`, bearer token) exposes `abap_list_destinations` — no
parameters; returns the ids of the destinations the user is logged on to in VS Code. It does
not return URLs or product information. The id → system mapping lives in the extension's
`~/.adtls/destinations.json`:

```json
{ "formatVersion": "1.0",
  "destinations": [
    { "id": "S4H_PUBLIC", "protocol": "http",
      "properties": { "systemUrl": "https://my123456.s4hana.cloud.sap", "authenticationKind": "reentranceticket" } },
    { "id": "ERP_100", "protocol": "rfc",
      "properties": { "systemId": "ERP", "applicationServer": "…", "systemNumber": "00", "client": "100", "language": "EN", "user": "…" } }
  ] }
```

The server reads only `id`, `protocol`, `properties.systemUrl` (host part) and
`properties.systemId`; `user` and any credential-like field are never read, returned or
logged. The extension's language server also keeps a `~/.adtls/session-<destinationId>-<hash>/`
folder per destination it has logged on to — the most recently modified one is the "last
logged-on destination" hint. Both paths are overridable (`ABAP_KEBAP_ADT_DESTINATIONS_PATH`,
`ABAP_KEBAP_ADT_STATE_DIR`); a missing or malformed file simply removes that source.

**`system` input** (alternative to `target`):
`{ destinationId?, url?, protocol?: "http" | "rfc", systemId?, softwareComponents?: [{ component, release }] }`.
`destinationId` is looked up in the destinations file; the other fields are used directly.

**Heuristics** (first matching row wins; `softwareComponents` dominate when present):

| Evidence | Target | Confidence |
|---|---|---|
| `SAP_BASIS` release ≥ 900 and no `S4CORE` component | `btp-abap-environment` | high |
| `SAP_BASIS` release ≥ 900 and `S4CORE` present | `cloud-erp` | high |
| `SAP_BASIS` release < 900 | `cloud-erp-private`; `version` from `S4CORE` (107 → 2022, 108 → 2023, 109 → 2025, otherwise `latest`) | high |
| URL host matches `*.abap.*.hana.ondemand.com` or `*.abap-web.*.hana.ondemand.com` | `btp-abap-environment` | high |
| URL host matches `*.s4hana.cloud.sap` or `*.s4hana.ondemand.com` | `cloud-erp` | medium — Private Edition tenants can share the domain; `assumption` says so |
| `protocol` = `rfc` (SAP GUI/RFC access exists) | `cloud-erp-private` | high — public cloud and BTP offer no RFC access |
| any other host (customer domain, port such as 44300, IP address) | `cloud-erp-private` | medium |

**Resolution order for `target: "auto"` (server side):**

1. `ABAP_KEBAP_RELEASED_OBJECTS_TARGET` environment variable, if set (pins a project to one
   product) — `resolvedFrom: "env"`.
2. Destinations file: the last-logged-on session hint, if its id exists in the file —
   `resolvedFrom: "adt-session:<id>"`, confidence capped at medium.
3. Exactly one destination in the file — `resolvedFrom: "adt-destinations:<id>"`.
4. Otherwise `TARGET_AMBIGUOUS`, carrying every destination as a candidate
   `{ id, protocol, hostSuffix, inferredTarget, confidence, lastSession }` (host reduced to its
   last three labels).

**Procedure for the agents** (written into `abap-cloud-development`, §10):

1. If the ADT MCP tools are present, call `abap_list_destinations`. One id → pass
   `system: { destinationId }`. Several → take the one the prompt or the open file names;
   otherwise ask the user, offering the ids.
2. Else, if the prompt names the product, pass `target` explicitly (Steampunk / BTP ABAP
   Environment → `btp-abap-environment`; S/4HANA Cloud Public Edition / "Cloud ERP" →
   `cloud-erp`; on-premise, Private Edition, RISE, ECC conversion → `cloud-erp-private`).
3. Else call with `target: "auto"`; on `TARGET_AMBIGUOUS`, ask the user using the candidates.
4. Whenever `confidence` is `medium`, repeat the `assumption` sentence in the answer so the
   user can correct it.
5. When the ADT MCP is connected, `abap_atc_run` with the Cloud Readiness / Clean Core check
   variant is the authoritative final check; `check_objects` is the fast, offline first pass.

### 6.5 Partner namespaces

SAP lets partners publish Clean Core classifications for their add-ons in
`src/partner/objectClassifications_<NAMESPACE>.json` — one file per registered namespace
`/NAMESPACE/`; the viewer's "Partner APIs Only" product and its "Partner Namespace" and
"Label" filters browse them. As of 2026-09: 28 partner files, ~1.4k objects (`CLAS`, `FUNC`,
`INTF`, `CDS_STOB`), states `classicAPI` / `noAPI` only, labels `remote-enabled` and
`transactional-consistent`, `formatVersion` `"2"`. `objectClassifications_NAMESPACE.json` is
SAP's empty template and is skipped by name.

**Discovery.** There is no committed index — the viewer lists the directory at build time. The
server keeps a **partner index**: once per day, as part of the freshness check, it lists
`src/partner` through the GitHub contents API
(`GET https://api.github.com/repos/SAP/abap-atc-cr-cv-s4hc/contents/src/partner`;
unauthenticated, 60 requests per hour per IP — one per machine per day) and stores the file
names and blob SHAs in the manifest. If the API is unreachable or rate-limited, the server
uses the **built-in list** bundled with the plugin (regenerated at every plugin release by
`npm run update-partner-index`) plus whatever is already cached. Partner files are
downloaded eagerly after the core files and join the daily conditional check; a partner
failure never delays core readiness (`dataset_info` shows the partner section separately).

**Lookup.** For an object key starting with `/NAMESPACE/` the order is SAP release-info → SAP
classification → the partner file of that namespace (SAP's own namespaces such as `/AIF/` or
`/IWBEP/` resolve through the SAP files first). Every match carries `origin` (`sap` or
`partner:/NAMESPACE/`) and the record's `labels`. A namespaced object found nowhere gets, in
addition to `suggestions`, the hint "no classification published for `/NAMESPACE/` in the
Cloudification Repository — ask the vendor".

**Levels.** Partner classifications feed the same `classification` slot as SAP's (§6.2):
Level B or D on `cloud-erp-private`; on `cloud-erp` and `btp-abap-environment` they are not
released and therefore blocked, but the classification and labels are still reported so the
agent can explain why.

**Search.** `search_objects` accepts `scope` (`sap` · `partner` · `all`, default `all`),
`partnerNamespace` (`/OTX/` or `OTX`) and `label` filters; results carry `origin` and
`labels`.

## 7. Tools

All inputs are Zod schemas; every field has `.describe()` text that states the semantics for
the model (level cumulativeness, version format, when to ask the user for the target).
Every successful result carries `dataAsOf` (the upstream commit date of the file when known,
otherwise the download date) and `source` (the SAP repository URL) so agents can cite.

### 7.1 `check_objects` — the verdict tool

Input:

| Field | Type / bounds | Notes |
|---|---|---|
| `target` | enum or `auto`, default `auto` | §6.1, §6.4 |
| `system` | object, optional | facts about the connected system (`destinationId`, `url`, `protocol`, `systemId`, `softwareComponents`), resolved server-side per §6.4; ignored when `target` is explicit |
| `objects` | array 1–200 of `string` or `{ name: string, type?: string }` | `name` 1–120 chars; `type` is a TADIR object type such as `CLAS`, `TABL`, `FUNC`, `DDLS` |
| `version` | string, optional | `cloud-erp-private` only |
| `maxLevel` | `A`–`D`, default `A` | cumulative; `A` forced for public/BTP |

Output:

```json
{
  "target": "auto", "resolvedTarget": "cloud-erp-private", "resolvedFrom": "adt-destinations:ERP_100",
  "confidence": "high", "assumption": null,
  "version": "latest", "resolvedFile": "objectReleaseInfo_PCELatest.json",
  "maxLevel": "B", "dataAsOf": "2026-09-02", "source": "https://github.com/SAP/abap-atc-cr-cv-s4hc",
  "summary": { "checked": 2, "allowed": 0, "blocked": 1, "deprecated": 0, "notFound": 1, "ambiguous": 0,
               "byLevel": { "A": 0, "B": 0, "C": 2, "D": 0, "none": 0 } },
  "results": [
    { "name": "MARA", "verdict": "blocked", "found": true,
      "matches": [ { "objectType": "TABL", "objectKey": "MARA", "tadirObject": "TABL", "tadirObjName": "MARA",
                     "softwareComponent": "S4CORE", "applicationComponent": "LO-MD-MM",
                     "releaseState": "notToBeReleased", "classification": null, "origin": "sap", "cleanCoreLevel": "C",
                     "allowed": false, "deprecated": false,
                     "successors": [ { "kind": "object", "objectType": "DDLS", "objectKey": "I_PRODUCT" } ],
                     "successorClassification": "oneObject", "labels": [] } ] },
    { "name": "SOME_UNKNOWN_OBJECT", "verdict": "not-found", "found": false,
      "impliedLevel": "C", "allowed": false, "matches": [],
      "suggestions": [ { "objectType": "TABL", "objectKey": "SOME_UNKNOWN_OBJ", "cleanCoreLevel": "B", "reason": "edit-distance" } ],
      "hint": "Not in the SAP data for this target. Check the type (CDS entity DDLS vs SQL view, function group FUGR vs function module FUNC) and namespaces (/NS/CL_X). Custom Z/Y objects are never listed." }
  ]
}
```

For `not-found` results the server does its best to recover a typo or a wrong-name variant:
`suggestions` holds up to five near matches from the search index (prefix, substring, or
Levenshtein distance ≤ 2 on `objectKey` / `tadirObjName`, namespace slashes ignored), each
with its level and the reason it matched, plus a fixed `hint` naming the usual causes. The
agent retries with the corrected name rather than reporting "unknown".

`verdict` ∈ `allowed` · `allowed-deprecated` · `blocked` · `not-found` · `ambiguous`
(the name matched several object types with different outcomes and no `type` was given —
the result tells the agent to pass `type`). `not-found` counts under its `impliedLevel` in
`summary.byLevel` and under `notFound`; it is never counted as `allowed` unless
`impliedLevel` ≤ `maxLevel` on `cloud-erp-private`.

### 7.2 `search_objects` — discovery for released-API selection

Input: `target` / `system` as in `check_objects`, `query` (1–200 chars), `objectType?`, `applicationComponent?`
(case-insensitive prefix, e.g. `MM-PUR`), `state?` (raw state enum), `maxLevel?`
(`cloud-erp-private` only, cumulative), `version?`, `scope?` (`sap` · `partner` · `all`,
default `all`), `partnerNamespace?`, `label?` (§6.5), `limit` 1–100 (default 25), `offset` ≥ 0
(default 0).

Matching is over `objectKey` and `tadirObjName`: exact match ranks first, then prefix, then
substring, then "all query tokens appear as substrings" (so `purchase order` finds
`I_PURCHASEORDER…`). Ties sort alphabetically. Output: `{ total, offset, limit, dataAsOf,
source, results: [ record + cleanCoreLevel ] }`. Known weakness, stated in the tool
description: SAP abbreviations (`PURCHORD`, `PHYSINVTRY`) are not expanded in v1 — search by
technical-name fragments when a concept search returns little.

### 7.3 `dataset_info` — provenance and freshness

Input: `{ refresh?: boolean }`. With `refresh: true` the daily gate and backoff are bypassed,
the check runs now and the call waits for it (up to 120 s).

Output: data directory, source base URL, `lastCheckedAt`, `nextCheckAt`, `lastCheckError`,
`offline` flag, per file: `id`, `target`, `url`, `bytes`, `entries`, `etag`, `downloadedAt`,
`upstreamCommittedAt`, `status` (`ready` · `downloading` · `missing` · `stale-error`); the
known `cloud-erp-private` versions (built-in list, refreshed best-effort from the GitHub
contents API only when this tool is called); object-type counts per loaded dataset;
`adtDestinations` — the candidates of §6.4 (`id`, `protocol`, `hostSuffix`, `inferredTarget`,
`confidence`, `lastSession`) or `null` when no destinations file is readable; `partner` —
`indexSource` (`github-api` · `built-in`), `indexedAt`, and per namespace `entries` and
`status` (§6.5).

### 7.4 Errors

Tool errors are MCP results with `isError: true` and a JSON body
`{ "code", "message", "retryAfterSeconds"? }`. Codes: `INVALID_INPUT`,
`DATASET_DOWNLOADING` (bootstrap still running after the 30 s wait), `DATASET_UNAVAILABLE`
(no cache and no network — message tells the user to run `dataset_info { refresh: true }`
when online), `UNKNOWN_VERSION`, `TARGET_AMBIGUOUS` (body carries the `candidates` list of
§6.4 so the agent can ask a concrete question), `TARGET_UNRESOLVED` (`auto` requested, no
environment pin, no readable destinations file — the agent must ask for the product). The
server never answers a release question from guesswork and never crashes on bad input or bad
network.

## 8. Cache and freshness lifecycle

**Location:** `--data-dir` argument (the plugin passes `${CLAUDE_PLUGIN_DATA}/released-objects`,
which persists across plugin updates); fallback env `ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR`;
final fallback `~/.abap-kebap/released-objects` (used when the bundle is run outside the
plugin, e.g. from a VS Code Copilot `mcp.json`).

**`manifest.json`:**

```json
{
  "schemaVersion": 1,
  "lastCheckedAt": "2026-09-20T07:12:03+03:00",
  "nextCheckAt": null,
  "lastCheckError": null,
  "files": {
    "cloud-erp/latest": {
      "url": "https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/objectReleaseInfoLatest.json",
      "etag": "\"…\"", "sha256": "…", "bytes": 10875583, "entries": 37030,
      "downloadedAt": "2026-09-20T07:12:05+03:00", "upstreamCommittedAt": "2026-09-02T10:11:12Z",
      "lastError": null
    }
  }
}
```

**Rules:**

| Moment | Behaviour |
|---|---|
| Server start | Answer the MCP `initialize` handshake immediately; run `ensureFresh()` in the background. No manifest → bootstrap: download the four core files (~28 MB), then the partner index and partner files (~0.4 MB, §6.5); core readiness does not wait for the partner set. |
| First run of the (local) day | `lastCheckedAt` date ≠ today → refresh the partner index (§6.5), then conditional `GET` with `If-None-Match` per cached file, core and partner alike. `304` → touch `lastCheckedAt`. `200` → temp file → validate → atomic rename → reload index → best-effort GitHub commits-API call for the file's commit date (only on change). |
| Every tool call | Same gate, in-memory date compare (free). A call waits only when the dataset it needs is missing (max 30 s); otherwise the check runs in the background and the current data is served. Single-flight within the process. |
| Validation of a download | JSON parses; `formatVersion` present (number or numeric string); the expected array is non-empty; for files with ≥ 100 entries the new count is ≥ 50 % of the old one (truncation guard — small partner files may legitimately shrink). Failure → keep the old file, `status: stale-error`, `lastError` recorded. |
| Network or HTTP error | Keep serving the cache; set `lastCheckError`, `nextCheckAt = now + 1 h`; retry on the next tool call after that. No cache at all → `DATASET_UNAVAILABLE`. |
| `cloud-erp-private` versioned file | Downloaded lazily on first request for that `version`; then part of the daily check set. |
| `schemaVersion` mismatch | Re-bootstrap; old files removed. |
| Concurrency | Several Claude windows may each run the daily check on day one — accepted (duplicate download of identical content). Writes are temp-file + rename, so readers never see a partial file. Rename retried briefly on `EPERM`/`EBUSY`; on persistent failure the old file stays and the error is recorded. |

Loading: only datasets a session actually queries are parsed; indexes are
`Map<string, Record[]>` on upper-cased `objectKey` and `tadirObjName`. Search is a linear
scan (≤ ~43k records, milliseconds).

## 9. Networking

- HTTPS `GET` only; redirects followed; `User-Agent: abap-kebap-released-objects/<version>`.
- The GitHub API is used for two best-effort purposes only: the daily partner-directory
  listing (§6.5) and the commit date of a file that just changed. Both are unauthenticated,
  both degrade gracefully (built-in list / download date) when unavailable.
- Timeouts: 15 s to headers for conditional checks, 120 s total for a download.
- Proxies: Node's `fetch` ignores proxy variables by default, so the server uses undici's
  `EnvHttpProxyAgent` to honour `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`. TLS-inspecting
  proxies need `NODE_EXTRA_CA_CERTS`; the README documents this (SAP's own repository carries
  an SSL-handshake note for the same reason).
- `ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL` overrides the raw GitHub base URL for companies that
  mirror the repository internally — the same mechanism SAP's ATC check offers.

## 10. Agent and skill wiring

The agents declare no `tools:` list, so they inherit the MCP tools automatically. Changes are
instruction only, kept short. Exact phrases in bold are locked by static rules (§12).

| File | Change |
|---|---|
| `.claude/agents/abap-kebap-reviewer.md` | For ABAP Cloud / Clean Core targets: collect every SAP-delivered object the code references, call **`check_objects`** once with the agreed target, and raise one finding per blocker citing state, level, successor and "SAP Cloudification Repository, data as of <dataAsOf>". Keep the caveat that a released object does not make every method or field released. |
| `.claude/agents/abap-kebap-architect.md` | Released-API selection starts with **`search_objects`** (filtered to `released`, by type and application component) before any WebFetch of api.sap.com. |
| `.claude/agents/abap-kebap-developer.md` | **`check_objects`** before using an SAP object in cloud code; successors drive modernization swaps. |
| all three agents | Fallback sentence: **"If the `released-objects` tools are not available"** (plugin not installed, server disabled, Copilot), fall back to the grounding protocol — never block, never guess. |
| `.claude/skills/abap-cloud-development/SKILL.md` | "How to check if an object is released": the tools become option 1. New "Target resolution" procedure = §6.4 steps 1–5, naming **`abap_list_destinations`** as the first source, the product words that map to **`btp-abap-environment`** / `cloud-erp` / **`cloud-erp-private`**, `maxLevel` `B` as the usual Private Edition setting unless the customer's Clean Core policy says otherwise, and the rule to repeat the `assumption` sentence when confidence is medium. Partner add-on objects (`/NAMESPACE/`) need no extra step — `check_objects` consults the partner classification automatically (§6.5). |
| `.claude/skills/abap-code-review/SKILL.md` | Checklist row "ABAP Cloud compatibility" points to `check_objects`. |
| `.claude/skills/abap-modernization-playbook/SKILL.md` | §7 step 2 "Categorize" uses `check_objects` successors. |

## 11. Documentation changes

- `README.md` — new section "Bundled MCP server — released-objects": what it answers, the
  three tools, data source and licensing note (data files Apache-2.0; using the SAP APIs they
  describe still requires a valid SAP license — SAP's REUSE note), cache location and size
  (~30–40 MB), proxy variables, disabling via `/mcp`, and a `.vscode/mcp.json` snippet for
  Copilot users (`node <clone>/mcp/released-objects/dist/index.js` — the committed bundle runs from a
  clone with no build).
- `docs/grounding-protocol.md` — remove the stale "five agents … fixed tools list (no MCP)"
  statement; add the bundled server as the preferred source for release state in the topic
  map row "Released APIs / ABAP Cloud allowed-or-not", ahead of api.sap.com.
- `CLAUDE.md` — done-gate row lists the new gates (§12).
- `.claude-plugin/plugin.json` — `mcpServers` block, version 0.3.0, description mentions the
  server.

## 12. Gates and CI

All free and deterministic; added to `.github/workflows/validate.yml`:

1. **Unit tests** — `cd mcp/released-objects && npm ci && npm test` (Node's built-in test runner;
   `fetch` and the clock are injected; no network).
2. **Bundle in sync** — `npm run build && git diff --exit-code -- mcp/released-objects/dist` (same
   pattern as the skill-index gate; `package-lock.json` pins versions so the bundle is
   reproducible).
3. **No root `.mcp.json`** — `test ! -f .mcp.json`.
4. Existing `claude plugin validate .` now also validates the `mcpServers` block.
5. **Static rules** in `evals/static-checks.json` (plain substrings, existing runner):

| id | kind | pattern | in |
|---|---|---|---|
| `plugin-declares-released-objects-server` | required | `"released-objects"` | `.claude-plugin/plugin.json` |
| `reviewer-agent-runs-check-objects` | required | `check_objects` | `.claude/agents/abap-kebap-reviewer.md` |
| `developer-agent-runs-check-objects` | required | `check_objects` | `.claude/agents/abap-kebap-developer.md` |
| `architect-agent-uses-search-objects` | required | `search_objects` | `.claude/agents/abap-kebap-architect.md` |
| `reviewer-agent-has-released-objects-fallback` | required | `If the \`released-objects\` tools are not available` | `.claude/agents/abap-kebap-reviewer.md` |
| `developer-agent-has-released-objects-fallback` | required | same | `.claude/agents/abap-kebap-developer.md` |
| `architect-agent-has-released-objects-fallback` | required | same | `.claude/agents/abap-kebap-architect.md` |
| `cloud-skill-has-target-decision-table` | required | `cloud-erp-private` | `.claude/skills/abap-cloud-development/SKILL.md` |
| `cloud-skill-resolves-target-via-adt-mcp` | required | `abap_list_destinations` | `.claude/skills/abap-cloud-development/SKILL.md` |
| `grounding-protocol-no-stale-no-mcp-claim` | forbidden | `fixed tools list (no MCP)` | `docs/grounding-protocol.md` |

6. **Behavioural eval** (milestone only, needs the live server, not in CI): the reviewer,
   given `SELECT * FROM mara` for a `btp-abap-environment` target, must produce a Critical
   finding that cites `check_objects` output and names the successor.

## 13. Testing

Unit tests, all offline:

- Cache: fresh bootstrap; `304` touches only `lastCheckedAt`; `200` with changed content
  swaps atomically and reloads; corrupt or truncated payload keeps the old file and records
  the error; network error → backoff of one hour and cache still served; midnight rollover
  inside a session triggers exactly one check; `schemaVersion` mismatch re-bootstraps;
  `refresh: true` bypasses the gate.
- Query: level-derivation matrix (3 targets × every state × found/absent); `maxLevel`
  cumulativeness; ambiguous multi-type names; successor normalisation (object and concept);
  search ranking order and pagination.
- Schemas: `version` regex and target coupling; `maxLevel` rejected for public/BTP; batch and
  length bounds; `type` filter.
- Target resolver: every heuristic row of §6.4 with fixture hosts; `rfc` → private; software
  components dominate a URL; environment pin wins; session hint picks the newest folder and is
  capped at medium; one destination resolves, two produce `TARGET_AMBIGUOUS` with candidates;
  missing or malformed destinations file → `TARGET_UNRESOLVED`; credential-like fields never
  appear in any output or log line (assert on serialized results).
- Not-found suggestions: typo (distance ≤ 2), namespace variant, wrong type, no near match →
  empty list with hint; suggestion cap of five.
- Partner namespaces: index from a fixture API response; API 403/timeout → built-in list;
  template file skipped; string `formatVersion` accepted; `/AIF/` resolves from SAP data
  before any partner file; `/OTX/` object → `origin: partner:/OTX/` with labels, Level B on
  private, blocked with classification shown on public/BTP; unknown namespace → vendor hint;
  `scope`, `partnerNamespace` and `label` filters; partner download failure leaves core
  datasets `ready`.

Manual smoke test at milestones (real network): first start downloads four files;
`dataset_info` shows dates and counts; `check_objects` for `MARA`, `I_PRODUCT`,
`CL_ABAP_UNIT_ASSERT` on all three targets gives the expected verdicts; second start the same
day makes no request; next day makes four conditional requests and no download when
unchanged.

## 14. Security and licensing

- Outbound traffic only to the configured base URL (default GitHub) and, on change, the
  GitHub commits API. No credentials, no telemetry.
- The ADT destinations file is opened read-only; only `id`, `protocol`, the host part of
  `systemUrl` and `systemId` are parsed. Credential-like fields are never read into memory as
  named values, never returned and never logged; hosts are reduced to their last three labels
  in candidate lists.
- `version` is validated by regex before it becomes part of a URL or file name; object names
  are bounded; the data is never executed or fed raw to the model — tools return only
  selected fields.
- Downloaded JSON is validated before it replaces the previous file.
- Server code: MIT (repository license). Data: Apache-2.0 from SAP, with SAP's REUSE caveat
  that the licence covers the lists, not the use of the SAP APIs they describe.

## 15. Verification spikes (first plan task, before building)

| Fact relied upon | How to confirm | Fallback if false |
|---|---|---|
| Inline `mcpServers` in `plugin.json` auto-starts on install; `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` expand inside `args` | Stub server + `claude --plugin-dir <repo>`; observe `/mcp` | Move the block to a `.mcp.json` at the plugin root (still exactly one declaration); pass the data dir via `env` instead of `args`; if `CLAUDE_PLUGIN_DATA` is unavailable use the home-directory fallback |
| `raw.githubusercontent.com` returns an `ETag` and honours `If-None-Match` with `304` | One `curl -I` and one conditional request | Full download once a day and SHA-256 comparison before replacing (already part of the design) |
| Node ≥ 20 is present wherever Claude Code runs | Startup check, documented | Clear stderr message naming the requirement |
| ADT MCP `abap_list_destinations` takes no input and returns only destination ids (read from the extension 1.1.2 bundle; not yet observed live) | Call it with the ADT MCP connected; record the exact result shape in the skill | If it returns URLs or product data as well, feed them into `system` for higher confidence; if the name differs, update the skill text and the static rule |
| `~/.adtls/session-<destinationId>-<hash>/` is created per logged-on destination and survives disconnect | Log on to a destination in VS Code and watch the folder | Drop the session hint (step 2 of the `auto` order); the other sources stand |
| `S4CORE` release → S/4HANA year mapping (107 → 2022, 108 → 2023, 109 → 2025) | SAP product availability matrix / the versions present in the SAP repository | Resolve `version` to `latest` and let the user pin it |

## 16. Implementation notes

Repository layout:

```
mcp/released-objects/
  package.json            private; engines.node >= 20; scripts: build, test, typecheck
  package-lock.json
  tsconfig.json
  src/index.ts            entry: stdio transport, tool registration, startup freshness kick-off
  src/config.ts           --data-dir / env / defaults
  src/http.ts             fetch with proxy agent and timeouts (injectable)
  src/cache.ts            manifest, ensureFresh, download → validate → atomic swap
  src/datasets.ts         target/version → file mapping, loading, indexes
  src/query.ts            lookup, level derivation, search ranking (pure)
  src/schemas.ts          Zod schemas with teaching descriptions
  src/target-resolver.ts  §6.4: destinations file reader, heuristics, auto-resolution order
  src/partner-index.ts    §6.5: contents-API listing, built-in fallback list, namespace → file
  src/partner-index.json  built-in partner file list (regenerated by `npm run update-partner-index`)
  src/tools/check-objects.ts | search-objects.ts | dataset-info.ts
  test/*.test.ts
  dist/index.js           committed esbuild bundle
```

Runtime dependencies (bundled): `@modelcontextprotocol/sdk`, `zod`, `undici`. Dev
dependencies: `typescript`, `esbuild`, `@types/node`. `.gitignore` gains
`mcp/released-objects/node_modules/` and the compiled test output; `dist/` is committed.

Process: the development loop in `CLAUDE.md` applies — plan first, TDD per task, independent
review, gates before "done". Model assignment for this feature: the main session (Claude Fable
5.1) owns the loop, dispatch and reviews; substantive implementation tasks (cache manager,
query engine, tools, their tests) go to Opus 5 subagents; basic edits (agent prose, skill
pointers, static rules, `plugin.json`, CI YAML, README) go to Sonnet 5 subagents. Commits and
pushes only with the repository owner's explicit approval.

## 17. Success criteria

1. In a fresh session after `/plugin install`, `/mcp` lists `released-objects` as connected
   with no extra step; the four core files exist in the data directory within a minute.
2. Asking the reviewer to review `SELECT * FROM mara` for a BTP target yields a Critical
   finding grounded in one `check_objects` call, with `dataAsOf` cited.
3. A second start the same day performs no HTTP request; the next day performs four
   conditional requests and downloads nothing when upstream is unchanged.
4. With the network off, all three tools still answer from the cache and `dataset_info`
   reports `offline: true`.
5. All CI gates in §12 pass; `node evals/run-static.mjs` is green with the new rules.
6. With VS Code logged on to one destination and no product named in the prompt, the reviewer
   resolves the target through `abap_list_destinations` → `system.destinationId` and states
   the resolution in its answer; with two destinations logged on it asks which one, listing
   the ids; with no ADT MCP and several destinations in the file it asks using the
   `TARGET_AMBIGUOUS` candidates.
7. `check_objects` on a partner object (for example a `/OTX/` class) for `cloud-erp-private`
   returns `origin: partner:/OTX/`, its classification, level and labels; `dataset_info` lists
   the partner namespaces with their entry counts and index source.

## 18. Deferred (v2 candidates, decided against for v1)

- `suggestAlternatives` on `check_objects` (released objects of similar type in the same
  application component when no successor exists) — low precision without evidence of need.
- SAP abbreviation expansion in `search_objects` (`PURCHASEORDER` ↔ `PURCHORD`).
- Transitive successor resolution (`resolveChain`).
- Live ATC / ADT integration (a different capability, tracked in `docs/agent-orchestration.md`).
