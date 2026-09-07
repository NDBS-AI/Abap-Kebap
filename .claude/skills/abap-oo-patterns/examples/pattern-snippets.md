# OO Pattern Snippets — ABAP Examples

Self-contained reference implementations. Use them as templates; rename the domain (`pricing`, `audit`, `report`) to whatever you're modeling.

---

## Factory with `CREATE PRIVATE`

```abap
INTERFACE if_pricing PUBLIC.
  METHODS compute IMPORTING is_order TYPE order_data
                  RETURNING VALUE(rv_result) TYPE decfloat34.
ENDINTERFACE.

CLASS cl_pricing DEFINITION PUBLIC CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS for_country
      IMPORTING iv_country       TYPE land1
      RETURNING VALUE(ro_result) TYPE REF TO if_pricing
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
    CASE iv_country.
      WHEN 'TR'. ro_result = NEW cl_pricing_tr( ).
      WHEN 'DE'. ro_result = NEW cl_pricing_de( ).
      WHEN OTHERS.
        RAISE EXCEPTION TYPE cx_unknown_country EXPORTING country = iv_country.
    ENDCASE.
  ENDMETHOD.
ENDCLASS.

CLASS cl_pricing_tr IMPLEMENTATION.
  METHOD if_pricing~compute.
    rv_result = is_order-amount * '1.20'.   " 20% KDV
  ENDMETHOD.
ENDCLASS.
```

Adding a new country = new implementing class + one new `WHEN`. Caller cannot bypass the factory.

---

## Strategy via constructor injection

