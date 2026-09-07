# The RAP Numbering Matrix

Deep dive for [SKILL.md](../SKILL.md). Grounded in the SAP ABAP cheat sheets
(`36_RAP_Behavior_Definition_Language.md` — numbering; `08_EML_ABAP_for_RAP.md` — RAP concepts and
the keys/`%pid` excursions), the RAP100 workshop sources, and the reuse-services sample.

## The two axes

Numbering = assigning values to primary key fields. Two independent questions:

- **When** does the final key exist?
  - *Early*: during the RAP create operation in the interaction phase.
  - *Late*: during the save sequence, exclusively in the `adjust_numbers` saver method.
- **Who** provides it?
  - *External*: the RAP BO consumer (keys arrive in the create request like any other field).
  - *Internal*: the RAP BO provider (framework or your code); the consumer sends no key.

Default when the BDEF specifies nothing: **external (early) numbering**.
Late numbering is **internal by definition** — no consumer interaction is possible in the late
save phase.

## The matrix, fully expanded

| Scenario | BDEF | Key field characteristics | Implementation | Uniqueness guaranteed by |
|---|---|---|---|---|
| External early | no clause | `field ( mandatory : create, readonly : update )` | none — consumer supplies keys | Consumer (duplicates rejected at save; add a `precheck` if you want earlier detection) |
| Managed internal early (UUID) | `field ( numbering : managed ) KeyField;` | `readonly` (+ `numbering : managed`) | none — framework assigns a UUID at create | Framework. Prerequisite: key is a 16-character byte-like type (UUID), e.g. `sysuuid_x16` |
| Optional external | `field ( numbering : managed )` **without** `readonly` | consumer may pass a key | none | Framework fills only initial keys; consumer-provided values win |
| Unmanaged internal early | `early numbering` (entity clause) | `readonly` | `FOR NUMBERING` handler method | Your code |
| Unmanaged BO, internal early | none (plain unmanaged BO) | `readonly` | keys assigned inside the `create` handler | Your code. The explicit `early numbering` clause applies to managed BOs and unmanaged **draft-enabled** BOs |
| Late numbering | `late numbering` (entity clause) | `readonly` | `adjust_numbers` saver method | Your code |

General rules:

- Where the framework does not number for you, uniqueness checks are **your** responsibility
  (e.g. in a precheck).
- After creation, a primary key can no longer be changed — late numbering is the one sanctioned
  exception, replacing a *temporary* key with the final one just before the database save.

## Preliminary identifiers in late numbering

During the interaction phase and the early save phase, created instances are addressed by
preliminary identifiers:

| Component | Type | Role |
|---|---|---|
| `%pid` | `ABP_BEHV_PID` | Preliminary ID; exists only in late-numbering scenarios; stable until the final key is assigned |
| `%key` | entity keys | May hold *preliminary* key values (e.g. a drawn temporary number) |
| `%pky` | component group | `%pid` + `%key`; for contexts (certain actions) where `%tky` is unavailable |
| `%tky` | component group | Transactional key: `%pky` + `%is_draft`. Use it everywhere — it survives a later switch to draft or late numbering |
| `%cid` | `ABP_BEHV_CID` | Consumer-side content ID; short-lived — valid only within the current EML request in the interaction phase. Not a numbering concept, but often confused with `%pid` |

You may work with `%pid`, a preliminary `%key`, or both — `%tky` must uniquely identify the
instance in total.

## Inside `adjust_numbers`

When the runtime reaches `adjust_numbers`, roles shift:

- The preliminary key values from `%key` are moved to **`%tmp`** (which takes over the role `%key`
  had in the interaction phase).
- `%pid` stays as is.
- **`%pre`** = `%pid` + `%tmp` — all preliminary identifiers in one component group.
- Your contract: in the `mapped` response parameter, map every `%pre` (unique in total) to the
  **final key values in `%key`**.

