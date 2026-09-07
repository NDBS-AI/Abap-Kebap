# Minimal Unmanaged RAP BO — Travel, Wrapping a Legacy API

The unmanaged counterpart to [../managed-bo/README.md](../managed-bo/README.md). Same consumer-facing contract, opposite ownership: the RAP framework provides **no persistence, no transactional buffer, no lock handling** — your code, and the legacy API it wraps, does all of it. Modeled on the openSAP RAP course week 4 scenario: a Travel entity wrapping the `/DMO/FLIGHT_TRAVEL_*` legacy function-module suite.

Choose this shape only when an existing API owns buffer *and* persistence and you cannot change that. For everything else start managed — see "Managed vs Unmanaged — pick once" in [../../SKILL.md](../../SKILL.md).

## Files

```
/dmo/travel (given)              Legacy DB table — owned by the legacy API, never written by RAP
/DMO/FLIGHT_TRAVEL_* (given)     Legacy function-module suite: own buffer + persistence
ZI_RAP_Travel_U.ddls             Interface CDS (root of the BO, selects from the legacy table)
zsrap_travel_x.tabl              Control structure (BAPI-style x-structure for the mapping)
ZI_RAP_Travel_U.bdef             Unmanaged behavior definition
zbp_i_rap_travel_u.clas          Behavior pool: handler (lhc_travel) + saver (lsc_zi_rap_travel_u)
```

No projection, service definition, or binding shown here — those layers are identical to the managed scaffold. Unmanaged changes nothing above the BDEF: the consumer cannot tell the difference.

## The given: a legacy API that owns buffer and persistence

The wrapped API is a classic function-module suite with its own internal buffer:

| Function module | Role in the RAP wrap |
|---|---|
| `/DMO/FLIGHT_TRAVEL_CREATE` | Writes a new travel into the API's buffer, **assigns the next TravelId**, returns it in `es_travel` |
| `/DMO/FLIGHT_TRAVEL_UPDATE` | Applies changed fields to the buffer — takes a BAPI-style x-structure to know *which* fields |
| `/DMO/FLIGHT_TRAVEL_DELETE` | Marks the instance deleted in the buffer |
| `/DMO/FLIGHT_TRAVEL_READ` | Reads **from the buffer** (`iv_include_buffer` defaults to `abap_true`), so unsaved changes are visible |
| `/DMO/FLIGHT_TRAVEL_SAVE` | Persists the buffer to `/dmo/travel` — and does **not** `COMMIT WORK` |
| `/DMO/FLIGHT_TRAVEL_INITIALIZE` | Resets the buffer |

**Iron rule:** the wrapped API must never `COMMIT WORK`. The RAP framework issues the one and only database commit after your saver's `save` returns. An API that commits on its own splits the SAP LUW and breaks the RAP transaction — see [abap-sap-luw](../../../abap-sap-luw/SKILL.md). If your API demands its own commit (`BAPI_TRANSACTION_COMMIT` style), do not wrap it unmanaged — decouple via bgPF instead ([rap-saves-and-numbering](../../../rap-saves-and-numbering/SKILL.md), "Wrapping legacy APIs").

## `ZI_RAP_Travel_U.ddls` — Interface CDS

```sql
@AccessControl.authorizationCheck:     #CHECK
@EndUserText.label:                    'Travel — unmanaged BO over legacy API'
@Metadata.ignorePropagatedAnnotations: true

define root view entity ZI_RAP_Travel_U
  as select from /dmo/travel
{
  key travel_id     as TravelId,
      agency_id     as AgencyId,
      customer_id   as CustomerId,
      begin_date    as BeginDate,
      end_date      as EndDate,
      description   as Description,
      @Semantics.user.createdBy: true
      createdby     as CreatedBy,
      @Semantics.systemDateTime.createdAt: true
      createdat     as CreatedAt,
      @Semantics.user.lastChangedBy: true
      lastchangedby as LastChangedBy,
      @Semantics.systemDateTime.lastChangedAt: true
      lastchangedat as LastChangedAt
}
```

The view selects from the *legacy* table: OData list queries are still pushed down through CDS to the database. Only transactional reads (before an update, etag comparison, EML `READ`) go through your `read` handler — which is why that handler must serve buffer state, not database state. (The week 4 original adds a Booking child via `composition [0..*]` plus `cba_`/`rba_` handlers; this scaffold stays single-entity.)

## `zsrap_travel_x` — control structure

