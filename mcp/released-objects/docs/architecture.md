# Architecture

How the server is put together, and why each piece is shaped the way it is. Read
[tools.md](tools.md) first if you only want to call it; this document is for changing it.

- [Module map](#module-map)
- [Request flow](#request-flow)
- [Data model](#data-model)
- [Caching](#caching)
- [Lookup and search](#lookup-and-search)
- [Target resolution](#target-resolution)
- [Validation](#validation)
- [Error taxonomy](#error-taxonomy)
- [Concurrency](#concurrency)
- [Delivery](#delivery)
- [Testing](#testing)

## Module map

Dependencies point downward; nothing below imports anything above it.

```
index.ts ......... entry point: Node check, context, tool registration, argument guard
  └ tools/ ....... one handler per tool + shared context (loadTarget, result helpers)
      ├ query.ts ......... pure: level derivation, lookup, search, near matches
      ├ datasets.ts ...... which files a target needs; parse and index records
      ├ target-resolver.ts  ADT destinations → target, with redaction
      ├ partner-index.ts .. partner namespaces → their classification files
      └ cache.ts ......... download, validate, atomic write, manifest, daily gate
          └ http.ts ...... proxy-aware HTTPS GET with ETag support
  └ config.ts ...... environment and flags → ServerConfig
  └ schemas.ts ..... Zod shapes and full schemas, with the text models read
  └ types.ts ....... Target, CleanCoreLevel, RawRecord, Match
```

Two properties are worth preserving when you extend this:

- **`query.ts` is pure.** No I/O, no clock, no network. Every verdict rule is a function of
  its arguments, which is why the verdict tests are exhaustive and fast.
- **`cache.ts` owns the disk.** Nothing else writes to the data directory, and nothing else
  decides when to talk to the network.

## Request flow

A `check_objects` call, from transport to answer:

```
stdio JSON-RPC
  → SDK validates the raw Zod shape
  → guarded(): parses the FULL schema — cross-field rules run here or nowhere
  → handleCheckObjects
      → loadTarget()
          → resolveTarget()      target + version + confidence, or a refusal
          → resolveFiles()       which files that target needs
          → registry.load*()     from the cache, downloading if the file is missing
          → cache.ensureFresh()  opens the daily gate in the background; never blocks
      → lookupObject() per object, merging release info + classification + partner data
      → suggestNearMatches() for anything not found
  → toolSuccess(): one JSON text block
```

`search_objects` follows the same path with `searchObjects()` in place of the per-object
lookup. `dataset_info` deliberately does **not** use `loadTarget`: it has to answer even when
resolution fails, so it catches the refusal and reports it as `targetProblem`.

## Data model

SAP ships TADIR-granular JSON. One record, trimmed to what matters:

```jsonc
{
  "tadirObject": "TABL", "tadirObjName": "MARA",     // the transport object
  "objectType": "TABL",  "objectKey": "MARA",        // the concrete object
  "softwareComponent": "SAP_APPL",
  "applicationComponent": "LO-MD-MM",
  "state": "notToBeReleased",                        // or released / deprecated / classicAPI / noAPI
  "successors": [ { "objectType": "DDLS", "objectKey": "I_Product" } ],
  "successorConceptName": "…",                       // when the replacement is a pattern
  "labels": [ "…" ]
}
```

`tadirObjName` and `objectKey` differ where one transport object contains several usable
ones — a function module inside its function group — so both are indexed and both are
searched.

**An object's identity is `objectType` + upper-cased `objectKey`, never the key alone.** A
name really is reused across types (a table and the CDS view over it). Deduplicating on the
key would silently drop one of them. This rule is load-bearing in three places: merging a
lookup, building the classification search pool, and deduplicating suggestions.

Files, and which target needs which:

| File | Used by |
|---|---|
| `objectReleaseInfoLatest.json` | `cloud-erp` |
| `objectReleaseInfo_PCELatest.json`, `objectReleaseInfo_PCE<version>.json` | `cloud-erp-private` |
| `objectReleaseInfo_BTPLatest.json` | `btp-abap-environment` |
| `objectClassifications_SAP.json` | `cloud-erp-private` only — levels B/C/D exist nowhere else |
| `partner/objectClassifications_<NS>.json` | lazily, when a `/NS/` name is looked up |

Upstream is not consistent about private-edition file names: 2022 ships as `_PCE2022.json`
while 2023 ships only as `_PCE2023_0.json`. A bare `YYYY` therefore produces **two candidate
specs** tried in order, and the manifest id is keyed on the **file name**, not on the spelling
that asked for it — otherwise one upstream file would occupy two cache entries and be fetched
twice.

## Caching

The policy, in one sentence: *download once, check once per local day with a conditional
request, never block a lookup on the check, and never let a bad answer replace a good file.*

### The daily gate

`shouldCheck()` compares the **local** date of `lastCheckedAt` with today — "the first run of
the day" means the user's day, not UTC's. A forced check skips the gate. A failed check arms
`nextCheckAt` one hour out, so a broken proxy costs one attempt per hour and not one per call.

### Conditional requests

Each manifest entry stores the ETag. The next check sends `If-None-Match`; a `304` means
nothing was downloaded and the cached file keeps serving. A normal day is four conditional
requests and zero bytes of payload.

An ETag is only sent when the file is **actually on disk**. Otherwise a manifest entry left
over from a deleted file would earn a 304 and the server would believe in a file it does not
have.

### The validation guard

Before a download may replace a good file, `validatePayload()` checks four things: it parses
as JSON, it is an object, it carries a `formatVersion`, and the expected array is present and
non-empty. Then the truncation guard: a file that loses more than half its rows is rejected.
The guard is off below 100 previous entries, because small partner files legitimately shrink.

A rejected payload never touches the disk. If a good copy is there, it keeps serving and the
reason is recorded as the file's `lastError` (status `stale-error`). If there is no copy, the
call fails — better than handing back a path to nothing.

### Atomic writes

Temp file, then rename, so a concurrent reader never sees half a dataset. On Windows the
rename can lose to a virus scanner or an open handle, so `EPERM`, `EBUSY` and `EACCES` are
retried five times with a growing delay; any other error cleans up the temp file and
propagates.

Each write picks its own temp name from a process-wide counter rather than the clock, and
manifest writes queue behind one another. Both exist for the same moment: a lazy download and
the daily check saving the manifest at once. Sharing a temp name renames it twice and leaves
the manifest unparseable; writing in parallel lets the slower rename land a snapshot that no
longer holds the other's entry, so the next process re-downloads a file it already has.

### Repairing a corrupt cache

A file that is on disk but holds zero records was truncated or hand-edited. The cache would
never write such a payload, so `DatasetRegistry.load()` treats it as corruption: it **evicts**
the file — deleting the data, the manifest entry and with it the ETag — and fails with a
message telling the caller to refresh. Without the eviction, the stored ETag would earn a 304
on every future check and the corrupt copy would survive forever.

### Offline means offline

This distinction is the reason the error handling is not simpler:

| Situation | Class | `offline` | Effect |
|---|---|---|---|
| DNS failure, refused connection, timeout | plain `Error` | **set** | Global backoff; `offline: true` |
| 404 | `CacheError('UNKNOWN_VERSION')` | not set | This candidate does not exist; try the next |
| Non-2xx, or a payload that fails validation | `UpstreamError` | not set | The file is marked, the transport is fine |

A 404 is an *answer*, and an answer proves the network works. Letting it set `offline` would
tell users to fix a proxy that was never broken.

## Lookup and search

### Merging a lookup

Records are collected from release info, SAP's classification file, and the partner file for
the requested namespace, then merged per identity:

1. Release info fills the `release` slot.
2. SAP classifications fill `classification` — SAP's own file always wins.
3. A partner record is only accepted for an object SAP says **nothing** about. A namespace
   SAP also ships resolves through SAP.

Level derivation then runs once per merged object, `maxLevel` decides `allowed`, and the
verdict is derived from the set: all allowed and none deprecated is `allowed`; all allowed
with a deprecation is `allowed-deprecated`; anything over the limit is `blocked`. Several
matches that **disagree**, with no `type` given to disambiguate, is `ambiguous` — a question
back to the caller rather than a coin flip.

### The search pools

Search runs over release info, plus a second pool built from classification records for
objects that release info does **not** carry, plus any partner datasets loaded in this
request. Without that subtraction every classified object would appear twice, because lookup
merges the two files but search does not. The pool is built lazily — at most once per
request, and only if something actually asks for it.

Ranking is exact → prefix → substring → all tokens present, ties broken by object key.

### Near matches

A not-found lookup scans the same pools for: the same name under another type, a name that is
identical once slashes and underscores are removed, an edit distance within 2, a prefix
(4 characters or more), or a substring (6 or more). The Levenshtein implementation abandons a
row as soon as the distance is certain to exceed the bound, which keeps a scan over tens of
thousands of records cheap enough to run inline.

## Target resolution

The priority order is in the [README](../README.md#target-resolution). Three design points:

**It refuses rather than guesses.** An ambiguous system produces `TARGET_AMBIGUOUS` with the
candidate list, because a wrong target produces confident wrong verdicts — the worst possible
failure for this server.

**Confidence is reported, not hidden.** A hint from a session folder can be stale, so it is
capped at `medium`; an unrecognised host is `low`. The agents are instructed to surface a
low-confidence assumption to the user.

**Reading the ADT configuration is deliberately narrow.** Four fields, read-only: `id`,
`protocol`, the **host** of `systemUrl`, `systemId`. Credential fields are never bound to a
named value, never returned and never logged — a static check enforces that their field names
do not even appear under `src/`. `stripUserInfo()` removes any `user:password@` prefix from
both the URL and the schemeless RFC spellings before a host is read, and `redactHost()` trims
every host to its last three labels before it can reach a response or a log line.

The version pin applies **only** to private edition. Applied globally it would turn every call
against a public-cloud system into an argument error the user never asked for.

## Validation

The MCP SDK validates a call against the **raw Zod shape**. Cross-field rules attached with
`superRefine` to the full schema therefore never run — which would silently accept a
`maxLevel` on a public-cloud target.

`guarded()` in `index.ts` closes that gap: it parses the full schema itself and converts a
`ZodError` into an `INVALID_ARGUMENT` tool result with the field paths in the message. A
calling model can read and correct that; a protocol-level fault it cannot.

One rule cannot live in the schema at all. `maxLevel` with `target: "auto"` is legal on
input — only resolution knows what the system turns out to be — so every tool that accepts
`maxLevel` calls `refuseMaxLevelOnNonPrivate()` after resolving.

## Error taxonomy

| Thrown | Where | Becomes |
|---|---|---|
| `TargetResolutionError` | `target-resolver.ts` | `TARGET_AMBIGUOUS` / `TARGET_UNRESOLVED`, with candidates |
| `CacheError('DATASET_UNAVAILABLE')` | `cache.ts`, `datasets.ts` | `DATASET_UNAVAILABLE` + a proxy/mirror hint |
| `CacheError('DATASET_DOWNLOADING')` | `cache.ts` | `DATASET_DOWNLOADING` + `retryAfterSeconds` |
| `CacheError('UNKNOWN_VERSION')` | `datasets.ts` | `INVALID_ARGUMENT` |
| `UpstreamError` | `cache.ts` (internal) | never escapes; marks a file, not the network |
| `ZodError` | `guarded()` | `INVALID_ARGUMENT` with field paths |
| anything else | | `INTERNAL_ERROR` |

`failureFor()` in `tools/context.ts` is the single place this mapping happens.

## Concurrency

- **Single-flight downloads.** `inFlight` keys by spec id, so two tool calls that need the
  same missing file share one download.
- **Chained refreshes.** A refresh that arrives while another is running queues behind it
  rather than joining it — a forced check must not be satisfied by a run that started before
  it. The daily gate turns the chained call into a no-op when there is nothing left to do.
- **Background freshness.** `ensureFresh()` is deliberately `void`: server start and every
  tool call open the daily gate without blocking on it. A lookup waits only for a file that is
  genuinely missing, and then only up to 30 seconds before answering `DATASET_DOWNLOADING`.
- **Serialised manifest writes.** Every save queues behind the one before it and serialises
  the manifest when its turn comes, so the copy on disk is the newest one rather than whichever
  rename finished last. See [Atomic writes](#atomic-writes).
- **Memoised parses.** `DatasetRegistry` parses each file at most once per process and
  subscribes to the cache, so a file that is rewritten or evicted drops out of the memo
  automatically.
- **Per-request partner cache.** Partner datasets are cached per request, keyed by namespace,
  so a batch of 100 objects in one namespace loads that file once.

## Delivery

`dist/index.js` is an esbuild CommonJS bundle with every dependency inlined. It is committed,
and CI rebuilds it and fails on any byte difference.

That choice follows from how plugins are installed: a plugin checkout has no `node_modules`
and no install step runs. A committed bundle is the only way the server can start the moment
the plugin lands. CommonJS because the entry guard is `require.main === module`, and because
a single-file CJS bundle has no loader edge cases to trip over.

`.gitattributes` marks the bundle `-text` so line-ending normalisation cannot make the
byte-comparison fail on Windows checkouts.

## Testing

188 tests under `test/`, one suite per module, on `node:test`. `npm test` type-checks into
`build/` first and runs the compiled output, so the tests exercise the same code TypeScript
accepts.

Conventions worth keeping:

- **The HTTP client is injected.** `CacheOptions` takes an `HttpClient`, a `now()` and a
  `log()`, so cache policy is tested against a fake clock and scripted responses — no network,
  no sleeping.
- **Proxy variables are blanked at module scope** in `http.test.ts`. Without it, a corporate
  `HTTPS_PROXY` routes the loopback test server through a proxy and the suite fails on
  exactly the machines that need the proxy support most.
- **Temp directories, always.** Cache tests run against `mkdtemp` directories, never the real
  data directory.
- **`scripts/smoke.mjs`** is the end-to-end check: it starts the bundle, initializes, lists
  the tools, calls `dataset_info` and asserts the server block. CI runs it twice — once
  normally, once from a temp directory with no `node_modules` reachable, which is what proves
  the bundle is self-contained. It points the base URL at an unreachable mirror so the smoke
  test never touches the network.
