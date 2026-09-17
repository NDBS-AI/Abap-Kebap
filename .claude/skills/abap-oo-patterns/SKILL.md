---
name: abap-oo-patterns
description: Use when designing or refactoring ABAP classes — picking a class structure, choosing between inheritance and composition, designing an exception class hierarchy, deciding on factory vs direct construction, splitting a god class, designing for testability with dependency injection, or applying a classic OO pattern (Strategy, Template Method, Observer, Decorator) in ABAP's specific constraints. Pulls Clean ABAP class rules into actionable design guidance.
---

# ABAP OO Patterns

## Overview

Object-oriented design adapted to ABAP's specific constraints. ABAP has no multiple inheritance, no real generics (generic typing exists but is not parametric polymorphism), no expression-bodied properties, no operator overloading. It does have everything you need for the GoF patterns — classes, interfaces, single inheritance, virtual methods, friend declarations, and class-level state.

The patterns below are the ones that come up *constantly* in ABAP. Each is presented with the ABAP-specific way to write it, plus the anti-pattern it usually replaces.

**Core principle:** prefer composition over inheritance. ABAP's lack of multiple inheritance makes inheritance chains painful to extend; collaborating objects via interfaces are more flexible and far easier to test.

## Core OO language reference

For the language mechanics behind these patterns — class definition, visibility, `CLASS-DATA`/`CLASS-METHODS`, instance vs static constructor, inheritance (`INHERITING FROM`, `REDEFINITION`, `super->`, `ABSTRACT`, `FINAL`), interfaces (aliases, `IF~method`, `DEFAULT IGNORE`/`FAIL`), events (`EVENTS`/`RAISE EVENT`/`SET HANDLER`), `me`, friends, `CREATE PRIVATE`/`PROTECTED`, polymorphism and casting (`CAST` / `?=`) — see [references/oo-language.md](references/oo-language.md).

## When to Use

- Sketching the class structure for a new feature.
- Refactoring a long procedural module into classes.
- Designing an exception class hierarchy.
- Splitting a "god class" of 2000+ lines.
- Adding a new variation to existing logic and finding yourself reaching for `CASE TYPE OF` or a giant `IF`.
- Writing testable code — design for `cl_osql_test_environment` / `cl_abap_testdouble` style isolation.

**When NOT to use:**
- For naming and surface style → [abap-clean-style](../abap-clean-style/SKILL.md).
- For RAP-specific behavior — RAP imposes its own class shape; see [rap-bo-modeling](../rap-bo-modeling/SKILL.md).
- For procedural reports that won't have a second consumer — sometimes a 100-line `REPORT` is the right answer.

## ABAP-specific constraints to remember

| Constraint | Consequence for design |
|---|---|
| **Single inheritance only** | Use interfaces aggressively for cross-cutting capabilities |
| **No generic methods (no `<T>`)** | Generic typing via `TYPE REF TO data`, `TYPE ANY TABLE` — *runtime* type safety; document expectations |
| **`PRIVATE SECTION` is the default mindset, not the default keyword** | You have to declare it; do not lazily put things in `PUBLIC` |
| **Friends are global** | One friend declaration exposes *all* private members; use sparingly, mostly for test classes |
| **No constructor overloading** | One `CONSTRUCTOR`; use factory methods for variants |
| **No properties (only methods)** | Encapsulate via private attributes + accessor methods |
| **Static (`CLASS-DATA`, `CLASS-METHODS`)** is per-class, not per-instance | Singletons via class methods are easy; harder to test (static state survives between tests) |
| **`CREATE PROTECTED` / `CREATE PRIVATE`** lets you enforce construction routing | Use for factory patterns to forbid `NEW cl_x( )` outside the factory |

## Quick Reference

| Need | ABAP construct |
|---|---|
| Force creation through a factory | `CREATE PRIVATE` + static `create` method |
| Inject a collaborator for testing | Constructor parameter `TYPE REF TO if_<capability>` |
| Replace `CASE TYPE OF` with polymorphism | Define `IF_X` with the operation; subtype per case |
| Extend behavior without modifying core | Strategy via interface injected at construction |
| Template a process with variant steps | Template method: abstract class with `FINAL` orchestrator + abstract `do_step_n` |
| Notify subscribers of an event | Observer pattern via interface + table of subscribers |
| Wrap a class to add logging / retries | Decorator: implement same interface; delegate inside |
| Single instance per application | Singleton via `CLASS-METHODS get_instance` + `CREATE PRIVATE` |
| Multiple persistent strategies | Each as a class, registered in a static map by key |
| Build a complex object in ordered steps | Builder: abstract builder + director/provider drives the steps |
| Treat a tree of objects uniformly | Composite: leaf + composite both implement one interface, composite recurses |
| Queue / log / undo operations | Command: wrap each operation as an object with `execute`/`undo` |
| Traverse a collection without exposing internals | Iterator: `get_next`/`has_next` interface over the collection |
| Change behavior by internal state | State: one state class per behavior, swapped at runtime |
| Add operations without touching the class | Visitor: class accepts a visitor; new op = new visitor |
| One simple entry point over a subsystem | Facade: hides object creation and call sequencing |
| Access control / logging around an object | Proxy: same interface, delegates to the real subject |
| Try handlers until one handles the request | Chain of Responsibility: handler forwards to `next` |
| Create compatible families of objects | Abstract Factory: one concrete factory per variant |
| Clone a pre-configured object | Prototype: `clone` method returns a copy of current state |
| Save / restore object state (undo) | Memento: opaque snapshot class (`CREATE PRIVATE` + friend) |
| Decouple many-to-many object interactions | Mediator: members talk only to a central mediator |
| Share heavy data across many objects | Flyweight: cache shared objects in a factory by key |

## Patterns

### 1. Factory (with `CREATE PRIVATE`)

Use when construction has variants, dependencies to wire, or invariants to enforce.

```abap
INTERFACE if_pricing_strategy PUBLIC.
  METHODS compute
    IMPORTING is_order         TYPE order_data
    RETURNING VALUE(rv_result) TYPE decfloat34.
ENDINTERFACE.

CLASS cl_pricing_strategy DEFINITION
  PUBLIC
  CREATE PRIVATE.

  PUBLIC SECTION.
    CLASS-METHODS:
      for_country
        IMPORTING iv_country      TYPE land1
        RETURNING VALUE(ro_result) TYPE REF TO if_pricing_strategy
        RAISING   cx_unknown_country.

  PRIVATE SECTION.
    METHODS constructor IMPORTING iv_country TYPE land1.
    DATA mv_country TYPE land1.

ENDCLASS.

"Concrete strategies implement the interface - they do NOT inherit from the
"factory class (a subclass of a CREATE PRIVATE class cannot be instantiated,
"not even by the factory itself, unless friendship is granted). CREATE PRIVATE
"+ GLOBAL FRIENDS routes all construction through for_country below: callers
"cannot NEW cl_pricing_strategy_tr( ) directly.
CLASS cl_pricing_strategy_tr DEFINITION PUBLIC FINAL CREATE PRIVATE
  GLOBAL FRIENDS cl_pricing_strategy.
  PUBLIC SECTION.
    INTERFACES if_pricing_strategy.
ENDCLASS.

CLASS cl_pricing_strategy_de DEFINITION PUBLIC FINAL CREATE PRIVATE
  GLOBAL FRIENDS cl_pricing_strategy.
  PUBLIC SECTION.
    INTERFACES if_pricing_strategy.
ENDCLASS.

CLASS cl_pricing_strategy IMPLEMENTATION.

  METHOD for_country.
    CASE iv_country.
      WHEN 'TR'. ro_result = NEW cl_pricing_strategy_tr( ).
      WHEN 'DE'. ro_result = NEW cl_pricing_strategy_de( ).
      WHEN OTHERS.
        RAISE EXCEPTION TYPE cx_unknown_country EXPORTING country = iv_country.
    ENDCASE.
  ENDMETHOD.

ENDCLASS.

CLASS cl_pricing_strategy_tr IMPLEMENTATION.
  METHOD if_pricing_strategy~compute.
    rv_result = is_order-amount * '1.20'.   " illustrative country-specific rate
  ENDMETHOD.
ENDCLASS.

CLASS cl_pricing_strategy_de IMPLEMENTATION.
  METHOD if_pricing_strategy~compute.
    rv_result = is_order-amount * '1.19'.   " illustrative country-specific rate
  ENDMETHOD.
ENDCLASS.
```

