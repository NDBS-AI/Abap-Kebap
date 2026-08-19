# OO Pattern Snippets — ABAP Examples

Self-contained reference implementations. Use them as templates; rename the domain (`pricing`, `audit`, `report`) to whatever you're modeling.

---

## Factory with `CREATE PRIVATE`

```abap
INTERFACE if_pricing PUBLIC.
  METHODS compute IMPORTING order TYPE order_data
                  RETURNING VALUE(result) TYPE decfloat34.
ENDINTERFACE.

CLASS cl_pricing DEFINITION PUBLIC CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS for_country
      IMPORTING country       TYPE land1
      RETURNING VALUE(result) TYPE REF TO if_pricing
      RAISING   cx_unknown_country.
ENDCLASS.

"Concrete classes implement the interface (no inheritance from the factory —
"a subclass of a CREATE PRIVATE class could not be instantiated, not even by
"the factory, unless friendship is granted). CREATE PRIVATE + GLOBAL FRIENDS
"routes all construction through the factory.
CLASS cl_pricing_tr DEFINITION PUBLIC FINAL CREATE PRIVATE
  GLOBAL FRIENDS cl_pricing.
  PUBLIC SECTION.
    INTERFACES if_pricing.
ENDCLASS.
CLASS cl_pricing_de DEFINITION PUBLIC FINAL CREATE PRIVATE
  GLOBAL FRIENDS cl_pricing.
  PUBLIC SECTION.
    INTERFACES if_pricing.
ENDCLASS.

CLASS cl_pricing IMPLEMENTATION.
  METHOD for_country.
    CASE country.
      WHEN 'TR'. result = NEW cl_pricing_tr( ).
      WHEN 'DE'. result = NEW cl_pricing_de( ).
      WHEN OTHERS.
        RAISE EXCEPTION TYPE cx_unknown_country EXPORTING country = country.
    ENDCASE.
  ENDMETHOD.
ENDCLASS.

CLASS cl_pricing_tr IMPLEMENTATION.
  METHOD if_pricing~compute.
    result = order-amount * '1.20'.   " 20% KDV
  ENDMETHOD.
ENDCLASS.
```

Adding a new country = new implementing class + one new `WHEN`. Caller cannot bypass the factory.

---

## Strategy via constructor injection

```abap
INTERFACE if_rate_provider PUBLIC.
  METHODS rate IMPORTING currency TYPE waers
               RETURNING VALUE(result) TYPE decfloat34
               RAISING   cx_rate_unavailable.
ENDINTERFACE.

CLASS cl_order_pricing DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    METHODS:
      constructor IMPORTING rate_provider TYPE REF TO if_rate_provider,
      total_in_eur
        IMPORTING order TYPE order_data
        RETURNING VALUE(result) TYPE decfloat34
        RAISING   cx_rate_unavailable.
  PRIVATE SECTION.
    DATA rate_provider TYPE REF TO if_rate_provider.
ENDCLASS.

CLASS cl_order_pricing IMPLEMENTATION.
  METHOD constructor.
    me->rate_provider = rate_provider.
  ENDMETHOD.

  METHOD total_in_eur.
    DATA(rate) = rate_provider->rate( order-currency ).
    result = order-amount * rate.
  ENDMETHOD.
ENDCLASS.

" --- in tests ---
CLASS ltcl_fake_rate DEFINITION FOR TESTING.
  PUBLIC SECTION.
    INTERFACES if_rate_provider.
ENDCLASS.

CLASS ltcl_fake_rate IMPLEMENTATION.
  METHOD if_rate_provider~rate.
    result = '1.50'.   " always 1.50
  ENDMETHOD.
ENDCLASS.

" cl_order_pricing( NEW ltcl_fake_rate( ) ) — testable without a network call
```

---

## Template method

