# ABAP OO — Core Language Reference

The language mechanics behind the patterns in [SKILL.md](../SKILL.md). Patterns tell you *what* to build; this file is the syntax for *how*. All syntax is from the ABAP Keyword Documentation as captured in the ABAP cheat sheets.

## Class definition and implementation

Every class has a **declaration part** (`CLASS … DEFINITION … ENDCLASS.`) and an **implementation part** (`CLASS … IMPLEMENTATION … ENDCLASS.`). Global classes add `PUBLIC`; local classes (in the CCIMP/*Local Types* include) omit it.

```abap
"Declaration part
CLASS global_class DEFINITION
  PUBLIC                       "Makes the class a global class in the class library
  FINAL                        "No subclasses can be derived
  CREATE PUBLIC.               "Instantiable anywhere it is visible
    " visibility sections + component declarations
ENDCLASS.

"Implementation part
CLASS global_class IMPLEMENTATION.
    " method implementations (only needed if methods were declared)
ENDCLASS.

"Local class — no PUBLIC; CREATE PUBLIC is the implicit default
CLASS local_class DEFINITION.
ENDCLASS.
CLASS local_class IMPLEMENTATION.
ENDCLASS.
```

### Class declaration additions

| Addition | Effect |
|---|---|
| `PUBLIC` | Creates a global class |
| `FINAL` | No inheritance; all methods become implicitly final |
| `CREATE PUBLIC` | Instantiable anywhere (default if no `CREATE …` given) |
| `CREATE PROTECTED` | Instantiable only in the class, its subclasses, and friends |
| `CREATE PRIVATE` | Instantiable only in the class itself or its friends (not in subclasses) |
| `INHERITING FROM superclass` | Single inheritance; default superclass is the root class `object` |
| `ABSTRACT` | Cannot be instantiated; may contain abstract and concrete methods |
| `[GLOBAL\|LOCAL] FRIENDS class` | Grants unrestricted access to all components (see Friends below) |
| `FOR TESTING` | ABAP Unit test class |
| `DEFINITION DEFERRED` | Makes a local class name known before its definition (forward declaration) |

## Visibility sections

| Section | Visible to |
|---|---|
| `PUBLIC SECTION.` | The class, its friends, subclasses, and any repository object |
| `PROTECTED SECTION.` | The class, its friends, and subclasses |
| `PRIVATE SECTION.` | The class and its friends only |

At least one section is required. Default everything to `PRIVATE`; promote deliberately.

```abap
CLASS zcl_demo DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_pricing.            "interfaces only in the public section
  PROTECTED SECTION.
  PRIVATE SECTION.
    DATA mt_log TYPE string_table.
ENDCLASS.
```

## Attributes — instance vs static

- **Instance attributes** (`DATA`): one copy per object; accessed via reference, `oref->attr`.
- **Static attributes** (`CLASS-DATA`): one copy per class; accessed via class name, `class=>attr`. Changing one is visible in all instances.
- `CONSTANTS` are non-changeable static attributes; `READ-ONLY` (public only) allows external read but write only inside the class/subclasses.

```abap
PUBLIC SECTION.
  TYPES ty_some_type TYPE c LENGTH 3.
  DATA: mv_inst_number TYPE i,                      "instance attribute
        mv_dobj_r_only TYPE c LENGTH 5 READ-ONLY.   "read-only attribute
  CLASS-DATA mv_stat_number TYPE i.                 "static attribute
  CONSTANTS c_const_num TYPE i VALUE 123.           "constant
```

## Methods — instance vs static

- `METHODS` → instance methods; can access all attributes and trigger all events.
- `CLASS-METHODS` → static methods; can access only static attributes/events. Callable without an instance via `class=>meth( )`.
- Parameter interface: `IMPORTING`, `EXPORTING`, `CHANGING`, `RETURNING VALUE(rv_result)` (exactly one, must be passed by value, completely typed — makes the method *functional* and usable in expressions), `RAISING` for class-based exceptions.
- Pass by reference is the default (`param` or `REFERENCE(param)`); pass by value is `VALUE(param)`. Input parameters passed by reference cannot be modified.
- Optional inputs: `OPTIONAL` (initial if not supplied) or `DEFAULT val`. Check with `IF param IS SUPPLIED.`

```abap
METHODS: inst_meth2 IMPORTING iv_text TYPE string,
         inst_meth4 IMPORTING iv_input TYPE string
                    RETURNING VALUE(rv_result) TYPE string,
         inst_meth5 IMPORTING iv_dividend TYPE i
                    EXPORTING ev_quotient TYPE i
                    CHANGING  cv_protocol TYPE string
                    RAISING   cx_sy_zerodivide.
CLASS-METHODS: stat_meth3 IMPORTING VALUE(iv_number) TYPE i,   "pass by value
               stat_meth7 IMPORTING iv_limit TYPE i DEFAULT 123
                                    iv_offset TYPE i OPTIONAL.
```

Generic typing exists (`TYPE any`, `TYPE any table`, `TYPE data`, `TYPE REF TO object`) but gives only *runtime* type safety — document expectations. There is no parametric generics (`<T>`).

## Constructors

A class has **exactly one** instance constructor and **one** static constructor. Both are optional. There is **no constructor overloading** — use factory methods for variants.

| | Instance constructor | Static constructor |
|---|---|---|
| Declared as | `METHODS constructor …` | `CLASS-METHODS class_constructor.` |
| Section (global class) | `PUBLIC SECTION` only | `PUBLIC SECTION` |
| Parameters | `IMPORTING` allowed; may `RAISE` | none |
| Called | On each `NEW`/instantiation | Once per class, on first use in the session |

```abap
PUBLIC SECTION.
  METHODS constructor IMPORTING iv_text TYPE string OPTIONAL.
  CLASS-METHODS class_constructor.
...
METHOD class_constructor.       "runs once, before first use of the class
  mv_static_timestamp = utclong_current( ).
ENDMETHOD.
METHOD constructor.             "runs on every NEW
  mv_instance_timestamp = utclong_current( ).
ENDMETHOD.
```

On instantiating a subclass, all superclass constructors run too; a redefined/derived constructor must call `super->constructor( … )` (filling non-optional importing parameters).

## Creating objects and `me`

```abap
DATA lo_ref1 TYPE REF TO some_class.
lo_ref1 = NEW #( ).                    "type from the declared variable
DATA(lo_ref2) = NEW some_class( ).     "inline, explicit type
DATA(lo_ref3)  = NEW another_class( ip1 = … ip2 = … ).   "mandatory ctor params
"CREATE OBJECT is the older form; still required for *dynamic* creation.
```

`me` is the implicit self-reference available in every instance method. Use it to disambiguate a member from a same-named local, or to pass the object itself.

```abap
METHOD meth.
  DATA str TYPE string VALUE `AB`.   "shadows the member 'str'
  DATA(local_string) = str.          "the local one
  DATA(member_string) = me->str.     "the member in the private section
ENDMETHOD.
METHOD pass_me_ref.
  ro_oref = me.                      "return the object itself
ENDMETHOD.
```

Returning `me` from chainable methods enables **method chaining**: `cl_abap_random_int=>create( … )->get_next( )`.

## Inheritance

Single inheritance only (`INHERITING FROM superclass`). Subclasses inherit all public/protected components; private components of the superclass are inaccessible. A subclass cannot redeclare an inherited name.

| Keyword | Where | Effect |
|---|---|---|
| `INHERITING FROM cl` | class def | Derive from `cl` |
| `METHODS m REDEFINITION` | subclass def | Override an inherited method |
| `super->m( )` | redefined method body | Call the superclass implementation |
| `METHODS m FINAL` | class def | Method cannot be redefined further |
| `METHODS m ABSTRACT` | abstract class def | Declared, not implemented here; subclass must redefine |
| `ABSTRACT` / `FINAL` | class def | Non-instantiable base / sealed leaf |

```abap
CLASS lcl_super DEFINITION CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS meth1.
    METHODS meth2 FINAL.            "cannot be redefined
ENDCLASS.

CLASS lcl_sub DEFINITION INHERITING FROM lcl_super.
  PUBLIC SECTION.
    METHODS meth1 REDEFINITION.
ENDCLASS.

CLASS lcl_sub IMPLEMENTATION.
  METHOD meth1.
    super->meth1( ).               "extend, don't replace
    " ... subclass-specific logic ...
  ENDMETHOD.
ENDCLASS.
```

Abstract method — declared in the abstract class, implemented by redefinition in subclasses:

```abap
CLASS lcl_base DEFINITION ABSTRACT CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS do_step ABSTRACT.      "no implementation in the abstract class
ENDCLASS.
```

## Interfaces

Interfaces are a public-only template of components (no implementation, no visibility sections, no constructors, no instances). A class implements any number of interfaces with `INTERFACES` in the **public** section, and addresses components with `intf~comp`.

```abap
INTERFACE lif PUBLIC.            "PUBLIC only for global interfaces
  DATA mv_str TYPE string.
  CONSTANTS c_const_number TYPE i VALUE 1.
  METHODS inst_meth IMPORTING iv_num TYPE i.
  CLASS-METHODS stat_meth RETURNING VALUE(rv_result) TYPE string.
ENDINTERFACE.

CLASS lcl DEFINITION.
  PUBLIC SECTION.
    INTERFACES lif.
    ALIASES meth FOR lif~inst_meth.   "shorter name for a component
ENDCLASS.

CLASS lcl IMPLEMENTATION.
  METHOD lif~inst_meth.               "implement with the intf~ prefix
    DATA(lv_sum) = iv_num + lif~c_const_number.
  ENDMETHOD.
  METHOD lif~stat_meth.
  ENDMETHOD.
ENDCLASS.
```

Interfaces can include other interfaces (`INTERFACES lif.` inside an `INTERFACE`).

### Interface implementation additions

| Addition (in `INTERFACES lif …`) | Effect |
|---|---|
| `ALIASES a FOR lif~comp` | Local short name for a component |
| `ABSTRACT METHODS m` / `ALL METHODS ABSTRACT` | Mark interface method(s) abstract (abstract class only); subclasses must redefine |
| `FINAL METHODS m` / `ALL METHODS FINAL` | Method(s) cannot be redefined |
| `DATA VALUES a = 1 …` | Start values for interface attributes |
| `PARTIALLY IMPLEMENTED` | Test classes only — needn't implement every method |

In the **interface definition**, mark a method's implementation optional:

| Addition (on `METHODS m …` in the interface) | Calling an unimplemented method… |
|---|---|
| `DEFAULT IGNORE` | behaves as an empty implementation (does nothing) |
| `DEFAULT FAIL` | raises `CX_SY_DYN_CALL_ILLEGAL_METHOD` |

```abap
INTERFACE lif.
  METHODS meth1 DEFAULT IGNORE.   "optional; no-op if not implemented
  METHODS meth2.
ENDINTERFACE.
```

### Interface reference variables

An interface reference can point to an object of **any** class implementing the interface — the basis of interface-based polymorphism.

```abap
DATA lo_i_ref TYPE REF TO lif.
lo_i_ref = NEW lcl( ).
lo_i_ref->inst_meth( 1 ).                "lo_i_ref->attr / lo_i_ref->meth( )
... lcl=>lif~stat_meth( ) ...          "static via class
... lif=>c_const_number ...              "constant via interface
```

## Polymorphism and casting (upcast / downcast)

A reference variable has a **static type** (its declaration) and a **dynamic type** (the class of the object it currently points to). Rule: the static type is always the same as or **more general** than the dynamic type.

- **Upcast** (widening) — subclass ref → superclass/interface ref. Always safe; done automatically with `=`.
- **Downcast** (narrowing) — superclass/interface ref → subclass ref. Checked at runtime; **must** be explicit with `CAST #( )` (or the older `?=`). A bad downcast raises `CX_SY_MOVE_CAST_ERROR`.

```abap
DATA(lo_oref_sub) = NEW lcl_sub( ).

"Upcast — automatic
DATA lo_super_ref TYPE REF TO lcl_super.
lo_super_ref = lo_oref_sub.

"Downcast — explicit, may fail at runtime
TRY.
    DATA(lo_back) = CAST lcl_sub( lo_super_ref ).
  CATCH cx_sy_move_cast_error INTO DATA(lo_cast_error).
    "...
ENDTRY.

"Guard a downcast with a type check
IF lo_super_ref IS INSTANCE OF lcl_sub.
  lo_back = CAST #( lo_super_ref ).
ENDIF.

CASE TYPE OF lo_super_ref.
  WHEN TYPE lcl_sub.   lo_back = CAST #( lo_super_ref ).
  WHEN OTHERS.         "...
ENDCASE.
```

`CAST` chains for RTTI: `CAST cl_abap_structdescr( cl_abap_typedescr=>describe_by_data( my_structure ) )->components`.

## Events

Events let an object trigger handler methods in other objects without knowing them. Steps: declare event → declare handler → register handler (`SET HANDLER`) → raise event (`RAISE EVENT`).

- `EVENTS` (instance) / `CLASS-EVENTS` (static). Only **output** parameters (`EXPORTING VALUE(…)`). Instance events carry an implicit `sender` reference to the raising object.
- Handler: `METHODS h FOR EVENT evt OF cl|intf [IMPORTING params sender]` — parameter names must match the event, no type modifiers.
- Register: `SET HANDLER h FOR oref|ALL INSTANCES [ACTIVATION 'X'|' '].` (`' '` deregisters). Static handlers: `SET HANDLER h [ACTIVATION …].`

```abap
CLASS lcl_greetings DEFINITION.
  PUBLIC SECTION.
    DATA mv_greets TYPE string.
    EVENTS: morning, evening.
    METHODS: morning_greets FOR EVENT morning OF lcl_greetings,
             evening_greets FOR EVENT evening OF lcl_greetings,
             greetings.
ENDCLASS.

CLASS lcl_greetings IMPLEMENTATION.
  METHOD greetings.
    IF cl_abap_context_info=>get_system_time( ) < '120000'.
      RAISE EVENT morning.
    ELSE.
      RAISE EVENT evening.
    ENDIF.
  ENDMETHOD.
  METHOD morning_greets.  mv_greets = `Good morning`.  ENDMETHOD.
  METHOD evening_greets.  mv_greets = `Good evening`.  ENDMETHOD.
ENDCLASS.

" Registering and triggering
DATA(lo_ref) = NEW lcl_greetings( ).
SET HANDLER lo_ref->morning_greets lo_ref->evening_greets FOR lo_ref.
lo_ref->greetings( ).
```

Events carrying parameters and a static event:

```abap
EVENTS i_evt EXPORTING VALUE(num) TYPE i.
CLASS-EVENTS st_evt EXPORTING VALUE(num) TYPE i.
METHODS handler FOR EVENT i_evt OF lcl IMPORTING num sender.
...
RAISE EVENT i_evt EXPORTING num = 5.
```

Use classic events where a framework expects them (e.g. ALV grid). For business logic, an interface-based observer (see [pattern-snippets.md](../examples/pattern-snippets.md)) is more strongly typed.

## Friends

A class can grant **friends** (other classes/interfaces) unrestricted access to *all* its components, regardless of visibility or `READ-ONLY`. Friendship is one-way and not inherited (granting it isn't inherited; being a friend is). Friends may also instantiate `CREATE PRIVATE`/`PROTECTED` classes.

| Addition | Use |
|---|---|
| `FRIENDS cl` | Local classes befriending local classes / the class pool's global class |
| `GLOBAL FRIENDS cl` | Global class (with `PUBLIC`) befriending other global classes/interfaces |
| `LOCAL FRIENDS cl` | Dedicated statement: global class grants friendship to local classes in its own pool |

```abap
"In the CCDEF include — make the test/local class a friend of the global class
CLASS local_class DEFINITION DEFERRED.
CLASS zcl_demo_abap DEFINITION LOCAL FRIENDS local_class.

"A class created only through its friend
CLASS lcl_x DEFINITION CREATE PRIVATE FRIENDS lcl_factory.
```

**One friend declaration exposes every private member** — use sparingly, mostly to let a test include reach private members (`CLASS zcl DEFINITION LOCAL FRIENDS ltc_test.`).

## Construction control summary

| Need | Construct |
|---|---|
| Block external `NEW`, route through a factory | `CREATE PRIVATE` + `CLASS-METHODS create` |
| Allow only subclasses/friends to instantiate | `CREATE PROTECTED` |
| Seal a class | `FINAL` |
| Non-instantiable base with a template algorithm | `ABSTRACT` + abstract methods |
| Expose privates to a test class only | `LOCAL FRIENDS ltc_test` in the test include |

Source: [SAP-samples/abap-cheat-sheets — 04_ABAP_Object_Orientation.md](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/04_ABAP_Object_Orientation.md)
