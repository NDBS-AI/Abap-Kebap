# BDEF Behavior Grammar — Actions, Validations, Determinations, Feature Control, Prechecks

Declaration-side reference for the entity behavior body (the `{ ... }` block after
`define behavior for Entity alias e ...`). Handler-side counterpart:
[handler-signatures.md](handler-signatures.md).

Grounded in SAP-samples/abap-cheat-sheets `36_RAP_Behavior_Definition_Language.md` and the
ABAP Keyword Documentation (`ABENBDL`).

## Actions

### Kinds

```
action act1;                              // instance action (default kind): modifies existing instances
static action act2;                       // bound to the entity, not an instance
internal action act3;                     // callable only inside the BO (EML in the ABP, determinations)
repeatable action act4;                   // may execute several times on the same instance in one request
factory action act5 [1];                  // creates instances; instance-bound (copy) variant
static factory action act6 [1];           // creates instances from scratch (defaults)
static default factory action act7 [1];   // "default" is evaluated by consuming frameworks (OData)
save ( finalize ) action act8;            // callable only during the save sequence (finalize)
save ( adjustnumbers ) action act9;       // callable only during adjust_numbers
draft action Edit;                        // draft lifecycle actions — implicitly implemented
draft action Activate optimized;
draft action Discard;
draft action Resume;
draft determine action Prepare { ... }    // draft flavor of a determine action
```

Notes:

- `internal`, `static`, `repeatable`, `factory` can combine with the additions below where the
  syntax check allows it.
- Draft actions optionally take `with additional implementation` — then you also implement a
  `FOR MODIFY ... FOR ACTION` method that runs in addition to the framework implementation.
- `save( ... )` actions are invoked from saver-method context only (see rap-saves-and-numbering).

### Additions in parentheses

```
action ( features : instance ) act;        // enabled/disabled per instance state → FOR INSTANCE FEATURES
action ( features : global ) act;          // enabled/disabled BO-wide → FOR GLOBAL FEATURES
action ( precheck ) act;                   // filter input before the buffer → FOR PRECHECK
action ( authorization : none ) act;       // no authorization check for this action
action ( authorization : update ) act;     // reuse the update operation's authorization result
action ( authorization : global ) act;     // override master: use global auth check
action ( authorization : instance ) act;   // override master: use instance auth check
action ( lock : none ) act;                // do not acquire the exclusive lock for this action
```

Multiple additions combine comma-separated: `action ( features : instance, precheck ) act;`.

### Parameters

```
action act parameter SOME_ENTITY;              // flat input: CDS abstract entity or DDIC type
action act deep parameter SOME_ABSTRACT_BDEF;  // structured input: abstract BDEF "with hierarchy"
action act deep table parameter SOME_ABSTRACT_BDEF;  // tabular input
action act { default function GetDefaults; }               // prefills the parameter UI
action act { default function GetDefaults external 'Ext'; } // external name for OData metadata
```

The abstract-entity pattern for flat parameters (`define abstract entity ZA_... { ... }`) is the
standard way to model an action popup — see cds-entity-types for authoring abstract entities.

