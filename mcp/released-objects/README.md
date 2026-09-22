# `released-objects` — MCP server

Answers one question, from SAP's own published data rather than from a language model's
memory: **may this SAP standard object be used on my target system?**

The data is SAP's [Cloudification Repository](https://github.com/SAP/abap-atc-cr-cv-s4hc) —
the TADIR-granular lists behind the ATC checks that decide whether an object is a released
API, a classic API, deprecated, or not an API at all. The server downloads those lists,
keeps them fresh, and answers locally. It never sends your code, your object names or your
system identity anywhere.

It ships inside the [abap-kebap](../../README.md) plugin and starts itself when the plugin
is installed. There is no separate install step.

| | |
|---|---|
| **Server name** | `released-objects` |
| **Tools** | `check_objects`, `search_objects`, `dataset_info` |
| **Transport** | stdio (JSON-RPC over stdin/stdout) |
| **Runtime** | Node.js 20.18.1 or newer, no runtime dependencies (single bundled file) |
| **Data source** | `github.com/SAP/abap-atc-cr-cv-s4hc`, Apache-2.0 |
| **Code licence** | MIT, like the rest of this repository |
| **Network** | Four HTTPS GETs on first use (~26 MB), then one conditional request per file per day |

## Documentation map

| Document | What it covers |
|---|---|
| This file | What the server is, how it is wired up, configuration, troubleshooting, development |
| [docs/tools.md](docs/tools.md) | Full reference for the three tools: every parameter, every response field, worked examples |
| [docs/architecture.md](docs/architecture.md) | Module map, request flow, the invariants the code holds and why |
| [docs/operations.md](docs/operations.md) | Cache layout and refresh policy, proxies and mirrors, air-gapped use, cache repair |

## Why this exists

An agent asked "can I use `MARA` in ABAP Cloud?" will usually answer from training data. That
answer ages badly: SAP releases new APIs every quarter, deprecates others, and the Clean Core
level of an object depends on which of the three ABAP products you are targeting. The three
`abap-kebap` agents are therefore instructed to call `check_objects` before giving a verdict
on any SAP standard object, and to call `search_objects` before naming a replacement for one
that is blocked or deprecated. That turns a recalled guess into a lookup against SAP's own
published list, with the data's own timestamp attached to the answer.

## How it reaches you

The plugin manifest declares the server inline, so installing the plugin is the whole setup:

```jsonc
// .claude-plugin/plugin.json
"mcpServers": {
  "released-objects": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/released-objects/dist/index.js"],
    "env": { "ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR": "${CLAUDE_PLUGIN_DATA}/released-objects" }
  }
}
```

Two placeholders, two different jobs. `CLAUDE_PLUGIN_ROOT` is where the plugin's **code**
was unpacked — read-only, replaced wholesale on every update. `CLAUDE_PLUGIN_DATA` is the
plugin's **writable** directory — it survives updates, which is where 26 MB of downloaded SAP
data has to live. Writing the cache under the plugin root would mean re-downloading everything
after each plugin update.

`dist/index.js` is a committed esbuild bundle with every dependency inlined, so the server
runs straight from a plugin checkout with no `npm install` and no `node_modules` on disk. CI
rebuilds it and fails if the committed bundle differs by a byte.

### Running it outside the plugin

```bash
# from a clone of this repository
node mcp/released-objects/dist/index.js --verbose

# register it with Claude Code by hand
claude mcp add released-objects -- node /absolute/path/to/mcp/released-objects/dist/index.js
```

Any MCP client that speaks stdio works. The server writes nothing but JSON-RPC to stdout;
all diagnostics go to stderr.

### Turning it off

`/mcp` in Claude Code lists the server and lets you disable it. The agents degrade to
answering from their skills, which is exactly the situation this server exists to improve on.

## The three tools

Full reference with response fields and examples: **[docs/tools.md](docs/tools.md)**.

### `check_objects` — the verdict

Send up to 100 object names in one call and get a verdict for each: `allowed`,
`allowed-deprecated`, `blocked`, `not-found` or `ambiguous`, with the Clean Core level, the
successor for deprecated objects, and near-match suggestions when a name is not found.

```json
{ "objects": ["MARA", { "name": "I_Product", "type": "DDLS" }], "target": "cloud-erp" }
```

Custom `Z`/`Y` objects are never in SAP's lists and come back as `not-found`. That is not a
verdict about them — it means the question does not apply.

### `search_objects` — the replacement

Find a released API by name fragment, object type, application component, published state or
SAP label. This is how an agent answers "what should I use instead?" without inventing a name.

```json
{ "query": "purchase order", "objectType": "DDLS", "applicationComponent": "MM-PUR", "limit": 20 }
```

A search result carries a Clean Core level, not a usage verdict. Call `check_objects` on
anything you actually intend to use.

### `dataset_info` — the provenance

Which files are cached, how big they are, when they were downloaded, when SAP last changed
them, which target was resolved and how, and whether the last check failed. Pass
`refresh: true` to check SAP immediately instead of waiting for the daily gate. Call it when
an answer looks stale or when another tool reports the data as unavailable.

## Target resolution

