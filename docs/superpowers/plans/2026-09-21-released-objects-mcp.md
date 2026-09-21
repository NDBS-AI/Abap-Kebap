# Released-Objects MCP Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a bundled, zero-setup MCP server named `released-objects` that answers "is this SAP object usable in ABAP Cloud / Clean Core on this target, and what is the successor?" from SAP's public Cloudification Repository, and wire the three ABAP agents to use it.

**Architecture:** A Node/TypeScript stdio MCP server lives in `mcp-server/`, is compiled by esbuild into one committed dependency-free file `mcp-server/dist/index.js`, and is declared inline in `.claude-plugin/plugin.json` under `mcpServers` so installing the plugin auto-starts it. The server downloads SAP's JSON lists into `${CLAUDE_PLUGIN_DATA}/released-objects`, re-checks them once per local day with conditional GETs, and exposes three tools (`check_objects`, `search_objects`, `dataset_info`) over three layers: a cache manager (I/O and freshness), a query engine (pure functions over records), and a Zod-validated tool layer.

**Tech Stack:** Node.js >= 20 · TypeScript 5.x · `@modelcontextprotocol/sdk` · `zod` · `undici` (proxy-aware fetch) · `esbuild` (bundler) · `node --test` (test runner) · GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-09-20-released-objects-mcp-design.md](../specs/2026-09-20-released-objects-mcp-design.md) — read it before starting. Section references below (`§6.2`, `§7.1`, …) point into it.

## Global Constraints

Every task's requirements implicitly include this section.

- **Runtime floor:** Node.js >= 20. The server checks `process.version` at startup and exits with a stderr message below 20. CI pins `node-version: "20"`.
- **No install on the user's machine:** `mcp-server/dist/index.js` is a **committed** esbuild single-file bundle with every runtime dependency folded in. Plugin install is a git clone; no `npm install` ever runs for the end user.
- **Runtime dependencies (bundled, nothing else):** `@modelcontextprotocol/sdk`, `zod`, `undici`. Dev only: `typescript`, `esbuild`, `@types/node`.
- **Exactly one MCP declaration:** inline `mcpServers` in `.claude-plugin/plugin.json`. **No `.mcp.json` at the repository root** — the plugin root *is* the repo root and a root `.mcp.json` would register the server twice. CI asserts `test ! -f .mcp.json`.
- **stdout is the MCP transport.** All logging goes to **stderr only**. A stray `console.log` corrupts the protocol.
- **Offline-first:** every tool answers from the disk cache when the network is down. The server never crashes on bad input or bad network; failures come back as typed tool errors (§7.4).
- **Never guess a target.** `auto` resolution echoes `resolvedTarget`, `resolvedFrom`, `confidence` and (at medium confidence) an `assumption` sentence, or fails with `TARGET_AMBIGUOUS` / `TARGET_UNRESOLVED` (§6.4).
- **Credential hygiene:** the ADT destinations file is opened read-only; only `id`, `protocol`, the host part of `properties.systemUrl` and `properties.systemId` are parsed. `user`, tokens and `authenticationKind` are never read into memory as named values, never returned, never logged. Hosts in candidate lists are reduced to their last three labels.
- **No third-party reference-tool or package names** in any shipped content (spec, code, comments, docs, commit messages). The community MCP wrapper studied under the gitignored `example/` folder during design is reference only — do not name it anywhere. This is a review-the-diff discipline, deliberately **not** a static-check rule.
- **Never cite the local `example/` folder or any machine-local path** in shipped content — existing static rules `no-machine-local-paths` and `no-local-example-folder-citations` enforce this.
- **Agent-file links:** every local markdown link inside `.claude/agents/*.md` must be prefixed `${CLAUDE_PLUGIN_ROOT}/` — `scripts/validate_skills.py` fails the build otherwise.
- **Skill frontmatter** must stay exactly `{name, description}` — no extra keys.
- **Commits and pushes need the repository owner's explicit approval, per commit.** A "Commit" step means: stage exactly the listed files, show `git diff --cached --stat` and the proposed message, then **wait**. Do not run `git commit` or `git push` unprompted.
- **Model tiering for dispatch:** the main session (Claude Fable 5.1) owns the loop, dispatch and reviews. Each task below carries a **Model** line — Opus 5 for substantive code, Sonnet 5 for prose/manifest/CI edits.
- **Definition of done for any task:** `cd mcp-server && npm test` green, `npm run typecheck` green, and — from the repo root — `python scripts/generate_skill_index.py && git diff --exit-code -- .claude/skill-index.json`, `python scripts/validate_skills.py`, `node evals/run-static.mjs` all green.

---

## File Structure

New tree (everything under `mcp-server/` is new):

```
mcp-server/
  package.json              private:true; engines.node>=20; scripts build/test/typecheck/update-partner-index
  package-lock.json         pins versions so the committed bundle is reproducible
  tsconfig.json             module node16, strict, outDir build/
  src/
    types.ts                shared domain types (Target, CleanCoreLevel, RawRecord, Match, Successor, Origin)
    config.ts               --data-dir / env / home fallbacks -> ServerConfig
    http.ts                 proxy-aware, timeout-bounded conditional GET (injectable)
    cache.ts                manifest schema, freshness policy (pure) + CacheManager (I/O)
    datasets.ts             target+version -> files, parse, in-memory indexes, memoized registry
    query.ts                lookup, level derivation, successor normalisation, search ranking, suggestions
    target-resolver.ts      §6.4 destinations reader, heuristics, auto-resolution order
    partner-index.ts        §6.5 contents-API listing, built-in fallback, namespace <-> file mapping
    partner-index.json      built-in partner file list (regenerated by `npm run update-partner-index`)
    schemas.ts              Zod input schemas with teaching `.describe()` text
    tools/
      check-objects.ts      §7.1
      search-objects.ts     §7.2
      dataset-info.ts       §7.3
    index.ts                stdio transport, tool registration, startup freshness kick-off
  scripts/
    update-partner-index.mjs  regenerates src/partner-index.json from the GitHub contents API
  test/
    config.test.ts  http.test.ts  cache-policy.test.ts  cache.test.ts  datasets.test.ts
    query-lookup.test.ts  query-search.test.ts  target-resolver.test.ts  partner-index.test.ts
    schemas.test.ts  tools-check-objects.test.ts  tools-search-objects.test.ts  tools-dataset-info.test.ts
    helpers/fixtures.ts       fake HttpClient, fake clock, tiny dataset fixtures
  dist/
    index.js                COMMITTED esbuild bundle — the file the plugin runs
```

Modified existing files:

| File | Change | Task |
|---|---|---|
| `.claude-plugin/plugin.json` | version -> `0.3.0`, `mcpServers` block, description mentions the server | 14 |
| `.gitignore` | add `mcp-server/node_modules/`, `mcp-server/build/` | 1 |
| `.claude/agents/abap-kebap-reviewer.md` | `check_objects` step + fallback sentence | 15 |
| `.claude/agents/abap-kebap-developer.md` | `check_objects` step + fallback sentence | 15 |
| `.claude/agents/abap-kebap-architect.md` | `search_objects` step + fallback sentence | 15 |
| `.claude/skills/abap-cloud-development/SKILL.md` | tools become option 1 + Target resolution procedure | 15 |
| `.claude/skills/abap-code-review/SKILL.md` | cloud-compatibility checklist row points to `check_objects` | 15 |
| `.claude/skills/abap-modernization-playbook/SKILL.md` | "Categorize" step uses `check_objects` successors | 15 |
| `evals/static-checks.json` | 10 new rules (§12.5) | 15 |
| `README.md` | new "Bundled MCP server — released-objects" section | 16 |
| `docs/grounding-protocol.md` | drop the stale no-MCP claim; new preferred source row | 16 |
| `CLAUDE.md` | Done-gate row lists the new gates | 16 |
| `.github/workflows/validate.yml` | `mcp-server` job: `npm ci`, `npm test`, bundle-in-sync, no-root-`.mcp.json` | 16 |

**Two deliberate deviations from the spec's §16 layout, both recorded here so a reviewer does not flag them:**

1. `src/types.ts` is added. The spec's layout implies each module owns its types; a single shared type module keeps `Target`, `CleanCoreLevel` and `RawRecord` identical across nine modules and prevents drift.
2. `cache.ts` holds both the pure freshness policy and the I/O manager (Tasks 3 and 4 both write to it), rather than splitting into two files, because they share the manifest type and always change together.

---

## Task 0: Verification spikes

**Model:** main session (Claude Fable 5.1) — this is fact-finding, not implementation.

Spec §15 lists six assumptions the whole design rests on, plus one this plan adds (CommonJS bundling of the MCP SDK). Confirm them **before** any code is written, and record what you actually observed.

**Files:**
- Create: `docs/superpowers/plans/2026-09-21-released-objects-mcp-spikes.md` (findings)
- Scratch (gitignored, delete afterwards): `_scratch/spike/`

**Interfaces:**
- Consumes: nothing.
- Produces: a findings document. Tasks 1–17 assume every spike passed; each spike names the fallback to apply if it did not.

- [ ] **Step 1: Spike A — does an inline `mcpServers` block auto-start, and do the placeholders expand?**

Write a dependency-free JSON-RPC-over-stdio stub to `_scratch/spike/stub.js`. It proves the plugin starts us and shows exactly what `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` expanded to:

```js
const argv = process.argv.slice(2)
process.stderr.write(`SPIKE ARGV ${JSON.stringify(argv)}\n`)
process.stderr.write(`SPIKE CWD ${process.cwd()}\n`)
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n')
let buf = ''
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'spike', version: '0.0.0' } } })
    } else if (msg.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'spike_argv', description: 'Echo the argv the host passed.', inputSchema: { type: 'object', properties: {} } }] } })
    } else if (msg.method === 'tools/call') {
      send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(argv) }] } })
    } else if (msg.id !== undefined) {
      send({ jsonrpc: '2.0', id: msg.id, result: {} })
    }
  }
})
```

Temporarily add to `.claude-plugin/plugin.json` (reverted in Step 7):

```json
  "mcpServers": {
    "released-objects": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/_scratch/spike/stub.js", "--data-dir", "${CLAUDE_PLUGIN_DATA}/released-objects"]
    }
  }
```

Run `claude --plugin-dir .` in a separate terminal, then `/mcp`. Record: does `released-objects` appear connected without a permission prompt, and does `spike_argv` return an **absolute** data directory (placeholders expanded) or the literal `${CLAUDE_PLUGIN_DATA}` text?

Expected: connected, absolute path. **Fallback if the block is ignored:** move it to a `.mcp.json` at the plugin root and drop the root-`.mcp.json` CI gate. **Fallback if `${CLAUDE_PLUGIN_DATA}` does not expand:** pass the directory through `env` instead of `args`; if it is unavailable entirely, rely on the `~/.abap-kebap/released-objects` home fallback that Task 1 builds anyway.

- [ ] **Step 2: Spike B — ETag and `304` on raw.githubusercontent.com**

```bash
URL=https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/objectReleaseInfo_BTPLatest.json
ETAG=$(curl -sI "$URL" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')
echo "etag=$ETAG"
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ETAG" "$URL"
```

Expected: a non-empty ETag and `304`. **Fallback:** download daily and compare SHA-256 before replacing — the manifest already carries `sha256`, so only the `If-None-Match` header drops out.

- [ ] **Step 3: Spike C — Node floor and the PCE version set**

```bash
node -v
curl -s https://api.github.com/repos/SAP/abap-atc-cr-cv-s4hc/contents/src | grep -o '"name": *"objectReleaseInfo_PCE[^"]*"' | sort
```

Record the exact `objectReleaseInfo_PCE*` file names. They are the ground truth for the `S4CORE` release to year mapping (107 -> 2022, 108 -> 2023, 109 -> 2025) used in Task 8. **Fallback if the mapping cannot be confirmed:** resolve `version` to `latest`, let the user pin it, and say so in the tool description.

- [ ] **Step 4: Spike D — the partner directory listing**

```bash
curl -s https://api.github.com/repos/SAP/abap-atc-cr-cv-s4hc/contents/src/partner | grep -o '"name": *"[^"]*"' | sed 's/.*: *//' | tr -d '"' | sort > _scratch/spike/partner-files.txt
wc -l _scratch/spike/partner-files.txt
```