```abap
INTERFACE if_rate_provider PUBLIC.
  METHODS rate IMPORTING iv_currency TYPE waers
               RETURNING VALUE(rv_result) TYPE decfloat34
               RAISING   cx_rate_unavailable.
ENDINTERFACE.

CLASS cl_order_pricing DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    METHODS:
      constructor IMPORTING io_rate_provider TYPE REF TO if_rate_provider,
      total_in_eur
        IMPORTING is_order TYPE order_data
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

" --- in tests ---
CLASS ltcl_fake_rate DEFINITION FOR TESTING.
  PUBLIC SECTION.
    INTERFACES if_rate_provider.
ENDCLASS.

CLASS ltcl_fake_rate IMPLEMENTATION.
  METHOD if_rate_provider~rate.
    rv_result = '1.50'.   " always 1.50
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
  METHODS on_changed IMPORTING is_order TYPE order_data.
ENDINTERFACE.

CLASS cl_order DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    METHODS:
      register IMPORTING io_listener TYPE REF TO if_order_listener,
      set_amount IMPORTING iv_amount TYPE decfloat34.
  PRIVATE SECTION.
    DATA: ms_data      TYPE order_data,
          mt_listeners TYPE TABLE OF REF TO if_order_listener.
ENDCLASS.

CLASS cl_order IMPLEMENTATION.
  METHOD register.
    APPEND io_listener TO mt_listeners.
  ENDMETHOD.
  METHOD set_amount.
    ms_data-amount = iv_amount.
    LOOP AT mt_listeners INTO DATA(lo_listener).
      lo_listener->on_changed( ms_data ).
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
    CLASS-METHODS get_instance RETURNING VALUE(ro_result) TYPE REF TO cl_app_log.
    METHODS add   IMPORTING iv_text TYPE string.
    METHODS lines RETURNING VALUE(rt_result) TYPE string_table.
  PRIVATE SECTION.
    CLASS-DATA mo_instance TYPE REF TO cl_app_log.
    DATA mt_entries TYPE string_table.
ENDCLASS.

CLASS cl_app_log IMPLEMENTATION.
  METHOD get_instance.
    IF mo_instance IS NOT BOUND.
      mo_instance = NEW cl_app_log( ).
    ENDIF.
    ro_result = mo_instance.
  ENDMETHOD.

  METHOD add.
    APPEND iv_text TO mt_entries.
  ENDMETHOD.

  METHOD lines.
    rt_result = mt_entries.
  ENDMETHOD.
ENDCLASS.

" All callers share the same object
DATA(lo_log_a) = cl_app_log=>get_instance( ).
lo_log_a->add( `event 1` ).

DATA(lo_log_b) = cl_app_log=>get_instance( ).  " same instance as lo_log_a
lo_log_b->add( `event 2` ).

ASSERT lo_log_a->lines( ) = lo_log_b->lines( ).  " same table
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
    METHODS send_raw IMPORTING iv_xstr TYPE xstring
                               iv_dest TYPE string.
ENDCLASS.

CLASS cl_legacy_fax IMPLEMENTATION.
  METHOD send_raw.
    " ... hardware-level fax send ...
  ENDMETHOD.
ENDCLASS.

" Target interface that the rest of the application uses
INTERFACE if_notifier PUBLIC.
  METHODS notify IMPORTING iv_message TYPE string
                           iv_recipient TYPE string.
ENDINTERFACE.

" Adapter: bridge between if_notifier and cl_legacy_fax
CLASS cl_fax_adapter DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    INTERFACES if_notifier.
    METHODS constructor IMPORTING io_fax TYPE REF TO cl_legacy_fax.
  PRIVATE SECTION.
    DATA mo_fax TYPE REF TO cl_legacy_fax.
ENDCLASS.

CLASS cl_fax_adapter IMPLEMENTATION.
  METHOD constructor.
    me->mo_fax = io_fax.
  ENDMETHOD.

  METHOD if_notifier~notify.
    DATA(lv_xstr) = cl_abap_conv_codepage=>create_out( )->convert( iv_message ).
    mo_fax->send_raw( iv_xstr = lv_xstr iv_dest = iv_recipient ).
  ENDMETHOD.
ENDCLASS.

" Caller only depends on if_notifier — legacy fax is invisible
DATA(lo_notifier) = CAST if_notifier(
  NEW cl_fax_adapter( NEW cl_legacy_fax( ) ) ).
lo_notifier->notify( iv_message = `Invoice approved` iv_recipient = `+491234567` ).
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
    DATA mr_itab TYPE REF TO data.
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
    CLASS-METHODS create_itab IMPORTING iv_kind TYPE i RETURNING VALUE(ro_result) TYPE REF TO lcl_itab_builder.
ENDCLASS.
CLASS lcl_itab_provider IMPLEMENTATION.
  METHOD create_itab.
    DATA(lo_build) = CAST lcl_itab_builder( NEW lcl_builder_std_itab( ) ).
    lo_build->build_type_info( ).  lo_build->build_components( ).
    lo_build->build_table_type( ). lo_build->build_data_object( ).
    ro_result = lo_build.
  ENDMETHOD.
ENDCLASS.
```

Use when constructing a complex object takes several ordered steps and you want variants that share the same build flow without exposing the steps to callers.

---

## 8. Composite

