# Example: Generate a Database Table + Class with the XCO Generation APIs

A self-contained ADT classrun that generates a domain, a data element, a database table and a class in **one** PUT operation (mass activation handles the dependencies), with the documented error handling. The structure and every XCO chain follow the SAP samples on the *RAP BO Generation*, *Design of the XCO Generation APIs* and *Generation Error Handling* pages verbatim; only names and Clean-ABAP conventions differ.

Before running: replace `c_package_name` with an existing package. `c_demo_transport_id_placeholder` exists only so this sample can run standalone from ADT (`IF_OO_ADT_CLASSRUN` requires a no-argument-instantiable class, so `main` cannot take real parameters) — it is **not** a pattern to ship. A real caller invokes the reusable `generate_objects( iv_transport_id = … )` method directly, with the transport ID sourced from an injected/admin-selected parameter (a report selection-screen field, a Customizing entry, a value passed down from the calling program) rather than a literal compiled into the class — anyone who could trigger generation onto an attacker-chosen transport could smuggle objects onto requests they should not touch. `generate_objects` also requires its caller to have run an authorization check first (see below) and, for anything beyond a throwaway demo, to have previewed the generation before committing it. The class inherits from `cl_xco_cp_adt_simple_classrun` (like the SAP samples) so findings can be written with `out->write_news( )`.