Record the count and keep the file — Task 9 seeds `src/partner-index.json` from it. Confirm `objectClassifications_NAMESPACE.json` is present (SAP's empty template, skipped by name) and that at least one real file parses with `"formatVersion": "2"` as a **string**.

- [ ] **Step 5: Spike E — the ADT MCP surface**

With the `sapse.adt-vscode` extension running and its MCP server enabled (`adt.mcpServer.enabled`), call `abap_list_destinations`. Record the exact tool name and the exact result shape — ids only, or ids plus URLs and product data? Then check the session folders:

```bash
ls -1dt ~/.adtls/session-* 2>/dev/null | head -5
```

Expected: `abap_list_destinations` takes no input and returns destination ids; one `session-<id>-<hash>` folder per logged-on destination, newest first. **Fallback if it also returns URLs or software components:** feed them into `system` for high confidence and say so in the skill text (Task 15). **Fallback if the name differs:** update the skill text and the `cloud-skill-resolves-target-via-adt-mcp` static rule to the real name. **Fallback if no session folders exist:** drop step 2 of the `auto` resolution order in Task 8; the other three sources stand.

- [ ] **Step 6: Spike F — CommonJS bundling of the MCP SDK on Node 20**

In `_scratch/spike/bundle/`, `npm init -y`, install `@modelcontextprotocol/sdk zod undici` plus `-D esbuild`, and write `entry.js`:

```js
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { EnvHttpProxyAgent } = require('undici')
const { z } = require('zod')
process.stderr.write('SPIKE bundle ok: ' + [typeof McpServer, typeof StdioServerTransport, typeof EnvHttpProxyAgent, typeof z.object].join(',') + '\n')
```

Then:

```bash
npx esbuild entry.js --bundle --platform=node --target=node20 --format=cjs --outfile=out.js && node out.js
```

Expected: `SPIKE bundle ok: function,function,function,function`. **Fallback if the SDK refuses CommonJS:** set `"type": "module"` in `mcp-server/package.json`, tsconfig `"module": "node16"` with `.js` extensions on relative imports, esbuild `--format=esm`, and replace `src/partner-index.json` with a generated `src/partner-index-builtin.ts` — ESM cannot import JSON on Node 20 without import attributes. Record which variant won; every later task's import style follows this decision.

- [ ] **Step 7: Write the findings and clean up**

Create `docs/superpowers/plans/2026-09-21-released-objects-mcp-spikes.md` with one row per spike: assumption, command run, observed result, PASS or FAIL, and the fallback adopted on FAIL. Then:

```bash
git checkout -- .claude-plugin/plugin.json
rm -rf _scratch/spike
```

- [ ] **Step 8: Stop and report**

Report the findings to the repository owner before Task 1 begins. Any FAIL changes later tasks — apply the named fallback and note the affected task numbers. Nothing to commit: `_scratch/` is gitignored and the spike document is the deliverable.

---

## Task 1: Scaffold `mcp-server/` and build `config.ts`

**Model:** Opus 5.

**Files:**
- Create: `mcp-server/package.json`, `mcp-server/tsconfig.json`, `mcp-server/src/types.ts`, `mcp-server/src/config.ts`
- Create: `mcp-server/test/config.test.ts`
- Modify: `.gitignore` (append two lines)

**Interfaces:**
- Consumes: nothing.
- Produces: `Target`, `CleanCoreLevel`, `MaxLevel`, `RawRecord`, `Successor`, `Origin`, `Match`, `ALL_TARGETS` (from `types.ts`); `loadConfig(argv, env, home?) => ServerConfig`, `ServerConfig`, `DEFAULT_BASE_URL`, `DEFAULT_GITHUB_API`, `SERVER_VERSION`, `SOURCE_REPO` (from `config.ts`). Every later task imports from these two modules.

- [ ] **Step 1: Create the package and install the dependency set**

```bash
mkdir -p mcp-server/src/tools mcp-server/scripts mcp-server/test/helpers mcp-server/dist
cd mcp-server
npm init -y
npm install --save-exact @modelcontextprotocol/sdk zod undici
npm install --save-exact --save-dev typescript esbuild @types/node
```

Then replace the generated `mcp-server/package.json` with the block below, **keeping the exact versions `npm install --save-exact` just resolved** in `dependencies` and `devDependencies`. Do not hand-write version numbers; `package-lock.json` pins them and CI runs `npm ci`.

```json
{
  "name": "abap-kebap-released-objects",
  "version": "0.3.0",
  "private": true,
  "description": "Bundled MCP server exposing SAP's Cloudification Repository (released APIs and Clean Core classifications) to the abap-kebap agents.",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "tsc -p tsconfig.json && node --test build/test",
    "build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist/index.js --legal-comments=none",
    "update-partner-index": "node scripts/update-partner-index.mjs"
  }
}
```

Create `mcp-server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "node16",
    "moduleResolution": "node16",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "build",
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Append to the repository-root `.gitignore`, under the existing "Local-only working folders" block:

```
# MCP server build artifacts (dist/index.js IS committed)
mcp-server/node_modules/
mcp-server/build/
```

- [ ] **Step 2: Write the shared domain types**

`mcp-server/src/types.ts`:

```ts
/** The three products the Cloudification Repository covers (spec 6.1). */
export type Target = 'cloud-erp' | 'cloud-erp-private' | 'btp-abap-environment'

/** Clean Core Level (spec 2.4). `none` = no level applies: blocked on public cloud and BTP. */
export type CleanCoreLevel = 'A' | 'B' | 'C' | 'D' | 'none'
export type MaxLevel = 'A' | 'B' | 'C' | 'D'

/** Where a classification came from: SAP's own file, or a partner namespace file (spec 6.5). */
export type Origin = 'sap' | `partner:${string}`

/** One row of objectReleaseInfo[] / objectClassifications[] exactly as SAP ships it. */
export interface RawRecord {
  tadirObject: string
  tadirObjName: string
  objectType: string
  objectKey: string
  softwareComponent?: string
  applicationComponent?: string
  state: string
  successorClassification?: string
  successors?: { tadirObject?: string; tadirObjName?: string; objectType: string; objectKey: string }[]
  successorConceptName?: string
  labels?: string[]
}

/** Normalised successor (spec 6.3): one hop, object or concept. */
export type Successor =
  | { kind: 'object'; objectType: string; objectKey: string }
  | { kind: 'concept'; name: string }

/** One concrete object that matched a lookup, with both raw facts and the derived level. */
export interface Match {
  objectType: string
  objectKey: string
  tadirObject: string
  tadirObjName: string
  softwareComponent: string | null
  applicationComponent: string | null
  releaseState: string | null
  classification: string | null
  origin: Origin
  cleanCoreLevel: CleanCoreLevel
  allowed: boolean
  deprecated: boolean
  successors: Successor[]
  successorClassification: string | null
  labels: string[]
}

export const ALL_TARGETS: Target[] = ['cloud-erp', 'cloud-erp-private', 'btp-abap-environment']
```

- [ ] **Step 3: Write the failing test for `loadConfig`**

`mcp-server/test/config.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { loadConfig, DEFAULT_BASE_URL } from '../src/config'

const HOME = process.platform === 'win32' ? 'C:\\Users\\tester' : '/home/tester'

test('--data-dir wins over the environment and the home fallback', () => {
  const dir = join(HOME, 'plugin-data', 'released-objects')
  const cfg = loadConfig(['--data-dir', dir], { ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: join(HOME, 'other') }, HOME)
  assert.equal(cfg.dataDir, dir)
})

test('an unexpanded placeholder never becomes a literal directory', () => {
  const cfg = loadConfig(['--data-dir', '${CLAUDE_PLUGIN_DATA}/released-objects'], {}, HOME)
  assert.equal(cfg.dataDir, join(HOME, '.abap-kebap', 'released-objects'))
  assert.equal(cfg.warnings.length, 1)
})

test('with no argument and no environment it falls back to the home directory', () => {
  const cfg = loadConfig([], {}, HOME)
  assert.equal(cfg.dataDir, join(HOME, '.abap-kebap', 'released-objects'))
  assert.equal(cfg.baseUrl, DEFAULT_BASE_URL)
  assert.equal(cfg.targetPin, null)
  assert.equal(cfg.verbose, false)
})

test('a mirror base URL is accepted and its trailing slashes stripped', () => {
  const cfg = loadConfig([], { ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL: 'https://mirror.example.com/atc/src//' }, HOME)
  assert.equal(cfg.baseUrl, 'https://mirror.example.com/atc/src')
})

test('a non-http base URL is rejected with a warning, not adopted', () => {
  const cfg = loadConfig([], { ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL: 'file:///etc/passwd' }, HOME)
  assert.equal(cfg.baseUrl, DEFAULT_BASE_URL)
  assert.match(cfg.warnings.join(' '), /BASE_URL/)
})

test('the target pin accepts the three targets and warns on anything else', () => {
  assert.equal(loadConfig([], { ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'cloud-erp-private' }, HOME).targetPin, 'cloud-erp-private')
  const bad = loadConfig([], { ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'on-prem' }, HOME)
  assert.equal(bad.targetPin, null)
  assert.match(bad.warnings.join(' '), /on-prem/)
})

test('ADT paths default under the state directory and are individually overridable', () => {
  const dflt = loadConfig([], {}, HOME)
  assert.equal(dflt.adtStateDir, join(HOME, '.adtls'))
  assert.equal(dflt.adtDestinationsPath, join(HOME, '.adtls', 'destinations.json'))
  const custom = loadConfig([], { ABAP_KEBAP_ADT_DESTINATIONS_PATH: join(HOME, 'alt.json') }, HOME)
  assert.equal(custom.adtDestinationsPath, join(HOME, 'alt.json'))
})

test('--verbose is recognised', () => {
  assert.equal(loadConfig(['--verbose'], {}, HOME).verbose, true)
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/config'`.

- [ ] **Step 5: Write `config.ts`**

`mcp-server/src/config.ts`:

```ts
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { ALL_TARGETS, type Target } from './types'

export const SERVER_VERSION = '0.3.0'
export const DEFAULT_BASE_URL = 'https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src'
export const DEFAULT_GITHUB_API = 'https://api.github.com'
export const SOURCE_REPO = 'https://github.com/SAP/abap-atc-cr-cv-s4hc'

export interface ServerConfig {
  dataDir: string
  baseUrl: string
  githubApiBaseUrl: string
  targetPin: Target | null
  adtDestinationsPath: string
  adtStateDir: string
  verbose: boolean
  userAgent: string
  /** Non-fatal configuration complaints; the server logs them to stderr at startup. */
  warnings: string[]
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1]
  const inline = argv.find((entry) => entry.startsWith(`${flag}=`))
  return inline ? inline.slice(flag.length + 1) : undefined
}

/** A placeholder the host failed to expand must never become a literal directory name. */
function usableDir(dir: string | undefined): dir is string {
  return !!dir && dir.trim() !== '' && !dir.includes('${') && isAbsolute(dir)
}

export function loadConfig(argv: string[], env: NodeJS.ProcessEnv, home: string = homedir()): ServerConfig {
  const warnings: string[] = []

  const fromArg = argValue(argv, '--data-dir')
  const fromEnv = env.ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR
  let dataDir: string
  if (usableDir(fromArg)) {
    dataDir = fromArg
  } else if (usableDir(fromEnv)) {
    dataDir = fromEnv
  } else {
    dataDir = join(home, '.abap-kebap', 'released-objects')
    if (fromArg || fromEnv) {
      warnings.push(`Unusable data directory "${fromArg ?? fromEnv}" (not absolute, or an unexpanded placeholder); using ${dataDir}`)
    }
  }

  const rawBase = env.ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL?.trim()
  let baseUrl = DEFAULT_BASE_URL
  if (rawBase) {
    if (/^https?:\/\//i.test(rawBase)) baseUrl = rawBase.replace(/\/+$/, '')
    else warnings.push('ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL is not an http(s) URL; using the default SAP repository.')
  }

  const pin = env.ABAP_KEBAP_RELEASED_OBJECTS_TARGET?.trim()
  let targetPin: Target | null = null
  if (pin) {
    if ((ALL_TARGETS as string[]).includes(pin)) targetPin = pin as Target
    else warnings.push(`ABAP_KEBAP_RELEASED_OBJECTS_TARGET="${pin}" is not one of ${ALL_TARGETS.join(', ')}; ignoring it.`)
  }

  const adtStateDir = env.ABAP_KEBAP_ADT_STATE_DIR?.trim() || join(home, '.adtls')
  const adtDestinationsPath = env.ABAP_KEBAP_ADT_DESTINATIONS_PATH?.trim() || join(adtStateDir, 'destinations.json')

  return {
    dataDir,
    baseUrl,
    githubApiBaseUrl: DEFAULT_GITHUB_API,
    targetPin,
    adtDestinationsPath,
    adtStateDir,
    verbose: argv.includes('--verbose'),
    userAgent: `abap-kebap-released-objects/${SERVER_VERSION}`,
    warnings,
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — 8 tests, 0 failures.

- [ ] **Step 7: Commit (stage, show, wait for approval)**

```bash
git add mcp-server/package.json mcp-server/package-lock.json mcp-server/tsconfig.json mcp-server/src/types.ts mcp-server/src/config.ts mcp-server/test/config.test.ts .gitignore
git diff --cached --stat
```

Proposed message: `feat(mcp): scaffold the released-objects server with config resolution`

---

## Task 2: `http.ts` — proxy-aware conditional GET, plus the shared test fixtures

**Model:** Opus 5.

Spec 9. Node's built-in `fetch` ignores `HTTPS_PROXY`, which breaks every proxied corporate network; undici's `EnvHttpProxyAgent` fixes it. The client is an interface so every later test injects a fake and stays offline.

**Files:**
- Create: `mcp-server/src/http.ts`, `mcp-server/test/helpers/fixtures.ts`, `mcp-server/test/http.test.ts`

**Interfaces:**
- Consumes: nothing (the user-agent string is passed in).
- Produces: `HttpClient` (`get(url, options?) => Promise<HttpResponse>`), `HttpResponse` (`{status, headers, body}`), `HttpGetOptions` (`{etag?, timeoutMs?, accept?}`), `createHttpClient(userAgent)`, `HEADER_TIMEOUT_MS`, `DOWNLOAD_TIMEOUT_MS`. Test helpers: `fakeHttp(routes)`, `jsonResponse(payload, etag?)`, `notModified(etag?)`, `unreachable(message?)`, `fakeClock(iso)`.

- [ ] **Step 1: Write the failing test**

`mcp-server/test/http.test.ts` — a real loopback server, so no traffic leaves the machine:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server, type RequestListener } from 'node:http'
import { createHttpClient } from '../src/http'

async function listen(handler: RequestListener): Promise<{ server: Server; base: string }> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('no port assigned')
  return { server, base: `http://127.0.0.1:${address.port}` }
}

test('a plain GET returns status, lower-cased headers and the body', async () => {
  const { server, base } = await listen((_req, res) => {
    res.setHeader('ETag', '"abc"')
    res.setHeader('Content-Type', 'application/json')
    res.end('{"ok":true}')
  })
  try {
    const response = await createHttpClient('test-agent/1').get(`${base}/file.json`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.etag, '"abc"')
    assert.equal(response.body, '{"ok":true}')
  } finally {
    server.close()
  }
})

test('an etag is sent as If-None-Match and a 304 yields a null body', async () => {
  let seen: string | undefined
  const { server, base } = await listen((req, res) => {
    seen = req.headers['if-none-match'] as string | undefined
    res.statusCode = 304
    res.end()
  })
  try {
    const response = await createHttpClient('test-agent/1').get(`${base}/file.json`, { etag: '"abc"' })
    assert.equal(seen, '"abc"')
    assert.equal(response.status, 304)
    assert.equal(response.body, null)
  } finally {
    server.close()
  }
})

test('the user agent is sent on every request', async () => {
  let seen: string | undefined
  const { server, base } = await listen((req, res) => {
    seen = req.headers['user-agent'] as string | undefined
    res.end('{}')
  })
  try {
    await createHttpClient('abap-kebap-released-objects/0.3.0').get(`${base}/x`)
    assert.equal(seen, 'abap-kebap-released-objects/0.3.0')
  } finally {
    server.close()
  }
})

test('a request that exceeds its timeout rejects instead of hanging', async () => {
  const { server, base } = await listen(() => {
    // deliberately never respond
  })
  try {
    await assert.rejects(() => createHttpClient('test-agent/1').get(`${base}/slow`, { timeoutMs: 120 }))
  } finally {
    server.close()
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/http'`.

- [ ] **Step 3: Write `http.ts`**

```ts
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici'

/** 15 s is enough for a conditional check; a full download gets the longer budget. */
export const HEADER_TIMEOUT_MS = 15_000
export const DOWNLOAD_TIMEOUT_MS = 120_000

export interface HttpResponse {
  status: number
  /** Lower-cased header names. */
  headers: Record<string, string>
  /** `null` for 304 and 204 — there is no body to read. */
  body: string | null
}

export interface HttpGetOptions {
  etag?: string | null
  timeoutMs?: number
  accept?: string
}

export interface HttpClient {
  get(url: string, options?: HttpGetOptions): Promise<HttpResponse>
}

/**
 * HTTPS GET honouring HTTPS_PROXY / HTTP_PROXY / NO_PROXY. Node's global fetch ignores
 * those variables, which fails on every proxied corporate network. TLS-inspecting proxies
 * additionally need NODE_EXTRA_CA_CERTS, which the README documents.
 */
export function createHttpClient(userAgent: string): HttpClient {
  const dispatcher = new EnvHttpProxyAgent()
  return {
    async get(url, options = {}) {
      const headers: Record<string, string> = {
        'user-agent': userAgent,
        accept: options.accept ?? 'application/json',
      }
      if (options.etag) headers['if-none-match'] = options.etag

      const response = await undiciFetch(url, {
        method: 'GET',
        headers,
        dispatcher,
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS),
      })

      const collected: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        collected[key.toLowerCase()] = value
      })

      const body = response.status === 304 || response.status === 204 ? null : await response.text()
      return { status: response.status, headers: collected, body }
    },
  }
}
```

- [ ] **Step 4: Write the shared test fixtures**

`mcp-server/test/helpers/fixtures.ts`:

```ts
import type { HttpClient, HttpGetOptions, HttpResponse } from '../../src/http'

export interface RecordedCall {
  url: string
  options: HttpGetOptions
}

export type Route = HttpResponse | ((options: HttpGetOptions, url: string) => HttpResponse | Promise<HttpResponse>)

export interface FakeHttp extends HttpClient {
  calls: RecordedCall[]
  /** Replace a route mid-test, e.g. to simulate upstream changing overnight. */
  setRoute(urlSuffix: string, route: Route): void
}

/** Routes match by URL suffix, so tests can key on `objectReleaseInfoLatest.json`. */
export function fakeHttp(routes: Record<string, Route>): FakeHttp {
  const table = new Map<string, Route>(Object.entries(routes))
  const calls: RecordedCall[] = []
  return {
    calls,
    setRoute(urlSuffix, route) {
      table.set(urlSuffix, route)
    },
    async get(url, options = {}) {
      calls.push({ url, options })
      for (const [suffix, route] of table) {
        if (url.endsWith(suffix) || url.includes(suffix)) {
          return typeof route === 'function' ? route(options, url) : route
        }
      }
      return { status: 404, headers: {}, body: 'not found' }
    },
  }
}

export function jsonResponse(payload: unknown, etag = '"v1"'): HttpResponse {
  return { status: 200, headers: { etag }, body: JSON.stringify(payload) }
}

export function notModified(etag = '"v1"'): HttpResponse {
  return { status: 304, headers: { etag }, body: null }
}

/** A route that behaves like an unreachable host. */
export function unreachable(message = 'fetch failed'): Route {
  return () => {
    throw new Error(message)
  }
}

export interface FakeClock {
  now: () => Date
  advanceMs(ms: number): void
  advanceDays(days: number): void
  set(iso: string): void
}

export function fakeClock(iso: string): FakeClock {
  let current = new Date(iso).getTime()
  return {
    now: () => new Date(current),
    advanceMs(ms) {
      current += ms
    },
    advanceDays(days) {
      current += days * 24 * 60 * 60 * 1000
    },
    set(next) {
      current = new Date(next).getTime()
    },
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — 12 tests total (8 from Task 1, 4 here), 0 failures.

- [ ] **Step 6: Commit (stage, show, wait for approval)**

```bash
git add mcp-server/src/http.ts mcp-server/test/http.test.ts mcp-server/test/helpers/fixtures.ts
git diff --cached --stat
```

Proposed message: `feat(mcp): add a proxy-aware conditional HTTP client`

---

## Task 3: `cache.ts` part 1 — manifest and freshness policy (pure)

**Model:** Opus 5.

Spec 8. Everything here is a pure function over data, so the whole daily-gate, backoff and truncation-guard matrix is testable without a disk or a socket.

**Files:**
- Create: `mcp-server/src/cache.ts` (policy half only — Task 4 appends the manager to the same file)
- Create: `mcp-server/test/cache-policy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SCHEMA_VERSION`, `BACKOFF_MS`, `TRUNCATION_FLOOR`, `TRUNCATION_MIN_ENTRIES`, `Manifest`, `ManifestFileEntry`, `PartnerIndexState`, `emptyManifest()`, `parseManifest(text)`, `localDateKey(date)`, `shouldCheck(manifest, now, force?)`, `validatePayload(text, arrayKey, previousEntries)`, `sha256(text)`, `ValidationResult`.

- [ ] **Step 1: Write the failing test**

`mcp-server/test/cache-policy.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyManifest, localDateKey, parseManifest, shouldCheck, validatePayload, sha256, SCHEMA_VERSION } from '../src/cache'

const releaseInfo = (entries: number) =>
  JSON.stringify({
    formatVersion: 1,
    objectReleaseInfo: Array.from({ length: entries }, (_unused, index) => ({
      tadirObject: 'CLAS',
      tadirObjName: `CL_${index}`,
      objectType: 'CLAS',
      objectKey: `CL_${index}`,
      state: 'released',
    })),
  })

test('a manifest with no lastCheckedAt always wants a check', () => {
  assert.equal(shouldCheck(emptyManifest(), new Date('2026-09-21T08:00:00Z')), true)
})

test('a second call on the same local day does not check again', () => {
  const manifest = emptyManifest()
  manifest.lastCheckedAt = '2026-09-21T06:00:00+03:00'
  assert.equal(shouldCheck(manifest, new Date('2026-09-21T20:00:00+03:00')), false)
})

test('the first call after local midnight checks again', () => {
  const manifest = emptyManifest()
  manifest.lastCheckedAt = '2026-09-21T23:30:00+03:00'
  assert.equal(shouldCheck(manifest, new Date('2026-09-22T00:10:00+03:00')), true)
})

test('a one-hour backoff suppresses checks even on a brand-new manifest', () => {
  const manifest = emptyManifest()
  manifest.lastCheckError = 'fetch failed'
  manifest.nextCheckAt = '2026-09-21T09:00:00Z'
  assert.equal(shouldCheck(manifest, new Date('2026-09-21T08:30:00Z')), false)
  assert.equal(shouldCheck(manifest, new Date('2026-09-21T09:30:00Z')), true)
})

test('force bypasses both the daily gate and the backoff', () => {
  const manifest = emptyManifest()
  manifest.lastCheckedAt = '2026-09-21T06:00:00+03:00'
  manifest.nextCheckAt = '2099-01-01T00:00:00Z'
  assert.equal(shouldCheck(manifest, new Date('2026-09-21T07:00:00+03:00'), true), true)
})

test('localDateKey uses local components, not UTC', () => {
  assert.equal(localDateKey(new Date(2026, 8, 21, 1, 30)), '2026-09-21')
})

test('a valid payload reports its entry count', () => {
  assert.deepEqual(validatePayload(releaseInfo(120), 'objectReleaseInfo', null), { ok: true, entries: 120 })
})

test('a string formatVersion is accepted - partner files ship "2"', () => {
  const text = JSON.stringify({ formatVersion: '2', objectClassifications: [{ objectKey: 'X', state: 'classicAPI' }] })
  assert.equal(validatePayload(text, 'objectClassifications', null).ok, true)
})

test('unparsable, empty, key-less and version-less payloads are all rejected with a reason', () => {
  const cases: [string, string][] = [
    ['{ not json', 'objectReleaseInfo'],
    [JSON.stringify({ formatVersion: 1, objectReleaseInfo: [] }), 'objectReleaseInfo'],
    [JSON.stringify({ formatVersion: 1, other: [1] }), 'objectReleaseInfo'],
    [JSON.stringify({ objectReleaseInfo: [1] }), 'objectReleaseInfo'],
  ]
  for (const [text, key] of cases) {
    const result = validatePayload(text, key, null)
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.reason.length > 0)
  }
})

test('the truncation guard rejects a file that lost more than half its rows', () => {
  assert.equal(validatePayload(releaseInfo(40), 'objectReleaseInfo', 1000).ok, false)
})

test('the truncation guard is off below 100 previous entries - small partner files may shrink', () => {
  assert.equal(validatePayload(releaseInfo(3), 'objectReleaseInfo', 90).ok, true)
})

test('a corrupt or foreign-schema manifest degrades to an empty one instead of throwing', () => {
  assert.deepEqual(parseManifest('{ broken'), emptyManifest())
  assert.deepEqual(parseManifest(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, files: { a: {} } })), emptyManifest())
})

test('a well-formed manifest round-trips', () => {
  const manifest = emptyManifest()
  manifest.lastCheckedAt = '2026-09-21T06:00:00+03:00'
  assert.deepEqual(parseManifest(JSON.stringify(manifest)), manifest)
})

test('sha256 is stable and content-sensitive', () => {
  assert.equal(sha256('abc'), sha256('abc'))
  assert.notEqual(sha256('abc'), sha256('abd'))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/cache'`.

- [ ] **Step 3: Write the policy half of `cache.ts`**

```ts
import { createHash } from 'node:crypto'

export const SCHEMA_VERSION = 1
/** After a network or HTTP failure, wait an hour before trying again (spec 8). */
export const BACKOFF_MS = 60 * 60 * 1000
/** A file that suddenly loses more than half its rows is treated as truncated. */
export const TRUNCATION_FLOOR = 0.5
/** Below this many previous entries the guard is off - small partner files legitimately shrink. */
export const TRUNCATION_MIN_ENTRIES = 100

export interface ManifestFileEntry {
  url: string
  etag: string | null
  sha256: string
  bytes: number
  entries: number
  downloadedAt: string
  upstreamCommittedAt: string | null
  lastError: string | null
}

export interface PartnerIndexState {
  indexSource: 'github-api' | 'built-in'
  indexedAt: string | null
  files: { fileName: string; namespace: string; sha: string | null }[]
}

export interface Manifest {
  schemaVersion: number
  lastCheckedAt: string | null
  nextCheckAt: string | null
  lastCheckError: string | null
  partnerIndex: PartnerIndexState | null
  files: Record<string, ManifestFileEntry>
}

export function emptyManifest(): Manifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    lastCheckedAt: null,
    nextCheckAt: null,
    lastCheckError: null,
    partnerIndex: null,
    files: {},
  }
}

/** A schemaVersion bump or a corrupt file means: throw the cache away and bootstrap. */
export function parseManifest(text: string): Manifest {
  try {
    const parsed = JSON.parse(text) as Partial<Manifest> | null
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || typeof parsed.files !== 'object' || parsed.files === null) {
      return emptyManifest()
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      lastCheckedAt: parsed.lastCheckedAt ?? null,
      nextCheckAt: parsed.nextCheckAt ?? null,
      lastCheckError: parsed.lastCheckError ?? null,
      partnerIndex: parsed.partnerIndex ?? null,
      files: parsed.files as Record<string, ManifestFileEntry>,
    }
  } catch {
    return emptyManifest()
  }
}

/** YYYY-MM-DD in the machine's local time - "first run of the day" is the user's day. */
export function localDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function shouldCheck(manifest: Manifest, now: Date, force = false): boolean {
  if (force) return true
  if (manifest.nextCheckAt && Date.parse(manifest.nextCheckAt) > now.getTime()) return false
  if (!manifest.lastCheckedAt) return true
  return localDateKey(new Date(manifest.lastCheckedAt)) !== localDateKey(now)
}

export type ValidationResult = { ok: true; entries: number } | { ok: false; reason: string }

/** Guard a download before it is allowed to replace a good file (spec 8). */
export function validatePayload(text: string, arrayKey: string, previousEntries: number | null): ValidationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, reason: `payload is not valid JSON: ${(error as Error).message}` }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: 'payload is not a JSON object' }

  const document = parsed as Record<string, unknown>
  const formatVersion = document.formatVersion
  if (typeof formatVersion !== 'number' && typeof formatVersion !== 'string') {
    return { ok: false, reason: 'formatVersion is missing (SAP files carry a number, partner files the string "2")' }
  }

  const rows = document[arrayKey]
  if (!Array.isArray(rows)) return { ok: false, reason: `"${arrayKey}" is missing or not an array` }
  if (rows.length === 0) return { ok: false, reason: `"${arrayKey}" is empty` }

  if (previousEntries !== null && previousEntries >= TRUNCATION_MIN_ENTRIES && rows.length < previousEntries * TRUNCATION_FLOOR) {
    return { ok: false, reason: `truncation guard: ${rows.length} entries is below half of the previous ${previousEntries}` }
  }
  return { ok: true, entries: rows.length }
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — 26 tests total, 0 failures.

- [ ] **Step 5: Commit (stage, show, wait for approval)**

```bash
git add mcp-server/src/cache.ts mcp-server/test/cache-policy.test.ts
git diff --cached --stat
```

Proposed message: `feat(mcp): add the cache manifest and freshness policy`

---

## Task 4: `cache.ts` part 2 — `CacheManager` (download, validate, atomic swap)

**Model:** Opus 5.

Spec 8. This is the only module that writes to disk. Tests inject `fakeHttp` and `fakeClock` from Task 2 and run against a real temporary directory, so the atomic-rename path is genuinely exercised and no network is touched.

**Files:**
- Modify: `mcp-server/src/cache.ts` (append the manager below the policy functions)
- Create: `mcp-server/test/cache.test.ts`

**Interfaces:**
- Consumes: `HttpClient`, `HEADER_TIMEOUT_MS`, `DOWNLOAD_TIMEOUT_MS` (Task 2); the policy functions of Task 3.
- Produces: `FileSpec` (`{id, fileName, arrayKey, optional}`), `GithubApi` (`{baseUrl, repo}`), `CacheOptions`, `FileStatus`, `CacheError` (`{code, retryAfterSeconds?}`), and `CacheManager` with `localPath(spec)`, `readManifest()`, `status(id)`, `offline`, `ensureFile(spec, timeoutMs?)`, `refresh(specs, force?)`, `ensureFresh(specs)`, `subscribe(listener)`.

- [ ] **Step 1: Write the failing test**

`mcp-server/test/cache.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CacheManager, CacheError, type FileSpec } from '../src/cache'
import { fakeClock, fakeHttp, jsonResponse, notModified, unreachable } from './helpers/fixtures'

const BASE = 'https://raw.example.invalid/src'

const CORE: FileSpec = { id: 'btp/latest', fileName: 'objectReleaseInfo_BTPLatest.json', arrayKey: 'objectReleaseInfo', optional: false }
const PARTNER: FileSpec = { id: 'partner//OTX/', fileName: 'partner/objectClassifications_OTX.json', arrayKey: 'objectClassifications', optional: true }

const payload = (count: number, state = 'released') => ({
  formatVersion: 1,
  objectReleaseInfo: Array.from({ length: count }, (_unused, index) => ({
    tadirObject: 'CLAS', tadirObjName: `CL_${index}`, objectType: 'CLAS', objectKey: `CL_${index}`, state,
  })),
})

async function makeCache(routes: Parameters<typeof fakeHttp>[0], iso = '2026-09-21T09:00:00+03:00') {
  const dataDir = await mkdtemp(join(tmpdir(), 'abap-kebap-cache-'))
  const http = fakeHttp(routes)
  const clock = fakeClock(iso)
  const logs: string[] = []
  const cache = new CacheManager({
    dataDir, baseUrl: BASE, githubApi: null, http, now: clock.now, log: (message) => logs.push(message),
  })
  return { cache, http, clock, dataDir, logs }
}

test('a cold start downloads the file, writes the manifest and reports ready', async () => {
  const { cache, dataDir } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200), '"e1"') })
  await cache.refresh([CORE])
  assert.equal(cache.status(CORE.id), 'ready')
  assert.ok(existsSync(join(dataDir, 'objectReleaseInfo_BTPLatest.json')))
  const manifest = cache.readManifest()
  assert.equal(manifest.files[CORE.id]?.entries, 200)
  assert.equal(manifest.files[CORE.id]?.etag, '"e1"')
  assert.ok(manifest.lastCheckedAt)
})

test('a second refresh the same local day makes no HTTP call at all', async () => {
  const { cache, http } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200)) })
  await cache.refresh([CORE])
  const afterBootstrap = http.calls.length
  await cache.refresh([CORE])
  assert.equal(http.calls.length, afterBootstrap)
})

test('the next day sends If-None-Match; a 304 touches only lastCheckedAt', async () => {
  const { cache, http, clock, dataDir } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200), '"e1"') })
  await cache.refresh([CORE])
  const before = await readFile(join(dataDir, 'objectReleaseInfo_BTPLatest.json'), 'utf8')
  const downloadedAt = cache.readManifest().files[CORE.id]?.downloadedAt

  http.setRoute('objectReleaseInfo_BTPLatest.json', notModified('"e1"'))
  clock.advanceDays(1)
  await cache.refresh([CORE])

  assert.equal(http.calls.at(-1)?.options.etag, '"e1"')
  assert.equal(await readFile(join(dataDir, 'objectReleaseInfo_BTPLatest.json'), 'utf8'), before)
  assert.equal(cache.readManifest().files[CORE.id]?.downloadedAt, downloadedAt)
})

test('a changed file is swapped atomically and subscribers are notified', async () => {
  const { cache, http, clock } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200), '"e1"') })
  await cache.refresh([CORE])
  const reloaded: string[] = []
  cache.subscribe((id) => reloaded.push(id))

  http.setRoute('objectReleaseInfo_BTPLatest.json', jsonResponse(payload(300), '"e2"'))
  clock.advanceDays(1)
  await cache.refresh([CORE])

  assert.deepEqual(reloaded, [CORE.id])
  assert.equal(cache.readManifest().files[CORE.id]?.entries, 300)
  assert.equal(cache.readManifest().files[CORE.id]?.etag, '"e2"')
})

test('a truncated payload keeps the old file and records stale-error', async () => {
  const { cache, http, clock, dataDir } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(1000), '"e1"') })
  await cache.refresh([CORE])

  http.setRoute('objectReleaseInfo_BTPLatest.json', jsonResponse(payload(10), '"e2"'))
  clock.advanceDays(1)
  await cache.refresh([CORE])

  assert.equal(cache.status(CORE.id), 'stale-error')
  assert.equal(cache.readManifest().files[CORE.id]?.entries, 1000)
  assert.match(cache.readManifest().files[CORE.id]?.lastError ?? '', /truncation/)
  assert.ok(existsSync(join(dataDir, 'objectReleaseInfo_BTPLatest.json')))
})

test('a network error sets a one-hour backoff, flips offline and still serves the cache', async () => {
  const { cache, http, clock } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200), '"e1"') })
  await cache.refresh([CORE])

  http.setRoute('objectReleaseInfo_BTPLatest.json', unreachable())
  clock.advanceDays(1)
  await cache.refresh([CORE])

  assert.equal(cache.offline, true)
  assert.ok(cache.readManifest().lastCheckError)
  assert.equal(cache.status(CORE.id), 'ready')

  const callsAfterFailure = http.calls.length
  clock.advanceMs(30 * 60 * 1000)
  await cache.refresh([CORE])
  assert.equal(http.calls.length, callsAfterFailure, 'still inside the backoff window')
  clock.advanceMs(31 * 60 * 1000)
  await cache.refresh([CORE])
  assert.ok(http.calls.length > callsAfterFailure, 'retries once the backoff expires')
})

test('force refresh bypasses both the daily gate and the backoff', async () => {
  const { cache, http } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200)) })
  await cache.refresh([CORE])
  const before = http.calls.length
  await cache.refresh([CORE], true)
  assert.ok(http.calls.length > before)
})

test('a schemaVersion mismatch re-bootstraps instead of trusting stale entries', async () => {
  const { cache, dataDir, http } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200)) })
  await writeFile(join(dataDir, 'manifest.json'), JSON.stringify({ schemaVersion: 99, files: { 'btp/latest': { entries: 5 } } }), 'utf8')
  await cache.refresh([CORE])
  assert.equal(cache.readManifest().files[CORE.id]?.entries, 200)
  assert.ok(http.calls.length > 0)
})

test('an optional partner file failing never stops a core file from becoming ready', async () => {
  const { cache } = await makeCache({
    'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200)),
    'partner/objectClassifications_OTX.json': unreachable('403 rate limited'),
  })
  await cache.refresh([CORE, PARTNER])
  assert.equal(cache.status(CORE.id), 'ready')
  assert.equal(cache.status(PARTNER.id), 'missing')
})

test('ensureFile on a missing file with no network raises DATASET_UNAVAILABLE', async () => {
  const { cache } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': unreachable() })
  await assert.rejects(
    () => cache.ensureFile(CORE, 200),
    (error: unknown) => error instanceof CacheError && error.code === 'DATASET_UNAVAILABLE',
  )
})

test('ensureFile returns the path when the file is already on disk', async () => {
  const { cache, dataDir } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200)) })
  await cache.refresh([CORE])
  assert.equal(await cache.ensureFile(CORE, 200), join(dataDir, 'objectReleaseInfo_BTPLatest.json'))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `CacheManager is not exported from '../src/cache'`.

- [ ] **Step 3: Append the manager to `cache.ts`**

```ts
import { mkdirSync, existsSync } from 'node:fs'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DOWNLOAD_TIMEOUT_MS, HEADER_TIMEOUT_MS, type HttpClient } from './http'

export interface FileSpec {
  /** Stable manifest key, e.g. `cloud-erp/latest`, `classification/sap`, `partner//OTX/`. */
  id: string
  /** Path under the source `src/` directory, e.g. `partner/objectClassifications_OTX.json`. */
  fileName: string
  arrayKey: 'objectReleaseInfo' | 'objectClassifications'
  /** Optional files (partner sets) never block core readiness and never set the global error. */
  optional: boolean
}

/** Only set when the base URL is SAP's own repository; a mirror gets no API calls. */
export interface GithubApi {
  baseUrl: string
  repo: string
}

export interface CacheOptions {
  dataDir: string
  baseUrl: string
  githubApi: GithubApi | null
  http: HttpClient
  now: () => Date
  log: (message: string) => void
}

export type FileStatus = 'ready' | 'downloading' | 'missing' | 'stale-error'