```abap
INTERFACE lif_org PUBLIC.
  METHODS: get_headcount RETURNING VALUE(rv_headcount) TYPE i,
           get_salary    RETURNING VALUE(rv_total_salary) TYPE decfloat34.
ENDINTERFACE.

" Leaf — no subordinates
CLASS lcl_employee DEFINITION.
  PUBLIC SECTION. INTERFACES lif_org.
  PRIVATE SECTION. DATA mv_salary TYPE decfloat34.
ENDCLASS.
CLASS lcl_employee IMPLEMENTATION.
  METHOD lif_org~get_headcount. rv_headcount = 1. ENDMETHOD.
  METHOD lif_org~get_salary.    rv_total_salary = mv_salary. ENDMETHOD.
ENDCLASS.

" Composite — delegates to subordinates recursively
CLASS lcl_manager DEFINITION.
  PUBLIC SECTION.
    INTERFACES lif_org.
    METHODS add_subordinate IMPORTING io_node TYPE REF TO lif_org.
  PRIVATE SECTION.
    DATA: mv_salary TYPE decfloat34,
          mt_subordinates TYPE TABLE OF REF TO lif_org.
ENDCLASS.
CLASS lcl_manager IMPLEMENTATION.
  METHOD add_subordinate. APPEND io_node TO mt_subordinates. ENDMETHOD.
  METHOD lif_org~get_headcount.
    rv_headcount = 1.
    LOOP AT mt_subordinates INTO DATA(lo_subordinate).
      rv_headcount += lo_subordinate->get_headcount( ).
    ENDLOOP.
  ENDMETHOD.
  METHOD lif_org~get_salary.
    rv_total_salary = mv_salary.
    LOOP AT mt_subordinates INTO DATA(lo_subordinate).
      rv_total_salary += lo_subordinate->get_salary( ).
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
  PUBLIC SECTION. METHODS resize IMPORTING iv_width TYPE i iv_height TYPE i.
ENDCLASS.

" Concrete command — wraps an operation + its data, delegates to the receiver
CLASS lcl_cmd_resize DEFINITION.
  PUBLIC SECTION.
    INTERFACES lif_command.
    METHODS constructor IMPORTING io_receiver TYPE REF TO lcl_receiver
                                  iv_width TYPE i iv_height TYPE i.
  PRIVATE SECTION.
    DATA: mo_rec TYPE REF TO lcl_receiver, mv_wd TYPE i, mv_ht TYPE i,
          mv_prev_wd TYPE i, mv_prev_ht TYPE i.
ENDCLASS.
CLASS lcl_cmd_resize IMPLEMENTATION.
  METHOD constructor. mo_rec = io_receiver. mv_wd = iv_width. mv_ht = iv_height. ENDMETHOD.
  METHOD lif_command~execute. mo_rec->resize( iv_width = mv_wd iv_height = mv_ht ). ENDMETHOD.
  METHOD lif_command~undo.    mo_rec->resize( iv_width = mv_prev_wd iv_height = mv_prev_ht ). ENDMETHOD.
ENDCLASS.
```

Use when you must queue, log, parameterize, or undo/redo operations — each operation becomes a storable object decoupled from the invoker that triggers it.

---

## 10. Iterator

```abap
INTERFACE lif_iterator PUBLIC.
  METHODS: get_next RETURNING VALUE(rv_item) TYPE string,
           has_next RETURNING VALUE(rv_result) TYPE abap_boolean,
           reset.
ENDINTERFACE.

INTERFACE lif_collection PUBLIC.
  METHODS: get_iterator RETURNING VALUE(ro_it) TYPE REF TO lif_iterator,
           get_item_at_position IMPORTING iv_idx TYPE i RETURNING VALUE(rv_item) TYPE string,
           get_number_of_items RETURNING VALUE(rv_item_count) TYPE i.
ENDINTERFACE.

CLASS lcl_iterator DEFINITION.
  PUBLIC SECTION.
    INTERFACES lif_iterator.
    METHODS constructor IMPORTING io_collection TYPE REF TO lif_collection.
  PRIVATE SECTION.
    DATA: mo_coll TYPE REF TO lif_collection, mv_index TYPE i.
ENDCLASS.
CLASS lcl_iterator IMPLEMENTATION.
  METHOD constructor. mo_coll = io_collection. mv_index = 0. ENDMETHOD.
  METHOD lif_iterator~has_next. rv_result = xsdbool( mv_index < mo_coll->get_number_of_items( ) ). ENDMETHOD.
  METHOD lif_iterator~get_next. mv_index += 1. rv_item = mo_coll->get_item_at_position( mv_index ). ENDMETHOD.
  METHOD lif_iterator~reset. mv_index = 0. ENDMETHOD.
ENDCLASS.
```

Use when you need to traverse a collection sequentially without exposing its internal representation — often unnecessary in ABAP given `LOOP AT`, but useful for custom or guarded traversal order.

---

## 11. State

