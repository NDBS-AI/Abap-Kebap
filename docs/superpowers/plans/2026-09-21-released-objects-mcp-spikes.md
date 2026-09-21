# Released-objects MCP — Task 0 verification spikes

Date run: 2026-09-21. Nothing in this task was committed beyond this document. Scratch work lived
under `_scratch/spike/` (gitignored) and the temporary `mcpServers` block added to
`.claude-plugin/plugin.json` was reverted.

Host environment for every spike: Windows 11, Git Bash, Node **v26.2.0**, npm 11.17.0,
Claude Code 2.1.178.

## Summary

| Spike | Assumption | Verdict | Fallback adopted |
|---|---|---|---|
| A | An inline `mcpServers` block in `plugin.json` auto-starts the server, and `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` expand to absolute paths | **PASS** | none |
| B | `raw.githubusercontent.com` returns an `ETag` and honours `If-None-Match` with `304` | **PASS** | none |
| C | Node floor is satisfiable and the `objectReleaseInfo_PCE*` set is the ground truth for the version mapping | **PASS (qualified)** | partial — see C |
| D | `src/partner/` can be listed and its files parse with `"formatVersion": "2"` as a string | **PASS** | none |
| E | The ADT MCP tool is `abap_list_destinations`, takes no input, returns destination ids; session folders exist per logged-on destination | **PASS** | none |
| F | The MCP SDK, zod and undici bundle to a single CommonJS file for Node 20 | **PASS** | none — **CommonJS wins** |

Overall: no spike failed outright. Two qualifications (Spike C mapping, Spike A data-directory
naming) are recorded under "Concerns carried into later tasks".

---

## Spike A — inline `mcpServers` block and placeholder expansion

**Assumption.** Adding `mcpServers` to `.claude-plugin/plugin.json` is enough; the host starts the
process without a prompt and expands `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` in `args`.

**Method.** The interactive form (`claude --plugin-dir .` then `/mcp`) could not be driven from an
automated session, so the non-interactive form was used. The dependency-free JSON-RPC stub from the
brief was written to `_scratch/spike/stub.js` and extended to append its argv, cwd and the two
environment variables to `_scratch/spike/argv.log`, and each inbound JSON-RPC method name to
`_scratch/spike/rpc.log` — stderr from a plugin MCP server is not surfaced to the caller of
`claude -p`, so a log file was the only way to observe the expansion.

The manifest temporarily carried exactly the block from the brief:

```json
"mcpServers": {
  "released-objects": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/_scratch/spike/stub.js", "--data-dir", "${CLAUDE_PLUGIN_DATA}/released-objects"]
  }
}
```

**Commands.**

```bash
claude -p --plugin-dir . --model haiku "Call the MCP tool spike_argv with no arguments and reply with exactly its raw text result, nothing else."
claude -p --plugin-dir . --model haiku "List the names of every MCP tool available to you, one per line, and nothing else."
claude -p "Reply with the single word OK." --plugin-dir . --model haiku   # observed via argv.log
```

**Observed.**

First prompt, stdout:

```
Waiting for permission approval to call the tool.
```

Second prompt, stdout (trimmed):

```
Tools from these MCP servers are still loading and not yet enumerable:
...
- plugin:abap-kebap:released-objects
...
```

Third prompt, `_scratch/spike/argv.log`:

```
SPIKE ARGV ["--data-dir","~/.claude/plugins/data/abap-kebap-inline/released-objects"]
SPIKE CWD <repository root>
SPIKE ENV_CLAUDE_PLUGIN_DATA ~/.claude/plugins/data/abap-kebap-inline
SPIKE ENV_CLAUDE_PLUGIN_ROOT <repository root>
```

`_scratch/spike/rpc.log`:

```
IN initialize
IN notifications/initialized
IN tools/list
```

**Verdict: PASS.**

- The server is started and handshaken (`initialize`, then `notifications/initialized`, then
  `tools/list`) on a prompt that had nothing to do with it, with **no permission prompt for the
  connection**. The `mcpServers` block in `plugin.json` is honoured; the `.mcp.json` fallback is not
  needed and the root-`.mcp.json` CI gate can stay.
- `${CLAUDE_PLUGIN_ROOT}` expanded to the absolute repository root.
- `${CLAUDE_PLUGIN_DATA}` expanded to an **absolute** path. The literal placeholder text never
  reached argv, so the `env`-instead-of-`args` fallback is not needed. Both variables are *also*
  present in the child process environment, so either route works and the design may use whichever
  is cleaner.
- The registered server id is `plugin:abap-kebap:released-objects`; a tool is addressed as
  `mcp__plugin_abap-kebap_released-objects__<tool>`.