export class CacheError extends Error {
  constructor(
    readonly code: 'DATASET_DOWNLOADING' | 'DATASET_UNAVAILABLE' | 'UNKNOWN_VERSION',
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'CacheError'
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class CacheManager {
  private manifest: Manifest | null = null
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly listeners: ((id: string) => void)[] = []
  private refreshing: Promise<void> | null = null
  private lastNetworkFailed = false

  constructor(private readonly options: CacheOptions) {
    mkdirSync(options.dataDir, { recursive: true })
  }

  subscribe(listener: (id: string) => void): void {
    this.listeners.push(listener)
  }

  localPath(spec: FileSpec): string {
    return join(this.options.dataDir, ...spec.fileName.split('/'))
  }

  private manifestPath(): string {
    return join(this.options.dataDir, 'manifest.json')
  }

  readManifest(): Manifest {
    if (!this.manifest) {
      try {
        this.manifest = parseManifest(require('node:fs').readFileSync(this.manifestPath(), 'utf8'))
      } catch {
        this.manifest = emptyManifest()
      }
    }
    return this.manifest
  }

  private async saveManifest(): Promise<void> {
    await this.atomicWrite(this.manifestPath(), JSON.stringify(this.readManifest(), null, 2))
  }

  get offline(): boolean {
    return this.lastNetworkFailed
  }

  status(id: string): FileStatus {
    if (this.inFlight.has(id)) return 'downloading'
    const entry = this.readManifest().files[id]
    if (!entry) return 'missing'
    if (entry.lastError) return 'stale-error'
    return 'ready'
  }

  /** Temp file then rename, so a reader never sees a half-written dataset. */
  private async atomicWrite(target: string, text: string): Promise<void> {
    mkdirSync(dirname(target), { recursive: true })
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temp, text, 'utf8')
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(temp, target)
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') {
          await rm(temp, { force: true })
          throw error
        }
        await delay(50 * (attempt + 1))
      }
    }
    await rm(temp, { force: true })
    throw new Error(`could not replace ${target}: the file stayed locked`)
  }

  /** Best-effort upstream commit date; only asked for when the file actually changed. */
  private async commitDate(fileName: string): Promise<string | null> {
    const api = this.options.githubApi
    if (!api) return null
    try {
      const url = `${api.baseUrl}/repos/${api.repo}/commits?path=src/${fileName}&per_page=1`
      const response = await this.options.http.get(url, { timeoutMs: HEADER_TIMEOUT_MS, accept: 'application/vnd.github+json' })
      if (response.status !== 200 || !response.body) return null
      const rows = JSON.parse(response.body) as { commit?: { committer?: { date?: string } } }[]
      return rows[0]?.commit?.committer?.date ?? null
    } catch {
      return null
    }
  }

  private async downloadOne(spec: FileSpec, conditional: boolean): Promise<void> {
    const manifest = this.readManifest()
    const previous = manifest.files[spec.id] ?? null
    const url = `${this.options.baseUrl}/${spec.fileName}`
    const onDisk = existsSync(this.localPath(spec))

    const response = await this.options.http.get(url, {
      etag: conditional && previous && onDisk ? previous.etag : null,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
    })

    if (response.status === 304 && previous && onDisk) {
      previous.lastError = null
      return
    }
    if (response.status === 404) {
      throw new CacheError('UNKNOWN_VERSION', `${spec.fileName} does not exist upstream`)
    }
    if (response.status !== 200 || response.body === null) {
      throw new Error(`HTTP ${response.status} for ${spec.fileName}`)
    }

    const validation = validatePayload(response.body, spec.arrayKey, previous?.entries ?? null)
    if (!validation.ok) {
      if (previous) {
        previous.lastError = validation.reason
        this.options.log(`kept the cached ${spec.fileName}: ${validation.reason}`)
        return
      }
      throw new Error(`${spec.fileName} failed validation: ${validation.reason}`)
    }

    await this.atomicWrite(this.localPath(spec), response.body)
    const now = this.options.now()
    manifest.files[spec.id] = {
      url,
      etag: response.headers.etag ?? null,
      sha256: sha256(response.body),
      bytes: Buffer.byteLength(response.body, 'utf8'),
      entries: validation.entries,
      downloadedAt: now.toISOString(),
      upstreamCommittedAt: await this.commitDate(spec.fileName),
      lastError: null,
    }
    for (const listener of this.listeners) listener(spec.id)
  }

  /**
   * Run the daily gate over `specs`. Optional files never set the global error, so a
   * rate-limited partner download cannot delay core readiness (spec 6.5).
   */
  async refresh(specs: FileSpec[], force = false): Promise<void> {
    const manifest = this.readManifest()
    if (!shouldCheck(manifest, this.options.now(), force)) return
    if (this.refreshing) return this.refreshing

    this.refreshing = (async () => {
      let requiredFailure: string | null = null
      for (const spec of specs) {
        try {
          await this.downloadOne(spec, true)
        } catch (error) {
          const message = (error as Error).message
          this.options.log(`refresh failed for ${spec.fileName}: ${message}`)
          const entry = this.readManifest().files[spec.id]
          if (entry) entry.lastError = message
          if (!spec.optional) requiredFailure = message
        }
      }
      const now = this.options.now()
      this.lastNetworkFailed = requiredFailure !== null
      if (requiredFailure) {
        manifest.lastCheckError = requiredFailure
        manifest.nextCheckAt = new Date(now.getTime() + BACKOFF_MS).toISOString()
      } else {
        manifest.lastCheckError = null
        manifest.nextCheckAt = null
        manifest.lastCheckedAt = now.toISOString()
      }
      await this.saveManifest()
    })()

    try {
      await this.refreshing
    } finally {
      this.refreshing = null
    }
  }

  /** Kick the daily check off without blocking the caller (server start, every tool call). */
  ensureFresh(specs: FileSpec[]): void {
    void this.refresh(specs).catch((error: unknown) => this.options.log(`background refresh failed: ${(error as Error).message}`))
  }

  /**
   * Guarantee one file is on disk. Waits only when it is genuinely missing; otherwise
   * returns immediately and lets the daily check run in the background.
   */
  async ensureFile(spec: FileSpec, timeoutMs = 30_000): Promise<string> {
    const path = this.localPath(spec)
    if (existsSync(path)) return path

    let pending = this.inFlight.get(spec.id)
    if (!pending) {
      pending = this.downloadOne(spec, false).finally(() => this.inFlight.delete(spec.id))
      this.inFlight.set(spec.id, pending)
    }

    let timedOut = false
    const timer = delay(timeoutMs).then(() => {
      timedOut = true
    })
    try {
      await Promise.race([pending, timer])
    } catch (error) {
      this.lastNetworkFailed = true
      if (error instanceof CacheError) throw error
      throw new CacheError(
        'DATASET_UNAVAILABLE',
        `${spec.fileName} is not cached and could not be downloaded (${(error as Error).message}). Run dataset_info { refresh: true } once you are online.`,
      )
    }
    if (timedOut && !existsSync(path)) {
      throw new CacheError('DATASET_DOWNLOADING', `${spec.fileName} is still downloading; retry shortly.`, 30)
    }
    return path
  }

  async fileStats(spec: FileSpec): Promise<{ bytes: number } | null> {
    try {
      return { bytes: (await stat(this.localPath(spec))).size }
    } catch {
      return null
    }
  }

  async readFileText(spec: FileSpec): Promise<string> {
    return readFile(this.localPath(spec), 'utf8')
  }
}
```

Note on `readManifest()`: it uses a synchronous read because `status()` and `offline` are called from synchronous result-shaping code. Import `readFileSync` at the top of the file alongside `mkdirSync` and `existsSync` rather than calling `require` inline — the inline form above is shorthand for the plan, not the shipped code.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — 37 tests total, 0 failures.

- [ ] **Step 5: Commit (stage, show, wait for approval)**

```bash
git add mcp-server/src/cache.ts mcp-server/test/cache.test.ts
git diff --cached --stat
```

Proposed message: `feat(mcp): add the cache manager with daily conditional refresh`

---

## Task 5: `datasets.ts` — target and version to files, parsing, indexes

**Model:** Opus 5.

Spec 6.1 and the "Loading" paragraph of 8. Maps a target plus an optional version onto concrete `FileSpec`s, parses a downloaded file into records, and builds the two upper-cased lookup indexes. The registry memoises parsed datasets and drops them when the cache swaps a file.

**Files:**
- Create: `mcp-server/src/datasets.ts`, `mcp-server/test/datasets.test.ts`

**Interfaces:**
- Consumes: `Target`, `RawRecord` (Task 1); `FileSpec`, `CacheManager`, `CacheError` (Task 4).
- Produces: `RELEASE_INFO_FILES`, `SAP_CLASSIFICATION_FILE`, `BUILT_IN_PCE_VERSIONS`, `VERSION_PATTERN`, `versionFileNames(version)`, `resolveFiles(target, version?) => ResolvedFiles`, `coreFileSpecs() => FileSpec[]`, `parseRecords(text, arrayKey) => RawRecord[]`, `buildDataset(records) => Dataset`, `Dataset` (`{records, byKey, byTadirName}`), `DatasetRegistry` with `load(spec) => Promise<Dataset>` and `invalidate(id)`.

- [ ] **Step 1: Write the failing test**

`mcp-server/test/datasets.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDataset, parseRecords, resolveFiles, versionFileNames, coreFileSpecs, VERSION_PATTERN } from '../src/datasets'
import type { RawRecord } from '../src/types'

test('each target maps to its release-info file; only private has a classification file', () => {
  assert.equal(resolveFiles('cloud-erp').releaseInfoCandidates[0]?.fileName, 'objectReleaseInfoLatest.json')
  assert.equal(resolveFiles('btp-abap-environment').releaseInfoCandidates[0]?.fileName, 'objectReleaseInfo_BTPLatest.json')
  assert.equal(resolveFiles('cloud-erp').classification, null)
  assert.equal(resolveFiles('btp-abap-environment').classification, null)

  const priv = resolveFiles('cloud-erp-private')
  assert.equal(priv.releaseInfoCandidates[0]?.fileName, 'objectReleaseInfo_PCELatest.json')
  assert.equal(priv.classification?.fileName, 'objectClassifications_SAP.json')
})

test('a YYYY_N version resolves to exactly one file, a bare YYYY to two candidates', () => {
  assert.deepEqual(versionFileNames('2023_2'), ['objectReleaseInfo_PCE2023_2.json'])
  assert.deepEqual(versionFileNames('2022'), ['objectReleaseInfo_PCE2022.json', 'objectReleaseInfo_PCE2022_0.json'])
  assert.deepEqual(versionFileNames('latest'), ['objectReleaseInfo_PCELatest.json'])
})

test('the version pattern accepts latest, YYYY and YYYY_N and nothing else', () => {
  for (const good of ['latest', '2022', '2023_2', '2025_1']) assert.ok(VERSION_PATTERN.test(good))
  for (const bad of ['../etc/passwd', '2023-2', 'PCE2023', '20233', '']) assert.equal(VERSION_PATTERN.test(bad), false)
})

test('passing a version to a non-private target is refused, not ignored', () => {
  assert.throws(() => resolveFiles('cloud-erp', '2023'), /cloud-erp-private/)
})

test('the core file set is the four files the bootstrap downloads', () => {
  assert.deepEqual(
    coreFileSpecs().map((spec) => spec.fileName).sort(),
    ['objectClassifications_SAP.json', 'objectReleaseInfoLatest.json', 'objectReleaseInfo_BTPLatest.json', 'objectReleaseInfo_PCELatest.json'].sort(),
  )
})

test('parseRecords reads the array and tolerates a string formatVersion', () => {
  const text = JSON.stringify({ formatVersion: '2', objectClassifications: [{ tadirObject: 'CLAS', tadirObjName: '/OTX/CL_A', objectType: 'CLAS', objectKey: '/OTX/CL_A', state: 'classicAPI' }] })
  assert.equal(parseRecords(text, 'objectClassifications').length, 1)
})

test('parseRecords on a wrong key returns an empty array instead of throwing', () => {
  assert.deepEqual(parseRecords(JSON.stringify({ formatVersion: 1, other: [] }), 'objectReleaseInfo'), [])
})

test('the index is case-insensitive and keyed on both objectKey and tadirObjName', () => {
  const records: RawRecord[] = [
    { tadirObject: 'FUGR', tadirObjName: 'REBD_BAPI_BUILDING', objectType: 'FUNC', objectKey: 'BAPI_RE_BU_GET_DETAIL', state: 'released' },
    { tadirObject: 'TABL', tadirObjName: 'MARA', objectType: 'TABL', objectKey: 'MARA', state: 'notToBeReleased' },
  ]
  const dataset = buildDataset(records)
  assert.equal(dataset.byKey.get('bapi_re_bu_get_detail'.toUpperCase())?.length, 1)
  assert.equal(dataset.byTadirName.get('REBD_BAPI_BUILDING')?.length, 1)
  assert.equal(dataset.byKey.get('MARA')?.length, 1)
  assert.equal(dataset.records.length, 2)
})

