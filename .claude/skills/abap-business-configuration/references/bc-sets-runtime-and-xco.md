# Business Configuration Sets — Runtime Activation API and XCO APIs

A Business Configuration Set (BC set, repository object type **SCP1**) is a container that groups customizing data logically according to business needs; **activating** it deploys its contents into the relevant customizing tables. Two creation paths are documented: the BC set creation wizard in ADT (which can import content from a customizing transport) and the XCO generation APIs. This file covers the class-based runtime activation API and the XCO query/read/generation APIs.

## Runtime activation API — `CL_SCPR_CD_BCSET_ACTIVATION`

Entry points on the class:

| Method | Interface | Purpose |
|---|---|---|
| `OF` | — | Instantiate the activation API for a named BC set |
| `OPTIONS` | — | Access the activation options |
| `GET_ACTIVATE_HANDLER` | `IF_SCPR_CD_BCSET_ACTIVATION` | Access the activation handler |

Exception class: `CX_SCPR_OBJECT_NOT_PERMITTED` with documented reasons `CX_SCPR_OBJECT_NOT_PERMITTED=>BC_SET_NOT_FOUND` (the set doesn't exist) and `CX_SCPR_OBJECT_NOT_PERMITTED=>BC_SET_NOT_PERMITTED` (activation not permitted based on object restrictions or the language version check).

### Step 1 — access the activation handler

`OF( iv_bcset )` returns the API instance; `GET_ACTIVATE_HANDLER( )` returns the handler (`IF_SCPR_CD_BCSET_ACTIV_HANDLER`).

```abap
TRY.
    DATA(lo_bcset_activation) = cl_scpr_cd_bcset_activation=>of( 'ZMY_BC_SET' ).
    DATA(lo_activate_handler) = lo_bcset_activation->get_activate_handler( ).
  CATCH cx_scpr_object_not_permitted INTO DATA(lo_activation_error).
    DATA(lv_error_text) = lo_activation_error->get_text( ).
ENDTRY.
```

Note: the doc pages name the interface of `GET_ACTIVATE_HANDLER` inconsistently (`IF_SCPR_CD_BCSET_ACTIVATION` in the tables, `IF_SCPR_CD_BCSET_ACTIV_START` in the prose, plus the obvious typo `IF_SCPR_CD_BCSET_AVTIVATION`). The method chain shown in the samples is authoritative; verify the exact interface names in ADT.

### Step 2 — specify activation options

The customizable option is **Activation Languages** — the languages in which language-dependent contents are activated. Default: **all active system languages**. To customize:

```abap
" Default options: skip this step entirely.
DATA(lo_activation_options) =
  cl_scpr_cd_bcset_activation=>options( )->get_activate_options( ).
lo_activation_options->add_activation_languages( VALUE #( ( langu = 'E' ) ( langu = 'F' ) ) ).
```

`OPTIONS( )` returns `IF_SCPR_CD_BCSET_OPTNS_HANDLER`; its `GET_ACTIVATE_OPTIONS( )` returns `IF_SCPR_CD_BCSET_ACTIV_OPTIONS`, whose `ADD_ACTIVATION_LANGUAGES( it_languages )` takes the list of language keys.

Options are attached to the handler with `LOCAL( )` followed by `ADD_ACTIVATION_OPTIONS( )`. **`LOCAL( )` means the contents are deployed to the tables locally during activation and are not captured in a transport request.**

### Step 3 — activate

`IF_SCPR_CD_BCSET_ACTIV_START~START( )` triggers the activation and returns `IF_SCPR_CD_BCSET_ACTIV_RESULT`:

```abap
TRY.
    DATA(lo_activate_handler) =
      cl_scpr_cd_bcset_activation=>of( 'ZMY_BC_SET' )->get_activate_handler( ).
    DATA(lo_activation_result) =
      lo_activate_handler->local( )->add_activation_options( )->start( ).
  CATCH cx_scpr_object_not_permitted INTO DATA(lo_activation_error).
    DATA(lv_error_text) = lo_activation_error->get_text( ).
ENDTRY.
```

With customized options, pass them: `lo_activate_handler->local( )->add_activation_options( lo_activation_options )->start( )`.

### Step 4 — evaluate the results

```abap
DATA(lv_is_successful)       = lo_activation_result->is_bcset_activation_successful( ).  " abap_bool
DATA(lt_activation_messages) = lo_activation_result->get_messages( ).                    " BAPIRETTAB
```

`IS_BCSET_ACTIVATION_SUCCESSFUL( )` returns `abap_true`/`abap_false`; `GET_MESSAGES( )` returns the activation log as `BAPIRETTAB`. Always check both — activation failures do not raise the exception from Step 1. (`lv_is_successful` / `lt_activation_messages` in the sample above.)

## XCO APIs for BC sets (object type SCP1)

BC sets are supported by XCO **query**, **read**, and **generation** APIs.

### Query APIs

```abap
" Handle for one BC set
DATA(lo_bc_set) = xco_cp_abap_repository=>object->scp1->for( 'ZMY_BC_SET' ).

" All visible BC sets in the repository
DATA(lt_bc_sets) = xco_cp_abap_repository=>objects->scp1->all->in( xco_cp_abap=>repository )->get( ).

" Restricted to one package
DATA(lo_package) = xco_cp_abap_repository=>package->for( 'ZBC_PACKAGE' ).
DATA(lt_package_bc_sets) = xco_cp_abap_repository=>objects->scp1->all->in( lo_package )->get( ).

" Filtered by name pattern
DATA(lo_name_filter) = xco_cp_abap_repository=>object_name->get_filter(
  xco_cp_abap_sql=>constraint->contains_pattern( '/ABC/%' ) ).
DATA(lt_filtered_bc_sets) = xco_cp_abap_repository=>objects->scp1->where(
  VALUE #( ( lo_name_filter ) ) )->in( xco_cp_abap=>repository )->get( ).
```

The object handle (`IF_XCO_BUSINESS_CNFGRTN_SET`) supports existence checks via `IF_XCO_AR_OBJECT~EXISTS`.

### Read APIs

Reads use the origin infrastructure; two origins are offered:

- **DEFAULT** (`xco_cp_business_cnfgrtn_set=>origin->default`): reads once per ABAP session from the local system, subsequent reads served from a buffer; used when no origin is specified.
- **LOCAL** (`xco_cp_business_cnfgrtn_set=>origin->local`): reads directly from the database on every call; caching configurable via `IF_XCO_BCS_CACHEABLE_ORIGIN`.

BC sets have **no active/inactive version handling** — reads always return the active version.

```abap
DATA(lo_bc_set) = xco_cp_abap_repository=>object->scp1->for( 'ZMY_BC_SET' ).
DATA(lv_short_description) = lo_bc_set->content( )->get( ).                     " default origin
DATA(lo_local_origin)      = xco_cp_business_cnfgrtn_set=>origin->local( ).
lv_short_description = lo_bc_set->content( )->get_short_description( lo_local_origin ).
```

### Generation APIs — POST / PATCH / DELETE

Only customizing objects of type **Individual Transaction Object** are currently supported inside XCO-generated BC sets. All operations run in a dev-system generation environment bound to a transport request: `xco_cp_generation=>environment->dev_system( '<TR>' )->for-scp1`.

**POST** — create a set with fully specified content (exception if the set already exists):

```abap
DATA lt_status_records TYPE STANDARD TABLE OF zstatus.
DATA lt_entity_records TYPE if_xco_bcs_entity=>tt_entity_records.

lt_status_records = VALUE #( ( ) ).
lt_entity_records = VALUE #( ( entity_name = 'ZSTATUS' records = REF #( lt_status_records ) ) ).

DATA(lo_object_template) = xco_cp_generation_scp1=>template->individual_transaction_object(
  iv_customizing_object_name = 'ZSTATUS_OBJ'
  iv_short_description       = 'Status customizing'
  it_entity_records          = lt_entity_records ).

DATA(lo_post_operation) = xco_cp_generation=>environment->dev_system( 'X02K900025'
  )->for-scp1->create_post_operation( ).

lo_post_operation->add_object( xco_cp_name=>choice->fixed( 'ZMY_BC_SET' )
  )->set_package( 'ZBC_PACKAGE'
  )->set_template( lo_object_template ).

TRY.
    DATA(lo_post_result) = lo_post_operation->execute( ).
    DATA(lt_findings) = lo_post_result->findings->get( ).
  CATCH cx_xco_runtime_exception INTO DATA(lo_xco_error).
    IF lo_xco_error IS INSTANCE OF cx_xco_gen_post_exception.
      lt_findings = CAST cx_xco_gen_post_exception( lo_xco_error )->findings->get( ).
    ELSE.
      DATA(lv_runtime_error_text) = lo_xco_error->get_text( ).  " e.g. set already exists
    ENDIF.
ENDTRY.
```

Multiple customizing objects at once: build `if_xco_bcs_customizing_object=>tt_ind_trans_objects` and use `xco_cp_generation_scp1=>template->individual_transaction_objects( ... )`.

**PATCH** — apply a change specification to an existing set. Change kinds: **DELETE**, **INSERT**, **UPDATE**, always evaluated in that order (a MODIFY = DELETE + INSERT of the same part). Changes can target customizing objects, entities (tables), or records. Sketch (`cx_xco_gen_patch_exception` carries findings):

```abap
DATA(lo_patch_operation) = xco_cp_generation=>environment->dev_system( 'X02K900025'
  )->for-scp1->create_patch_operation( ).
DATA(lo_change_specification) = lo_patch_operation->add_object( 'ZMY_BC_SET'
  )->create_change_specification( ).

DATA(lo_customizing_object) =
  lo_change_specification->for-update->add_individual_transaction_obj( 'ZSTATUS_OBJ' ).

" Upsert records into an existing entity
lo_customizing_object->for-update->add_entity( 'ZSTATUS'
  )->for-insert->add_records( REF #( lt_status_records ) ).

" Add deletion records: rows deleted from the table upon activation
lo_customizing_object->for-update->add_entity( 'ZSTATUS'
  )->for-insert->add_records( iv_to_be_deleted = abap_true
                              io_records       = REF #( lt_obsolete_records ) ).

lo_patch_operation->execute( ).
```

**DELETE** — standard delete semantics (no error if the set doesn't exist):

```abap
DATA(lo_delete_operation) = xco_cp_generation=>environment->dev_system( 'X02K900025'
  )->for-scp1->create_delete_operation( ).
lo_delete_operation->add_object( 'ZMY_BC_SET' ).
lo_delete_operation->execute( ).
```

## Verify in ADT (doc gaps)

- Exact interface names in the activation chain — the docs mix `IF_SCPR_CD_BCSET_ACTIVATION`, `IF_SCPR_CD_BCSET_ACTIV_START`, and contain the typo `IF_SCPR_CD_BCSET_AVTIVATION`.
- The structure type of `it_languages` rows in `ADD_ACTIVATION_LANGUAGES` (samples show component `langu`).
- Whether the activation handler offers non-`LOCAL( )` targets — the docs only show `local( )`.

## Sources

- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/business-configuration-sets-2adb1bf.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/runtime-api-9868551.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/accessing-the-activation-handler-e082053.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/specifying-the-activation-options-cc4c06c.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/activating-the-business-configuration-set-2ae05a5.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/accessing-the-activation-results-97e7b42.md
- https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/business-configuration-sets-ec48145.md
