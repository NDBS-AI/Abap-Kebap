# Live grounding with ADT for VS Code

The `sapse.adt-vscode` extension (**ABAP Development Tools for VS Code**) runs a local MCP server
that lets an agent work against a real ABAP system: read and edit objects, run ABAP Unit and ATC,
read runtime-error dumps, create objects and RAP services. Everything here is **optional**. Without
it the agents work from the skills and say plainly what they could not verify (tests not run, ATC
not run); they never imply that they ran something they did not.

Verified against extension **1.2.0** (ADT MCP Server **3.62.0**, 34 tools). Tool names come from that
release; if a call does not resolve, read the tool list instead of guessing a name.

## Turn it on

1. Install the extension, run **ABAP: New Destination**, and log on to a system.
2. Set `adt.mcpServer.enabled` to `true`. The server listens on `http://localhost:<port>/mcp`
   (`adt.mcpServer.port`, default `2236`). The extension generates a bearer token into
   `adt.mcpServer.token` (read-only) when the server starts, so it can change after a restart.
3. Check the access restrictions. `adt.mcpServer.accessRestrictionsEnabled` defaults to `true`, and
   `adt.mcpServer.accessRestrictions` holds two comma-separated pattern lists, `destinations` and
   `packages-objectChanges`, both **empty by default**. The setting's description says that only
   matching destinations and packages are allowed, and that package restrictions limit object
   creation and changes. Set them (for example `DEV*` and `ZPROJECT*`) and keep them on for shared
   development systems.
4. Optional: `adt.mcpServer.enableEditFileToolForABAPObjects` (default `false`) offers the
   `abap_object_edit_file` tool. The setting warns that the built-in edit tools of GitHub Copilot or
   other MCP hosts can conflict with it.
5. Connect your client.
   - **VS Code with GitHub Copilot:** the extension registers the server itself; its tools appear
     as `adt-mcp-server/*`.
   - **Claude Code:** register the endpoint once, for example
     `claude mcp add --transport http --scope user adt http://localhost:<port>/mcp --header "Authorization: Bearer <token>"`.
     Re-register when calls answer `401` after a restart. The tools are usually deferred, so load
     them with `ToolSearch` (keyword query such as `abap unit run tests`) before the first call.

Keep the token out of repository files, issues, pull requests and chat.

## Tools by task

| Task | Tools | Used by |
|---|---|---|
| Which system am I on | `abap_destination_list` (ids of the destinations currently **logged on**) | all agents |
| Find and read | `abap_repository_search_object`, `abap_object_read_file`, `abap_object_get_file_uri`, `abap_object_list_file_uris` (finds includes, for example the local test class), `abap_object_get_document_symbols` | developer, reviewer |
| Edit | `abap_object_edit_file` (only with the setting above) | developer |
| Create | `abap_repository_list_creatable_types` → `abap_object_get_creatable_type_detail` → `abap_object_validate_creation` → `abap_object_create` | developer |
| Check, test, activate | `abap_object_check` (no activation), `abap_unit_run_tests`, `abap_object_activate` | developer |
| Static analysis | `abap_atc_run_start` → `abap_atc_run_get_result`; `abap_atc_quickfixes_apply` changes code | reviewer, developer |
| Runtime errors | `abap_feed_get_schema` (without `detailed` first), then `abap_feed_query` with an FQL filter; the common feeds are ABAP Runtime Errors (dumps), SAP Gateway Error Log, System Messages and Contract Check Violations | developer (debugging) |
| RAP generators and services | `abap_objects_generator_list` → `abap_objects_generator_get_schema` → `abap_objects_generator_run`; `abap_object_list_actions` / `abap_object_run_action` (for example publish a service binding); `abap_business_service_list`, `abap_business_service_get_info` | architect, developer |
| Transports | `abap_transport_get_request` (validates and lists), `abap_transport_create_request`, `abap_transport_get_unified_diff` | architect, developer |

