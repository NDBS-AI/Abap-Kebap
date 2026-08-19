# XCO XLSX In Depth — Reading and Writing Excel Files in ABAP Cloud

All code chains below are verbatim from the SAP BTP documentation pages cited at the bottom. Anything the docs do not show is marked as such.

## The Four API Classes

| API class | Purpose |
|---|---|
| `XCO_CP_XLSX` | General abstractions: document handles, coordinates, styles, colors, fonts, data-validation types |
| `XCO_CP_XLSX_SELECTION` | Selection **pattern builders** |
| `XCO_CP_XLSX_READ_ACCESS` | Read-side abstractions, notably read **value transformations** |
| `XCO_CP_XLSX_WRITE_ACCESS` | Write-side abstractions, notably write **value transformations** |

## Document Handles

Everything starts from a document handle. For reading an existing file, the complete file content must be available as an `XSTRING`:

```abap
DATA lv_file_content TYPE xstring.

" LV_FILE_CONTENT must be populated with the complete file content of the .XLSX file
" whose content shall be processed programmatically.

DATA(lo_document) = xco_cp_xlsx=>document->for_file_content( lv_file_content ).
```

How the xstring arrives is outside XCO's scope — typical ABAP Cloud sources are a RAP action/entity field holding the uploaded file, or an HTTP endpoint receiving the binary body. (Not part of the XCO docs; wire it per your app's upload channel.)

From the document handle:

- `->read_access( )` — for reading cell content
- `->write_access( )` — for writing (also valid on `for_file_content` to update an existing document, with restrictions below)

A brand-new document:

```abap
DATA(lo_write_access) = xco_cp_xlsx=>document->empty( )->write_access( ).
```

An empty document contains one worksheet named `Sheet1`.

**Update caution (verbatim gist from the docs):** write access may update existing XLSX documents only if the original was created by the XCO XLSX Write APIs, or is fully compatible with their feature scope. Otherwise the behavior of the update operation is *undefined* — formatting or functionality may be altered, impaired or lost.

## Worksheet Access

```abap
" Read access for the worksheet at position 1, such as the first worksheet in the workbook.
DATA(lo_first_worksheet) = lo_read_access->get_workbook(
  )->worksheet->at_position( 1 ).

" Read access for the worksheet with name INVOICES.
DATA(lo_invoices_worksheet) = lo_read_access->get_workbook(
  )->worksheet->for_name( 'INVOICES' ).
```

On the write side, adding a sheet:

```abap
DATA(lo_worksheet) = lo_write_access->get_workbook(
  )->add_new_sheet( ).
```

(`iv_name` is an optional parameter for the sheet name.)

## Coordinates

A worksheet is a two-dimensional space: dimension 1 = column, dimension 2 = row. A coordinate (`CL_XCO_XLSX_COORDINATE`) fixes a value for one dimension. Both Excel-style alphabetic values (A, B, … Z, AA, AB, …) and numeric values (1, 2, 3, …) are accepted and interchangeable:

```abap
DATA(lo_coordinate_1) = xco_cp_xlsx=>coordinate->for_alphabetic_value( 'AA' ).

" LV_COORD_1_NUMERIC_VALUE will be an integer with value 27.
DATA(lv_coord_1_numeric_value) = lo_coordinate_1->get_numeric_value( ).

DATA(lo_coordinate_2) = xco_cp_xlsx=>coordinate->for_numeric_value( 27 ).

" LV_COORD_2_ALPHABETIC_VALUE will be a string with value AA.
DATA(lv_coord_2_alphabetic_value) = lo_coordinate_2->get_alphabetic_value( ).
```

New coordinates can be derived from existing ones with the `SHIFT` method (increment/decrement by a signed offset).

## Selection Patterns

A **selection** identifies the set of cells to process; it is built from a **selection pattern**. Builders live at `XCO_CP_XLSX_SELECTION=>PATTERN_BUILDER`. The documented pattern is *simple from-to*: static boundary values per dimension, each boundary optional — so bounded and unbounded selections are possible:

