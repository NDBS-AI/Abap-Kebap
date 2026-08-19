# Extension Mechanism — Decision Tree

Use top to bottom; first "YES" wins. The tree intentionally biases toward weaker, upgrade-safer mechanisms.

## Phase 1 — Where am I?

| Question | Direction |
|---|---|
| Is this ABAP Cloud / Steampunk / S/4HANA Cloud? | Go to **Phase 2 — Cloud**. |
| Is this on-premise S/4HANA / ECC? | Go to **Phase 2 — Classic**. |

---

## Phase 2 — Cloud

| Question | If YES | If NO |
|---|---|---|
| Can the change be expressed as a custom field + simple rule? | **Key User Extensibility.** Done. | Continue |
| Is it a RAP BO whose SAP-provided projection lets you add a determination/validation/virtual element/association? | **RAP extension** (e.g. virtual element + ABAP class). | Continue |
| Can the logic be implemented in cloud ABAP using only released APIs? | **Classic Developer Extensibility** in a developer extensibility tenant. | Continue |
| Heavy logic, long-running, separate lifecycle, or non-ABAP language preferred? | **Side-by-side on BTP.** Build a microservice, integrate via OData/REST/events. | Escalate to architecture |

Cloud forbids: modifications, classical user-exits, classical customer-exits, implicit enhancements (except in narrowly released cases).

---

## Phase 2 — Classic (on-prem)

### Stage A — Documented SAP extension points

| Question | If YES | If NO |
|---|---|---|
| Does SAP provide a **new BAdI** for this extension point (search `SE18`)? | **Implement the new BAdI.** Done. | Continue |
| Does SAP provide a **classic BAdI** (`SE19` → classic)? | **Implement the classic BAdI.** Done. | Continue |
| Does SAP provide a **customer exit** (`CMOD` projects, function group `XOMS*`/`XFI*` etc.)? | **Implement the customer exit** via CMOD. | Continue |
| Does SAP provide a **user exit** (`USEREXIT_*` form in a special include)? | **Implement the user exit** by editing the SAP-delivered include in customer namespace. | Continue |
| Is there an **explicit enhancement point or section** at the right location? | **Implement an enhancement implementation.** | Continue |

If you hit "YES" anywhere in Stage A, stop. Don't reach for implicit enhancement or modification just because it feels easier.

### Stage B — When SAP didn't provide a point

| Question | If YES | If NO |
|---|---|---|
| Can you wedge an **implicit enhancement** at the begin or end of a SAP routine that runs at the right time? | **Implicit enhancement.** Document upgrade risk. | Continue |
| Is the extension business-critical and the absence of a hook prevents progress? | **Modification (object key).** Document. Plan upgrade-adjust effort. | Escalate |

### Stage C — Multiple implementations on the same hook

| Situation | Approach |
|---|---|
| Two teams need to add behavior on the same new BAdI, no conflicts | Two filtered BAdI implementations (filter by company code, customer, etc.) |
| Two teams need to add behavior on the same BAdI, but their logic conflicts | Refactor: one implementation orchestrates both; or split filter; or escalate |
| Multiple implicit enhancements on the same SAP method | Document order assumption; treat as fragile — re-test at every SP |
| User-exit needed by two teams | One include, two carefully isolated blocks; coordinate transports |

---

## Phase 3 — Sanity checks before implementing

Regardless of which mechanism you picked:

- [ ] Does the chosen point run at the right *time* (before/after the SAP commit, before/after validation, etc.)?
- [ ] Are the inputs available at this point (have the values been computed yet)?
- [ ] Will the SAP transaction commit my changes as part of its LUW, or do I need my own?
- [ ] Will my change run on background, dialog, RFC, and SOAP modes equally?
- [ ] Is the chosen point fired exactly once per business event, or multiple times?
- [ ] If multiple times: is my logic idempotent?
- [ ] Authority: am I running in the user's context, or a batch user?
- [ ] What if the SAP routine fails after my code runs — does my side effect persist incorrectly?
- [ ] Performance: am I adding a DB call to a high-frequency hook?

If any answer is "I don't know", investigate before coding.

---

## Phase 4 — Implementation hygiene

- One class per BAdI implementation (`ZCL_IM_<spot>_<purpose>`).
- One package per business unit / project; group enhancements with the surrounding custom code.
- Each enhancement carries an ABAP Doc comment with:
  - Which standard process it extends
  - Why
  - Owner / ticket
  - SAP release tested
- Implicit enhancements: also add a short comment in the *SAP* source listing the enhancement implementation name so future readers can find it.

---

## Quick-look matrix

| Mechanism | Upgrade safe | Cloud safe | Multiple impls | When to choose |
|---|:---:|:---:|:---:|---|
| Key user extensibility | ✓ | ✓ | per-tenant | Simple cloud customizations |
| RAP extension | ✓ | ✓ | per BO | RAP-based behavior extension |
| Side-by-side on BTP | ✓ | ✓ | independent | Heavy / decoupled |
| Classic developer extensibility | ✓ | ✓ | per package | Cloud code-based extension |
| New BAdI | ✓ | partial | yes (filter) | First choice classic |
| Classic BAdI | ✓ | no | yes | Older SAP modules |
| Customer exit | ✓ | no | one | Legacy modules with documented exits |
| User exit | ✓ | no | one | Old SD/MM/FI modules |
| Explicit enhancement point | ✓ | partial | yes | SAP marked safe extension |
| Implicit enhancement | ⚠️ | no | yes | When nothing else works |
| Modification (object key) | ✗ | no | one | Emergency only |
