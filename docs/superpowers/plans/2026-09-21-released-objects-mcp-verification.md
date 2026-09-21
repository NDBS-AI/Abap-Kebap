# Milestone verification — the `released-objects` MCP server

**Date:** 2026-09-21
**Branch:** `feature/released-objects-mcp`
**Node:** v26.2.0 · **Claude Code:** 2.1.178

This record covers the end-to-end verification of the `released-objects` MCP server after
Tasks 1–16. Earlier tasks proved the parts; this one proves the feature: that a fresh install
provisions the data by itself, that the daily gate and the offline path behave, that the three
targets disagree where SAP's data says they should, and that a review agent actually reaches
for the tool instead of recalling.

**Summary: checks 1-5 and 7 PASS. Check 6, the behavioural eval, FAILS on haiku — 1 of 3 runs —
and PASSES on opus, 1 of 1.** Three agent-side fixes landed while this record was being written:
`36c1cf5` made the deferred tools discoverable, `dd11075` told the agent to search the data before
naming a replacement, and `273575f` promoted the released-object check into the mandatory
preflight. The first and third are fully verified: the check now fires on 4 of 4 runs across both
models, up from 2 of 5. The second holds on opus but not on haiku, which calls `check_objects`,
gets `not-found`, then names a remembered entity instead of calling `search_objects`. The full
history — the original failure, its diagnosis, and three measured re-runs — is recorded under
Check 6 and the sections that follow it.

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


---

## Behavioural eval — re-run after `36c1cf5` — PASS

Commit `36c1cf5` ("fix(agents): load the deferred released-objects tools before calling them")
changed the shared released-objects block in all three `abap-kebap-*` agents to address the
mechanism diagnosed in Check 6. It now tells the agent to load the tools with a **keyword**
`ToolSearch` query, `released-objects check_objects`, explicitly warning against `select:` with
the bare name, and to refuse a release verdict from memory when no tool is found.

The eval was re-run with the identical command and prompt.

```bash
claude --plugin-dir . --model haiku --agent abap-kebap-reviewer --output-format stream-json --verbose   --allowedTools "mcp__plugin_abap-kebap_released-objects__check_objects" "...search_objects" "...dataset_info"     "Read" "Grep" "Glob" "Skill" "ToolSearch"   -p "Review this ABAP for a BTP ABAP environment target: SELECT * FROM mara INTO TABLE @DATA(lt_mara) WHERE matnr = @lv_matnr. Give your findings."
```

**Result: PASS.** The tool was found and called. 11 turns, 52 s.

### Evidence

The keyword query resolves, where the old `select:` lookup returned nothing:

```
TOOL_USE: ToolSearch {"query":"released-objects check_objects","max_results":5}
  RESULT: [{"type":"tool_reference","tool_name":"mcp__plugin_abap-kebap_released-objects__check_objects"},
           {"type":"tool_reference","tool_name":"mcp__plugin_abap-kebap_released-objects__dataset_info"}, ...]
```

The agent then called the tool by the name `ToolSearch` returned, with the right target and a
correctly narrowed object type:

```
TOOL_USE: mcp__plugin_abap-kebap_released-objects__check_objects
          {"objects":[{"name":"MARA","type":"TABL"}],"target":"btp-abap-environment"}
  RESULT: verdict: not-found | found: false | impliedLevel: none | allowed: false
          summary: {"total":1,"allowed":0,"blocked":0,"deprecated":0,"notFound":1,"ambiguous":0}
```

The answer's headline matches what the tool returned:

> "**[line 1] `MARA` table is not released for ABAP Cloud / BTP environment** — the statement
> will not activate."

That is the correct reading of `not-found` on this target, and it is now sourced from the data
rather than from recall. Both eval criteria — the tool is called, and the answer cites what it
returned — are met.

### Residual weakness — the replacement object is still named from memory

The same answer continues:

> "Use the released CDS entity `I_Material` or `I_MaterialPlant` instead."

**`search_objects` was never called**, and neither name is in the data. Queried directly against
the same dataset:

```
check_objects ["I_Material","I_MaterialPlant"] target btp-abap-environment
  → I_Material:      verdict "not-found", found false
  → I_MaterialPlant: verdict "not-found", found false
```

