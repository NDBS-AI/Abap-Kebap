# Operations

Running the server on a real machine: what it puts on disk, what it asks of the network,
and what to do when either goes wrong.

- [The data directory](#the-data-directory)
- [What the server downloads, and when](#what-the-server-downloads-and-when)
- [Network requirements](#network-requirements)
- [Corporate proxies](#corporate-proxies)
- [Internal mirrors](#internal-mirrors)
- [Air-gapped and offline use](#air-gapped-and-offline-use)
- [Pinning the target](#pinning-the-target)
- [Partner namespaces](#partner-namespaces)
- [Diagnosing a problem](#diagnosing-a-problem)
- [Repairing the cache](#repairing-the-cache)
- [Privacy](#privacy)
- [Upgrading](#upgrading)

## The data directory

Resolution order, first usable wins:

1. `--data-dir <absolute path>`
2. `ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR`
3. `~/.abap-kebap/released-objects`

"Usable" means non-empty, absolute, and free of `${…}` — an unexpanded host placeholder must
never become a literal directory name. A rejected value falls back to the default and is
reported both on stderr at startup and in `dataset_info.warnings`.

Installed as part of the plugin, the directory is the plugin's own data directory, which
survives plugin updates. That matters: the cache is roughly 26 MB, and putting it under the
plugin's code directory would mean re-downloading everything after every update.

Contents:

```
<data dir>/
├── manifest.json                          provenance and policy state
├── objectReleaseInfoLatest.json           cloud-erp
├── objectReleaseInfo_PCELatest.json       cloud-erp-private
├── objectReleaseInfo_BTPLatest.json       btp-abap-environment
├── objectClassifications_SAP.json         private-edition Clean Core levels
├── objectReleaseInfo_PCE2023_0.json       only if a pinned release asked for it
└── partner/
    └── objectClassifications_<NS>.json    only if a /NS/ object was looked up
```

### `manifest.json`

The bookkeeping the policy runs on. Safe to delete — the next call rebuilds it by
re-downloading — but do not hand-edit it: every field is re-validated on read precisely
because it sits in a user-writable place, and a nonsense value is dropped rather than trusted.

```jsonc
{
  "schemaVersion": 1,
  "lastCheckedAt": "2026-09-22T06:12:41.884Z",  // last successful check
  "nextCheckAt": null,                          // set only while the 1-hour backoff is armed
  "lastCheckError": null,                       // last failure, if any
  "partnerIndex": { "indexSource": "github-api", "indexedAt": "…", "files": [ … ] },
  "files": {
    "cloud-erp/latest": {
      "url": "…/objectReleaseInfoLatest.json",
      "etag": "\"a1b2…\"",                      // drives the conditional request
      "sha256": "…", "bytes": 11000000, "entries": 43000,
      "downloadedAt": "…", "upstreamCommittedAt": "…",
      "lastError": null                         // non-null ⇒ status stale-error
    }
  }
}
```

A `schemaVersion` bump, or a file that does not parse, throws the whole manifest away and
bootstraps from scratch. That is the intended upgrade path, not a failure.

## What the server downloads, and when

| Moment | What happens |
|---|---|
| Server start | Opens the daily gate for the four core files, in the background. The client is never made to wait. |
| First ever call | Downloads what the resolved target needs, up to 30 seconds, then answers `DATASET_DOWNLOADING`. |
| Every call | Opens the daily gate for the files that call touched, plus every partner file on disk. Never blocks. |
| First call of a new **local** day | One conditional request per file. `304` for anything unchanged — no payload. |
| After a failed check | Nothing for one hour. |
| `dataset_info { refresh: true }` | Checks now, ignoring both gate and backoff. |

First run costs roughly 26 MB across four files. A normal day costs four conditional requests
and no payload at all.

## Network requirements

| Host | Purpose | Required? |
|---|---|---|
| `raw.githubusercontent.com` | The data files themselves | Yes, unless a mirror is configured |
| `api.github.com` | Upstream commit dates and the partner-file listing | No — both degrade silently |

The GitHub API is best-effort in both uses. Rate-limited or blocked, `upstreamCommittedAt`
stays `null` and the committed partner list is used. Neither affects a verdict.

Pointing `ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL` at a mirror switches the API calls **off**
entirely, because they only mean something against SAP's own repository.

## Corporate proxies

Node's global `fetch` ignores `HTTPS_PROXY`, which is why this server uses undici's
`EnvHttpProxyAgent` instead. Set the standard variables and they are honoured:

```bash
export HTTPS_PROXY=http://proxy.example.com:8080
export HTTP_PROXY=http://proxy.example.com:8080
export NO_PROXY=localhost,127.0.0.1,.internal.example.com
```

If the proxy inspects TLS, Node needs its root certificate — otherwise every download fails
with `unable to verify the first certificate`:

```bash
export NODE_EXTRA_CA_CERTS=/path/to/corporate-root.pem
```

Set these where the MCP client itself is launched. A server started by Claude Code inherits
that process's environment, not your interactive shell's.

Note that `EnvHttpProxyAgent` has **no implicit loopback bypass**: with `HTTPS_PROXY` set and
no `NO_PROXY`, even `127.0.0.1` goes through the proxy. It matters for tests against a local
server; it does not matter in production, where the only hosts are remote.

## Internal mirrors

Organisations that do not allow direct GitHub access can mirror the repository's `src/`
directory on an internal host:

```bash
export ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL=https://mirror.example.com/abap-atc-cr-cv-s4hc/src
```

The URL must point at the directory that **directly contains** the release-info files, with
`partner/` beneath it. Requirements for the mirror:

- Serve the files unchanged, including the `formatVersion` field — the validation guard
  rejects anything else.
- Return `ETag` and honour `If-None-Match` if you want the daily check to stay cheap. Without
  it, every day re-downloads the full 26 MB; it still works.
- Keep it current. `upstreamCommittedAt` is `null` behind a mirror, so nothing will tell a
  user the mirror has gone stale.

A non-`http(s)` value is ignored with a warning and the default source is used.

## Air-gapped and offline use

Once the four core files are on disk the server answers with no network at all. The daily
check fails, sets the backoff, and nothing else changes — cached data keeps serving however
old it is, and `dataset_info` reports `offline: true` with a hint that distinguishes "serving
from cache" from "nothing cached".

To seed a machine that will never have access, copy a populated data directory from a machine
that does — the files and `manifest.json` together — and point
`ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR` at it. Copy the manifest too: without it the files are
on disk but unknown, and the first lookup will try to download them.

## Pinning the target

Detection is convenient; a pin is deterministic. Pin when the machine only ever targets one
system, when several ADT destinations make detection ambiguous, or in CI:

```bash
export ABAP_KEBAP_RELEASED_OBJECTS_TARGET=cloud-erp-private
export ABAP_KEBAP_RELEASED_OBJECTS_VERSION=2023          # private edition only
```

A pin resolves with confidence `high` and `resolvedFrom: "environment"`, and the ADT
configuration is not read at all. An unrecognised value is ignored with a warning rather than
silently substituted.

`ABAP_KEBAP_RELEASED_OBJECTS_VERSION` applies only to `cloud-erp-private`. Set it on a machine
that targets public cloud and it is simply not used — deliberately, so a pin cannot turn every
call into an argument error.

## Partner namespaces

SAP's repository carries classification files published by partners, one per namespace, under
`src/partner/`. They are **optional data** and handled accordingly:

- Fetched lazily — only when an object in that namespace is actually looked up.
- Never able to fail a lookup: a 404, a rate limit or a proxy block leaves the lookup to
  answer from SAP's own data.
- Never able to set the global check error or delay core readiness.
- Re-checked only by `dataset_info`, which ages every cached partner file forward. Nothing
  else revisits them, because nothing else remembers them.

The list of namespaces comes from the GitHub contents API when it is reachable, and otherwise
from `src/partner-index.json`, which is committed. Refresh that fallback with:

```bash
npm run update-partner-index
```

An object in a namespace with no published file comes back `not-found` with a hint naming the
vendor. That is the honest answer: the server knows the namespace exists and that nobody has
classified it.

## Diagnosing a problem

Start here, always:

```json
{ "name": "dataset_info", "arguments": { "refresh": true } }
```

Read it in this order:

1. **`targetProblem`** — resolution failed. Nothing else in the report matters until the
   target is pinned or passed.
2. **`target` / `resolvedFrom` / `confidence`** — a `low` confidence and a surprising target
   explains most "wrong verdict" reports.
3. **`offline`** — `true` means the transport failed. A network problem, not a data problem.
4. **`lastCheckError`** — the exact failure the last check hit.
5. **`files[].status`** — `ready`, `downloading`, `missing`, or `stale-error` with the reason
   in `error`.
6. **`warnings`** — configuration that was rejected at startup.
7. **`source.isDefaultSource` / `partnerIndex.indexSource`** — confirms whether a mirror or
   the built-in fallback list is in play.

For anything the report does not explain, restart the server with `--verbose`; cache
decisions go to stderr, prefixed `[released-objects]`.

## Repairing the cache

| Situation | Fix |
|---|---|
| A file is `stale-error` | `dataset_info { refresh: true }`. A validation failure keeps the old file serving; the next good download replaces it. |
| A file is on disk but holds no records | Handled automatically: the file and its ETag are evicted, and the error tells you to refresh. The eviction is what matters — with the ETag still stored, every check would earn a `304` and the corrupt copy would survive forever. |
| The manifest looks wrong | Delete `manifest.json`. The next call re-downloads and rebuilds it. |
| Everything looks wrong | Delete the whole data directory. Nothing in it is unique; it is a cache. |
| `could not replace <file>: the file stayed locked` | A scanner or backup agent is holding the file open on Windows. The rename is already retried five times; exclude the data directory from on-access scanning. |

Deleting the cache costs one 26 MB download. There is no state worth preserving.

## Privacy

What leaves the machine: HTTPS GETs for public SAP files, from `raw.githubusercontent.com` or
your mirror, plus optional `api.github.com` calls for commit dates and the partner listing.
Requests carry only a `user-agent` of `abap-kebap-released-objects/<version>` and, on a check,
an `If-None-Match` header.

What never leaves the machine: the object names you look up, your source code, your system
identity, your credentials. Every lookup is answered from local files.

What is read from the ADT configuration: `~/.adtls/destinations.json`, **read-only**, and only
the destination `id`, `protocol`, the **host** of `systemUrl` (of `applicationServer` for an RFC
destination) and `systemId`. Credential
fields are never bound to a named value, never returned and never logged; a static check
enforces that their names do not appear in the source at all. Any `user:password@` prefix is
stripped before the host is read, and every host that can reach a response or a log line is
trimmed to its last three labels.

Set `ABAP_KEBAP_ADT_STATE_DIR` and `ABAP_KEBAP_ADT_DESTINATIONS_PATH` to move or redirect
that read; pin the target and the file is not opened at all.

## Upgrading

The server ships with the plugin, so updating the plugin updates the server. The data
directory is outside the plugin's code directory and survives; the manifest's `schemaVersion`
handles a format change by discarding the cache and bootstrapping.

Two things to check after an upgrade that changes behaviour:

- `dataset_info` reports `server.version` — confirm the new one is running.
- If the plugin's declared data directory changed, the old cache is orphaned and can be
  deleted by hand.