```abap
CLASS zcl_demo_generate_table_class DEFINITION
  PUBLIC FINAL CREATE PUBLIC
  INHERITING FROM cl_xco_cp_adt_simple_classrun.

  PUBLIC SECTION.
    METHODS constructor.

    " The reusable entry point: real callers pass the transport ID as an
    " explicitly injected/admin-selected parameter here — never a literal
    " compiled into the class. The caller must already have performed its own
    " authorization check (who is allowed to trigger generation at all) and,
    " outside a throwaway demo, a dry-run/preview of what will be generated
    " before calling this with iv_dry_run = abap_false.
    METHODS generate_objects
      IMPORTING
        iv_transport_id TYPE sxco_transport
        iv_dry_run      TYPE abap_bool DEFAULT abap_true.

  PROTECTED SECTION.
    METHODS main REDEFINITION.

  PRIVATE SECTION.
    CONSTANTS:
      c_package_name                  TYPE sxco_package         VALUE 'ZDEMO_GENERATION',
      " DEMO PLACEHOLDER ONLY — see generate_objects and the "Before running"
      " note above. Never hardcode a real transport ID like this; it must
      " come from an injected/admin-selected parameter at the call site.
      c_demo_transport_id_placeholder TYPE sxco_transport       VALUE 'X08K900164',
      c_domain_name                   TYPE sxco_ad_object_name  VALUE 'ZDEMO_GEN_STATUS',
      c_data_element_name             TYPE sxco_ad_object_name  VALUE 'ZDEMO_GEN_STATUS',
      c_table_name                    TYPE sxco_dbt_object_name VALUE 'ZDEMO_GEN_ITEM',
      c_class_name                    TYPE sxco_ad_object_name  VALUE 'ZCL_DEMO_GEN_ITEM_API'.

    DATA mo_environment TYPE REF TO if_xco_cp_gen_env_dev_system.

    METHODS add_domain
      IMPORTING io_put_operation TYPE REF TO if_xco_cp_gen_d_o_put.

    METHODS add_data_element
      IMPORTING io_put_operation TYPE REF TO if_xco_cp_gen_d_o_put.

    METHODS add_database_table
      IMPORTING io_put_operation TYPE REF TO if_xco_cp_gen_d_o_put.

    METHODS add_class
      IMPORTING io_put_operation TYPE REF TO if_xco_cp_gen_d_o_put.
ENDCLASS.


CLASS zcl_demo_generate_table_class IMPLEMENTATION.

  METHOD constructor.
    super->constructor( ).
  ENDMETHOD.

  METHOD main.
    " Demo entry point only — see the "Before running" note above.
    " IF_OO_ADT_CLASSRUN gives main( ) no way to accept a real caller's
    " transport ID, so this wires the placeholder constant. iv_dry_run
    " defaults to abap_true, so running this from ADT only previews the
    " generation (inactive versions, not activated) until you deliberately
    " review the findings and call generate_objects( iv_dry_run = abap_false )
    " yourself.
    generate_objects( iv_transport_id = c_demo_transport_id_placeholder ).
  ENDMETHOD.

  METHOD generate_objects.
    " --- Authorization check (mandatory before generating anything) -------
    " The XCO generation framework enforces the object-type authorizations
    " for whatever it creates/updates, but it has no notion of your business
    " rule for *who is allowed to trigger generation at all*. Add that check
    " here — e.g. AUTHORITY-CHECK against a custom authorization object
    " scoped to "may run code generation" — and stop before building the
    " environment if it fails. This sample intentionally omits the
    " business-specific check; do not ship it without adding one.
    " IF sy-subrc <> 0.
    "   RAISE EXCEPTION TYPE zcx_not_authorized.
    " ENDIF.

    " The generation environment is backed by a modifiable Workbench transport;
    " every change of every operation of this environment is recorded on it.
    mo_environment = xco_cp_generation=>environment->dev_system( iv_transport_id ).
    DATA(lo_put_operation) = mo_environment->create_put_operation( ).

    " One PUT operation for all four objects: they are created/updated in
    " inactive versions and then mass-activated together, so the class may
    " already reference the table it is generated with.
    add_domain( lo_put_operation ).
    add_data_element( lo_put_operation ).
    add_database_table( lo_put_operation ).
    add_class( lo_put_operation ).

    TRY.
        " --- Dry run / preview (recommended before a real generation) -----
        " skip_activation leaves every object in its inactive version
        " instead of mass-activating it, so an admin/reviewer can inspect
        " what would be generated (e.g. via the inactive-objects list)
        " before a second, real run activates it.
        IF iv_dry_run = abap_true.
          lo_put_operation->execute( VALUE #( ( xco_cp_generation=>put_operation_option->skip_activation ) ) ).
          out->write( |Dry run complete - objects created inactive, not activated.| ).
        ELSE.
          lo_put_operation->execute( ).
          out->write( |PUT operation executed successfully.| ).
        ENDIF.
      CATCH cx_xco_gen_put_exception INTO DATA(lo_put_error).
        " Findings carry all messages per object.
        out->plain->write( |Findings:| ).
        out->write_news( lo_put_error ).
    ENDTRY.
  ENDMETHOD.

  METHOD add_domain.
    DATA(lo_specification) = io_put_operation->for-doma->add_object( c_domain_name
      )->set_package( c_package_name
      )->create_form_specification( ).
    lo_specification->set_short_description( 'Demo item status' ).

    lo_specification->set_format( xco_cp_abap_dictionary=>built_in_type->char( 10 ) ).

    lo_specification->fixed_values->add_fixed_value( 'NEW'
      )->set_description( 'New' ).
    lo_specification->fixed_values->add_fixed_value( 'DONE'
      )->set_description( 'Done' ).
  ENDMETHOD.

  METHOD add_data_element.
    DATA(lo_specification) = io_put_operation->for-dtel->add_object( c_data_element_name
      )->set_package( c_package_name
      )->create_form_specification( ).
    lo_specification->set_short_description( 'Demo item status' ).

    lo_specification->set_data_type( xco_cp_abap_dictionary=>domain( c_domain_name ) ).

    lo_specification->field_label-short->set_text( 'Status' ).
    lo_specification->field_label-medium->set_text( 'Item status' ).
    lo_specification->field_label-long->set_text( 'Demo item status' ).
    lo_specification->field_label-heading->set_text( 'Demo item status' ).
  ENDMETHOD.

  METHOD add_database_table.
    DATA(lo_specification) = io_put_operation->for-tabl-for-database_table->add_object( c_table_name
      )->set_package( c_package_name
      )->create_form_specification( ).
    lo_specification->set_short_description( 'Demo item'
      )->set_delivery_class( xco_cp_database_table=>delivery_class->a
      )->set_data_maintenance( xco_cp_database_table=>data_maintenance->allowed ).

    lo_specification->add_field( 'CLIENT' )->set_type( xco_cp_abap_dictionary=>built_in_type->clnt
      )->set_key_indicator(
      )->set_not_null( ).
    lo_specification->add_field( 'ITEM_ID' )->set_type( xco_cp_abap_dictionary=>built_in_type->char( 30 )
      )->set_key_indicator(
      )->set_not_null( ).
    lo_specification->add_field( 'CREATED_ON' )->set_type( xco_cp_abap_dictionary=>built_in_type->dats ).
    lo_specification->add_field( 'STATUS' )->set_type( xco_cp_abap_dictionary=>data_element( c_data_element_name ) ).
  ENDMETHOD.

  METHOD add_class.
    DATA(lo_specification) = io_put_operation->for-clas->add_object( c_class_name
      )->set_package( c_package_name
      )->create_form_specification( ).
    lo_specification->set_short_description( 'Demo item API' ).

    " The CLAS form specification exposes the definition (interfaces,
    " superclass, sections, methods) as shown in the RAP BO generation sample.
    " Full method-body source generation is covered by the separate
    " "Logic Generation" / "Patching Methods" doc pages - verify there
    " before generating implementations.
    DATA(lo_helper) = lo_specification->add_local_class( 'LCL_HELPER' ).
    lo_helper->definition->section-private->add_method( 'READ_ITEMS' ).
    lo_helper->implementation->add_method( 'READ_ITEMS' ).
  ENDMETHOD.

ENDCLASS.
```