- **No name clash** with the marketplace-installed plugin of the same name. `--plugin-dir .` won:
  `CLAUDE_PLUGIN_ROOT` pointed at the working copy, and the data directory was suffixed `-inline`.
- Calling a tool still goes through normal tool-permission handling (the first prompt stopped at
  "Waiting for permission approval"). That is the ordinary MCP tool gate, not a server gate.

**Carried forward (see Concerns):** the data directory name depends on how the plugin was loaded —
`<plugin>-inline` for `--plugin-dir`, a marketplace-qualified name for a marketplace install.

---

## Spike B — ETag and `304` on `raw.githubusercontent.com`

**Command.**

```bash
URL=https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/objectReleaseInfo_BTPLatest.json
ETAG=$(curl -sI "$URL" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')
echo "etag=$ETAG"
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ETAG" "$URL"
```

**Observed.**

```
etag="701e3062bab2a503fbff8b2be8305048659cb53a458d10742430e38ba4ec5f71"
304
```

**Verdict: PASS.** A non-empty, quoted ETag is returned and `If-None-Match` yields `304`. The ETag
value is a 64-hex-character content hash, which is exactly what the manifest's `sha256` field
already holds — conditional GET and content hashing agree. No fallback needed.

---

## Spike C — Node floor and the PCE version set

**Commands.**

```bash
node -v
curl -s https://api.github.com/repos/SAP/abap-atc-cr-cv-s4hc/contents/src | grep -o '"name": *"objectReleaseInfo_PCE[^"]*"' | sort
```

The unauthenticated GitHub API answered `HTTP 200` — no rate limiting, so the shallow-clone route
was not needed. The same listing also served Spike D.

**Observed.** `node -v` gave `v26.2.0`.

Exact `objectReleaseInfo_PCE*` file names in `src/`:

```
objectReleaseInfo_PCE2022.json
objectReleaseInfo_PCE2022_1.json
objectReleaseInfo_PCE2022_2.json
objectReleaseInfo_PCE2023_0.json
objectReleaseInfo_PCE2023_1.json
objectReleaseInfo_PCE2023_2.json
objectReleaseInfo_PCE2023_3.json
objectReleaseInfo_PCE2025_0.json
objectReleaseInfo_PCE2025_1.json
objectReleaseInfo_PCELatest.json
objectReleaseInfo_PCELatest.toon
```

Full `src/` listing for completeness:

```
archive/                          (directory)
objectClassifications_SAP.json
objectReleaseInfo_BTPLatest.json
objectReleaseInfo_PCE2022.json
objectReleaseInfo_PCE2022_1.json
objectReleaseInfo_PCE2022_2.json
objectReleaseInfo_PCE2023_0.json
objectReleaseInfo_PCE2023_1.json
objectReleaseInfo_PCE2023_2.json
objectReleaseInfo_PCE2023_3.json
objectReleaseInfo_PCE2025_0.json
objectReleaseInfo_PCE2025_1.json
objectReleaseInfo_PCELatest.json
objectReleaseInfo_PCELatest.toon
objectReleaseInfoLatest.json
partner/                          (directory)
```

All `objectReleaseInfo_*.json` files sampled (`PCE2022`, `PCE2023_3`, `PCE2025_1`, `BTPLatest`)
begin with `"formatVersion":"1"` — a **string** — and carry an `objectReleaseInfo` array whose
entries have `tadirObject`, `tadirObjName`, `objectType`, `objectKey`, `softwareComponent`,
`applicationComponent`, `state`, and either `successorClassification` plus a `successors[]` array,
or `successorClassification: "concept"` plus `successorConceptName`.

**Verdict: PASS, qualified.**

- Node floor: satisfiable. Node 26 is well past the Node 20 floor; the bundle in Spike F targets
  `node20` and ran here. Nothing on this machine exercises an actual Node 20 runtime — see Concerns.
- Version set: the year set is **{2022, 2023, 2025}**. There is no `2024` file, matching the
  product's feature-pack cadence. The `107 -> 2022`, `108 -> 2023`, `109 -> 2025` mapping is
  **consistent** with this set but is *not itself stated anywhere in the repository*: no file
  content and no README line ties a release number to a year. The mapping must be treated as
  external knowledge, not as something this spike verified.
- File-name construction is **not** a simple `PCE<year>.json`. Feature-pack suffixes are irregular:
  `PCE2022.json` carries no suffix while `PCE2022_1` and `PCE2022_2` do, and 2023/2025 use
  `_0`-based suffixes with no unsuffixed variant. The upstream README still advertises
  `.../src/objectReleaseInfo_PCE2025.json` as its example URL; that URL returns **404**, while
  `objectReleaseInfo_PCE2025_0.json` returns `200`. Any resolver must list the directory rather than
  construct a name.

**Fallback adopted (partial).** For Task 8: keep the year mapping as a convenience, but (a) resolve
the concrete file by listing `src/` and picking the highest feature-pack suffix for the requested
year rather than by string-building, and (b) document in the tool description that the
release-number-to-year mapping is a heuristic and that the user may pin `version` explicitly, with
`latest` as the default.

---

## Spike D — the partner directory listing

**Command.**

```bash
curl -s https://api.github.com/repos/SAP/abap-atc-cr-cv-s4hc/contents/src/partner \
  | grep -o '"name": *"[^"]*"' | sed 's/.*: *//' | tr -d '"' | sort > _scratch/spike/partner-files.txt
wc -l _scratch/spike/partner-files.txt
```

**Observed.** `HTTP 200`, **29** files.

First five:

```
objectClassifications_CDE.json
objectClassifications_CLR.json
objectClassifications_COCKPIT.json
objectClassifications_CONLUTIO.json
objectClassifications_EBY.json
```

All 29, in sorted order (the seed for `src/partner-index.json` in Task 9):

```
objectClassifications_CDE.json
objectClassifications_CLR.json
objectClassifications_COCKPIT.json
objectClassifications_CONLUTIO.json
objectClassifications_EBY.json
objectClassifications_ENSX.json
objectClassifications_EYINTINV.json
objectClassifications_FINATO.json
objectClassifications_ICO.json
objectClassifications_INFHCM.json
objectClassifications_INVICL.json
objectClassifications_IXBX.json
objectClassifications_IXOS.json
objectClassifications_MIC.json
objectClassifications_NAMESPACE.json
objectClassifications_OBZERVR.json
objectClassifications_OPT.json
objectClassifications_ORS.json
objectClassifications_OTX.json
objectClassifications_OTXAF.json
objectClassifications_PAT.json
objectClassifications_PROS.json
objectClassifications_QTYW.json
objectClassifications_SAAR.json
objectClassifications_SERPEWM.json
objectClassifications_SIAV.json
objectClassifications_TFTO.json
objectClassifications_TOP.json
objectClassifications_XPR.json
```

`objectClassifications_NAMESPACE.json` is present and is the empty template — its entire content is:

```json
{
 "formatVersion":"2"
}
```

so skipping it by name is correct, and a defensive "`objectClassifications` is absent" guard costs
nothing.

A real file (`objectClassifications_CDE.json`) parsed cleanly; its top-level keys are
`formatVersion` and `objectClassifications`, and `formatVersion` is `"2"` with
`typeof === 'string'`. Entries carry `tadirObject`, `tadirObjName`, `objectType`, `objectKey`,
`softwareComponent`, and `state` (for example `"classicAPI"`) — note there is **no**
`applicationComponent` and no successor block in the partner format, unlike the `objectReleaseInfo`
format.

