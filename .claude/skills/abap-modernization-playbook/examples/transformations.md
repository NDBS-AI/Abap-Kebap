# Modernization — Worked Examples

Three concrete before/after pairs covering the most common modernizations.

---

## 1. `PERFORM` / `FORM` → method

**Before — report-style classical ABAP**
```abap
REPORT zr_invoice_summary.

DATA: gt_invoices TYPE TABLE OF zinvoice,
      gv_total    TYPE decfloat34.

START-OF-SELECTION.
  PERFORM fetch_invoices.
  PERFORM compute_total CHANGING gv_total.
  PERFORM display.

FORM fetch_invoices.
  SELECT carrid, connid, fldate, amount, created_at FROM zinvoice
    INTO TABLE gt_invoices
    WHERE created_at >= sy-datum - 30.
ENDFORM.

FORM compute_total CHANGING p_total TYPE decfloat34.
  LOOP AT gt_invoices INTO DATA(ls_invoice).
    p_total = p_total + ls_invoice-amount.
  ENDLOOP.
ENDFORM.

FORM display.
  cl_demo_output=>display( |Total: { gv_total }| ).
ENDFORM.
```

**After — local class with single responsibility per method**
```abap
REPORT zr_invoice_summary.

CLASS lcl_summary DEFINITION FINAL.
  PUBLIC SECTION.
    METHODS run.
  PRIVATE SECTION.
    METHODS:
      fetch         RETURNING VALUE(rt_result) TYPE invoice_t,
      compute_total IMPORTING it_invoices     TYPE invoice_t
                    RETURNING VALUE(rv_result) TYPE decfloat34,
      display       IMPORTING iv_total TYPE decfloat34.
ENDCLASS.

CLASS lcl_summary IMPLEMENTATION.
  METHOD run.
    display( compute_total( fetch( ) ) ).
  ENDMETHOD.

  METHOD fetch.
    SELECT carrid, connid, fldate, amount, created_at FROM zinvoice
      INTO TABLE @rt_result
      WHERE created_at >= @( sy-datum - 30 ).
  ENDMETHOD.

  METHOD compute_total.
    rv_result = REDUCE #( INIT lv_total = 0
                       FOR <fs_invoice> IN it_invoices
                       NEXT lv_total = lv_total + <fs_invoice>-amount ).
  ENDMETHOD.

  METHOD display.
    cl_demo_output=>display( |Total: { iv_total }| ).
  ENDMETHOD.
ENDCLASS.

START-OF-SELECTION.
  NEW lcl_summary( )->run( ).
```

**What changed:**
- Globals (`gt_invoices`, `gv_total`) gone — state passed as parameters.
- Each method does one thing; testable independently.
- `REDUCE` replaces the explicit loop.
- The report now contains 25 lines vs 30 — fewer, but more importantly with much higher review-density.

**What didn't change:**
- Behavior is identical; same selection, same total, same output.
- Performance is identical (same SQL, same iteration count).

---

## 2. Procedural DB SELECT → CDS view + consumption

**Before — joined SELECT in a report**
```abap
SELECT k~kunnr,
       k~name1,
       SUM( v~rmwwr ) AS open_amount
  FROM kna1 AS k
  INNER JOIN vbrk AS v ON v~kunag = k~kunnr
  WHERE v~rfbsk = 'A'           " open invoices
    AND v~fkdat >= @sy-datum - 90
  GROUP BY k~kunnr, k~name1
  INTO TABLE @DATA(lt_open).

LOOP AT lt_open INTO DATA(ls_open).
  WRITE: / ls_open-kunnr, ls_open-name1, ls_open-open_amount CURRENCY 'EUR'.
ENDLOOP.
```

**After — CDS view stack + consumption**

Basic view (`Z_I_OpenInvoice`):
```sql
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Open Invoice — interface'
define view entity Z_I_OpenInvoice
  as select from vbrk as Invoice
  association [1..1] to Z_I_Customer as _Customer
    on $projection.CustomerId = _Customer.CustomerId
{
  key Invoice.vbeln               as InvoiceId,
      Invoice.kunag               as CustomerId,
      Invoice.rmwwr               as Amount,
      Invoice.waerk               as Currency,
      Invoice.fkdat               as InvoiceDate,
      Invoice.rfbsk               as PostingStatus,
      _Customer
}
where Invoice.rfbsk = 'A';
```

