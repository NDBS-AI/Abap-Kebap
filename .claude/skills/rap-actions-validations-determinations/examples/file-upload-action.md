# Example: File Upload via a Static Action Popup

RAP has no first-class "upload a file into this action parameter" primitive. When the uploaded
file is itself the persisted business object, expose it as a direct entity-level stream field
instead (`@Semantics.largeObject` on a root or child entity, feature-controlled read-only — see
fiori-elements-ui-annotations' Attachment column, showcases `#Stream`/`#StreamTable`). This
example covers the other case: the file is an **input to custom logic** (parse it, attach it
elsewhere, validate it) and the natural entry point is an action popup.

## Abstract entities (base BDEF `abstract; strict ( 2 ); with hierarchy;`)

The file itself lives in one abstract entity; a dialog entity associates to it so the popup can
carry both the file and any other input fields in one deep structure:

```cds
@Semantics.largeObject: { mimeType: 'MimeType', fileName: 'Filename' }
Attachment : abap.rawstring;
@Semantics.mimeType: true
MimeType   : abap.char(128);
Filename   : abap.char(128);
```

```cds
" Dialog/popup entity — associates to the file entity above
_Files : association [1] to ZR_UploadFile on 1 = 1;
```

Both entities' behavior definitions declare `abstract; strict ( 2 ); with hierarchy;`; the
dialog entity additionally declares `association _Files with hierarchy;` so the deep structure
reaches the file fields.

## Action + handler

```
static action uploadFlatFile deep parameter ZR_UploadPopup;
```

```abap
METHODS upload_flat_file FOR MODIFY
  IMPORTING keys FOR ACTION SalesOrder~uploadFlatFile.

METHOD upload_flat_file.
  LOOP AT keys INTO DATA(ls_key).
    DATA(lv_file_content) = xco_cp=>xstring( ls_key-%param-_files-attachment
      )->as_string( xco_cp_character=>code_page->utf_8 ).

    " ... parse/validate/persist lv_file_content ...
  ENDLOOP.
ENDMETHOD.
```

`static` (not instance-bound): `keys` rows carry `%cid`, not `%tky` — same rule as any other
static action ([../references/handler-signatures.md](../references/handler-signatures.md), Static action).

## Points Worth Copying

- **Single file per invocation** — the popup entity models one attachment, not a table of them.
  For multiple files, repeat the action call rather than trying to widen the parameter.
- **No `default function` / `@UI.defaultValue` support on the popup's own fields** — the user
  must pick the file (and fill any sibling fields) every time; nothing prefills them.
- **Field naming is load-bearing for the Fiori upload control** — the element carrying
  `@Semantics.largeObject` must keep the name the annotation expects; renaming it after wiring
  the UI breaks the upload control silently.
- **Prefer direct entity-level streaming** when the file itself IS the record being
  created/read — this action-popup route exists for the case where the file feeds custom logic
  and is not, on its own, the persisted business object.

## Sources

- RAP - File Upload (Stream), software-heroes.com: https://software-heroes.com/en/blog/abap-rap-native-file-upload
- `@Semantics.largeObject` reference: [cds-views-authoring/references/annotations-reference.md](../../cds-views-authoring/references/annotations-reference.md)
- Direct entity-level streaming alternative: [fiori-elements-ui-annotations/references/list-report-annotations.md](../../fiori-elements-ui-annotations/references/list-report-annotations.md)