```abap
CLASS cl_report DEFINITION PUBLIC ABSTRACT.
  PUBLIC SECTION.
    METHODS run FINAL.
  PROTECTED SECTION.
    METHODS:
      fetch       ABSTRACT,
      transform   ABSTRACT,
      display.
ENDCLASS.

CLASS cl_report IMPLEMENTATION.
  METHOD run.
    fetch( ).
    transform( ).
    display( ).
  ENDMETHOD.

  METHOD display.
    " default ALV; subclasses can override
  ENDMETHOD.
ENDCLASS.

CLASS cl_overdue_invoice_report DEFINITION
  PUBLIC FINAL
  INHERITING FROM cl_report.
  PROTECTED SECTION.
    METHODS:
      fetch     REDEFINITION,
      transform REDEFINITION.
ENDCLASS.

CLASS cl_overdue_invoice_report IMPLEMENTATION.
  METHOD fetch.
    " select from vbrk, vbrp …
  ENDMETHOD.
  METHOD transform.
    " enrich, compute, sort
  ENDMETHOD.
ENDCLASS.
```

The orchestrator is `FINAL` — subclasses can't reorder the steps, only fill them in.

---

## Observer (interface-based, no classic events)

```abap
INTERFACE if_order_listener PUBLIC.
  METHODS on_changed IMPORTING order TYPE order_data.
ENDINTERFACE.

CLASS cl_order DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    METHODS:
      register IMPORTING listener TYPE REF TO if_order_listener,
      set_amount IMPORTING amount TYPE decfloat34.
  PRIVATE SECTION.
    DATA: data      TYPE order_data,
          listeners TYPE TABLE OF REF TO if_order_listener.
ENDCLASS.

CLASS cl_order IMPLEMENTATION.
  METHOD register.
    APPEND listener TO listeners.
  ENDMETHOD.
  METHOD set_amount.
    data-amount = amount.
    LOOP AT listeners INTO DATA(listener).
      listener->on_changed( data ).
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.

CLASS cl_audit_listener DEFINITION FOR TESTING.
  PUBLIC SECTION.
    INTERFACES if_order_listener.
ENDCLASS.

CLASS cl_audit_listener IMPLEMENTATION.
  METHOD if_order_listener~on_changed.
    " write to audit log
  ENDMETHOD.
ENDCLASS.
```

Use classic ABAP `EVENTS` only when a framework (e.g. ALV grid) requires them. For business logic the interface observer is typed and IDE-friendly.

---

## 5. Singleton

One instance per internal session. `CREATE PRIVATE` blocks `NEW` outside the class; `get_instance` lazily creates and caches the single object in a static attribute.

```abap
CLASS cl_app_log DEFINITION PUBLIC CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS get_instance RETURNING VALUE(result) TYPE REF TO cl_app_log.
    METHODS add   IMPORTING text TYPE string.
    METHODS lines RETURNING VALUE(result) TYPE string_table.
  PRIVATE SECTION.
    CLASS-DATA instance TYPE REF TO cl_app_log.
    DATA entries TYPE string_table.
ENDCLASS.

CLASS cl_app_log IMPLEMENTATION.
  METHOD get_instance.
    IF instance IS NOT BOUND.
      instance = NEW cl_app_log( ).
    ENDIF.
    result = instance.
  ENDMETHOD.

  METHOD add.
    APPEND text TO entries.
  ENDMETHOD.

  METHOD lines.
    result = entries.
  ENDMETHOD.
ENDCLASS.

" All callers share the same object
DATA(log_a) = cl_app_log=>get_instance( ).
log_a->add( `event 1` ).

DATA(log_b) = cl_app_log=>get_instance( ).  " same instance as log_a
log_b->add( `event 2` ).

ASSERT log_a->lines( ) = log_b->lines( ).  " same table
```

Prefer constructor injection for business collaborators; reserve singleton for truly global concerns (logging, read-only caches).

Source: [SAP-samples/abap-cheat-sheets — 34_OO_Design_Patterns.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/34_OO_Design_Patterns.md)

---

## 6. Adapter