**Verdict: PASS.** No fallback needed. `_scratch/spike/partner-files.txt` was kept for Task 9 (the
brief's Step 4 asks for it); the full list is also inlined above, so the scratch file is optional.

---

## Spike E — the ADT MCP surface

The ADT MCP server was not reachable from the automated session, so the tool contract was read
directly out of the installed extension bundle (read-only) instead of by calling it. No credential
material was opened.

**Filesystem half.**

```bash
ls -1dt ~/.adtls/session-* 2>/dev/null | head -5
```

**Observed:** exactly **one** session folder, matching the expected
`session-<destination-id>-<hash>` shape (two dash-separated segments after the `session-` prefix).
`~/.adtls/` also contains `destinations.json` (it exists; contents deliberately not opened),
`token.json`, and a `workspace/` directory. One session folder for one logged-on destination matches
the assumption, and `ls -1dt` orders newest first as required.

**Tool contract.** The MCP surface is implemented on the Java language-server side, not in the
extension's JavaScript bundle. The extension's `package.json` declares the settings
`adt.mcpServer.enabled`, `adt.mcpServer.port` and `adt.mcpServer.token`, a
`mcpServerDefinitionProviders` contribution with id `com.sap.adt/mcp`, and describes the server as a
local HTTP endpoint at `http://localhost:<port>/mcp` authenticated with a generated bearer token.
The implementation lives in the `com.sap.adt.mcp.core` plugin bundled with the language server.

Its message bundle gives the tool name and description verbatim:

```
AdtDestinationsMcpTool_listDestinationsToolName=abap_list_destinations
AdtDestinationsMcpTool_listDestinationsToolDescription=Get list of available ABAP system destinations
```

The tool class's constant pool gives the full contract:

- input schema, embedded literally: `{ "type": "object", "properties": {} }` — **no input**
- execute path: get the destination registry, call `getRegisteredDestinationKeys()` returning
  `Set<String>`, call `toString()` on it, and pass that single string to the result builder's
  `withContent(...)`
- on failure: the exception message is appended to a localised prefix and the result is flagged
  `isError(true)`

**Verdict: PASS.**

- The tool name `abap_list_destinations` is exactly right; the
  `cloud-skill-resolves-target-via-adt-mcp` static rule needs no change.
- It takes no input and returns **destination ids only** — a set of strings. No URLs, no software
  components, no product data. The "also returns URLs or software components" fallback does **not**
  apply, so Task 15 must not promise high-confidence target detection from this tool alone.
- Session folders exist, one per logged-on destination, so step 2 of the `auto` resolution order in
  Task 8 stands.

**Implementation note for Task 15.** The result text is a Java set rendered by `toString()`, i.e.
`[ID_A, ID_B]` — bracketed, comma-and-space separated, **not JSON**. Parsing must strip the outer
brackets and split on `", "`; `JSON.parse` will throw on it. Set iteration order is unspecified, so
do not treat the first element as "current". Separately, the ADT MCP server is HTTP-with-bearer-token
on localhost rather than stdio, which matters only if anything ever connects to it programmatically.

---

## Spike F — CommonJS bundling of the MCP SDK

**Commands.**

```bash
npm init -y
npm install @modelcontextprotocol/sdk zod undici
npm install -D esbuild
# entry.js exactly as the brief specifies
npx esbuild entry.js --bundle --platform=node --target=node20 --format=cjs --outfile=out.js && node out.js
```

**Observed.** Installed versions: `@modelcontextprotocol/sdk` **1.30.0**, `zod` **4.6.5**,
`undici` **8.10.2**, `esbuild` **0.28.2**.

```
  out.js  2.8mb

Done in 120ms
SPIKE bundle ok: function,function,function,function
```

**Verdict: PASS. Decision: CommonJS.**

Every later task uses CommonJS import style: `package.json` without `"type": "module"`, tsconfig
`"module": "commonjs"`, `require(...)` / `import ... = require(...)` for relative imports with no
`.js` extensions, esbuild `--format=cjs`, and `src/partner-index.json` may stay a plain JSON file
imported directly — no generated `partner-index-builtin.ts` is required. The ESM fallback is **not**
adopted.

Notes: the bundle is 2.8 MB, driven mostly by `undici`. If size ever matters, `undici` can be
dropped in favour of Node's built-in `fetch` with `--external:undici`, but proxy support via
`EnvHttpProxyAgent` is the reason it is there, so bundling it is the right trade. `npm` warned that
`esbuild@0.28.2` has an unapproved `postinstall` script; the bundle succeeded regardless, so no
action was needed.

---

## Concerns carried into later tasks

1. **The plugin data directory depends on the install route.** Sibling directories under
   `~/.claude/plugins/data/` follow `<plugin>-inline` when the plugin is loaded with `--plugin-dir`
   and a marketplace-qualified name when installed from a marketplace. A developer working from the
   repository and a user who installed from the marketplace therefore get **different** cache
   directories, and the cache will not carry over between the two. This is acceptable but should be
   stated in the docs, and it strengthens the case for the `~/.abap-kebap/released-objects` home
   fallback that Task 1 builds. The directory already existed here, but the server must still create
   it defensively.
2. **The release-number-to-year mapping is unverified.** The repository confirms only the year set.
   Apply the partial fallback described under Spike C (affects Task 8).
3. **PCE file names cannot be built by string interpolation.** Feature-pack suffixes are irregular
   and the upstream README's own example URL returns 404. Task 8 must resolve by directory listing.
4. **Node 20 was not exercised.** The bundle targets `node20` and runs on Node 26; nothing here
   proves it on an actual Node 20 runtime. If the floor matters, add a CI job pinned to Node 20.
5. **`abap_list_destinations` returns ids only.** Task 15's skill text must not claim URL- or
   software-component-based confidence, and must parse a Java set rendering rather than JSON.
6. **New upstream artefacts not covered by the plan.** `src/` now also contains
   `objectClassifications_SAP.json` (the `formatVersion: "2"` shape, introduced with a newer ATC
   check) and `objectReleaseInfo_PCELatest.toon`, a token-reduced non-JSON rendering of the latest
   PCE data. Neither is in scope for the current design; both deserve a decision before Task 8.

## Cleanup performed

```bash
git checkout -- .claude-plugin/plugin.json      # manifest restored, git diff clean
rm -rf _scratch/spike/<all artefacts except partner-files.txt>
```

`_scratch/spike/partner-files.txt` was deliberately retained as the Task 9 seed, per Step 4. It is
gitignored.