test('several object types under one name all land in the same bucket', () => {
  const dataset = buildDataset([
    { tadirObject: 'TABL', tadirObjName: 'X', objectType: 'TABL', objectKey: 'X', state: 'released' },
    { tadirObject: 'DTEL', tadirObjName: 'X', objectType: 'DTEL', objectKey: 'X', state: 'notToBeReleased' },
  ])
  assert.equal(dataset.byKey.get('X')?.length, 2)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/datasets'`.

- [ ] **Step 3: Write `datasets.ts`**

```ts
import type { RawRecord, Target } from './types'
import { CacheError, type CacheManager, type FileSpec } from './cache'

export const RELEASE_INFO_FILES: Record<Target, string> = {
  'cloud-erp': 'objectReleaseInfoLatest.json',
  'cloud-erp-private': 'objectReleaseInfo_PCELatest.json',
  'btp-abap-environment': 'objectReleaseInfo_BTPLatest.json',
}

export const SAP_CLASSIFICATION_FILE = 'objectClassifications_SAP.json'

/**
 * Seeded from Task 0 Spike C (the objectReleaseInfo_PCE* files actually present upstream).
 * Replace this literal with the exact set the spike recorded before shipping.
 * `dataset_info` refreshes it best-effort from the contents API when it is called.
 */
export const BUILT_IN_PCE_VERSIONS: string[] = ['latest', '2022', '2023', '2023_2', '2025_1']

/** `latest`, `YYYY` or `YYYY_N`. Validated before it can reach a URL or a file name. */
export const VERSION_PATTERN = /^(latest|\d{4}(_\d+)?)$/

export function versionFileNames(version: string): string[] {
  if (version === 'latest') return ['objectReleaseInfo_PCELatest.json']
  if (/^\d{4}_\d+$/.test(version)) return [`objectReleaseInfo_PCE${version}.json`]
  return [`objectReleaseInfo_PCE${version}.json`, `objectReleaseInfo_PCE${version}_0.json`]
}

export interface ResolvedFiles {
  /** Tried in order; the first that downloads wins. More than one only for a bare `YYYY`. */
  releaseInfoCandidates: FileSpec[]
  classification: FileSpec | null
}

export function resolveFiles(target: Target, version?: string): ResolvedFiles {
  if (version && version !== 'latest' && target !== 'cloud-erp-private') {
    throw new CacheError('UNKNOWN_VERSION', `version is only meaningful for cloud-erp-private, not ${target}`)
  }

  if (target !== 'cloud-erp-private') {
    const fileName = RELEASE_INFO_FILES[target]
    return {
      releaseInfoCandidates: [{ id: `${target}/latest`, fileName, arrayKey: 'objectReleaseInfo', optional: false }],
      classification: null,
    }
  }

  const effective = version ?? 'latest'
  if (!VERSION_PATTERN.test(effective)) {
    throw new CacheError('UNKNOWN_VERSION', `"${effective}" is not a valid version (expected latest, YYYY or YYYY_N)`)
  }
  return {
    releaseInfoCandidates: versionFileNames(effective).map((fileName) => ({
      id: `cloud-erp-private/${effective}:${fileName}`,
      fileName,
      arrayKey: 'objectReleaseInfo' as const,
      optional: false,
    })),
    classification: { id: 'classification/sap', fileName: SAP_CLASSIFICATION_FILE, arrayKey: 'objectClassifications', optional: false },
  }
}

/** The four files the bootstrap downloads; everything else is lazy. */
export function coreFileSpecs(): FileSpec[] {
  return [
    ...(['cloud-erp', 'cloud-erp-private', 'btp-abap-environment'] as Target[]).map((target) => ({
      id: `${target}/latest`,
      fileName: RELEASE_INFO_FILES[target],
      arrayKey: 'objectReleaseInfo' as const,
      optional: false,
    })),
    { id: 'classification/sap', fileName: SAP_CLASSIFICATION_FILE, arrayKey: 'objectClassifications', optional: false },
  ]
}

export function parseRecords(text: string, arrayKey: 'objectReleaseInfo' | 'objectClassifications'): RawRecord[] {
  try {
    const document = JSON.parse(text) as Record<string, unknown>
    const rows = document[arrayKey]
    return Array.isArray(rows) ? (rows as RawRecord[]) : []
  } catch {
    return []
  }
}

export interface Dataset {
  records: RawRecord[]
  /** Upper-cased objectKey to records. */
  byKey: Map<string, RawRecord[]>
  /** Upper-cased tadirObjName to records (a function module's function group, for instance). */
  byTadirName: Map<string, RawRecord[]>
}

function push(index: Map<string, RawRecord[]>, key: string | undefined, record: RawRecord): void {
  if (!key) return
  const upper = key.toUpperCase()
  const bucket = index.get(upper)
  if (bucket) bucket.push(record)
  else index.set(upper, [record])
}

export function buildDataset(records: RawRecord[]): Dataset {
  const byKey = new Map<string, RawRecord[]>()
  const byTadirName = new Map<string, RawRecord[]>()
  for (const record of records) {
    push(byKey, record.objectKey, record)
    push(byTadirName, record.tadirObjName, record)
  }
  return { records, byKey, byTadirName }
}

/** Parses each file at most once per process, and forgets it when the cache swaps the file. */
export class DatasetRegistry {
  private readonly loaded = new Map<string, Dataset>()

  constructor(private readonly cache: CacheManager) {
    cache.subscribe((id) => this.invalidate(id))
  }

  invalidate(id: string): void {
    this.loaded.delete(id)
  }

  async load(spec: FileSpec, timeoutMs = 30_000): Promise<Dataset> {
    const cached = this.loaded.get(spec.id)
    if (cached) return cached
    await this.cache.ensureFile(spec, timeoutMs)
    const dataset = buildDataset(parseRecords(await this.cache.readFileText(spec), spec.arrayKey))
    this.loaded.set(spec.id, dataset)
    return dataset
  }

  /** Try each candidate in order; all 404 means the version does not exist upstream. */
  async loadFirstAvailable(candidates: FileSpec[], timeoutMs = 30_000): Promise<{ dataset: Dataset; spec: FileSpec }> {
    let lastError: unknown = null
    for (const spec of candidates) {
      try {
        return { dataset: await this.load(spec, timeoutMs), spec }
      } catch (error) {
        lastError = error
        if (error instanceof CacheError && error.code !== 'UNKNOWN_VERSION') throw error
      }
    }
    if (lastError instanceof CacheError) throw lastError
    throw new CacheError('UNKNOWN_VERSION', `none of ${candidates.map((spec) => spec.fileName).join(', ')} exists upstream`)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — 46 tests total, 0 failures.

- [ ] **Step 5: Commit (stage, show, wait for approval)**

```bash
git add mcp-server/src/datasets.ts mcp-server/test/datasets.test.ts
git diff --cached --stat
```

Proposed message: `feat(mcp): map targets and versions onto datasets with in-memory indexes`

---

## Task 6: `query.ts` part 1 — level derivation, successors, object lookup

**Model:** Opus 5.

Spec 6.2 and 6.3, plus the `verdict` vocabulary of 7.1. Pure functions over records: no I/O, so the whole three-targets-by-every-state matrix is cheap to test.

**Files:**
- Create: `mcp-server/src/query.ts`, `mcp-server/test/query-lookup.test.ts`

**Interfaces:**
- Consumes: `Target`, `CleanCoreLevel`, `MaxLevel`, `RawRecord`, `Match`, `Origin`, `Successor` (Task 1); `Dataset` (Task 5).
- Produces: `LEVEL_ORDER`, `deriveLevel(target, releaseState, classification)`, `isAllowed(level, maxLevel)`, `normalizeSuccessors(record)`, `impliedLevelFor(target)`, `NOT_FOUND_HINT`, `LookupSources`, `ObjectRequest` (`{name, type?}`), `ObjectResult`, `Verdict`, `lookupObject(sources, request, maxLevel)`.

- [ ] **Step 1: Write the failing test**

`mcp-server/test/query-lookup.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDataset } from '../src/datasets'
import { deriveLevel, isAllowed, lookupObject, normalizeSuccessors, impliedLevelFor, NOT_FOUND_HINT } from '../src/query'
import type { RawRecord } from '../src/types'

const rec = (over: Partial<RawRecord>): RawRecord => ({
  tadirObject: 'CLAS', tadirObjName: 'X', objectType: 'CLAS', objectKey: 'X', state: 'released', ...over,
})

const sources = (releaseInfo: RawRecord[], classification: RawRecord[] = [], partner: RawRecord[] = []) => ({
  target: 'cloud-erp-private' as const,
  releaseInfo: buildDataset(releaseInfo),
  classification: classification.length ? buildDataset(classification) : null,
  partner: partner.length ? buildDataset(partner) : null,
  partnerNamespace: partner.length ? '/OTX/' : null,
})

test('on private, released and deprecated are Level A and everything else falls through', () => {
  assert.equal(deriveLevel('cloud-erp-private', 'released', null), 'A')
  assert.equal(deriveLevel('cloud-erp-private', 'deprecated', null), 'A')
  assert.equal(deriveLevel('cloud-erp-private', null, 'classicAPI'), 'B')
  assert.equal(deriveLevel('cloud-erp-private', 'notToBeReleased', 'classicAPI'), 'B')
  assert.equal(deriveLevel('cloud-erp-private', null, 'noAPI'), 'D')
  assert.equal(deriveLevel('cloud-erp-private', 'notToBeReleased', null), 'C')
  assert.equal(deriveLevel('cloud-erp-private', 'stable', null), 'C')
  assert.equal(deriveLevel('cloud-erp-private', null, null), 'C')
})

test('on public cloud and BTP only Level A exists and absent is never released', () => {
  for (const target of ['cloud-erp', 'btp-abap-environment'] as const) {
    assert.equal(deriveLevel(target, 'released', null), 'A')
    assert.equal(deriveLevel(target, 'deprecated', null), 'A')
    assert.equal(deriveLevel(target, 'notToBeReleased', null), 'none')
    assert.equal(deriveLevel(target, null, 'classicAPI'), 'none')
    assert.equal(deriveLevel(target, null, null), 'none')
  }
})

test('levels are cumulative against maxLevel and none is never allowed', () => {
  assert.equal(isAllowed('A', 'A'), true)
  assert.equal(isAllowed('B', 'A'), false)
  assert.equal(isAllowed('B', 'B'), true)
  assert.equal(isAllowed('C', 'B'), false)
  assert.equal(isAllowed('C', 'C'), true)
  assert.equal(isAllowed('D', 'C'), false)
  assert.equal(isAllowed('D', 'D'), true)
  assert.equal(isAllowed('none', 'D'), false)
})

test('successors normalise to objects and concepts, one hop only', () => {
  assert.deepEqual(
    normalizeSuccessors(rec({ successors: [{ objectType: 'DDLS', objectKey: 'I_PRODUCT' }], successorConceptName: 'I_MaintenanceNotificationTP_3' })),
    [{ kind: 'object', objectType: 'DDLS', objectKey: 'I_PRODUCT' }, { kind: 'concept', name: 'I_MaintenanceNotificationTP_3' }],
  )
  assert.deepEqual(normalizeSuccessors(rec({})), [])
})

test('a released object is allowed and carries both raw facts', () => {
  const result = lookupObject(sources([rec({ objectKey: 'CL_ABAP_UNIT_ASSERT', tadirObjName: 'CL_ABAP_UNIT_ASSERT', state: 'released', softwareComponent: 'SAP_BASIS' })]), { name: 'cl_abap_unit_assert' }, 'A')
  assert.equal(result.verdict, 'allowed')
  assert.equal(result.matches[0]?.releaseState, 'released')
  assert.equal(result.matches[0]?.classification, null)
  assert.equal(result.matches[0]?.cleanCoreLevel, 'A')
  assert.equal(result.matches[0]?.origin, 'sap')
})

test('a deprecated object is allowed-deprecated and carries the successor', () => {
  const result = lookupObject(
    sources([rec({ objectKey: 'CL_OLD', tadirObjName: 'CL_OLD', state: 'deprecated', successors: [{ objectType: 'CLAS', objectKey: 'CL_NEW' }], successorClassification: 'oneObject' })]),
    { name: 'CL_OLD' }, 'A',
  )
  assert.equal(result.verdict, 'allowed-deprecated')
  assert.equal(result.matches[0]?.deprecated, true)
  assert.deepEqual(result.matches[0]?.successors, [{ kind: 'object', objectType: 'CLAS', objectKey: 'CL_NEW' }])
  assert.equal(result.matches[0]?.successorClassification, 'oneObject')
})

test('a classic API is blocked at maxLevel A and allowed at maxLevel B', () => {
  const data = sources([], [rec({ objectKey: 'BAPI_X', tadirObjName: 'BAPI_X', objectType: 'FUNC', state: 'classicAPI' })])
  assert.equal(lookupObject(data, { name: 'BAPI_X' }, 'A').verdict, 'blocked')
  assert.equal(lookupObject(data, { name: 'BAPI_X' }, 'B').verdict, 'allowed')
  assert.equal(lookupObject(data, { name: 'BAPI_X' }, 'B').matches[0]?.cleanCoreLevel, 'B')
})

test('a function module is found through its function group name too', () => {
  const data = sources([rec({ tadirObject: 'FUGR', tadirObjName: 'REBD_BAPI_BUILDING', objectType: 'FUNC', objectKey: 'BAPI_RE_BU_GET_DETAIL', state: 'released' })])
  assert.equal(lookupObject(data, { name: 'REBD_BAPI_BUILDING' }, 'A').found, true)
})

test('one name under two types with different outcomes and no type given is ambiguous', () => {
  const data = sources([
    rec({ objectType: 'TABL', objectKey: 'X', tadirObject: 'TABL', state: 'released' }),
    rec({ objectType: 'DTEL', objectKey: 'X', tadirObject: 'DTEL', state: 'notToBeReleased' }),
  ])
  assert.equal(lookupObject(data, { name: 'X' }, 'A').verdict, 'ambiguous')
  assert.equal(lookupObject(data, { name: 'X', type: 'TABL' }, 'A').verdict, 'allowed')
  assert.equal(lookupObject(data, { name: 'X', type: 'DTEL' }, 'A').verdict, 'blocked')
})

test('an absent name is not-found with an implied level and the standing hint', () => {
  const priv = lookupObject(sources([rec({})]), { name: 'NOPE' }, 'C')
  assert.equal(priv.verdict, 'not-found')
  assert.equal(priv.impliedLevel, 'C')
  assert.equal(priv.allowed, true, 'implied C is inside maxLevel C')
  assert.equal(priv.hint, NOT_FOUND_HINT)

  const strict = lookupObject(sources([rec({})]), { name: 'NOPE' }, 'A')
  assert.equal(strict.allowed, false)
})

test('implied level is none on public cloud and BTP - absent is never treated as released', () => {
  assert.equal(impliedLevelFor('cloud-erp'), 'none')
  assert.equal(impliedLevelFor('btp-abap-environment'), 'none')
  assert.equal(impliedLevelFor('cloud-erp-private'), 'C')
})

test('a partner classification supplies the level and stamps origin and labels', () => {
  const data = sources([], [], [rec({ objectKey: '/OTX/CL_A', tadirObjName: '/OTX/CL_A', state: 'classicAPI', labels: ['remote-enabled'] })])
  const result = lookupObject(data, { name: '/OTX/CL_A' }, 'B')
  assert.equal(result.matches[0]?.origin, 'partner:/OTX/')
  assert.equal(result.matches[0]?.cleanCoreLevel, 'B')
  assert.deepEqual(result.matches[0]?.labels, ['remote-enabled'])
})

test('SAP data wins over a partner file for a namespace SAP also ships', () => {
  const data = sources([rec({ objectKey: '/AIF/CL_X', tadirObjName: '/AIF/CL_X', state: 'released' })], [], [rec({ objectKey: '/AIF/CL_X', tadirObjName: '/AIF/CL_X', state: 'noAPI' })])
  const result = lookupObject(data, { name: '/AIF/CL_X' }, 'A')
  assert.equal(result.matches[0]?.origin, 'sap')
  assert.equal(result.matches[0]?.cleanCoreLevel, 'A')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/query'`.

- [ ] **Step 3: Write the lookup half of `query.ts`**

```ts
import type { Dataset } from './datasets'
import type { CleanCoreLevel, Match, MaxLevel, Origin, RawRecord, Successor, Target } from './types'

export const LEVEL_ORDER: Record<CleanCoreLevel, number> = { A: 0, B: 1, C: 2, D: 3, none: 99 }

/** Only these two states are a release contract; `stable` is tolerated but not a release. */
const RELEASED_STATES = new Set(['released', 'deprecated'])

export function deriveLevel(target: Target, releaseState: string | null, classification: string | null): CleanCoreLevel {
  const released = releaseState !== null && RELEASED_STATES.has(releaseState)
  if (target !== 'cloud-erp-private') return released ? 'A' : 'none'
  if (released) return 'A'
  if (classification === 'classicAPI') return 'B'
  if (classification === 'noAPI') return 'D'
  return 'C'
}

export function isAllowed(level: CleanCoreLevel, maxLevel: MaxLevel): boolean {
  if (level === 'none') return false
  return LEVEL_ORDER[level] <= LEVEL_ORDER[maxLevel]
}

/** Absent from the data is not the same as released (spec 6.2). */
export function impliedLevelFor(target: Target): CleanCoreLevel {
  return target === 'cloud-erp-private' ? 'C' : 'none'
}

export function normalizeSuccessors(record: RawRecord): Successor[] {
  const out: Successor[] = []
  for (const successor of record.successors ?? []) {
    out.push({ kind: 'object', objectType: successor.objectType, objectKey: successor.objectKey })
  }
  if (record.successorConceptName) out.push({ kind: 'concept', name: record.successorConceptName })
  return out
}

export const NOT_FOUND_HINT =
  'Not in the SAP data for this target. Check the type (CDS entity DDLS vs SQL view, function group FUGR vs function module FUNC) and namespaces (/NS/CL_X). Custom Z/Y objects are never listed.'

export function vendorHint(namespace: string): string {
  return `No classification published for ${namespace} in the Cloudification Repository - ask the vendor.`
}

export type Verdict = 'allowed' | 'allowed-deprecated' | 'blocked' | 'not-found' | 'ambiguous'

export interface LookupSources {
  target: Target
  releaseInfo: Dataset
  /** SAP's classification file; only loaded for cloud-erp-private. */
  classification: Dataset | null
  /** The partner file for the namespace of the requested object, when one exists. */
  partner: Dataset | null
  partnerNamespace: string | null
}

export interface ObjectRequest {
  name: string
  type?: string
}

export interface ObjectResult {
  name: string
  verdict: Verdict
  found: boolean
  matches: Match[]
  impliedLevel?: CleanCoreLevel
  allowed?: boolean
  suggestions?: Suggestion[]
  hint?: string
}

function recordsFor(dataset: Dataset | null, key: string): RawRecord[] {
  if (!dataset) return []
  return [...(dataset.byKey.get(key) ?? []), ...(dataset.byTadirName.get(key) ?? []).filter((record) => record.objectKey.toUpperCase() !== key)]
}

const identity = (record: RawRecord) => `${record.objectType}\u0000${record.objectKey.toUpperCase()}`

export function lookupObject(sources: LookupSources, request: ObjectRequest, maxLevel: MaxLevel): ObjectResult {
  const key = request.name.trim().toUpperCase()
  const releaseRecords = recordsFor(sources.releaseInfo, key)
  const sapClassRecords = recordsFor(sources.classification, key)
  const partnerRecords = recordsFor(sources.partner, key)

  /** One entry per concrete object; release info and classifications are merged onto it. */
  const merged = new Map<string, { release: RawRecord | null; classification: RawRecord | null; origin: Origin }>()
  const slot = (record: RawRecord, origin: Origin) => {
    const id = identity(record)
    let entry = merged.get(id)
    if (!entry) {
      entry = { release: null, classification: null, origin }
      merged.set(id, entry)
    }
    return entry
  }

  for (const record of releaseRecords) slot(record, 'sap').release = record
  // SAP first, then partner: a namespace SAP also ships resolves through SAP (spec 6.5).
  for (const record of sapClassRecords) {
    const entry = slot(record, 'sap')
    if (!entry.classification) entry.classification = record
  }
  for (const record of partnerRecords) {
    const entry = slot(record, sources.partnerNamespace ? (`partner:${sources.partnerNamespace}` as Origin) : 'sap')
    if (!entry.classification && !entry.release) {
      entry.classification = record
      entry.origin = sources.partnerNamespace ? (`partner:${sources.partnerNamespace}` as Origin) : 'sap'
    }
  }

  let matches: Match[] = [...merged.values()].map(({ release, classification, origin }) => {
    const base = release ?? classification
    if (!base) throw new Error('unreachable: a merged entry always carries a record')
    const releaseState = release?.state ?? null
    const classificationState = classification?.state ?? null
    const level = deriveLevel(sources.target, releaseState, classificationState)
    const carrier = release ?? classification
    return {
      objectType: base.objectType,
      objectKey: base.objectKey,
      tadirObject: base.tadirObject,
      tadirObjName: base.tadirObjName,
      softwareComponent: base.softwareComponent ?? null,
      applicationComponent: base.applicationComponent ?? null,
      releaseState,
      classification: classificationState,
      origin,
      cleanCoreLevel: level,
      allowed: isAllowed(level, maxLevel),
      deprecated: releaseState === 'deprecated',
      successors: carrier ? normalizeSuccessors(carrier) : [],
      successorClassification: carrier?.successorClassification ?? null,
      labels: carrier?.labels ?? [],
    }
  })

  if (request.type) {
    const wanted = request.type.toUpperCase()
    matches = matches.filter((match) => match.objectType.toUpperCase() === wanted || match.tadirObject.toUpperCase() === wanted)
  }

  if (matches.length === 0) {
    const implied = impliedLevelFor(sources.target)
    return {
      name: request.name,
      verdict: 'not-found',
      found: false,
      matches: [],
      impliedLevel: implied,
      allowed: isAllowed(implied, maxLevel),
      hint: NOT_FOUND_HINT,
    }
  }

  const distinctOutcomes = new Set(matches.map((match) => match.allowed))
  if (matches.length > 1 && !request.type && distinctOutcomes.size > 1) {
    return { name: request.name, verdict: 'ambiguous', found: true, matches }
  }

  const allAllowed = matches.every((match) => match.allowed)
  const anyDeprecated = matches.some((match) => match.deprecated)
  const verdict: Verdict = allAllowed ? (anyDeprecated ? 'allowed-deprecated' : 'allowed') : 'blocked'
  return { name: request.name, verdict, found: true, matches }
}
```

`Suggestion` is declared in Task 7 and imported by `ObjectResult`; write the interface stub in Task 7's step and keep `suggestions?: Suggestion[]` typed via a forward `import type` from the same module (both halves live in `query.ts`, so it is one file and one type graph).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — 59 tests total, 0 failures.

- [ ] **Step 5: Commit (stage, show, wait for approval)**

```bash
git add mcp-server/src/query.ts mcp-server/test/query-lookup.test.ts
git diff --cached --stat
```

Proposed message: `feat(mcp): derive Clean Core levels and resolve object lookups`

---

## Task 7: `query.ts` part 2 — ranked search, pagination and not-found suggestions

**Model:** Opus 5.

Spec 7.2 (ranking) and the `suggestions` paragraph of 7.1. A bounded Levenshtein keeps the typo recovery cheap over roughly 43k records.

**Files:**
- Modify: `mcp-server/src/query.ts` (append)
- Create: `mcp-server/test/query-search.test.ts`

**Interfaces:**
- Consumes: everything Task 6 produced; `Dataset` (Task 5).
- Produces: `SearchPool` (`{dataset, origin}`), `SearchRequest`, `SearchHit` (record fields + `origin` + `cleanCoreLevel`), `SearchOutcome` (`{total, results}`), `ClassificationLookup` (`(record) => string | null`), `searchObjects(pools, request, target, classificationOf)`, `Suggestion` (`{objectType, objectKey, cleanCoreLevel, reason}`), `suggestNearMatches(pools, name, target, classificationOf, limit)`, `boundedLevenshtein(a, b, max)`, `SUGGESTION_LIMIT`.

- [ ] **Step 1: Write the failing test**

`mcp-server/test/query-search.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDataset } from '../src/datasets'
import { boundedLevenshtein, searchObjects, suggestNearMatches, SUGGESTION_LIMIT } from '../src/query'
import type { RawRecord } from '../src/types'

const rec = (over: Partial<RawRecord>): RawRecord => ({
  tadirObject: 'DDLS', tadirObjName: 'X', objectType: 'DDLS', objectKey: 'X', state: 'released', ...over,
})

const pool = (records: RawRecord[], origin: 'sap' | `partner:${string}` = 'sap') => ({ dataset: buildDataset(records), origin })
const noClassification = () => null

test('ranking is exact, then prefix, then substring, then all-tokens', () => {
  const records = [
    rec({ objectKey: 'I_PURCHASEORDERITEM', tadirObjName: 'I_PURCHASEORDERITEM' }),
    rec({ objectKey: 'PURCHASE', tadirObjName: 'PURCHASE' }),
    rec({ objectKey: 'ZZ_PURCHASE_HELPER', tadirObjName: 'ZZ_PURCHASE_HELPER' }),
    rec({ objectKey: 'PURCHASEREQUISITION', tadirObjName: 'PURCHASEREQUISITION' }),
  ]
  const outcome = searchObjects([pool(records)], { query: 'PURCHASE', limit: 10, offset: 0 }, 'cloud-erp', noClassification)
  assert.deepEqual(outcome.results.map((hit) => hit.objectKey), ['PURCHASE', 'PURCHASEREQUISITION', 'I_PURCHASEORDERITEM', 'ZZ_PURCHASE_HELPER'])
})

test('a multi-token query matches when every token appears as a substring', () => {
  const records = [rec({ objectKey: 'I_PURCHASEORDERITEM', tadirObjName: 'I_PURCHASEORDERITEM' }), rec({ objectKey: 'I_SALESORDER', tadirObjName: 'I_SALESORDER' })]
  const outcome = searchObjects([pool(records)], { query: 'purchase order', limit: 10, offset: 0 }, 'cloud-erp', noClassification)
  assert.deepEqual(outcome.results.map((hit) => hit.objectKey), ['I_PURCHASEORDERITEM'])
})

test('ties sort alphabetically', () => {
  const records = [rec({ objectKey: 'I_B', tadirObjName: 'I_B' }), rec({ objectKey: 'I_A', tadirObjName: 'I_A' })]
  const outcome = searchObjects([pool(records)], { query: 'I_', limit: 10, offset: 0 }, 'cloud-erp', noClassification)
  assert.deepEqual(outcome.results.map((hit) => hit.objectKey), ['I_A', 'I_B'])
})

test('objectType, applicationComponent prefix, state and label all filter', () => {
  const records = [
    rec({ objectKey: 'A1', tadirObjName: 'A1', objectType: 'CLAS', applicationComponent: 'MM-PUR-SRC-SL', state: 'released', labels: ['remote-enabled'] }),
    rec({ objectKey: 'A2', tadirObjName: 'A2', objectType: 'DDLS', applicationComponent: 'SD-SLS', state: 'notToBeReleased' }),
  ]
  const base = { query: 'A', limit: 10, offset: 0 }
  assert.equal(searchObjects([pool(records)], { ...base, objectType: 'clas' }, 'cloud-erp', noClassification).total, 1)
  assert.equal(searchObjects([pool(records)], { ...base, applicationComponent: 'mm-pur' }, 'cloud-erp', noClassification).total, 1)
  assert.equal(searchObjects([pool(records)], { ...base, state: 'released' }, 'cloud-erp', noClassification).total, 1)
  assert.equal(searchObjects([pool(records)], { ...base, label: 'remote-enabled' }, 'cloud-erp', noClassification).total, 1)
})

test('maxLevel filters on the derived level, and total counts before pagination', () => {
  const records = Array.from({ length: 30 }, (_unused, index) => rec({ objectKey: `I_A${String(index).padStart(2, '0')}`, tadirObjName: `I_A${String(index).padStart(2, '0')}` }))
  const outcome = searchObjects([pool(records)], { query: 'I_A', limit: 10, offset: 20 }, 'cloud-erp', noClassification)
  assert.equal(outcome.total, 30)
  assert.equal(outcome.results.length, 10)
  assert.equal(outcome.results[0]?.objectKey, 'I_A20')
})

test('partner hits carry their origin and labels', () => {
  const outcome = searchObjects(
    [pool([rec({ objectKey: '/OTX/CL_A', tadirObjName: '/OTX/CL_A', state: 'classicAPI', labels: ['transactional-consistent'] })], 'partner:/OTX/')],
    { query: 'OTX', limit: 10, offset: 0 }, 'cloud-erp-private', noClassification,
  )
  assert.equal(outcome.results[0]?.origin, 'partner:/OTX/')
  assert.equal(outcome.results[0]?.cleanCoreLevel, 'B')
  assert.deepEqual(outcome.results[0]?.labels, ['transactional-consistent'])
})

test('bounded Levenshtein returns the distance inside the bound and null beyond it', () => {
  assert.equal(boundedLevenshtein('MARA', 'MARA', 2), 0)
  assert.equal(boundedLevenshtein('MARA', 'MARC', 2), 1)
  assert.equal(boundedLevenshtein('MARA', 'MRAC', 2), 2)
  assert.equal(boundedLevenshtein('MARA', 'COMPLETELY_OTHER', 2), null)
})

test('a typo is recovered by edit distance and reported with its reason', () => {
  const records = [rec({ objectKey: 'SOME_UNKNOWN_OBJ', tadirObjName: 'SOME_UNKNOWN_OBJ', objectType: 'TABL', state: 'released' })]
  const suggestions = suggestNearMatches([pool(records)], 'SOME_UNKNOWN_OBJX', 'cloud-erp', noClassification, SUGGESTION_LIMIT)
  assert.equal(suggestions[0]?.objectKey, 'SOME_UNKNOWN_OBJ')
  assert.equal(suggestions[0]?.reason, 'edit-distance')
})

test('a namespace variant is recovered when the slashes are ignored', () => {
  const records = [rec({ objectKey: '/OTX/CL_A', tadirObjName: '/OTX/CL_A', objectType: 'CLAS' })]
  const suggestions = suggestNearMatches([pool(records)], 'OTX_CL_A', 'cloud-erp', noClassification, SUGGESTION_LIMIT)
  assert.equal(suggestions[0]?.objectKey, '/OTX/CL_A')
})

test('no near match yields an empty list rather than noise', () => {
  const records = [rec({ objectKey: 'AAAA', tadirObjName: 'AAAA' })]
  assert.deepEqual(suggestNearMatches([pool(records)], 'ZZZZZZZZZZZZ', 'cloud-erp', noClassification, SUGGESTION_LIMIT), [])
})

test('suggestions are capped at five', () => {
  const records = Array.from({ length: 40 }, (_unused, index) => rec({ objectKey: `I_PROD${index}`, tadirObjName: `I_PROD${index}` }))
  assert.equal(suggestNearMatches([pool(records)], 'I_PROD', 'cloud-erp', noClassification, SUGGESTION_LIMIT).length, SUGGESTION_LIMIT)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `searchObjects is not exported from '../src/query'`.

- [ ] **Step 3: Append the search half of `query.ts`**

```ts
export const SUGGESTION_LIMIT = 5

export interface SearchPool {
  dataset: Dataset
  origin: Origin
}

export interface SearchRequest {
  query: string
  objectType?: string
  /** Case-insensitive prefix on the SAP application component path, e.g. `MM-PUR`. */
  applicationComponent?: string
  state?: string
  maxLevel?: MaxLevel
  label?: string
  limit: number
  offset: number
}

export interface SearchHit extends Match {}

export interface SearchOutcome {
  total: number
  results: SearchHit[]
}

/** Supplies the SAP classification state for a record, or null when there is none. */
export type ClassificationLookup = (record: RawRecord) => string | null

const RANK_EXACT = 0
const RANK_PREFIX = 1
const RANK_SUBSTRING = 2
const RANK_TOKENS = 3

function rankOf(query: string, record: RawRecord): number | null {
  const haystacks = [record.objectKey.toUpperCase(), record.tadirObjName.toUpperCase()]
  const needle = query.toUpperCase().trim()
  if (haystacks.some((value) => value === needle)) return RANK_EXACT
  if (haystacks.some((value) => value.startsWith(needle))) return RANK_PREFIX
  if (haystacks.some((value) => value.includes(needle))) return RANK_SUBSTRING
  const tokens = needle.split(/\s+/).filter(Boolean)
  if (tokens.length > 1 && haystacks.some((value) => tokens.every((token) => value.includes(token)))) return RANK_TOKENS
  return null
}

function toHit(record: RawRecord, origin: Origin, target: Target, classificationOf: ClassificationLookup, maxLevel: MaxLevel): SearchHit {
  const isClassificationRecord = record.state === 'classicAPI' || record.state === 'noAPI'
  const releaseState = isClassificationRecord ? null : record.state
  const classification = isClassificationRecord ? record.state : classificationOf(record)
  const level = deriveLevel(target, releaseState, classification)
  return {
    objectType: record.objectType,
    objectKey: record.objectKey,
    tadirObject: record.tadirObject,
    tadirObjName: record.tadirObjName,
    softwareComponent: record.softwareComponent ?? null,
    applicationComponent: record.applicationComponent ?? null,
    releaseState,
    classification,
    origin,
    cleanCoreLevel: level,
    allowed: isAllowed(level, maxLevel),
    deprecated: releaseState === 'deprecated',
    successors: normalizeSuccessors(record),
    successorClassification: record.successorClassification ?? null,
    labels: record.labels ?? [],
  }
}

export function searchObjects(pools: SearchPool[], request: SearchRequest, target: Target, classificationOf: ClassificationLookup): SearchOutcome {
  const maxLevel: MaxLevel = request.maxLevel ?? 'D'
  const wantedType = request.objectType?.toUpperCase()
  const wantedComponent = request.applicationComponent?.toUpperCase()
  const wantedState = request.state?.toLowerCase()
  const wantedLabel = request.label?.toLowerCase()

  const scored: { rank: number; hit: SearchHit }[] = []
  for (const { dataset, origin } of pools) {
    for (const record of dataset.records) {
      if (wantedType && record.objectType.toUpperCase() !== wantedType && record.tadirObject.toUpperCase() !== wantedType) continue
      if (wantedComponent && !(record.applicationComponent ?? '').toUpperCase().startsWith(wantedComponent)) continue
      if (wantedState && record.state.toLowerCase() !== wantedState) continue
      if (wantedLabel && !(record.labels ?? []).some((label) => label.toLowerCase() === wantedLabel)) continue
      const rank = rankOf(request.query, record)
      if (rank === null) continue
      const hit = toHit(record, origin, target, classificationOf, maxLevel)
      if (request.maxLevel && !hit.allowed) continue
      scored.push({ rank, hit })
    }
  }

  scored.sort((left, right) => (left.rank - right.rank) || left.hit.objectKey.localeCompare(right.hit.objectKey))
  return { total: scored.length, results: scored.slice(request.offset, request.offset + request.limit).map((entry) => entry.hit) }
}

/** Distance, or null as soon as it is certain to exceed `max` - keeps a 43k scan cheap. */
export function boundedLevenshtein(left: string, right: string, max: number): number | null {
  if (Math.abs(left.length - right.length) > max) return null
  let previous = Array.from({ length: right.length + 1 }, (_unused, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i]
    let best = i
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      const value = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost)
      current[j] = value
      if (value < best) best = value
    }
    if (best > max) return null
    previous = current
  }
  const distance = previous[right.length]
  return distance !== undefined && distance <= max ? distance : null
}

export type SuggestionReason = 'exact-other-type' | 'prefix' | 'substring' | 'namespace-variant' | 'edit-distance'

export interface Suggestion {
  objectType: string
  objectKey: string
  cleanCoreLevel: CleanCoreLevel
  reason: SuggestionReason
}

const REASON_RANK: Record<SuggestionReason, number> = {
  'exact-other-type': 0,
  'namespace-variant': 1,
  'edit-distance': 2,
  prefix: 3,
  substring: 4,
}

/** Slashes and underscores are noise when a user mistypes a namespace. */
const flatten = (value: string) => value.toUpperCase().replace(/[/_]/g, '')

export function suggestNearMatches(
  pools: SearchPool[],
  name: string,
  target: Target,
  classificationOf: ClassificationLookup,
  limit = SUGGESTION_LIMIT,
): Suggestion[] {
  const needle = name.trim().toUpperCase()
  const flatNeedle = flatten(needle)
  const found: { rank: number; suggestion: Suggestion }[] = []

  for (const { dataset, origin } of pools) {
    for (const record of dataset.records) {
      const key = record.objectKey.toUpperCase()
      let reason: SuggestionReason | null = null
      if (key === needle) reason = 'exact-other-type'
      else if (flatten(key) === flatNeedle) reason = 'namespace-variant'
      else if (boundedLevenshtein(key, needle, 2) !== null) reason = 'edit-distance'
      else if (needle.length >= 4 && key.startsWith(needle)) reason = 'prefix'
      else if (needle.length >= 6 && key.includes(needle)) reason = 'substring'
      if (!reason) continue
      const hit = toHit(record, origin, target, classificationOf, 'D')
      found.push({ rank: REASON_RANK[reason], suggestion: { objectType: record.objectType, objectKey: record.objectKey, cleanCoreLevel: hit.cleanCoreLevel, reason } })
    }
  }

  found.sort((left, right) => (left.rank - right.rank) || left.suggestion.objectKey.localeCompare(right.suggestion.objectKey))
  const seen = new Set<string>()
  const unique: Suggestion[] = []
  for (const { suggestion } of found) {
    const id = `${suggestion.objectType}\u0000${suggestion.objectKey}`
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(suggestion)
    if (unique.length === limit) break
  }
  return unique
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — 70 tests total, 0 failures.

- [ ] **Step 5: Commit (stage, show, wait for approval)**

```bash
git add mcp-server/src/query.ts mcp-server/test/query-search.test.ts
git diff --cached --stat
```

Proposed message: `feat(mcp): add ranked search and near-match suggestions`

---


## Task 8: `target-resolver.ts` — resolve the target system without guessing

**Model:** Opus 5.

Spec 6.4. Two hard rules the tests must pin down: a credential-like field from the ADT destinations file may never reach memory as a named value or a serialized output, and an unresolved target is an error rather than a default.

**Files:**
- Create: `mcp-server/src/target-resolver.ts`, `mcp-server/test/target-resolver.test.ts`
- Modify: `mcp-server/src/config.ts`, `mcp-server/test/config.test.ts`

**Interfaces:**
- Consumes: `Target` (Task 1); `ServerConfig`, `loadConfig` (Task 1).
- Produces: `Confidence` (`'high' | 'medium' | 'low'`), `DestinationSummary` (`{id, protocol, host, systemId}`), `readDestinations(path)`, `redactHost(host)`, `classifyDestination(summary)`, `lastLoggedOnDestination(stateDir)`, `ResolveInput` (`{requested?, version?, config}`), `TargetResolution` (`{target, version, resolvedFrom, confidence, assumption?}`), `TargetCandidate`, `TargetResolutionError` (`{code, candidates}`), `resolveTarget(input)`.
- Also adds `versionPin: string | null` to `ServerConfig`, parsed from `ABAP_KEBAP_RELEASED_OBJECTS_VERSION`.

- [ ] **Step 1: Extend `loadConfig` with the version pin**

Add to `ServerConfig`: `versionPin: string | null`. Parse it next to `targetPin`:

```ts
  const rawVersion = env.ABAP_KEBAP_RELEASED_OBJECTS_VERSION?.trim()
  let versionPin: string | null = null
  if (rawVersion) {
    if (/^(latest|\d{4}(_\d+)?)$/.test(rawVersion)) versionPin = rawVersion
    else warnings.push(`ABAP_KEBAP_RELEASED_OBJECTS_VERSION="${rawVersion}" is not latest, YYYY or YYYY_N; ignoring it.`)
  }
```

Return it in the config object, and add one case to `test/config.test.ts`:

```ts
test('the version pin accepts latest, a year and a feature pack, and warns otherwise', () => {
  assert.equal(loadConfig([], { ABAP_KEBAP_RELEASED_OBJECTS_VERSION: '2023' }, HOME).versionPin, '2023')
  assert.equal(loadConfig([], { ABAP_KEBAP_RELEASED_OBJECTS_VERSION: '2021_1' }, HOME).versionPin, '2021_1')
  const bad = loadConfig([], { ABAP_KEBAP_RELEASED_OBJECTS_VERSION: 'FPS1' }, HOME)
  assert.equal(bad.versionPin, null)
  assert.match(bad.warnings.join(' '), /VERSION/)
})
```

- [ ] **Step 2: Write the failing test**

`mcp-server/test/target-resolver.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config'
import {
  classifyDestination, lastLoggedOnDestination, readDestinations, redactHost,
  resolveTarget, TargetResolutionError,
} from '../src/target-resolver'
import type { ServerConfig } from '../src/config'

const workspace = async () => mkdtemp(join(tmpdir(), 'ro-target-'))

/** A real config, so the test cannot drift from what the server actually passes. */
const configFor = async (stateDir: string, env: NodeJS.ProcessEnv = {}): Promise<ServerConfig> =>
  loadConfig([], { ABAP_KEBAP_ADT_STATE_DIR: stateDir, ...env }, await workspace())

const writeDestinations = async (dir: string, value: unknown) => {
  const path = join(dir, 'destinations.json')
  await writeFile(path, JSON.stringify(value), 'utf8')
  return path
}

const SAMPLE = {
  destinations: [
    {
      id: 'DEV', protocol: 'http',
      properties: { systemUrl: 'https://my123456.s4hana.cloud.sap:443/sap/bc/adt', systemId: 'S4D' },
      user: 'SOME_USER', authenticationKind: 'basic', password: 'never-read-this',
    },
  ],
}

test('the destinations reader keeps only id, protocol, host and systemId', async () => {
  const dir = await workspace()
  const summaries = await readDestinations(await writeDestinations(dir, SAMPLE))
  assert.deepEqual(summaries, [{ id: 'DEV', protocol: 'http', host: 'my123456.s4hana.cloud.sap', systemId: 'S4D' }])
})

test('no credential-like value survives into the serialized summary', async () => {
  const dir = await workspace()
  const serialized = JSON.stringify(await readDestinations(await writeDestinations(dir, SAMPLE)))
  for (const secret of ['SOME_USER', 'never-read-this', 'basic', 'password', 'authenticationKind']) {
    assert.equal(serialized.includes(secret), false, `${secret} leaked into the summary`)
  }
})

test('a missing or malformed destinations file yields an empty list rather than throwing', async () => {
  const dir = await workspace()
  assert.deepEqual(await readDestinations(join(dir, 'absent.json')), [])
  assert.deepEqual(await readDestinations(await writeDestinations(dir, { nope: 1 })), [])
})

test('hosts are reduced to their last three labels before they can be shown', () => {
  assert.equal(redactHost('my123456.s4hana.cloud.sap'), 's4hana.cloud.sap')
  assert.equal(redactHost('abap.internal.corp.example.com'), 'corp.example.com')
  assert.equal(redactHost('localhost'), 'localhost')
  assert.equal(redactHost(''), 'unknown-host')
})

test('the RFC protocol always means a private or on-premise system', () => {
  assert.deepEqual(
    classifyDestination({ id: 'PRD', protocol: 'rfc', host: 'anything.example.com', systemId: 'PRD' }),
    { target: 'cloud-erp-private', confidence: 'high' },
  )
})

test('host shapes classify public cloud and the BTP ABAP environment', () => {
  assert.equal(classifyDestination({ id: 'A', protocol: 'http', host: 'my123456.s4hana.cloud.sap', systemId: 'S4D' }).target, 'cloud-erp')
  assert.equal(classifyDestination({ id: 'B', protocol: 'http', host: 'my123456-api.s4hana.ondemand.com', systemId: 'S4D' }).target, 'cloud-erp')
  assert.equal(classifyDestination({ id: 'C', protocol: 'http', host: 'abcd-1234.abap.eu10.hana.ondemand.com', systemId: 'BTP' }).target, 'btp-abap-environment')
  const unknown = classifyDestination({ id: 'D', protocol: 'http', host: 'sap-internal.example.com', systemId: 'DEV' })
  assert.equal(unknown.target, 'cloud-erp-private')
  assert.equal(unknown.confidence, 'low')
})

test('an explicit request wins over everything and is high confidence', async () => {
  const config = await configFor(join(await workspace(), 'nope'))
  assert.deepEqual(await resolveTarget({ requested: 'btp-abap-environment', config }), {
    target: 'btp-abap-environment', version: 'latest', resolvedFrom: 'request', confidence: 'high',
  })
})

test('the configured pin resolves auto and carries the pinned version', async () => {
  const config = await configFor(join(await workspace(), 'nope'), {
    ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'cloud-erp-private',
    ABAP_KEBAP_RELEASED_OBJECTS_VERSION: '2023',
  })
  const resolution = await resolveTarget({ requested: 'auto', config })
  assert.equal(resolution.target, 'cloud-erp-private')
  assert.equal(resolution.version, '2023')
  assert.equal(resolution.resolvedFrom, 'environment')
})

test('a single destination resolves auto and echoes an assumption without the full host', async () => {
  const dir = await workspace()
  await writeDestinations(dir, SAMPLE)
  const resolution = await resolveTarget({ requested: 'auto', config: await configFor(dir) })
  assert.equal(resolution.target, 'cloud-erp')
  assert.equal(resolution.resolvedFrom, 'single-destination')
  assert.match(resolution.assumption ?? '', /DEV/)
  assert.equal((resolution.assumption ?? '').includes('my123456'), false)
})

test('the last logged-on session breaks a tie but is never better than medium confidence', async () => {
  const dir = await workspace()
  await writeDestinations(dir, {
    destinations: [
      { id: 'DEV', protocol: 'http', properties: { systemUrl: 'https://my1.s4hana.cloud.sap', systemId: 'S4D' } },
      { id: 'PRD', protocol: 'rfc', properties: { systemUrl: 'sapmsPRD', systemId: 'PRD' } },
    ],
  })
  await mkdir(join(dir, 'session-PRD-abc123'), { recursive: true })
  const resolution = await resolveTarget({ requested: 'auto', config: await configFor(dir) })
  assert.equal(resolution.target, 'cloud-erp-private')
  assert.equal(resolution.resolvedFrom, 'adt-session')
  assert.equal(resolution.confidence, 'medium')
  assert.equal(await lastLoggedOnDestination(dir), 'PRD')
})

test('several destinations and no hint is ambiguous, with redacted candidates', async () => {
  const dir = await workspace()
  await writeDestinations(dir, {
    destinations: [
      { id: 'DEV', protocol: 'http', properties: { systemUrl: 'https://my1.s4hana.cloud.sap', systemId: 'S4D' } },
      { id: 'PRD', protocol: 'rfc', properties: { systemUrl: 'sapmsPRD', systemId: 'PRD' } },
    ],
  })
  const config = await configFor(dir)
  const error = await resolveTarget({ requested: 'auto', config }).then(() => null, (caught: unknown) => caught)
  assert.ok(error instanceof TargetResolutionError)
  assert.equal(error.code, 'TARGET_AMBIGUOUS')
  assert.deepEqual(error.candidates.map((candidate) => candidate.id), ['DEV', 'PRD'])
  assert.equal(JSON.stringify(error.candidates).includes('my1.'), false)
})

test('nothing to go on is unresolved rather than a silent default', async () => {
  const config = await configFor(join(await workspace(), 'nope'))
  const error = await resolveTarget({ requested: 'auto', config }).then(() => null, (caught: unknown) => caught)
  assert.ok(error instanceof TargetResolutionError)
  assert.equal(error.code, 'TARGET_UNRESOLVED')
  assert.deepEqual(error.candidates, [])
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/target-resolver'`.

- [ ] **Step 4: Write `target-resolver.ts`**

```ts
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerConfig } from './config'
import type { Target } from './types'

/** How much the resolution can be trusted; echoed to the caller on every answer. */
export type Confidence = 'high' | 'medium' | 'low'

export interface DestinationSummary {
  id: string
  protocol: string
  host: string
  systemId: string
}

/**
 * Reads the ADT destinations file. Only `id`, `protocol`, the host of
 * `properties.systemUrl` and `properties.systemId` are extracted. Credential
 * fields are never bound to a named value, never returned and never logged.
 */
export async function readDestinations(path: string): Promise<DestinationSummary[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return []
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { destinations?: unknown })?.destinations
  if (!Array.isArray(list)) return []

  const summaries: DestinationSummary[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const properties = (record.properties ?? {}) as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : null
    if (!id) continue
    summaries.push({
      id,
      protocol: typeof record.protocol === 'string' ? record.protocol.toLowerCase() : 'http',
      host: hostOf(typeof properties.systemUrl === 'string' ? properties.systemUrl : ''),
      systemId: typeof properties.systemId === 'string' ? properties.systemId : '',
    })
  }
  return summaries
}

function hostOf(systemUrl: string): string {
  if (!systemUrl) return ''
  try {
    return new URL(systemUrl).hostname
  } catch {
    // RFC destinations carry a message-server string rather than a URL.
    return systemUrl.replace(/^[a-z]+:\/\//i, '').split(/[/:]/)[0] ?? ''
  }
}

/** Anything shown to a model or a user keeps at most the last three labels. */
export function redactHost(host: string): string {
  if (!host) return 'unknown-host'
  const labels = host.split('.')
  return labels.length <= 3 ? host : labels.slice(-3).join('.')
}

const PUBLIC_CLOUD = [/\.s4hana\.cloud\.sap$/i, /\.s4hana\.ondemand\.com$/i]
const BTP_ABAP = [/\.abap\.[a-z0-9-]+\.hana\.ondemand\.com$/i, /\.abap-web\.[a-z0-9-]+\.hana\.ondemand\.com$/i]

export function classifyDestination(summary: DestinationSummary): { target: Target; confidence: Confidence } {
  if (summary.protocol === 'rfc') return { target: 'cloud-erp-private', confidence: 'high' }
  if (BTP_ABAP.some((pattern) => pattern.test(summary.host))) return { target: 'btp-abap-environment', confidence: 'high' }
  if (PUBLIC_CLOUD.some((pattern) => pattern.test(summary.host))) return { target: 'cloud-erp', confidence: 'high' }
  // An unrecognised host over HTTP is most often a customer-hosted system.
  return { target: 'cloud-erp-private', confidence: 'low' }
}

/** The most recently touched `session-<id>-<hash>` folder names the last system used. */
export async function lastLoggedOnDestination(stateDir: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await readdir(stateDir)
  } catch {
    return null
  }
  let newest: { id: string; at: number } | null = null
  for (const entry of entries) {
    const match = /^session-(.+)-[^-]+$/.exec(entry)
    if (!match?.[1]) continue
    let modifiedAt = 0
    try {
      modifiedAt = (await stat(join(stateDir, entry))).mtimeMs
    } catch {
      continue
    }
    if (!newest || modifiedAt > newest.at) newest = { id: match[1], at: modifiedAt }
  }
  return newest?.id ?? null
}

export interface ResolveInput {
  requested?: Target | 'auto'
  version?: string
  config: ServerConfig
}

export interface TargetResolution {
  target: Target
  version: string
  resolvedFrom: 'request' | 'environment' | 'adt-session' | 'single-destination'
  confidence: Confidence
  assumption?: string
}

export interface TargetCandidate {
  id: string
  systemId: string
  host: string
  target: Target
}

export class TargetResolutionError extends Error {
  constructor(
    readonly code: 'TARGET_AMBIGUOUS' | 'TARGET_UNRESOLVED',
    message: string,
    readonly candidates: TargetCandidate[],
  ) {
    super(message)
    this.name = 'TargetResolutionError'
  }
}

export async function resolveTarget(input: ResolveInput): Promise<TargetResolution> {
  const { config } = input
  const version = input.version ?? config.versionPin ?? 'latest'

  if (input.requested && input.requested !== 'auto') {
    return { target: input.requested, version, resolvedFrom: 'request', confidence: 'high' }
  }

  if (config.targetPin) {
    return { target: config.targetPin, version, resolvedFrom: 'environment', confidence: 'high' }
  }

  const destinations = await readDestinations(config.adtDestinationsPath)
  const candidates: TargetCandidate[] = destinations.map((summary) => ({
    id: summary.id,
    systemId: summary.systemId,
    host: redactHost(summary.host),
    target: classifyDestination(summary).target,
  }))

  const only = destinations.length === 1 ? destinations[0] : undefined
  if (only) {
    const classified = classifyDestination(only)
    return {
      target: classified.target,
      version,
      resolvedFrom: 'single-destination',
      confidence: classified.confidence,
      assumption: `Assumed the only configured ADT destination, ${only.id} (${only.systemId || 'no system id'}), which looks like ${classified.target}.`,
    }
  }

  if (destinations.length > 1) {
    const lastId = await lastLoggedOnDestination(config.adtStateDir)
    const hinted = lastId ? destinations.find((summary) => summary.id === lastId) : undefined
    if (hinted) {
      const classified = classifyDestination(hinted)
      return {
        target: classified.target,
        version,
        // A stale session folder is a hint, never a fact: cap the confidence.
        confidence: classified.confidence === 'low' ? 'low' : 'medium',
        resolvedFrom: 'adt-session',
        assumption: `Assumed the last ADT system logged on to, ${hinted.id} (${hinted.systemId || 'no system id'}), which looks like ${classified.target}.`,
      }
    }
    throw new TargetResolutionError(
      'TARGET_AMBIGUOUS',
      'Several ADT destinations are configured and none is clearly current. Ask which system this code targets, then pass `target` explicitly.',
      candidates,
    )
  }

  throw new TargetResolutionError(
    'TARGET_UNRESOLVED',
    'No target could be determined. Ask whether this code targets SAP Cloud ERP, SAP Cloud ERP Private, or the SAP BTP ABAP environment, then pass `target` explicitly.',
    [],
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — 84 tests total (70 + 1 config case + 13 here), 0 failures.

- [ ] **Step 6: Commit (stage, show, wait for approval)**

```bash
git add mcp-server/src/target-resolver.ts mcp-server/src/config.ts mcp-server/test/target-resolver.test.ts mcp-server/test/config.test.ts
git diff --cached --stat
```

Proposed message: `feat(mcp): resolve the target system from ADT state without guessing`

---

## Task 9: `partner-index.ts`, the built-in fallback list and its generator

**Model:** Opus 5.

Spec 6.5. Partner namespaces live in one file per namespace, discovered through the GitHub contents API, with a committed list as the offline and rate-limited fallback. The template file is skipped by name, never by shape.

**Files:**
- Create: `mcp-server/src/partner-index.ts`, `mcp-server/src/partner-index.json`, `mcp-server/test/partner-index.test.ts`, `mcp-server/scripts/update-partner-index.mjs`
- Modify: `mcp-server/package.json` (the `update-partner-index` script)

**Interfaces:**
- Consumes: `HttpClient`, `HEADER_TIMEOUT_MS` (Task 2); `FileSpec` (Task 4).
- Produces: `PARTNER_DIR`, `TEMPLATE_FILE`, `namespaceOf(objectName)`, `namespaceFromFileName(fileName)`, `fileNameForNamespace(namespace)`, `PartnerEntry` (`{namespace, file}`), `BUILT_IN_PARTNER_INDEX`, `PartnerIndexOptions` (`{http, apiBaseUrl, repo}`), `PartnerIndex` with `list()`, `entryFor(objectName)`, `specFor(entry)`, `usesGithubApi`, `source`.

- [ ] **Step 1: Write the failing test**

`mcp-server/test/partner-index.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeHttp, jsonResponse } from './helpers/fixtures'
import {
  BUILT_IN_PARTNER_INDEX, fileNameForNamespace, namespaceFromFileName, namespaceOf,
  PartnerIndex, TEMPLATE_FILE,
} from '../src/partner-index'

const CONTENTS = 'contents/src/partner'
const listing = (names: string[]) => jsonResponse(names.map((name) => ({ name, type: 'file' })))
const indexWith = (route: unknown) =>
  new PartnerIndex({ http: fakeHttp({ [CONTENTS]: route as never }), apiBaseUrl: 'https://api.example', repo: 'SAP/repo' })

test('a namespace is recognised only at the start of a name', () => {
  assert.equal(namespaceOf('/OTX/CL_A'), '/OTX/')
  assert.equal(namespaceOf('/otx/cl_a'), '/OTX/')
  assert.equal(namespaceOf('MARA'), null)
  assert.equal(namespaceOf('CL_A/OTX/B'), null)
})

test('file names and namespaces convert both ways, and SAP\'s own file is not a namespace', () => {
  assert.equal(namespaceFromFileName('objectClassifications_OTX.json'), '/OTX/')
  assert.equal(fileNameForNamespace('/OTX/'), 'objectClassifications_OTX.json')
  assert.equal(namespaceFromFileName('objectClassifications_SAP.json'), null)
  assert.equal(namespaceFromFileName('objectReleaseInfoLatest.json'), null)
})

test('the template file is skipped by name', async () => {
  const entries = await indexWith(listing(['objectClassifications_OTX.json', TEMPLATE_FILE])).list()
  assert.deepEqual(entries, [{ namespace: '/OTX/', file: 'objectClassifications_OTX.json' }])
})

test('listings are sorted and deduplicated', async () => {
  const entries = await indexWith(listing(['objectClassifications_OTX.json', 'objectClassifications_ABC.json', 'objectClassifications_OTX.json'])).list()
  assert.deepEqual(entries.map((entry) => entry.namespace), ['/ABC/', '/OTX/'])
})

test('non-JSON and non-file entries are ignored', async () => {
  const entries = await indexWith(jsonResponse([
    { name: 'objectClassifications_OTX.json', type: 'file' },
    { name: 'README.md', type: 'file' },
    { name: 'objectClassifications_SUB.json', type: 'dir' },
  ])).list()
  assert.deepEqual(entries.map((entry) => entry.namespace), ['/OTX/'])
})

test('a rate-limited or failed listing falls back to the built-in list', async () => {
  const rateLimited = indexWith({ status: 403, headers: {}, body: 'rate limited' })
  assert.deepEqual(await rateLimited.list(), BUILT_IN_PARTNER_INDEX)
  assert.equal(rateLimited.source, 'built-in')

  const offline = indexWith(() => { throw new Error('fetch failed') })
  assert.deepEqual(await offline.list(), BUILT_IN_PARTNER_INDEX)
})

test('a mirror base URL turns discovery off entirely', async () => {
  const http = fakeHttp({ [CONTENTS]: listing(['objectClassifications_OTX.json']) })
  const index = new PartnerIndex({ http, apiBaseUrl: null, repo: 'SAP/repo' })
  assert.equal(index.usesGithubApi, false)
  assert.deepEqual(await index.list(), BUILT_IN_PARTNER_INDEX)
  assert.equal(http.calls.length, 0)
})

test('the listing is fetched once per instance and then served from memory', async () => {
  const http = fakeHttp({ [CONTENTS]: listing(['objectClassifications_OTX.json']) })
  const index = new PartnerIndex({ http, apiBaseUrl: 'https://api.example', repo: 'SAP/repo' })
  await index.list()
  await index.list()
  assert.equal(http.calls.length, 1)
  assert.equal(index.source, 'github-api')
})

test('an object name maps to its namespace entry, and a plain name maps to nothing', async () => {
  const index = indexWith(listing(['objectClassifications_OTX.json']))
  assert.deepEqual(await index.entryFor('/OTX/CL_A'), { namespace: '/OTX/', file: 'objectClassifications_OTX.json' })
  assert.equal(await index.entryFor('/ZZZ/CL_A'), null)
  assert.equal(await index.entryFor('MARA'), null)
})

test('the built-in list is non-empty, sorted and internally consistent', () => {
  assert.ok(BUILT_IN_PARTNER_INDEX.length > 0)
  const namespaces = BUILT_IN_PARTNER_INDEX.map((entry) => entry.namespace)
  assert.deepEqual(namespaces, [...namespaces].sort())
  for (const entry of BUILT_IN_PARTNER_INDEX) {
    assert.equal(fileNameForNamespace(entry.namespace), entry.file)
  }
})

test('a partner file spec is optional and lands under partner/ in the cache', async () => {
  const spec = indexWith(listing([])).specFor({ namespace: '/OTX/', file: 'objectClassifications_OTX.json' })
  assert.equal(spec.optional, true)
  assert.equal(spec.id, 'partner//OTX/')
  assert.equal(spec.fileName, 'partner/objectClassifications_OTX.json')
  assert.equal(spec.arrayKey, 'objectClassifications')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/partner-index'`.

- [ ] **Step 3: Write `src/partner-index.json`**

Seed it from what Spike D recorded in `_scratch/spike/partner-files.txt`. That file is the source of truth for the exact namespace set; do not invent entries. Convert each listed file name with the same rule the code uses, sort by namespace, and write:

```json
{
  "generatedAt": "2026-09-21",
  "source": "https://github.com/SAP/abap-atc-cr-cv-s4hc/tree/main/src/partner",
  "namespaces": [
    { "namespace": "/AIF/", "file": "objectClassifications_AIF.json" }
  ]
}
```

Keep every entry Spike D found, one object per line, sorted by namespace. If Spike D did not run, generate the file with `npm run update-partner-index` (Step 5) and commit whatever it produces.

- [ ] **Step 4: Write `partner-index.ts`**

```ts
import type { FileSpec } from './cache'
import { HEADER_TIMEOUT_MS, type HttpClient } from './http'
import builtIn from './partner-index.json'

export const PARTNER_DIR = 'partner'
export const TEMPLATE_FILE = 'objectClassifications__NAMESPACE.json'

const FILE_PREFIX = 'objectClassifications_'

/** A namespace is only a namespace at the start of the name: `/OTX/CL_A`. */
export function namespaceOf(objectName: string): string | null {
  const match = /^\/([A-Za-z0-9_]{1,8})\//.exec(objectName.trim())
  return match?.[1] ? `/${match[1].toUpperCase()}/` : null
}

export function namespaceFromFileName(fileName: string): string | null {
  if (fileName === TEMPLATE_FILE) return null
  if (!fileName.startsWith(FILE_PREFIX) || !fileName.endsWith('.json')) return null
  const middle = fileName.slice(FILE_PREFIX.length, -'.json'.length)
  // `objectClassifications_SAP.json` is SAP's own file, not a partner namespace.
  if (!middle || middle === 'SAP') return null
  return `/${middle.toUpperCase()}/`
}

export function fileNameForNamespace(namespace: string): string {
  return `${FILE_PREFIX}${namespace.replace(/^\/|\/$/g, '')}.json`
}

export interface PartnerEntry {
  namespace: string
  file: string
}

export const BUILT_IN_PARTNER_INDEX: PartnerEntry[] = (builtIn.namespaces as PartnerEntry[]).slice()

export interface PartnerIndexOptions {
  http: HttpClient
  /** GitHub API root, or null when the data comes from an internal mirror. */
  apiBaseUrl: string | null
  repo: string
}

export class PartnerIndex {
  private cached: PartnerEntry[] | null = null
  private origin: 'github-api' | 'built-in' = 'built-in'

  constructor(private readonly options: PartnerIndexOptions) {}

  get usesGithubApi(): boolean {
    return this.options.apiBaseUrl !== null
  }

  /** Which route produced the current list; reported by dataset_info. */
  get source(): 'github-api' | 'built-in' {
    return this.origin
  }

  async list(): Promise<PartnerEntry[]> {
    if (!this.cached) this.cached = await this.discover()
    return this.cached
  }

  private async discover(): Promise<PartnerEntry[]> {
    if (!this.options.apiBaseUrl) return BUILT_IN_PARTNER_INDEX
    const url = `${this.options.apiBaseUrl}/repos/${this.options.repo}/contents/src/partner`
    try {
      const response = await this.options.http.get(url, { accept: 'application/vnd.github+json', timeoutMs: HEADER_TIMEOUT_MS })
      if (response.status !== 200 || !response.body) return BUILT_IN_PARTNER_INDEX
      const listing = JSON.parse(response.body) as unknown
      if (!Array.isArray(listing)) return BUILT_IN_PARTNER_INDEX

      const seen = new Map<string, PartnerEntry>()
      for (const item of listing) {
        const entry = item as { name?: unknown; type?: unknown }
        if (entry.type !== 'file' || typeof entry.name !== 'string') continue
        const namespace = namespaceFromFileName(entry.name)
        if (namespace && !seen.has(namespace)) seen.set(namespace, { namespace, file: entry.name })
      }
      const entries = [...seen.values()].sort((left, right) => left.namespace.localeCompare(right.namespace))
      if (entries.length === 0) return BUILT_IN_PARTNER_INDEX
      this.origin = 'github-api'
      return entries
    } catch {
      // Offline, rate-limited or blocked by a proxy: the committed list still works.
      return BUILT_IN_PARTNER_INDEX
    }
  }

  async entryFor(objectName: string): Promise<PartnerEntry | null> {
    const namespace = namespaceOf(objectName)
    if (!namespace) return null
    return (await this.list()).find((entry) => entry.namespace === namespace) ?? null
  }

  /** Partner files are optional: a 404 or a proxy block must never fail a lookup. */
  specFor(entry: PartnerEntry): FileSpec {
    return {
      id: `partner/${entry.namespace}`,
      fileName: `${PARTNER_DIR}/${entry.file}`,
      arrayKey: 'objectClassifications',
      optional: true,
    }
  }
}
```

- [ ] **Step 5: Write the regeneration script**

`mcp-server/scripts/update-partner-index.mjs` — a maintainer tool, not part of the runtime. Plain ESM, global `fetch`, rewrites `src/partner-index.json`. Add `"update-partner-index": "node scripts/update-partner-index.mjs"` to `package.json` scripts.

```js
#!/usr/bin/env node
// Refreshes the committed fallback list of partner namespaces.
// Run: npm run update-partner-index   (needs network; GitHub rate limits apply)
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const API_URL = 'https://api.github.com/repos/SAP/abap-atc-cr-cv-s4hc/contents/src/partner'
const TEMPLATE_FILE = 'objectClassifications__NAMESPACE.json'
const FILE_PREFIX = 'objectClassifications_'

const namespaceFromFileName = (fileName) => {
  if (fileName === TEMPLATE_FILE) return null
  if (!fileName.startsWith(FILE_PREFIX) || !fileName.endsWith('.json')) return null
  const middle = fileName.slice(FILE_PREFIX.length, -'.json'.length)
  if (!middle || middle === 'SAP') return null
  return `/${middle.toUpperCase()}/`
}

const response = await fetch(API_URL, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'abap-kebap-released-objects' } })
if (!response.ok) {
  console.error(`Listing failed: ${response.status} ${response.statusText}`)
  process.exit(1)
}

const namespaces = []
for (const item of await response.json()) {
  if (item.type !== 'file') continue
  const namespace = namespaceFromFileName(item.name)
  if (namespace && !namespaces.some((entry) => entry.namespace === namespace)) {
    namespaces.push({ namespace, file: item.name })
  }
}
namespaces.sort((left, right) => left.namespace.localeCompare(right.namespace))

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'partner-index.json')
await writeFile(
  target,
  `${JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), source: 'https://github.com/SAP/abap-atc-cr-cv-s4hc/tree/main/src/partner', namespaces }, null, 2)}\n`,
  'utf8',
)
console.error(`Wrote ${namespaces.length} namespaces to ${target}`)
```

