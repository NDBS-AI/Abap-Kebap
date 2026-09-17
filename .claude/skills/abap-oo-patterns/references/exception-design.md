# ABAP Exception Class Design — Decision Tree

ABAP gives you three exception class bases. Pick the right one and a lot of pain disappears.

## The three types

| Base class | Compiler-enforced `RAISING`? | Typical usage |
|---|---|---|
| `CX_STATIC_CHECK` | **Yes** — method must declare in `RAISING`, callers must `CATCH` or re-declare | Expected, recoverable; caller should handle |
| `CX_DYNAMIC_CHECK` | No — declaration optional | Environmental / external; rare; caller may propagate |
| `CX_NO_CHECK` | No | Truly exceptional; assertion-like; not meant to be caught in business code |

## Decision tree

```
Can the caller meaningfully recover from this error?
├── Yes (validation failure, "not found" in a context where the caller can pick a default)
│     → CX_STATIC_CHECK
│
└── No, the caller will almost always re-raise
      │
      Is the error environmental (DB down, RFC timeout, file not found)?
      ├── Yes → CX_DYNAMIC_CHECK
      └── No, it's an internal contract violation (got null where guaranteed not null)?
            → CX_NO_CHECK   (or really, just an ASSERT — see below)
```

## Naming

- `cx_<noun>` — the noun describes the *condition*, not the *action*.
  - Good: `cx_invoice_not_found`, `cx_amount_negative`, `cx_currency_unknown`, `cx_rate_service_unavailable`.
  - Bad: `cx_get_invoice_failed`, `cx_check_amount_failed`, `cx_processing_error`.
- One exception class per **failure category**, not per **call site**. If three methods can all raise "currency unknown", they all raise `cx_currency_unknown` — not three separate classes.

## Hierarchy

Organize related exceptions under a domain root:

```
cx_pricing_problem  (abstract, inherits CX_STATIC_CHECK)
├── cx_currency_unknown
├── cx_rate_service_unavailable
├── cx_amount_negative
└── cx_discount_not_applicable
```

Callers can `CATCH cx_pricing_problem` if they want a single handler, or specific subclasses for targeted handling. The root is `abstract` so it never gets raised directly.

## Message support — `IF_T100_MESSAGE`

Add the `IF_T100_MESSAGE` interface to put a message class entry on the exception. Then callers can render it without translating.

```abap
CLASS cx_currency_unknown DEFINITION
  PUBLIC
  INHERITING FROM cx_static_check.

  PUBLIC SECTION.
    INTERFACES if_t100_message.

    CONSTANTS:
      BEGIN OF unknown_currency,
        msgid TYPE symsgid VALUE 'ZPRICE',
        msgno TYPE symsgno VALUE '001',
        attr1 TYPE scx_attrname VALUE 'CURRENCY',
        attr2 TYPE scx_attrname VALUE '',
        attr3 TYPE scx_attrname VALUE '',
        attr4 TYPE scx_attrname VALUE '',
      END OF unknown_currency.

    METHODS constructor
      IMPORTING textid   LIKE if_t100_message=>t100key OPTIONAL
                previous LIKE previous OPTIONAL
                currency TYPE waers.

    DATA currency TYPE waers READ-ONLY.

ENDCLASS.

CLASS cx_currency_unknown IMPLEMENTATION.
  METHOD constructor.
    super->constructor( previous = previous ).
    me->currency = currency.
    IF textid IS INITIAL.
      if_t100_message~t100key = unknown_currency.
    ELSE.
      if_t100_message~t100key = textid.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
```

At the UI / log layer, `MESSAGE lo_ex TYPE 'E'` will pull the message text from message class `ZPRICE`, number 001, with `&1` replaced by `currency`.

## IF_T100_DYN_MSG — modern message interface

`IF_T100_DYN_MSG` includes `IF_T100_MESSAGE` and is the **recommended** interface for new exception classes, especially in ABAP Cloud / Steampunk. It adds automatic population of message variable slots so you rarely need to assign them manually.

Key differences from `IF_T100_MESSAGE`:

| | `IF_T100_MESSAGE` | `IF_T100_DYN_MSG` |
|---|---|---|
| Extra attributes | None beyond `t100key` | `msgv1`–`msgv4` for runtime placeholders |
| `MESSAGE ... TYPE 'E'` statement | Requires manual attribute mapping | Works automatically — maps `msgid`/`msgno`/`msgv1`–`v4` |
| `RAISE EXCEPTION ... MESSAGE ... WITH ...` | Not available | Supported — fills `t100key` and `msgv*` in one step |
| ABAP Cloud availability | Available | Available (preferred) |