```abap
" Bounded rectangle C3:D4.
DATA(lo_pattern_1) = xco_cp_xlsx_selection=>pattern_builder->simple_from_to(
  )->from_column( xco_cp_xlsx=>coordinate->for_alphabetic_value( 'C' )
  )->to_column( xco_cp_xlsx=>coordinate->for_alphabetic_value( 'D' )
  )->from_row( xco_cp_xlsx=>coordinate->for_numeric_value( 3 )
  )->to_row( xco_cp_xlsx=>coordinate->for_numeric_value( 4 )
  )->get_pattern( ).

" Unbounded at the bottom (typical for "all data rows below the header"):
DATA(lo_pattern_2) = xco_cp_xlsx_selection=>pattern_builder->simple_from_to(
  )->from_column( xco_cp_xlsx=>coordinate->for_alphabetic_value( 'C' )
  )->to_column( xco_cp_xlsx=>coordinate->for_alphabetic_value( 'D' )
  )->from_row( xco_cp_xlsx=>coordinate->for_numeric_value( 3 )
  )->get_pattern( ).

" Completely unbounded — every cell of the worksheet:
DATA(lo_pattern_4) = xco_cp_xlsx_selection=>pattern_builder->simple_from_to(
  )->get_pattern( ).
```

## Reading

**Security caution (from the docs):** data is provided *exactly* as stored in the XLSX document — no security or other validations are performed. Before further processing (database, Fiori UI), guard against malicious content such as string cells containing JavaScript.

### Row streams — the fixed-layout workhorse

Use a row stream when the structure of the data is statically known. The primary use case per the docs: read a portion of a worksheet into an internal table.

```abap
" A selection pattern that was obtained via XCO_CP_XLSX_SELECTION=>PATTERN_BUILDER.
DATA lo_selection_pattern TYPE REF TO if_xco_xlsx_slc_pattern.

" The read access to the worksheet.
DATA lo_worksheet TYPE REF TO if_xco_xlsx_ra_worksheet.

" The type definition resembling the structure of the rows in the worksheet selection.
TYPES:
  BEGIN OF ts_row,
    first_name   TYPE string,
    last_name    TYPE string,
    day_of_birth TYPE d,
  END OF ts_row,

  tt_row TYPE STANDARD TABLE OF ts_row WITH DEFAULT KEY.

DATA lt_rows TYPE tt_row.

lo_worksheet->select( lo_selection_pattern
  )->row_stream(
  )->operation->write_to( REF #( lt_rows )
  )->if_xco_xlsx_ra_operation~execute( ).

" At this point, the internal table LT_ROWS will contain the rows from the worksheet
" selection.
```

Note the interface-qualified `->if_xco_xlsx_ra_operation~execute( )` on the read side — copy it as is.

### Cell streams — dynamic layouts via visitor

A cell stream traverses the selection one cell at a time (left→right, top→bottom) and hands each cell to your implementation of `IF_XCO_XLSX_RA_CS_VISITOR` (Visitor pattern):

```abap
lo_worksheet->select( lo_selection_pattern
  )->cell_stream(
  )->operation->visit( lo_visitor
  )->if_xco_xlsx_ra_operation~execute( ).
```

### Cursor — free navigation

`CURSOR` on `IF_XCO_XLSX_RA_WORKSHEET` positions on a cell and then moves freely:

- `MOVE_UP` / `MOVE_RIGHT` / `MOVE_DOWN` / `MOVE_LEFT` — relative movement by a number of steps
- `SET_COLUMN` / `SET_ROW` — absolute repositioning
- `HAS_CELL` / `GET_CELL` — existence check and access

Documented pattern — read column A from row 5 down until a missing cell or empty value:

```abap
DATA(lo_cursor) = lo_worksheet->cursor(
  io_column = xco_cp_xlsx=>coordinate->for_alphabetic_value( 'A' )
  io_row    = xco_cp_xlsx=>coordinate->for_numeric_value( 5 )
).

WHILE lo_cursor->has_cell( ) EQ abap_true
    AND lo_cursor->get_cell( )->has_value( ) EQ abap_true.
  DATA(lo_cell) = lo_cursor->get_cell( ).

  DATA(lv_string_value) = ``.
  lo_cell->get_value(
    )->set_transformation( xco_cp_xlsx_read_access=>value_transformation->string_value
    )->write_to( REF #( lv_string_value ) ).

  " Move the cursor down one row.
  lo_cursor->move_down( ).
ENDWHILE.
```