Adding a new country is a one-place change: a new implementing class plus one new `WHEN`. Do **not** make the concrete classes inherit from the `CREATE PRIVATE` factory class: a subclass of a `CREATE PRIVATE` class cannot be instantiated — not even by the superclass — unless friendship is granted.

### 2. Strategy + Constructor Injection (for testability)

The canonical ABAP test-double pattern. Every collaborator is an interface; every class takes its collaborators via the constructor.

```abap
INTERFACE if_rate_provider PUBLIC.
  METHODS rate
    IMPORTING iv_currency      TYPE waers
    RETURNING VALUE(rv_result) TYPE decfloat34
    RAISING   cx_rate_unavailable.
ENDINTERFACE.

CLASS cl_order_pricing DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    METHODS:
      constructor IMPORTING io_rate_provider TYPE REF TO if_rate_provider,
      total_in_eur
        IMPORTING is_order         TYPE order_data
        RETURNING VALUE(rv_result) TYPE decfloat34
        RAISING   cx_rate_unavailable.
  PRIVATE SECTION.
    DATA mo_rate_provider TYPE REF TO if_rate_provider.
ENDCLASS.

CLASS cl_order_pricing IMPLEMENTATION.
  METHOD constructor.
    me->mo_rate_provider = io_rate_provider.
  ENDMETHOD.
  METHOD total_in_eur.
    DATA(lv_rate) = mo_rate_provider->rate( is_order-currency ).
    rv_result = is_order-amount * lv_rate.
  ENDMETHOD.
ENDCLASS.
```

In tests, build a stub `lcl_fake_rate_provider IMPLEMENTING if_rate_provider` that returns a fixed rate. See [abap-unit-tdd](../abap-unit-tdd/SKILL.md).

**Anti-pattern:** `cl_rate_service=>get_instance( )` called *inside* `total_in_eur`. That binds the dependency at runtime and cannot be substituted for a test.

### 3. Template Method

Use when you have a sequence of steps and one or two steps vary by subtype.

```abap
CLASS cl_report_base DEFINITION ABSTRACT PUBLIC.
  PUBLIC SECTION.
    METHODS run FINAL.
  PROTECTED SECTION.
    METHODS:
      fetch_data ABSTRACT,
      transform  ABSTRACT,
      display.
ENDCLASS.

CLASS cl_report_base IMPLEMENTATION.
  METHOD run.
    fetch_data( ).
    transform( ).
    display( ).
  ENDMETHOD.
  METHOD display.
    " default: ALV output; subclasses override if needed
  ENDMETHOD.
ENDCLASS.
```

`run` is `FINAL` — subclasses can't reorder. They override `fetch_data`, `transform`, and optionally `display`.

### 4. Observer

When state changes need to notify multiple unrelated listeners.

```abap
INTERFACE if_order_change_listener PUBLIC.
  METHODS on_order_changed IMPORTING is_order TYPE order_data.
ENDINTERFACE.

CLASS cl_order DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    METHODS:
      register IMPORTING io_listener TYPE REF TO if_order_change_listener,
      change   IMPORTING iv_new_amount TYPE decfloat34.
  PRIVATE SECTION.
    DATA: ms_data      TYPE order_data,
          mt_listeners TYPE TABLE OF REF TO if_order_change_listener.
ENDCLASS.

CLASS cl_order IMPLEMENTATION.
  METHOD register.
    APPEND io_listener TO mt_listeners.
  ENDMETHOD.
  METHOD change.
    ms_data-amount = iv_new_amount.
    LOOP AT mt_listeners INTO DATA(lo_listener).
      lo_listener->on_order_changed( ms_data ).
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
```

ABAP also has **classic events** (`EVENTS`, `RAISE EVENT`, `SET HANDLER`). Use them where SAP frameworks expect events (e.g. ALV grid). For business logic, the interface-based observer above is clearer.

### 5. Decorator

Add a cross-cutting concern without modifying the wrapped class.