Wrap an incompatible API behind an interface your code expects. The adapter class implements the desired interface and delegates to the wrapped (legacy) class, translating method signatures and data types as needed.

```abap
" Existing legacy class with a different signature
CLASS cl_legacy_fax DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS send_raw IMPORTING xstr TYPE xstring
                               dest TYPE string.
ENDCLASS.

CLASS cl_legacy_fax IMPLEMENTATION.
  METHOD send_raw.
    " ... hardware-level fax send ...
  ENDMETHOD.
ENDCLASS.

" Target interface that the rest of the application uses
INTERFACE if_notifier PUBLIC.
  METHODS notify IMPORTING message TYPE string
                           recipient TYPE string.
ENDINTERFACE.

" Adapter: bridge between if_notifier and cl_legacy_fax
CLASS cl_fax_adapter DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    INTERFACES if_notifier.
    METHODS constructor IMPORTING fax TYPE REF TO cl_legacy_fax.
  PRIVATE SECTION.
    DATA fax TYPE REF TO cl_legacy_fax.
ENDCLASS.

CLASS cl_fax_adapter IMPLEMENTATION.
  METHOD constructor.
    me->fax = fax.
  ENDMETHOD.

  METHOD if_notifier~notify.
    DATA(xstr) = cl_abap_conv_codepage=>create_out( )->convert( message ).
    fax->send_raw( xstr = xstr dest = recipient ).
  ENDMETHOD.
ENDCLASS.

" Caller only depends on if_notifier — legacy fax is invisible
DATA(notifier) = CAST if_notifier(
  NEW cl_fax_adapter( NEW cl_legacy_fax( ) ) ).
notifier->notify( message = `Invoice approved` recipient = `+491234567` ).
```

Use when you cannot modify the existing class (package barrier, third-party, generated code) but must integrate it into your domain's interface contract.

Source: [SAP-samples/abap-cheat-sheets — 34_OO_Design_Patterns.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/34_OO_Design_Patterns.md)

---

# Remaining GoF patterns — catalog

Concise ABAP shapes for the rest of the GoF catalog. Each is a sketch of the *structure*, not a full demo. Syntax follows [cheat sheet 34 — OO Design Patterns](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/34_OO_Design_Patterns.md) (executable demos on its `oo_patterns` branch). When in doubt, prefer composition and interfaces.

---

## 7. Builder

```abap
" Abstract builder: the common build steps
CLASS lcl_itab_builder DEFINITION ABSTRACT CREATE PUBLIC.
  PUBLIC SECTION.
    DATA itab TYPE REF TO data.
    METHODS: build_type_info ABSTRACT,
             build_components ABSTRACT,
             build_table_type ABSTRACT,
             build_data_object ABSTRACT.
ENDCLASS.

CLASS lcl_builder_std_itab DEFINITION INHERITING FROM lcl_itab_builder.
  PUBLIC SECTION.
    METHODS: build_type_info REDEFINITION, build_components REDEFINITION,
             build_table_type REDEFINITION, build_data_object REDEFINITION.
ENDCLASS.

" Director/provider: drives the steps in the right order, hides them
CLASS lcl_itab_provider DEFINITION FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS create_itab IMPORTING kind TYPE i RETURNING VALUE(result) TYPE REF TO lcl_itab_builder.
ENDCLASS.
CLASS lcl_itab_provider IMPLEMENTATION.
  METHOD create_itab.
    DATA(build) = CAST lcl_itab_builder( NEW lcl_builder_std_itab( ) ).
    build->build_type_info( ).  build->build_components( ).
    build->build_table_type( ). build->build_data_object( ).
    result = build.
  ENDMETHOD.
ENDCLASS.
```

Use when constructing a complex object takes several ordered steps and you want variants that share the same build flow without exposing the steps to callers.

---

## 8. Composite