Not part of any skill: `abap_atc_ai_start_fix` and `abap_atc_ai_get_fix_result` need an SAP Joule
for Developers licence. Do not make a workflow depend on them.

## Rules for the agents

1. **Destination first.** Every tool except `abap_destination_list` takes a `destination`. Call
   `abap_destination_list`; if exactly one system is logged on, use it, otherwise ask. Never guess.
   The same answer helps `check_objects` (see [released-objects](../mcp/released-objects/README.md)):
   when it answers `TARGET_AMBIGUOUS`, compare its candidate ids with the logged-on list. If exactly
   one candidate is logged on, use that candidate's `target` and say so; otherwise ask.
2. **Read before you edit,** with `abap_object_read_file`. Match the code style already in the object.
3. **Real results, not assumptions.** After changing source or tests, run `abap_unit_run_tests` for the
   changed objects and read the output. Do not claim red or green, or "no ATC findings", without the
   tool's output. Tests belong in the object's local test-class include.
4. **Activation.** `abap_object_edit_file` does not activate, and its own guidance says not to
   activate unless asked. Ask once per task whether you may activate the objects you change, then
   activate only those. Never activate on a production system.
5. **Intake before you create.** Before the first `abap_object_create` or generator run, have three
   things, confirmed by the user in one message: the **package**, the **transport request number**
   and the **object names**. This is the same intake `abap-kebap-developer` follows without ADT.
   - *Package:* never invent or default one. With access restrictions on, a package outside the
     allowed list is refused.
   - *Transport:* `abap_object_validate_creation` says whether the package needs one, and
     `abap_transport_get_request` lists the candidates (call it before creating anything and before
     `abap_transport_create_request`). The tool's own guidance is to skip a transport for `$TMP`
     objects. `abap_object_create` takes the number as `transportRequestNumber`,
     `abap_object_edit_file` as `transportNumber`. Creating or modifying a request needs the user's
     explicit go; asking you to create one is that go.
   - *Names:* propose them yourself, following
     [the naming convention](../.claude/skills/abap-clean-style/references/naming-conventions.md), as
     a table of every object (type, name, purpose), and check for a clash with
     `abap_repository_search_object` first. Start once the user confirms or adjusts the table.
6. **State-changing tools need a go.** `abap_object_create`, `abap_object_activate`,
   `abap_object_run_action`, `abap_objects_generator_run`, `abap_atc_quickfixes_apply` and the
   transport tools change the system. Say what you are about to do, and to which object, first.
7. **Dumps carry data.** A runtime-error entry can include variable contents. Quote the error
   class, the failing statement and the call stack, never variable values, in anything that leaves
   the session (issues, pull requests, chat exports).
8. **No tool, no claim.** If no ADT tool is available, say which checks you could not run and carry on
   from the skills.

The plugin's PreToolUse hook (`hooks/abap-guard.mjs`) also watches the edit tools above: before an
edit adds `COMMIT ENTITIES`, `COMMIT WORK` or `ROLLBACK` to ABAP code it asks for confirmation and
reminds the agent that such a statement is illegal under a RAP handler or saver and anything they call.
It never blocks.

The tools carry no read-only annotations, so Claude Code asks before each call unless you allow them.
Allow the read-only ones (search, read, list, schema, feed query) in your own settings if the prompts
get in the way, and leave the state-changing ones on ask.

## Next to SAP's own agent

The extension also contributes a custom agent named `abap-developer` that uses the same tools. It is
a good generic assistant and keeps to ABAP Cloud syntax; `abap-kebap-developer` adds this
repository's skills, the naming convention, the released-object check and the review gate. Use one
of them per conversation. Both call the same server, so everything on this page applies to either.

## Scope

The extension is documented for the **ABAP Cloud development model**, and its object-type list has no
dynpro or GUI-status type. Classic UI maintenance stays in SAP GUI or Eclipse ADT. To see what a
system supports, call `abap_repository_list_creatable_types` for its destination.
