*&---------------------------------------------------------------------*
*& EML consumer flow: create -> update -> deep create -> action ->
*& read -> commit -> failure evaluation -> rollback
*&
*& Runnable-style example written against the demo RAP BO of the
*& SAP-samples/abap-cheat-sheets repository (managed BO
*& zdemo_abap_rap_ro_m, alias "root", child zdemo_abap_rap_ch_m,
*& alias "child", association _child, action multiply_by_2).
*& Import that repository to execute it 1:1, or substitute your own
*& BO, entity aliases, and field names.
*&---------------------------------------------------------------------*
CLASS zcl_demo_eml_consumer_flow DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.

  PRIVATE SECTION.
    METHODS evaluate_failed
      IMPORTING
        it_failed_response TYPE RESPONSE FOR FAILED zdemo_abap_rap_ro_m
        io_console         TYPE REF TO if_oo_adt_classrun_out.

ENDCLASS.


CLASS zcl_demo_eml_consumer_flow IMPLEMENTATION.

  METHOD if_oo_adt_classrun~main.

    "---------------------------------------------------------------
    " 1) CREATE (short form) — FIELDS ( ... ) WITH fills %control
    "    %cid must be unique within the EML request.
    "---------------------------------------------------------------
    MODIFY ENTITY zdemo_abap_rap_ro_m
      CREATE FIELDS ( key_field field1 field2 field3 field4 )
      WITH VALUE #( ( %cid      = 'create_1'
                      key_field = 1
                      field1    = 'aaa'
                      field2    = 'bbb'
                      field3    = 10
                      field4    = 11 ) )
      MAPPED   DATA(lt_mapped_create)
      FAILED   DATA(lt_failed_create)
      REPORTED DATA(lt_reported_create).

    evaluate_failed( it_failed_response = lt_failed_create
                     io_console         = out ).

    "mapped links the %cid to the (framework- or consumer-set) key
    LOOP AT lt_mapped_create-root ASSIGNING FIELD-SYMBOL(<fs_mapped_instance>).
      out->write( |Created: %cid { <fs_mapped_instance>-%cid } | &&
                  |-> key { <fs_mapped_instance>-key_field }| ).
    ENDLOOP.

    "---------------------------------------------------------------
    " 2) Combined request (long form): create + update via %cid_ref
    "    + deep create via CREATE BY \_child and %target
    "    + action execution in the same request
    "---------------------------------------------------------------
    MODIFY ENTITIES OF zdemo_abap_rap_ro_m
      ENTITY root
        CREATE FIELDS ( key_field field1 field2 field3 field4 )
        WITH VALUE #( ( %cid      = 'create_2'
                        key_field = 2
                        field1    = 'ccc'
                        field2    = 'ddd'
                        field3    = 20
                        field4    = 21 ) )
        "Update the instance created above — its key may not be
        "known yet, so reference the content id instead
        UPDATE FIELDS ( field2 )
        WITH VALUE #( ( %cid_ref = 'create_2'
                        field2   = 'updated' ) )
        "Deep create: children below the new root instance
        CREATE BY \_child
        FIELDS ( key_ch field_ch1 field_ch2 )
        WITH VALUE #( ( %cid_ref = 'create_2'
                        %target  = VALUE #(
                          ( %cid      = 'child_1'
                            key_ch    = 2
                            field_ch1 = 'child one'
                            field_ch2 = 100 )
                          ( %cid      = 'child_2'
                            key_ch    = 3
                            field_ch1 = 'child two'
                            field_ch2 = 200 ) ) ) )
        "Execute an action on the new and on an existing instance
        EXECUTE multiply_by_2
        FROM VALUE #( ( %cid_ref  = 'create_2' )
                      ( key_field = 1 ) )
      MAPPED   DATA(lt_mapped_combined)
      FAILED   DATA(lt_failed_combined)
      REPORTED DATA(lt_reported_combined).

    evaluate_failed( it_failed_response = lt_failed_combined
                     io_console         = out ).

    "---------------------------------------------------------------
    " 3) READ — buffer state, including uncommitted changes.
    "    Unlisted fields would come back initial; use ALL FIELDS
    "    to fetch everything.
    "---------------------------------------------------------------
    READ ENTITIES OF zdemo_abap_rap_ro_m
      ENTITY root
      ALL FIELDS WITH VALUE #( ( key_field = 1 )
                               ( key_field = 2 ) )
      RESULT   DATA(lt_root_instances)
      FAILED   DATA(lt_failed_read)
      REPORTED DATA(lt_reported_read).

    LOOP AT lt_root_instances ASSIGNING FIELD-SYMBOL(<fs_root_instance>).
      out->write( |Buffered root { <fs_root_instance>-key_field }: | &&
                  |{ <fs_root_instance>-field1 } / { <fs_root_instance>-field2 }| ).
    ENDLOOP.

    "Read by association: parent -> child, with source/target links
    READ ENTITIES OF zdemo_abap_rap_ro_m
      ENTITY root
      BY \_child
      ALL FIELDS WITH VALUE #( ( key_field = 2 ) )
      RESULT DATA(lt_child_instances)
      LINK   DATA(lt_child_links).

    out->write( |Children read via \\_child: { lines( lt_child_instances ) }| ).

    "---------------------------------------------------------------
    " 4) COMMIT — nothing is persisted before this point.
    "    RESPONSE OF returns per-BO failures; sy-subrc:
    "    0 = saved, 4 = early save phase failed (may continue),
    "    8 = late save phase failed (ROLLBACK ENTITIES required).
    "---------------------------------------------------------------
    COMMIT ENTITIES RESPONSE OF zdemo_abap_rap_ro_m
      FAILED   DATA(lt_failed_commit)
      REPORTED DATA(lt_reported_commit).

    IF sy-subrc = 0.
      out->write( `Commit successful — instances persisted.` ).
    ELSE.
      out->write( |Commit failed, sy-subrc = { sy-subrc }.| ).
      evaluate_failed( it_failed_response = lt_failed_commit
                       io_console         = out ).
      "Clear the transactional buffer before continuing
      ROLLBACK ENTITIES.
    ENDIF.

    "---------------------------------------------------------------
    " 5) Simulation: run only the early save phase, persist nothing.
    "    Useful as a consistency dry run; clean up afterwards.
    "---------------------------------------------------------------
    MODIFY ENTITY zdemo_abap_rap_ro_m
      CREATE AUTO FILL CID
      FIELDS ( key_field )
      WITH VALUE #( ( key_field = 100 ) )
      MAPPED   DATA(lt_mapped_simulation)
      FAILED   DATA(lt_failed_simulation)
      REPORTED DATA(lt_reported_simulation).

    COMMIT ENTITIES IN SIMULATION MODE.

    IF sy-subrc = 0.
      out->write( `Simulation passed — transaction would be consistent.` ).
    ELSE.
      out->write( `Simulation failed — transaction is inconsistent.` ).
    ENDIF.

    "Simulation leaves the buffer filled: discard explicitly
    ROLLBACK ENTITIES.

  ENDMETHOD.


  METHOD evaluate_failed.
    "failed rows identify the instance (%tky / %cid) and carry
    "%fail-cause plus %op flags telling which operation failed.
    LOOP AT it_failed_response-root ASSIGNING FIELD-SYMBOL(<fs_failed_root>).
      DATA(lv_operation_kind) = COND string(
        WHEN <fs_failed_root>-%op-%create = if_abap_behv=>mk-on THEN `create`
        WHEN <fs_failed_root>-%op-%update = if_abap_behv=>mk-on THEN `update`
        WHEN <fs_failed_root>-%op-%delete = if_abap_behv=>mk-on THEN `delete`
        ELSE `other` ).

      io_console->write( |Failed { lv_operation_kind } for key | &&
                      |{ <fs_failed_root>-key_field }, cause: | &&
                      |{ <fs_failed_root>-%fail-cause }| ).
      "Causes: if_abap_behv=>cause-unspecific / not_found /
      "        locked / dependency / ...
    ENDLOOP.

    LOOP AT it_failed_response-child ASSIGNING FIELD-SYMBOL(<fs_failed_child>).
      io_console->write( |Failed child operation, cause: | &&
                      |{ <fs_failed_child>-%fail-cause }| ).
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
