# Tool reference

The server exposes three tools over stdio. Every response is a single text block containing
JSON; errors carry the MCP `isError` flag and a JSON `error` object, so a calling model reads
the failure the same way it reads a result.

The example payloads below are **abridged and illustrative** — field shapes are exact, values
are not. Run the tool for the real answer; that is the entire point of the server.

- [Shared concepts](#shared-concepts)
- [`check_objects`](#check_objects)
- [`search_objects`](#search_objects)
- [`dataset_info`](#dataset_info)
- [Errors](#errors)

## Shared concepts

### Targets

| Value | Product | Has releases? | Has Clean Core levels? |
|---|---|---|---|
| `cloud-erp` | S/4HANA Cloud Public Edition | no | no — released or not |
| `cloud-erp-private` | S/4HANA Cloud Private Edition, on-premise | yes (`2023`, `2021_1`, …) | yes, A–D |
| `btp-abap-environment` | SAP BTP ABAP environment | no | no — released or not |
| `auto` *(default)* | resolved from the connected ADT system | — | — |

`version` and `maxLevel` are meaningful **only** on `cloud-erp-private`. Passing either
alongside an explicit different target is rejected by the schema; passing it with
`target: "auto"` is accepted and then rejected after resolution, because only resolution can
know what the system turned out to be. Both rejections are `INVALID_ARGUMENT`.

### Clean Core levels

Levels are cumulative — accepting `C` accepts `A` and `B` too.

| Level | Meaning | Derived when |
|---|---|---|
| `A` | Released API | the object's state is `released` or `deprecated` |
| `B` | Classic API, not released | private edition, classified `classicAPI` |
| `C` | Unclassified | private edition, no release entry and no classification |
| `D` | Marked as no API | private edition, classified `noAPI` |
| `none` | No level applies — blocked | public cloud or BTP, and not released |

Note that `deprecated` still derives level `A`. A deprecated object *is* a released API; it
is one you should stop using. The verdict, not the level, is what carries that nuance.

### Levels when an object is absent

Absence is not release. Every answer reports what absence implies on the resolved target:
`none` on public cloud and BTP, `C` on private edition. The field is
`impliedLevelWhenAbsent` on the response and `impliedLevel` on an individual not-found
result.

### Resolution provenance

Every response echoes how the target was decided:

| Field | Values |
|---|---|
| `target` | the resolved target |
| `version` | the resolved release; `latest` unless private edition with a version |
| `resolvedFrom` | `request`, `environment`, `adt-session`, `single-destination` |
| `confidence` | `high`, `medium`, `low` |
| `assumption` | present only when the target was assumed; a sentence to quote to the user |

### The `dataset` block

`check_objects` and `search_objects` both report which files answered the call:

```json
"dataset": {
  "status": "fresh",
  "files": [
    {
      "id": "cloud-erp/latest",
      "fileName": "objectReleaseInfoLatest.json",
      "status": "ready",
      "entries": 43000,
      "bytes": 11000000,
      "downloadedAt": "2026-09-22T06:12:44.101Z",
      "upstreamCommittedAt": "2026-09-15T09:31:07Z",
      "error": null
    }
  ]
}
```

`status` is `fresh` when no file carries an error and the last check succeeded, otherwise
`stale`. A file's own `status` is `ready`, `downloading`, `missing` or `stale-error`.
`upstreamCommittedAt` is best-effort provenance from the GitHub API; it is `null` behind a
mirror or a rate limit and never affects correctness.

## `check_objects`

**Is this object usable on this system?** Call it before writing or reviewing ABAP that
touches SAP tables, CDS entities, classes or function modules.

### Parameters

| Name | Type | Default | Notes |
|---|---|---|---|
| `objects` | array, 1–100 | required | Each entry is a name (`"MARA"`) or `{ "name": …, "type": … }`. Names up to 120 characters; types up to 8 (`TABL`, `DDLS`, `CLAS`, `INTF`, `FUNC`, `FUGR`, `DTEL`). |
| `target` | enum | `auto` | See [Targets](#targets). |
| `version` | string | — | `latest`, `YYYY` or `YYYY_N`. Private edition only. |
| `maxLevel` | `A`–`D` | `A` | Strictest level still acceptable. Private edition only. |

Send every object from one piece of code in a **single** call. One call with 60 names costs
one round trip; 60 calls cost 60.

The default `maxLevel` is `A` on every target, private edition included: the strict answer is
the safe default, and a caller who can live with a classic or unclassified API says so
explicitly.

A name is matched case-insensitively against the object key and, where it differs, the TADIR
name — which is how a function module is found through its function group. Passing `type`
narrows the match to that object type or TADIR type.

### Verdicts

| Verdict | Meaning |
|---|---|
| `allowed` | Every match is within `maxLevel` and none is deprecated. |
| `allowed-deprecated` | Within `maxLevel`, but at least one match is deprecated — use the successor. |
| `blocked` | At least one match exceeds `maxLevel`, or has no level at all. |
| `not-found` | Not in SAP's data for this target. Carries `impliedLevel`, `allowed` and up to five `suggestions`. |
| `ambiguous` | Several objects share the name, no `type` was given, and they do not agree. Re-ask with a `type`. |

### Suggestions

A not-found result carries up to five near matches, ranked by why they matched:

| `reason` | Matched because |
|---|---|
| `exact-other-type` | The same name exists under a different object type |
| `namespace-variant` | Identical once slashes and underscores are removed |
| `edit-distance` | Within two characters of the requested name |
| `prefix` | Starts with the name (needs at least 4 characters) |
| `substring` | Contains the name (needs at least 6 characters) |

### Example

Request:

```json
{
  "objects": ["MARA", { "name": "I_Product", "type": "DDLS" }, "ZCL_MY_CLASS"],
  "target": "cloud-erp"
}
```

Response:

```json
{
  "target": "cloud-erp",
  "version": "latest",
  "resolvedFrom": "request",
  "confidence": "high",
  "maxLevel": "A",
  "impliedLevelWhenAbsent": "none",
  "dataset": { "status": "fresh", "files": [ … ] },
  "summary": { "total": 3, "allowed": 1, "blocked": 1, "deprecated": 0, "notFound": 1, "ambiguous": 0 },
  "results": [
    {
      "name": "MARA",
      "verdict": "blocked",
      "found": true,
      "matches": [
        {
          "objectType": "TABL",
          "objectKey": "MARA",
          "tadirObject": "TABL",
          "tadirObjName": "MARA",
          "softwareComponent": "SAP_APPL",
          "applicationComponent": "LO-MD-MM",
          "releaseState": "notToBeReleased",
          "classification": null,
          "origin": "sap",
          "cleanCoreLevel": "none",
          "allowed": false,
          "deprecated": false,
          "successors": [{ "kind": "object", "objectType": "DDLS", "objectKey": "I_Product" }],
          "successorClassification": null,
          "labels": []
        }
      ]
    },
    {
      "name": "I_Product",
      "verdict": "allowed",
      "found": true,
      "matches": [ { "objectType": "DDLS", "cleanCoreLevel": "A", "allowed": true, … } ]
    },
    {
      "name": "ZCL_MY_CLASS",
      "verdict": "not-found",
      "found": false,
      "matches": [],
      "impliedLevel": "none",
      "allowed": false,
      "suggestions": [],
      "hint": "Not in the SAP data for this target. …"
    }
  ]
}
```

### Reading the result

- **`not-found` on a `Z`/`Y` object is expected.** Custom objects are never in SAP's lists.
  It is not a statement about that object.
- **`not-found` on an SAP name means check the type first** — a CDS entity is `DDLS`, not the
  SQL view behind it; a function module is `FUNC`, its group `FUGR`.
- **`not-found` on a `/NS/` name** usually means the vendor published no classification file,
  and the hint says so. Ask the vendor; do not read it as "unclassified".
- **`ambiguous` is answerable** — re-ask with the object type.
- **A `successors` entry is SAP's own recommendation**, either a concrete object
  (`{"kind":"object"}`) or a concept name (`{"kind":"concept"}`) when the replacement is a
  pattern rather than a single artefact.

## `search_objects`

**What should I use instead?** Searches the same data by name fragment, type, application
component, state or label.

### Parameters

| Name | Type | Default | Notes |
|---|---|---|---|
| `query` | string, 1–120 | required | Name or fragment. Several words must **all** appear, so `purchase order` finds `I_PurchaseOrderItem`. |
| `objectType` | string, ≤8 | — | `DDLS`, `CLAS`, `TABL`, … Matched against object type or TADIR type. |
| `applicationComponent` | string, ≤40 | — | Prefix match on SAP's component path, e.g. `MM-PUR`. |
| `state` | enum | — | `released`, `deprecated`, `notToBeReleased`, `classicAPI`, `noAPI` — exactly as SAP records it. |
| `label` | string, ≤40 | — | An SAP label, e.g. `remote-enabled`. Exact, case-insensitive. |
| `maxLevel` | `A`–`D` | — | Private edition only. **Filters** the results when given. |
| `limit` | 1–200 | `20` | How many to return. |
| `offset` | ≥0 | `0` | How many to skip. |
| `target`, `version` | | | As for `check_objects`. |

### Ranking

Matches are ranked exact, then prefix, then substring, then all-tokens-present, and ties are
broken alphabetically by object key. `total` always reports the full match count, so you can
page with `offset` without re-running a broader query.

### `maxLevel` here is a filter, not a verdict

Pass it and results above that level are removed. Omit it and nothing is filtered — each
hit's `allowed` is then computed against level `D`, which only distinguishes objects that
have a level at all from those that have none. **A search hit is not a usage verdict.** Run
`check_objects` on anything you intend to use.

### Example

Request:

```json
{ "query": "purchase order", "objectType": "DDLS", "applicationComponent": "MM-PUR", "limit": 5 }
```

Response:

```json
{
  "target": "cloud-erp",
  "version": "latest",
  "resolvedFrom": "adt-session",
  "confidence": "medium",
  "query": "purchase order",
  "total": 37,
  "returned": 5,
  "offset": 0,
  "limit": 5,
  "dataset": { "status": "fresh", "files": [ … ] },
  "results": [
    {
      "objectType": "DDLS",
      "objectKey": "I_PurchaseOrderAPI01",
      "tadirObject": "DDLS",
      "tadirObjName": "I_PURCHASEORDERAPI01",
      "softwareComponent": "SAP_APPL",
      "applicationComponent": "MM-PUR-PO",
      "releaseState": "released",
      "classification": null,
      "origin": "sap",
      "cleanCoreLevel": "A",
      "allowed": true,
      "deprecated": false,
      "successors": [],
      "successorClassification": null,
      "labels": []
    }
  ]
}
```

An empty result set comes back with `total: 0` and a `hint` suggesting a shorter fragment,
the business term rather than a table name, or a search by application component.

## `dataset_info`

**Where did this answer come from, and how old is it?** Call it when an answer looks stale or
wrong, or when another tool reports the data as unavailable.

### Parameters

| Name | Type | Default | Notes |
|---|---|---|---|
| `target`, `version` | | `auto` | Narrows the report — and the refresh — to the files that target needs. |
| `refresh` | boolean | `false` | Check SAP now instead of waiting for the once-a-day gate. Use it when the data looks stale, not routinely. |

### What `refresh` actually checks

Only the files this request is about, plus every partner file already on disk. Checking every
target's files would report another target's failure as this request's `lastCheckError` and
hide the one you ran the tool to see. With no resolvable target it falls back to all four core
files.

Partner files are downloaded lazily by a lookup and never re-checked on their own, so this is
the one tool that ages them forward.

### Response

```json
{
  "server": { "name": "released-objects", "version": "0.3.0" },
  "source": {
    "repo": "https://github.com/SAP/abap-atc-cr-cv-s4hc",
    "baseUrl": "https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src",
    "isDefaultSource": true,
    "usesGithubApi": true,
    "partnerIndexSource": "github-api"
  },
  "target": "cloud-erp-private",
  "version": "2023",
  "resolvedFrom": "single-destination",
  "confidence": "high",
  "assumption": "Assumed the only configured ADT destination, …",
  "dataDir": "<plugin data>/released-objects",
  "offline": false,
  "lastCheckedAt": "2026-09-22T06:12:41.884Z",
  "nextCheckAt": null,
  "lastCheckError": null,
  "partnerIndex": { "indexSource": "github-api", "namespaces": 29, "cachedFiles": 1 },
  "files": [ { "id": "classification/sap", "status": "ready", … } ],
  "warnings": []
}
```

| Field | Meaning |
|---|---|
| `source.isDefaultSource` | `false` when a mirror is configured — which also turns the GitHub API off |
| `offline` | The transport failed. A validation failure is *not* offline; it marks the file `stale-error` instead |
| `nextCheckAt` | Set only while the one-hour failure backoff is armed |
| `lastCheckError` | The last check's failure, if any — never set by an optional partner file |
| `targetProblem` | Present instead of a resolved target when resolution failed; carries the same code, message and candidates an error would |
| `warnings` | Configuration complaints, e.g. a data directory that was not absolute |
| `hint` | Present only when offline — different text for "nothing cached" than for "serving from cache" |

`dataset_info` answers even when the target cannot be resolved, because that is precisely the
state you need it to describe.

## Errors

```json
{
  "error": {
    "code": "TARGET_AMBIGUOUS",
    "message": "Several ADT destinations are configured and none is clearly current. Ask which system this code targets, then pass `target` explicitly.",
    "candidates": [
      { "id": "DEV", "systemId": "D01", "host": "abc.s4hana.cloud.sap", "target": "cloud-erp" },
      { "id": "QAS", "systemId": "Q01", "host": "example.company.com", "target": "cloud-erp-private" }
    ]
  }
}
```

Candidate hosts are reduced to their last three labels. Codes and what to do about them are
tabulated in the [README](../README.md#errors).

Two error codes are worth distinguishing when you see them in a log:

- **`DATASET_UNAVAILABLE`** means there is nothing to answer from *and* the source cannot be
  reached. A cached copy always answers, however old.
- **`DATASET_DOWNLOADING`** means the first download is in flight. It carries
  `retryAfterSeconds`; the tool is not failing, it is not ready yet.
