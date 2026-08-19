---
name: abap-xco-library
description: Use when working with the XCO (Extension Components) library in ABAP Cloud — "read an XLSX in ABAP", "parse an uploaded Excel file", "xco_cp_xlsx", "write an XLSX from an internal table", "generate a class from code", "xco generation API", "xco_cp_generation", "generate a database table / CDS view / behavior definition programmatically", "RAP BO generation", "attach to transport xco_cp_cts", "create and release a transport request in code", "xco_cp=>sy" (current date, time, moment, user, language in ABAP Cloud), "XCO time library" / "xco_cp_time", UUID format conversion ("xco_cp_uuid"), string helpers ("xco_cp=>string", split/join/camelCase), Base64 ("xco_cp_binary"), hash values ("xco_cp_hash"), XCO regular-expression engines, querying the ABAP Repository for objects ("xco_cp_abap_repository"), reading DDIC object metadata via XCO Read APIs, application logs ("xco_cp_bal"), or tenant / namespace / system information in the SAP BTP ABAP environment.
---

# XCO Library (Extension Components) for ABAP Cloud

## Overview

The **XCO ("Extension Components") library** is SAP's general-purpose development library for ABAP, "aimed at providing a highly efficient ABAP development experience". Its **Cloud Platform (CP) edition** is designed for the SAP BTP ABAP environment and is a released API for ABAP for Cloud Development — in ABAP Cloud it is frequently *the* replacement for classic idioms (`sy-datum`, `WRITE`, manual transport handling, DDIC maintenance in SE11). Which facade methods a given module actually exposes depends on the target release, though — check ADT's released API browser rather than assuming a class/method exists, and see "When to Use XCO vs Alternatives" below for the direct fallback when a field isn't covered yet.

Three design principles govern everything (per the docs' *Core Principles* page):

1. **Modules with one API class each.** XCO is a collection of largely independent modules; the public API of each module is a single entry class starting with `XCO_CP_` (e.g. `XCO_CP_TIME`, `XCO_CP_XLSX`, `XCO_CP_GENERATION`). Start typing the API class in ADT and let code completion reveal the module's scope.
2. **Enumerated values as pre-created objects.** Fixed values (formats, time zones, statuses, colors…) are objects reached through the API class, e.g. `xco_cp_time=>format->iso_8601_extended`, `xco_cp_transport=>status->modifiable` — strongly typed, with the primitive value accessible via `->value`.
3. **NO_CHECK exceptions.** Unless the caller can realistically recover, errors surface as no-check exceptions derived from `CX_XCO_RUNTIME_EXCEPTION`, which captures the call stack at raise time. You normally do *not* wrap XCO calls in `TRY` — the exceptions that matter for recovery are documented per API (e.g. `CX_XCO_GEN_PUT_EXCEPTION` for generation).

**A word of caution when generating XCO code:** the fluent chains are long and easy to hallucinate. Every chain in this skill is copied verbatim from the SAP documentation or the SAP-samples cheat sheets cited under References. If a method is not shown there, verify it via ADT code completion before shipping — do not guess.

## Workflow: Which XCO Module for Which Job

| Job | Entry point |
|---|---|
| Current date/time/moment/user/language (`sy` replacement) | `xco_cp=>sy` (+ `xco_cp_time` for formats/time zones) |
| Date/time arithmetic, formats, UNIX timestamps | `xco_cp_time` |
| String substring/split/join/case/camelCase/hash | `xco_cp=>string( … )`, `xco_cp_string`, `xco_cp_hash` |
| Generate a UUID / convert UUID formats | `xco_cp=>uuid( )`, `xco_cp_uuid` |
| Base64, code-page string↔xstring conversion | `xco_cp=>xstring( … )`, `xco_cp_binary`, `xco_cp_character` |
| JSON build/parse (one-liner here; depth elsewhere) | `xco_cp_json` — see [abap-xml-json](../abap-xml-json/SKILL.md) |
| Regular expressions with an explicit engine | `xco_cp_regular_expression=>engine` |
| Read/write `.xlsx` workbooks | `xco_cp_xlsx`, `xco_cp_xlsx_selection`, `xco_cp_xlsx_read_access`, `xco_cp_xlsx_write_access` |
| Find repository objects by filters (query) | `xco_cp_abap_repository=>objects` |
| Read content of DDIC/repository objects | XCO Read APIs, e.g. `xco_cp_abap_dictionary=>database_table( … )` |
| Create/update/delete repository objects from code | `xco_cp_generation` (environment → PUT/POST/PATCH/DELETE) |
| Create/release/query transports | `xco_cp_cts`, `xco_cp_transport` |
| Application log (BAL) | `xco_cp_bal` |
| Tenant URL / global account / subaccount, namespaces | `xco_cp=>current->tenant( )`, `xco_cp_system` |
| Console output with rich object printing | `cl_xco_cp_adt_simple_classrun` (extends `IF_OO_ADT_CLASSRUN`) |

## Module Map

The CP edition comprises ~50 modules (full list on the *Overview of XCO Modules* page). Grouped by purpose:

| Group | Modules (API classes) |
|---|---|
| Standard library | `XCO_CP` (central entry: `=>string`, `=>strings`, `=>xstring`, `=>sy`, `=>uuid`, `=>current`), `XCO_CP_STRING`, `XCO_CP_TIME`, `XCO_CP_UUID`, `XCO_CP_JSON`, `XCO_CP_BINARY`, `XCO_CP_CHARACTER`, `XCO_CP_HASH`, `XCO_CP_REGULAR_EXPRESSION`, `XCO_CP_LANGUAGE`, `XCO_CP_MESSAGE`, `XCO_CP_CALL_STACK`, `XCO_CP_TENANT`, `XCO_CP_SYSTEM`, `XCO_CP_BAL` |
| ABAP Repository & metadata | `XCO_CP_ABAP` (classes/interfaces, built-in types), `XCO_CP_ABAP_REPOSITORY` (query APIs), `XCO_CP_ABAP_DICTIONARY` (tables, data elements, structures, table types, domains), `XCO_CP_ABAP_OBJECTS`, `XCO_CP_ABAP_SQL` (filter constraints), `XCO_CP_CDS`, `XCO_CP_DATABASE_TABLE`, `XCO_CP_DATA_ELEMENT`, `XCO_CP_DOMAIN`, `XCO_CP_TABLE`, `XCO_CP_TABLE_TYPE`, `XCO_CP_FUNCTION_GROUP`, `XCO_CP_FUNCTION_MODULE`, `XCO_CP_MESSAGE_CLASS`, `XCO_CP_SERVICE_BINDING`, `XCO_CP_SERVICE_DEFINITION`, `XCO_CP_SERVICE_CONS_MODEL`, `XCO_CP_EVENT_BINDING`, `XCO_CP_SAP_OBJECT_TYPE`, `XCO_CP_SAP_OBJECT_NODE_TYPE`, `XCO_CP_ARS` (API release states) |
| Generation | `XCO_CP_GENERATION` (environments + operations), `XCO_CP_DDL` / `XCO_CP_DCL` / `XCO_CP_CDS_ANNOTATION` (expression/annotation builders), `XCO_CP_NAME` (name choices for POST), `XCO_CP_BEHAVIOR_DEFINITION`, `XCO_CP_METADATA_EXTENSION`, `XCO_CP_I18N` (language-dependent texts) |
| Transport | `XCO_CP_CTS` (create/release/locate), `XCO_CP_TRANSPORT` (enumerations, filters, entries) |
| XLSX | `XCO_CP_XLSX`, `XCO_CP_XLSX_SELECTION`, `XCO_CP_XLSX_READ_ACCESS`, `XCO_CP_XLSX_WRITE_ACCESS` |
| Other | `XCO_CP_RAP` (wrap RAP behavior messages as `IF_XCO_NEWS`), `XCO_CP_ABAP_UNIT`, `XCO_CP_AMDP`, `XCO_CP_APPLICATION_LOG_OBJECT`, `XCO_CP_BUSINESS_CNFGRTN_OBJECT`, `XCO_CP_IAM`, `XCO_CP_PACKAGE`, `XCO_CP_SOFTWARE_COMPONENT` |

Two cross-module abstractions glue everything together: `IF_XCO_NEWS` (an object that is a source of messages) and `IF_XCO_TEXT` (a source of strings). `IF_XCO_PRINTABLE` builds on `IF_XCO_TEXT` so any object can define its console print form.

## Standard Library Essentials

### The SY abstraction and the time library

`xco_cp=>sy` replaces the forbidden classic system fields in ABAP Cloud. Which XCO facade methods exist depends on the target release; check the released API browser (ADT) rather than assuming a class exists. `cl_abap_context_info` remains the direct alternative for the specific fields XCO doesn't cover in older releases. The time library models a **date** (`IF_XCO_CP_TM_DATE` — year/month/day), a **time** (hour/minute/second), a **moment** (full date+time) and a **UNIX timestamp** (INT8 seconds since 1970-01-01 UTC). All are **immutable**; time-zone information is deliberately *not* part of their state — you choose the zone when you obtain them:

```abap
" The current moment in the time zone of the active user.
DATA(lo_moment_user) = xco_cp=>sy->moment( xco_cp_time=>time_zone->user ).

" The current moment in UTC.
DATA(lo_moment_utc) = xco_cp=>sy->moment( xco_cp_time=>time_zone->utc ).

" The current UNIX timestamp (always UTC).
DATA(lo_unix_timestamp) = xco_cp=>sy->unix_timestamp( ).
```

If you omit the time zone, **the active user's time zone is taken**. Formats (`abap`, `iso_8601_basic`, `iso_8601_extended`) convert to and from strings:

```abap
DATA(today) = xco_cp=>sy->date( xco_cp_time=>time_zone->user
  )->as( xco_cp_time=>format->iso_8601_extended )->value.

" Parse back: string -> moment object.
DATA(lo_restored_moment) = xco_cp_time=>format->iso_8601_extended->to_moment( '2020-09-16T22:33:49' ).
```

Construct values directly with `xco_cp_time=>date( iv_year = … iv_month = … iv_day = … )`, `xco_cp_time=>time( … )`, `xco_cp_time=>moment( … )`. Derive new objects with `->add( … )` / `->subtract( … )` (`iv_day/iv_month/iv_year`, `iv_hour/iv_minute/iv_second`); component access via `->year/->month/->day/->hour/->minute/->second`. For month-end arithmetic the cheat sheets show an `io_calculation` parameter (`xco_cp_time=>date_calculation->preserving` vs `->ultimo`). UNIX timestamps round-trip with `lo_unix_timestamp->get_moment( xco_cp_time=>time_zone->user )` and `lo_moment->get_unix_timestamp( … )`.

Beyond time, `xco_cp=>sy` also exposes (per cheat sheet 22): `xco_cp=>sy->user( )->name`, `xco_cp=>sy->language( )->value` (plus `->get_name( )` and `->as( xco_cp_language=>format->iso_639 )`), and `xco_cp=>sy->message( )` for the current `sy-msg*` fields.

### Strings

`xco_cp=>string( … )` wraps a string in a fluent object:

- **Substrings** — `->from( n )` / `->to( n )`, 1-based and *inclusive*; negative indexes count from the end (`xco_cp=>string( |ABCDEF| )->from( 4 )->value` = `DEF`, `->to( -4 )->value` = `ABC`). Out-of-bounds indexes clamp to the first/last character.
- **Split/join/reverse** — `xco_cp=>string( |John Doe| )->split( | | )` then `->reverse( )->join( |, | )->value` = `Doe, John`. A ready string table enters via `xco_cp=>strings( str_table )`.
- **Compositions** — translate underscore to camelCase and back:

```abap
" LV_STRING_IN_CAMEL_CASE = firstName
DATA(lv_string_in_camel_case) = xco_cp=>string( 'FIRST_NAME'
  )->split( |_|
  )->compose( xco_cp_string=>composition->camel_case
  )->value.

" Back: firstName -> FIRST_NAME
DATA(lv_restored_string) = xco_cp=>string( lv_string_in_camel_case
  )->decompose( xco_cp_string=>decomposition->camel_case
  )->join( |_|
  )->to_upper_case(
  )->value.
```

- **Case** — `->to_upper_case( )` / `->to_lower_case( )`.
- **To xstring** — `xco_cp=>string( lv_string )->as_xstring( xco_cp_character=>code_page->utf_8 )`.
- **Hash** — a hash algorithm acts as a string→xstring conversion: `xco_cp=>string( 'MY_STRING' )->as_xstring( xco_cp_hash=>algorithm->sha_1 )->value` (SHA-1 statically; others via `xco_cp_hash=>algorithm->for( 'MD5' )`).
- **Regex** — `->matches( '^a.*C$' )` and `->grep( '^(\S+)\s+(\S+)$' )` (returns the submatch table `->value`); pass an engine built by `xco_cp_regular_expression=>engine->posix( … ) / ->pcre( … ) / ->xpath2( … ) / ->xsd( … )` via `io_engine`. Default is POSIX in `CL_ABAP_REGEX`'s default configuration.

### XStrings, Base64 and code pages

```abap
" Binary -> Base64 text.
DATA(lv_base64_encoding) = xco_cp=>xstring( lv_xstring
  )->as_string( xco_cp_binary=>text_encoding->base64
  )->value.

" Base64 text -> binary.
DATA(lv_original_xstring) = xco_cp=>string( lv_base64_encoding
  )->as_xstring( xco_cp_binary=>text_encoding->base64
  )->value.

" Binary -> readable string via code page.
DATA(lv_string) = xco_cp=>xstring( lv_xstring
  )->as_string( xco_cp_character=>code_page->utf_8
  )->value.
```

### UUIDs

```abap
DATA(lo_uuid) = xco_cp_uuid=>format->c36->to_uuid( '7cd44fff-036a-4155-b0d2-f5a4dfbcee92' ).

" LV_UUID_C32 will hold the value 7CD44FFF036A4155B0D2F5A4DFBCEE92
DATA(lv_uuid_c32) =  CONV sysuuid_c32( xco_cp_uuid=>format->c32->from_uuid( lo_uuid ) ).
```

Generating a *new* UUID is shown in cheat sheet 22: `xco_cp=>uuid( )->value` (X16 raw) or `xco_cp=>uuid( )->as( xco_cp_uuid=>format->c22/c32/c36 )->value`.

### System environment, tenant, console

- **Namespaces**: `xco_cp_system=>namespace->for( '/ABC/' )` then `->exists( )` and `->is_changeable( )` (check existence first — otherwise a runtime exception).
- **Tenant**: `xco_cp=>current->tenant( )` (may return an initial reference!), then `->get_url( xco_cp_tenant=>url_type->ui )` with `->get_protocol( ) / ->get_host( ) / ->get_port( )`, `->get_global_account_id( )->as_string( )`, `->get_subaccount_id( )->as_string( )`.
- **Console**: inherit from `cl_xco_cp_adt_simple_classrun` and redefine `main` — `out->write( )` prints deep structures JSON-style, prints any `IF_XCO_PRINTABLE`, and uncaught NO_CHECK exceptions are written with raise position, messages and stack trace.
- **Application log**: `xco_cp_bal=>for->database( )->log->create( iv_object = … iv_subobject = … iv_external_id = … )`, add via `->add_message( is_symsg )` / `->add_news( … )` / `->add_exception( … )`, read via `lo_log->messages->all->get( )`. Reading requires authorization object `S_APPL_LOG`.

## XLSX: Reading and Writing Excel Files

The top recurring cloud use case — *a user uploads an Excel file, parse it in ABAP* — is XCO's home turf, since classic options (OLE, `cl_gui_frontend_services`) do not exist in ABAP Cloud. Full walkthrough: [references/xlsx.md](references/xlsx.md); runnable Clean-ABAP class: [examples/xlsx-upload-parse.md](examples/xlsx-upload-parse.md).

The 60-second version — everything starts from the file content as an `XSTRING`:

```abap
DATA(lo_read_access) = xco_cp_xlsx=>document->for_file_content( lv_file_content
  )->read_access( ).

DATA(lo_worksheet) = lo_read_access->get_workbook(
  )->worksheet->at_position( 1 ).          " or ->worksheet->for_name( 'INVOICES' )
```

Then either **select + row stream** into an internal table (structure statically known):

```abap
lo_worksheet->select( lo_selection_pattern
  )->row_stream(
  )->operation->write_to( REF #( lt_rows )
  )->if_xco_xlsx_ra_operation~execute( ).
```

…or walk cell-by-cell with a **cursor** (`->cursor( io_column = … io_row = … )`, `->has_cell( )`, `->get_cell( )`, `->move_down( )` …), or use a **cell stream with a visitor** for fully dynamic layouts. Selection boundaries come from `xco_cp_xlsx_selection=>pattern_builder->simple_from_to( )` and may be left unbounded. **Value transformations** control typing (default *best effort*: converts dates to `D`, times to `T`, units via `CUNIT`, languages via `ISOLA`).

Writing mirrors reading: `xco_cp_xlsx=>document->empty( )->write_access( )`, fill via row-stream `write_from( REF #( lt_rows ) )` or cursor `->get_cell( )->value->write_from( … )`, style cells (`xco_cp_xlsx=>style->fill/font/alignment/border`), then ship `lo_write_access->get_file_content( )`.

**Security note (verbatim doc caution):** XCO returns the data exactly as stored in the file and performs **no validation** — sanitize uploaded content before persisting or displaying it.

## Generation APIs: Creating Repository Objects from Code

The XCO Generation APIs programmatically create, update and delete ABAP repository objects — 23 object types including `DOMA`, `DTEL`, `TABL`, `TTYP`, `CLAS`, `INTF`, `DDLS`, `DDLX`, `DCLS`, `BDEF`, `SRVD`, `SRVB`, `MSAG`, `FUGR`, `DEVC`, `XSLT`. Deep dive with the full operation matrix, error handling and the RAP BO worked example: [references/generation-apis.md](references/generation-apis.md); runnable table+class example: [examples/generate-table-and-class.md](examples/generate-table-and-class.md).

The model in brief:

1. **Environment** — everything happens inside a generation environment backed by a *modifiable* transport: `xco_cp_generation=>environment->dev_system( 'X08K123456' )`. All changes are recorded on that transport.
2. **Operations** — `PUT` (create or update; needs a package for new objects), `POST` (create with a *name choice*, `xco_cp_name=>choice->fixed( … )` — only FUGR and SCP1), `PATCH` (partial update — INSERT/UPDATE/MODIFY/DELETE parts), `DELETE`. One PUT can hold many objects of many types; they are **mass-activated together**, so circular dependencies are fine. Executing an operation always issues a `COMMIT WORK`.
3. **Specifications** — each object added to an operation gets a form-based specification (`->add_object( … )->set_package( … )->create_form_specification( )`), filled with type-specific setters.
4. **Conceptual abstractions** — shared vocabulary across object types, e.g. `xco_cp_abap_dictionary=>built_in_type->char( 10 )` works as domain format, data-element type and table-type row type alike.
5. **Templates** — prefill a specification from an existing object (`DOMA`, `DTEL`, `TABL`, `TTYP`, `DDLS`) to copy it.
6. **Errors** — `CX_XCO_GEN_PUT_EXCEPTION` (and POST/PATCH/DELETE siblings) carry per-object findings: `lx_put_exception->findings->for->ttyp`.

Minimal flavor (data element, verbatim from the docs):

```abap
DATA(lo_put_operation) = lo_environment->create_put_operation( ).

DATA(lo_specification) = lo_put_operation->for-dtel->add_object( 'ZDATA_ELEMENT'
  )->set_package( 'ZPACKAGE'
  )->create_form_specification( ).
lo_specification->set_short_description( 'My generated data element' ).
lo_specification->set_data_type( xco_cp_abap_dictionary=>built_in_type->char( 10 ) ).

lo_put_operation->execute( ).
```

The *RAP BO Generation* page shows a complete BO generated end to end — domain, data element, database table, interface + consumption CDS views, metadata extension, access control, behavior definition (managed, with mapping, standard operations and an action), behavior implementation class with a local handler, service definition — in **one** PUT operation, plus the service binding in a second one. See the deep dive.

## ABAP Repository: Query and Read APIs

**Query APIs** (`xco_cp_abap_repository=>objects`) retrieve objects by *object source* (package, transport, whole repository) and *object filters* built from `xco_cp_abap_sql=>constraint` (e.g. `->equal( … )`, `->contains_pattern( '%CAL%' )`). Visible objects are those released by SAP or belonging to customer software components:

```abap
DATA(lo_software_component_filter) = xco_cp_system=>software_component->get_filter( xco_cp_abap_sql=>constraint->equal( 'ZLOCAL' ) ).
DATA(lo_name_filter) = xco_cp_abap_repository=>object_name->get_filter( xco_cp_abap_sql=>constraint->contains_pattern( '%CAL%' ) ).

DATA(lt_objects) = xco_cp_abap_repository=>objects->where( VALUE #(
  ( lo_software_component_filter )
  ( lo_name_filter )
) )->in( xco_cp_abap=>repository )->get( ).
```

Type-specific queries return typed handles (`…objects->tabl->database_tables->where( … )->in( lo_package )->get( )` → `IF_XCO_DATABASE_TABLE`).

**Read APIs** model each object as a rooted tree of *object/part handles* (name only — `xco_cp_abap_dictionary=>database_table( 'ZMY_DBT' )->field( 'KEY_FIELD' )`) and *content handles* (`->content( )` with `GET_*` methods per attribute, or `->get( )` for everything). An optional **origin** decides *where* content is read from: default (read once per session, cached), local, or remote via RFC destination (remote currently only for classes/interfaces). Language-dependent attributes always come in the object's original language.

## CTS: Transports from Code

`xco_cp_cts` creates and releases Workbench and Customizing transports — the natural companion of the generation APIs ("completely self-contained generation programs"). Determine the target from a structure package, create, then release:

```abap
DATA(ls_package) = xco_cp_abap_repository=>package->for( 'ZMY_STRUCTURE_PACKAGE'
  )->read( ).
DATA(lv_transport_target) = ls_package-property-transport_layer->get_transport_target( )->value.

DATA(lo_transport_request) = xco_cp_cts=>transports->workbench( lv_transport_target
  )->create_request( 'My generated Workbench transport request' ).
```

Releasing: release each task with `xco_cp_transport=>status->modifiable` status via `lo_transport_task->release( )`, then `lo_transport_request->release( )` — optionally with `xco_cp_transport=>release_option->ignore_objects_check( )` to override non-critical ATC-style objections. `->protect( ) / ->unprotect( )` are available. Customizing requests: `xco_cp_cts=>transports->customizing( … )->create_request( … )`.

Query transports with filters (`xco_cp_transport=>filter->kind/owner/request_target/status/attribute`) and a *resolution* (`xco_cp_transport=>resolution->request` maps tasks to their requests; `->identity` keeps them). CTS integrates with the repository module: `xco_cp_abap_repository=>objects->doma->all->in( lo_transport )->get( )` lists domains on a transport, and `lo_domain->if_xco_cts_changeable~get_object( )->is_locked( )` / `->get_lock( )->get_transport( )` finds the lock. Transport entries (object entries, key entries, R3TR TABU) are read via `xco_cp_transport=>entries`.

## When to Use XCO vs Alternatives

- **JSON**: `xco_cp_json` handles build/parse with case transformations (`pascal_case_to_underscore`, `boolean_to_abap_bool`…) — but JSON/XML strategy, sXML and `/ui2/cl_json` comparisons live in [abap-xml-json](../abap-xml-json/SKILL.md). One line here: `xco_cp_json=>data->from_abap( ls_output )->to_string( )` and `xco_cp_json=>data->from_string( lv_json )->write_to( REF #( ls_input ) )`.
- **Date/time**: for plain timestamp arithmetic `CL_ABAP_TSTMP` / `utclong` built-ins may suffice; XCO shines for formatting (ISO 8601), time zones and immutable value objects. `cl_abap_context_info` is the lighter released alternative for "current date/user".
- **Released status & cloud restrictions**: which classes are released, and what replaces forbidden classics, is owned by [abap-cloud-development](../abap-cloud-development/SKILL.md) — XCO's release state itself is verified there (ADT API state / `i_apisforclouddevelopment`).
- **RTTS/dynamic programming**: XCO's ABAP module offers *conceptual* type abstractions for generation; for runtime type introspection use RTTS (`CL_ABAP_TYPEDESCR`) — see [abap-dynamic-programming](../abap-dynamic-programming/SKILL.md).
- **Classic ABAP systems**: XCO CP edition targets ABAP Cloud. On-premise releases ship XCO variants with differing scope — verify availability in your system before designing around it.

## Quick Reference

```abap
" Current date (user TZ, ISO 8601 extended) — the ABAP Cloud sy-datum substitute:
DATA(today) = xco_cp=>sy->date( xco_cp_time=>time_zone->user
  )->as( xco_cp_time=>format->iso_8601_extended )->value.

" Current user / language:
DATA(user) = xco_cp=>sy->user( )->name.
DATA(lang_iso_639) = xco_cp=>sy->language( )->as( xco_cp_language=>format->iso_639 ).

" New UUID as 32-char text:
DATA(c32_string) = xco_cp=>uuid( )->as( xco_cp_uuid=>format->c32 )->value.

" Split + join:
DATA(str_table) = xco_cp=>string( `Hello.World.ABAP` )->split( `.` )->value.
DATA(conc_str1) = xco_cp=>strings( str_table )->join( `, ` )->value.

" String -> xstring (UTF-8) and back:
DATA(xstr) = xco_cp=>string( `Some string` )->as_xstring( xco_cp_character=>code_page->utf_8 )->value.
DATA(str) = xco_cp=>xstring( xstr )->as_string( xco_cp_character=>code_page->utf_8 )->value.

" XLSX: xstring -> internal table (see references/xlsx.md for the full pattern):
DATA(lo_read_access) = xco_cp_xlsx=>document->for_file_content( lv_file_content )->read_access( ).

" XLSX: new document -> xstring:
DATA(lo_write_access) = xco_cp_xlsx=>document->empty( )->write_access( ).
DATA(lv_file_content) = lo_write_access->get_file_content( ).

" Generation environment on a modifiable transport:
DATA(lo_environment) = xco_cp_generation=>environment->dev_system( 'X08K123456' ).

" Create a Workbench transport:
DATA(lo_transport_request) = xco_cp_cts=>transports->workbench( lv_transport_target
  )->create_request( 'My generated Workbench transport request' ).
```

| Task | Chain (verbatim source) |
|---|---|
| Moment → string | `lo_moment->as( xco_cp_time=>format->iso_8601_extended )->value` |
| String → moment | `xco_cp_time=>format->iso_8601_extended->to_moment( lv_iso )` |
| Date arithmetic | `xco_cp=>sy->date( )->add( iv_day = 5 )` (cheat sheet 23) |
| Worksheet by name | `lo_read_access->get_workbook( )->worksheet->for_name( 'INVOICES' )` |
| Unbounded selection | `xco_cp_xlsx_selection=>pattern_builder->simple_from_to( )->get_pattern( )` |
| Cell value → variable | `lo_cell->get_value( )->set_transformation( xco_cp_xlsx_read_access=>value_transformation->string_value )->write_to( REF #( lv_string_value ) )` |
| PUT with options | `lo_put_operation->execute( VALUE #( ( xco_cp_generation=>put_operation_option->skip_activation ) ) )` |
| Copy a domain | `xco_cp_generation_doma=>template->for_domain( iv_name = … io_read_state = xco_cp_abap_dictionary=>object_read_state->active_version )` |
| Objects on a transport | `xco_cp_abap_repository=>objects->doma->all->in( lo_transport )->get( )` |

## Common Mistakes

| Mistake | Cost | Fix |
|---|---|---|
| Inventing fluent chains from memory | Syntax errors, silent wrong behavior | Copy chains from the cited docs/cheat sheets; verify unknowns with ADT code completion |
| Wrapping every XCO call in TRY…CATCH of `cx_root` | Noise; hides real bugs | XCO uses NO_CHECK `CX_XCO_RUNTIME_EXCEPTION` by design; catch only documented recoverables (e.g. `cx_xco_gen_put_exception`) |
| Reading XLSX numbers into packed (`TYPE p`) fields | Wrong conversions | Doc note: use `decfloat` built-in types for floating point |
| Trusting uploaded XLSX content | Injection/malicious payloads reach DB or UI | XCO performs no validation — sanitize before persisting/displaying (doc caution) |
| Updating an arbitrary hand-made XLSX via write access | Undefined behavior, lost formatting | Write-update only files created by (or fully compatible with) the XCO Write APIs |
| Generation environment on a released transport | Operation fails | The backing transport must be in status Modifiable |
| Forgetting the package on a PUT object | Fails for new objects | `->set_package( … )` is required whenever the object might not exist yet |
| Deleting generation objects in one bulk without order | Dependency errors | DELETE operations are per type; caller must order them (e.g. data element before its domain) |
| Assuming `xco_cp=>sy->date( )` is UTC | Off-by-one dates near midnight | Default is the *user's* time zone; pass `xco_cp_time=>time_zone->utc` explicitly |
| Assuming `xco_cp=>current->tenant( )` always exists | Null-reference dump | Docs: depending on infrastructure it may return an initial reference — check before use |
| Using XCO XLSX cell streams for fixed-layout files | Needless visitor boilerplate | Row stream + `write_to( REF #( itab ) )` when the structure is statically known |

## References

- [references/xlsx.md](references/xlsx.md) — XLSX read + write access in depth (document handles, coordinates, selection patterns, streams, cursor, value transformations, styling).
- [references/generation-apis.md](references/generation-apis.md) — generation environment, PUT/POST/PATCH/DELETE, specifications, templates, error handling, RAP BO generation walkthrough.
- [examples/xlsx-upload-parse.md](examples/xlsx-upload-parse.md) — Clean-ABAP class: parse an uploaded Excel into an internal table.
- [examples/generate-table-and-class.md](examples/generate-table-and-class.md) — Clean-ABAP class: generate a database table + class on a transport.
- **XCO Library (root):** https://help.sap.com/docs/btp/sap-business-technology-platform/xco-library?version=Cloud — mirror: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/xco-library-c154dff.md
- **Core Principles:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/core-principles-67dff4d.md
- **Overview of XCO Modules:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/overview-of-xco-modules-25bfca8.md
- **Standard Library:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/standard-library-b5ceba7.md — subpages: [String](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/string-063ad16.md), [Time Library](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/time-library-6213705.md), [UUID](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/uuid-ceb1a4e.md), [JSON](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/json-492ccdb.md), [Regular Expression](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/regular-expression-4c0585e.md), [XString](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/xstring-0c7aa66.md), [System](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/system-255b436.md), [Tenant](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/tenant-bbb4dc2.md), [ADT](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/adt-0bf9b10.md), [BAL](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/business-application-log-238dc17.md), [Call Stack](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/call-stack-005c12d.md)
- **XLSX:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/xlsx-9b7a0d1.md — [Read Access](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/xlsx-read-access-5359a35.md), [Write Access](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/xlsx-write-access-8dddce9.md)
- **Generation APIs:** https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/generation-apis-02bfcde.md — [Design](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/design-of-the-xco-generation-apis-d01859f.md), [RAP BO Generation](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/rap-bo-generation-65a7efb.md), [Error Handling](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/generation-error-handling-772eee2.md)
- **ABAP Repository:** [Query APIs](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/query-apis-5a2cd69.md), [Read APIs](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/read-apis-7545316.md)
- **CTS:** [Correction and Transport System](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/correction-and-transport-system-1d7ea1c.md), [Transport Read APIs](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/transport-read-apis-20f5c62.md)
- **Cheat sheets (SAP-samples):** [22 — Released ABAP Classes](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/22_Released_ABAP_Classes.md) (XCO_CP sy/UUID/string/JSON snippets), [23 — Date and Time](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/23_Date_and_Time.md) (XCO_CP_TIME date/time/moment arithmetic)
- Linked skills: [abap-cloud-development](../abap-cloud-development/SKILL.md) (released APIs, cloud restrictions), [abap-xml-json](../abap-xml-json/SKILL.md) (xco_cp_json depth), [abap-dictionary-ddic](../abap-dictionary-ddic/SKILL.md), [rap-bo-modeling](../rap-bo-modeling/SKILL.md), [abap-dynamic-programming](../abap-dynamic-programming/SKILL.md)
