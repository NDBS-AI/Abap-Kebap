// Tests for hooks/abap-guard.mjs: a PreToolUse guard that asks before an edit ADDS a commit or rollback
// statement to ABAP code. Real incident: COMMIT ENTITIES in a helper class that a RAP action calls compiles
// and passes activation and unit tests, and is only wrong at runtime. Run: node --test hooks/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate } from './abap-guard.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'abap-guard.mjs')
const ABAP_FILE = 'C:/work/src/zcl_demo_helper.clas.abap'
const BODY = 'METHOD apply.\n  MODIFY ENTITIES OF zi_demo ENTITY Demo UPDATE FIELDS ( Name ) WITH VALUE #( ).\n  COMMIT ENTITIES RESPONSE OF zi_demo FAILED DATA(f) REPORTED DATA(r).\nENDMETHOD.'
const WITHOUT = 'METHOD apply.\n  MODIFY ENTITIES OF zi_demo ENTITY Demo UPDATE FIELDS ( Name ) WITH VALUE #( ).\nENDMETHOD.'

const claudeEdit = (path, oldString, newString) => ({ tool_name: 'Edit', tool_input: { file_path: path, old_string: oldString, new_string: newString } })

test('asks when a Claude Code Edit adds COMMIT ENTITIES to an ABAP file', () => {
  const result = evaluate(claudeEdit(ABAP_FILE, WITHOUT, BODY))
  assert.ok(result)
  assert.match(result.reason, /COMMIT/)
  assert.match(result.context, /any code they call/)
  assert.match(result.context, /rap-eml/)
})

test('asks for a Copilot replace_string_in_file on an abap: URI', () => {
  const input = { tool_name: 'replace_string_in_file', tool_input: { filePath: 'abap:/repotree-v1/DEV_100/ZPKG/zcl_demo.clas.abap', oldString: WITHOUT, newString: BODY } }
  assert.ok(evaluate(input))
})

test('asks for a Copilot multi_replace_string_in_file with the statement in one replacement', () => {
  const input = {
    tool_name: 'multi_replace_string_in_file',
    tool_input: { replacements: [{ filePath: ABAP_FILE, oldString: 'a', newString: 'b' }, { filePath: ABAP_FILE, oldString: WITHOUT, newString: BODY }] },
  }
  assert.ok(evaluate(input))
})

test('asks for Write and create_file with new ABAP content', () => {
  assert.ok(evaluate({ tool_name: 'Write', tool_input: { file_path: ABAP_FILE, content: BODY } }))
  assert.ok(evaluate({ tool_name: 'create_file', tool_input: { filePath: ABAP_FILE, content: BODY } }))
})

test('asks for an ADT MCP edit tool, which carries no file path', () => {
  const input = { tool_name: 'mcp__adt__abap_object_edit_file', tool_input: { destination: 'DEV', objectIdentifier: {}, oldString: WITHOUT, newString: BODY } }
  assert.ok(evaluate(input))
})

test('catches COMMIT WORK and ROLLBACK, in any case and spacing', () => {
  for (const statement of ['commit work.', 'COMMIT   WORK AND WAIT.', 'rollback work.', 'ROLLBACK ENTITIES.']) {
    assert.ok(evaluate(claudeEdit(ABAP_FILE, 'x', `x\n  ${statement}`)), statement)
  }
})

test('stays quiet when the statement was already there', () => {
  assert.equal(evaluate(claudeEdit(ABAP_FILE, BODY, `${BODY}\n* touched`)), null)
})

test('stays quiet about comments and string literals', () => {
  for (const added of ['* COMMIT ENTITIES.', '  " COMMIT ENTITIES later', "  DATA(t) = 'COMMIT ENTITIES'.", '  DATA(m) = `COMMIT WORK`.']) {
    assert.equal(evaluate(claudeEdit(ABAP_FILE, 'x', `x\n${added}`)), null, added)
  }
})

test('stays quiet for files that are not ABAP', () => {
  for (const path of ['C:/work/README.md', 'C:/work/skills/rap-eml/SKILL.md', 'C:/work/src/index.ts']) {
    assert.equal(evaluate(claudeEdit(path, 'x', `x\n${BODY}`)), null, path)
  }
})