```abap
INTERFACE lif_org PUBLIC.
  METHODS: get_headcount RETURNING VALUE(headcount) TYPE i,
           get_salary    RETURNING VALUE(total_salary) TYPE decfloat34.
ENDINTERFACE.

" Leaf — no subordinates
CLASS lcl_employee DEFINITION.
  PUBLIC SECTION. INTERFACES lif_org.
  PRIVATE SECTION. DATA salary TYPE decfloat34.
ENDCLASS.
CLASS lcl_employee IMPLEMENTATION.
  METHOD lif_org~get_headcount. headcount = 1. ENDMETHOD.
  METHOD lif_org~get_salary.    total_salary = salary. ENDMETHOD.
ENDCLASS.

" Composite — delegates to subordinates recursively
CLASS lcl_manager DEFINITION.
  PUBLIC SECTION.
    INTERFACES lif_org.
    METHODS add_subordinate IMPORTING node TYPE REF TO lif_org.
  PRIVATE SECTION.
    DATA: salary TYPE decfloat34,
          subordinates TYPE TABLE OF REF TO lif_org.
ENDCLASS.
CLASS lcl_manager IMPLEMENTATION.
  METHOD add_subordinate. APPEND node TO subordinates. ENDMETHOD.
  METHOD lif_org~get_headcount.
    headcount = 1.
    LOOP AT subordinates INTO DATA(subordinate).
      headcount += subordinate->get_headcount( ).
    ENDLOOP.
  ENDMETHOD.
  METHOD lif_org~get_salary.
    total_salary = salary.
    LOOP AT subordinates INTO DATA(subordinate).
      total_salary += subordinate->get_salary( ).
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
```

Use when objects form a tree (org chart, BOM, folder structure) and clients should treat individual leaves and whole subtrees uniformly through one interface.

---

## 9. Command

```abap
INTERFACE lif_command PUBLIC.
  METHODS: execute, undo.
ENDINTERFACE.

" Receiver — performs the real work
CLASS lcl_receiver DEFINITION.
  PUBLIC SECTION. METHODS resize IMPORTING width TYPE i height TYPE i.
ENDCLASS.

" Concrete command — wraps an operation + its data, delegates to the receiver
CLASS lcl_cmd_resize DEFINITION.
  PUBLIC SECTION.
    INTERFACES lif_command.
    METHODS constructor IMPORTING receiver TYPE REF TO lcl_receiver
                                  width TYPE i height TYPE i.
  PRIVATE SECTION.
    DATA: rec TYPE REF TO lcl_receiver, wd TYPE i, ht TYPE i,
          prev_wd TYPE i, prev_ht TYPE i.
ENDCLASS.
CLASS lcl_cmd_resize IMPLEMENTATION.
  METHOD constructor. rec = receiver. wd = width. ht = height. ENDMETHOD.
  METHOD lif_command~execute. rec->resize( width = wd height = ht ). ENDMETHOD.
  METHOD lif_command~undo.    rec->resize( width = prev_wd height = prev_ht ). ENDMETHOD.
ENDCLASS.
```

Use when you must queue, log, parameterize, or undo/redo operations — each operation becomes a storable object decoupled from the invoker that triggers it.

---

## 10. Iterator

```abap
INTERFACE lif_iterator PUBLIC.
  METHODS: get_next RETURNING VALUE(item) TYPE string,
           has_next RETURNING VALUE(result) TYPE abap_boolean,
           reset.
ENDINTERFACE.

INTERFACE lif_collection PUBLIC.
  METHODS: get_iterator RETURNING VALUE(it) TYPE REF TO lif_iterator,
           get_item_at_position IMPORTING idx TYPE i RETURNING VALUE(item) TYPE string,
           get_number_of_items RETURNING VALUE(item_count) TYPE i.
ENDINTERFACE.

CLASS lcl_iterator DEFINITION.
  PUBLIC SECTION.
    INTERFACES lif_iterator.
    METHODS constructor IMPORTING collection TYPE REF TO lif_collection.
  PRIVATE SECTION.
    DATA: coll TYPE REF TO lif_collection, index TYPE i.
ENDCLASS.
CLASS lcl_iterator IMPLEMENTATION.
  METHOD constructor. coll = collection. index = 0. ENDMETHOD.
  METHOD lif_iterator~has_next. result = xsdbool( index < coll->get_number_of_items( ) ). ENDMETHOD.
  METHOD lif_iterator~get_next. index += 1. item = coll->get_item_at_position( index ). ENDMETHOD.
  METHOD lif_iterator~reset. index = 0. ENDMETHOD.
ENDCLASS.
```