## Cleaning Up

Deletion runs per type and the caller owns the ordering — dependents first (class, table, data element), dependencies last (domain), mirroring the SAP delete sample:

```abap
DATA(lo_class_deletion) = mo_environment->for-clas->create_delete_operation( ).
lo_class_deletion->add_object( c_class_name ).
lo_class_deletion->execute( ).

DATA(lo_table_deletion) = mo_environment->for-tabl-for-database_table->create_delete_operation( ).
lo_table_deletion->add_object( c_table_name ).
lo_table_deletion->execute( ).

DATA(lo_data_element_deletion) = mo_environment->for-dtel->create_delete_operation( ).
lo_data_element_deletion->add_object( c_data_element_name ).
lo_data_element_deletion->execute( ).

DATA(lo_domain_deletion) = mo_environment->for-doma->create_delete_operation( ).
lo_domain_deletion->add_object( c_domain_name ).
lo_domain_deletion->execute( ).
```

## Attaching to a Transport

The environment *is* the transport attachment: `xco_cp_generation=>environment->dev_system( iv_transport_id )` records everything on that request. To make the program fully self-contained, the CTS module can create the request first (chains verbatim from the CTS page):

```abap
DATA(lo_package_content) = xco_cp_abap_repository=>package->for( 'ZMY_STRUCTURE_PACKAGE'
  )->read( ).

DATA(lv_transport_target) = lo_package_content-property-transport_layer->get_transport_target( )->value.

DATA(lo_transport_request) = xco_cp_cts=>transports->workbench( lv_transport_target
  )->create_request( 'My generated Workbench transport request' ).
```

Note: the docs consulted do not show the accessor that extracts the plain transport ID from this freshly created request handle for reuse in `environment->dev_system( … )` (the transport *query* examples expose `->value` on `IF_XCO_CP_TRANSPORT`). The SAP generation samples pass the transport ID as a constant; verify the handle's accessor via ADT code completion on your release.

## Sources

- Design of the XCO Generation APIs: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/design-of-the-xco-generation-apis-d01859f.md
- RAP BO Generation (structure and chains of this sample): https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/rap-bo-generation-65a7efb.md
- Generation Error Handling: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/generation-error-handling-772eee2.md
- Correction and Transport System: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/correction-and-transport-system-1d7ea1c.md
