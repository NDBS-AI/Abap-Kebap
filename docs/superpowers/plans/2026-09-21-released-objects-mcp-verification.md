# Milestone verification — the `released-objects` MCP server

**Date:** 2026-09-21
**Branch:** `feature/released-objects-mcp`
**Node:** v26.2.0 · **Claude Code:** 2.1.178

This record covers the end-to-end verification of the `released-objects` MCP server after
Tasks 1–16. Earlier tasks proved the parts; this one proves the feature: that a fresh install
provisions the data by itself, that the daily gate and the offline path behave, that the three
targets disagree where SAP's data says they should, and that a review agent actually reaches
for the tool instead of recalling.

**Summary: 6 of 7 checks PASS. Check 6 (the behavioural eval) FAILS.** The server itself is
sound; the agent-side routing added in Task 15 does not fire in practice. Details and the
reopen recommendation are under Check 6.

Two harnesses were used, and each check names the one it used:

- **plugin host** — `claude -p --plugin-dir . --model haiku …`, which exercises the real
  install path: the plugin manifest, `${CLAUDE_PLUGIN_ROOT}`, and the data directory passed
  through `${CLAUDE_PLUGIN_DATA}`.
- **direct stdio** — a throwaway JSON-RPC client speaking to the committed
  `mcp/released-objects/dist/index.js` over stdio, pointed at the *same* plugin data directory.
  Used where a check needs the exact payload rather than a model's paraphrase of it.

Paths below are written with `~` for the home directory. One ADT destination id that appeared
in the server's own output is shown as `<destination-id>`; the redaction is noted where it
applies and does not affect the finding.

---

## Check 1 — a cold install provisions the data — PASS

The plugin data directory was empty before the run (`~/.claude/plugins/data/abap-kebap-inline/`
existed with no `released-objects` child), so the run was genuinely cold. Nothing had to be
moved aside.

**Harness:** plugin host.

```bash
claude --plugin-dir . --model haiku \
  --allowedTools "mcp__plugin_abap-kebap_released-objects__dataset_info" \
  -p "Call the MCP tool ...dataset_info with refresh set to true. Reply with exactly its raw JSON text."
```

The server appears to the host as `plugin:abap-kebap:released-objects` and connected with no
permission prompt for the connection itself and no manual provisioning step. Provisioning is
eager: the four files were already on disk (`downloadedAt` 19:54:47–19:54:50Z) by the time the
first successful tool call ran at 19:56:09Z, having been fetched when the server first started.
The whole download took about **4 seconds**.

| File | `status` | `entries` | `bytes` |
|---|---|---|---|
| `objectReleaseInfoLatest.json` (`cloud-erp/latest`) | `ready` | 37,030 | 10,497,675 |
| `objectReleaseInfo_PCELatest.json` (`cloud-erp-private/latest`) | `ready` | 44,541 | 11,972,881 |
| `objectReleaseInfo_BTPLatest.json` (`btp-abap-environment/latest`) | `ready` | 7,023 | 1,913,452 |
| `objectClassifications_SAP.json` (`classification/sap`) | `ready` | 8,588 | 2,322,498 |

**Measured total: 26,706,506 bytes — 26.71 MB (25.47 MiB) across 97,182 entries.**

`README.md` said "tens of megabytes"; it now says **"roughly 25 MB"**, the measured figure
rounded to the nearest 5 MB. That is the only README change in this task.

The brief's expectation of "tens of thousands of records" is met (97,182 in total, 37k–44k in
the two large release files). The directory is at the low end of "tens of megabytes", which is
why the figure is now stated exactly.

---

## Check 2 — the daily gate — PASS

**Harness:** direct stdio, against the same data directory.

Two calls in one session: `dataset_info` with no arguments, then `dataset_info` with
`refresh: true`.

| | `lastCheckedAt` | any `downloadedAt` changed? |
|---|---|---|
| after Check 1 | `2026-09-21T19:56:09.319Z` | — |
| no `refresh` | `2026-09-21T19:56:09.319Z` — **unchanged** | no |
| `refresh: true` | `2026-09-21T19:57:02.594Z` — advanced | **no** |

Both halves hold. Without `refresh` the server did not go to the network at all: the timestamp
is byte-identical to the one Check 1 left behind. With `refresh` it *did* check — the timestamp
advanced — and still re-downloaded nothing: all four `downloadedAt` values stayed at their
19:54:4xZ originals and every file stayed `ready`. That is the conditional-request path
returning 304 and the cache being kept.

---

## Check 3 — the three targets disagree — PASS