```abap
CLASS cl_logging_pricing DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    INTERFACES if_pricing.
    METHODS constructor IMPORTING io_inner TYPE REF TO if_pricing.
  PRIVATE SECTION.
    DATA mo_inner TYPE REF TO if_pricing.
ENDCLASS.

CLASS cl_logging_pricing IMPLEMENTATION.
  METHOD constructor.
    me->mo_inner = io_inner.
  ENDMETHOD.
  METHOD if_pricing~compute.
    log( |compute called with { is_order-id }| ).
    rv_result = mo_inner->compute( is_order ).
    log( |result = { rv_result }| ).
  ENDMETHOD.
ENDCLASS.

" usage
DATA(lo_pricing) = CAST if_pricing(
  NEW cl_logging_pricing( NEW cl_real_pricing( ) ) ).
```

### 6. Null Object

Replace nullable references with a do-nothing implementation. Callers never check `IS BOUND`.

```abap
CLASS cl_null_audit DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    INTERFACES if_audit.
ENDCLASS.

CLASS cl_null_audit IMPLEMENTATION.
  METHOD if_audit~log.
    " intentionally empty
  ENDMETHOD.
ENDCLASS.

" factory returns null object when no auditor configured
METHOD get_auditor.
  IF mv_audit_disabled = abap_true.
    ro_result = NEW cl_null_audit( ).
  ELSE.
    ro_result = NEW cl_real_audit( ).
  ENDIF.
ENDMETHOD.
```

### 7. Singleton

Ensure one instance per application lifetime. Use `CREATE PRIVATE` to block external `NEW`, and a `CLASS-METHODS get_instance` factory that lazily creates — and caches — the single object.

```abap
CLASS cl_request_log DEFINITION PUBLIC CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS get_instance RETURNING VALUE(ro_result) TYPE REF TO cl_request_log.
    METHODS add IMPORTING iv_text TYPE string.
    METHODS entries RETURNING VALUE(rt_result) TYPE string_table.
  PRIVATE SECTION.
    CLASS-DATA mo_instance TYPE REF TO cl_request_log.
    DATA mt_log TYPE string_table.
ENDCLASS.

CLASS cl_request_log IMPLEMENTATION.
  METHOD get_instance.
    IF mo_instance IS NOT BOUND.
      mo_instance = NEW cl_request_log( ).
    ENDIF.
    ro_result = mo_instance.
  ENDMETHOD.
  METHOD add.
    APPEND iv_text TO mt_log.
  ENDMETHOD.
  METHOD entries.
    rt_result = mt_log.
  ENDMETHOD.
ENDCLASS.

" Usage — always the same object
DATA(lo_log) = cl_request_log=>get_instance( ).
lo_log->add( `Request 1` ).
DATA(lo_same_log) = cl_request_log=>get_instance( ).  " same instance
```

**Anti-pattern warning:** Singletons hold static state that survives between test runs, making tests order-dependent. Prefer constructor injection for collaborators — only use singleton for truly global, process-lifetime concerns (application logging, read-only configuration caches). Never use singleton for business objects.

Source: [SAP-samples/abap-cheat-sheets — 34_OO_Design_Patterns.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/34_OO_Design_Patterns.md)

### 8. Adapter

Wrap a legacy or third-party class behind an interface your code expects. The adapter implements your interface and delegates to the wrapped class, translating signatures as needed.

```abap
" Legacy class — incompatible signature
CLASS cl_legacy_printer DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS print_raw IMPORTING iv_xstr TYPE xstring.
ENDCLASS.

" Desired interface
INTERFACE if_printer PUBLIC.
  METHODS print IMPORTING iv_text TYPE string.
ENDINTERFACE.

" Adapter: implements the desired interface, wraps the legacy class
CLASS cl_legacy_printer_adapter DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    INTERFACES if_printer.
    METHODS constructor IMPORTING io_legacy TYPE REF TO cl_legacy_printer.
  PRIVATE SECTION.
    DATA mo_legacy TYPE REF TO cl_legacy_printer.
ENDCLASS.

CLASS cl_legacy_printer_adapter IMPLEMENTATION.
  METHOD constructor.
    me->mo_legacy = io_legacy.
  ENDMETHOD.
  METHOD if_printer~print.
    DATA(lv_xstr) = cl_abap_conv_codepage=>create_out( )->convert( iv_text ).
    mo_legacy->print_raw( lv_xstr ).
  ENDMETHOD.
ENDCLASS.

" Usage — caller only knows if_printer
DATA(lo_printer) = CAST if_printer(
  NEW cl_legacy_printer_adapter( NEW cl_legacy_printer( ) ) ).
lo_printer->print( `Hello` ).
```