Usage with the `MESSAGE` addition on `RAISE EXCEPTION`:

```abap
" Exception class implements IF_T100_DYN_MSG
CLASS zcx_pricing_error DEFINITION PUBLIC INHERITING FROM cx_static_check.
  PUBLIC SECTION.
    INTERFACES if_t100_dyn_msg.
    " ... constants, constructor ...
ENDCLASS.

" Raise with message class + placeholders in one statement
RAISE EXCEPTION TYPE zcx_pricing_error
  MESSAGE e001(zprice_msg) WITH currency amount.

" Equivalent long form (what the runtime does internally):
" RAISE EXCEPTION TYPE zcx_pricing_error
"   MESSAGE ID 'ZPRICE_MSG' TYPE 'E' NUMBER '001'
"   WITH currency amount.
```

When the exception is caught, the message text is available via `get_text( )` with placeholders already replaced.

Source: [SAP-samples/abap-cheat-sheets — 27_Exceptions.md, "System Interfaces for Messages"](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/27_Exceptions.md)

## Carrying long diagnostic text — the 50-character placeholder limit

Three limits bite exceptions that wrap remote calls or parsers:

| Layer | Limit | What you see |
|---|---|---|
| T100 placeholder `&1..&4` (`msgv1..4`, via `IF_T100_DYN_MSG` / `MESSAGE … WITH`) | **50 characters per placeholder** | `400 Bad Request: Property PaymentPercentage cannot be used …` (~200 chars) arrives as `400 Bad Request: Property PaymentPercentag` |
| `cx_root->get_text( )` on a T100-based exception | rendered from the 4 × 50 placeholders → **≈ 200 characters** | Same truncation one level up |
| BAL free text (`cl_bali_free_text_setter`) | `C(200)` | Cut without warning — chunk it ([abap-background-processing](../../abap-background-processing/references/application-log-bali.md)) |

Keep the short, translatable T100 text **and** add a long-text channel:

```abap
CLASS zcx_rate_service_error DEFINITION PUBLIC INHERITING FROM cx_static_check CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_t100_dyn_msg.
    INTERFACES if_t100_message.
    DATA mv_long_text TYPE string READ-ONLY.            " full diagnostic: URL, HTTP body, …

    METHODS constructor
      IMPORTING textid       LIKE if_t100_message=>t100key OPTIONAL
                previous     LIKE previous OPTIONAL
                iv_v1        TYPE string OPTIONAL   " … iv_v4: classifier only (status, reason)
                iv_long_text TYPE string OPTIONAL.
    METHODS get_long_text RETURNING VALUE(rv_text) TYPE string.
ENDCLASS.

CLASS zcx_rate_service_error IMPLEMENTATION.
  METHOD get_long_text.
    rv_text = get_text( ).                              " short, message-class based
    IF mv_long_text IS NOT INITIAL.
      rv_text = |{ rv_text } — { mv_long_text }|.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
```

Rules:

- Raise sites put the **classifier** in the placeholders (`iv_v3 = |{ lv_status } { lv_reason }|`) and the **payload** in `iv_long_text` (`|POST { lv_url } -> { lv_body }|`).
- Consumers that *log* (job fatal handler, per-row results, F9 console) call `get_long_text( )`; UI-facing consumers keep `get_text( )`.
- Never put a URL, an HTTP body, or a stack dump into a T100 placeholder.

## Resumable exceptions

A resumable exception allows the caller to **continue execution from the point where the exception was raised** after handling it in a `CATCH BEFORE UNWIND` block. Normal `CATCH` unwinds the stack; `CATCH BEFORE UNWIND` preserves it so `RESUME` can jump back.

### Prerequisites

1. The exception must be raised with `RAISE RESUMABLE EXCEPTION TYPE cx_x` (or `THROW RESUMABLE cx_x( )` in `COND`/`SWITCH`).
2. The method signature must declare the exception with the `RESUMABLE` addition: `RAISING RESUMABLE(cx_x)`.
3. The caller must use `CATCH BEFORE UNWIND ... INTO ex` and call `RESUME` if resuming.

```abap
" --- Method that raises a resumable exception ---
CLASS-METHODS divide
  IMPORTING  iv_num1              TYPE i
             iv_num2              TYPE i
  RETURNING  VALUE(rv_div_result) TYPE string
  RAISING    RESUMABLE(zcx_division_error).

METHOD divide.
  IF iv_num2 = 0.
    RAISE RESUMABLE EXCEPTION TYPE zcx_division_error.
    " Execution continues here after RESUME
    rv_div_result = `No result. Resumed!`.
  ELSE.
    rv_div_result = iv_num1 / iv_num2.
  ENDIF.
ENDMETHOD.

" --- Caller handles and optionally resumes ---
TRY.
    DATA(lv_result) = divide( iv_num1 = 5 iv_num2 = 0 ).
  CATCH BEFORE UNWIND zcx_division_error INTO DATA(lo_ex).
    " Check whether resuming is meaningful
    IF lo_ex->is_resumable = abap_true.
      " Log the error, then resume — execution picks up after RAISE RESUMABLE
      RESUME.
    ENDIF.
ENDTRY.
```

