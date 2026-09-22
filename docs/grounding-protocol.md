# Grounding Protocol — Verify Before You Assert

Every ABAP agent carries distilled skills, not the source of truth. Distillations lag releases and can carry transcription errors (a real one shipped: `@Semantics.systemDate.*` instead of `@Semantics.systemDateTime.*`). This protocol makes agents **confirm uncertain facts against authoritative public sources at answer time** instead of asserting from memory.

It is grounding via **remote sources only** — WebSearch + WebFetch against the canonical GitHub repos and SAP Help. (Local clones and ADT MCP are intentionally out of scope for now.)

## The rule

When you are about to state any of the following and are **not certain**, verify first:
- exact CDS / RAP annotation names and sub-properties,
- BDL (behavior definition) clauses and EML statement syntax,
- released-API class / interface / method names and their release contract,
- ABAP statement syntax or additions you rarely use,
- "since which release / is this allowed in ABAP Cloud" claims.

Procedure:
1. **`WebSearch`** to locate the authoritative page when you don't already have the URL.
2. **`WebFetch`** the source and confirm the exact token against it.
3. **Cite** the URL you verified against in your answer.
4. If you cannot reach a source, say the claim is **unverified** — do not guess.

This applies before *asserting*, not before *every* sentence. Well-known, stable syntax (e.g. `LOOP AT … ASSIGNING`) does not need a fetch. The trigger is **uncertainty about an exact token**, especially annotations, BDL, and released-API names — the high-error-rate areas.

## Cost discipline

WebFetch is not free — a single fetch of a large reference (e.g. `CleanABAP.md` ~5000 lines, a cheat-sheet file thousands of lines) can cost tens of thousands of tokens. So:

- **The skill is your default source.** It is already distilled. Answer from it first; only fetch when the skill does not cover the token or you are genuinely unsure.
- **Fetch narrowly.** Target the smallest authoritative page or section, not a whole multi-thousand-line document. Prefer a specific cheat-sheet file or a focused Help page over a top-level index.
- **Never routinely.** Do not fetch to "double-check" well-known syntax. One targeted fetch for the one uncertain token, not a fetch per claim.
- This keeps grounding's precision benefit for the rare uncertain case without taxing every answer. (Note: regression *evals* run skill-only — no fetching — both to stay cheap and to actually test what the skills teach.)

## Source preference order

1. **Raw GitHub markdown** — deterministic, already markdown, cleanest for `WebFetch`:
   - `https://raw.githubusercontent.com/SAP-samples/abap-cheat-sheets/main/<file>.md`
   - `https://raw.githubusercontent.com/SAP/styleguides/main/clean-abap/CleanABAP.md`
   - `https://raw.githubusercontent.com/SAP-samples/abap-platform-rap-workshops/main/<path>`
2. **SAP Help** — ABAP Keyword Documentation and product guides (authoritative, but JS-heavy; WebFetch converts to markdown):
   - `https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm` (Standard ABAP keyword doc)
   - `https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm` (ABAP for Cloud Development keyword doc)
3. **api.sap.com** — released-API catalog and release state (SAP Business Accelerator Hub).

Prefer the GitHub `blob` URL if you want a human-readable view; prefer `raw.githubusercontent.com` when you only need the text for verification.

## Optional structured source — the sap-devs CLI (main session)