```
@EndUserText.label : 'Control structure for Travel data'
@AbapCatalog.enhancementCategory : #NOT_EXTENSIBLE
define structure zsrap_travel_x {
  agency_id   : xsdboolean;
  customer_id : xsdboolean;
  begin_date  : xsdboolean;
  end_date    : xsdboolean;
  description : xsdboolean;
}
```

Same field names as the legacy table, every type `xsdboolean` — a classic BAPI x-structure. RAP's `%control` component plays the same role ("which fields did the consumer actually set"), but with CDS element names. The `mapping … control` block in the BDEF declares the translation once, so handlers can use `MAPPING FROM ENTITY USING CONTROL` instead of hand-copying flags.

## `ZI_RAP_Travel_U.bdef` — Unmanaged BDEF

```
unmanaged implementation in class zbp_i_rap_travel_u unique;
strict ( 2 );

define behavior for ZI_RAP_Travel_U alias Travel
lock master
authorization master ( global )
etag master LastChangedAt
{
  create;
  update;
  delete;

  field ( readonly )  TravelId, CreatedBy, CreatedAt, LastChangedBy, LastChangedAt;
  field ( mandatory ) AgencyId, CustomerId, BeginDate, EndDate;

  mapping for /dmo/travel control zsrap_travel_x
  {
    TravelId      = travel_id;
    AgencyId      = agency_id;
    CustomerId    = customer_id;
    BeginDate     = begin_date;
    EndDate       = end_date;
    Description   = description;
    CreatedBy     = createdby;
    CreatedAt     = createdat;
    LastChangedBy = lastchangedby;
    LastChangedAt = lastchangedat;
  }
}
```

What changed versus the managed BDEF — mostly things that are *gone*:

- **No `persistent table` clause.** It is a syntax error in an unmanaged BDEF: there is no table the framework may write.
- **No framework buffer.** `create; update; delete;` no longer buy you working operations — they now *oblige* you to implement a `FOR MODIFY` handler for each. Read and lock, free in managed BOs, become mandatory `FOR READ` / `FOR LOCK` handlers.
- **No numbering clause.** The legacy API assigns `TravelId` inside its create call — internal early numbering delegated to the API. `TravelId` is `readonly`; the create handler returns the assigned key through `mapped`.
- `lock master` and `etag master LastChangedAt` still *declare* pessimistic and optimistic concurrency — but enforcement is yours: the enqueue happens in your `lock` method, and the etag check only works if your `read` handler returns current buffer values (the legacy update FM maintains `lastchangedat`).
- `strict ( 2 )` demands an authorization concept, hence `authorization master ( global )` plus a (here trivial) handler method. No `with draft`: draft on unmanaged BOs means implementing the draft handling yourself too — rarely worth it when wrapping a legacy API.

## `zbp_i_rap_travel_u` — Behavior pool

The global class is an empty shell (`CLASS zbp_i_rap_travel_u DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zi_rap_travel_u.`); everything lives in the CCIMP include (*Local Types* tab).

### Handler class — the interaction phase

```abap
CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR Travel RESULT result.
    METHODS create FOR MODIFY IMPORTING entities FOR CREATE Travel.
    METHODS update FOR MODIFY IMPORTING entities FOR UPDATE Travel.
    METHODS delete FOR MODIFY IMPORTING keys FOR DELETE Travel.
    METHODS read   FOR READ   IMPORTING keys FOR READ Travel RESULT result.
    METHODS lock   FOR LOCK   IMPORTING keys FOR LOCK Travel.
ENDCLASS.
```

**Buffer discipline (the whole game):** every modify handler writes to the *buffer only* and records the outcome in `mapped`/`failed`/`reported`; the saver's `save` performs the only database write. Never write the database from a handler — that splits the LUW (strict mode turns it into a runtime error). Here the legacy API brings its own buffer, so the handlers delegate to it. If your legacy API has *no* buffer, build one — a static internal table carrying the instance, its `%cid`, and change flags, exactly like the `lcl_buffer` class in the ABAP cheat-sheets unmanaged demo (`zbp_demo_abap_rap_ro_u`):

```abap
TYPES: BEGIN OF ty_buffered_travel,
         instance TYPE zi_rap_travel_u,
         cid      TYPE string,
         changed  TYPE abap_bool,
         deleted  TYPE abap_bool,
       END OF ty_buffered_travel.
CLASS-DATA mt_travel_buffer TYPE STANDARD TABLE OF ty_buffered_travel WITH EMPTY KEY.
```

