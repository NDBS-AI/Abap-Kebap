# RAP Draft + Custom Action — Example

A draft-enabled Customer BO with a custom `block` action that respects draft semantics.

This builds on `examples/managed-bo/` — re-read that one first if you haven't. The differences here are the *flow* of a draft + action rather than the file shapes.

## Draft lifecycle (managed)

```
[ no instance ]
       │
       │ CREATE → instance with state ACTIVE
       │
       v
   ACTIVE  ────────── Edit action ──────────►  DRAFT (editable copy)
       ▲                                              │
       │                                              │ user edits → Prepare (re-runs validations)
       │                                              │
       │                                              │ Activate (optimized) — commits draft to active
       │ ◄────────────────────────────────────────────┘
       │
       │                                              │ Discard — throws away the draft
       │ ◄────────────────────────────────────────────┘
```

`Resume` exists for the case where a user navigated away and comes back to find a draft already exists.

## Why this matters

When you call `block` on an instance that is currently being edited as a draft, what should happen?

Options:
- **Block the active instance** — fast, but the draft now sees the old (un-blocked) value. User saves the draft → un-blocks again. Bug.
- **Block both active and draft** — consistent.
- **Refuse `block` while draft exists** — safe but annoying for the user.

For a custom action, **option 2** is usually right. Here's how it's expressed.

## BDEF change

```
action ( features: instance ) block result [1] $self;
```

To allow blocking only on active instances, keep `features : instance` and disable the action for draft rows in the `get_instance_features` handler method (evaluate `%is_draft` of the instances you read); the framework then hides the button on draft rows.

## Implementation that handles both

```abap
METHOD block.
  " READ from the projection BO with active + draft awareness
  READ ENTITIES OF Z_C_Customer IN LOCAL MODE
    ENTITY Customer
    ALL FIELDS WITH CORRESPONDING #( keys )
    RESULT DATA(lt_targets).

  MODIFY ENTITIES OF Z_C_Customer IN LOCAL MODE
    ENTITY Customer
    UPDATE FIELDS ( Blocked )
    WITH VALUE #(
      FOR <fs_target> IN lt_targets
      ( %tky    = <fs_target>-%tky        " <- includes is_draft flag
        Blocked = abap_true ) )
    FAILED   DATA(lt_failed_modify)
    REPORTED DATA(lt_reported_modify).

  READ ENTITIES OF Z_C_Customer IN LOCAL MODE
    ENTITY Customer
    ALL FIELDS WITH CORRESPONDING #( keys )
    RESULT DATA(lt_blocked_after).

  result = VALUE #(
    FOR <fs_blocked_customer> IN lt_blocked_after
    ( %tky = <fs_blocked_customer>-%tky %param = <fs_blocked_customer> ) ).
ENDMETHOD.
```

Key: `%tky` already carries the `is_draft` flag through `keys`. The `READ`/`MODIFY` in local mode honor it. If you handed in keys with `is_draft = abap_false` (active), only active gets updated; if draft, only draft.

If you want to update both active AND draft regardless of which the caller passed:

```abap
" Build two key sets — one for active, one for draft — both pointing to the same logical record.
DATA lt_active_keys TYPE TABLE FOR ACTION IMPORT Z_C_Customer~block.
DATA lt_draft_keys  LIKE lt_active_keys.

LOOP AT keys ASSIGNING FIELD-SYMBOL(<fs_key>).
  APPEND VALUE #( %tky = VALUE #( CustomerId = <fs_key>-CustomerId
                                  %is_draft  = if_abap_behv=>mk-off ) )
    TO lt_active_keys.
  APPEND VALUE #( %tky = VALUE #( CustomerId = <fs_key>-CustomerId
                                  %is_draft  = if_abap_behv=>mk-on ) )
    TO lt_draft_keys.
ENDLOOP.

" then issue two MODIFY ENTITIES … one per key set
```

This pattern is rare; usually `active : true` in BDEF is the cleaner answer.

## Prepare action and draft determine action

`draft determine action Prepare { validation validate_name; }` declares that calling `Prepare` should run the named validation. In Fiori, this runs when the user clicks "Save" on a draft — *before* the framework attempts Activate. If `Prepare` reports errors, Activate doesn't happen and the user sees the errors inline.

Use Prepare to compose multiple validations:

```
draft determine action Prepare {
  validation validate_name;
  validation validate_country;
  validation validate_credit_limit;
}
```

Each validation runs; all messages combined.

## Activate optimized — why "optimized"

`draft action Activate optimized` is the canonical for managed BOs. `Activate` transfers the draft table content to the persistent table, clears the draft, and implicitly executes the draft determine action `Prepare`; the `optimized` addition reduces the number of determinations and validations executed. There's almost no reason to omit `optimized` for managed BOs.

## EML pattern for Edit → modify draft → Activate

```abap
" 1. Edit the active to create a draft
MODIFY ENTITIES OF Z_C_Customer
  ENTITY Customer
  EXECUTE Edit
  FROM VALUE #( ( CustomerId = '0000000001' ) )
  RESULT DATA(lt_after_edit)
  FAILED DATA(lt_failed_edit).

" 2. Update the draft
MODIFY ENTITIES OF Z_C_Customer
  ENTITY Customer
  UPDATE FIELDS ( City )
  WITH VALUE #(
    ( CustomerId = '0000000001'
      %is_draft  = if_abap_behv=>mk-on
      City       = 'Istanbul' ) ).

" 3. Activate
MODIFY ENTITIES OF Z_C_Customer
  ENTITY Customer
  EXECUTE Activate
  FROM VALUE #( ( CustomerId = '0000000001'
                  %is_draft  = if_abap_behv=>mk-on ) )
  RESULT DATA(lt_after_activate)
  FAILED DATA(lt_failed_activate).

" 4. Commit
COMMIT ENTITIES RESPONSE OF Z_C_Customer
  FAILED DATA(lt_failed_commit).
```

In Fiori this whole sequence happens via clicks; in a test or batch script you spell it out.

## Common mistakes specific to draft

| Mistake | Fix |
|---|---|
| Update active when draft exists | Drafts overwrite at activate; user loses your update. Either block updates during draft, or merge logic explicitly. |
| Activate without Prepare | Validations run during Activate but Fiori UX expects them pre-Activate. Use Prepare. |
| Long-running draft | Stale draft 6 months later; risk of merge conflict. Add a cleanup batch (delete drafts older than N days). |
| `Activate` without `optimized` for managed BO | Unnecessary determinations/validations re-executed, slower. Add `optimized`. |
| Custom action that returns active when caller is on a draft | UI looks wrong. Return `%tky` honoring `is_draft`. |
| Forgetting `%is_draft` in EML | Targets the wrong instance |
