# EML — Quick Reference

EML (Entity Manipulation Language) is how ABAP code — consumers, tests, and the behavior pool itself — drives a RAP BO's transactional buffer; nothing persists before `COMMIT ENTITIES`. This card is the overview; the deep dive lives in [rap-eml](../../rap-eml/SKILL.md).

## The EML verbs

| Verb | Purpose | Response parameters |
|---|---|---|
| `MODIFY ENTITIES [OF root]` | CREATE / CREATE BY `\_assoc` / UPDATE / DELETE / EXECUTE action against the transactional buffer | `MAPPED`, `FAILED`, `REPORTED` (+ `RESULT` directly after an `EXECUTE` whose action declares a result) |
| `READ ENTITIES [OF root]` | Read buffer state (including uncommitted changes), also by association | `RESULT` (mandatory), `LINK` (by association, optional), `FAILED`, `REPORTED` |
| `COMMIT ENTITIES` | Trigger the save sequence and persist (top-level code only: never in a handler, a saver or anything they call); check `sy-subrc` (0 ok / 4 early-save failed / 8 late-save failed) | `RESPONSE OF root FAILED ... REPORTED ...`; variants: `IN SIMULATION MODE`, commit scope `BEGIN ... END` |
| `ROLLBACK ENTITIES` | Discard the RAP transaction: clear the buffer, release locks | none |
| `GET PERMISSIONS` | Ask what the user/instance may do (authorization + feature control), e.g. for UI enablement | `REQUEST` (input, a structure), `RESULT`, `FAILED`, `REPORTED` |
| `SET LOCKS` | Acquire the exclusive locks up front (held until commit/rollback) | `FAILED`, `REPORTED` |

Failures do not raise exceptions — they land in `FAILED` (with `%fail-cause`), messages in `REPORTED`. Evaluate both, and check `sy-subrc` after `COMMIT ENTITIES`.

## The most-used % components

Consistent with the full catalog in [rap-eml/references/derived-types.md](../../rap-eml/references/derived-types.md):

| Component | Meaning |
|---|---|
| `%cid` | Content ID: your request-local identifier for each CREATE row (mandatory, unique per request) |
| `%cid_ref` | Reference to a `%cid` of the same request — targets a just-created instance |
| `%key` | Component group: all primary key fields |
| `%tky` | Transactional key = `%key` + `%is_draft` (+ `%pid`) — the identifier to prefer everywhere |
| `%is_draft` | Draft indicator (`mk-on` = draft instance, `mk-off` = active) |
| `%pid` | Preliminary ID — late-numbering scenarios only |
| `%data` | Component group: all key + data fields |
| `%control` | One flag per field: which fields the request/response respects (`FIELDS ( ... ) WITH` fills it for you; `FROM` does not) |
| `%element` | One flag per field in `reported` rows — marks which fields a message relates to |
| `%msg` | Message object in `reported` rows (`new_message( )` / `new_message_with_text( )`) |
| `%fail` | Failure info in `failed` rows, notably `%fail-cause` (`if_abap_behv=>cause-*`) |
| `%op` | Which operation a `failed` row belongs to (`%op-%create`, `%op-%action-...`) |
| `%param` | Action/function/event parameter data; action result rows = keys + `%param` (there is no `%result` component) |
| `%target` | Child rows of a create-by-association request (each with its own `%cid`) |

## Consumer vs behavior pool

External consumers (classes, tests, batch jobs) use plain EML. Inside the behavior pool, add `IN LOCAL MODE` for the BO's own reads/writes — it suppresses feature control, authorization checks, and prechecks. Other behavior-pool-only additions (`MODIFY AUGMENTING`, ABP-only derived types, `READ ... WITH CHANGES`) are covered in [rap-eml](../../rap-eml/SKILL.md).

## Deep dives

- Every statement with all forms (short/long/dynamic) and the per-phase rules: [rap-eml/references/eml-statement-catalog.md](../../rap-eml/references/eml-statement-catalog.md)
- Full derived-type + `%` component + `if_abap_behv` constants catalog: [rap-eml/references/derived-types.md](../../rap-eml/references/derived-types.md)
- Workflow, common mistakes, worked examples: [rap-eml](../../rap-eml/SKILL.md)
- Late numbering, `CONVERT KEY`, save sequence: [rap-saves-and-numbering](../../rap-saves-and-numbering/SKILL.md)
- Testing BOs with EML (`cl_botd_txbufdbl_bo_test_env`, mock EML API): [abap-unit-tdd](../../abap-unit-tdd/SKILL.md)