```abap
CLASS lhc_travel IMPLEMENTATION.

  METHOD get_global_authorizations.
    " No restriction in this example — all users may create/update/delete.
  ENDMETHOD.

  METHOD create.
    DATA lt_legacy_messages   TYPE /dmo/t_message.
    DATA ls_legacy_travel_in  TYPE /dmo/travel.
    DATA ls_legacy_travel_out TYPE /dmo/travel.

    LOOP AT entities ASSIGNING FIELD-SYMBOL(<fs_travel_to_create>).
      " Central mapping + %control: only consumer-provided fields reach the API
      ls_legacy_travel_in = CORRESPONDING #( <fs_travel_to_create> MAPPING FROM ENTITY USING CONTROL ).

      CALL FUNCTION '/DMO/FLIGHT_TRAVEL_CREATE'  " writes to the legacy buffer, no COMMIT
        EXPORTING
          is_travel   = CORRESPONDING /dmo/s_travel_in( ls_legacy_travel_in )
        IMPORTING
          es_travel   = ls_legacy_travel_out
          et_messages = lt_legacy_messages.

      IF lt_legacy_messages IS INITIAL.
        " The API assigned the key — hand it back: %cid → TravelId
        APPEND VALUE #( %cid     = <fs_travel_to_create>-%cid
                        TravelId = ls_legacy_travel_out-travel_id ) TO mapped-travel.
      ELSE.
        APPEND VALUE #( %cid = <fs_travel_to_create>-%cid ) TO failed-travel.
        APPEND VALUE #( %cid = <fs_travel_to_create>-%cid
                        %msg = new_message( id       = lt_legacy_messages[ 1 ]-msgid
                                            number   = lt_legacy_messages[ 1 ]-msgno
                                            severity = CONV #( lt_legacy_messages[ 1 ]-msgty )
                                            v1       = lt_legacy_messages[ 1 ]-msgv1
                                            v2       = lt_legacy_messages[ 1 ]-msgv2
                                            v3       = lt_legacy_messages[ 1 ]-msgv3
                                            v4       = lt_legacy_messages[ 1 ]-msgv4 ) )
          TO reported-travel.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
```

