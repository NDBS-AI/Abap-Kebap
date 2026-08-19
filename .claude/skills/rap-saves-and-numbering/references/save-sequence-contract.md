# The RAP Save Sequence Contract

Deep dive for [SKILL.md](../SKILL.md). Everything here is grounded in the SAP ABAP cheat sheets
(`08_EML_ABAP_for_RAP.md` — saver class, data consistency, and additional/unmanaged save sections)
and the RAP development guide on help.sap.com.

## Trigger and ownership

- The save sequence starts when `COMMIT ENTITIES` executes. In natively supported scenarios
  (SAP Fiori app via OData) the RAP runtime engine issues `COMMIT ENTITIES` implicitly — your
  handlers never see it.
- RAP transactions are integrated with the SAP LUW. The **RAP BO contract** is the rule set
  the runtime enforces so the LUW completes in one database transaction.
- The saver class inherits from `CL_ABAP_BEHAVIOR_SAVER`, is implicitly `ABSTRACT` and `FINAL`,
  and lives in the CCIMP include (*Local Types* tab) of the behavior pool. Only the RAP runtime
  engine instantiates and calls it.
- Saver methods do **not** receive RAP BO instance data as importing parameters (exception:
  `save_modified`'s `create` / `update` / `delete` tables). Instance data must be taken from
  the transactional buffer — or handed over from the interaction phase via a class attribute
  on the global behavior pool class (the RAP610 `CLASS-DATA ... TYPE RESPONSE FOR MAPPED ...`
  pattern).

## Method order and per-method contract

### Early save phase (repeatable — failures are legal)

| Order | Method | Contract |
|---|---|---|
| 1 | `finalize` | Final calculations and data changes involving **all** RAP BOs in the current transaction. Managed BOs: determinations declared `on save` execute when this method is reached. The buffer is still open — EML modifications of your own BO are possible here. |
| 2 | `check_before_save` | Consistency checks on the transactional buffer. Managed BOs: validations declared `on save` execute here. This is the **last legal point to fail**: fill `failed` / `reported` to veto the save. |
| — | `cleanup_finalize` | Called only when at least one previous saver method failed. Roll back the changes `finalize` made. Afterwards the late save phase is rejected and the transaction returns to the interaction phase. |

Outcome of an early-phase failure: after `COMMIT ENTITIES`, `sy-subrc = 4`. The consumer can
correct data in the interaction phase and commit again.

### Late save phase (point of no return)

Once the early phase completes consistently, the late phase begins. There is no way back to the
interaction phase: either the transaction ends with a successful commit, or changes are rolled
back and a runtime error occurs.

| Order | Method | Contract |
|---|---|---|
| 3 | `adjust_numbers` | Late numbering only. Map all preliminary identifiers (`%pre` = `%pid` + `%tmp`) to final keys in the `mapped` response parameter. No RAP BO consumer interaction is possible any more — which is exactly why late numbering is internal by definition. See [numbering-matrix.md](numbering-matrix.md). |
| 4 | `save` | Fully unmanaged BOs: persist the transactional buffer with ABAP SQL / the legacy save API. On success, the framework triggers the final database commit — an implicit `COMMIT WORK`. |
| 4 | `save_modified` | Managed BOs `with additional save` (side work; framework persists) or `with unmanaged save` (your code persists). Parameters: `create` / `update` typed `REQUEST FOR CHANGE`, `delete` typed `REQUEST FOR DELETE` — deep structures of instance tables. Default payload: key values plus changed fields; `with full data` delivers complete instances. `RAISE ENTITY EVENT` is recommended precisely in `save` / `save_modified`. |
| 5 | `cleanup` | Clear the transactional buffer after a successful save; completes the save sequence. Also invoked by `ROLLBACK ENTITIES`. Mandatory to redefine when the BDEF save option carries `and cleanup`. |

## COMMIT ENTITIES vs COMMIT WORK, ROLLBACK ENTITIES

- `COMMIT ENTITIES` implicitly triggers `COMMIT WORK`.
- Plain `COMMIT WORK` in a RAP context *also* triggers the save sequence — but on any save-sequence
  error it produces a runtime error, whereas `COMMIT ENTITIES` can return to the interaction phase.
- Only `COMMIT ENTITIES` offers the RAP additions: `RESPONSE OF` (retrieve `failed` / `reported`),
  key conversion in late-numbering scenarios, and simulation mode. Short, long, and dynamic forms exist.
- `COMMIT ENTITIES` enforces a local update (`COMMIT WORK`), falling back to a synchronous update
  (`COMMIT WORK AND WAIT`) if the local update fails — never an asynchronous update.
- `ROLLBACK ENTITIES` rolls back the whole RAP transaction (buffer cleared via `cleanup`) and
  implicitly triggers `ROLLBACK WORK`; in RAP the two are interchangeable.

## Allowed / forbidden operations per phase

From the cheat sheet's "Ensuring Data Consistency in a RAP Transaction" excursion. With strict
mode in the BDEF, violations surface as runtime errors or static check findings. Most rows refer
to the unrestricted ABAP language scope.

| Operation / statement | Interaction | Early save | Late save | Notes |
|---|---|---|---|---|
| DB commits via **secondary** connection | yes | yes | yes | For infrastructure data outside the main transaction: application logs, traces, number ranges |
| DB commits via **standard** connection | yes | yes | no | E.g. triggered by external service calls or `WAIT` |
| sRFC (`CALL FUNCTION ... DESTINATION`), aRFC (`... STARTING NEW TASK`) | yes | yes | no | For parallelization; the application must guarantee consistency itself |
| **Database modifications** | no | no | yes | Earlier phases hold potentially inconsistent data; writing would split the LUW into multiple DB transactions |
| Update function module (`CALL FUNCTION ... IN UPDATE TASK`) | no | no | yes | Registration in earlier phases interferes with draft scenarios; FMs cannot be unregistered |
| bgRFC (`CALL FUNCTION ... IN BACKGROUND UNIT`) | no | no | yes | |
| tRFC / qRFC (`... IN BACKGROUND TASK`) | no | no | no | Obsolete technologies |
| `PERFORM ON COMMIT` / `ON ROLLBACK` | (possible) | (possible) | yes | Reserve for late save; its use signals improper RAP integration — prefer EML or commit-free procedure calls |
| `COMMIT WORK` / `ROLLBACK WORK` | no* | no* | no* | *Allowed only for the transaction owner under the controlled SAP LUW (`CL_ABAP_TX`). Where RAP owns the transaction — handlers, savers, local event consumption, bgPF, classified APIs — commits/rollbacks are forbidden |
| Dynpro processing (`CALL SCREEN`, `MESSAGE` w/o `INTO`, `WRITE`, ...) | no | no | no | Runtime error |
| `CALL TRANSACTION`, `LEAVE TRANSACTION` | no | no | no | Would drag foreign LUWs into the transaction |
| `RAISE EXCEPTION` | no | no | no | Not a legal way to leave a RAP transaction |
| `RAISE ENTITY EVENT` | no | no | yes | Recommended in `save` / `save_modified` |
| `SUBMIT` | no | no | no | Syntax/runtime error; `SUBMIT ... AND RETURN` currently passes but has no return channel and risks screen processing |

## Failures in the late save phase

The basic rule: failures must be detected in the **early** save phase. Exceptionally — e.g. when
BAPIs are called to save RAP BO instances in the late phase — that rule cannot be honored:

- Base the saver class on **`CL_ABAP_BEHAVIOR_SAVER_FAILED`** instead of `CL_ABAP_BEHAVIOR_SAVER`.
  It exposes RAP response parameters that the standard base class does not, so consumers can be
  informed about what failed.
- After `COMMIT ENTITIES` with a late-save failure, `sy-subrc = 8`.
- A subsequent RAP operation may dump. If the consumer wants to continue after a late-phase error,
  an explicit `ROLLBACK ENTITIES` is required first.

## Save options in the BDEF (managed BOs)

```abap
managed with additional save implementation in class zbp_... unique;              " enhance
managed with additional save with full data implementation in class ... unique;  " + full instances
managed with unmanaged save implementation in class ... unique;                   " replace
```

- Both options can also be declared **per entity**: `define behavior for SomeEntity with unmanaged save ...`.
- `with unmanaged save` forbids the `persistent table` clause for the affected entity.
- `and cleanup ...` (combinable with `with full data`) requires redefining `cleanup`.
- Regardless of variant, the implementation goes into `save_modified` of the local saver class.
- Additional save use cases named by SAP: change documents, application log, raising business
  events. Unmanaged save use cases: custom persistence logic, writing back keys retrieved via
  `CONVERT KEY` from a late-numbering API (RAP610: writing into your *own* persistence from the
  save sequence **requires** unmanaged save, since the framework must not also write the row).

## Consumer-visible outcomes summary

| Scenario | `sy-subrc` after `COMMIT ENTITIES` | State |
|---|---|---|
| Success | 0 | Committed; buffer cleared via `cleanup` |
| Early save failure | 4 | Back in interaction phase; fix and retry |
| Late save failure (`CL_ABAP_BEHAVIOR_SAVER_FAILED`) | 8 | Explicit `ROLLBACK ENTITIES` required before continuing |