test('stays quiet for tools that only read or search', () => {
  assert.equal(evaluate({ tool_name: 'Read', tool_input: { file_path: ABAP_FILE } }), null)
  assert.equal(evaluate({ tool_name: 'Grep', tool_input: { pattern: 'COMMIT ENTITIES', path: ABAP_FILE } }), null)
  assert.equal(evaluate({ tool_name: 'mcp__adt__abap_object_read_file', tool_input: { destination: 'DEV', objectIdentifier: {} } }), null)
})

test('does not read natural-language fields such as an explanation', () => {
  const input = { tool_name: 'insert_edit_into_file', tool_input: { filePath: ABAP_FILE, explanation: 'Add COMMIT ENTITIES after the update', code: WITHOUT } }
  assert.equal(evaluate(input), null)
})

test('tolerates missing or odd input', () => {
  for (const input of [null, undefined, {}, { tool_name: 'Edit' }, { tool_name: 'Edit', tool_input: 'text' }]) {
    assert.equal(evaluate(input), null)
  }
})

function run(stdin) {
  return spawnSync(process.execPath, [SCRIPT], { input: stdin, encoding: 'utf8' })
}

test('the command prints a PreToolUse ask decision and exits 0', () => {
  const { status, stdout } = run(JSON.stringify(claudeEdit(ABAP_FILE, WITHOUT, BODY)))
  assert.equal(status, 0)
  const output = JSON.parse(stdout).hookSpecificOutput
  assert.equal(output.hookEventName, 'PreToolUse')
  assert.equal(output.permissionDecision, 'ask')
  assert.ok(output.permissionDecisionReason.length > 0 && output.permissionDecisionReason.length <= 300)
  assert.ok(output.additionalContext.includes('rap-actions-validations-determinations'))
})

test('the command never denies', () => {
  const { stdout } = run(JSON.stringify(claudeEdit(ABAP_FILE, WITHOUT, BODY)))
  assert.ok(!stdout.includes('"deny"'))
})

test('the command prints an empty decision and exits 0 when nothing is wrong', () => {
  const { status, stdout } = run(JSON.stringify(claudeEdit(ABAP_FILE, 'a', 'b')))
  assert.equal(status, 0)
  assert.deepEqual(JSON.parse(stdout), {})
})

test('the command survives empty and invalid input', () => {
  for (const stdin of ['', 'not json', '{"tool_name":']) {
    const { status, stdout } = run(stdin)
    assert.equal(status, 0, stdin)
    assert.deepEqual(JSON.parse(stdout), {}, stdin)
  }
})

// --- the matcher in hooks.json (Claude Code tests it unanchored against the tool name) ---
const MATCHER = new RegExp(JSON.parse(readFileSync(join(dirname(SCRIPT), 'hooks.json'), 'utf8')).hooks.PreToolUse[0].matcher)

test('the hook matcher covers the edit tools of both runtimes, including ADT tools without the mcp__ prefix', () => {
  for (const name of [
    'Edit', 'Write', 'MultiEdit',
    'mcp__adt__abap_object_edit_file', 'mcp__abap-mirror__abap_edit_source',
    'replace_string_in_file', 'multi_replace_string_in_file', 'create_file', 'insert_edit_into_file',
    'mcp_adt_mcp_serve_abap_object_edit_file', 'adt-mcp-server/abap_object_edit_file', 'adt-mcp-server/abap_object_create',
  ]) {
    assert.ok(MATCHER.test(name), name)
  }
})

test('the hook matcher skips tools that cannot add code', () => {
  for (const name of ['Read', 'Grep', 'Bash', 'NotebookRead', 'read_file', 'mcp__adt__abap_object_read_file', 'abap_unit_run_tests', 'abap_object_activate']) {
    assert.ok(!MATCHER.test(name), name)
  }
})

test('the confirmation names the one kind of bgPF operation that may commit', () => {
  const result = evaluate(claudeEdit(ABAP_FILE, WITHOUT, BODY))
  assert.match(result.reason, /uncontrolled bgPF/)
  assert.match(result.context, /uncontrolled bgPF/)
})