```abap
INTERFACE lif_calc PUBLIC.
  DATA mv_number TYPE i.
  METHODS calculate IMPORTING iv_value TYPE i RETURNING VALUE(rv_result) TYPE i.
ENDINTERFACE.

CLASS lcl_state_addition DEFINITION.
  PUBLIC SECTION. INTERFACES lif_calc.
ENDCLASS.
CLASS lcl_state_addition IMPLEMENTATION.
  METHOD lif_calc~calculate.
    rv_result = lif_calc~mv_number + iv_value.
    lif_calc~mv_number = rv_result.
  ENDMETHOD.
ENDCLASS.
" lcl_state_subtraction, lcl_state_multiplication implement lif_calc~calculate differently

" Context: behavior changes by swapping the state object
CLASS lcl_math DEFINITION.
  PUBLIC SECTION.
    METHODS: set_state IMPORTING io_state TYPE REF TO lif_calc,
             execute   IMPORTING iv_value TYPE i RETURNING VALUE(rv_result) TYPE i.
  PRIVATE SECTION. DATA mo_state_ref TYPE REF TO lif_calc.
ENDCLASS.
CLASS lcl_math IMPLEMENTATION.
  METHOD set_state. mo_state_ref = io_state. ENDMETHOD.
  METHOD execute.
    IF mo_state_ref IS BOUND. rv_result = mo_state_ref->calculate( iv_value ). ENDIF.
  ENDMETHOD.
ENDCLASS.
```

Use when an object's behavior must change with its internal state and you want to replace a sprawling `CASE state` with one state object per behavior.

---

## 12. Visitor

```abap
CLASS lcl_visited DEFINITION DEFERRED.

INTERFACE lif_visitor PUBLIC.
  DATA mv_result_string TYPE string.
  METHODS visit IMPORTING io_oref TYPE REF TO lcl_visited.
ENDINTERFACE.

" The visited object accepts a visitor and hands itself over
CLASS lcl_visited DEFINITION.
  PUBLIC SECTION.
    METHODS: get_itab_content_ref RETURNING VALUE(rr_content) TYPE REF TO data,
             receive_visitor IMPORTING io_obj TYPE REF TO lif_visitor.
  PRIVATE SECTION. DATA mr_table_data_ref TYPE REF TO data.
ENDCLASS.
CLASS lcl_visited IMPLEMENTATION.
  METHOD receive_visitor. io_obj->visit( me ). ENDMETHOD.
  METHOD get_itab_content_ref. rr_content = mr_table_data_ref. ENDMETHOD.
ENDCLASS.

" Each visitor adds a new operation without touching lcl_visited
CLASS lcl_visitor_json DEFINITION.
  PUBLIC SECTION. INTERFACES lif_visitor.
ENDCLASS.
CLASS lcl_visitor_json IMPLEMENTATION.
  METHOD lif_visitor~visit.
    DATA(lr_ref) = io_oref->get_itab_content_ref( ).
    lif_visitor~mv_result_string = /ui2/cl_json=>serialize( lr_ref->* ).
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
      IMPORTING iv_from TYPE string iv_to TYPE string
                iv_arrival TYPE d iv_departure TYPE d
      RETURNING VALUE(rt_options) TYPE string_table.
ENDCLASS.
CLASS lcl_travel_facade IMPLEMENTATION.
  METHOD plan_travel.
    DATA(lo_flights) = NEW lcl_flight_search( ).
    DATA(lo_hotels)  = NEW lcl_hotel_search( ).
    DATA(lo_cars)    = NEW lcl_rental_car_search( ).
    APPEND LINES OF lo_flights->search_flights( from = iv_from to = iv_to arrival = iv_arrival departure = iv_departure ) TO rt_options.
    APPEND LINES OF lo_hotels->search_hotel( destination = iv_to arrival = iv_arrival departure = iv_departure ) TO rt_options.
    APPEND LINES OF lo_cars->search_rental_car( destination = iv_to arrival = iv_arrival departure = iv_departure ) TO rt_options.
  ENDMETHOD.
ENDCLASS.
```

