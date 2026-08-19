# Modernization — Full Decision Tree

A more detailed expansion of the chart in the parent SKILL.md. Use it once per candidate transformation.

## Phase 1 — Is this the right TIME?

| Question | If YES | If NO |
|---|---|---|
| Are we in the middle of a production hotfix on the same object? | **Wait.** Modernization will collide. | Continue |
| Is the next SP / S/4 conversion happening this quarter? | If migration requires it, **prioritize**. Otherwise **wait** so the change set is reviewable. | Continue |
| Is the team at full sprint capacity already? | **Defer** to next sprint. Modernization needs review attention. | Continue |
| Has a customer outage / incident on this code happened recently? | **Add tests first**; the incident shows blind spots in coverage. | Continue |

If all four say "continue", time is OK.

## Phase 2 — Is the SCOPE understood?

| Question | If YES | If NO |
|---|---|---|
| Do I know who calls this code? (cross-package, cross-system?) | Continue | Run where-used. STOP until you know. |
| Is there test coverage I can run before / after? | Continue | Add characterization tests first. |
| Do I know the runtime behavior under load (response time, peak QPS)? | Continue | Get a baseline (SAT, ST05) before changing. |
| Is the data domain stable (no field-length change, no key change pending)? | Continue | Schedule modernization *after* the DDIC change. |

## Phase 3 — Is the BENEFIT real?

The modernization must deliver one or more concrete benefits. List them; if you can't name a concrete one, stop.

| Benefit | Concrete signal |
|---|---|
| Testability | "I will write 5+ ABAP Unit tests against the modernized form that I cannot write today." |
| Maintainability | "Average diff size for the next 3 changes drops because the new structure splits responsibilities." |
| Performance | "ST05 / SAT show measured improvement of X%." |
| Cloud readiness | "ATC `ABAP_CLOUD_READINESS` variant: N findings before, 0 after." |
| Removing modification | "Object key removed; clean upgrade path." |
| Removing duplicate code | "X lines of duplication identified between programs A, B, C; consolidate into class." |

Vague "more modern" / "Clean ABAP says so" / "feels cleaner" are *not* concrete benefits. Push back if those are the only justifications.

## Phase 4 — Is the RISK acceptable?

| Risk | Tolerable when |
|---|---|
| Public API change | Consumers are in same package and we control them, OR deprecation plan in place |
| ABI break (signature change visible to RFC / OData / BAPI) | Versioned API, consumers have migration window |
| Behavior subtly different (e.g. rounding, sort order) | Tests cover it AND the difference is communicated to stakeholders |
| Performance regression possible | Baseline measured; will re-measure after |
| Transport coordination across systems | TR sequence documented; downstream systems agreed |

If any "tolerable when" condition fails, either fix it first or don't proceed.

## Phase 5 — Choose the SHAPE

For the transformation itself, decide:

1. **Big-bang vs strangler.** Big-bang: one TR replaces old with new. Strangler: new code lives next to old; consumers migrate over time; old removed when no consumers remain. Strangler is safer; big-bang is faster.
2. **Per-method vs per-class.** Per-method: extract one method at a time, each in its own TR. Per-class: extract the class skeleton in TR 1, populate over subsequent TRs. Per-method is reviewer-friendly; per-class is when you've designed the target.
3. **Replace vs add adapter.** Replace: rewrite in place. Adapter: keep the old, add a new façade that's friendlier to use, deprecate the old. Adapter for public APIs; replace for internals.

## Phase 6 — Plan the TRANSPORT sequence

A modernization is rarely one TR. Sketch:

- TR-A: Add tests for current behavior (no production change)
- TR-B: Add the new structure alongside the old (no consumer change)
- TR-C: Switch the first consumer to the new structure (small, reviewable)
- TR-D: Switch remaining consumers in batches
- TR-E: Remove the old structure

Each TR independently transportable. Reverting TR-D is safe; the old still exists. Reverting TR-E is harder — that's where you commit.

## Phase 7 — VERIFY

Define how you'll know the modernization is successful before you start:

- All existing tests pass (regression-free).
- New tests cover the modernized code paths.
- Performance is equal or better (no regression on the metric you cared about).
- ATC finds fewer issues in the touched area.
- Stakeholders confirm behavior unchanged.

If you can't define verification before starting, you don't know what "done" means.

## Phase 8 — DOCUMENT

The transport request descriptions form the historical record. Each TR's description should answer:
- Why this modernization?
- What changed?
- What stayed the same?
- What benefit was measured?
- Reference to the design discussion (Confluence, ticket, etc.).

Skip this and the next developer reads the diff and assumes random churn.

---

## Anti-patterns the tree catches

- "Refactor while I'm here" — Phase 1 catches it (sprint capacity, scope mixing).
- "Modernize for cleanliness" — Phase 3 catches it (no concrete benefit).
- "Just rewrite the whole module" — Phase 5 catches it (big-bang without justification).
- "Test it in production" — Phase 7 catches it (no verification defined).
- "Will figure out who calls it later" — Phase 2 catches it (no where-used run).
