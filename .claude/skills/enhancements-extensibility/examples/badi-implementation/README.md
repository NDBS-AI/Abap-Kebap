# Minimal New BAdI Implementation — Example

A skeleton for implementing a new BAdI (Enhancement Spot definition). Use as a template; rename and adapt.

## Step 1 — Find the Enhancement Spot

In ADT / SE18, search by name or by where-used on the standard transaction. Read the spot documentation. Look for:
- Which BAdI(s) the spot defines.
- The interface each BAdI implements.
- Whether the BAdI is filter-enabled.
- Whether multiple implementations are allowed.
- The timing — does the BAdI fire before save, after save, after commit?

> **Interface contract:** Every BAdI interface must include the tag interface `IF_BADI_INTERFACE` in its `INTERFACES` list. This is a mandatory requirement of the kernel-based BAdI framework — omitting it will prevent activation.
>
> **Fallback class:** For single-use BAdIs, the Enhancement Spot definition can specify an optional fallback class. The fallback runs when no active implementation matches the caller's filter values (or when no implementation at all is active). If your BAdI is single-use and the spot offers a fallback, implement one to avoid runtime errors in uncovered filter scenarios.

For this example assume:
- Spot: `ES_SALES_ORDER_VALIDATION` (fictitious)
- BAdI: `BADI_SALES_ORDER_VALIDATION`
- Interface: `IF_BADI_SALES_ORDER_VALIDATION`
- Method: `VALIDATE`
  ```abap
  METHODS validate
    IMPORTING is_order     TYPE order_data
              it_items     TYPE order_item_t
    EXPORTING et_messages  TYPE bal_t_msg
              ev_block     TYPE abap_bool.
  ```
- Filter: company code (`BUKRS`).

## Step 2 — Create the implementation class

```abap
CLASS zcl_im_so_validate_credit DEFINITION
  PUBLIC FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES if_badi_sales_order_validation.

ENDCLASS.

CLASS zcl_im_so_validate_credit IMPLEMENTATION.

  METHOD if_badi_sales_order_validation~validate.
    " Inputs: is_order, it_items.
    " Outputs: et_messages, ev_block.

    " Implementation rule:
    " If customer's open credit exceeds threshold, block the save.

    DATA(lv_open_credit) = zcl_credit_service=>open_for_customer( is_order-customer_id ).
    DATA(lv_threshold)   = zcl_credit_config=>threshold_for( is_order-company_code ).

    IF lv_open_credit > lv_threshold.
      APPEND VALUE #(
        msgty = 'E'
        msgid = 'ZSO_VALIDATION'
        msgno = '001'
        msgv1 = |{ lv_open_credit NUMBER = USER }|
        msgv2 = |{ lv_threshold NUMBER = USER }|
      ) TO et_messages.
      ev_block = abap_true.
    ENDIF.

  ENDMETHOD.

ENDCLASS.
```

## Step 3 — Create the BAdI implementation (Enhancement Implementation)

In ADT:
1. New → ABAP Repository Object → Enhancement Implementation
2. Name: `ZEHI_SO_VALIDATE_CREDIT`
3. Reference Spot: `ES_SALES_ORDER_VALIDATION`
4. Inside the enhancement implementation, create a BAdI implementation:
   - BAdI: `BADI_SALES_ORDER_VALIDATION`
   - Implementation: `ZBI_SO_VALIDATE_CREDIT`
   - Implementing class: `zcl_im_so_validate_credit`
5. Filter (if applicable):
   - Property: `BUKRS` (or whatever the BAdI defines)
   - Values: `1000`, `2000` (whichever company codes need this rule)

## Step 4 — Activate, transport, test

- Activate the BAdI implementation and the class.
- Transport object: the Enhancement Implementation (auto-includes the BAdI impl).
- Test:
  - Run a sales order create / change with a customer whose credit is over threshold.
  - Verify the validation message appears and save is blocked.
  - Run with a customer below threshold — verify no interference.
  - Run with company code outside the filter — verify the BAdI doesn't even fire.

## Style notes

- Class naming: `ZCL_IM_*` convention for BAdI implementations (`IM_` = implementation).
- Implementation method delegates to a domain service (`zcl_credit_service`) so unit tests can target the domain logic without the BAdI plumbing.
- Don't compute the threshold in the BAdI body — it's customizing, not logic.
- Don't add `MESSAGE 'X' TYPE 'E'` style calls; the BAdI's contract is the `et_messages` / `ev_block` channel. Adding `MESSAGE` is a contract violation that breaks the calling transaction.

## What this BAdI implementation does NOT do

- Touch the database.
- Modify the order or items.
- Call other BAdIs.
- Send emails or trigger workflows.

If any of those are needed, they belong in a separate place (an after-save BAdI, an event handler subscribed to a SAP business event, a workflow step). Keep each BAdI implementation single-purpose.

## ABAP Cloud variant

The pattern is similar but:
- Spot must be released (`api.sap.com`).
- Implementation class must use only released DDIC and APIs.
- No filter values via SE19 — use the cloud-equivalent UI.

The class shape is identical.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Implementation modifies `is_order` directly | BAdI's signature is `IMPORTING is_order` — that's a read contract. Don't mutate inputs. |
| Implementation calls SAP standard transactions inside | Reentrance bug; the calling LUW will deadlock or recurse |
| Implementation writes to DB outside the LUW | Side effects survive even when the parent transaction rolls back |
| Implementation reads global program variables | Couples to the host program's internals; breaks at SAP refactor |
| No filter when the spot offered one | Implementation fires for everyone; performance degrades; cross-team conflict |
| Forgot to add the implementation to a transport | Works on dev, missing on QA, support call |