Use when a subsystem requires creating several objects and calling methods in a particular order — a facade gives callers one simple entry point and hides the wiring.

---

## 14. Proxy

```abap
INTERFACE lif_user_info PUBLIC.
  METHODS get_user_info IMPORTING iv_user_id TYPE string RETURNING VALUE(rv_info) TYPE string.
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
  PRIVATE SECTION. DATA mo_oref TYPE REF TO lcl_user_info.
ENDCLASS.
CLASS lcl_proxy IMPLEMENTATION.
  METHOD constructor.
    AUTHORITY-CHECK OBJECT 'ZAUTH_OBJ'
      ID 'ACTVT' FIELD '03'.                  " 03 = display
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE lcx_error.
    ENDIF.
    mo_oref = NEW lcl_user_info( ).
  ENDMETHOD.
  METHOD lif_user_info~get_user_info.
    rv_info = mo_oref->lif_user_info~get_user_info( iv_user_id ).
  ENDMETHOD.
ENDCLASS.
```

Use when you need a stand-in for another object to add access control, logging, lazy creation, or remote access — without changing the real subject.

---

## 15. Chain of Responsibility

```abap
INTERFACE lif_handler PUBLIC.
  METHODS: process IMPORTING io_tdo TYPE REF TO cl_abap_typedescr
                   RETURNING VALUE(rt_info) TYPE string_table,
           set_handler IMPORTING io_iref TYPE REF TO lif_handler.
ENDINTERFACE.

CLASS lcl_base_handler DEFINITION ABSTRACT.
  PUBLIC SECTION. INTERFACES lif_handler.
  PROTECTED SECTION. DATA mo_next TYPE REF TO lif_handler.
ENDCLASS.
CLASS lcl_base_handler IMPLEMENTATION.
  METHOD lif_handler~set_handler. mo_next = io_iref. ENDMETHOD.
  METHOD lif_handler~process.
    IF mo_next IS INITIAL. APPEND `Cannot handle request` TO rt_info.
    ELSE.              rt_info = mo_next->process( io_tdo ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.

CLASS lcl_elem_handler DEFINITION INHERITING FROM lcl_base_handler.
  PUBLIC SECTION. METHODS lif_handler~process REDEFINITION.
ENDCLASS.
CLASS lcl_elem_handler IMPLEMENTATION.
  METHOD lif_handler~process.
    IF io_tdo IS INSTANCE OF cl_abap_elemdescr.
      APPEND `Handled by elem handler` TO rt_info.
    ELSE.
      rt_info = super->lif_handler~process( io_tdo ).   "pass down the chain
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
    METHODS: create_starters    ABSTRACT RETURNING VALUE(ro_result) TYPE REF TO starters,
             create_main_dishes ABSTRACT RETURNING VALUE(ro_result) TYPE REF TO main_dishes,
             create_desserts    ABSTRACT RETURNING VALUE(ro_result) TYPE REF TO desserts.
ENDCLASS.

" Concrete factory per variant — only ever creates compatible products
CLASS italian_menu_creator DEFINITION INHERITING FROM menu_factory.
  PUBLIC SECTION.
    METHODS: create_starters REDEFINITION, create_main_dishes REDEFINITION,
             create_desserts REDEFINITION.
ENDCLASS.
CLASS italian_menu_creator IMPLEMENTATION.
  METHOD create_starters.    ro_result = NEW starters_italian( ).    ENDMETHOD.
  METHOD create_main_dishes. ro_result = NEW main_dishes_italian( ). ENDMETHOD.
  METHOD create_desserts.    ro_result = NEW desserts_italian( ).    ENDMETHOD.
ENDCLASS.
```

Use when you must create families of related objects that have to stay compatible (an Italian menu, a vegan menu) — one concrete factory per variant guarantees consistent combinations.

---

