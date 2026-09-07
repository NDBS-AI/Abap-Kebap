# bgPF — Background Processing Framework API deep dive

The Background Processing Framework (bgPF) asynchronously and reliably executes methods of application classes. Technically it wraps the **inbound background RFC (bgRFC)** and adds functionality: transactional consistency with RAP, a typed operation model, a process monitor, retries, and test support. It supports the inbound scenario only (bgRFC itself also covers outbound and out-in — those remain classic-ABAP territory).

Availability: SAP BTP ABAP environment since release 2308; SAP S/4HANA (on-premise and private cloud) as of release 2023.

## Vocabulary

| Term | Meaning |
|---|---|
| Operation | Your class implementing a bgPF operation interface; the unit of work |
| Process | The framework object that wraps one operation, registered for execution |
| Process monitor | Handle to a registered process; serializable to string, used to query state later |
| Transactional process | Executed exactly once (EO), no guaranteed order |
| Queued process | Executed exactly once in order (EOIO) within a named queue |
| Controlled scenario | RAP transactional control; the framework owns commit/rollback |
| Uncontrolled scenario | Outside RAP, or code that must issue its own `COMMIT WORK` |

## The operation interfaces

| Interface | Scenario | Method to implement |
|---|---|---|
| `if_bgmc_op_single` | Transactional controlled | `execute` — EML only, no commits |
| `if_bgmc_op_single_tx_uncontr` | Transactional uncontrolled | `execute` — own commits allowed |

Alongside the operation interface, the class implements:

- `if_serializable_object` — the operation instance (including constructor-injected state such as entity keys) is serialized and shipped to the background task. Keep the state small and serializable: keys, not object references.
- `if_bgmc_operation` — framework marker interface (the SAP sample class implements it together with the operation interfaces).

The SAP sample class `zbgpfcl_calc_inventory_006` implements *both* `if_bgmc_op_single` and `if_bgmc_op_single_tx_uncontr` and offers one starter method per scenario — a convenient pattern while deciding, but production classes usually pick one.

## Choosing controlled vs uncontrolled

**Controlled** ( `if_bgmc_op_single` + `set_operation` ):

- Use inside RAP applications. The framework respects RAP transactional control — the modify/save phase separation stays intact.
- Your `execute` reads and modifies via EML (`READ ENTITIES`, `MODIFY ENTITIES`). No `COMMIT WORK`, no `COMMIT ENTITIES` — the framework commits when the operation finishes.

**Uncontrolled** ( `if_bgmc_op_single_tx_uncontr` + `set_operation_tx_uncontrolled` ):

- Use outside RAP, or when the code you call performs its own commits (legacy APIs, remote calls). Per the SAP docs: "outside of RAP or when not ensuring transactional consistency (no differentiation between modify and save phase), the scenario is transactional uncontrolled."
- You forgo the framework's consistency guarantees; the operation body manages its own transaction.

Do not confuse *transactional control* (controlled/uncontrolled) with the *transactional background process* (EO process type) — the SAP docs call this out explicitly.

## Starting a transactional process

The builder chain, exactly as the sample uses it:

```abap
TRY.
    DATA(lo_process_monitor) = cl_bgmc_process_factory=>get_default(
        )->create(
        )->set_name( |Recalculate inventory|            " appears in monitoring
        )->set_operation( NEW zcl_recalculate_inventory( entity_key )
        )->save_for_execution( ).

    DATA(lv_process_monitor_string) = lo_process_monitor->to_string( ).
  CATCH cx_bgmc INTO DATA(lo_background_error).
    " report; never swallow silently
ENDTRY.
```

- `save_for_execution( )` registers the process inside the **current** SAP LUW. Only when that LUW commits does the process become real and run; a rollback discards it. That is why the RAP samples call this from `save_modified` — the process starts immediately after the RAP framework's `COMMIT WORK`.
- For the uncontrolled scenario, replace `set_operation` with `set_operation_tx_uncontrolled`.
- All framework errors are typed `cx_bgmc`.

## Queued processes (EOIO)

For operations that must execute in order, obtain the factory for a queue:

```abap
DATA(lo_process_factory) = cl_bgmc_process_factory=>get_for_queue(
    iv_bg_processing_context = 'ZMY_CONTEXT'
    iv_queue                 = 'INVENTORY_QUEUE' ).
```