Every answer depends on which of SAP's three ABAP products you are targeting, because the
same object can be released on one and blocked on another.

| Target | Product |
|---|---|
| `cloud-erp` | SAP S/4HANA Cloud Public Edition |
| `cloud-erp-private` | SAP S/4HANA Cloud Private Edition, and on-premise |
| `btp-abap-environment` | SAP BTP ABAP environment (Steampunk) |

Leaving `target` at its default `auto` resolves it in this order:

1. **An explicit `target` argument** — the caller said so. Confidence `high`.
2. **`ABAP_KEBAP_RELEASED_OBJECTS_TARGET`** — the machine is pinned. Confidence `high`.
3. **A single configured ADT destination** — classified by protocol and host. `rfc` means
   private edition; `*.s4hana.cloud.sap` and `*.s4hana.ondemand.com` mean public cloud;
   `*.abap.<region>.hana.ondemand.com` means BTP. An unrecognised host over HTTP is treated
   as a customer-hosted private system with confidence `low`.
4. **The most recently used ADT destination**, when several are configured — read from the
   modification times of the ADT session folders. Confidence is capped at `medium`, because
   a stale session folder is a hint and not a fact.
5. **Otherwise it refuses**: `TARGET_AMBIGUOUS` with the candidate list, or
   `TARGET_UNRESOLVED` with none. It does not guess.

Every answer echoes `target`, `resolvedFrom`, `confidence` and — when the target was assumed
rather than told — an `assumption` sentence for the agent to quote back to you.

### What is read from the ADT configuration

`~/.adtls/destinations.json` is opened **read-only**, and exactly four things are taken from
each entry: the destination `id`, the `protocol`, the **host** of `properties.systemUrl`, and
`properties.systemId`. User names, tokens and authentication settings are never bound to a
named value, never returned and never logged. Any `user:password@` prefix is stripped from
the URL before the host is read, and every host that reaches a response or a log line is
reduced to its last three labels — `abc.s4hana.cloud.sap`, never the full internal name.

## Configuration

All settings are optional. Environment variables win over defaults; the two CLI flags win
over the environment.

| Variable | Default | Effect |
|---|---|---|
| `ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR` | `~/.abap-kebap/released-objects` | Where the cache lives. Must be an **absolute** path; anything else is ignored with a warning on stderr. The plugin sets this to the plugin data directory. |
| `ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL` | SAP's `raw.githubusercontent.com` path | Point at an internal mirror of the repository's `src/` directory. Setting it also switches **off** every GitHub API call, so no upstream commit dates and the built-in partner list. |
| `ABAP_KEBAP_RELEASED_OBJECTS_TARGET` | unset | Pin the target to `cloud-erp`, `cloud-erp-private` or `btp-abap-environment` and skip ADT detection entirely. |
| `ABAP_KEBAP_RELEASED_OBJECTS_VERSION` | unset | Pin the private-edition release: `latest`, `2023`, or `2021_1`. Applies **only** to `cloud-erp-private`; the other two targets have a single current state. |
| `ABAP_KEBAP_ADT_STATE_DIR` | `~/.adtls` | Where the ADT session folders are looked for. |
| `ABAP_KEBAP_ADT_DESTINATIONS_PATH` | `<state dir>/destinations.json` | The destinations file itself. |
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | unset | Honoured for every request. Node's global `fetch` ignores these, so the server uses undici's `EnvHttpProxyAgent` instead. |
| `NODE_EXTRA_CA_CERTS` | unset | Needed when the corporate proxy inspects TLS. |

| Flag | Effect |
|---|---|
| `--data-dir <absolute path>` | Same as the data-directory variable, and takes precedence over it. |
| `--verbose` | Log cache decisions to **stderr**. stdout is the MCP protocol and nothing else may touch it. |

A bad value is never fatal: it is recorded as a warning, printed to stderr at startup, and
also returned in `dataset_info.warnings` so you can see it from inside a session.

## Errors

Tool errors come back as a JSON body with an `error` object and the MCP `isError` flag set,
so the calling model can read and act on them rather than seeing a protocol fault.

