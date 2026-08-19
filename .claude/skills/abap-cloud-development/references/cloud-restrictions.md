# ABAP Cloud Restrictions — Forbidden vs. Allowed

The definitive forbidden-construct → cloud-released-alternative reference. **Other ABAP skills cite this file** for "what's allowed in ABAP Cloud." Facts are taken from [cheat sheet 19 — ABAP for Cloud Development](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/19_ABAP_for_Cloud_Development.md) and the ABAP Keyword Documentation topics *Rules for ABAP Cloud* and *Language Elements in ABAP Versions*.

Restrictions apply to the **ABAP for Cloud Development** language version (ABAP Cloud / Steampunk / S/4HANA Cloud / developer extensibility). They do **not** apply to Standard ABAP, except when you opt a Standard-ABAP object into the cloud language version or run the `ABAP_CLOUD_READINESS` ATC variant.

## Authoritative check

- **ATC variant `ABAP_CLOUD_READINESS`** — run on Standard-ABAP code to flag everything below before a cloud move. (ADT: right-click → *Run As → ABAP Test Cockpit With…* → enter the variant.)
- **Language Elements in ABAP Versions** doc table — which keyword/addition is allowed in which version.
- **API State** (ADT Properties) — whether the *object* you reference is released.

## Data Dictionary & data sources

| Forbidden in ABAP Cloud | Allowed alternative |
|---|---|
| Typing/`SELECT` against non-released SAP DB tables (`scarr`, `spfli`, `TADIR`, …) | Released CDS entities (e.g. `I_Timezone`); find successors via `I_APIsWithCloudDevSuccessor`. Released DDIC data elements (`timestampl`, `land1`), table types (`string_table`, `xstring_table`, `string_hashed_table`), type pool `ABAP` (`abap_true`/`abap_boolean`). |
| Your own *non-cloud-released* custom DDIC | Cloud-released custom DDIC. See [abap-dictionary-ddic](../../abap-dictionary-ddic/SKILL.md). |

## Database access / SQL

| Forbidden | Allowed alternative |
|---|---|
| Native SQL / `EXEC SQL … ENDEXEC` | ABAP SQL on released CDS / your own DDIC; AMDP only where released. [abap-sql-performance](../../abap-sql-performance/SKILL.md) |
| `SELECT … USING CLIENT` / `CLIENT SPECIFIED` | Implicit client handling (omit it). |
| `MODIFY`/`UPDATE`/`DELETE`/`INSERT` directly on SAP-owned tables | Released APIs / RAP behavior (EML). |
| Dynamic SQL against non-released sources | Allowed *syntactically* but fails at runtime; validate tokens with `CL_ABAP_DYN_PRG`. |

## UI & program types

| Forbidden | Allowed alternative |
|---|---|
| Classic dynpro / screens / `DIALOG` / `CALL SCREEN` | Fiori UI via RAP + OData. [rap-bo-modeling](../../rap-bo-modeling/SKILL.md) |
| Classic lists — `WRITE`, `WRITE TO`, list events | `out->write( )` via `IF_OO_ADT_CLASSRUN` for diagnostics; Fiori for real UI. |
| Classic ALV (`CL_SALV_TABLE`, `CX_SALV_MSG` — not released) | RAP-based Fiori list report / analytical. |
| Executable programs (reports, `REPORT`/`SELECTION-SCREEN`) | Global class with `IF_OO_ADT_CLASSRUN` (F9), or RAP. |
| SmartForms / classic SAPscript / classic print | Forms Service for Adobe / output management (PDF rendering classes). |

## Tools

| Forbidden | Allowed alternative |
|---|---|
| SAP GUI transactions (`SE80`, `SE24`, `SE38`, `SE11`, …) | ADT (Eclipse) only. |
| `BREAK-POINT` statement | Set breakpoints in ADT (double-click left of the line number). |

## System fields (`sy`)

| Forbidden `sy` field | Allowed alternative |
|---|---|
| `sy-datum`, `sy-uzeit`, `sy-timlo`, `sy-zonlo`, `sy-datlo`, … | `CL_ABAP_CONTEXT_INFO` (system/user date & time), `xco_cp=>sy->date/time( … )`. |
| (allowed, still usable) | `sy-index`, `sy-tabix`, `sy-dbcnt`, `sy-fdpos`, `sy-subrc`, `sy-langu`, `sy-batch`, `sy-mandt`, `sy-sysid`, `sy-uname`, `sy-msgid`, `sy-msgty`, `sy-msgno`, `sy-msgv1..4`. |

## Deprecated / invalid statements

| Forbidden | Allowed alternative |
|---|---|
| `MOVE src TO dst` | `dst = src.` |
| `DESCRIBE TABLE itab LINES n` | `n = lines( itab ).` |
| `GET REFERENCE OF dobj INTO ref` | `ref = REF #( dobj ).` |
| `READ REPORT … INTO …` | Repository APIs (`XCO_CP_ABAP_REPOSITORY` etc.). |
| Various legacy keyword forms | Modern equivalents — see *Language Elements in ABAP Versions*. |

## Classes / libraries

| Forbidden (not released) | Allowed alternative (released) |
|---|---|
| `CL_IXML` (classic iXML) | `CL_IXML_CORE` |
| `CL_SALV_TABLE`, `CX_SALV_MSG` | RAP + Fiori |
| `CL_ABAP_DBFEATURES` (not released) | — (no cloud equivalent; redesign) |
| Any class without a release contract / not in *Released Objects* | The released counterpart; check API State. See [released-apis.md](released-apis.md). |

## Function modules

Most classic FMs are not released. Replace with:
- **Released classes / XCO** for utility logic (date, string, UUID, conversion, …).
- **RAP behavior** for transactional logic.
- **Released CDS** for read access.

Check each FM's API state; only released FMs may be called in ABAP Cloud.

## Typing stability caveat (C1)

Even released (C1) objects may be **extended**, not frozen. If you hand-type a parameter instead of using the API's own released type, you can get a stability syntax warning and a future break. **Always use the API's released type** (e.g. `if_abap_prob_types=>int_range`, not `TYPE RANGE OF i`).

---

**Sources:** `19_ABAP_for_Cloud_Development.md`; *Rules for ABAP Cloud* (`abenabap_strict_rules.htm`); *Language Elements in ABAP Versions* (`abenrestricted_abap_elements.htm`); *Contract Rules for ABAP Released APIs* (`abenrestricted_apis.htm`). See the parent [SKILL.md](../SKILL.md) for the released-API concept and discovery.