- `iv_bg_processing_context` names a **background processing context** repository object you must create — it namespaces your queue names so they cannot clash with other applications' bgPF queues.
- Operations in the same queue run exactly once *and* in registration order.

(The SAP sample repos in this project use only transactional processes; the queued API surface above is from the SAP Help page "Implementing the Queued Background Process".)

## The process monitor

`save_for_execution( )` returns an `if_bgmc_process_monitor` instance:

- `to_string( )` — serialize the monitor to a plain string. The bgPF sample persists this string in a column of the RAP BO's table (`BgpgProcessName` field) during `save_modified`.
- `cl_bgmc_process_factory=>create_monitor_from_string( ... )` — re-instantiate the monitor later from the persisted string.
- `if_bgmc_process_monitor->get_state( )` — query the current state of the background process.

This is the supported way to answer "did my background process run yet?" from a later request.

## Error handling and retries

- Registration and execution errors surface as `cx_bgmc`. In a RAP saver class, catch it and append a `%msg` to `reported-<entity>` so the user sees the failure.
- The framework supports **automatic restart** of failed operations — for transactional *and* queued processes, in both controlled and uncontrolled scenarios (SAP Help: "Implementing Automatic Retry of Failed Operations"). A failed operation is then scheduled for retry instead of staying dead.
- Operational monitoring of the underlying units is possible via the bgRFC monitor on systems that expose it (the on-premise docs describe *Inbound → BGPF → Transactional Units* in the bgRFC monitor).

## Unit testing

SAP Help provides a dedicated page "Writing Unit Tests for Transactional Background Processes". The pattern shown there: run the code that registers a process (the same `cl_bgmc_process_factory=>get_default( )->create( )->set_name( ... )->set_operation( ... )->save_for_execution( )` chain), then assert against `if_bgmc_process_factory` that exactly one background process was created and fetch the process instance to execute/verify the operation. Use it to test that your saver class registers a process under the right conditions without waiting for real background execution.

## Interaction with RAP events and side effects

The bgPF sample closes the loop to the Fiori UI like this:

1. Action `reCalculateInventory` sets a status field → save sequence runs.
2. `save_modified` sees the marker, calls the operation class's starter method, stores the monitor string.
3. After `COMMIT WORK` the framework runs `if_bgmc_op_single~execute`, which updates `Quantity` via EML — triggering a *second* save cycle in a new LUW.
4. In that second `save_modified`, `RAISE ENTITY EVENT ...~QuantityUpdated` fires an event declared `event QuantityUpdated for side effects;` with `side effects { event QuantityUpdated affects field ( Quantity ); }` in the BDEF.
5. The projection BDEF enables it (`use side effects;` + `use event QuantityUpdated;`), and Fiori Elements re-reads the field — the user sees the new quantity without pressing refresh.

## Verified sources

- Background Processing Framework: https://help.sap.com/docs/ABAP_Cloud/f2961be2bd3d403585563277e65d108f/e1fbe70d8dd54a2db2df3a208b2cb68e.html
- Scenario: Transactional Controlled: https://help.sap.com/docs/ABAP_Cloud/f2961be2bd3d403585563277e65d108f/348b168c2de14195a6a549a542601437.html
- Scenario: Transactional Uncontrolled: https://help.sap.com/docs/ABAP_Cloud/f2961be2bd3d403585563277e65d108f/31eea50903c642db9c3748afdbe28295.html
- Implementing the Queued Background Process: https://help.sap.com/docs/ABAP_Cloud/f2961be2bd3d403585563277e65d108f/3b01f875861a4c4397ae0324e8263227.html
- Process Monitor: https://help.sap.com/docs/ABAP_Cloud/f2961be2bd3d403585563277e65d108f/ce603d821881460e98894e4deed352d1.html
- Implementing Automatic Retry of Failed Operations: https://help.sap.com/docs/ABAP_Cloud/f2961be2bd3d403585563277e65d108f/bf9cb78fae8f4120a4d6d7194d1274a2.html
- Writing Unit Tests for Transactional Background Processes: https://help.sap.com/docs/ABAP_Cloud/f2961be2bd3d403585563277e65d108f/edba55380ccf4139b9acb281a069773e.html
- Sample repo: https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects
