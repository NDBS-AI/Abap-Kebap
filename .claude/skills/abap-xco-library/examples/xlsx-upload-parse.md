# Example: Parse an Uploaded Excel File in ABAP Cloud

The top recurring XCO use case: a user uploads an `.xlsx` file (arriving in ABAP as an `XSTRING`), and the content must land in an internal table for validation and persistence.

The class below is Clean-ABAP-styled (descriptive names, no Hungarian prefixes); every XCO method chain is taken verbatim from the XLSX Read Access documentation (see Sources). Create it in ADT, activate, and run with F9. It builds a small workbook in memory first (via the documented Write APIs) so the example is self-contained — in real code, `file_content` comes from your upload channel (e.g. a RAP entity field or HTTP body), not from XCO.

```abap
CLASS zcl_demo_xlsx_upload_parse DEFINITION
  PUBLIC FINAL CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.

    TYPES:
      "! One worksheet row: columns A, B, C below the header.
      "! Elementary components only (row-stream requirement);
      "! dates as D so the default best-effort transformation converts them.
      BEGIN OF invoice_line,
        document_number TYPE string,
        posting_date    TYPE d,
        note            TYPE string,
      END OF invoice_line,
      invoice_lines TYPE STANDARD TABLE OF invoice_line WITH EMPTY KEY.

    METHODS parse_invoice_sheet
      IMPORTING file_content  TYPE xstring
      RETURNING VALUE(result) TYPE invoice_lines.

  PRIVATE SECTION.
    METHODS build_demo_file
      RETURNING VALUE(result) TYPE xstring.
ENDCLASS.


CLASS zcl_demo_xlsx_upload_parse IMPLEMENTATION.

  METHOD if_oo_adt_classrun~main.
    " In a real application the xstring arrives from the upload channel.
    DATA(file_content) = build_demo_file( ).

    DATA(parsed_lines) = parse_invoice_sheet( file_content ).

    " CAUTION (from the SAP docs): XCO returns the data exactly as stored in
    " the file and performs no validation. Validate every row here before
    " persisting or displaying it.
    out->write( parsed_lines ).
  ENDMETHOD.

  METHOD parse_invoice_sheet.
    " 1. Document handle from the raw file content, then read access.
    DATA(worksheet) = xco_cp_xlsx=>document->for_file_content( file_content
      )->read_access(
      )->get_workbook(
      )->worksheet->at_position( 1 ).

    " 2. Selection: columns A to C, from row 2 (skip the header row),
    "    unbounded at the bottom.
    DATA(selection_pattern) = xco_cp_xlsx_selection=>pattern_builder->simple_from_to(
      )->from_column( xco_cp_xlsx=>coordinate->for_alphabetic_value( 'A' )
      )->to_column( xco_cp_xlsx=>coordinate->for_alphabetic_value( 'C' )
      )->from_row( xco_cp_xlsx=>coordinate->for_numeric_value( 2 )
      )->get_pattern( ).

    " 3. Row stream into the internal table. The default best-effort value
    "    transformation converts the POSTING_DATE cell into the D field.
    worksheet->select( selection_pattern
      )->row_stream(
      )->operation->write_to( REF #( result )
      )->if_xco_xlsx_ra_operation~execute( ).
  ENDMETHOD.

  METHOD build_demo_file.
    " Demo scaffolding only: create a workbook with a header row and two
    " data rows using the documented Write APIs, so main( ) has a file
    " to parse without external input.
    DATA(write_access) = xco_cp_xlsx=>document->empty( )->write_access( ).
    DATA(worksheet) = write_access->get_workbook(
      )->worksheet->at_position( 1 ).

    TYPES:
      BEGIN OF file_row,
        document_number TYPE string,
        posting_date    TYPE d,
        note            TYPE string,
      END OF file_row,
      file_rows TYPE STANDARD TABLE OF file_row WITH DEFAULT KEY.

    " Header written as plain strings via the cursor.
    DATA(cursor) = worksheet->cursor(
      io_column = xco_cp_xlsx=>coordinate->for_alphabetic_value( 'A' )
      io_row    = xco_cp_xlsx=>coordinate->for_numeric_value( 1 )
    ).
    cursor->get_cell( )->value->write_from( 'Document' ).
    cursor->move_right( )->get_cell( )->value->write_from( 'Posting date' ).
    cursor->move_right( )->get_cell( )->value->write_from( 'Note' ).

    " Data rows via a row stream starting at row 2.
    DATA(data_rows) = VALUE file_rows(
      ( document_number = `9000000001` posting_date = '20260801' note = `First upload row` )
      ( document_number = `9000000002` posting_date = '20260802' note = `Second upload row` ) ).

    DATA(data_pattern) = xco_cp_xlsx_selection=>pattern_builder->simple_from_to(
      )->from_column( xco_cp_xlsx=>coordinate->for_alphabetic_value( 'A' )
      )->from_row( xco_cp_xlsx=>coordinate->for_numeric_value( 2 )
      )->get_pattern( ).

    worksheet->select( data_pattern
      )->row_stream(
      )->operation->write_from( REF #( data_rows )
      )->execute( ).

    result = write_access->get_file_content( ).
  ENDMETHOD.

ENDCLASS.
```

## Points Worth Copying

- **Skip the header with the selection, not with post-processing:** `from_row( … 2 )` and no `to_row` gives "everything below the header".
- **Elementary components only** in the row-structure; use `D` for dates and `decfloat34` for floating-point amounts (the docs explicitly warn against packed numbers with the identity transformation).
- **Read side executes via `->if_xco_xlsx_ra_operation~execute( )`; write side via plain `->execute( )`** — both verbatim from the docs; do not "normalize" them.
- If a cell's type is unpredictable, read it with the *string value* transformation into a `STRING` field and convert yourself:
  `cell->get_value( )->set_transformation( xco_cp_xlsx_read_access=>value_transformation->string_value )->write_to( REF #( text_value ) )`.
- Empty trailing rows: with an unbounded selection the stream ends at the last stored row; rows that exist but are empty arrive as initial lines — filter them during validation.

## Sources

- XLSX Read Access: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/xlsx-read-access-5359a35.md
- XLSX Write Access: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/xlsx-write-access-8dddce9.md
- XLSX module root (coordinates, selection patterns): https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/xlsx-9b7a0d1.md
