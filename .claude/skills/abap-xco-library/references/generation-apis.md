# XCO Generation APIs In Depth — Creating Repository Objects from Code

All code chains below are verbatim from the SAP BTP documentation pages cited at the bottom. Anything not shown there is flagged.

## What Can Be Generated

High-level, strongly typed APIs exist for these object types:

BDEF (Behavior Definitions), BGQC (Background Processing Context), CLAS (Classes), DCLS (Access Controls), DDLS (Data Definitions), DDLX (Metadata Extensions), DESD (Logical External Schema), DEVC (Packages), DOMA (Domains), DRTY (CDS Type Definitions), DTEL (Data Elements), EVTB (Event Bindings), FUGR (Function Groups), INTF (Interfaces), MSAG (Message Classes), NONT (SAP Object Node Types), RONT (SAP Object Types), SCP1 (Business Configuration Sets), SRVB (Service Bindings), SRVD (Service Definitions), TABL (Structures, Database Tables and Global Temporary Tables), TTYP (Table Types), XSLT (Transformations).

### Operation support matrix (from the docs)

| Type | PUT | POST | PATCH | DELETE |
|---|---|---|---|---|
| BDEF | X | | | X |
| BGQC | X | | X | X |
| CLAS | X | | X | X |
| DCLS | X | | | X |
| DDLS | X | | | X |
| DDLX | X | | | X |
| DESD | X | | | X |
| DEVC | X | | | X |
| DOMA | X | | X | X |
| DRTY | X | | | X |
| DTEL | X | | X | X |
| EVTB | X | | X | X |
| FUGR | | X | X | X |
| INTF | X | | X | X |
| MSAG | X | | X | X |
| NONT | X | | X | X |
| RONT | X | | X | X |
| SCP1 | | X | X | X |
| SRVB | X | | | X |
| SRVD | X | | | X |
| TABL | X | | | X |
| TTYP | X | | | X |
| XSLT | X | | | X |

Rule of thumb: everything supports PUT + DELETE except FUGR and SCP1 (POST instead of PUT); PATCH exists mostly for class-like/part-structured objects (CLAS, INTF, MSAG, DOMA, DTEL, FUGR, …).

## The Environment Model

A **generation environment** is the prerequisite for building and executing operations. It is backed by a transport in status **Modifiable**; all system changes caused by operations of that environment are recorded on it:

```abap
" In this example, X08K123456 would need to be a modifiable Workbench
" transport.
DATA(lo_environment) = xco_cp_generation=>environment->dev_system( 'X08K123456' ).

DATA(lo_put_operation) = lo_environment->create_put_operation( ).
lo_put_operation->for-dtel->add_object( '...' ).
```

The environment reference is typed `if_xco_cp_gen_env_dev_system` in the doc samples. Note the two entry styles used by the docs:

- Multi-type PUT: `lo_environment->create_put_operation( )` then `lo_put_operation->for-<type>->add_object( … )`
- Single-type operations: `lo_environment->for-srvb->create_put_operation( )`, `lo_environment->for-doma->create_delete_operation( )`, `lo_environment->for-fugr->create_post_operation( )`

## Operations

### PUT — create or update

- Creates the object if missing, updates it if present.
- A valid **package** must be provided for objects that may be new (`->set_package( … )`); it is ignored on update.
- Objects supporting inactive versions can be combined in **one** PUT operation and are **mass-activated together** — interdependencies, even circular ones, are supported.
- Execution options: currently only *skip activation*:

```abap
lo_put_operation->execute( VALUE #( ( xco_cp_generation=>put_operation_option->skip_activation ) ) ).
```

Complete minimal example (data element):

```abap
DATA(lo_put_operation) = lo_environment->create_put_operation( ).

DATA(lo_specification) = lo_put_operation->for-dtel->add_object( 'ZDATA_ELEMENT'
  )->set_package( 'ZPACKAGE'
  )->create_form_specification( ).
lo_specification->set_short_description( 'My generated data element' ).

lo_specification->set_data_type( xco_cp_abap_dictionary=>built_in_type->char( 10 ) ).

lo_specification->field_label-short->set_text( 'ID' ).
lo_specification->field_label-medium->set_text( 'Identifier' ).
lo_specification->field_label-long->set_text( 'User identifier' ).
lo_specification->field_label-heading->set_text( 'User identifier' ).

lo_put_operation->execute( ).
```

