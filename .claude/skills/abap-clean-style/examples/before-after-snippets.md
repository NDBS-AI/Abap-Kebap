# Clean ABAP — Before / After Snippets

Eight short, isolated transformations. Each shows a real review finding and its Clean ABAP rewrite. Use them as exemplars when you write a finding in code review or when you draft new code.

---

## 1. Hungarian prefixes + Concatenate → Inline + Template

**Before**
```abap
DATA: lv_customer_id   TYPE kunnr,
      lv_customer_name TYPE name1_gp,
      lv_message       TYPE string.

SELECT SINGLE name1
  FROM kna1
  INTO lv_customer_name
  WHERE kunnr = lv_customer_id.

CONCATENATE 'Customer'
            lv_customer_id
            '-'
            lv_customer_name
            INTO lv_message
            SEPARATED BY space.
```

**After**
```abap
SELECT SINGLE name1 FROM kna1
  INTO @DATA(lv_customer_name)
  WHERE kunnr = @lv_customer_id.

DATA(lv_message) = |Customer { lv_customer_id } - { lv_customer_name }|.
```

**Why:** type prefixes carry no information the DDIC reference doesn't already imply; the template makes the output shape readable in one line.

---

## 2. CASE TYPE OF → Polymorphism

**Before**
```abap
METHOD calculate_price.
  CASE TYPE OF io_product.
    WHEN TYPE cl_book.
      rv_result = io_product->mv_base_price * '0.92'.   " book discount 8%
    WHEN TYPE cl_ebook.
      rv_result = io_product->mv_base_price * '0.70'.   " ebook discount 30%
    WHEN TYPE cl_audiobook.
      rv_result = io_product->mv_base_price * '0.80'.
  ENDCASE.
ENDMETHOD.
```

**After**
```abap
INTERFACE if_priced_product.
  METHODS price RETURNING VALUE(rv_result) TYPE decfloat34.
ENDINTERFACE.

CLASS cl_book IMPLEMENTATION.
  METHOD if_priced_product~price.
    rv_result = mv_base_price * '0.92'.
  ENDMETHOD.
ENDCLASS.

" callsite:
rv_result = io_product->price( ).
```

**Why:** adding a fourth product type now means one new class, not one more `WHEN` in every pricing routine. Polymorphism captures the *open* set of product types; `CASE TYPE OF` assumes a closed set.

---

## 3. Loop + IF CONTINUE → LOOP WHERE

**Before**
```abap
LOOP AT lt_invoices INTO DATA(ls_inv).
  IF ls_inv-status <> 'O'.
    CONTINUE.
  ENDIF.
  IF ls_inv-amount LE 0.
    CONTINUE.
  ENDIF.
  process( ls_inv ).
ENDLOOP.
```

**After**
```abap
LOOP AT lt_invoices ASSIGNING FIELD-SYMBOL(<fs_inv>)
     WHERE status = 'O' AND amount > 0.
  process( <fs_inv> ).
ENDLOOP.
```

**Why:** filter intent is at the `LOOP` line, not buried as `CONTINUE`. `ASSIGNING` avoids the copy `INTO DATA(...)` makes.

---

## 4. APPEND VALUE in a row → VALUE constructor

**Before**
```abap
DATA: lt_statuses TYPE TABLE OF status_text.

APPEND VALUE #( code = 'O' text = 'Open'      ) TO lt_statuses.
APPEND VALUE #( code = 'P' text = 'Paid'      ) TO lt_statuses.
APPEND VALUE #( code = 'C' text = 'Cancelled' ) TO lt_statuses.
```

**After**
```abap
DATA(lt_statuses) = VALUE status_text_t(
  ( code = 'O' text = 'Open'      )
  ( code = 'P' text = 'Paid'      )
  ( code = 'C' text = 'Cancelled' )
).
```

**Why:** initialization is a single expression; reading it tells you "here is the full set" instead of "here is one append, …".

---

## 5. CREATE OBJECT → NEW #

**Before**
```abap
DATA lo_pricing TYPE REF TO cl_pricing_strategy_country.

CREATE OBJECT lo_pricing
  EXPORTING
    country = 'TR'
    region  = '34'.

DATA lv_total TYPE decfloat34.

CALL METHOD lo_pricing->compute
  EXPORTING
    order = ls_order
  RECEIVING
    result = lv_total.
```

