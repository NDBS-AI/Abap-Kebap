---
name: abap-cloud-development
description: Use when working in ABAP Cloud / Steampunk (SAP BTP ABAP environment, S/4HANA Cloud, embedded Steampunk), choosing the ABAP language version (Standard ABAP / ABAP for Key Users / ABAP for Cloud Development), figuring out what is allowed or forbidden in ABAP Cloud and S/4HANA Cloud, finding the released API for a classic construct, checking whether an object is released (release contract C0/C1), navigating ABAP release news version-by-version, picking the right released class (XCO, cl_abap_context_info, cl_abap_*_utilities), or using generative AI in ABAP (ABAP AI SDK / Intelligent Scenario Lifecycle Management). This is the single source of truth other ABAP skills cite for cloud restrictions and released objects.
---

# ABAP Cloud / Steampunk Development

## Overview

**ABAP Cloud** is SAP's programming paradigm for "state-of-the-art, cloud-ready and upgrade-stable solutions." It is the *same* ABAP technology you already know, used under three hard restrictions:

1. **A restricted ABAP language version** — *ABAP for Cloud Development*. Not every keyword/addition is available.
2. **Released APIs only** — you may only access SAP-delivered repository objects that have been *released* for ABAP for Cloud Development. Most SAP database tables cannot be read directly; you use the released CDS entities / abstractions instead.
3. **ADT only** — ABAP Development Tools for Eclipse are the only supported tools. There is no SAP GUI, no `SE80`/`SE24`/`SE38`. **RAP** (the ABAP RESTful Application Programming Model) is the transactional programming model; the frontend is Fiori via OData.

ABAP Cloud is supported in all SAP products built on ABAP technology (SAP BTP ABAP environment "Steampunk", S/4HANA Cloud Public Edition, S/4HANA Cloud Private Edition / on-premise via "embedded Steampunk"). In a given product it can be fully or partly mandatory.

**Classic ABAP** is the paradigm for legacy solutions: ABAP technology *without* restrictions — you may use both Standard ABAP and ABAP for Cloud Development, ADT and/or SAP GUI, and access any repository object (beyond released APIs). Supported in SAP S/4HANA.

**This skill is the single source of truth** that other ABAP skills point to for cloud restrictions and released objects. The definitive forbidden→allowed table lives in [references/cloud-restrictions.md](references/cloud-restrictions.md); the curated released-API catalog in [references/released-apis.md](references/released-apis.md).

## When to Use

- You are developing in a BTP ABAP environment / S/4HANA Cloud and hit a syntax error or restriction.
- You need the released alternative for a classic construct (native SQL, classic ALV, a classic FM…).
- You must decide which ABAP language version a repository object should use.
- You want to check whether an object is released, and under which contract.
- You are reviewing whether code is "cloud-ready" before an S/4HANA Cloud move.
- You need to navigate ABAP release news to find when a feature became available.
- You are wiring generative AI into ABAP via the ABAP AI SDK.

**When NOT to use:**
- For the *migration decision* (should I move this classic code to cloud at all, in what order) — that is [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md).
- For pure CDS authoring or RAP modeling mechanics — see [cds-views-authoring](../cds-views-authoring/SKILL.md), [rap-bo-modeling](../rap-bo-modeling/SKILL.md).

## ABAP Language Versions

Every ABAP repository object has an **ABAP language version** (visible in ADT *Properties → General*). There are three:

| Language version | What it is | Where used |
|---|---|---|
| **Standard ABAP** | The unrestricted version. Full keyword set, native SQL, all objects. | Classic ABAP, S/4HANA on-premise |
| **ABAP for Key Users** | A heavily restricted version for key-user (low-code) in-app extensibility. | Restricted on-stack/in-app extensibility scenarios |
| **ABAP for Cloud Development** | The restricted version that *is* ABAP Cloud. | BTP ABAP environment, S/4HANA Cloud, developer extensibility |

The ABAP Keyword Documentation topic *Language Elements in ABAP Versions* gives a table showing which language element is allowed in which version. You can switch a classic-ABAP object to *ABAP for Cloud Development* via ADT *Properties → General → ABAP Language Version → Edit…* to make it cloud-restricted in a Standard ABAP system.

## What ABAP Cloud Forbids (and What to Use Instead)

This is the short list; the full table is in [references/cloud-restrictions.md](references/cloud-restrictions.md). In ABAP for Cloud Development you **cannot**:

- **Access non-released SAP DDIC** — e.g. `DATA carrier TYPE scarr` or `SELECT … FROM spfli` is invalid. Released DDIC (data elements like `timestampl`, `land1`; table types like `string_table`, `xstring_table`; type pool `ABAP` with `abap_true`) and released CDS entities (e.g. `I_Timezone`) are fine. See [abap-dictionary-ddic](../abap-dictionary-ddic/SKILL.md).
- **Use Native SQL / `EXEC SQL`** — no direct database access. Use ABAP SQL on released CDS entities / your own DDIC, or AMDP only where released. See [abap-sql-performance](../abap-sql-performance/SKILL.md).
- **Use `CLIENT SPECIFIED` / `USING CLIENT`** — explicit client handling is outside the restricted scope. Client handling is implicit.
- **`MODIFY`/`UPDATE`/`DELETE` on SAP-owned tables** — write through released APIs / RAP behavior, never directly.
- **Classic dynpro & lists** — no screens, `DIALOG`, `WRITE`, classic ALV (`CL_SALV_TABLE` is not released, `CX_SALV_MSG` not released). The UI is Fiori via RAP/OData.
- **Executable programs (reports)** — not allowed. Run code via a class implementing `IF_OO_ADT_CLASSRUN` (F9 in ADT, output with `out->write( … )`).
- **Many classic system fields** — `sy-datum`, `sy-uzeit`, `sy-timlo` etc. must not be used. Use `cl_abap_context_info` or `xco_cp=>sy`. A small set (`sy-index`, `sy-tabix`, `sy-subrc`, `sy-dbcnt`, `sy-langu`, `sy-uname`, `sy-mandt`, `sy-msgid`/`sy-msgty`/`sy-msgno`/`sy-msgv1..4`, `sy-batch`, `sy-sysid`, `sy-fdpos`) remains usable.
- **Deprecated/invalid statements** — `MOVE … TO` (use `=`), `DESCRIBE TABLE … LINES` (use `lines( )`), `GET REFERENCE OF` (use `REF #( )`), `READ REPORT`, `BREAK-POINT` (set breakpoints in ADT instead).
- **Non-released classes** — `cl_ixml` (classic) is forbidden; `cl_ixml_core` is released. Always check API state.

```abap
" Valid in ABAP for Cloud Development:
DATA dobj1     TYPE timestampl.            " released DDIC data element
DATA it1       TYPE string_table.          " released table type
DATA flag      TYPE abap_boolean.          " type pool ABAP
flag = abap_true.
DATA s1        TYPE i_timezone.            " released CDS entity
SELECT SINGLE TimeZoneID, TimeZoneName FROM i_timezone WHERE TimeZoneID = 'EST' INTO @DATA(tz).

" Released class, e.g. random integer:
DATA(num) = cl_abap_random_int=>create( seed = cl_abap_random=>seed( )
                                         min  = 1 max = 100 )->get_next( ).

" XCO: current user date in user time zone, ISO 8601:
DATA(today) = xco_cp=>sy->date( xco_cp_time=>time_zone->user
                       )->as( xco_cp_time=>format->iso_8601_extended )->value.
```

```abap
" INVALID in ABAP for Cloud Development:
DATA s2 TYPE scarr.                                  " non-released DB table
SELECT carrid FROM spfli INTO TABLE @DATA(flights).  " non-released table
DATA d = sy-datum.                                   " use cl_abap_context_info
MOVE a TO b.                                         " use b = a.
WRITE 'hi'.                                          " classic list — forbidden
DATA(ixml_instance) = cl_ixml=>create( ).             " classic, not released
```

## The Released-API Concept

Access to SAP-delivered objects is gated by a **release contract**. A *released API* is a repository object SAP has classified with a contract that guarantees a stability promise. Contracts are coded **C0, C1, …** — C1 is the common "use it in ABAP for Cloud Development" contract for APIs (see SAP Help for full contract rules). Released objects appear in the ADT *Project Explorer → Released Objects* node (classes under *Source Code Library*).

**How to check if an object is released:**
1. **ADT Properties tab** — open the object, *Properties → API State* shows the release contract (e.g. C1). Works in both cloud and classic systems.
2. **Released Objects view** in ADT Project Explorer — browse everything released.
3. **api.sap.com** — the SAP Business Accelerator Hub lists released APIs.
4. **Programmatically** — query the released-objects CDS views:

```abap
" All released classes:
SELECT ReleasedObjectType, ReleasedObjectName, ReleaseState
  FROM i_apisforclouddevelopment
  WHERE releasestate = 'RELEASED' AND ReleasedObjectType = 'CLAS'
  ORDER BY ReleasedObjectName
  INTO TABLE @DATA(released_classes).

" Find the cloud successor for an object you cannot use anymore:
SELECT SINGLE PredecessorObjectType, PredecessorObjectName, SuccessorObjectType, SuccessorObjectName FROM I_APIsWithCloudDevSuccessor
  WHERE PredecessorObjectName = 'TADIR' INTO @DATA(successor).
```