Minimal form (cheat-sheet "RAP calculator" demo — the key is typed `sysuuid_x16`, so the `%pid`
value itself is a valid final key):

```abap
METHOD adjust_numbers.
  LOOP AT mapped-calc ASSIGNING FIELD-SYMBOL(<fs_calculation>).
    <fs_calculation>-%key-id = <fs_calculation>-%pid.
  ENDLOOP.
ENDMETHOD.
```

Production form with a number range and a child entity — see
[../examples/late-numbering-adjust-numbers.abap](../examples/late-numbering-adjust-numbers.abap).
The child pattern (from the reuse-services sales-order sample): children created under a
still-unnumbered parent resolve the parent's final key through a `READ ENTITIES ... BY \_Parent ...
LINK` call keyed on `%pid` / `%tmp`, then receive their own item numbers.

Note the number range API (`cl_numberrange_runtime=>number_get`) commits on a secondary database
connection — that is why calling it inside the save sequence (and in `FOR NUMBERING` handlers)
is legal.

## Getting final keys back to the consumer

- `COMMIT ENTITIES RESPONSE OF bdef ...` — the short/long forms return `failed` / `reported`;
  the long form supports key conversion in late-numbering scenarios.
- `CONVERT KEY OF bdef FROM <pid-or-preliminary-key> TO <final-key>` — converts a remembered
  preliminary identifier into the final key. Requires the final key to exist: valid after the
  target BO's `adjust_numbers` has run. The RAP610 workshop calls it inside its own BO's
  `save_modified` (its save sequence runs after the called BO assigned final numbers in the same
  RAP transaction). Consumer-side, `CONVERT KEY` belongs inside a `COMMIT ENTITIES BEGIN ...
  COMMIT ENTITIES END` commit scope — once the scope ends, preliminary identifiers can no longer
  be resolved.
- In a `FOR NUMBERING` handler (early), the final key is returned to the consumer immediately via
  `mapped` (`%cid` + `%key`), so no conversion is ever needed.

## `FOR NUMBERING` handler contract (early, unmanaged internal)

```abap
METHODS earlynumbering_create FOR NUMBERING
  IMPORTING entities FOR CREATE Travel.

METHODS earlynumbering_cba_booking FOR NUMBERING
  IMPORTING entities FOR CREATE Travel\_Booking.   "create-by-association variant
```

Rules distilled from the RAP100 implementation:

- **Idempotency**: instances that already carry a key (relevant in draft scenarios — the method
  can run again on resume) go straight to `mapped` untouched; number only the rest.
- Draw numbers for the remainder (number range object, `MAX( key )` from active *and* draft
  tables, or UUID via framework), assign, and append `%cid` + `%key` + `%is_draft` to `mapped`.
- On numbering errors, fill `failed` and `reported` (with `%cid`) so the create fails cleanly in
  the interaction phase — much better than failing at save.

## Draft interactions

- `early numbering` is available for managed BOs and for unmanaged **draft-enabled** BOs; in a
  plain unmanaged BO the create handler simply assigns keys itself.
- `late numbering` works for managed and unmanaged BOs, draft or not; the draft instance lives
  under its preliminary identifiers until activation triggers the save sequence.
- `%tky` includes `%is_draft`, so code written against `%tky` survives enabling draft later —
  another reason to never address instances by bare `%key`.

## Key component-group assignment hygiene

From the cheat sheet's keys excursion:

- Refer to whole keys via component groups (`%tky` preferred), never by listing key fields.
- Do not mix groups of the same entity (`wa-%tky = wa-%key`) or copy the same group across
  *different* entities (`root-%tky = child-%tky`) — type compatibility is not guaranteed once
  components are added (draft, late numbering). Use `CORRESPONDING #( ... )` there.
- Direct assignment is fine (and faster) between data objects of the *same* group of the *same*
  entity — e.g. filling `failed` / `reported` from a read result.