**Harness:** direct stdio. `check_objects` for `MARA`, `I_PRODUCT` and `BAPI_MATERIAL_SAVEDATA`,
run three times with `target` set to each of the three values. Every call reported
`resolvedFrom: "request"` and `confidence: "high"`, as an explicit target should.

| | `cloud-erp` | `cloud-erp-private` | `btp-abap-environment` |
|---|---|---|---|
| `maxLevel` | `A` | `C` | `A` |
| `impliedLevelWhenAbsent` | `none` | `C` | `none` |
| `MARA` | **blocked**, level `none` | **allowed**, level `C` | **not-found** |
| `I_PRODUCT` | **allowed**, level `A` | **allowed**, level `A` | **not-found** |
| `BAPI_MATERIAL_SAVEDATA` | **blocked**, level `none` | **allowed**, level `B`, `classicAPI` | **not-found** |
| summary | 1 allowed / 2 blocked | 3 allowed / 0 blocked | 0 found / 3 not-found |

**All three objects differ across targets** — the requirement was that at least one does.

The successors travel with the verdict rather than with the target. On both ERP targets `MARA`
carries `successorClassification: "multipleObjects"` and five successors — `I_PRODUCT`,
`I_PRODUCTPROCUREMENT`, `I_PRODUCTQM`, `I_PRODUCTSALES`, `I_PRODUCTSTORAGE_2` — and
`BAPI_MATERIAL_SAVEDATA` carries `successorClassification: "oneObject"` with the behaviour
definition `I_PRODUCTTP_2`.

The `cloud-erp-private` column is the interesting one and behaves exactly as the design
intended: `MARA` is still `releaseState: "notToBeReleased"`, but because that target's
`impliedLevelWhenAbsent` is `C`, the verdict is `allowed` **at Clean Core level C** rather than
a flat refusal. Private cloud gets a graded answer; public cloud gets a refusal. Note also that
the two ERP targets disagree on `softwareComponent` for the same object (`SAPSCORE` vs
`S4CORE`), so the server is genuinely reading two different SAP files rather than one.

**Observation worth carrying forward (not a failure):** the BTP file is much smaller — 7,023
entries against 37,030 — and contains neither `MARA` nor `I_PRODUCT`. So on
`btp-abap-environment` the honest answer for both is `not-found` with `impliedLevel: "none"` and
`allowed: false`, plus the type/namespace hint and, for `MARA`, five edit-distance suggestions
(`FKARA`, `MASS`, `MTART`, `VARIA`) that are near-misses on the string and not real
alternatives. This is faithful to SAP's data, but it means "what should I use instead on BTP?"
cannot be answered from `check_objects` alone on that target — `search_objects` has to carry it.
Anyone writing agent guidance should know that.

---

## Check 4 — target resolution, and the credential-safety read-through — PASS

**Harness:** direct stdio. `ABAP_KEBAP_RELEASED_OBJECTS_TARGET` was confirmed unset, and
`check_objects` was called with `target: "auto"` and no pin. **Nothing under `~/.adtls/` was
read, copied or modified by this task.**

It **resolved** rather than returning `TARGET_AMBIGUOUS`, because only one ADT session was
discoverable:

```json
"target": "cloud-erp-private",
"resolvedFrom": "adt-session",
"confidence": "low",
"assumption": "Assumed the last ADT system logged on to, <destination-id> (no system id), which looks like cloud-erp-private."
```

Since the `TARGET_AMBIGUOUS` branch could not be reached without touching ADT configuration,
which is forbidden, the redaction guarantee was verified two other ways instead:

1. **Read-through of the resolved output.** The only identifier in the whole payload is the ADT
   **destination id** — the brief's own definition of safe output. There is no user name, no
   token, no URL and no filesystem path other than the server's own `dataDir`. The id is shown
   above as `<destination-id>` out of caution, not necessity. `confidence` is correctly `low`
   and the guess is stated as an `assumption` in plain words rather than presented as fact.
2. **Source read.** `mcp/released-objects/src/target-resolver.ts` builds the candidate list from
   `{ id, systemId, host }` where `host` passes through a truncation documented as *"Anything
   shown to a model or a user keeps at most the last three labels"* and implemented as
   `labels.length <= 3 ? host : labels.slice(-3).join('.')`. A separate `stripUserInfo` removes
   any `user:password@` authority prefix before a host is read at all.

The required grep returns three lines and no leak:

