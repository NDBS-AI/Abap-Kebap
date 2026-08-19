# Released APIs — Curated Catalog

**This is a curated pointer, not a complete list.** ABAP for Cloud Development exposes hundreds of released classes; the authoritative full catalog is at **api.sap.com** (SAP Business Accelerator Hub) and in the *Released Objects* view in ADT. The full cheat-sheet enumeration (cheat sheet 22, ~10k lines of snippets) is the deep dive. This file lists the **most-used** released classes/interfaces grouped by purpose so you can pick the right one fast, plus how to discover the rest.

> XCO note: in ABAP for Cloud Development the released XCO classes carry `CP` in the name (`XCO_CP*`). In Standard ABAP, non-`CP` XCO classes also exist; those are not cloud-released. Often several classes (especially XCO vs `CL_ABAP_*`) achieve the same result — pick what fits.

## How to find released APIs

1. **ADT → Project Explorer → Released Objects** — browse all released objects; classes under *Source Code Library*.
2. **ADT → open object → Properties → API State** — shows the release contract (e.g. C1).
3. **api.sap.com** — searchable released-API catalog.
4. **Programmatically** via released CDS views:

```abap
" List released classes
SELECT ReleasedObjectType, ReleasedObjectName, ReleaseState
  FROM i_apisforclouddevelopment
  WHERE releasestate = 'RELEASED' AND ReleasedObjectType = 'CLAS'
  ORDER BY ReleasedObjectName
  INTO TABLE @DATA(released_classes).

" Objects that should no longer be used + their cloud successors
SELECT PredecessorObjectType, PredecessorObjectName, SuccessorObjectType, SuccessorObjectName FROM I_APIsWithCloudDevSuccessor
  WHERE PredecessorObjectType = 'TABL'
  INTO TABLE @DATA(successors_tables).
```

## Running a class & console output

| Class / Interface | Use |
|---|---|
| `IF_OO_ADT_CLASSRUN` | Implement in a global class to make it executable (F9 in ADT). Output via `out->write( data = … name = '…' )` in `if_oo_adt_classrun~main`. |
| `CL_DEMO_CLASSRUN` | Alternative base class with more methods (e.g. `write_xml`). |

## UUIDs

| Class | Use |
|---|---|
| `XCO_CP`, `XCO_CP_UUID` | Create and transform UUIDs. |

## XCO representations of SY components

| Class | Use |
|---|---|
| `XCO_CP` | `xco_cp=>sy->user( )->name`, `xco_cp=>sy->date( … )`, `xco_cp=>sy->time( … )` etc. — cloud-safe replacements for forbidden `sy` fields. Usable `sy` fields remain: `sy-index/tabix/dbcnt/fdpos/subrc/langu/batch/mandt/sysid/uname/msgid/msgty/msgno/msgv1..4`. |

## Date, time, timestamp, calendar

| Class | Use |
|---|---|
| `CL_ABAP_CONTEXT_INFO` | Current user/system date & time, system context (cloud-safe replacement for `sy-datum`/`sy-uzeit`). |
| `CL_ABAP_UTCLONG` | Handling `utclong` timestamps. |
| `CL_ABAP_TSTMP` | Timestamp (`timestamp`/`timestampl`) arithmetic & conversion. |
| `CL_ABAP_DATFM`, `CL_ABAP_TIMEFM` | Date / time formatting. |
| `XCO_CP_TIME`, `XCO_CP` | Date/time creation, time zones, ISO 8601 formatting, calculations. |

## Numbers & calculations

| Class | Use |
|---|---|
| `CL_ABAP_MATH` | Math constants & helpers (min/max values etc.). |
| `CL_ABAP_DECFLOAT` | Decimal floating-point helpers. |
| `CL_ABAP_BIGINT` | Arbitrary-precision integers. |
| `CL_ABAP_RATIONAL` | Rational numbers. |
| `CL_ABAP_RANDOM_*` | Random numbers by type: `_INT` (`i`), `_INT8` (`int8`), `_FLOAT` (`f`), `_PACKED`/`_PACKED_DEC1..14` (`p`), `_DECFLOAT16`, `_DECFLOAT34`. Seed via `CL_ABAP_RANDOM=>seed( )`. |
| `CL_ABAP_PROB_DISTRIBUTION`, `CL_ABAP_PROB_DISTRIBUTION_DF34` | Probability distributions / probability calculations. (Type its ranges with `if_abap_prob_types=>int_range`, not `RANGE OF i`.) |

## String processing

| Class | Use |
|---|---|
| `CL_ABAP_STRING_UTILITIES` | String helpers (e.g. trailing-blank handling, `c`/`string` conversions). |
| `CL_ABAP_CHAR_UTILITIES` | Special characters (CR/LF, horizontal tab, etc.) as constants. |
| `XCO_CP` | XCO string builder / manipulation. |
| See also [abap-strings-regex](../../abap-strings-regex/SKILL.md). |

## Regular expressions

| Class | Use |
|---|---|
| `CL_ABAP_REGEX` | Compile a regular expression (PCRE). |
| `CL_ABAP_MATCHER` | Apply a compiled regex (match/find/replace). |

## Codepages & binary data

| Class | Use |
|---|---|
| `CL_ABAP_CONV_CODEPAGE` | Convert between `string`/`xstring` with explicit codepages. |
| `CL_ABAP_GZIP`, `…_GZIP_BINARY_STREAM`, `…_GZIP_TEXT_STREAM`, `CL_ABAP_UNGZIP_BINARY_STREAM`, `…_TEXT_STREAM` | GZIP compress/decompress. |
| `CL_ABAP_ZIP` | Read/write ZIP archives. |