| Code | Meaning | What to do |
|---|---|---|
| `TARGET_AMBIGUOUS` | Several ADT destinations and no way to choose. Carries `candidates`. | Pass `target` explicitly, or pin it in the environment. |
| `TARGET_UNRESOLVED` | No destinations and no pin. | Same. |
| `DATASET_UNAVAILABLE` | Nothing cached and the source cannot be reached. | Check the proxy variables, or set a mirror; then `dataset_info` with `refresh: true`. |
| `DATASET_DOWNLOADING` | The first download is still running. Carries `retryAfterSeconds`. | Wait and call again. |
| `INVALID_ARGUMENT` | The arguments do not hold together — a `version` or a `maxLevel` on a target that has neither, an unknown private-edition release, an unreadable cached file. | Fix the arguments; the message names the field. |
| `INTERNAL_ERROR` | A bug. | Re-run with `--verbose` and open an issue. |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every call answers `DATASET_UNAVAILABLE` | No network route to `raw.githubusercontent.com` | Set `HTTPS_PROXY` and `NO_PROXY`; add `NODE_EXTRA_CA_CERTS` if the proxy inspects TLS; or set a mirror base URL. |
| `unable to verify the first certificate` on stderr | TLS-inspecting proxy | `NODE_EXTRA_CA_CERTS=/path/to/corporate-root.pem` |
| Answers are right but `upstreamCommittedAt` is always `null` | GitHub API unreachable, rate-limited, or a mirror is configured | Harmless. The commit date is best-effort provenance, never a correctness input. |
| Verdicts look wrong for your system | The wrong target was resolved | Check `resolvedFrom` and `confidence` in any response; pin `ABAP_KEBAP_RELEASED_OBJECTS_TARGET`. |
| A `/NS/` object is always `not-found` | That vendor published no classification file | Expected. The response says so and tells you to ask the vendor. |
| `dataset_info` reports `stale-error` on a file | A download failed validation, or the file on disk was edited | Call `dataset_info` with `refresh: true`; the file is evicted and re-fetched. See [docs/operations.md](docs/operations.md). |
| The server will not start | Node older than 20 | The startup check names the version it found. Install a current Node and restart the client. |
| The server starts but every download throws from inside undici | Node 20.0–20.18.0 | The startup check only enforces major ≥ 20; the dependency floor is 20.18.1. Upgrade Node. |

## Development

```bash
cd mcp/released-objects
npm ci                      # dev dependencies only; the shipped bundle needs none
npm test                    # tsc to build/, then node --test — 188 tests
npm run typecheck           # tsc --noEmit
npm run build               # esbuild → dist/index.js (committed)
node scripts/smoke.mjs      # start the bundle, list the tools, call dataset_info
npm run update-partner-index  # refresh the committed partner-namespace fallback list
```

### Layout

```
mcp/released-objects/
├── dist/index.js            committed bundle — what the plugin actually runs
├── src/
│   ├── index.ts             entry point, tool registration, argument guard
│   ├── config.ts            environment and flags → ServerConfig
│   ├── http.ts              proxy-aware HTTPS GET with ETag support
│   ├── cache.ts             download, validate, atomic write, manifest, daily gate
│   ├── datasets.ts          which files a target needs; parse records into indexes
│   ├── partner-index.ts     partner namespaces and their classification files
│   ├── target-resolver.ts   ADT destinations → target, with redaction
│   ├── query.ts             lookup, level derivation, search, near-match suggestions
│   ├── schemas.ts           the three Zod input schemas and their teaching text
│   ├── types.ts             Target, CleanCoreLevel, RawRecord, Match
│   └── tools/               one file per tool, plus the shared context
├── test/                    node:test suites, one per module
├── scripts/                 smoke test and the partner-index updater
└── docs/                    tools, architecture, operations
```

### Invariants the tests enforce

- **stdout is protocol-only.** Every log line goes to stderr. A stray `console.log` corrupts
  the MCP stream and breaks the session.
- **The bundle is byte-stable.** CI rebuilds `dist/index.js` and fails on any diff, so the
  committed artefact always matches the source.
- **The bundle is self-contained.** CI copies it to an empty temp directory with no reachable
  `node_modules` and runs the smoke test there.
- **There is exactly one MCP declaration.** CI fails if a root `.mcp.json` appears; the
  inline `mcpServers` block in the plugin manifest is the only one.
- **Credential field names do not appear under `src/`.** A static check enforces it.

### Adding a tool

1. Add the Zod shape and the full schema to `src/schemas.ts`. Cross-field rules go in a
   `superRefine` on the full schema — the SDK validates the raw shape only, so those rules
   run in the `guarded()` wrapper in `src/index.ts` and nowhere else.
2. Write the handler in `src/tools/`, returning `toolSuccess()` or `toolFailure()`.
3. Register it in `toolDefinitions()`.
4. Add the expected name to `scripts/smoke.mjs`.
5. Document it in [docs/tools.md](docs/tools.md) and teach the agents when to call it.

## Data, licence and privacy

The released-object lists are SAP's, published under Apache-2.0. SAP's own note applies: the
licence covers the **lists**, not the use of the SAP APIs the lists describe. Nothing in the
data or in this server is a statement about your entitlement to any SAP API.

The server makes exactly one kind of outbound request — fetching public files from the SAP
repository (or from the mirror you configured) — plus optional GitHub API calls for commit
dates and the partner-file listing. Object names you look up, your source code and your
system details are never transmitted. Once the four core files are on disk the server answers
with no network at all.

## Known limitations

- **Absence is not a verdict.** An object missing from SAP's lists is reported as `not-found`
  with the implied level for that target (`none` on public cloud and BTP, `C` on private
  edition) — never as "allowed".
- **Partner namespaces are optional data.** A vendor that publishes no classification file is
  indistinguishable from one whose objects do not exist; the response says which case it is
  as far as it can tell.
- **Private-edition release files are discovered, not enumerated.** SAP adds one file per
  release. The committed list is a fallback; `dataset_info` refreshes it best-effort.
- **A search result is not a verdict.** `search_objects` reports a Clean Core level for the
  resolved target. Confirm anything you intend to use with `check_objects`.