```
$ grep -rn "authenticationKind\|password\|token" mcp/released-objects/src/
src/query.ts:219:  const tokens = needle.split(/\s+/).filter(Boolean)
src/query.ts:220:  if (tokens.length > 1 && haystacks.some((value) => tokens.every((token) => value.includes(token)))) return RANK_TOKENS
src/target-resolver.ts:51: * Drops any `user:password@` prefix from the authority. Applied to every spelling before a
```

The two `query.ts` hits are the search-token variable the brief anticipated. The third is a
comment describing the redaction routine itself — a credential-safety control, not a credential.
There is no `authenticationKind` anywhere, and no field that could carry a secret. The unit
suite covers this ground directly and passes, including *"user info in a systemUrl never reaches
the candidate list or the error message"* and *"several destinations and no hint is ambiguous,
with redacted candidates"*.

---

## Check 5 — the offline path — PASS

**Harness:** plugin host, with `ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL=https://mirror.invalid/src`
exported into the call, which also proves the plugin host passes shell environment through to
the server process. The variable was unset afterwards.

```json
"baseUrl": "https://mirror.invalid/src",
"isDefaultSource": false,
"usesGithubApi": false,
"offline": true,
"lastCheckedAt": "2026-09-21T19:57:02.594Z",
"nextCheckAt": "2026-09-21T21:03:40.565Z",
"lastCheckError": "fetch failed",
"hint": "SAP could not be reached, so answers are served from the cached copy listed below. Check HTTPS_PROXY, NO_PROXY and NODE_EXTRA_CA_CERTS, then call this tool again with refresh."
```

Every requirement holds: all four cached files still report `status: "ready"` with unchanged
`entries`, `bytes` and `downloadedAt`; `source.usesGithubApi` is `false`; and the call returned
a normal payload, not an error result and not a crash. Two details are better than asked for —
`lastCheckedAt` did **not** advance, correctly refusing to record a failed check as a successful
one, and `nextCheckAt` is set to a backoff time so a broken mirror is not retried in a hot loop.
The proxy hint names `HTTPS_PROXY`, `NO_PROXY` and `NODE_EXTRA_CA_CERTS`.

The `DATASET_UNAVAILABLE` half of the original step — delete the data directory *and* go
offline — was not run here, to avoid discarding the freshly downloaded cache. It is covered by
`scripts/smoke.mjs`, which runs on every CI build against an empty temp data directory with
`https://mirror.invalid/src` as its base URL and asserts the server still starts, lists its
three tools and answers `dataset_info` without crashing.

---

## Check 6 — the behavioural eval — **FAIL**

**Harness:** plugin host, `--agent abap-kebap-reviewer`, `--output-format stream-json`.

```bash
claude --plugin-dir . --model haiku --agent abap-kebap-reviewer --output-format stream-json \
  --allowedTools "mcp__plugin_abap-kebap_released-objects__check_objects" ... \
  -p "Review this ABAP for a BTP ABAP environment target: SELECT * FROM mara INTO TABLE @DATA(lt_mara) WHERE matnr = @lv_matnr. Give your findings."
```

**The reviewer never called `check_objects`. Run three times, including once with
`--strict-mcp-config`; zero tool calls in all three.** Per the task definition — *"a review that
reaches the right conclusion without calling the tool is a failure, because it proves the
routing did not take"* — this is a FAIL.

What the reviewer did instead, in all three runs, was reach the right *headline* from memory and
then point the user at the server rather than using it:

> Run 1: "Use a released CDS entity for Material Master data instead (e.g., `I_Material` or
> verify the exact name via ADT's Released Objects view, api.sap.com, or the `released-objects`
> MCP server)."
>
> Run 3: "Confirm via `released-objects` MCP server (`check_objects('MARA')` /
> `search_objects(...)` for released alternatives)."

Two things are wrong with that. It is advice to call the tool rather than a call, and the name
it supplies from memory — `I_Material` — is **not what the data says**. SAP's data gives
`I_PRODUCT` and four siblings as `MARA`'s successors on the ERP targets, and on the BTP target
the reviewer was actually asked about it gives `not-found` (see Check 3). The eval's second
criterion, that the answer cite what the tool returned, therefore also fails — there was nothing
returned to cite.

**This is not a harness artifact.** Three separate causes were ruled out:

1. *The tool is reachable by this agent.* A control run with the same agent and the same
   allow-list, prompted explicitly, called it and read the result correctly:
   ```
   TOOL_USE: ToolSearch
   TOOL_USE: mcp__plugin_abap-kebap_released-objects__check_objects
   RESULT: "verdict": "not-found"  /  "allowed": false
   ```
   So permissions, the allow-list, the agent's tool inheritance and the server connection are
   all fine.