### Hyperlinks

With a cell handle (`IF_XCO_XLSX_RA_CELL`): `HAS_HYPERLINK`, `GET_HYPERLINK`; the hyperlink handle (`IF_XCO_XLSX_RA_HYPERLINK`) offers `GET_TARGET` and `GET_LOCATION`, both returned exactly as stored in the document.

### Read value transformations

Obtained via `XCO_CP_XLSX_READ_ACCESS=>VALUE_TRANSFORMATION`; set with `SET_VALUE_TRANSFORMATION` on `IF_XCO_XLSX_RA_CELL_VALUE` (single cell) or `IF_XCO_XLSX_RA_RS_OP_WRITE_TO` (row-stream write-to operation).

| Transformation | Behavior |
|---|---|
| Identity | No modification; the ABAP target must be fully compliant with the stored type/value, else runtime error. **Doc note: for floating-point numbers use `decfloat` built-ins, not packed (`TYPE p`)** |
| String value | Stringifies any cell — always safe into a `STRING` field |
| Best effort (default) | Like identity, plus conversions: cell → `D` interpreted as date; cell → `T` as time; fields typed `MSEHI` via conversion routine `CUNIT`; fields typed `SPRAS` via `ISOLA` |

## Writing

### Row streams (write side)

The internal table must contain only elementary components. Note the write side uses plain `->execute( )`:

```abap
lo_worksheet->select( lo_selection_pattern
  )->row_stream(
  )->operation->write_from( REF #( lt_rows )
  )->execute( ).
```

### Cursor (write side)

`IF_XCO_XLSX_WA_CURSOR` mirrors the read cursor (`MOVE_*`, `SET_COLUMN/SET_ROW`, `GET_CELL`). Documented example writing date/time labels and values:

```abap
DATA(lo_cursor) = lo_worksheet->cursor(
  io_column = xco_cp_xlsx=>coordinate->for_alphabetic_value( 'B' )
  io_row    = xco_cp_xlsx=>coordinate->for_numeric_value( 2 )
).

" Write the current date.
lo_cursor->get_cell( )->value->write_from( 'Date:' ).

DATA(lv_date) = CONV d( xco_cp=>sy->date( )->as( xco_cp_time=>format->abap )->value ).
lo_cursor->move_right( )->get_cell( )->value->write_from( lv_date ).

" Write the current time.
lo_cursor->move_down( )->move_left( )->get_cell( )->value->write_from( 'Time:' ).

DATA(lv_time) = CONV t( xco_cp=>sy->time( )->as( xco_cp_time=>format->abap )->value ).
lo_cursor->move_right( )->get_cell( )->value->write_from( lv_time ).
```

### Write value transformations

Via `XCO_CP_XLSX_WRITE_ACCESS=>VALUE_TRANSFORMATION`; set with `SET_VALUE_TRANSFORMATION` on `IF_XCO_XLSX_WA_CELL_VALUE` or `IF_XCO_XLSX_WA_RS_OP_WRITE_FRM`. Only **best effort** exists (and is the default). Supported ABAP field types: `ABAP_BOOL` → boolean cell, `D` → date, `T` → time, `MSEHI` → external unit (`CUNIT`), `SPRAS` → external language (`ISOLA`), `C`/`N`/`STRING` → string cell, `I`/`INT8`/`P` → numeric cell. Any other type → expect a runtime error.

### Getting the file back

```abap
DATA(lv_file_content) = lo_write_access->get_file_content( ).
```