**When to use:** Integrating legacy code, third-party classes, or external APIs without modifying them. The adapter keeps incompatible code out of your domain layer. Prefer adapter over modifying the legacy class when you cannot or must not change it.

Source: [SAP-samples/abap-cheat-sheets — 34_OO_Design_Patterns.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/34_OO_Design_Patterns.md)

### More GoF patterns (catalog)

The remaining classic GoF patterns are kept as concise ABAP shapes in [examples/pattern-snippets.md](examples/pattern-snippets.md) — each a short skeleton plus a one-line "when to use":

- **Builder** — assemble a complex object in ordered steps via an abstract builder + director.
- **Composite** — leaf and composite share one interface; the composite recurses over children.
- **Command** — wrap an operation (plus its data and `undo`) as a storable object.
- **Iterator** — `get_next`/`has_next` traversal that hides the collection's internals.
- **State** — one class per behavior; swap the state object to change behavior at runtime.
- **Visitor** — add operations to a stable structure without editing it; each op is a visitor.
- **Facade** — one simple method over a subsystem of collaborating classes.
- **Proxy** — same interface as the real subject, adding access control / logging / lazy creation.
- **Chain of Responsibility** — each handler processes the request or forwards to `next`.
- **Abstract Factory** — one concrete factory per variant creates a compatible family of objects.
- **Prototype** — `clone` returns a copy of an object's current state.
- **Memento** — opaque state snapshot (`CREATE PRIVATE` + friendship) for undo/restore.
- **Mediator** — members communicate only through a central mediator, cutting N-to-N coupling.
- **Flyweight** — cache shared heavy data in flyweights keyed in a factory; pass unique state per call.

## Exception class design

ABAP has three exception class types. See [references/exception-design.md](references/exception-design.md) for the full decision tree.

### Quick rules