2. *It is not the other MCP servers.* Run 3 used `--strict-mcp-config` to drop every non-plugin
   server. Same outcome.
3. *The routing text is present.* `.claude/agents/abap-kebap-reviewer.md` carries the Task 15
   instructions, including line 55: *"Before you report that an object is or is not usable on the
   target system, call `check_objects` with every SAP standard object involved."* The agents
   clearly absorbed it — all three runs name the server unprompted. Awareness took; invocation
   did not.

**The mechanism, evidenced.** In this host the server's tools are *deferred*: they are not in
the session's up-front tool list, so a model has to discover them before it can call them. The
init event shows an empty set in every run, including the strict one:

```
released tools at init: []   total tools: 25
released server entry: {"name":"plugin:abap-kebap:released-objects","status":"pending"}
```

Run 2 is the run that tells the story. The reviewer *did* try to find the tool, using the bare
name the agent prose gave it, and the lookup came back empty — after which it silently fell back
to memory:

```
TOOL_USE:    ToolSearch {"query":"select:check_objects","max_results":1}
TOOL_RESULT: No matching deferred tools found
```

`select:` matches on the fully-qualified tool name, which is
`mcp__plugin_abap-kebap_released-objects__check_objects`. The agent instructions say
`check_objects`, so the lookup can never hit. The control run succeeded only because its prompt
said "the released-objects MCP tool check_objects", which produced a keyword search instead of a
`select:` lookup.

**Follow-up — reopen Task 15.** The server needs no change; this is entirely agent-side. Two
things would close it, and they are complementary:

1. Have the routing prose in all three `abap-kebap-*` agents name the tool in a form that
   resolves — either the fully-qualified `mcp__plugin_abap-kebap_released-objects__check_objects`
   or an explicit instruction to find it by keyword ("search your available tools for
   `released-objects`") — so the discovery step cannot dead-end.
2. Make the instruction a gate rather than a preference, and say what to do when the lookup
   fails, so the agent reports that it could not consult the data instead of quietly answering
   from memory. A silent fallback to recall is the worst of the available behaviours: it is
   indistinguishable from a real answer, and here it produced a wrong entity name.

A static eval asserting the agent files name the tool in a resolvable form would keep this
fixed once fixed. The three existing `agents-never-guess-target-*` checks pass, so they do not
cover it.

---

## Check 7 — the gates — PASS

Repository root:

```
$ python scripts/generate_skill_index.py
generated .claude\skill-index.json (36 skills)

$ python scripts/validate_skills.py
Validated 36 skill manifests and 3 agent manifests.

$ node evals/run-static.mjs
  PASS  agents-never-guess-target-architect
  PASS  agents-never-guess-target-developer
  PASS  agents-never-guess-target-reviewer
  PASS  cloud-skill-points-at-mcp
  PASS  review-skill-points-at-mcp
  PASS  mcp-server-never-writes-stdout
  PASS  mcp-server-never-writes-stdout-raw
  PASS  mcp-server-no-credential-fields
All static checks passed.

$ test ! -f .mcp.json
OK: .mcp.json absent

$ claude plugin validate .
✔ Validation passed
```

`git status --short` was clean after the index regeneration — the committed
`.claude/skill-index.json` is current.

`mcp/released-objects`:

```
$ npm test
ℹ tests 171   ℹ pass 171   ℹ fail 0   ℹ duration_ms 1601.35

$ npm run build
dist\index.js  2.4mb   Done in 125ms

$ git diff --exit-code -- dist/index.js
(no output — the committed bundle matches a fresh build)

$ node scripts/smoke.mjs
smoke: ok — check_objects, dataset_info, search_objects
```

All green. The committed bundle is reproducible from the committed source.

---

## Verdict

| # | Check | Result |
|---|---|---|
| 1 | Cold install provisions the data | PASS — 26.7 MB, 97,182 entries, ~4 s, no prompt |
| 2 | Daily gate and the 304 path | PASS |
| 3 | The three targets disagree | PASS — all three objects differ |
| 4 | Target resolution and credential safety | PASS — resolves with `low` confidence; no secrets |
| 5 | Offline path | PASS — cache served, `usesGithubApi: false` |
| 6 | Behavioural eval | **FAIL — reviewer never calls `check_objects`** |
| 7 | Gates | PASS |

**The server is verified. The feature is not yet done.** Every mechanical property the design
promised holds under test, and the one thing the milestone was really for — proving an agent
reaches for the data instead of recalling it — does not. Task 15 has to be reopened and this
eval re-run before the branch is called complete; the failure has a precise, cheap fix and a
static check that would hold it.