Note the `console.error`: every script in this server writes progress to stderr, because stdout is reserved for the MCP transport.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — 95 tests total, 0 failures.

- [ ] **Step 7: Commit (stage, show, wait for approval)**

```bash
git add mcp-server/src/partner-index.ts mcp-server/src/partner-index.json mcp-server/scripts/update-partner-index.mjs mcp-server/test/partner-index.test.ts mcp-server/package.json
git diff --cached --stat
```

Proposed message: `feat(mcp): discover partner namespaces with a committed fallback list`

---

## Task 10: `schemas.ts` — input contracts that teach the model how to ask

**Model:** Opus 5.

Spec 7.1 to 7.3. The `.describe()` text is not decoration: it is the only documentation the calling model sees, so it carries the vocabulary (`DDLS` for a CDS entity, `FUNC` for a function module) and the rule that Clean Core levels exist only on the private target.

**Files:**
- Create: `mcp-server/src/schemas.ts`, `mcp-server/test/schemas.test.ts`

**Interfaces:**
- Consumes: `VERSION_PATTERN` (Task 5).
- Produces: `targetSchema`, `versionSchema`, `maxLevelSchema`, `objectRefSchema`, `normalizeObjectRef(ref)`, `checkObjectsShape`, `searchObjectsShape`, `datasetInfoShape`, `checkObjectsSchema`, `searchObjectsSchema`, `datasetInfoSchema`, `CheckObjectsInput`, `SearchObjectsInput`, `DatasetInfoInput`, `MAX_BATCH`, `MAX_NAME_LENGTH`.

