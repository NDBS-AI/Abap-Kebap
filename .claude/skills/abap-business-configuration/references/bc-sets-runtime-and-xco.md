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
    DATA(bcset_activation) = cl_scpr_cd_bcset_activation=>of( 'ZMY_BC_SET' ).
    DATA(activate_handler) = bcset_activation->get_activate_handler( ).
  CATCH cx_scpr_object_not_permitted INTO DATA(activation_error).
    DATA(error_text) = activation_error->get_text( ).
ENDTRY.
```

Note: the doc pages name the interface of `GET_ACTIVATE_HANDLER` inconsistently (`IF_SCPR_CD_BCSET_ACTIVATION` in the tables, `IF_SCPR_CD_BCSET_ACTIV_START` in the prose, plus the obvious typo `IF_SCPR_CD_BCSET_AVTIVATION`). The method chain shown in the samples is authoritative; verify the exact interface names in ADT.

### Step 2 — specify activation options

The customizable option is **Activation Languages** — the languages in which language-dependent contents are activated. Default: **all active system languages**. To customize:

```abap
" Default options: skip this step entirely.
DATA(activation_options) =
  cl_scpr_cd_bcset_activation=>options( )->get_activate_options( ).
activation_options->add_activation_languages( VALUE #( ( langu = 'E' ) ( langu = 'F' ) ) ).
```

`OPTIONS( )` returns `IF_SCPR_CD_BCSET_OPTNS_HANDLER`; its `GET_ACTIVATE_OPTIONS( )` returns `IF_SCPR_CD_BCSET_ACTIV_OPTIONS`, whose `ADD_ACTIVATION_LANGUAGES( it_languages )` takes the list of language keys.

Options are attached to the handler with `LOCAL( )` followed by `ADD_ACTIVATION_OPTIONS( )`. **`LOCAL( )` means the contents are deployed to the tables locally during activation and are not captured in a transport request.**

### Step 3 — activate

`IF_SCPR_CD_BCSET_ACTIV_START~START( )` triggers the activation and returns `IF_SCPR_CD_BCSET_ACTIV_RESULT`:

```abap
TRY.
    DATA(activate_handler) =
      cl_scpr_cd_bcset_activation=>of( 'ZMY_BC_SET' )->get_activate_handler( ).
    DATA(activation_result) =
      activate_handler->local( )->add_activation_options( )->start( ).
  CATCH cx_scpr_object_not_permitted INTO DATA(activation_error).
    DATA(error_text) = activation_error->get_text( ).
ENDTRY.
```

With customized options, pass them: `activate_handler->local( )->add_activation_options( activation_options )->start( )`.

### Step 4 — evaluate the results

```abap
DATA(is_successful)       = activation_result->is_bcset_activation_successful( ).  " abap_bool
DATA(activation_messages) = activation_result->get_messages( ).                    " BAPIRETTAB
```

`IS_BCSET_ACTIVATION_SUCCESSFUL( )` returns `abap_true`/`abap_false`; `GET_MESSAGES( )` returns the activation log as `BAPIRETTAB`. Always check both — activation failures do not raise the exception from Step 1.

## XCO APIs for BC sets (object type SCP1)

BC sets are supported by XCO **query**, **read**, and **generation** APIs.

### Query APIs

```abap
" Handle for one BC set
DATA(bc_set) = xco_cp_abap_repository=>object->scp1->for( 'ZMY_BC_SET' ).

" All visible BC sets in the repository
DATA(bc_sets) = xco_cp_abap_repository=>objects->scp1->all->in( xco_cp_abap=>repository )->get( ).

" Restricted to one package
DATA(package) = xco_cp_abap_repository=>package->for( 'ZBC_PACKAGE' ).
DATA(package_bc_sets) = xco_cp_abap_repository=>objects->scp1->all->in( package )->get( ).

" Filtered by name pattern
DATA(name_filter) = xco_cp_abap_repository=>object_name->get_filter(
  xco_cp_abap_sql=>constraint->contains_pattern( '/ABC/%' ) ).
DATA(filtered_bc_sets) = xco_cp_abap_repository=>objects->scp1->where(
  VALUE #( ( name_filter ) ) )->in( xco_cp_abap=>repository )->get( ).
```

The object handle (`IF_XCO_BUSINESS_CNFGRTN_SET`) supports existence checks via `IF_XCO_AR_OBJECT~EXISTS`.

### Read APIs

Reads use the origin infrastructure; two origins are offered:

- **DEFAULT** (`xco_cp_business_cnfgrtn_set=>origin->default`): reads once per ABAP session from the local system, subsequent reads served from a buffer; used when no origin is specified.
- **LOCAL** (`xco_cp_business_cnfgrtn_set=>origin->local`): reads directly from the database on every call; caching configurable via `IF_XCO_BCS_CACHEABLE_ORIGIN`.

BC sets have **no active/inactive version handling** — reads always return the active version.

```abap
DATA(bc_set) = xco_cp_abap_repository=>object->scp1->for( 'ZMY_BC_SET' ).
DATA(short_description) = bc_set->content( )->get( ).                     " default origin
DATA(local_origin)      = xco_cp_business_cnfgrtn_set=>origin->local( ).
short_description = bc_set->content( )->get_short_description( local_origin ).
```

### Generation APIs — POST / PATCH / DELETE

Only customizing objects of type **Individual Transaction Object** are currently supported inside XCO-generated BC sets. All operations run in a dev-system generation environment bound to a transport request: `xco_cp_generation=>environment->dev_system( '<TR>' )->for-scp1`.

**POST** — create a set with fully specified content (exception if the set already exists):

```abap
DATA status_records TYPE STANDARD TABLE OF zstatus.
DATA entity_records TYPE if_xco_bcs_entity=>tt_entity_records.

status_records = VALUE #( ( ) ).
entity_records = VALUE #( ( entity_name = 'ZSTATUS' records = REF #( status_records ) ) ).

DATA(object_template) = xco_cp_generation_scp1=>template->individual_transaction_object(
  iv_customizing_object_name = 'ZSTATUS_OBJ'
  iv_short_description       = 'Status customizing'
  it_entity_records          = entity_records ).

DATA(post_operation) = xco_cp_generation=>environment->dev_system( 'X02K900025'
  )->for-scp1->create_post_operation( ).

post_operation->add_object( xco_cp_name=>choice->fixed( 'ZMY_BC_SET' )
  )->set_package( 'ZBC_PACKAGE'
  )->set_template( object_template ).

TRY.
    DATA(post_result) = post_operation->execute( ).
    DATA(findings) = post_result->findings->get( ).
  CATCH cx_xco_runtime_exception INTO DATA(xco_error).
    IF xco_error IS INSTANCE OF cx_xco_gen_post_exception.
      findings = CAST cx_xco_gen_post_exception( xco_error )->findings->get( ).
    ELSE.
      DATA(runtime_error_text) = xco_error->get_text( ).  " e.g. set already exists
    ENDIF.
ENDTRY.
```

Multiple customizing objects at once: build `if_xco_bcs_customizing_object=>tt_ind_trans_objects` and use `xco_cp_generation_scp1=>template->individual_transaction_objects( ... )`.

**PATCH** — apply a change specification to an existing set. Change kinds: **DELETE**, **INSERT**, **UPDATE**, always evaluated in that order (a MODIFY = DELETE + INSERT of the same part). Changes can target customizing objects, entities (tables), or records. Sketch (`cx_xco_gen_patch_exception` carries findings):

```abap
DATA(patch_operation) = xco_cp_generation=>environment->dev_system( 'X02K900025'
  )->for-scp1->create_patch_operation( ).
DATA(change_specification) = patch_operation->add_object( 'ZMY_BC_SET'
  )->create_change_specification( ).

DATA(customizing_object) =
  change_specification->for-update->add_individual_transaction_obj( 'ZSTATUS_OBJ' ).

" Upsert records into an existing entity
customizing_object->for-update->add_entity( 'ZSTATUS'
  )->for-insert->add_records( REF #( status_records ) ).

" Add deletion records: rows deleted from the table upon activation
customizing_object->for-update->add_entity( 'ZSTATUS'
  )->for-insert->add_records( iv_to_be_deleted = abap_true
                              io_records       = REF #( obsolete_records ) ).

patch_operation->execute( ).
```

**DELETE** — standard delete semantics (no error if the set doesn't exist):

```abap
DATA(delete_operation) = xco_cp_generation=>environment->dev_system( 'X02K900025'
  )->for-scp1->create_delete_operation( ).
delete_operation->add_object( 'ZMY_BC_SET' ).
delete_operation->execute( ).
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