Use when you need to traverse a collection sequentially without exposing its internal representation — often unnecessary in ABAP given `LOOP AT`, but useful for custom or guarded traversal order.

---

## 11. State

```abap
INTERFACE lif_calc PUBLIC.
  DATA number TYPE i.
  METHODS calculate IMPORTING value TYPE i RETURNING VALUE(result) TYPE i.
ENDINTERFACE.

CLASS lcl_state_addition DEFINITION.
  PUBLIC SECTION. INTERFACES lif_calc.
ENDCLASS.
CLASS lcl_state_addition IMPLEMENTATION.
  METHOD lif_calc~calculate.
    result = lif_calc~number + value.
    lif_calc~number = result.
  ENDMETHOD.
ENDCLASS.
" lcl_state_subtraction, lcl_state_multiplication implement lif_calc~calculate differently

" Context: behavior changes by swapping the state object
CLASS lcl_math DEFINITION.
  PUBLIC SECTION.
    METHODS: set_state IMPORTING state TYPE REF TO lif_calc,
             execute   IMPORTING value TYPE i RETURNING VALUE(result) TYPE i.
  PRIVATE SECTION. DATA state_ref TYPE REF TO lif_calc.
ENDCLASS.
CLASS lcl_math IMPLEMENTATION.
  METHOD set_state. state_ref = state. ENDMETHOD.
  METHOD execute.
    IF state_ref IS BOUND. result = state_ref->calculate( value ). ENDIF.
  ENDMETHOD.
ENDCLASS.
```

Use when an object's behavior must change with its internal state and you want to replace a sprawling `CASE state` with one state object per behavior.

---

## 12. Visitor

```abap
CLASS lcl_visited DEFINITION DEFERRED.

INTERFACE lif_visitor PUBLIC.
  DATA result_string TYPE string.
  METHODS visit IMPORTING oref TYPE REF TO lcl_visited.
ENDINTERFACE.

" The visited object accepts a visitor and hands itself over
CLASS lcl_visited DEFINITION.
  PUBLIC SECTION.
    METHODS: get_itab_content_ref RETURNING VALUE(content) TYPE REF TO data,
             receive_visitor IMPORTING obj TYPE REF TO lif_visitor.
  PRIVATE SECTION. DATA table_data_ref TYPE REF TO data.
ENDCLASS.
CLASS lcl_visited IMPLEMENTATION.
  METHOD receive_visitor. obj->visit( me ). ENDMETHOD.
  METHOD get_itab_content_ref. content = table_data_ref. ENDMETHOD.
ENDCLASS.

" Each visitor adds a new operation without touching lcl_visited
CLASS lcl_visitor_json DEFINITION.
  PUBLIC SECTION. INTERFACES lif_visitor.
ENDCLASS.
CLASS lcl_visitor_json IMPLEMENTATION.
  METHOD lif_visitor~visit.
    DATA(ref) = oref->get_itab_content_ref( ).
    lif_visitor~result_string = /ui2/cl_json=>serialize( ref->* ).
  ENDMETHOD.
ENDCLASS.
```

Use when you need to add new operations over a stable object structure without bloating its class — each new operation is a new visitor (JSON, XML, count, …).

---

## 13. Facade