- [ ] **Step 1: Write the failing test**

`mcp-server/test/schemas.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkObjectsSchema, checkObjectsShape, datasetInfoSchema, datasetInfoShape,
  MAX_BATCH, MAX_NAME_LENGTH, normalizeObjectRef, searchObjectsSchema, searchObjectsShape,
} from '../src/schemas'

test('an object reference accepts a bare name or a name with a type', () => {
  assert.deepEqual(normalizeObjectRef('MARA'), { name: 'MARA' })
  assert.deepEqual(normalizeObjectRef({ name: 'MARA', type: 'TABL' }), { name: 'MARA', type: 'TABL' })
})

test('check_objects requires at least one object and caps the batch', () => {
  assert.equal(checkObjectsSchema.safeParse({ objects: [] }).success, false)
  assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'] }).success, true)
  assert.equal(checkObjectsSchema.safeParse({ objects: Array.from({ length: MAX_BATCH }, () => 'MARA') }).success, true)
  assert.equal(checkObjectsSchema.safeParse({ objects: Array.from({ length: MAX_BATCH + 1 }, () => 'MARA') }).success, false)
})

test('an object name is bounded and non-empty', () => {
  assert.equal(checkObjectsSchema.safeParse({ objects: [''] }).success, false)
  assert.equal(checkObjectsSchema.safeParse({ objects: ['X'.repeat(MAX_NAME_LENGTH + 1)] }).success, false)
})

test('target defaults to auto and rejects anything unknown', () => {
  assert.equal(checkObjectsSchema.parse({ objects: ['MARA'] }).target, 'auto')
  assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'cloud-erp' }).success, true)
  assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'on-prem' }).success, false)
})

test('a version must be latest or a release year, optionally with a feature pack', () => {
  for (const version of ['latest', '2023', '2022', '2021_1']) {
    assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'cloud-erp-private', version }).success, true, version)
  }
  for (const version of ['23', 'newest', '2023-FPS1', '']) {
    assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'cloud-erp-private', version }).success, false, version)
  }
})

test('a version on a public target is rejected with an explanatory message', () => {
  const result = checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'cloud-erp', version: '2023' })
  assert.equal(result.success, false)
  assert.match(result.error?.issues.map((issue) => issue.message).join(' ') ?? '', /private/i)
})

test('maxLevel is rejected on public cloud and BTP, where only Level A exists', () => {
  assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'cloud-erp-private', maxLevel: 'C' }).success, true)
  assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'cloud-erp', maxLevel: 'C' }).success, false)
  assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'btp-abap-environment', maxLevel: 'C' }).success, false)
  // `auto` cannot be validated here; check_objects re-checks once the target is known.
  assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], maxLevel: 'C' }).success, true)
})

test('search bounds its pagination and defaults it', () => {
  const parsed = searchObjectsSchema.parse({ query: 'purchase' })
  assert.equal(parsed.limit, 20)
  assert.equal(parsed.offset, 0)
  assert.equal(searchObjectsSchema.safeParse({ query: 'purchase', limit: 0 }).success, false)
  assert.equal(searchObjectsSchema.safeParse({ query: 'purchase', limit: 201 }).success, false)
  assert.equal(searchObjectsSchema.safeParse({ query: 'purchase', offset: -1 }).success, false)
  assert.equal(searchObjectsSchema.safeParse({ query: '' }).success, false)
})

test('dataset_info takes no required input and defaults refresh to false', () => {
  assert.equal(datasetInfoSchema.parse({}).refresh, false)
  assert.equal(datasetInfoSchema.parse({}).target, 'auto')
  assert.equal(datasetInfoSchema.safeParse({ refresh: true }).success, true)
})

test('every public field carries description text for the calling model', () => {
  for (const shape of [checkObjectsShape, searchObjectsShape, datasetInfoShape]) {
    for (const [name, field] of Object.entries(shape)) {
      assert.ok((field.description ?? '').length > 20, `${name} needs a useful description`)
    }
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/schemas'`.

- [ ] **Step 3: Write `schemas.ts`**

```ts
import { z } from 'zod'
import { VERSION_PATTERN } from './datasets'

export const MAX_BATCH = 100
export const MAX_NAME_LENGTH = 120

export const targetSchema = z
  .enum(['auto', 'cloud-erp', 'cloud-erp-private', 'btp-abap-environment'])
  .default('auto')
  .describe(
    'Which SAP system the code must run on. `cloud-erp` is SAP S/4HANA Cloud Public Edition, ' +
      '`cloud-erp-private` is Private Edition or on-premise, `btp-abap-environment` is the SAP BTP ABAP environment. ' +
      'Leave it at `auto` to resolve it from the connected ADT system; if that is not unambiguous the tool asks rather than guesses.',
  )

export const versionSchema = z
  .string()
  .regex(VERSION_PATTERN, 'Use `latest`, a release year such as `2023`, or a year with a feature pack such as `2021_1`.')
  .optional()
  .describe(
    'Release of SAP S/4HANA Cloud Private Edition to check against, such as `2023`. ' +
      'Only meaningful for `cloud-erp-private`; omit it for the public and BTP targets, which have one current state.',
  )

export const maxLevelSchema = z
  .enum(['A', 'B', 'C', 'D'])
  .optional()
  .describe(
    'Strictest Clean Core level still acceptable, and the levels are cumulative: A is released APIs, ' +
      'B adds classic APIs that are not released, C adds anything unclassified, D adds objects marked as no API. ' +
      'Only applies to `cloud-erp-private`; the public and BTP targets have Level A or nothing.',
  )

const objectRefObject = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  type: z
    .string()
    .min(1)
    .max(8)
    .optional()
    .describe('ABAP object type, when the name alone is ambiguous: `TABL`, `DDLS` for a CDS entity, `CLAS`, `INTF`, `FUNC` for a function module, `FUGR`, `DTEL`.'),
})

export const objectRefSchema = z.union([z.string().min(1).max(MAX_NAME_LENGTH), objectRefObject])

export function normalizeObjectRef(ref: z.infer<typeof objectRefSchema>): { name: string; type?: string } {
  return typeof ref === 'string' ? { name: ref } : ref
}

/** A version or a Clean Core level only means something on the private target. */
const privateOnlyRules = (value: { target?: string; version?: string; maxLevel?: string }, context: z.RefinementCtx) => {
  const isPrivate = value.target === 'cloud-erp-private'
  const isAuto = value.target === 'auto' || value.target === undefined
  if (value.version && !isPrivate && !isAuto) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['version'], message: '`version` applies only to `cloud-erp-private`; the public cloud and BTP targets have a single current state.' })
  }
  if (value.maxLevel && !isPrivate && !isAuto) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxLevel'], message: '`maxLevel` applies only to `cloud-erp-private`; on the public cloud and BTP targets an object is either released or it is not.' })
  }
}

export const checkObjectsShape = {
  objects: z
    .array(objectRefSchema)
    .min(1)
    .max(MAX_BATCH)
    .describe(
      'The ABAP objects to check, as names such as `MARA` or as `{name, type}` when the name is ambiguous. ' +
        `Send every object from one piece of code in a single call, up to ${MAX_BATCH}.`,
    ),
  target: targetSchema,
  version: versionSchema,
  maxLevel: maxLevelSchema,
} as const

export const searchObjectsShape = {
  query: z
    .string()
    .min(1)
    .max(MAX_NAME_LENGTH)
    .describe('Name or fragment to look for. Several words all have to appear, so `purchase order` finds `I_PurchaseOrderItem`.'),
  objectType: z.string().min(1).max(8).optional().describe('Restrict to one ABAP object type, such as `DDLS` for CDS entities or `CLAS` for classes.'),
  applicationComponent: z.string().min(1).max(40).optional().describe('Restrict to an SAP application component path or its start, such as `MM-PUR` for purchasing.'),
  state: z
    .enum(['released', 'deprecated', 'notToBeReleased', 'classicAPI', 'noAPI'])
    .optional()
    .describe('Restrict to one published state, exactly as SAP records it.'),
  maxLevel: maxLevelSchema,
  label: z.string().min(1).max(40).optional().describe('Restrict to objects carrying an SAP label, such as `remote-enabled`.'),
  limit: z.number().int().min(1).max(200).default(20).describe('How many results to return; the response always reports the full match count too.'),
  offset: z.number().int().min(0).default(0).describe('How many results to skip, for paging through a large match set.'),
  target: targetSchema,
  version: versionSchema,
} as const

export const datasetInfoShape = {
  target: targetSchema,
  version: versionSchema,
  refresh: z
    .boolean()
    .default(false)
    .describe('Check SAP for newer data right now instead of waiting for the once-a-day check. Use it when the data looks stale, not routinely.'),
} as const

export const checkObjectsSchema = z.object(checkObjectsShape).superRefine(privateOnlyRules)
export const searchObjectsSchema = z.object(searchObjectsShape).superRefine(privateOnlyRules)
export const datasetInfoSchema = z.object(datasetInfoShape).superRefine(privateOnlyRules)

export type CheckObjectsInput = z.infer<typeof checkObjectsSchema>
export type SearchObjectsInput = z.infer<typeof searchObjectsSchema>
export type DatasetInfoInput = z.infer<typeof datasetInfoSchema>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — 105 tests total, 0 failures.

- [ ] **Step 5: Commit (stage, show, wait for approval)**

```bash
git add mcp-server/src/schemas.ts mcp-server/test/schemas.test.ts
git diff --cached --stat
```

Proposed message: `feat(mcp): define tool input schemas with model-facing documentation`

---

## Task 11: shared tool context and the `check_objects` tool

**Model:** Opus 5.

Spec 7.1 and 7.4. This is the tool that matters: an agent asks "may I use these objects on this system" and gets a verdict per object, with the successor when there is one.

**File Structure addendum:** this task adds `mcp-server/src/tools/context.ts`, a third deviation from spec 16 with the same rationale as the two recorded earlier — it holds the per-request wiring the spec left implicit, and putting it in `types.ts` would invert the layering.

**Files:**
- Create: `mcp-server/src/tools/context.ts`, `mcp-server/src/tools/check-objects.ts`, `mcp-server/test/check-objects.test.ts`

**Interfaces:**
- Consumes: `CacheManager`, `CacheError`, `FileSpec`, `ManifestFileEntry` (Tasks 3 and 4); `DatasetRegistry`, `resolveFiles`, `coreFileSpecs` (Task 5); `lookupObject`, `suggestNearMatches`, `vendorHint`, `impliedLevelFor`, `SearchPool`, `ClassificationLookup` (Tasks 6 and 7); `resolveTarget`, `TargetResolutionError` (Task 8); `PartnerIndex`, `namespaceOf` (Task 9); `ServerConfig` (Task 1); `normalizeObjectRef`, `CheckObjectsInput` (Task 10).
- Produces: `ServerContext` (`{cache, registry, partnerIndex, config}`), `ToolResult`, `ToolErrorCode`, `TOOL_ERROR_CODES`, `toolSuccess(payload)`, `toolFailure(code, message, extra?)`, `failureFor(error)`, `FileSummary`, `LoadedTarget`, `loadTarget(context, request)`, `handleCheckObjects(context, input)`, `CHECK_OBJECTS_DESCRIPTION`.

- [ ] **Step 1: Write the failing test**

`mcp-server/test/check-objects.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CacheManager } from '../src/cache'
import { loadConfig } from '../src/config'
import { DatasetRegistry } from '../src/datasets'
import { PartnerIndex } from '../src/partner-index'
import { handleCheckObjects } from '../src/tools/check-objects'
import { fakeHttp, jsonResponse, unreachable } from './helpers/fixtures'
import type { Route } from './helpers/fixtures'
import type { ServerContext } from '../src/tools/context'

const record = (over: Record<string, unknown>) => ({ tadirObject: 'TABL', tadirObjName: 'X', objectType: 'TABL', objectKey: 'X', state: 'released', ...over })

const BTP_FILE = 'objectReleaseInfo_BTPLatest.json'

const btpCorpus = () => jsonResponse({
  formatVersion: 1,
  objectReleaseInfo: [
    record({ objectKey: 'MARA', tadirObjName: 'MARA', state: 'notToBeReleased' }),
    record({ objectKey: 'I_PRODUCT', tadirObjName: 'I_PRODUCT', objectType: 'DDLS', tadirObject: 'DDLS', state: 'released' }),
    record({ objectKey: 'CL_OLD', tadirObjName: 'CL_OLD', objectType: 'CLAS', tadirObject: 'CLAS', state: 'deprecated', successors: [{ objectType: 'CLAS', objectKey: 'CL_NEW' }] }),
  ],
})

async function makeContext(route: Route = btpCorpus(), env: NodeJS.ProcessEnv = {}): Promise<ServerContext> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ro-check-'))
  const http = fakeHttp({ [BTP_FILE]: route })
  const config = loadConfig([], {
    ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: dataDir,
    ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'btp-abap-environment',
    ABAP_KEBAP_ADT_STATE_DIR: join(dataDir, 'no-adt'),
    ...env,
  }, dataDir)
  const cache = new CacheManager({
    dataDir: config.dataDir,
    baseUrl: config.baseUrl,
    githubApi: null,
    http,
    now: () => new Date('2026-09-21T08:00:00Z'),
    log: () => {},
  })
  return { cache, registry: new DatasetRegistry(cache), partnerIndex: new PartnerIndex({ http, apiBaseUrl: null, repo: 'SAP/repo' }), config }
}

const payloadOf = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]?.text ?? '{}')

test('a released object comes back allowed, with the resolved target echoed', async () => {
  const payload = payloadOf(await handleCheckObjects(await makeContext(), { objects: ['I_PRODUCT'], target: 'auto' } as never))
  assert.equal(payload.target, 'btp-abap-environment')
  assert.equal(payload.resolvedFrom, 'environment')
  assert.equal(payload.results[0].verdict, 'allowed')
})

test('a blocked object comes back blocked and the summary counts it', async () => {
  const payload = payloadOf(await handleCheckObjects(await makeContext(), { objects: ['MARA', 'I_PRODUCT'], target: 'auto' } as never))
  assert.equal(payload.results[0].verdict, 'blocked')
  assert.deepEqual(payload.summary, { total: 2, allowed: 1, blocked: 1, deprecated: 0, notFound: 0, ambiguous: 0 })
})

test('a deprecated object reports its successor', async () => {
  const payload = payloadOf(await handleCheckObjects(await makeContext(), { objects: [{ name: 'CL_OLD', type: 'CLAS' }], target: 'auto' } as never))
  assert.equal(payload.results[0].verdict, 'allowed-deprecated')
  assert.deepEqual(payload.results[0].matches[0].successors, [{ kind: 'object', objectType: 'CLAS', objectKey: 'CL_NEW' }])
})

test('an unknown object carries suggestions and the standing hint', async () => {
  const payload = payloadOf(await handleCheckObjects(await makeContext(), { objects: ['I_PRODUC'], target: 'auto' } as never))
  assert.equal(payload.results[0].verdict, 'not-found')
  assert.equal(payload.results[0].suggestions[0].objectKey, 'I_PRODUCT')
  assert.ok(payload.results[0].hint.length > 0)
})

test('absent means not released on BTP, and that is stated in the payload', async () => {
  const payload = payloadOf(await handleCheckObjects(await makeContext(), { objects: ['ZZ_CUSTOM'], target: 'auto' } as never))
  assert.equal(payload.impliedLevelWhenAbsent, 'none')
  assert.equal(payload.results[0].allowed, false)
})

test('the dataset provenance travels with every answer', async () => {
  const payload = payloadOf(await handleCheckObjects(await makeContext(), { objects: ['MARA'], target: 'auto' } as never))
  assert.equal(payload.dataset.status, 'fresh')
  assert.equal(payload.dataset.files[0].fileName, BTP_FILE)
  assert.equal(typeof payload.dataset.files[0].downloadedAt, 'string')
  assert.equal(payload.dataset.files[0].entries, 3)
})

test('an unresolvable target is an error result, not a guess', async () => {
  const context = await makeContext(btpCorpus(), { ABAP_KEBAP_RELEASED_OBJECTS_TARGET: '' })
  const result = await handleCheckObjects(context, { objects: ['MARA'], target: 'auto' } as never)
  assert.equal(result.isError, true)
  assert.equal(payloadOf(result).error.code, 'TARGET_UNRESOLVED')
})

test('maxLevel on a resolved public target is refused after resolution, not silently ignored', async () => {
  const result = await handleCheckObjects(await makeContext(), { objects: ['MARA'], target: 'auto', maxLevel: 'C' } as never)
  assert.equal(result.isError, true)
  assert.equal(payloadOf(result).error.code, 'INVALID_ARGUMENT')
})