The default values function name must start with `GetDefaultsFor` and the action must declare a
`parameter` — full handler signature, `%cid`/`%tky` handling, and the multi-select/release
caveats: [handler-signatures.md](handler-signatures.md#default-values-function).

### Results

```
action act result [1] $self;                   // returns the changed instance(s)
action act result [0..1] $self;                // may return nothing
action act result [0..*] entity ZR_OtherEntity; // result typed as another CDS entity
action act deep result selective [1] SOME_ABSTRACT_BDEF; // deep + partial result
action act parameter ZA_P result [1] $self;    // parameter and result combine
```

- Cardinalities: `[0..1]`, `[1]`, `[0..*]`, `[1..*]`.
- `$self` = the entity itself; `entity name` = another CDS view entity; with `deep result`, an
  abstract BDEF.
- `selective` returns only requested parts (e.g. keys); the handler then receives an extra
  `REQUEST` importing parameter marking what is wanted.
- **Factory actions**: cardinality directly after the name (`factory action act [1];` —
  `[0..1]`, `[0..*]`, `[1..*]` also allowed since newer releases), and **no result clause** —
  output goes through `mapped`.

### External alias

```
action act external 'NameInODataMetadata';
```

## Functions (read-only cousins of actions)

```
function func1 result [0..*] $self;
static function func2 result [1] SOME_ENTITY;
function func3 parameter SOME_ENTITY result [1] $self;
```

- Functions return information without locking or modifying data; a `result` is **mandatory**.
- Same parameter/result grammar as actions; also `static`, `internal`, `repeatable`, `default`.
- Key functions (`... keyfunction ...`, alternative-key lookup) exist for cross-BO association
  scenarios — see `ABENBDL_KEYFUNCTION` in the ABAP Keyword Documentation.

## Validations

```
validation val1 on save { create; update; }
validation val2 on save { delete; }
validation val3 on save { field some_field; }
validation val4 on save { delete; field f1, f2; }
```

- Only `on save` exists for validations.
- Trigger conditions: `create`, `update` (**only in combination with `create`**), `delete`,
  `field ...` (fires when the listed fields change during create/update).
- Several conditions are OR-ed: one match triggers the validation.
- A failed validation rejects the entire transactional buffer (all-or-nothing save).

## Determinations

```
determination det1 on save { create; }
determination det2 on save { delete; }
determination det3 on save { field some_field; }

determination det4 on modify { create; }
determination det5 on modify { field f1, f2; }
determination det6 on modify { update; }
```

- `on modify`: executes immediately after the triggering change lands in the transactional
  buffer — result visible within the transaction (and to the UI).
- `on save`: executes in the save sequence (managed scenario: during `finalize`).
- Triggers as for validations (for `on save`, `update` only together with `create`).
- Execution order among triggered determinations is arbitrary.

## Determine actions

```
determine action checkEverything
{
  determination detA;              // runs only if detA's triggers fired
  determination ( always ) detB;   // runs unconditionally
  validation valA;
}
```

- Only `on save` determinations and validations are assignable.
- Order: all determinations first, then all validations; order within each group is unspecified.
- Authorization additions allowed: `determine action ( authorization : none ) ...`.
- `draft determine action Prepare { ... }` is the same concept for drafts; `Activate` executes
  `Prepare` implicitly.

### Triggering from the UI — side effect

```
side effects
{
  determine action checkEverything
    executed on field CustomerId,
                field OrderQuantity,
                field _Item.Amount
    affects field TotalAmount, messages;
}
```

When any `executed on` source changes on the UI, the determine action runs and the `affects`
targets reload. Full side-effects grammar: rap-business-events-side-effects skill.

## Feature control

### Static field characteristics

```
field ( readonly ) f1, f2;
field ( readonly : create ) f3;
field ( readonly : update ) f4;
field ( mandatory ) f5;
field ( mandatory : create ) f6;
field ( mandatory : update ) f9;
field ( suppress ) f7;                  // removed from derived types and all RAP APIs
field ( mandatory : create, readonly : update ) key_field;   // external numbering idiom
```

### Dynamic feature control

```
field ( features : instance ) f8;       // per-instance field control → FOR INSTANCE FEATURES
update ( features : instance );         // per-instance operation control (update/delete, not create)
delete ( features : instance );
create ( features : global );           // BO-wide operation control → FOR GLOBAL FEATURES
action ( features : instance ) act;
action ( features : global ) act;
```

## Prechecks

```
create ( precheck );
update ( precheck );
delete ( precheck );
association _Item { create ( precheck ); }
action ( precheck ) act;
```

- Runs before the modify request reaches the transactional buffer; rows you put into `failed`
  are removed from the request.
- Also declarable in a **projection BDEF** (requires an implementation class for the
  projection); a base-BO precheck is reused automatically by projections.

## Standard operations and associations (context)

```
create;
update ( features : instance );
delete ( authorization : update );
internal create;                        // operation usable only BO-internally, invisible to consumers
create { default function GetDefaultsForCreate; }

association _Item { create; }
association _Item { create; link action linkIt; unlink action unlinkIt; inverse function findParent; }
```

- Read is always implicitly enabled — there is no `read;` syntax.
- Non-standard association operations (link/unlink/inverse function) require behavior defined
  for the association target.

## Projection BDEF (`use ...`)

```
projection;
strict ( 2 );
use draft;

define behavior for ZC_Entity alias e
{
  use create;
  use update;
  use delete;
  use action act1;
  use action Edit; use action Activate; use action Discard; use action Resume; use action Prepare;
  use function func1;
  use association _Item { create; with draft; }
  use event evt1;
}
```

- Only `use`d operations/actions/functions/events surface in the service.
- Validations/determinations are not `use`d — they always run in the base BO.
- `internal` actions cannot be used in projections.