## 17. Prototype

```abap
INTERFACE lif_prototype PUBLIC.
  METHODS clone RETURNING VALUE(ro_ref) TYPE REF TO lif_prototype.
ENDINTERFACE.

CLASS lcl_prototype DEFINITION.
  PUBLIC SECTION.
    INTERFACES lif_prototype.
    METHODS constructor IMPORTING iv_str TYPE string.
    DATA: mv_txt TYPE string, mt_itab TYPE string_table.
  PRIVATE SECTION. DATA mv_private_text TYPE string.
ENDCLASS.
CLASS lcl_prototype IMPLEMENTATION.
  METHOD constructor. mv_txt = iv_str. mv_private_text = `#`. ENDMETHOD.
  METHOD lif_prototype~clone.
    " object clones itself — can copy private state, or selectively exclude
    DATA(lo_obj) = NEW lcl_prototype( mv_txt ).
    lo_obj->mt_itab = me->mt_itab.
    lo_obj->mv_private_text = me->mv_private_text.
    ro_ref = lo_obj.
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
  PUBLIC SECTION. METHODS get_tag RETURNING VALUE(rv_result) TYPE string.
  PRIVATE SECTION.
    METHODS constructor IMPORTING iv_state TYPE string iv_tag TYPE string.
    METHODS get_state RETURNING VALUE(rv_result) TYPE string.
    DATA: mv_state TYPE string, mv_tag TYPE string.
ENDCLASS.
CLASS lcl_memento IMPLEMENTATION.
  METHOD constructor. me->mv_state = iv_state. me->mv_tag = iv_tag. ENDMETHOD.
  METHOD get_state. rv_result = mv_state. ENDMETHOD.
  METHOD get_tag.   rv_result = mv_tag.   ENDMETHOD.
ENDCLASS.

" Originator — creates and restores from mementos
CLASS lcl DEFINITION FINAL.
  PUBLIC SECTION.
    METHODS: save    RETURNING VALUE(ro_memento) TYPE REF TO lcl_memento,
             restore IMPORTING io_memento TYPE REF TO lcl_memento.
  PRIVATE SECTION. DATA mv_state TYPE string.
ENDCLASS.
CLASS lcl IMPLEMENTATION.
  METHOD save.    ro_memento = NEW lcl_memento( iv_state = mv_state iv_tag = `snapshot` ). ENDMETHOD.
  METHOD restore. mv_state = io_memento->get_state( ). ENDMETHOD.
ENDCLASS.
```

Use when you need undo/redo or checkpoints — the memento captures an object's state so it can be restored later, without exposing the object's internals.

---

## 19. Mediator

```abap
INTERFACE lif_mediator PUBLIC.
  METHODS notify IMPORTING io_oref TYPE REF TO object iv_event TYPE string.
ENDINTERFACE.

INTERFACE lif_member PUBLIC.
  METHODS set_mediator IMPORTING io_mediator_oref TYPE REF TO lif_mediator.
ENDINTERFACE.

" Members talk only to the mediator, never to each other
CLASS lcl_cart DEFINITION.
  PUBLIC SECTION.
    INTERFACES lif_member.
    METHODS add_product IMPORTING iv_product TYPE string.
  PRIVATE SECTION. DATA mo_mediator TYPE REF TO lif_mediator.
ENDCLASS.
CLASS lcl_cart IMPLEMENTATION.
  METHOD lif_member~set_mediator. mo_mediator = io_mediator_oref. ENDMETHOD.
  METHOD add_product. mo_mediator->notify( io_oref = me iv_event = `item_added` ). ENDMETHOD.
ENDCLASS.

" Concrete mediator orchestrates: holds refs to all members, routes events
CLASS lcl_mediator DEFINITION.
  PUBLIC SECTION. INTERFACES lif_mediator.
  PRIVATE SECTION. DATA: mo_cart TYPE REF TO lcl_cart, mo_stock TYPE REF TO lcl_stock.
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