- Inherit from `CX_STATIC_CHECK` when callers should *handle* the error case (validation failure, business rule violation, "not found" in a context where the caller might continue with a default).
- Inherit from `CX_DYNAMIC_CHECK` when the error is environmental and rare (DB down, RFC timeout) — callers usually let it propagate, but compiler doesn't force the `RAISING` declaration.
- Inherit from `CX_NO_CHECK` for exceptional-but-catchable failures that a framework boundary must still log or shut down on cleanly. For a pure programming-error invariant ("this can only happen if there's a bug"), use `ASSERT` instead — it dumps unconditionally and cannot be caught, so never guard a condition with it that bad input, timing, or user action could plausibly trigger in production; see [references/exception-design.md](references/exception-design.md).
- One exception class per **failure category**, not per **call site**. `cx_invoice_not_found` (good) vs `cx_get_invoice_failed` (bad — what's the failure?).
- Use `MESSAGE` interface (`if_t100_message`) on the exception class so messages can be displayed by callers without re-translating.
- T100 placeholders (`&1..&4`) hold **50 characters each** and `get_text( )` about 200 — never a URL or an HTTP body. Carry long diagnostics in a `READ-ONLY mv_long_text` attribute and expose `get_long_text( )`; see [references/exception-design.md](references/exception-design.md).
- Always preserve `previous` when wrapping: `RAISE EXCEPTION TYPE cx_x EXPORTING previous = lo_old.`

## God class — splitting playbook

When a class is 2000+ lines:

1. **Find the responsibilities.** Group methods by what data they touch. A class touching `customer-*`, `invoice-*`, and `transport_doc-*` is three classes.
2. **Find the public API.** What does the *outside* of the class need? That's the keeper class's public methods. Everything else can move.
3. **Extract the data first.** Long classes usually have huge `PRIVATE` attribute lists. Group related attributes into structures or smaller classes.
4. **Extract the helpers second.** Pure functions with no `me->` access are easiest to extract — they can become static methods on a new helper class with no further changes.
5. **Refactor the consumers last.** Keep the public API stable until the inside is split; then redirect consumers in a follow-up transport.
6. **One transport per major split** so reverts are clean.

## Class visibility

```abap
PUBLIC SECTION.
    " The API. Keep small. Each method here is a promise.
    INTERFACES if_pricing.
    CLASS-METHODS for_country …

PROTECTED SECTION.
    " Subclasses can override these. Empty unless the class is designed for extension.
    METHODS validate REDEFINITION.

PRIVATE SECTION.
    " Implementation detail. Default home for everything not explicitly designed otherwise.
    DATA …
    METHODS internal_helper …
```

Default to `PRIVATE`. Promote to `PROTECTED` only when a real subclass needs it. Promote to `PUBLIC` only when an outside caller needs it.

- Methods can also be `FINAL` to prevent overriding without making the entire class final. Use when a specific method's implementation is an invariant the subclass must not change (e.g. an orchestrator step sequence, a security check, a logging wrapper) — the class remains extensible for other methods while protecting the critical one.

## ABAP-specific anti-patterns

| Anti-pattern | Why it hurts | Fix |
|---|---|---|
| `cl_helper`, `cl_util`, `cl_manager` | The class has no responsibility — it's a dumping ground | Find the actual responsibility; rename and split |
| Public attributes (`DATA: attribute_value TYPE i.` in `PUBLIC SECTION`) | No control over invariants; can't add validation | Make private; expose getter |
| Static everything (`CLASS-METHODS` only, no instance) | Untestable singleton in disguise | Instance methods + injection |
| Singleton called from constructor of caller | Hidden dependency; can't substitute for test | Constructor parameter for the dependency |
| Switch on type within a base class | Inverted design — the base knows its subclasses | Make the operation abstract; override per subclass |
| Public attribute access from another class | Tight coupling | Method on the owning class |
| 10 `EXPORTING` parameters | The method does too much | Split, or return a structure |
| Friends declared to a "test class" left in production code | Production exposed for test convenience | Declare `CLASS zcl_x DEFINITION LOCAL FRIENDS ltc_test` in the test include only |
| Catching `CX_ROOT` at every layer | Hides bugs; no recovery, just silence | Catch specific exception types; let others propagate |

## Common Mistakes

| Mistake | Fix |
|---|---|
| Designing inheritance hierarchies before any concrete need | Use composition; add hierarchy only when a second subtype actually arrives |
| One exception class per failing method | One per failure *category*; the call site is documentation |
| Technical detail (URL, response body) stuffed into `MESSAGE … WITH` placeholders | 50 chars per placeholder — classifier in the placeholders, full text in `mv_long_text` / `get_long_text( )` |
| `IS BOUND` checks scattered everywhere | Null object pattern, or fail fast with `RAISE` at the boundary |
| Using `EVENTS` for business logic when an interface fits | Interface observer keeps the contract typed |
| Designing for "what if we need to swap the DB" | YAGNI — first need usually never arrives; design for actual swap when actual swap appears |
| Public attribute "for performance" | The cost is a method call; profile before optimizing |

## References

- [references/oo-language.md](references/oo-language.md) — core OO language mechanics (classes, inheritance, interfaces, events, casting, friends)
- [references/exception-design.md](references/exception-design.md) — full exception class decision tree
- [examples/pattern-snippets.md](examples/pattern-snippets.md) — factory, strategy, template-method, observer, singleton, adapter + the rest of the GoF catalog
- **Clean ABAP — classes/objects/exceptions:** https://github.com/SAP/styleguides/blob/main/clean-abap/CleanABAP.md
- **ABAP Keyword Documentation — ABAP Objects:** https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm
- **SAP-samples/abap-cheat-sheets — ABAP OO topics, exception classes:** https://github.com/SAP-samples/abap-cheat-sheets
- Linked skills: [abap-clean-style](../abap-clean-style/SKILL.md), [abap-unit-tdd](../abap-unit-tdd/SKILL.md), [rap-bo-modeling](../rap-bo-modeling/SKILL.md)