So the agent opens with "I have the skills and the released-objects data" and then supplies a
successor it did not get from that data, presented with the same confidence as the verdict it
did. This is the original Check 6 failure mode, now confined to the successor rather than the
verdict — a smaller blast radius, but the same kind of error.

Three things are worth separating here:

1. The fix in `36c1cf5` did what it set out to do. Tool discovery was the blocker; it is gone.
2. The agent block tells the agent to call `search_objects` "when an object comes back blocked or
   deprecated". `not-found` is neither, so on this target the instruction does not fire —
   and `not-found` is precisely the case where the agent has *least* information and is most
   likely to fall back on memory. Widening that trigger to include `not-found` would close it.
3. As recorded under Check 3, the BTP dataset contains no material-master entity at all, so
   `search_objects` may legitimately find nothing. The right behaviour is then to say so, not to
   supply a remembered name. The "refuse a verdict from memory" rule added by `36c1cf5` covers a
   missing *tool*; it does not yet cover a missing *answer*.

None of this blocks the milestone. It is a follow-up worth one more small agent-prose change,
and a candidate for a future eval assertion.

### Model note

The coordinator's fallback — re-run on `--model opus` if haiku still did not call the tool — was
**not triggered**, because haiku did call it. The wiring is therefore proven on the cheapest
model, which is the stronger result. An opus run would only be informative for the residual
successor-naming weakness above, and was skipped as an unnecessary cost.


---

## Behavioural eval — re-run after `dd11075` — MIXED (the designated run FAILS)

Commit `dd11075` ("fix(agents): search the data before naming any replacement object") widened the
`search_objects` trigger in the shared agent block to cover `not-found` as well as `blocked` and
`deprecated`, and added the rule: name only what `search_objects` returns, and if it returns
nothing, say the data lists no released replacement for this target — never supply one from
memory. That targets exactly the residual recorded in the previous section.

The eval was re-run with the same command and prompt as before, on haiku.

**The designated run (`eval3`) FAILS both criteria: it made no released-objects tool call at
all.** Because a single sample contradicted the previous run, the eval was repeated twice more to
tell a regression from run-to-run variance. Across three post-`dd11075` runs:

| Run | `ToolSearch` | `check_objects` | `search_objects` | (a) verdict from data | (b) replacement discipline |
|---|---|---|---|---|---|
| 3 (designated) | not called | not called | not called | **FAIL** | **FAIL** |
| 4 | called | called | called x3 | **PASS** | **PASS** |
| 5 | not called | not called | not called | **FAIL** | **FAIL** |

The MCP server was `pending` at init in all three, exactly as it was in the passing run of the
previous section, so the difference is not a connection race — it is whether the model elects to
do the lookup at all.

### Run 4 — the chain fires, and `dd11075` does its job

```
TOOL_USE: Skill {"skill":"abap-cloud-development"}
TOOL_USE: ToolSearch {"query":"released-objects check_objects","max_results":3}
TOOL_USE: ...__check_objects  {"objects":["MARA"],"target":"btp-abap-environment"}
  RESULT: verdict "not-found", found false, summary {"total":1,"notFound":1,...}
TOOL_USE: ...__search_objects {"query":"material master mara","target":"btp-abap-environment","limit":10}
  RESULT: total 0, hits []
TOOL_USE: ...__search_objects {"query":"material master released","target":"btp-abap-environment","objectType":"DDLS","limit":15}
  RESULT: total 0, hits []
TOOL_USE: ...__search_objects {"query":"material","target":"btp-abap-environment","objectType":"DDLS","limit":20}
  RESULT: total 0, hits []
```

Criterion (a) — the text matches the verdict:

> "Code will not compile in BTP ABAP environment — `MARA` is not a released SAP table for ABAP
> for Cloud Development."

Criterion (b) — the agent searched three times, got nothing, and **said so** rather than
asserting a remembered name:

> "The search results returned no results for 'material master' in BTP released objects — you may
> need to check whether a VDM entity like `I_Product` covers your needs, or whether you should be
> reading via a released RAP BO service instead of direct SQL."