## Runtime Type Services (RTTS)

| Class | Use |
|---|---|
| `CL_ABAP_TYPEDESCR` | Root of the type-description hierarchy (RTTI). Subclasses include `CL_ABAP_DATADESCR`, `CL_ABAP_ELEMDESCR`, `CL_ABAP_STRUCTDESCR`, `CL_ABAP_TABLEDESCR`, `CL_ABAP_REFDESCR`, etc. Use `describe_by_data( )`, `describe_by_name( )`. RTTC counterparts create types dynamically. |
| See also [abap-dynamic-programming](../../abap-dynamic-programming/SKILL.md). |

## Assignments / structures / comparisons

| Class | Use |
|---|---|
| `CL_ABAP_CORRESPONDING` | Dynamic MOVE-CORRESPONDING with mapping tables. |
| `CL_ABAP_STRUCT_UTILITIES` | Information about non-initial structure components. |
| `CL_ABAP_DIFF` | Compare content of compatible internal tables (diff). |

## Dynamic programming

| Class | Use |
|---|---|
| `CL_ABAP_DYN_PRG` | Validate dynamic tokens (table/field names, WHERE fragments) to guard dynamic ABAP SQL against injection. Essential since native SQL is forbidden but dynamic ABAP SQL is allowed. |

## XML / JSON

| Class | Use |
|---|---|
| `CL_IXML_CORE` | iXML (released variant; classic `CL_IXML` is NOT released). |
| `XCO_CP_JSON` | JSON ↔ ABAP: `xco_cp_json=>data->from_abap( … )->to_string( )` and back. |
| XCO XML modules | Read/build XML. |
| See also [abap-xml-json](../../abap-xml-json/SKILL.md). |

## Repository object information & generation

| Class | Use |
|---|---|
| `XCO_CP_ABAP`, `XCO_CP_ABAP_REPOSITORY`, `XCO_CP_ABAP_DICTIONARY`, `XCO_CP_ABAP_SQL`, `XCO_CP_CDS` | Introspect repository / DDIC / CDS objects. |
| `XCO_CP_GENERATION` | Generate ABAP repository objects programmatically. |
| `CL_ABAP_API_STATE` | Query the API/release state of objects programmatically. |

## RAP (behavior pool base classes & helpers)

| Class | Use |
|---|---|
| `CL_ABAP_BEHAVIOR_HANDLER` | Base class for RAP handler classes. |
| `CL_ABAP_BEHAVIOR_SAVER` | Base class for RAP saver classes. |
| `CL_ABAP_BEHAVIOR_SAVER_FAILED` | Saver base allowing failures in the late save phase (exceptional cases). |
| `CL_ABAP_BEHAVIOR_EVENT_HANDLER` | Base class for RAP event handlers. |
| `CL_ABAP_BEHV_AUX` | RAP auxiliary helpers. |
| `CL_ABAP_TX` | Transactional control (transactional consistency). |
| See [rap-bo-modeling](../../rap-bo-modeling/SKILL.md). |

## Concurrency, locking, jobs, logging

| Class | Use |
|---|---|
| `CL_ABAP_PARALLEL` | Parallel processing. |
| `CL_ABAP_LOCK_OBJECT_FACTORY` | Enqueue/dequeue via lock objects. |
| `XCO_CP_BAL` | Business Application Log. |
| Application Jobs / background-run classes | Schedule and run code in the background. |

## Communication & files

| Class | Use |
|---|---|
| Service-call classes | Call HTTP / OData services. |
| `XCO_CP_XLSX` | Read/write XLSX content. |
| `CL_CSV_FACTORY` / `IF_CSV_WRITER` | Write internal table content to CSV (released 917/2511+). |
| Email-sending classes | Send emails. |

## ABAP Unit / testing

| Class | Use |
|---|---|
| `CL_ABAP_UNIT_ASSERT` | Assertions. |
| `CL_ABAP_TESTDOUBLE` | Test doubles (mocking). |
| `CL_OSQL_TEST_ENVIRONMENT` | Mock ABAP SQL data sources. |
| `CL_CDS_TEST_ENVIRONMENT` | Mock CDS entities. |
| `CL_BOTD_TXBUFDBL_BO_TEST_ENV`, `CL_BOTD_MOCKEMLAPI_BO_TEST_ENV` | RAP BO test doubles. |
| See [abap-unit-tdd](../../abap-unit-tdd/SKILL.md). |

## Misc utilities (also released)

Units of measurement; tenant info (`XCO_CP_TENANT`); call stack (`XCO_CP_CALL_STACK`); number ranges; programmatic ATC checks; releasing APIs; transport request creation (`XCO_CP_CTS`); HTML/XML repair & cleanup; IDE actions; PDF rendering / output management; garbage collection (`CL_ABAP_GARBAGE_COLLECTOR`, 917/2511+); message utility; SAP codes conversion; generative AI (`CL_AIC_ISLM_COMPL_API_FACTORY` & co — see SKILL.md).

---

**Authoritative sources:** api.sap.com · ADT *Released Objects* view · [cheat sheet 22 — Released ABAP Classes](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/22_Released_ABAP_Classes.md) · [XCO Library docs](https://help.sap.com/docs/btp/sap-business-technology-platform/xco-library?version=Cloud). When in doubt about whether a specific class is released and under which contract, check the **API State** in ADT — that is ground truth for your system's release.
