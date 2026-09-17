# Retrieval Discipline

Minimize repository-*discovery* work. The failure mode this protocol prevents is
**repeated near-identical searches that return nothing** — the same object hunted
five different ways, often after its exact name was already known — which burns
time and tokens without moving the actual task forward.

> **This repo ships as a Claude Code plugin.** A dispatched agent's working
> directory is the *user's own project*, not this plugin's installation
> directory. The rules below are about how you locate and read code in that
> project; they are harness-agnostic and apply whether you are reading a local
> git clone or a connected SAP ADT session.

## Known-path rule

If an exact file or object path is already known — from the current
conversation, the user's own message, a previous tool result, project
documentation, or something you already opened in this task — **read it
directly**. Never issue a search merely to reconfirm that an already-known path
exists. A path you were handed is not a hypothesis to re-verify.

## One-miss rule

After **one** search for an object or symbol comes back empty, **change
strategy** — do not reissue the same search with minor casing or pattern
variations. `search → no match → search → search → search` is the anti-pattern.
The correct shape is:

```
search → no match → change retrieval method
```

Change of method means: read the containing object directly, widen the scope
*deliberately* (a broader directory, a known parent), or — if the target
genuinely can't be located — say so and ask, rather than grinding equivalent
queries.

## SAP ADT virtual filesystem (`abap:/…`)

**Text-search and glob tools are unreliable against the ADT virtual filesystem** —
a search can come back empty even when the object is right there. Don't use
grep/glob as the *primary* retrieval method for `abap:/…` resources. The
dependable path is:

**Read the whole object once, then search *within* that content in context.**

So for a known SAP object, go straight to a direct `Read`; do not open with a
search against its `abap:/` path. After one failed search against an `abap:/`
resource, don't retry with tweaked patterns — switch to a direct `Read`.

(This caveat is specific to the ADT virtual filesystem. Against an ordinary
local source tree, normal text-search and glob tools work fine — the
known-path and one-miss rules still apply, but grep is not the problem there.)

**SAP framework source is a known path.** SAP-delivered classes and interfaces are
readable under the *System Library* node; the URI shape is

```
abap:/repotree-v1/<DEST>/System Library/(<NS>)<PKG>/…/Source Code Library/{Classes,Interfaces}/<name>
e.g. …/System Library/(IWBEP)FRAMEWORK/(IWBEP)MAIN/(IWBEP)CP/(IWBEP)CP_RUNTIME/Source Code Library/Classes/
```

Read the implementing class the **second** time a compile or runtime iteration fails on the
same framework API — before the third attempt, not after the tenth. A generated class (e.g. a
Service Consumption Model) is the authoritative dictionary for the names it generates; read
its `gcs_*` constants and `tys_*` types rather than inferring from metadata files.

**Large single-line files** (an EDMX `$metadata`, minified JSON) defeat editor search and
reading by eye. Use the terminal — `grep -o 'Name="[^"]*"'`, `tr '>' '\n'` — and paste the
exact tokens into the code.

## Progressive, not broad-first

Match the search width to what the prompt already gives you:

```
known object, known repository        → direct Read
known object, unknown exact include   → one narrow file lookup
unknown object, known symbol          → one scoped text search
only if those fail                    → broaden scope
```

Never open with a repository-wide glob when the prompt already handed you an
exact class, method, or object name. Start narrow; broaden only on a miss.

## Behavior-preserving refactors — compare once, not one gap at a time

A transformation that delegates or moves existing logic (e.g. rewiring a
behavior pool to call a shared helper class) carries a risk beyond "does it
compile": a validation, an error-handling branch, a caching step, or a
normalization detail can be silently dropped in the move. Don't discover these
one at a time as separate corrections after the fact — audit for all of them
in one pass, before you call the transformation done:

1. Resolve the original and the new implementation's paths once (see
   known-path rule and path reuse above).
2. Read the complete relevant method or logical unit from **both** versions —
   not a diff, not a skim; the whole thing, both sides.
3. Build an ordered behavior checklist **from the original**, covering:
   - validations and the order they run in
   - error-handling control flow (e.g. fail-fast-and-abort vs skip-and-continue vs collect-then-gate)
   - conversions, normalization, defensive formatting
   - caching/deduplication that avoids redundant calls
   - external calls (BAPI/RFC/API) and their parameters
   - transaction/commit boundaries and LUW ownership
   - constants vs values read dynamically from input
4. Mark every item **preserved**, **intentionally changed** (and why), or
   **missing**.
5. Only after the checklist is complete, make edits — fixing five gaps
   discovered five separate times costs more than one structured pass.
6. Re-read the affected method once after editing, to confirm the fix didn't
   introduce a new gap against the same checklist.

This applies whenever a refactor's goal is to preserve existing behavior,
whether or not the task is framed as "modernization" — a RAP behavior pool
delegating to a new helper class needs the same audit as a classic
FORM-to-method conversion.

## Path reuse across the task

Once you have resolved an object's relevant paths — its definition,
implementation, any test include, and any reference source you are comparing
against — **keep them and reuse them for the rest of the task**, including after
a context compaction. Do not rediscover an object you already located earlier in
the same task. Carrying a small mental object→path map forward turns a later
"where is this now?" into one or two direct reads instead of a fresh search
sweep.