**Typing caution (C1 stability):** even a C1 class may be *extended* in future. If you type a variable manually instead of with the API's own released type, you may get a syntax warning. Example: `CL_ABAP_PROB_DISTRIBUTION` wants `if_abap_prob_types=>int_range`; typing your range table as `TYPE RANGE OF i` (which today happens to match) triggers a warning because the API type could change. **Use the API's released type, not a hand-rolled equivalent.**

### Most-used released classes (curated)

Full curated catalog grouped by purpose: [references/released-apis.md](references/released-apis.md). Top picks:

| Purpose | Released class / interface |
|---|---|
| Run a class / console output | `IF_OO_ADT_CLASSRUN` (also `CL_DEMO_CLASSRUN`) |
| Date / time / timestamp, current user | `CL_ABAP_CONTEXT_INFO`, `CL_ABAP_UTCLONG`, `CL_ABAP_TSTMP`, `XCO_CP_TIME` |
| General-purpose library (sy, date, UUID, repo, calls…) | `XCO_CP`, `XCO_CP_TIME`, `XCO_CP_UUID`, `XCO_CP_JSON`, `XCO_CP_ABAP*` |
| String utilities | `CL_ABAP_STRING_UTILITIES`, `CL_ABAP_CHAR_UTILITIES`, `XCO_CP` |
| Regex | `CL_ABAP_REGEX`, `CL_ABAP_MATCHER` |
| RTTS (type introspection) | `CL_ABAP_TYPEDESCR` (+ `…STRUCTDESCR`, `…TABLEDESCR`, `…DATADESCR`) |
| Dynamic-programming validation | `CL_ABAP_DYN_PRG` |
| Math / numbers / random | `CL_ABAP_MATH`, `CL_ABAP_DECFLOAT`, `CL_ABAP_BIGINT`, `CL_ABAP_RANDOM_*` |
| MOVE-CORRESPONDING / struct utils | `CL_ABAP_CORRESPONDING`, `CL_ABAP_STRUCT_UTILITIES` |
| Codepage / binary / zip | `CL_ABAP_CONV_CODEPAGE`, `CL_ABAP_GZIP*`, `CL_ABAP_ZIP` |
| RAP behavior pool base classes | `CL_ABAP_BEHAVIOR_HANDLER`, `CL_ABAP_BEHAVIOR_SAVER`, `CL_ABAP_BEHV_AUX`, `CL_ABAP_TX` |
| Locking | `CL_ABAP_LOCK_OBJECT_FACTORY` |
| Parallel processing | `CL_ABAP_PARALLEL` |
| ABAP Unit | `CL_ABAP_UNIT_ASSERT`, `CL_ABAP_TESTDOUBLE`, `CL_OSQL_TEST_ENVIRONMENT`, `CL_CDS_TEST_ENVIRONMENT` |
| XLSX | `XCO_CP_XLSX` |

## Navigating ABAP Release News

ABAP release news is the version-by-version log of new language features and changes — the way to answer "since which release can I use feature X?". Cheat sheet 33 organizes it by **release** and by **topic** (ABAP SQL, ABAP CDS, RAP BDL, EML, system classes, etc.). It is a *pointer*, not a spec.

**Key facts for navigating it:**
- Releases are numbered like **918 (2602), 917 (2511), 916 (2508)** — the bare number is the internal `SAP_BASIS`-style ABAP release, the number in brackets is the product/quarterly release (e.g. `2602` ≈ Feb 2026). ABAP is not released standalone; it ships inside products (BTP ABAP env, S/4HANA Cloud, S/4HANA), each with its own version that maps to an ABAP release.
- News exists separately for **ABAP for Cloud Development** and **Standard ABAP** — a feature can land in one before the other.
- Within a release, entries are tagged by topic (`ABAP_SQL`, `ABAP_CDS`, `CDS_BDL`, `EML`, `SYSTEM_CLASSES`, …) with a short title + details.

**Where to read it (canonical sources):**
- ABAP Keyword Documentation release news — [ABAP for Cloud Development](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abennews.htm) / [Standard ABAP (latest)](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abennews.htm)
- Feature tables: [ABAP CDS language elements](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/abencds_language_elements.html), [RAP BDL feature table](https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/ABENRAP_FEATURE_TABLE.html)
- Cheat sheet 33 (`33_ABAP_Release_News.md`) — a summarized, searchable mirror, including an HTML *ABAP Release News Viewer* for local filtering. Treat the official docs as authoritative; the cheat sheet may not reflect the latest releases.

## Generative AI in ABAP