This is the behaviour `dd11075` asked for, and it is a real improvement on the previous section's
run, which flatly instructed "Use the released CDS entity `I_Material`". The disclosure satisfies
the "states that the data lists no released replacement" branch. It is worth noting that the
answer still floats `I_Product` and `I_Material*` as hedged suggestions under a "Questions (need
context)" heading; they are framed as things for the developer to verify rather than as the
answer, and they sit next to the explicit statement that the search found nothing, so the
criterion is met — but the instinct to reach for a remembered name has not disappeared, it has
been demoted.

### Runs 3 and 5 — no lookup at all

Both produced a competent-looking review from memory in three turns, after loading only the
`abap-cloud-development` skill, and both named replacement entities that no search returned:

> Run 3: "Candidates: `I_Material`, `I_MaterialBasic`, or similar — verify in ADT, Project
> Explorer, Released Objects ... or use the `released-objects` MCP server's `search_objects` tool
> (available once connecting completes)."
>
> Run 5: "Use the released CDS entity `I_Material` or `I_ProductValuation` instead."

Run 3's parenthetical is telling: the agent believed the server was still connecting and
proceeded anyway instead of retrying or declaring the data unavailable — the exact fallback the
agent block forbids.

### Reading

The *content* of `dd11075` is correct and verified: when the chain fires, the agent now searches
before naming anything and reports honestly when the data has no answer (run 4). The problem has
moved. It is no longer "the agent names the wrong object" or "the agent cannot find the tool" —
it is that on haiku the routing fires only sometimes. Counting the run from the previous section,
the tool was reached in 2 of 5 runs of this prompt.

Two candidate causes, not distinguished here:

1. **Model strength.** Haiku is the cheapest model and was chosen for cost. The agent block is
   long, and the released-objects rules sit well below the skill-routing preflight that the agent
   does reliably execute. A stronger model may well follow it every time.
2. **Instruction placement.** In every failing run the agent loaded a skill and answered
   immediately; in both passing runs it did the lookup right after the skill load. Making the
   released-objects check part of the same mandatory preflight as skill routing — rather than a
   rule further down — would make it structural rather than discretionary.

Recommended before the branch is called done: one run of this eval on a stronger model to
separate those two causes, and if placement is implicated, move the released-objects call into
the preflight. No server change is indicated; this remains entirely agent-side, and the static
checks that guard the prose all pass.


---

## Behavioural eval — after preflight step `273575f` — FAIL (haiku 1/3, opus 1/1)

Commit `273575f` promoted the released-object check to the first paragraph of each agent's
`## Skill routing — mandatory preflight` section, stating that it "is not satisfied by loading a
skill". That targets the placement hypothesis raised in the previous section.

Four runs of the same prompt and command: three on haiku, one on opus.

| Run | Model | Tool-call sequence | (a) verdict from data | (b) replacement discipline |
|---|---|---|---|---|
| h1 | haiku | `ToolSearch` → `check_objects` → `Skill` | **PASS** | **FAIL** |
| h2 | haiku | `ToolSearch` → `check_objects` → `Skill` | **PASS** | **FAIL** |
| h3 | haiku | `ToolSearch` → `Skill` ×2 → `check_objects` → `search_objects` ×2 | **PASS** | **PASS** |
| o1 | opus | `ToolSearch` → `Skill` → `check_objects` → `search_objects` ×2 | **PASS** | **PASS** |

**Criterion (a): 4 of 4 — haiku 3/3, opus 1/1.**
**Criterion (b): 2 of 4 — haiku 1/3, opus 1/1.**
**Both criteria together: haiku 1/3, opus 1/1 → FAIL** against the stated bar of haiku ≥ 2/3 and
opus 1/1.

### The preflight step worked — criterion (a) is solved

Every run called `check_objects` with the right target and read the result correctly; all four
returned `verdict: "not-found"`, `found: false`. In h1 and h2 the `ToolSearch` and the
`check_objects` call happen **before any skill is loaded** — the ordering the preflight paragraph
asks for, and a direct reversal of the failing runs in the previous section, where the agent
loaded a skill and answered without ever looking. Tool invocation across the prompt's history
went from 2 of 5 runs to 4 of 4.

The answers cite the tool rather than paraphrasing memory. From h1:

> "**[line 1] `MARA` table is not released for BTP ABAP Cloud** — The `released-objects` tool
> (fresh as of today) reports this table as `not-found` in the BTP ABAP environment catalog. This
> code will fail at syntax-check time in ADT with 'not a released object.'"

### Criterion (b) is where haiku still fails

All six `search_objects` calls made across h3 and o1 returned `total: 0`, confirming the BTP
dataset carries no material-master entity (consistent with Check 3).

**h3 — PASS.** Searched `"material master"` and then `"I_Material"` directly, both `total: 0`, and
reported the absence instead of asserting a name:

> "the released-objects data shows no material master CDS on BTP ABAP as of the latest refresh
> 2026-07-29" … "The released-objects data shows no `I_Material` or equivalent on BTP ABAP."

**o1 (opus) — PASS, and the best answer of the four.** Searched `"product"` and `"material"`, both
`total: 0`, and then drew the distinction the data actually supports:

> "If you actually meant S/4HANA Cloud (public or private), say so — `I_Product` exists there and
> the verdict changes; it does not exist on standalone Steampunk."

That is exactly right per Check 3: `I_PRODUCT` is `allowed` level `A` on both ERP targets and
`not-found` on BTP. The model named an object only where the data supports it and scoped the
claim to the target where it holds.

**h1 and h2 — FAIL.** Both called `check_objects`, got `not-found`, and then skipped
`search_objects` entirely and supplied a remembered entity as the fix:

> h1: "**Next step:** Identify the released CDS entity that provides material master data (likely
> `I_Material` or in the Materials application component)" — followed by a rewritten statement
> selecting `FROM i_material`.
>
> h2: "**Fix:** Search for the released CDS entity that exposes material data (typically
> `I_Material`, `I_MaterialPlant`, or a custom consumption view), then use `SELECT … FROM
> i_material …`."

Neither states that the data lists no released replacement, and neither name is in the dataset for
any target (`I_Material` and `I_MaterialPlant` both return `not-found` on BTP; the real successors
on the ERP targets are `I_PRODUCT` and its siblings). h1 and h2 both instruct the *user* to run
`search_objects` — the agent knows the tool is the right move and delegates it rather than doing
it. They hedge ("likely", "typically", "depends on your configuration"), but a hedge attached to a
concrete wrong name in a code rewrite is not the behaviour the rule asks for.

### Reading: the misses are now model-dependent, not placement-dependent

The placement change resolved what it was aimed at, completely. The released-object *check* is now
structural: it fires first, on every run, on both models, and its result is quoted accurately.
What did not transfer is the *second* rule in the same block — search before naming a replacement.
Opus follows both rules; haiku follows the first reliably and the second in one run of three. The
distinguishing factor is no longer where the instruction sits, because both rules now sit in the
same promoted paragraph and only one of them is obeyed. It is that the first rule is a single
unconditional action at the start of the task, while the second is conditional, fires later, and
competes with a strong prior — the model "knows" a material CDS entity exists and reaches for it.
Promoting the sentence further is unlikely to help; the options worth considering are making the
successor lookup unconditional whenever a verdict is not `allowed`, so it is a step rather than a
judgement, or reserving the reviewer role for a stronger model when released-object accuracy
matters. Note also that the `not-found` case is the expensive one to get wrong: it is where the
data is silent, so a remembered name faces no contradiction and reads as authoritative.

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
| 6 | Behavioural eval | **FAIL on haiku (1/3)**, PASS on opus (1/1) — see preflight measurement |
| 7 | Gates | PASS |

**The server is verified. The routing half-works, and the remaining gap is model strength.**
Every mechanical property the design promised holds under test. Three agent-side fixes were made
and measured here, and two of them are done: the tools are discoverable, and the released-object
*check* now runs as a preflight step on every run of both models, with its verdict quoted
accurately. The third rule — search the data before naming a replacement — is obeyed by opus and
by haiku only once in three, and the failure mode is specific: after a `not-found` verdict, where
the data is silent and a remembered name meets no contradiction, haiku supplies one anyway. The
two options worth weighing are making the successor lookup unconditional for any non-`allowed`
verdict, so it becomes a step rather than a judgement, and running the reviewer on a stronger
model where released-object accuracy matters. Neither is a server change.