The `sap-devs` CLI — tutorial search with guided walkthroughs, tips, canonical
samples, known-error lookup (CAP/BTP-centric; ABAP runtime errors are not in
its database), and CF/BTP inspection tools. It is a Go binary from
[SAP-samples/sap-devs-cli](https://github.com/SAP-samples/sap-devs-cli)
(the `npm i -g sap-devs` command shown on the api-docs page is stale as of
2026-08 — no such npm package exists). Install via Scoop (Windows), Homebrew
(macOS), or a GitHub Releases binary, then:

```bash
sap-devs sync --force
claude mcp add sap-devs-server -- <path-to>/sap-devs mcp serve
```

Surface reference: https://developers.sap.com/api-docs/

Constraints — read before relying on it:
- Its tutorial/sample database is a curated subset (~1,200 entries) — narrower
  than the full developers.sap.com catalog, and CAP/BTP-leaning; a query can
  legitimately come back empty (e.g. there is no dedicated "unmanaged RAP
  scenario" tutorial indexed as of 2026-08). Fall back to the source preference
  order above when it does.
- These tools serve the **main session**. The ABAP agents keep grounding via
  WebFetch per this protocol, and they additionally have the `released-objects`
  MCP server available alongside their tools list.
- Reach for it when the question is tutorial-shaped ("how does the RAP
  tutorial wire the draft action"). For exact-token verification the source
  preference order above still wins.

**Not included:** SAP also publishes an anonymous hosted MCP server at
`https://developers.sap.com/mcp/search` over the same tutorial catalog. Its
tools answer without a token at the protocol level, but Claude Code's
client-side OAuth discovery gates them behind a login anyway (SAP publishes
OAuth protected-resource metadata site-wide), and that login path is
unusable — SAP's edge network (Akamai) hard-blocks the dynamic
client-registration endpoint (`developers.sap.com/register`) the flow depends
on, returning a 403 "Access Denied" HTML page. Verified 2026-08-15 via a raw
JSON-RPC `initialize` call (200 OK, no auth) and via `claude mcp add`
(registers, then panel/`mcp list` gate it on the broken OAuth flow). Not
worth registering until SAP fixes either side of that mismatch.

## Topic → authoritative source map

| Topic | Verify against |
|---|---|
| Clean ABAP rule / naming / construct | `SAP/styleguides` → `clean-abap/CleanABAP.md` |
| ABAP Code Review process | `SAP/styleguides` → `abap-code-review/ABAPCodeReview.md` |
| CDS annotations (`@Semantics`, `@UI`, `@ObjectModel`, …) | `help.sap.com/docs/abap-cloud/abap-data-models/cds-annotations` + cross-check against a workshop CDS source in `SAP-samples/abap-platform-rap-workshops` |
| CDS language elements / syntax | ABAP keyword doc (CDS section) + `SAP-samples/abap-cheat-sheets` CDS file |
| RAP BDL (behavior definition) clauses | `help.sap.com/docs/abap-cloud/abap-rap/` + RAP BDL feature table + a workshop `.bdef` source |
| RAP behavior implementation / saver / handler | `SAP-samples/abap-platform-rap-workshops` behavior-pool sources + RAP dev guide |
| EML statements & result channels | `SAP-samples/abap-cheat-sheets` → `08_EML_ABAP_for_RAP.md` |
| ABAP SQL / FOR ALL ENTRIES / CTE syntax | ABAP keyword doc (ABAP SQL) + cheat-sheet SQL file |
| ABAP Unit / test doubles | cheat-sheet ABAP Unit file + ABAP keyword doc |
| Authorization (AUTHORITY-CHECK, DCL, RAP auth) | ABAP keyword doc + RAP dev guide (authorization) |
| Released APIs / ABAP Cloud allowed-or-not | `released-objects` MCP server → `check_objects` (first source); `api.sap.com` + ABAP for Cloud Development keyword doc as the fallback when the server is unavailable |
| "Since which release" / release news | ABAP keyword doc release news (`abennews.htm`) |

Each skill's own `## References` section lists the precise URLs for its topic — that is the first place to look when the loaded skill matches the question.

## Worked example

Question: *"Which annotation marks the created-at timestamp in a RAP-ready CDS view?"*

- Uncertain between `@Semantics.systemDate.createdAt` and `@Semantics.systemDateTime.createdAt`.
- `WebFetch` `help.sap.com` CDS annotations page **and/or** a workshop CDS source (e.g. a `*.ddls` file under `SAP-samples/abap-platform-rap-workshops`) and confirm the exact token is `@Semantics.systemDateTime.createdAt`.
- Answer with the confirmed token and cite the URL.

That single fetch is what turns a plausible-but-wrong answer into a correct, cited one.