ABAP Cloud ships released classes for working with LLMs: the **ABAP AI SDK, powered by Intelligent Scenario Lifecycle Management (ISLM)**. (Joule for Developers provides the assistant side; the SDK is the programmatic side for your own AI-enabled apps.)

**Prerequisites:** the SDK is integrated with ISLM. Admin setup must be done first; you must create *intelligent scenarios* (repository objects enabling, e.g., the completion API) and *intelligent scenario models* (defining which LLM is used), optionally with prompt templates.

**Minimal completion call** — create an instance of the ISLM completion API for a scenario, send a string prompt, read the answer:

```abap
TRY.
    FINAL(ai_api)     = cl_aic_islm_compl_api_factory=>get( )->create_instance( 'ZDEMO_ABAP_INT_SCEN' ).
    FINAL(result)     = ai_api->execute_for_string( `Tell me a joke.` ).
    FINAL(completion) = result->get_completion( ).
  CATCH cx_aic_api_factory cx_aic_completion_api INTO FINAL(error).
    FINAL(error_text) = error->get_text( ).
ENDTRY.
```

The SDK also supports:
- **Parameters** — `ai_api->get_parameter_setter( )` then `set_maximum_tokens( )`, `set_temperature( )` (0..1).
- **Result metadata** — on the result: `get_completion_token_count( )`, `get_prompt_token_count( )`, `get_total_token_count( )`, `get_runtime_ms( )`.
- **Message-list prompts** — `ai_api->create_message_container( )` then `set_system_role( )`, `add_user_message( )`, `add_assistant_message( )`, run with `execute_for_messages( )`.
- **Prompt templates** — `cl_aic_islm_prompt_tpl_factory=>get( )->create_instance( islm_scenario = … template_id = … )` then `get_prompt( )`.

Key types/exceptions: `IF_AIC_COMPLETION_API`, `IF_AIC_COMPLETION_API_RESULT`, `CL_AIC_ISLM_COMPL_API_FACTORY`, `CL_AIC_ISLM_PROMPT_TPL_FACTORY`, `CX_AIC_API_FACTORY`, `CX_AIC_COMPLETION_API`, `CX_AIC_PROMPT_TEMPLATE`.

## Common Mistakes

| Mistake | Cost | Fix |
|---|---|---|
| Reading an SAP table directly (`SELECT … FROM scarr`) | Syntax error / not cloud-ready | Find the released CDS entity (e.g. via `I_APIsWithCloudDevSuccessor`) |
| Using `cl_ixml` / `CL_SALV_TABLE` in cloud | Not released — error | `cl_ixml_core`; for UI use RAP+Fiori, not classic ALV |
| Hand-typing a range/parameter instead of the API's released type | C1 stability warning, future break | Use the API's own released type (`if_…=>…`) |
| Using `sy-datum`/`sy-uzeit` | Not allowed in cloud | `cl_abap_context_info`, `xco_cp=>sy->date/time` |
| Assuming "released" = "forever frozen" | Code breaks when API is extended | C1 promises compatibility, not immutability — read the contract |
| Writing a report/`WRITE` to test | Not allowed | Implement `IF_OO_ADT_CLASSRUN`, run with F9, `out->write( )` |
| Guessing whether something is released | Wasted refactor | Check ADT API State / Released Objects / api.sap.com |

## References

- [references/released-apis.md](references/released-apis.md) — curated released class/interface catalog grouped by purpose + how to find released APIs (pointer; full list at api.sap.com & [cheat sheet 22](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/22_Released_ABAP_Classes.md)).
- [references/cloud-restrictions.md](references/cloud-restrictions.md) — definitive forbidden→released-alternative table (canonical reference cited by other skills).
- **ABAP Cloud — Background & Overview:** https://help.sap.com/docs/abap-cloud/abap-cloud/why-abap-cloud
- **ABAP Language Versions, Release Contracts and Released APIs:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabap_versions_and_apis.htm
- **Rules for ABAP Cloud:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenabap_strict_rules.htm
- **Contract Rules for ABAP Released APIs:** https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenrestricted_apis.htm
- **XCO Library:** https://help.sap.com/docs/btp/sap-business-technology-platform/xco-library?version=Cloud
- **Generative AI in ABAP Cloud:** https://help.sap.com/docs/abap-ai/generative-ai-in-abap-cloud/generative-ai-in-abap-cloud
- **api.sap.com** (SAP Business Accelerator Hub) — released API catalog.
- Linked skills: [abap-modernization-playbook](../abap-modernization-playbook/SKILL.md), [abap-dictionary-ddic](../abap-dictionary-ddic/SKILL.md), [rap-bo-modeling](../rap-bo-modeling/SKILL.md), [cds-views-authoring](../cds-views-authoring/SKILL.md), [abap-sql-performance](../abap-sql-performance/SKILL.md)