```abap
" Hides creation of, and calls to, several collaborating classes behind one method
CLASS lcl_travel_facade DEFINITION.
  PUBLIC SECTION.
    METHODS plan_travel
      IMPORTING from TYPE string to TYPE string
                arrival TYPE d departure TYPE d
      RETURNING VALUE(options) TYPE string_table.
ENDCLASS.
CLASS lcl_travel_facade IMPLEMENTATION.
  METHOD plan_travel.
    DATA(flights) = NEW lcl_flight_search( ).
    DATA(hotels)  = NEW lcl_hotel_search( ).
    DATA(cars)    = NEW lcl_rental_car_search( ).
    APPEND LINES OF flights->search_flights( from = from to = to arrival = arrival departure = departure ) TO options.
    APPEND LINES OF hotels->search_hotel( destination = to arrival = arrival departure = departure ) TO options.
    APPEND LINES OF cars->search_rental_car( destination = to arrival = arrival departure = departure ) TO options.
  ENDMETHOD.
ENDCLASS.
```

Use when a subsystem requires creating several objects and calling methods in a particular order — a facade gives callers one simple entry point and hides the wiring.

---

## 14. Proxy

```abap
INTERFACE lif_user_info PUBLIC.
  METHODS get_user_info IMPORTING user_id TYPE string RETURNING VALUE(info) TYPE string.
ENDINTERFACE.

CLASS lcl_proxy DEFINITION DEFERRED.
" Real subject — only the proxy (a friend) may instantiate it
CLASS lcl_user_info DEFINITION CREATE PRIVATE FRIENDS lcl_proxy.
  PUBLIC SECTION. INTERFACES lif_user_info.
ENDCLASS.

" Proxy — same interface; adds access control + logging, delegates when
" allowed. Access control is a genuine AUTHORITY-CHECK against the calling
" user's own authorizations - never a literal username/password comparison
" in code (that is not how ABAP authorization works, and a hard-coded
" credential is a secret leak besides).
CLASS lcl_proxy DEFINITION.
  PUBLIC SECTION.
    INTERFACES lif_user_info.
    METHODS constructor RAISING lcx_error.
  PRIVATE SECTION. DATA oref TYPE REF TO lcl_user_info.
ENDCLASS.
CLASS lcl_proxy IMPLEMENTATION.
  METHOD constructor.
    AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
      ID 'ACTVT' FIELD '03'.                  " 03 = display
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE lcx_error.
    ENDIF.
    oref = NEW lcl_user_info( ).
  ENDMETHOD.
  METHOD lif_user_info~get_user_info.
    info = oref->lif_user_info~get_user_info( user_id ).
  ENDMETHOD.
ENDCLASS.
```

Use when you need a stand-in for another object to add access control, logging, lazy creation, or remote access — without changing the real subject.

---

## 15. Chain of Responsibility

```abap
INTERFACE lif_handler PUBLIC.
  METHODS: process IMPORTING tdo TYPE REF TO cl_abap_typedescr
                   RETURNING VALUE(info) TYPE string_table,
           set_handler IMPORTING iref TYPE REF TO lif_handler.
ENDINTERFACE.

CLASS lcl_base_handler DEFINITION ABSTRACT.
  PUBLIC SECTION. INTERFACES lif_handler.
  PROTECTED SECTION. DATA next TYPE REF TO lif_handler.
ENDCLASS.
CLASS lcl_base_handler IMPLEMENTATION.
  METHOD lif_handler~set_handler. next = iref. ENDMETHOD.
  METHOD lif_handler~process.
    IF next IS INITIAL. APPEND `Cannot handle request` TO info.
    ELSE.              info = next->process( tdo ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.

CLASS lcl_elem_handler DEFINITION INHERITING FROM lcl_base_handler.
  PUBLIC SECTION. METHODS lif_handler~process REDEFINITION.
ENDCLASS.
CLASS lcl_elem_handler IMPLEMENTATION.
  METHOD lif_handler~process.
    IF tdo IS INSTANCE OF cl_abap_elemdescr.
      APPEND `Handled by elem handler` TO info.
    ELSE.
      info = super->lif_handler~process( tdo ).   "pass down the chain
    ENDIF.
  ENDMETHOD.
ENDCLASS.
```