Composite view (`Z_C_OpenInvoiceByCustomer`):
```sql
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Open invoice total per customer (last 90 days)'
define view entity Z_C_OpenInvoiceByCustomer
  as select from Z_I_OpenInvoice as Invoice
  association [1..1] to Z_I_Customer as _Customer
    on $projection.CustomerId = _Customer.CustomerId
{
  key Invoice.CustomerId,
      _Customer.Name,
      sum( Invoice.Amount ) as OpenAmount,
      Invoice.Currency,
      _Customer
}
where Invoice.InvoiceDate >= dats_add_days($session.system_date, -90, 'NULL')
group by Invoice.CustomerId, _Customer.Name, Invoice.Currency;
```

Consumption (in any ABAP):
```abap
SELECT CustomerId, Name, OpenAmount, Currency
  FROM Z_C_OpenInvoiceByCustomer
  INTO TABLE @DATA(lt_open_summary).

LOOP AT lt_open_summary INTO DATA(ls_row).
  WRITE: / ls_row-CustomerId, ls_row-Name, ls_row-OpenAmount CURRENCY ls_row-Currency.
ENDLOOP.
```

**What changed:**
- Aggregation pushed to the DB (`sum( … )`, `group by`).
- View reusable from any consumer (OData, Fiori, other reports).
- Authorization centralized at view (via DCL, not shown).

**What didn't change for the caller:**
- Output is the same per customer.

**When to NOT do this:**
- The SELECT runs once in a one-shot job, never reused → CDS overhead not worth it.
- The "90 days" parameter needs to be runtime-variable in a way CDS can't express → use view *parameters* or stay procedural.

---

## 3. `MACRO` → method

**Before — macro hides a small structure**
```abap
DEFINE add_log.
  APPEND VALUE #( ts = sy-uzeit msg = &1 sev = &2 ) TO gt_log.
END-OF-DEFINITION.

add_log 'Starting batch' 'I'.
SELECT id, payload FROM zsomething INTO TABLE @DATA(lt_rows).
add_log |Read { lines( lt_rows ) } rows| 'I'.
" …
add_log |Failed at step 3: { lo_ex->get_text( ) }| 'E'.
```

**After — local method with the same body**
```abap
CLASS lcl_logger DEFINITION FINAL.
  PUBLIC SECTION.
    METHODS add IMPORTING iv_msg TYPE string iv_sev TYPE log_severity DEFAULT 'I'.
    METHODS lines RETURNING VALUE(rt_result) TYPE log_t.
  PRIVATE SECTION.
    DATA mt_log TYPE log_t.
ENDCLASS.

CLASS lcl_logger IMPLEMENTATION.
  METHOD add.
    APPEND VALUE #( ts = sy-uzeit msg = iv_msg sev = iv_sev ) TO mt_log.
  ENDMETHOD.
  METHOD lines.
    rt_result = mt_log.
  ENDMETHOD.
ENDCLASS.

DATA(lo_logger) = NEW lcl_logger( ).
lo_logger->add( iv_msg = 'Starting batch' ).
SELECT id, payload FROM zsomething INTO TABLE @DATA(lt_rows).
lo_logger->add( iv_msg = |Read { lines( lt_rows ) } rows| ).
" …
lo_logger->add( iv_msg = |Failed at step 3: { lo_ex->get_text( ) }| iv_sev = 'E' ).
```

**What changed:**
- Macro replaced with method on a class that owns the log table.
- Debugger now steps into `add`; IDE shows the call signature; refactoring is safe.
- Default severity `'I'` reduces noise at the call sites.

**What didn't change:**
- Each call site still passes the same data.
- Log table content identical.

**The reason to do this:** macros are invisible to ATC, the debugger, and many code analysis tools. Method has none of those gaps.