**When to use:** Non-terminating errors where the caller can decide whether to continue or abort — for example, validation steps in a loop where one bad row should be skipped rather than aborting the whole loop. For hard errors where no continuation makes sense, use a regular (non-resumable) exception.

**Note:** `CLEANUP` blocks are not executed when `RESUME` is called. The exception context (stack) is preserved until `RESUME` or the `CATCH BEFORE UNWIND` block is exited without `RESUME` (in which case the exception propagates normally).

Source: [SAP-samples/abap-cheat-sheets — 27_Exceptions.md, "RESUME Statements and RESUMABLE Additions"](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/27_Exceptions.md)

## Wrapping — preserve `previous`

When you catch one exception and raise another at a higher abstraction level, **always pass `previous`**:

```abap
TRY.
    DATA(lv_rate) = lo_rate_service->rate( lv_currency ).
  CATCH cx_rate_service_unavailable INTO DATA(lo_ex).
    RAISE EXCEPTION TYPE cx_pricing_input_missing
      EXPORTING
        previous = lo_ex
        cause    = `Missing FX rate`.
ENDTRY.
```

The chain stays intact in dumps and `MESSAGE` output; the original cause is reachable via `previous`.

## CX_NO_CHECK vs `ASSERT`

`ASSERT` is a **diagnostic, development-time** tool, not a production error-handling mechanism: it dumps unconditionally (`ASSERTION_FAILED`) and cannot be caught by any `TRY`/`CATCH` — there is no way for a framework boundary to log, compensate, or roll back cleanly before the session dies. Reach for it only for conditions that indicate a **programming error** — an invariant that bad input, timing, or user action can never trigger, only a bug can:

```abap
ASSERT customer IS BOUND.       " dump with clear cause if false - a programming error, not a business condition
```

If there is *any* plausible way for the condition to occur in production — bad input, a race, a timing window, an environment problem, even a rare one — it is not a pure invariant anymore, and `ASSERT` is the wrong tool. Raise a catchable exception class instead: `CX_NO_CHECK` when callers should not be forced to declare `RAISING` but a framework boundary should still get a chance to catch, log, and shut down cleanly; `CX_STATIC_CHECK`/`CX_DYNAMIC_CHECK` when the caller itself should handle or propagate it. Production-relevant invariants belong to a catchable exception class, never to `ASSERT`.

## Don'ts

| Don't | Reason |
|---|---|
| `CATCH cx_root` at every layer | Hides bugs; you're catching `CX_NO_CHECK` too |
| Empty `CATCH` block | Same as not catching but with extra noise |
| Catch and re-raise without `previous` | Loses the chain; dump is harder to read |
| Make an exception for a one-off ad-hoc condition the caller doesn't even know about | If the caller can't act on it, ASSERT instead |
| Static-check exception for an OOM | Caller can't meaningfully recover — use NO_CHECK |
| Dynamic-check exception for a validation failure | Caller *should* handle — use STATIC_CHECK |
| Throwing primitive types ("just call MESSAGE") in business class | Couples business code to dialog layer |

## When to catch what

| Layer | Catch |
|---|---|
| Domain class (business logic) | The domain exceptions it cares about (`cx_currency_unknown`, `cx_amount_negative`). Let others propagate. |
| Application service (use case orchestrator) | Domain root (`cx_pricing_problem`) to translate to a result or log; never `cx_root` |
| Boundary (UI, RFC handler, batch job entry) | `cx_root` — convert to user message, log, or graceful shutdown |
| Framework code | Specific framework exceptions only; never `cx_root` |

## Quick checklist

- [ ] Each class is named for its **condition**, not its **action**
- [ ] One class per failure **category**, not per call site
- [ ] Hierarchy rooted on a domain abstract class
- [ ] `IF_T100_MESSAGE` implemented for user-facing exceptions
- [ ] Long diagnostics (URL, response body) carried in `mv_long_text` / `get_long_text( )`, not in `&1..&4`
- [ ] All raises that wrap pass `previous`
- [ ] Static-check used only where caller should handle
- [ ] No-check used only for unrecoverable internals (or use `ASSERT`)
- [ ] No `CATCH cx_root` outside the boundary