Use when a request can be handled by one of several handlers and you don't know in advance which — each handler either processes it or forwards to the next in the chain.

---

## 16. Abstract Factory

```abap
" Abstract products
CLASS starters     DEFINITION ABSTRACT. PUBLIC SECTION. METHODS serve ABSTRACT. ENDCLASS.
CLASS main_dishes  DEFINITION ABSTRACT. PUBLIC SECTION. METHODS serve ABSTRACT. ENDCLASS.
CLASS desserts     DEFINITION ABSTRACT. PUBLIC SECTION. METHODS serve ABSTRACT. ENDCLASS.

" Abstract factory: creates a whole *family* of related products
CLASS menu_factory DEFINITION ABSTRACT.
  PUBLIC SECTION.
    METHODS: create_starters    ABSTRACT RETURNING VALUE(result) TYPE REF TO starters,
             create_main_dishes ABSTRACT RETURNING VALUE(result) TYPE REF TO main_dishes,
             create_desserts    ABSTRACT RETURNING VALUE(result) TYPE REF TO desserts.
ENDCLASS.

" Concrete factory per variant — only ever creates compatible products
CLASS italian_menu_creator DEFINITION INHERITING FROM menu_factory.
  PUBLIC SECTION.
    METHODS: create_starters REDEFINITION, create_main_dishes REDEFINITION,
             create_desserts REDEFINITION.
ENDCLASS.
CLASS italian_menu_creator IMPLEMENTATION.
  METHOD create_starters.    result = NEW starters_italian( ).    ENDMETHOD.
  METHOD create_main_dishes. result = NEW main_dishes_italian( ). ENDMETHOD.
  METHOD create_desserts.    result = NEW desserts_italian( ).    ENDMETHOD.
ENDCLASS.
```

Use when you must create families of related objects that have to stay compatible (an Italian menu, a vegan menu) — one concrete factory per variant guarantees consistent combinations.

---

## 17. Prototype

```abap
INTERFACE lif_prototype PUBLIC.
  METHODS clone RETURNING VALUE(ref) TYPE REF TO lif_prototype.
ENDINTERFACE.

CLASS lcl_prototype DEFINITION.
  PUBLIC SECTION.
    INTERFACES lif_prototype.
    METHODS constructor IMPORTING str TYPE string.
    DATA: txt TYPE string, itab TYPE string_table.
  PRIVATE SECTION. DATA private_text TYPE string.
ENDCLASS.
CLASS lcl_prototype IMPLEMENTATION.
  METHOD constructor. txt = str. private_text = `#`. ENDMETHOD.
  METHOD lif_prototype~clone.
    " object clones itself — can copy private state, or selectively exclude
    DATA(obj) = NEW lcl_prototype( txt ).
    obj->itab = me->itab.
    obj->private_text = me->private_text.
    ref = obj.
  ENDMETHOD.
ENDCLASS.
```

Use when creating a new object from scratch is expensive or complex, and you can instead clone a pre-configured prototype to reproduce its state.

---

## 18. Memento

```abap
" Memento — captures state; CREATE PRIVATE + friendship keeps it opaque
CLASS lcl DEFINITION DEFERRED.
CLASS lcl_memento DEFINITION FINAL CREATE PRIVATE FRIENDS lcl.
  PUBLIC SECTION. METHODS get_tag RETURNING VALUE(result) TYPE string.
  PRIVATE SECTION.
    METHODS constructor IMPORTING state TYPE string tag TYPE string.
    METHODS get_state RETURNING VALUE(result) TYPE string.
    DATA: state TYPE string, tag TYPE string.
ENDCLASS.
CLASS lcl_memento IMPLEMENTATION.
  METHOD constructor. me->state = state. me->tag = tag. ENDMETHOD.
  METHOD get_state. result = state. ENDMETHOD.
  METHOD get_tag.   result = tag.   ENDMETHOD.
ENDCLASS.