Serve `lv_file_content` through your download channel (RAP, HTTP, email attachment — outside XCO's scope).

## Styling and Worksheet Customizing (write access)

All styles are built from `xco_cp_xlsx=>style->…` and applied with `apply_styles( VALUE #( ( lo_style ) ) )` on a cell:

```abap
" Background color:
DATA(lo_fill_color) = xco_cp_xlsx=>style->fill(
    )->set_background_color( xco_cp_xlsx=>color->standard->yellow ).
lo_cursor->get_cell( )->apply_styles( VALUE #( ( lo_fill_color ) ) ).

" Font:
DATA(lo_font) = xco_cp_xlsx=>style->font( ).
lo_font->set_color( xco_cp_xlsx=>color->standard->orange
  )->set_type( xco_cp_xlsx=>font_type->arial
  )->set_size( 16
  )->set_bold(
  )->set_italic(
  )->set_strikethrough(
  )->set_superscript(
  )->set_underline_type( xco_cp_xlsx=>underline_type->single ).

" Alignment:
DATA(lo_alignment) = xco_cp_xlsx=>style->alignment( ).
lo_alignment->set_horizontal_alignment( xco_cp_xlsx=>horizontal_alignment->right ).
lo_alignment->set_indent( 2 ).
lo_alignment->set_vertical_alignment( xco_cp_xlsx=>vertical_alignment->center ).
lo_alignment->set_wrap_text( ).

" Borders per side or outline:
DATA(lo_border) = xco_cp_xlsx=>style->border( ).
lo_border->set_top(
  io_style = xco_cp_xlsx=>border_style->dashed
  io_color = xco_cp_xlsx=>color->standard->blue
).
lo_border->set_outline(
  io_style = xco_cp_xlsx=>border_style->medium
  io_color = xco_cp_xlsx=>color->standard->blue
).
```

Cell protection (lock the sheet, selectively unlock cells):

```abap
lo_worksheet->protect( ).

DATA(lo_protection_unlock_cell) = xco_cp_xlsx=>style->protection(
    )->set_locked( abap_false ).
lo_cursor->get_cell( )->apply_styles( VALUE #( ( lo_protection_unlock_cell ) ) ).
```

Drop-down list via data validation:

```abap
DATA(lo_data_validation) = xco_cp_xlsx=>data_validation_type->if_xco_xlsx_dat_val_type_f~list(
  )->add_source( '1'
  )->add_source( '2'
  )->add_source( '3,4,5' ).

lo_cursor->get_cell( )->data_validation->set_type( lo_data_validation ).
```

Worksheet-level customizing:

```abap
" Set tab color
lo_worksheet->set_tab_color( xco_cp_xlsx=>color->standard->yellow ).

" Merge and unmerge cells (pattern must be a contiguous rectangle, e.g. A1:C5)
lo_worksheet->merge_cells( lo_pattern ).
lo_worksheet->unmerge_cells( lo_pattern ).

" Outline a cell range
lo_worksheet->set_outline(
  io_style = xco_cp_xlsx=>border_style->medium
  io_color = xco_cp_xlsx=>color->standard->blue
).

" Show or remove gridlines
lo_worksheet->show_gridlines( abap_true ).
lo_worksheet->show_gridlines( abap_false ).
```

Styling/customizing feature availability can differ by system release — if a `set_*` method is missing in your system, check the release notes rather than forcing it.

## Recipe: "User Uploads an Excel, Parse It"

1. Receive the file as `XSTRING` (upload channel of your app).
2. `xco_cp_xlsx=>document->for_file_content( … )->read_access( )`.
3. Pick the worksheet (`->worksheet->at_position( 1 )` or `->for_name( … )`).
4. Build a from-to pattern that starts below the header row and is unbounded at the bottom.
5. Row-stream `write_to( REF #( itab ) )` into a structure of elementary components (dates as `D`, floats as `decfloat34`, unknowns as `STRING`).
6. Validate every row before persisting (XCO validates nothing).

Full runnable class: [../examples/xlsx-upload-parse.md](../examples/xlsx-upload-parse.md).

## Sources

- XLSX (module root — document handles, coordinates, selection patterns): https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/xlsx-9b7a0d1.md
- XLSX Read Access: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/xlsx-read-access-5359a35.md
- XLSX Write Access: https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/xlsx-write-access-8dddce9.md
- help.sap.com entry point: https://help.sap.com/docs/btp/sap-business-technology-platform/xco-library?version=Cloud