The `mapped`/`failed`/`reported` triple is the RAP BO contract: `mapped` for every created instance (with `%cid` correlating to the consumer's request), `failed` to flag the instance, `reported` to carry the T100 message the UI will display. On create the key may not exist yet, so `%cid` addresses the instance; everywhere else use `%tky`.

```abap
  METHOD update.
    DATA lt_legacy_messages  TYPE /dmo/t_message.
    DATA ls_legacy_travel_in TYPE /dmo/travel.
    DATA ls_legacy_travel_x  TYPE /dmo/s_travel_inx.

    LOOP AT entities ASSIGNING FIELD-SYMBOL(<fs_travel_to_update>).
      ls_legacy_travel_in          = CORRESPONDING #( <fs_travel_to_update> MAPPING FROM ENTITY ).
      ls_legacy_travel_x-travel_id = <fs_travel_to_update>-TravelId.
      " Translate RAP %control flags into the BAPI x-structure via the mapping
      ls_legacy_travel_x-_intx     = CORRESPONDING zsrap_travel_x( <fs_travel_to_update> MAPPING FROM ENTITY ).

      CALL FUNCTION '/DMO/FLIGHT_TRAVEL_UPDATE'
        EXPORTING
          is_travel   = CORRESPONDING /dmo/s_travel_in( ls_legacy_travel_in )
          is_travelx  = ls_legacy_travel_x
        IMPORTING
          et_messages = lt_legacy_messages.

      IF lt_legacy_messages IS INITIAL.
        APPEND VALUE #( %tky = <fs_travel_to_update>-%tky ) TO mapped-travel.
      ELSE.
        APPEND VALUE #( %tky = <fs_travel_to_update>-%tky ) TO failed-travel.
        APPEND VALUE #( %tky = <fs_travel_to_update>-%tky
                        %msg = new_message( id       = lt_legacy_messages[ 1 ]-msgid
                                            number   = lt_legacy_messages[ 1 ]-msgno
                                            severity = CONV #( lt_legacy_messages[ 1 ]-msgty )
                                            v1       = lt_legacy_messages[ 1 ]-msgv1 ) )
          TO reported-travel.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD delete.
    DATA lt_legacy_messages TYPE /dmo/t_message.

    LOOP AT keys ASSIGNING FIELD-SYMBOL(<fs_travel_to_delete>).
      CALL FUNCTION '/DMO/FLIGHT_TRAVEL_DELETE'
        EXPORTING
          iv_travel_id = <fs_travel_to_delete>-TravelId
        IMPORTING
          et_messages  = lt_legacy_messages.

      IF lt_legacy_messages IS INITIAL.
        APPEND VALUE #( %tky = <fs_travel_to_delete>-%tky ) TO mapped-travel.
      ELSE.
        APPEND VALUE #( %tky = <fs_travel_to_delete>-%tky ) TO failed-travel.
        APPEND VALUE #( %tky = <fs_travel_to_delete>-%tky
                        %msg = new_message( id       = lt_legacy_messages[ 1 ]-msgid
                                            number   = lt_legacy_messages[ 1 ]-msgno
                                            severity = CONV #( lt_legacy_messages[ 1 ]-msgty )
                                            v1       = lt_legacy_messages[ 1 ]-msgv1 ) )
          TO reported-travel.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
```

Note the *double-write avoidance*: create/update/delete touch only the legacy buffer. Nothing is persisted yet — a `ROLLBACK ENTITIES` at this point costs nothing because the database was never written.

```abap
  METHOD read.
    DATA ls_legacy_travel_out TYPE /dmo/travel.
    DATA lt_legacy_messages   TYPE /dmo/t_message.

    " Group so the legacy API is called once per TravelId, not once per row
    LOOP AT keys INTO DATA(ls_travel_key) GROUP BY ls_travel_key-TravelId.
      CALL FUNCTION '/DMO/FLIGHT_TRAVEL_READ'   " reads the BUFFER, not the database
        EXPORTING
          iv_travel_id = ls_travel_key-TravelId
        IMPORTING
          es_travel    = ls_legacy_travel_out
          et_messages  = lt_legacy_messages.

      IF lt_legacy_messages IS INITIAL.
        INSERT CORRESPONDING #( ls_legacy_travel_out MAPPING TO ENTITY ) INTO TABLE result.
      ELSE.
        APPEND VALUE #( %tky        = ls_travel_key-%tky
                        %fail-cause = if_abap_behv=>cause-not_found ) TO failed-travel.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD lock.
    " lock master in the BDEF only declares intent — the enqueue is yours
    DATA(lo_travel_lock) = cl_abap_lock_object_factory=>get_instance( iv_name = '/DMO/ETRAVEL' ).

    LOOP AT keys ASSIGNING FIELD-SYMBOL(<fs_travel_to_lock>).
      TRY.
          lo_travel_lock->enqueue(
            it_parameter = VALUE #( ( name = 'TRAVEL_ID' value = REF #( <fs_travel_to_lock>-TravelId ) ) ) ).
        CATCH cx_abap_foreign_lock INTO DATA(lo_foreign_lock_error).
          APPEND VALUE #( %tky        = <fs_travel_to_lock>-%tky
                          %fail-cause = if_abap_behv=>cause-locked ) TO failed-travel.
          APPEND VALUE #( %tky = <fs_travel_to_lock>-%tky
                          %msg = new_message( id       = '/DMO/CM_FLIGHT_LEGAC'
                                              number   = '032'
                                              severity = if_abap_behv_message=>severity-error
                                              v1       = <fs_travel_to_lock>-TravelId
                                              v2       = lo_foreign_lock_error->user_name ) )
            TO reported-travel.
      ENDTRY.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
```

`read` serves the *buffer* so that unsaved changes are visible — the framework's etag check before an update depends on it. A `read` that selects from the database returns stale data mid-transaction. The dequeue is implicit: RAP releases locks at the end of the transaction.

### Saver class — the save sequence

```abap
CLASS lsc_zi_rap_travel_u DEFINITION INHERITING FROM cl_abap_behavior_saver.
  PROTECTED SECTION.
    METHODS finalize          REDEFINITION.
    METHODS check_before_save REDEFINITION.
    METHODS save              REDEFINITION.
    METHODS cleanup           REDEFINITION.
ENDCLASS.

CLASS lsc_zi_rap_travel_u IMPLEMENTATION.

  METHOD finalize.
    " Early save phase: final cross-BO calculations. Nothing to do here.
  ENDMETHOD.

  METHOD check_before_save.
    " Early save phase: LAST legal point to fail (failed/reported →
    " sy-subrc = 4 after COMMIT ENTITIES, back to the interaction phase).
    " The legacy API validates on each call, so nothing to re-check here.
  ENDMETHOD.

  METHOD save.
    " Late save phase — point of no return. The ONLY database write of the
    " whole transaction: the legacy API persists its buffer. The FM must NOT
    " COMMIT WORK — the RAP framework commits right after this method returns.
    CALL FUNCTION '/DMO/FLIGHT_TRAVEL_SAVE'.
  ENDMETHOD.

  METHOD cleanup.
    " Reset the transactional buffer. Also called by ROLLBACK ENTITIES —
    " which is exactly why handlers must never write the database directly.
    CALL FUNCTION '/DMO/FLIGHT_TRAVEL_INITIALIZE'.
  ENDMETHOD.

ENDCLASS.
```

Fully unmanaged BOs redefine `save` (managed BOs `with additional save` / `with unmanaged save` redefine `save_modified` instead — different method, different contract). Full method-by-method sequence, phase rules, and failure semantics: [rap-saves-and-numbering](../../../rap-saves-and-numbering/SKILL.md).

## Consuming it — EML proof

From the consumer side the unmanaged BO behaves exactly like a managed one:

```abap
MODIFY ENTITIES OF zi_rap_travel_u
  ENTITY Travel
  CREATE FIELDS ( AgencyId CustomerId BeginDate EndDate Description )
  WITH VALUE #( ( %cid        = 'CREATE-TRAVEL-1'
                  AgencyId    = '070001'
                  CustomerId  = '000001'
                  BeginDate   = cl_abap_context_info=>get_system_date( )
                  EndDate     = cl_abap_context_info=>get_system_date( ) + 30
                  Description = 'Unmanaged BO smoke test' ) )
  MAPPED   DATA(lt_mapped)
  FAILED   DATA(lt_failed)
  REPORTED DATA(lt_reported).

IF lt_failed-travel IS INITIAL.
  COMMIT ENTITIES.   " triggers finalize → check_before_save → save → cleanup
  DATA(lv_new_travel_id) = lt_mapped-travel[ 1 ]-TravelId.
ENDIF.
```

`MODIFY` runs your `create` handler (buffer only); `COMMIT ENTITIES` runs the save sequence, and `mapped` carries the legacy-assigned key back. The week 4 course wraps this exact snippet in an ABAP Unit test with `cl_cds_test_environment` — see [abap-unit-tdd](../../../abap-unit-tdd/SKILL.md).

## Managed vs unmanaged — what changed

| Concern | Managed ([../managed-bo](../managed-bo/README.md)) | Unmanaged (this scaffold) |
|---|---|---|
| BDEF header | `managed implementation in class … unique;` | `unmanaged implementation in class … unique;` |
| `persistent table` clause | Required — framework writes it | Forbidden — only your saver writes |
| Transactional buffer | Framework-provided | Legacy API's buffer (or your own `lcl_buffer`) |
| create / update / delete | Free (declare only) | `FOR MODIFY` handlers you implement |
| read | Free | `FOR READ` handler — serves the buffer |
| lock | Framework enqueue | `FOR LOCK` handler — your enqueue |
| Key numbering | `numbering : managed` UUID or external | Legacy API assigns in `create` → returned via `mapped` |
| Save | Framework INSERT/UPDATE/DELETE | Saver `save` calls the legacy persist FM |
| Buffer reset | Framework | Saver `cleanup` |
| Consumer side (EML, OData, Fiori) | Identical | Identical |

Where to go deeper:

- [../../SKILL.md](../../SKILL.md) — "Managed vs Unmanaged — pick once", "BDEF — the contract", and "Saver class" sections.
- [rap-saves-and-numbering](../../../rap-saves-and-numbering/SKILL.md) — the full save-sequence contract, phase rules, the "Fully unmanaged BOs" implementation table, and the three legacy-wrapping patterns.
- [abap-sap-luw](../../../abap-sap-luw/SKILL.md) — why the wrapped API must not `COMMIT WORK`.
- Ground truth: [openSAP RAP course week 4](https://github.com/SAP-samples/abap-platform-rap-opensap/tree/main/week4) (units 2–5 + sources) and the unmanaged demo `zbp_demo_abap_rap_ro_u` in [SAP-samples/abap-cheat-sheets](https://github.com/SAP-samples/abap-cheat-sheets/tree/main/src).