**After**
```abap
DATA(lv_total) = NEW cl_pricing_strategy_country(
                country = 'TR'
                region  = '34'
              )->compute( ls_order ).
```

**Why:** one statement, intent on top (we want a `total`), construction details inline. The variable `lo_pricing` had no second use — extract it only when reused.

---

## 6. EXPORTING + IMPORTING → RETURNING

**Before**
```abap
METHODS get_overdue
  IMPORTING
    iv_customer_id TYPE kunnr
  EXPORTING
    et_invoices    TYPE invoice_t
    ev_total       TYPE decfloat34.

" caller
DATA: lt_inv   TYPE invoice_t,
      lv_total TYPE decfloat34.
me->get_overdue(
  EXPORTING iv_customer_id = lv_customer_id
  IMPORTING et_invoices    = lt_inv
            ev_total       = lv_total ).
```

**After**
```abap
TYPES: BEGIN OF ty_overdue_result,
         invoices TYPE invoice_t,
         total    TYPE decfloat34,
       END OF ty_overdue_result.

METHODS find_overdue
  IMPORTING iv_customer_id  TYPE kunnr
  RETURNING VALUE(rs_result) TYPE ty_overdue_result.

" caller
DATA(ls_overdue) = me->find_overdue( lv_customer_id ).
```

**Why:** one returning value, one caller line. The method also got renamed (`get_*` was a query; `find_*` reads better for "may return nothing").

---

## 7. Empty CATCH → Handle or document

**Before**
```abap
TRY.
    DATA(lt_rates) = me->fetch_rates( ).
  CATCH cx_root.
    " ignore
ENDTRY.

" caller assumes lt_rates is populated
me->apply( lt_rates ).
```

**After (option A — recover with default)**
```abap
TRY.
    DATA(lt_rates) = me->fetch_rates( ).
  CATCH cx_rate_service_unavailable INTO DATA(lo_ex).
    log( |Rate service down ({ lo_ex->get_text( ) }) — using fallback rates| ).
    lt_rates = me->fallback_rates( ).
ENDTRY.

me->apply( lt_rates ).
```

**After (option B — re-raise with context)**
```abap
TRY.
    DATA(lt_rates) = me->fetch_rates( ).
  CATCH cx_rate_service_unavailable INTO DATA(lo_ex).
    RAISE EXCEPTION TYPE cx_pricing_input_missing
      EXPORTING previous = lo_ex.
ENDTRY.
```

**Why:** the original silently produced wrong prices and was undiscoverable in a dump. Either degrade *visibly*, or fail.

---

## 8. Magic literal → Constant via interface

**Before**
```abap
IF ls_invoice-status = 'O'.
  process_open( ls_invoice ).
ELSEIF ls_invoice-status = 'P'.
  process_paid( ls_invoice ).
ELSEIF ls_invoice-status = 'C'.
  process_cancelled( ls_invoice ).
ENDIF.

" elsewhere
IF ls_doc-status = 'O'.
  archive( ls_doc ).
ENDIF.
```

**After**
```abap
INTERFACE if_invoice_status PUBLIC.
  CONSTANTS:
    BEGIN OF status,
      open      TYPE inv_status VALUE 'O',
      paid      TYPE inv_status VALUE 'P',
      cancelled TYPE inv_status VALUE 'C',
    END OF status.
ENDINTERFACE.

CASE ls_invoice-status.
  WHEN if_invoice_status=>status-open.      process_open( ls_invoice ).
  WHEN if_invoice_status=>status-paid.      process_paid( ls_invoice ).
  WHEN if_invoice_status=>status-cancelled. process_cancelled( ls_invoice ).
  WHEN OTHERS.
    RAISE EXCEPTION TYPE cx_unknown_invoice_status
      EXPORTING status = ls_invoice-status.
ENDCASE.
```

**Why:** the meaning of `'O'` now lives in one place; reviewers everywhere see `status-open` and trust it. The new `WHEN OTHERS` catches the case the original silently skipped.