" Originator — creates and restores from mementos
CLASS lcl DEFINITION FINAL.
  PUBLIC SECTION.
    METHODS: save    RETURNING VALUE(memento) TYPE REF TO lcl_memento,
             restore IMPORTING memento TYPE REF TO lcl_memento.
  PRIVATE SECTION. DATA state TYPE string.
ENDCLASS.
CLASS lcl IMPLEMENTATION.
  METHOD save.    memento = NEW lcl_memento( state = state tag = `snapshot` ). ENDMETHOD.
  METHOD restore. state = memento->get_state( ). ENDMETHOD.
ENDCLASS.
```

Use when you need undo/redo or checkpoints — the memento captures an object's state so it can be restored later, without exposing the object's internals.

---

## 19. Mediator

```abap
INTERFACE lif_mediator PUBLIC.
  METHODS notify IMPORTING oref TYPE REF TO object event TYPE string.
ENDINTERFACE.

INTERFACE lif_member PUBLIC.
  METHODS set_mediator IMPORTING mediator_oref TYPE REF TO lif_mediator.
ENDINTERFACE.

" Members talk only to the mediator, never to each other
CLASS lcl_cart DEFINITION.
  PUBLIC SECTION.
    INTERFACES lif_member.
    METHODS add_product IMPORTING product TYPE string.
  PRIVATE SECTION. DATA mediator TYPE REF TO lif_mediator.
ENDCLASS.
CLASS lcl_cart IMPLEMENTATION.
  METHOD lif_member~set_mediator. mediator = mediator_oref. ENDMETHOD.
  METHOD add_product. mediator->notify( oref = me event = `item_added` ). ENDMETHOD.
ENDCLASS.

" Concrete mediator orchestrates: holds refs to all members, routes events
CLASS lcl_mediator DEFINITION.
  PUBLIC SECTION. INTERFACES lif_mediator.
  PRIVATE SECTION. DATA: cart TYPE REF TO lcl_cart, stock TYPE REF TO lcl_stock.
ENDCLASS.
```

Use when many objects interact in tangled ways — route all communication through a central mediator to cut the N-to-N coupling down to N-to-1.

---

## 20. Flyweight

```abap
INTERFACE lif_flyweight PUBLIC.
  METHODS notify IMPORTING customer_ref TYPE REF TO lcl_customer
                 RETURNING VALUE(msg) TYPE string_table.
ENDINTERFACE.

" Shareable object holds only the *shared* (intrinsic) state
CLASS lcl_flyweight DEFINITION FINAL.
  PUBLIC SECTION.
    INTERFACES lif_flyweight.
    METHODS constructor IMPORTING text TYPE string.
  PRIVATE SECTION. DATA text TYPE string.
ENDCLASS.

" Factory caches and reuses flyweights by key
CLASS lcl_flyweight_factory DEFINITION FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS get_flyweight_object IMPORTING event TYPE string
                                       RETURNING VALUE(obj) TYPE REF TO lif_flyweight.
  PRIVATE SECTION.
    TYPES: BEGIN OF ts, evt TYPE string, fw_obj TYPE REF TO lif_flyweight, END OF ts.
    CLASS-DATA cache TYPE HASHED TABLE OF ts WITH UNIQUE KEY evt.
ENDCLASS.
CLASS lcl_flyweight_factory IMPLEMENTATION.
  METHOD get_flyweight_object.
    READ TABLE cache WITH TABLE KEY evt = event INTO DATA(wa).
    IF sy-subrc = 0.
      obj = wa-fw_obj.                       "reuse the shared object
    ELSE.
      obj = NEW lcl_flyweight( text = event ).
      INSERT VALUE #( evt = event fw_obj = obj ) INTO TABLE cache.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
```

Use when you have many objects that share identical heavy data — store the shared part once in cached flyweights and pass the unique part in per call, to cut memory.

---

Source: [SAP-samples/abap-cheat-sheets — 34_OO_Design_Patterns.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/34_OO_Design_Patterns.md) (`oo_patterns` branch)