### POST — create with a name choice

Objects on a POST operation get an `IF_XCO_NAME_CHOICE` instead of a fixed name, resolved at execution (allows fallback names; fixed is possible too). Only proceeds if *all* name choices resolve to unused names; then semantics equal a PUT over non-existing objects:

```abap
DATA(lo_post_operation) = lo_environment->for-fugr->create_post_operation( ).

DATA(lo_fixed_name_choice) = xco_cp_name=>choice->fixed( 'ZMY_FNCTN_GRP' ).
lo_post_operation->add_object( lo_fixed_name_choice
  )->set_package( 'ZLOCAL'
  )->create_form_specification( ).

lo_post_operation->execute( ).
```

### PATCH — partial update

Updates parts of existing objects; available changes depend on the type. Part semantics (documented for message classes):

- **INSERT** — add if not there; no action if it exists
- **UPDATE** — change if there; no action if missing
- **MODIFY** — create or update
- **DELETE** — remove if there; no action if missing

### DELETE

Deletes the objects if they exist. DELETE operations are built **per type**, and the **caller must order deletions across types** (e.g. a domain still used by a data element cannot be deleted — delete the data element first; the RAP BO sample deletes SRVB → SRVD → CLAS → BDEF → DCLS → DDLX → DDLS → TABL → DTEL → DOMA).

```abap
DATA(lo_delete_operation) = mo_environment->for-doma->create_delete_operation( ).
lo_delete_operation->add_object( co_doma_status ).
lo_delete_operation->execute( ).
```

### Commit behavior

**The execution of an operation always executes a `COMMIT WORK`.** Plan RAP/LUW interactions accordingly (do not run generation inside a RAP modify phase).

## Conceptual Abstractions and Templates

Conceptual abstractions are shared vocabulary across object types:

```abap
DATA(lo_char_10) = xco_cp_abap_dictionary=>built_in_type->char( 10 ).

lo_doma_specification->set_format( lo_char_10 ).
lo_dtel_specification->set_data_type( lo_char_10 ).
lo_ttyp_specification->set_row_type( lo_char_10 ).
```

Reference an existing domain or data element with `xco_cp_abap_dictionary=>domain( '…' )` / `xco_cp_abap_dictionary=>data_element( '…' )`.

**Templates** prefill an empty form specification from an existing object — supported for DOMA, DTEL, TABL, TTYP, DDLS. Copying a domain:

```abap
DATA(lo_template) = xco_cp_generation_doma=>template->for_domain(
  iv_name       = 'ZSOURCE_DOMAIN'
  io_read_state = xco_cp_abap_dictionary=>object_read_state->active_version
).

DATA(lo_put_operation) = lo_environment->create_put_operation( ).
lo_put_operation->for-doma->add_object( 'ZCOPIED_DOMAIN'
  )->set_package( 'ZPACKAGE'
  )->set_template( lo_template ).
lo_put_operation->execute( ).
```

## Worked Example: Table + Class (doc-grounded fragments)

The fragments below are lifted from the RAP BO generation sample. A runnable Clean-ABAP assembly is in [../examples/generate-table-and-class.md](../examples/generate-table-and-class.md).

Database table (note the `for-tabl-for-database_table` path and the fluent field chains):

```abap
DATA(lo_specification) = io_put_operation->for-tabl-for-database_table->add_object( co_tabl_dbt_name
  )->set_package( co_package
  )->create_form_specification( ).
lo_specification->set_short_description( 'Vacation request'
  )->set_delivery_class( xco_cp_database_table=>delivery_class->a
  )->set_data_maintenance( xco_cp_database_table=>data_maintenance->allowed ).

lo_specification->add_field( 'CLIENT' )->set_type( xco_cp_abap_dictionary=>built_in_type->clnt
  )->set_key_indicator(
  )->set_not_null( ).
lo_specification->add_field( 'IDENTIFIER' )->set_type( xco_cp_abap_dictionary=>built_in_type->char( 30 )
  )->set_key_indicator(
  )->set_not_null( ).
lo_specification->add_field( 'START_DATE' )->set_type( xco_cp_abap_dictionary=>built_in_type->dats ).
lo_specification->add_field( 'STATUS' )->set_type( xco_cp_abap_dictionary=>data_element( co_dtel_status ) ).
```

Class (global definition + local behavior handler with method parameters):

```abap
DATA(lo_specification) = io_put_operation->for-clas->add_object( co_clas_name
  )->set_package( co_package
  )->create_form_specification( ).
lo_specification->set_short_description( 'Behavior implementation' ).

lo_specification->definition->set_abstract(
  )->set_for_behavior_of( co_ddls_interface_name ).

DATA(lo_handler) = lo_specification->add_local_class( 'LCL_HANDLER' ).
lo_handler->definition->set_superclass( 'CL_ABAP_BEHAVIOR_HANDLER' ).

DATA(lo_publish) = lo_handler->definition->section-private->add_method( 'APPROVE' ).
lo_publish->behavior_implementation->set_for_modify(
  )->set_result( co_ddls_interface_name ).
lo_publish->add_importing_parameter( 'IT_VACATION_REQUESTS'
  )->behavior_implementation->set_for_action(
    iv_entity_name = co_ddls_interface_name
    iv_action_name = 'approve'
).

lo_handler->implementation->add_method( 'APPROVE' ).
```

The docs do not show a generic "set arbitrary source code" call on the CLAS form specification in these pages; method bodies beyond declarations are covered by separate pages (*Logic Generation*, *Patching Methods of Interfaces and Classes*) — consult those before promising source-level generation.

## Worked Example: Full RAP BO

The *RAP BO Generation* page generates a complete BO in **one** PUT operation (plus the service binding in a second PUT, since SRVB must reference an activated SRVD). Object flow:

1. **DOMA** — CHAR(10) format, fixed values `APPROVED`/`DECLINED` via `lo_specification->fixed_values->add_fixed_value( 'APPROVED' )->set_description( 'Approved' )`.
2. **DTEL** — `set_data_type( xco_cp_abap_dictionary=>domain( co_doma_status ) )`.
3. **TABL** (database table) — as above.
4. **DDLS** interface view — `->add_view_entity( )`, `lo_view_entity->set_root( )->data_source->set_view_entity( … )`, a WHERE clause built with `xco_cp_ddl=>field( 'is_active' )->eq( xco_cp_ddl=>literal->character( 'X' ) )`, annotations via `lo_view_entity->add_annotation( 'AccessControl.authorizationCheck' )->value->build( )->add_enum( 'CHECK' )`, fields via `lo_view_entity->add_field( xco_cp_ddl=>field( 'identifier' ) )->set_key( )->set_alias( 'Identifier' )`.
5. **DDLS** projection view — `->add_projection_view( )` over the interface view.
6. **DDLX** metadata extension — `set_layer( xco_cp_metadata_extension=>layer->customer )`, `set_view( … )`, UI annotations built as arrays of records:

```abap
lo_field->add_annotation( 'UI.lineItem' )->value->build(
  )->begin_array(
    )->begin_record(
      )->add_member( 'position' )->add_number( lv_position
      )->add_member( 'label' )->add_string( ls_field-label
    )->end_record(
  )->end_array( ).
```

7. **DCLS** access control — `lo_specification->add_role( )`, `lo_role->add_access_rule( co_ddls_interface_name )->set_where( xco_cp_dcl=>field( 'Identifier' )->is_not_initial( ) )`.
8. **BDEF** — managed implementation:

```abap
lo_interface_specification->set_short_description( 'Vacation request behavior'
  )->set_implementation_type( xco_cp_behavior_definition=>implementation_type->managed
  )->set_implementation_class( co_clas_name ).

DATA(lo_interface_behavior) = lo_interface_specification->add_behavior( ).

lo_interface_behavior->characteristics->set_persistent_table( co_tabl_dbt_name
  )->lock->set_master( ).

lo_interface_behavior->add_mapping_for( co_tabl_dbt_name )->set_field_mapping( VALUE #(
  ( cds_view_field = 'Identifier' dbtable_field = 'identifier' )
  ( cds_view_field = 'StartDate' dbtable_field = 'start_date' )
) ).

lo_interface_behavior->add_standard_operation( xco_cp_behavior_definition=>standard_operation->create ).

DATA(lo_action) = lo_interface_behavior->add_action( 'approve' ).
lo_action->set_external_name( 'Approve' ).
lo_action->result->set_cardinality( xco_cp_cds=>cardinality->one )->set_self( ).
```

   The projection BDEF uses `implementation_type->projection` and `add_standard_operation( … )->set_use( )`.
9. **CLAS** — behavior pool, as above.
10. **SRVD** — `lo_specification->add_exposure( co_ddls_consumption_name )->set_alias( 'VacationRequest' )`.
11. **SRVB** (separate PUT) — `set_binding_type( xco_cp_service_binding=>binding_type->odata_v2_ui )`, `lo_specification->add_service( )->add_version( '0001' )->set_service_definition( co_srvd_name )`.

## Error Handling

Each operation kind has its exception: `CX_XCO_GEN_POST_EXCEPTION`, `CX_XCO_GEN_PUT_EXCEPTION`, `CX_XCO_GEN_PATCH_EXCEPTION`, `CX_XCO_GEN_DELETE_EXCEPTION`. Each provides the **findings** — all messages keyed by object:

```abap
TRY.
    lo_put_operation->execute( ).
  CATCH cx_xco_gen_put_exception INTO DATA(lx_put_exception).
    " Get all findings.
    out->plain->write( |Findings:| ).
    out->write_news( lx_put_exception ).

    " Get only the TTYP findings.
    out->plain->write( |Table type findings:| ).
    out->write_news( lx_put_exception->findings->for->ttyp ).
ENDTRY.
```

(The `out->write_news( )` / `out->plain->write( )` calls require `cl_xco_cp_adt_simple_classrun`, not plain `if_oo_adt_classrun`.)

If the mass activation of a PUT fails, the already-created **inactive versions are not deleted** — rerun after fixing, or clean up explicitly.

## Combining with CTS

The CTS docs note that creating and releasing transports programmatically "is especially useful in combination with the XCO Generation APIs to build completely self-contained generation programs":

```abap
DATA(ls_package) = xco_cp_abap_repository=>package->for( 'ZMY_STRUCTURE_PACKAGE'
  )->read( ).

DATA(lv_transport_target) = ls_package-property-transport_layer->get_transport_target( )->value.

DATA(lo_transport_request) = xco_cp_cts=>transports->workbench( lv_transport_target
  )->create_request( 'My generated Workbench transport request' ).
```

The docs consulted here do not show the accessor that turns the freshly created request handle into the plain transport ID expected by `xco_cp_generation=>environment->dev_system( … )` (the query examples show `->value` on `IF_XCO_CP_TRANSPORT` objects). Verify via ADT code completion on your release before relying on it; the SAP samples themselves pass the transport ID as a constant.

## Further Generation Pages (not covered here — read before use)

The docs' generation subtree also covers: Logic Generation; Patching Methods / Attributes of Interfaces and Classes; Patching a Message Class; Patching Structures and Database Tables; Function Module Generation and updating FM source; Generating and Reading CDS Abstract Entities; Global Temporary Tables; CDS Type Definitions; CDS External Entities; CDS Table Entities; Table Functions and AMDP; Generating Transformations; Changing Content of Existing Domains / Data Elements; Generation Error Handling. Find them from the TOC: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/index.md (section *XCO Library → ABAP Repository → Generation APIs*).

## Sources

- Generation APIs (object types + operation matrix): https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/generation-apis-02bfcde.md
- Design of the XCO Generation APIs (environment, operations, abstractions, templates): https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/design-of-the-xco-generation-apis-d01859f.md
- RAP BO Generation (full worked sample): https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/rap-bo-generation-65a7efb.md
- Generation Error Handling: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/generation-error-handling-772eee2.md
- Correction and Transport System: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/correction-and-transport-system-1d7ea1c.md