test('an unavailable dataset is an error result with a recovery hint', async () => {
  const result = await handleCheckObjects(await makeContext(unreachable()), { objects: ['MARA'], target: 'auto' } as never)
  assert.equal(result.isError, true)
  assert.equal(payloadOf(result).error.code, 'DATASET_UNAVAILABLE')
  assert.ok(payloadOf(result).error.hint.length > 0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/tools/check-objects'`.

- [ ] **Step 3: Write `src/tools/context.ts`**

```ts
import { CacheError, type CacheManager, type FileSpec } from '../cache'
import type { ServerConfig } from '../config'
import { resolveFiles, type Dataset, type DatasetRegistry } from '../datasets'
import { namespaceOf, type PartnerIndex } from '../partner-index'
import type { ClassificationLookup, SearchPool } from '../query'
import { resolveTarget, TargetResolutionError, type TargetResolution } from '../target-resolver'
import type { RawRecord, Target } from '../types'

export interface ServerContext {
  cache: CacheManager
  registry: DatasetRegistry
  partnerIndex: PartnerIndex
  config: ServerConfig
}

export const TOOL_ERROR_CODES = [
  'TARGET_AMBIGUOUS', 'TARGET_UNRESOLVED', 'DATASET_UNAVAILABLE',
  'DATASET_DOWNLOADING', 'INVALID_ARGUMENT', 'INTERNAL_ERROR',
] as const
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number]

export interface ToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

export function toolSuccess(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

export function toolFailure(code: ToolErrorCode, message: string, extra: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: { code, message, ...extra } }, null, 2) }], isError: true }
}

const OFFLINE_HINT =
  'SAP data is not cached and this machine cannot reach the source. Check the proxy settings (HTTPS_PROXY, NO_PROXY, ' +
  'NODE_EXTRA_CA_CERTS) or set ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL to an internal mirror, then call dataset_info with refresh.'

export function failureFor(error: unknown): ToolResult {
  if (error instanceof TargetResolutionError) {
    return toolFailure(error.code, error.message, { candidates: error.candidates })
  }
  if (error instanceof CacheError) {
    if (error.code === 'DATASET_UNAVAILABLE') return toolFailure('DATASET_UNAVAILABLE', error.message, { hint: OFFLINE_HINT })
    if (error.code === 'DATASET_DOWNLOADING') return toolFailure('DATASET_DOWNLOADING', error.message, { retryAfterSeconds: error.retryAfterSeconds ?? 30 })
    return toolFailure('INVALID_ARGUMENT', error.message)
  }
  return toolFailure('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
}

/** One cached file as reported to the caller; drawn from the manifest, never guessed. */
export interface FileSummary {
  id: string
  fileName: string
  status: string
  entries: number | null
  bytes: number | null
  downloadedAt: string | null
  upstreamCommittedAt: string | null
  error: string | null
}

export interface LoadedTarget {
  resolution: TargetResolution
  releaseInfo: Dataset
  classification: Dataset | null
  classificationOf: ClassificationLookup
  specs: FileSpec[]
  fileSummaries(): FileSummary[]
  datasetStatus(): 'fresh' | 'stale'
  pools(): SearchPool[]
  partnerFor(objectName: string): Promise<{ dataset: Dataset; namespace: string } | null>
}

export async function loadTarget(context: ServerContext, request: { target?: Target | 'auto'; version?: string }): Promise<LoadedTarget> {
  const resolution = await resolveTarget({ requested: request.target, version: request.version, config: context.config })
  const resolved = resolveFiles(resolution.target, resolution.version)

  const { dataset: releaseInfo, spec: releaseSpec } = await context.registry.loadFirstAvailable(resolved.releaseInfoCandidates)
  const classification = resolved.classification ? await context.registry.load(resolved.classification) : null

  const specs: FileSpec[] = resolved.classification ? [releaseSpec, resolved.classification] : [releaseSpec]
  // Open the daily gate for exactly the files this request touches; never block on it.
  context.cache.ensureFresh(specs)

  const classificationOf: ClassificationLookup = (record: RawRecord) => {
    if (!classification) return null
    const bucket = classification.byKey.get(record.objectKey.toUpperCase())
    return bucket?.find((entry) => entry.objectType === record.objectType)?.state ?? null
  }

  const partnerCache = new Map<string, Dataset | null>()

  return {
    resolution,
    releaseInfo,
    classification,
    classificationOf,
    specs,
    fileSummaries() {
      const manifest = context.cache.readManifest()
      return specs.map((spec) => {
        const entry = manifest.files[spec.id] ?? null
        return {
          id: spec.id,
          fileName: spec.fileName,
          status: context.cache.status(spec.id),
          entries: entry?.entries ?? null,
          bytes: entry?.bytes ?? null,
          downloadedAt: entry?.downloadedAt ?? null,
          upstreamCommittedAt: entry?.upstreamCommittedAt ?? null,
          error: entry?.lastError ?? null,
        }
      })
    },
    datasetStatus() {
      const manifest = context.cache.readManifest()
      const clean = specs.every((spec) => !(manifest.files[spec.id]?.lastError))
      return clean && !manifest.lastCheckError ? 'fresh' : 'stale'
    },
    pools() {
      const pools: SearchPool[] = [{ dataset: releaseInfo, origin: 'sap' }]
      if (classification) pools.push({ dataset: classification, origin: 'sap' })
      for (const [namespace, dataset] of partnerCache) {
        if (dataset) pools.push({ dataset, origin: `partner:${namespace}` })
      }
      return pools
    },
    async partnerFor(objectName: string) {
      const namespace = namespaceOf(objectName)
      if (!namespace) return null
      if (!partnerCache.has(namespace)) {
        const entry = await context.partnerIndex.entryFor(objectName)
        let dataset: Dataset | null = null
        if (entry) {
          try {
            dataset = await context.registry.load(context.partnerIndex.specFor(entry))
          } catch {
            // Optional by design: a missing partner file never fails the lookup.
            dataset = null
          }
        }
        partnerCache.set(namespace, dataset)
      }
      const dataset = partnerCache.get(namespace) ?? null
      return dataset ? { dataset, namespace } : null
    },
  }
}
```

- [ ] **Step 4: Write `src/tools/check-objects.ts`**

```ts
import { namespaceOf } from '../partner-index'
import { impliedLevelFor, lookupObject, suggestNearMatches, vendorHint, type ObjectResult } from '../query'
import { normalizeObjectRef, type CheckObjectsInput } from '../schemas'
import { failureFor, loadTarget, toolFailure, toolSuccess, type ServerContext, type ToolResult } from './context'
import type { MaxLevel } from '../types'

export const CHECK_OBJECTS_DESCRIPTION =
  'Checks whether SAP standard objects may be used on a given SAP system, using SAP\'s own released-object data. ' +
  'Call it before writing or reviewing ABAP that touches SAP tables, CDS entities, classes or function modules. ' +
  'Returns a verdict per object, the Clean Core level on private systems, and the successor for deprecated objects. ' +
  'Custom Z or Y objects are never listed and come back as not-found, which is not a verdict about them.'

export async function handleCheckObjects(context: ServerContext, input: CheckObjectsInput): Promise<ToolResult> {
  let loaded
  try {
    loaded = await loadTarget(context, { target: input.target, version: input.version })
  } catch (error) {
    return failureFor(error)
  }

  const { resolution } = loaded
  if (input.maxLevel && resolution.target !== 'cloud-erp-private') {
    return toolFailure(
      'INVALID_ARGUMENT',
      `\`maxLevel\` applies only to cloud-erp-private, and this request resolved to ${resolution.target}, where an object is either released or it is not.`,
    )
  }
  const maxLevel: MaxLevel = input.maxLevel ?? (resolution.target === 'cloud-erp-private' ? 'C' : 'A')

  const results: ObjectResult[] = []
  for (const ref of input.objects) {
    const request = normalizeObjectRef(ref)
    const partner = await loaded.partnerFor(request.name)
    const result = lookupObject(
      {
        target: resolution.target,
        releaseInfo: loaded.releaseInfo,
        classification: loaded.classification,
        partner: partner?.dataset ?? null,
        partnerNamespace: partner?.namespace ?? null,
      },
      request,
      maxLevel,
    )
    if (!result.found) {
      result.suggestions = suggestNearMatches(loaded.pools(), request.name, resolution.target, loaded.classificationOf)
      const namespace = namespaceOf(request.name)
      if (namespace && !partner) result.hint = [result.hint, vendorHint(namespace)].filter(Boolean).join(' ')
    }
    results.push(result)
  }

  return toolSuccess({
    target: resolution.target,
    version: resolution.version,
    resolvedFrom: resolution.resolvedFrom,
    confidence: resolution.confidence,
    ...(resolution.assumption ? { assumption: resolution.assumption } : {}),
    maxLevel,
    impliedLevelWhenAbsent: impliedLevelFor(resolution.target),
    dataset: { status: loaded.datasetStatus(), files: loaded.fileSummaries() },
    summary: {
      total: results.length,
      allowed: results.filter((result) => result.verdict === 'allowed' || result.verdict === 'allowed-deprecated').length,
      blocked: results.filter((result) => result.verdict === 'blocked').length,
      deprecated: results.filter((result) => result.verdict === 'allowed-deprecated').length,
      notFound: results.filter((result) => result.verdict === 'not-found').length,
      ambiguous: results.filter((result) => result.verdict === 'ambiguous').length,
    },
    results,
  })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — 114 tests total, 0 failures.

- [ ] **Step 6: Commit (stage, show, wait for approval)**

```bash
git add mcp-server/src/tools/context.ts mcp-server/src/tools/check-objects.ts mcp-server/test/check-objects.test.ts
git diff --cached --stat
```

Proposed message: `feat(mcp): add the check_objects tool`

---

## Task 12: the `search_objects` tool

**Model:** Opus 5.

Spec 7.2. The complement to `check_objects`: the agent knows what it wants to do but not what SAP called it, so it searches for a released replacement instead of inventing one.

**Files:**
- Create: `mcp-server/src/tools/search-objects.ts`, `mcp-server/test/search-objects.test.ts`

**Interfaces:**
- Consumes: `loadTarget`, `toolSuccess`, `toolFailure`, `failureFor`, `ServerContext`, `ToolResult` (Task 11); `searchObjects`, `SearchRequest` (Task 7); `SearchObjectsInput` (Task 10).
- Produces: `handleSearchObjects(context, input)`, `SEARCH_OBJECTS_DESCRIPTION`, `EMPTY_RESULT_HINT`.

- [ ] **Step 1: Write the failing test**

`mcp-server/test/search-objects.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CacheManager } from '../src/cache'
import { loadConfig } from '../src/config'
import { DatasetRegistry } from '../src/datasets'
import { PartnerIndex } from '../src/partner-index'
import { handleSearchObjects } from '../src/tools/search-objects'
import { fakeHttp, jsonResponse } from './helpers/fixtures'
import type { ServerContext } from '../src/tools/context'

const BTP_FILE = 'objectReleaseInfo_BTPLatest.json'
const PARTNER_FILE = 'objectClassifications_OTX.json'
const PARTNER_LISTING = 'contents/src/partner'

const record = (over: Record<string, unknown>) => ({
  tadirObject: 'DDLS', tadirObjName: 'X', objectType: 'DDLS', objectKey: 'X',
  softwareComponent: 'SAP_BASIS', applicationComponent: 'BC-SRV', state: 'released', ...over,
})

const corpus = () => jsonResponse({
  formatVersion: 1,
  objectReleaseInfo: [
    record({ objectKey: 'I_PURCHASEORDER', tadirObjName: 'I_PURCHASEORDER', applicationComponent: 'MM-PUR-PO' }),
    record({ objectKey: 'I_PURCHASEORDERITEM', tadirObjName: 'I_PURCHASEORDERITEM', applicationComponent: 'MM-PUR-PO' }),
    record({ objectKey: 'CL_PURCHASE_HELPER', tadirObjName: 'CL_PURCHASE_HELPER', objectType: 'CLAS', tadirObject: 'CLAS', state: 'deprecated' }),
    record({ objectKey: 'I_SALESORDER', tadirObjName: 'I_SALESORDER', applicationComponent: 'SD-SLS', labels: ['remote-enabled'] }),
  ],
})

async function makeContext(): Promise<ServerContext> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ro-search-'))
  const http = fakeHttp({
    [PARTNER_LISTING]: jsonResponse([{ name: PARTNER_FILE, type: 'file' }]),
    [PARTNER_FILE]: jsonResponse({
      formatVersion: '2',
      objectClassifications: [record({ objectKey: '/OTX/CL_PURCHASE_BRIDGE', tadirObjName: '/OTX/CL_PURCHASE_BRIDGE', objectType: 'CLAS', tadirObject: 'CLAS', state: 'classicAPI' })],
    }),
    [BTP_FILE]: corpus(),
  })
  const config = loadConfig([], {
    ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: dataDir,
    ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'btp-abap-environment',
    ABAP_KEBAP_ADT_STATE_DIR: join(dataDir, 'no-adt'),
  }, dataDir)
  const cache = new CacheManager({
    dataDir: config.dataDir, baseUrl: config.baseUrl, githubApi: null, http,
    now: () => new Date('2026-09-21T08:00:00Z'), log: () => {},
  })
  return {
    cache,
    registry: new DatasetRegistry(cache),
    partnerIndex: new PartnerIndex({ http, apiBaseUrl: 'https://api.example', repo: 'SAP/repo' }),
    config,
  }
}

const payloadOf = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]?.text ?? '{}')
const search = async (input: Record<string, unknown>) =>
  payloadOf(await handleSearchObjects(await makeContext(), { target: 'auto', limit: 20, offset: 0, ...input } as never))

test('a fragment matches every object that contains it', async () => {
  const payload = await search({ query: 'purchaseorder' })
  assert.equal(payload.total, 2)
  assert.deepEqual(payload.results.map((hit: { objectKey: string }) => hit.objectKey), ['I_PURCHASEORDER', 'I_PURCHASEORDERITEM'])
})

test('paging reports the full total and returns only the requested window', async () => {
  const payload = await search({ query: 'purchase', limit: 1, offset: 1 })
  assert.equal(payload.total, 3)
  assert.equal(payload.results.length, 1)
  assert.equal(payload.returned, 1)
  assert.equal(payload.offset, 1)
})

test('an object type filter narrows the result set', async () => {
  const payload = await search({ query: 'purchase', objectType: 'CLAS' })
  assert.equal(payload.total, 1)
  assert.equal(payload.results[0].objectKey, 'CL_PURCHASE_HELPER')
})

test('an application component filter matches on the path prefix', async () => {
  const payload = await search({ query: 'I_', applicationComponent: 'MM-PUR' })
  assert.equal(payload.total, 2)
})

test('a state filter selects the published state exactly', async () => {
  const payload = await search({ query: 'purchase', state: 'deprecated' })
  assert.equal(payload.total, 1)
  assert.equal(payload.results[0].releaseState, 'deprecated')
})

test('a label filter selects objects carrying that SAP label', async () => {
  const payload = await search({ query: 'I_', label: 'remote-enabled' })
  assert.equal(payload.total, 1)
  assert.equal(payload.results[0].objectKey, 'I_SALESORDER')
})

test('a query in a partner namespace pulls that partner file into the search', async () => {
  const payload = await search({ query: '/OTX/CL_PURCHASE' })
  assert.equal(payload.total, 1)
  assert.equal(payload.results[0].origin, 'partner:/OTX/')
})

test('maxLevel is refused once the target resolves to a non-private system', async () => {
  const result = await handleSearchObjects(await makeContext(), { query: 'purchase', target: 'auto', maxLevel: 'C', limit: 20, offset: 0 } as never)
  assert.equal(result.isError, true)
  assert.equal(payloadOf(result).error.code, 'INVALID_ARGUMENT')
})

test('no match returns an empty list with a hint rather than an error', async () => {
  const payload = await search({ query: 'zzz_nothing_here' })
  assert.equal(payload.total, 0)
  assert.deepEqual(payload.results, [])
  assert.ok(payload.hint.length > 0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/tools/search-objects'`.

- [ ] **Step 3: Write `src/tools/search-objects.ts`**

```ts
import { searchObjects, type SearchRequest } from '../query'
import type { SearchObjectsInput } from '../schemas'
import { failureFor, loadTarget, toolFailure, toolSuccess, type ServerContext, type ToolResult } from './context'

export const SEARCH_OBJECTS_DESCRIPTION =
  'Searches SAP\'s released-object data by name fragment, object type, application component, state or label. ' +
  'Use it to find the released API for a task, or the replacement for an object that check_objects reported as blocked or deprecated. ' +
  'Returns the matches with their Clean Core level for the resolved system, plus the full match count for paging.'

export const EMPTY_RESULT_HINT =
  'Nothing matched. Try a shorter fragment or the SAP business term rather than a table name, drop the filters, ' +
  'or search the application component (for example `MM-PUR`) to see what that area publishes.'

export async function handleSearchObjects(context: ServerContext, input: SearchObjectsInput): Promise<ToolResult> {
  let loaded
  try {
    loaded = await loadTarget(context, { target: input.target, version: input.version })
  } catch (error) {
    return failureFor(error)
  }

  const { resolution } = loaded
  if (input.maxLevel && resolution.target !== 'cloud-erp-private') {
    return toolFailure(
      'INVALID_ARGUMENT',
      `\`maxLevel\` applies only to cloud-erp-private, and this request resolved to ${resolution.target}, where an object is either released or it is not.`,
    )
  }

  // A query written in a partner namespace only makes sense if that partner's file is in the pool.
  await loaded.partnerFor(input.query)

  const request: SearchRequest = {
    query: input.query,
    objectType: input.objectType,
    applicationComponent: input.applicationComponent,
    state: input.state,
    maxLevel: input.maxLevel,
    label: input.label,
    limit: input.limit,
    offset: input.offset,
  }
  const outcome = searchObjects(loaded.pools(), request, resolution.target, loaded.classificationOf)

  return toolSuccess({
    target: resolution.target,
    version: resolution.version,
    resolvedFrom: resolution.resolvedFrom,
    confidence: resolution.confidence,
    ...(resolution.assumption ? { assumption: resolution.assumption } : {}),
    query: input.query,
    total: outcome.total,
    returned: outcome.results.length,
    offset: input.offset,
    limit: input.limit,
    dataset: { status: loaded.datasetStatus(), files: loaded.fileSummaries() },
    results: outcome.results,
    ...(outcome.total === 0 ? { hint: EMPTY_RESULT_HINT } : {}),
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — 123 tests total, 0 failures.

- [ ] **Step 5: Commit (stage, show, wait for approval)**

```bash
git add mcp-server/src/tools/search-objects.ts mcp-server/test/search-objects.test.ts
git diff --cached --stat
```

Proposed message: `feat(mcp): add the search_objects tool`

---

## Task 13: the `dataset_info` tool

**Model:** Opus 5.

Spec 7.3. This is the tool that makes the cache auditable: which SAP files are on disk, how large, when they were downloaded, when SAP last changed them, and whether the daily check succeeded. It is also the only way to force a refresh, and unlike the other two it always answers — a target that cannot be resolved is reported as a field, not raised as an error, because the caller may be running it precisely to find out why.

**Files:**
- Create: `mcp-server/src/tools/dataset-info.ts`, `mcp-server/test/dataset-info.test.ts`

**Interfaces:**
- Consumes: `CacheManager`, `FileSpec` (Tasks 3 and 4); `resolveFiles`, `coreFileSpecs` (Task 5); `resolveTarget`, `TargetResolutionError` (Task 8); `PartnerIndex` (Task 9); `SERVER_VERSION`, `SOURCE_REPO`, `DEFAULT_BASE_URL` (Task 1); `DatasetInfoInput` (Task 10); `failureFor`, `toolSuccess`, `FileSummary`, `ServerContext` (Task 11).
- Produces: `handleDatasetInfo(context, input)`, `DATASET_INFO_DESCRIPTION`.

- [ ] **Step 1: Write the failing test**

`mcp-server/test/dataset-info.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CacheManager } from '../src/cache'
import { loadConfig } from '../src/config'
import { DatasetRegistry } from '../src/datasets'
import { PartnerIndex } from '../src/partner-index'
import { handleDatasetInfo } from '../src/tools/dataset-info'
import { fakeHttp, jsonResponse, notModified, unreachable } from './helpers/fixtures'
import type { FakeHttp, Route } from './helpers/fixtures'
import type { ServerContext } from '../src/tools/context'

const BTP_FILE = 'objectReleaseInfo_BTPLatest.json'

const corpus = (etag = '"v1"') => jsonResponse({
  formatVersion: 1,
  objectReleaseInfo: [
    { tadirObject: 'TABL', tadirObjName: 'MARA', objectType: 'TABL', objectKey: 'MARA', state: 'notToBeReleased' },
  ],
}, etag)

async function makeContext(route: Route = corpus(), env: NodeJS.ProcessEnv = {}): Promise<{ context: ServerContext; http: FakeHttp }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ro-info-'))
  const http = fakeHttp({ [BTP_FILE]: route })
  const config = loadConfig([], {
    ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: dataDir,
    ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'btp-abap-environment',
    ABAP_KEBAP_ADT_STATE_DIR: join(dataDir, 'no-adt'),
    ...env,
  }, dataDir)
  const cache = new CacheManager({
    dataDir: config.dataDir, baseUrl: config.baseUrl, githubApi: null, http,
    now: () => new Date('2026-09-21T08:00:00Z'), log: () => {},
  })
  const context: ServerContext = {
    cache,
    registry: new DatasetRegistry(cache),
    partnerIndex: new PartnerIndex({ http, apiBaseUrl: null, repo: 'SAP/abap-atc-cr-cv-s4hc' }),
    config,
  }
  return { context, http }
}

const payloadOf = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]?.text ?? '{}')
const info = async (context: ServerContext, input: Record<string, unknown> = {}) =>
  payloadOf(await handleDatasetInfo(context, { target: 'auto', refresh: false, ...input } as never))

test('the server names itself and cites the SAP repository it copies from', async () => {
  const { context } = await makeContext()
  const payload = await info(context)
  assert.equal(payload.server.name, 'released-objects')
  assert.match(payload.source.repo, /abap-atc-cr-cv-s4hc/)
  assert.equal(payload.source.usesGithubApi, false)
})

test('a downloaded file is reported with its size, entry count and download time', async () => {
  const { context } = await makeContext()
  await info(context)
  const payload = await info(context)
  const file = payload.files.find((entry: { fileName: string }) => entry.fileName === BTP_FILE)
  assert.equal(file.status, 'ready')
  assert.equal(file.entries, 1)
  assert.ok(file.bytes > 0)
  assert.equal(typeof file.downloadedAt, 'string')
})

test('a second call on the same day does not go back to SAP', async () => {
  const { context, http } = await makeContext()
  await info(context)
  const before = http.calls.length
  await info(context)
  assert.equal(http.calls.length, before)
})

test('refresh asks SAP again and reports that the copy is unchanged', async () => {
  const { context, http } = await makeContext()
  await info(context)
  const before = http.calls.length
  http.setRoute(BTP_FILE, notModified('"v1"'))
  const payload = await info(context, { refresh: true })
  assert.ok(http.calls.length > before)
  assert.equal(payload.files.find((entry: { fileName: string }) => entry.fileName === BTP_FILE).status, 'ready')
  assert.equal(payload.lastCheckError, null)
})

test('a failed check is reported without discarding the copy already on disk', async () => {
  const { context, http } = await makeContext()
  await info(context)
  http.setRoute(BTP_FILE, unreachable('socket hang up'))
  const payload = await info(context, { refresh: true })
  assert.match(payload.lastCheckError, /socket hang up/)
  assert.equal(payload.files.find((entry: { fileName: string }) => entry.fileName === BTP_FILE).status, 'ready')
})

test('with nothing cached and no network, the answer says offline and names the missing file', async () => {
  const { context } = await makeContext(unreachable())
  const payload = await info(context, { refresh: true })
  assert.equal(payload.offline, true)
  assert.equal(payload.files.find((entry: { fileName: string }) => entry.fileName === BTP_FILE).status, 'missing')
  assert.ok(payload.hint.length > 0)
})

test('an unresolved target is reported as a field, and the core files are still listed', async () => {
  const { context } = await makeContext(corpus(), { ABAP_KEBAP_RELEASED_OBJECTS_TARGET: '' })
  const payload = await info(context)
  assert.equal(payload.target, null)
  assert.equal(payload.targetProblem.code, 'TARGET_UNRESOLVED')
  assert.ok(payload.files.length >= 1)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/tools/dataset-info'`.

- [ ] **Step 3: Write `src/tools/dataset-info.ts`**

```ts
import type { FileSpec } from '../cache'
import { DEFAULT_BASE_URL, SERVER_VERSION, SOURCE_REPO } from '../config'
import { coreFileSpecs, resolveFiles } from '../datasets'
import { resolveTarget, TargetResolutionError, type TargetResolution } from '../target-resolver'
import { failureFor, toolSuccess, type FileSummary, type ServerContext, type ToolResult } from './context'

export const DATASET_INFO_DESCRIPTION =
  'Reports where the released-object data came from, which SAP files are cached, how big they are, when they were downloaded ' +
  'and when SAP last changed them. Call it when an answer looks stale or wrong, or when check_objects reports the data as unavailable. ' +
  'Set refresh to true to check SAP for newer data immediately instead of waiting for the once-a-day check.'

const OFFLINE_HINT =
  'No SAP data is cached and the source could not be reached. Check HTTPS_PROXY, NO_PROXY and NODE_EXTRA_CA_CERTS, ' +
  'or point ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL at an internal mirror of the SAP repository, then call this tool again with refresh.'

/** Deduplicates by spec id, keeping the first occurrence, so the file list reads in a stable order. */
function uniqueSpecs(specs: FileSpec[]): FileSpec[] {
  const seen = new Map<string, FileSpec>()
  for (const spec of specs) if (!seen.has(spec.id)) seen.set(spec.id, spec)
  return [...seen.values()]
}

export async function handleDatasetInfo(context: ServerContext, input: DatasetInfoInput): Promise<ToolResult> {
  let resolution: TargetResolution | null = null
  let targetProblem: { code: string; message: string; candidates?: unknown } | null = null
  try {
    resolution = await resolveTarget({ requested: input.target, version: input.version, config: context.config })
  } catch (error) {
    if (!(error instanceof TargetResolutionError)) return failureFor(error)
    targetProblem = { code: error.code, message: error.message, candidates: error.candidates }
  }

  const targeted = resolution ? resolveFiles(resolution.target, resolution.version) : null
  const specs = uniqueSpecs([
    ...(targeted ? targeted.releaseInfoCandidates : []),
    ...(targeted?.classification ? [targeted.classification] : []),
    ...coreFileSpecs(),
  ])

  // `refresh` forces the check; without it this still opens the once-a-day gate, and both are awaited
  // so the numbers reported below describe the state after the check rather than before it.
  try {
    await context.cache.refresh(specs, input.refresh)
  } catch (error) {
    return failureFor(error)
  }

  const manifest = context.cache.readManifest()
  const files: FileSummary[] = specs.map((spec) => {
    const entry = manifest.files[spec.id] ?? null
    return {
      id: spec.id,
      fileName: spec.fileName,
      status: context.cache.status(spec.id),
      entries: entry?.entries ?? null,
      bytes: entry?.bytes ?? null,
      downloadedAt: entry?.downloadedAt ?? null,
      upstreamCommittedAt: entry?.upstreamCommittedAt ?? null,
      error: entry?.lastError ?? null,
    }
  })

  const offline = context.cache.offline
  return toolSuccess({
    server: { name: 'released-objects', version: SERVER_VERSION },
    source: {
      repo: SOURCE_REPO,
      baseUrl: context.config.baseUrl,
      isDefaultSource: context.config.baseUrl === DEFAULT_BASE_URL,
      usesGithubApi: context.partnerIndex.usesGithubApi,
      partnerIndexSource: context.partnerIndex.source,
    },
    target: resolution?.target ?? null,
    version: resolution?.version ?? null,
    resolvedFrom: resolution?.resolvedFrom ?? null,
    confidence: resolution?.confidence ?? null,
    ...(targetProblem ? { targetProblem } : {}),
    dataDir: context.config.dataDir,
    offline,
    lastCheckedAt: manifest.lastCheckedAt,
    nextCheckAt: manifest.nextCheckAt,
    lastCheckError: manifest.lastCheckError,
    partnerIndex: manifest.partnerIndex
      ? { indexSource: manifest.partnerIndex.indexSource, indexedAt: manifest.partnerIndex.indexedAt, fileCount: manifest.partnerIndex.files.length }
      : null,
    files,
    warnings: context.config.warnings,
    ...(offline ? { hint: OFFLINE_HINT } : {}),
  })
}
```

Add the missing type import at the top of the file:

```ts
import type { DatasetInfoInput } from '../schemas'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — 130 tests total, 0 failures.

- [ ] **Step 5: Commit (stage, show, wait for approval)**

```bash
git add mcp-server/src/tools/dataset-info.ts mcp-server/test/dataset-info.test.ts
git diff --cached --stat
```

Proposed message: `feat(mcp): add the dataset_info tool`

---

## Task 14: server entry point, committed bundle and plugin registration

**Model:** Opus 5.

Spec 5 and 12. This is the task that makes the whole thing auto-provision: the plugin manifest declares the server, the committed bundle means nothing is installed on the user's machine, and the entry point wires the pieces together. Everything the server says goes to stderr, because stdout is the protocol channel.

**Files:**
- Create: `mcp-server/src/index.ts`, `mcp-server/test/index.test.ts`, `mcp-server/scripts/smoke.mjs`
- Modify: `mcp-server/src/config.ts` (add `SOURCE_REPO_SLUG`), `.claude-plugin/plugin.json`
- Generate and commit: `mcp-server/dist/index.js`

**Interfaces:**
- Consumes: `loadConfig`, `SERVER_VERSION`, `DEFAULT_BASE_URL`, `SOURCE_REPO_SLUG` (Task 1); `createHttpClient` (Task 2); `CacheManager` (Tasks 3 and 4); `DatasetRegistry`, `coreFileSpecs` (Task 5); `PartnerIndex` (Task 9); the three shapes (Task 10); the three handlers and `ServerContext` (Tasks 11 to 13).
- Produces: `MIN_NODE_MAJOR`, `assertNodeVersion(version)`, `createLogger(verbose)`, `buildContext(argv, env)`, `toolDefinitions(context)`, `createServer(context)`, `main()`.

- [ ] **Step 1: Add `SOURCE_REPO_SLUG` to `config.ts`**

Next to the existing `SOURCE_REPO` constant:

```ts
/** Owner and repository as the GitHub API addresses it; derived form of SOURCE_REPO. */
export const SOURCE_REPO_SLUG = 'SAP/abap-atc-cr-cv-s4hc'
```

- [ ] **Step 2: Write the failing test**

`mcp-server/test/index.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertNodeVersion, buildContext, createLogger, MIN_NODE_MAJOR, toolDefinitions } from '../src/index'

const dataDir = async () => mkdtemp(join(tmpdir(), 'ro-index-'))

test('exactly three tools are exposed, under their agreed names', async () => {
  const context = buildContext([], { ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: await dataDir() })
  const names = toolDefinitions(context).map((tool) => tool.name)
  assert.deepEqual(names, ['check_objects', 'search_objects', 'dataset_info'])
})

test('every tool carries a description long enough to be useful to the calling model', async () => {
  const context = buildContext([], { ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: await dataDir() })
  for (const tool of toolDefinitions(context)) {
    assert.ok(tool.description.length > 80, `${tool.name} needs a real description`)
    assert.ok(Object.keys(tool.inputSchema).length > 0, `${tool.name} needs an input schema`)
  }
})

test('the handlers are wired, and dataset_info answers without any network', async () => {
  const context = buildContext([], {
    ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: await dataDir(),
    ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL: 'https://mirror.invalid/src',
    ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'btp-abap-environment',
  })
  const tool = toolDefinitions(context).find((entry) => entry.name === 'dataset_info')!
  const payload = JSON.parse((await tool.handler({ target: 'auto', refresh: false } as never)).content[0].text)
  assert.equal(payload.server.name, 'released-objects')
})

test('a mirror base URL keeps the server away from the GitHub API entirely', async () => {
  const mirrored = buildContext([], {
    ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: await dataDir(),
    ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL: 'https://mirror.invalid/src',
  })
  assert.equal(mirrored.partnerIndex.usesGithubApi, false)

  const direct = buildContext([], { ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: await dataDir() })
  assert.equal(direct.partnerIndex.usesGithubApi, true)
})

test('Node older than the floor is refused by name, and the floor itself is accepted', () => {
  assert.throws(() => assertNodeVersion('v18.19.0'), /Node\.js 20/)
  assert.doesNotThrow(() => assertNodeVersion(`v${MIN_NODE_MAJOR}.0.0`))
  assert.doesNotThrow(() => assertNodeVersion('v22.11.0'))
})

test('the logger writes to stderr only, because stdout carries the protocol', () => {
  const written: string[] = []
  const stderr = { write: (chunk: string) => { written.push(chunk); return true } }
  const stdout = { write: () => { throw new Error('the server must never write to stdout') } }
  const log = createLogger(true, stderr as never, stdout as never)
  log('cache warmed')
  assert.equal(written.length, 1)
  assert.match(written[0], /released-objects.*cache warmed/)
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/index'`.

- [ ] **Step 4: Write `src/index.ts`**

```ts
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CacheManager } from './cache'
import { DEFAULT_BASE_URL, loadConfig, SERVER_VERSION, SOURCE_REPO_SLUG } from './config'
import { coreFileSpecs, DatasetRegistry } from './datasets'
import { createHttpClient } from './http'
import { PartnerIndex } from './partner-index'
import { checkObjectsShape, datasetInfoShape, searchObjectsShape } from './schemas'
import { CHECK_OBJECTS_DESCRIPTION, handleCheckObjects } from './tools/check-objects'
import { DATASET_INFO_DESCRIPTION, handleDatasetInfo } from './tools/dataset-info'
import type { ServerContext, ToolResult } from './tools/context'
import { handleSearchObjects, SEARCH_OBJECTS_DESCRIPTION } from './tools/search-objects'

export const MIN_NODE_MAJOR = 20

export function assertNodeVersion(version: string): void {
  const major = Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '0', 10)
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    throw new Error(
      `The released-objects MCP server needs Node.js ${MIN_NODE_MAJOR} or newer, and this is ${version}. ` +
        'Install a current Node.js and restart Claude Code.',
    )
  }
}

type Sink = { write(chunk: string): unknown }

/** Diagnostics go to stderr; stdout belongs to the MCP protocol and nothing else may touch it. */
export function createLogger(verbose: boolean, stderr: Sink = process.stderr, _stdout: Sink = process.stdout) {
  return (message: string) => {
    if (verbose) stderr.write(`[released-objects] ${message}\n`)
  }
}

export function buildContext(argv: string[], env: NodeJS.ProcessEnv): ServerContext {
  const config = loadConfig(argv, env)
  const log = createLogger(config.verbose)
  const http = createHttpClient(config.userAgent)
  // The GitHub API is only reachable, and only meaningful, when reading SAP's own repository.
  // Against an internal mirror the server stays on plain file fetches and the built-in partner list.
  const isDefaultSource = config.baseUrl === DEFAULT_BASE_URL
  const githubApi = isDefaultSource ? { baseUrl: config.githubApiBaseUrl, repo: SOURCE_REPO_SLUG } : null
  const cache = new CacheManager({
    dataDir: config.dataDir,
    baseUrl: config.baseUrl,
    githubApi,
    http,
    now: () => new Date(),
    log,
  })
  return {
    cache,
    registry: new DatasetRegistry(cache),
    partnerIndex: new PartnerIndex({
      http,
      apiBaseUrl: isDefaultSource ? config.githubApiBaseUrl : null,
      repo: SOURCE_REPO_SLUG,
    }),
    config,
  }
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (input: never) => Promise<ToolResult>
}

export function toolDefinitions(context: ServerContext): ToolDefinition[] {
  return [
    { name: 'check_objects', description: CHECK_OBJECTS_DESCRIPTION, inputSchema: checkObjectsShape, handler: (input) => handleCheckObjects(context, input) },
    { name: 'search_objects', description: SEARCH_OBJECTS_DESCRIPTION, inputSchema: searchObjectsShape, handler: (input) => handleSearchObjects(context, input) },
    { name: 'dataset_info', description: DATASET_INFO_DESCRIPTION, inputSchema: datasetInfoShape, handler: (input) => handleDatasetInfo(context, input) },
  ]
}

export function createServer(context: ServerContext): McpServer {
  const server = new McpServer({ name: 'released-objects', version: SERVER_VERSION })
  for (const tool of toolDefinitions(context)) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema as never }, tool.handler as never)
  }
  return server
}

export async function main(): Promise<void> {
  assertNodeVersion(process.version)
  const context = buildContext(process.argv.slice(2), process.env)
  for (const warning of context.config.warnings) process.stderr.write(`[released-objects] ${warning}\n`)

  const server = createServer(context)
  await server.connect(new StdioServerTransport())

  // Open the once-a-day gate as soon as the client is connected, without blocking the first tool call.
  context.cache.ensureFresh(coreFileSpecs())
}

// `require.main` is CommonJS; the bundle is CommonJS, so this is the entry guard.
if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`[released-objects] fatal: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — 136 tests total, 0 failures.

- [ ] **Step 6: Write the smoke script**

`mcp-server/scripts/smoke.mjs` — speaks the protocol to the built bundle over a pipe and exits non-zero if the three tools do not come back. This is what CI runs against `dist/`, so it exercises the artifact that ships rather than the TypeScript.

```js
#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const bundle = fileURLToPath(new URL('../dist/index.js', import.meta.url))
const dataDir = await mkdtemp(join(tmpdir(), 'released-objects-smoke-'))
const child = spawn(process.execPath, [bundle], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: dataDir,
    // An unreachable mirror keeps the smoke test off the network and off the GitHub API.
    ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL: 'https://mirror.invalid/src',
  },
})

const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
const responses = new Map()
let buffer = ''
child.stdout.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    const message = JSON.parse(line)
    if (message.id !== undefined) responses.set(message.id, message)
  }
})

const waitFor = async (id, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (responses.has(id)) return responses.get(id)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`no response to request ${id} within ${timeoutMs}ms`)
}

const fail = (message) => {
  console.error(`smoke: ${message}`)
  child.kill()
  process.exit(1)
}

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } })
const initialized = await waitFor(1)
if (initialized.result?.serverInfo?.name !== 'released-objects') fail('the server did not identify itself as released-objects')

send({ jsonrpc: '2.0', method: 'notifications/initialized' })
send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
const listed = await waitFor(2)
const names = (listed.result?.tools ?? []).map((tool) => tool.name).sort()
const expected = ['check_objects', 'dataset_info', 'search_objects']
if (names.join(',') !== expected.join(',')) fail(`expected ${expected.join(', ')} but got ${names.join(', ') || 'nothing'}`)

send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dataset_info', arguments: { refresh: false } } })
const info = await waitFor(3)
const text = info.result?.content?.[0]?.text ?? '{}'
if (!JSON.parse(text).server) fail('dataset_info did not return a server block')

child.kill()
console.log(`smoke: ok — ${expected.join(', ')}`)
```

- [ ] **Step 7: Build the bundle and check it in**

Run:
```bash
cd mcp-server && npm run build && node scripts/smoke.mjs
```
Expected: `smoke: ok — check_objects, dataset_info, search_objects`, and `mcp-server/dist/index.js` exists as a single file with no `require` of anything outside Node's built-ins.

Verify that last point explicitly:
```bash
node -e "const s=require('fs').readFileSync('mcp-server/dist/index.js','utf8'); const m=[...s.matchAll(/require\(\"([^\"]+)\"\)/g)].map(x=>x[1]).filter(n=>!n.startsWith('node:')); console.log(new Set(m))"
```
Expected: an empty set. Anything listed is a dependency that failed to bundle and would break on a user's machine.

- [ ] **Step 8: Declare the server in the plugin manifest**

In `.claude-plugin/plugin.json`, raise `"version"` to `"0.3.0"` and add, as a sibling of the existing top-level keys:

```json
  "mcpServers": {
    "released-objects": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js"],
      "env": {
        "ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR": "${CLAUDE_PLUGIN_DATA}/released-objects"
      }
    }
  }
```

`${CLAUDE_PLUGIN_ROOT}` points at the installed plugin, so the bundle moves with it. `${CLAUDE_PLUGIN_DATA}` points at storage that survives plugin updates, so a reinstall does not re-download SAP's files.

- [ ] **Step 9: Verify the plugin declaration**

Run:
```bash
claude plugin validate .
test ! -f .mcp.json && echo "no root .mcp.json — good"
```
Expected: validation passes, and the second line prints. A root `.mcp.json` alongside an inline `mcpServers` block would register the server twice, so the repo must never carry both.

- [ ] **Step 10: Run the full repo gates**

Run:
```bash
python scripts/generate_skill_index.py && python scripts/validate_skills.py && node evals/run-static.mjs
```
Expected: all three pass.

- [ ] **Step 11: Commit (stage, show, wait for approval)**

```bash
git add mcp-server/src/index.ts mcp-server/src/config.ts mcp-server/test/index.test.ts mcp-server/scripts/smoke.mjs mcp-server/dist/index.js .claude-plugin/plugin.json
git diff --cached --stat
```

Proposed message: `feat(mcp): wire the released-objects server into the plugin manifest`

---

---

## Task 15: teach the agents and skills to use the server

**Model:** Sonnet 5. Prose and manifest edits, no new logic.

Spec 10 and 12. A server nothing calls is dead weight. Each agent learns when reaching for the tool is mandatory, and the three skills that currently tell a reader to check by hand gain the tool as the first option while keeping the manual routes as the fallback.

**Files:**
- Modify: `.claude/agents/abap-kebap-architect.md`, `.claude/agents/abap-kebap-developer.md`, `.claude/agents/abap-kebap-reviewer.md`
- Modify: `.claude/skills/abap-cloud-development/SKILL.md`, `.claude/skills/abap-code-review/SKILL.md`, `.claude/skills/abap-modernization-playbook/SKILL.md`
- Modify: `evals/static-checks.json`

**Interfaces:**
- Consumes: the tool names and error codes from Tasks 11 to 13.
- Produces: no code. The static rules it adds are the contract that later edits cannot silently drop these pointers.

- [ ] **Step 1: Add the tool section to each agent**

Insert into all three agent files, immediately after the `## Grounding — verify before you assert` section, the same block with a role-specific first line:

```markdown
## Released-object data — use the tool, do not recall

This plugin ships an MCP server named `released-objects` carrying SAP's own released-object
and Clean Core classification data, refreshed from SAP daily. Prefer it over memory and over
browsing api.sap.com: your training data does not know what SAP released last quarter.

- Before you [ROLE LINE], call `check_objects` with every SAP standard object involved.
- When an object comes back blocked or deprecated, call `search_objects` to find the released
  replacement before you propose one.
- If an answer looks wrong or stale, call `dataset_info`, optionally with `refresh`.
- If the tool answers `TARGET_AMBIGUOUS` or `TARGET_UNRESOLVED`, ask which system this code
  targets. Never assume a target.
- A `not-found` verdict is not permission. It means SAP does not list the object, which for
  Cloud ERP and the BTP ABAP environment means it is not released.
- If the tool is unavailable, say so in your answer and fall back to the manual routes in
  [abap-cloud-development](${CLAUDE_PLUGIN_ROOT}/.claude/skills/abap-cloud-development/SKILL.md).
```

Role lines, replacing `[ROLE LINE]`:
- architect: `settle on a data model, a released API, or a build-versus-extend recommendation`
- developer: `write or modify ABAP that reads an SAP table, CDS entity, class or function module`
- reviewer: `report that an object is or is not usable on the target system`

- [ ] **Step 2: Fix the reviewer's stale released-API sentence**

`.claude/agents/abap-kebap-reviewer.md:42` currently points at `api.sap.com` as the way to establish released-API state. Rewrite that line so the tool is first and the website is the fallback, keeping the surrounding sentence structure intact. Check the same file for any other sentence that treats the website as the only route and fix it the same way.

- [ ] **Step 3: Put the tool first in `abap-cloud-development`**

`.claude/skills/abap-cloud-development/SKILL.md:94` opens `**How to check if an object is released:**` followed by four numbered manual routes. Insert a new item `1.` before them and renumber:

```markdown
1. **Ask the `released-objects` MCP server** (shipped with this plugin, refreshed from SAP daily) —
   `check_objects` for a verdict per object and `search_objects` for the released replacement.
   This is the fastest and the most current route. The routes below are the fallback when the
   server is unavailable, and the ADT and ATC routes remain authoritative for the running system.
```

- [ ] **Step 4: Add the routing row to `abap-code-review`**

`.claude/skills/abap-code-review/SKILL.md:112` holds the `ABAP Cloud compatibility (Steampunk targets only)` row. Add one row directly beneath it, in the same column shape, pointing at `check_objects` for "is this SAP object usable on the target system", and noting that the check is mandatory before a reviewer asserts either way.

- [ ] **Step 5: Wire the tool into the modernization playbook**

`.claude/skills/abap-modernization-playbook/SKILL.md` step `2. **Categorize.**` currently says `(a) released alternative exists → swap`. Extend the sentence so the categorisation is produced by `check_objects` over the inventory and `search_objects` for each blocked finding, rather than by recall. Keep the existing lettering.

- [ ] **Step 6: Add the static rules**

Append to the rules array in `evals/static-checks.json`, after `skills-no-customer-project-names`, using the existing `{id, kind, pattern, in, note}` shape and plain substring matching:

| id | kind | pattern | in | note |
|---|---|---|---|---|
| `mcp-server-declared-in-plugin` | required | `released-objects` | `.claude-plugin/plugin.json` | the plugin must declare the server or nothing auto-provisions |
| `mcp-data-dir-uses-plugin-data` | required | `${CLAUDE_PLUGIN_DATA}` | `.claude-plugin/plugin.json` | data must survive plugin updates |
| `mcp-bundle-path-uses-plugin-root` | required | `${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js` | `.claude-plugin/plugin.json` | the bundle is referenced by placeholder, never by a relative path |
| `agents-know-check-objects` | required | `check_objects` | `.claude/agents/` | every agent must know the tool exists |
| `agents-never-guess-target` | required | `TARGET_AMBIGUOUS` | `.claude/agents/` | every agent must know to ask rather than assume a system |
| `cloud-skill-points-at-mcp` | required | `released-objects` | `.claude/skills/abap-cloud-development/SKILL.md` | the manual route must not drift back to being the only route |
| `review-skill-points-at-mcp` | required | `check_objects` | `.claude/skills/abap-code-review/SKILL.md` | the review gate must call the tool |
| `mcp-server-never-writes-stdout` | forbidden | `console.log(` | `mcp-server/src/` | stdout is the MCP transport; a stray log breaks the protocol |
| `mcp-server-never-writes-stdout-raw` | forbidden | `process.stdout.write` | `mcp-server/src/` | same reason, for the raw stream |
| `mcp-server-no-credential-fields` | forbidden | `authenticationKind` | `mcp-server/src/` | the ADT destinations file is read for host and protocol only |

Each rule's `note` is the sentence in the right-hand column, written as prose.

- [ ] **Step 7: Run the repository gates**

```bash
python scripts/generate_skill_index.py
python scripts/validate_skills.py
node evals/run-static.mjs
```

Expected: the index regenerates with no diff beyond the edited skills, `validate_skills.py` passes, and `run-static.mjs` reports every new rule as satisfied. If `mcp-server-never-writes-stdout` fires, the offending file is writing to stdout and must be changed rather than excluded.

- [ ] **Step 8: Commit (stage, show, wait for approval)**

```bash
git add .claude/agents .claude/skills evals/static-checks.json .claude/skill-index.json
git diff --cached --stat
```

Proposed message: `feat(agents): route released-object questions through the MCP server`

---

## Task 16: documentation and continuous integration

**Model:** Sonnet 5.

Spec 11, 12 and 14. Two audiences: a user installing the plugin, who needs to know what gets downloaded and how to work behind a proxy, and the pipeline, which has to stop a broken bundle from being merged.

**Files:**
- Modify: `README.md`, `docs/grounding-protocol.md`, `CLAUDE.md`, `.github/workflows/validate.yml`

**Interfaces:**
- Consumes: the environment variable names from Task 1 and the tool names from Tasks 11 to 13.
- Produces: no code.

- [ ] **Step 1: Add the README section**

Insert a `## Released-object data` section between `What's inside` and `Install alternatives (without the plugin)`. It must state, in plain sentences:

- Installing the plugin also installs an MCP server called `released-objects` with three tools, and no extra step is needed.
- On first use it downloads SAP's public released-object data from `github.com/SAP/abap-atc-cr-cv-s4hc` into the plugin's data directory, roughly 30 MB.
- It re-checks once per local day with a conditional request and re-downloads only what changed, so a normal day costs one request per file and no download.
- It works offline once the data is there, and it never sends code or object names anywhere.
- Behind a corporate proxy, set `HTTPS_PROXY` and `NO_PROXY`, and `NODE_EXTRA_CA_CERTS` when the proxy inspects TLS. For an internal mirror of the SAP repository, set `ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL`, which also turns off the GitHub API calls.
- To pin the system instead of letting it resolve, set `ABAP_KEBAP_RELEASED_OBJECTS_TARGET` to one of the three target values and `ABAP_KEBAP_RELEASED_OBJECTS_VERSION` for a private-edition release.
- It needs Node 20 or newer, and `/mcp` turns it off.
- The data is SAP's, published under Apache-2.0, and SAP's own note applies: the licence covers the lists, not the use of the SAP APIs they describe. The server code is MIT, like the rest of this repository. Name the licence and repeat that caveat in one sentence.

Add a one-line entry for the server to the `What's inside` list, and one line to `Roadmap` noting that successor-chain walking and alternative suggestion are not in this version.

- [ ] **Step 2: Correct the grounding protocol**

`docs/grounding-protocol.md:69` still says the agents carry a fixed tools list with no MCP, which this feature makes false. Rewrite that sentence to say the agents now have the `released-objects` MCP server available in addition to their tools list. Then change the retrieval row at line 101 — `| Released APIs / ABAP Cloud allowed-or-not | api.sap.com + ABAP for Cloud Development keyword doc |` — so the first source is `released-objects` `check_objects` and the website is named as the fallback.

- [ ] **Step 3: Extend the done gate in `CLAUDE.md`**

In the `Done gate` row of the development-loop table at `CLAUDE.md:17`, add the server's own gate to the existing list: `cd mcp-server && npm test`. Keep the sentence structure and the existing three gates untouched.

- [ ] **Step 4: Add the CI job**

Add a third job to `.github/workflows/validate.yml`, alongside `gates` and `plugin`:

```yaml
  mcp-server:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Refuse a second MCP declaration
        run: test ! -f .mcp.json
      - name: Install dependencies
        run: npm ci
        working-directory: mcp-server
      - name: Type-check and test
        run: npm test
        working-directory: mcp-server
      - name: Rebuild the bundle
        run: npm run build
        working-directory: mcp-server
      - name: Fail if the committed bundle is stale
        run: git diff --exit-code -- dist/index.js
        working-directory: mcp-server
      - name: Smoke-test the bundle
        run: node scripts/smoke.mjs
        working-directory: mcp-server
```

The stale-bundle step is the important one: it is what stops a source change from shipping without a rebuilt `dist/index.js`. It requires `package-lock.json` to be committed, so make sure Task 1 committed it.

- [ ] **Step 5: Verify**

```bash
node evals/run-static.mjs
python scripts/validate_skills.py
```

Expected: both pass. Read the new README section aloud once and check that no sentence names a machine-local path or the local reference folder.

- [ ] **Step 6: Commit (stage, show, wait for approval)**

```bash
git add README.md docs/grounding-protocol.md CLAUDE.md .github/workflows/validate.yml
git diff --cached --stat
```

Proposed message: `docs(mcp): document the released-objects server and gate it in CI`

---

## Task 17: milestone verification — manual smoke test and one behavioural eval

**Model:** main session dispatches; the eval runs on Haiku or Sonnet 5 to keep it cheap.

Spec 17. Everything before this proves the parts work. This proves the feature works: that a fresh install provisions the server, and that an agent actually reaches for it instead of recalling.

**Files:**
- Create: `docs/superpowers/plans/2026-09-21-released-objects-mcp-verification.md`

**Interfaces:**
- Consumes: the whole server.
- Produces: a written record of what was verified, with the evidence.

- [ ] **Step 1: Verify a cold install provisions the data**

```bash
rm -rf "$(node -e "console.error(0)" >/dev/null 2>&1; echo "$CLAUDE_PLUGIN_DATA")/released-objects" 2>/dev/null || true
claude --plugin-dir . -p "Use dataset_info for target cloud-erp and report the file names, record counts and fetch time."
```

Record: the record count per file, the elapsed time, and the size of the data directory afterwards. Expected: tens of thousands of records and a directory in the tens of megabytes.

- [ ] **Step 2: Verify the daily gate**

Run the same command a second time and confirm from `dataset_info` that `lastCheckedAt` is unchanged and nothing was downloaded. Then run it with `refresh` and confirm the check happened and still downloaded nothing, because the ETag matched.

- [ ] **Step 3: Verify the three targets disagree where they should**

Ask for `check_objects` on `MARA` against each of `cloud-erp`, `cloud-erp-private` and `btp-abap-environment`. Record the three verdicts. Expected: not allowed on the public cloud and on BTP, and a Clean Core level on private rather than a flat refusal.

- [ ] **Step 4: Verify target resolution asks rather than guesses**

With `ABAP_KEBAP_RELEASED_OBJECTS_TARGET` unset and more than one ADT destination configured, call `check_objects` with `target: auto`. Expected: `TARGET_AMBIGUOUS`, candidates listed by destination id and system id, and no full host name anywhere in the output. Paste the raw output into the record and confirm by reading it that no user name, token or full host appears.

- [ ] **Step 5: Run the behavioural eval**

Dispatch `abap-kebap-reviewer` on this input, with no other context:

> Review this for an SAP BTP ABAP environment target:
> ```abap
> SELECT * FROM mara INTO TABLE @DATA(lt_materials).
> ```

Expected: the reviewer calls `check_objects`, reports that the table is not usable on that target, and names the released CDS entity it found through `search_objects` rather than one it remembered. A review that reaches the right conclusion without calling the tool is a failure of this task, because it proves the routing from Task 15 did not take.

- [ ] **Step 6: Verify the offline path**

Disconnect the network, or point `ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL` at an unreachable host, and run `check_objects` again. Expected: the same verdict from the cached data, with `dataset.status` reporting `stale` and a reason. Then delete the data directory and repeat. Expected: `DATASET_UNAVAILABLE` with the proxy and mirror hint, not a crash and not a confident wrong answer.

- [ ] **Step 7: Write the record**

Write `docs/superpowers/plans/2026-09-21-released-objects-mcp-verification.md` with one short section per step above: what was run, what came back, and pass or fail. Where a step failed, name the task that has to be reopened. Do not mark the feature done while any step is failing.

- [ ] **Step 8: Run the full gate set one last time**

```bash
python scripts/generate_skill_index.py
python scripts/validate_skills.py
node evals/run-static.mjs
cd mcp-server && npm test && npm run build && node scripts/smoke.mjs
claude plugin validate .
```

Expected: all green, and `git status` shows no unexpected changes from the index regeneration.

- [ ] **Step 9: Commit (stage, show, wait for approval)**

```bash
git add docs/superpowers/plans/2026-09-21-released-objects-mcp-verification.md
git diff --cached --stat
```

Proposed message: `docs(mcp): record the released-objects verification results`
