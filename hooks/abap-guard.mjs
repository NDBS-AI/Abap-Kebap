#!/usr/bin/env node
// PreToolUse guard for ABAP edits: asks before an edit ADDS COMMIT / ROLLBACK to ABAP code.
//
// Why: COMMIT ENTITIES, COMMIT WORK and ROLLBACK are illegal while a RAP handler or saver is on the call
// stack, also in any helper class they call. Such a helper compiles, passes activation and unit tests, and
// only fails in the real action call, so no other gate sees it and no skill helps an agent that never read
// one. This hook sees every edit regardless of what was loaded, in Claude Code and in GitHub Copilot
// (VS Code runs plugin hooks from hooks/hooks.json too).
//
// It never denies (a commit is legal in a report, a test, a job or a worker task): it asks, with a reason
// the user sees, and adds the rule as context for the model. It acts only on ABAP files or ADT/mirror edit
// tools, only when the edit increases the number of such statements, and ignores ABAP comments and string
// literals. Any failure prints an empty decision and exits 0: a guard must never break an edit.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const STATEMENT = /\b(?:COMMIT|ROLLBACK)\s+(?:ENTITIES|WORK)\b/gi
// Extensions of ABAP sources as the ADT file system and abapGit/AFF name them (zcl_x.clas.abap, x.bdef.abdl, ...).
const ABAP_PATH = /\.(?:abap|acds|asddls|abdl|ddic|aclass|acinc)$/i
// ADT and mirror MCP tools have no file path in their input; their names do say what they do.
const ABAP_WRITE_TOOL = /abap.*(?:edit|write|create|insert|save)|(?:edit|write|create|insert|save).*abap/i
const NEW_TEXT_KEYS = new Set(['newstring', 'new_string', 'new_str', 'newtext', 'new_text', 'content', 'code', 'source', 'sourcecode', 'replacement'])
const OLD_TEXT_KEYS = new Set(['oldstring', 'old_string', 'old_str', 'oldtext', 'old_text'])
const PATH_KEYS = new Set(['file_path', 'filepath', 'path', 'uri', 'file'])

const REASON =
  'This edit adds COMMIT or ROLLBACK to ABAP code. That fails at runtime if a RAP handler or saver, or any code they call, ' +
  'can reach it. Approve only for top-level code: a report, a test, a job, a parallel worker or an uncontrolled bgPF operation.'
const CONTEXT =
  'ABAP commit boundary: COMMIT ENTITIES, COMMIT WORK and ROLLBACK are illegal in a RAP handler or saver or any code they call. ' +
  'A helper class counts: it compiles, passes activation and unit tests, and fails only in the real action call. ' +
  'Before you keep this change, find out who calls this code. If a handler or saver can reach it, remove the statement and ' +
  'return mapped/failed/reported to the caller; work that must persist on its own belongs in its own LUW ' +
  '(a CL_ABAP_PARALLEL worker, an uncontrolled bgPF operation, a job). If you have not read the skills rap-eml and ' +
  'rap-actions-validations-determinations, read them now.'

// ABAP source without comments and string literals: `*` in column 1 and `"` to the end of the line start a
// comment; '...', `...` and |...| are literals.
function codeOnly(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      if (line.startsWith('*')) return ''
      let code = ''
      let quote = null
      for (const ch of line) {
        if (quote) {
          if (ch === quote) quote = null
        } else if (ch === "'" || ch === '`' || ch === '|') {
          quote = ch
        } else if (ch === '"') {
          break
        } else {
          code += ch
        }
      }
      return code
    })
    .join('\n')
}

function count(texts) {
  return texts.reduce((sum, text) => sum + (codeOnly(text).match(STATEMENT)?.length ?? 0), 0)
}

// Collects new text, old text and file paths from any tool input shape: Claude Code (Edit, Write, MultiEdit:
// file_path, old_string, new_string, content, edits[]), Copilot (replace_string_in_file, multi_replace_string_in_file,
// create_file: filePath, oldString, newString, content, replacements[]) and ADT MCP (oldString, newString).
function collect(value, found) {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, found)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const name = key.toLowerCase()
    if (typeof child !== 'string') collect(child, found)
    else if (NEW_TEXT_KEYS.has(name)) found.added.push(child)
    else if (OLD_TEXT_KEYS.has(name)) found.removed.push(child)
    else if (PATH_KEYS.has(name)) found.paths.push(child)
  }
}

export function evaluate(input) {
  const toolName = String(input?.tool_name ?? input?.toolName ?? '')
  const toolInput = input?.tool_input ?? input?.toolInput
  if (!toolName || !toolInput || typeof toolInput !== 'object') return null
  const found = { added: [], removed: [], paths: [] }
  collect(toolInput, found)
  const isAbap = found.paths.some((path) => ABAP_PATH.test(path.split('?')[0])) || ABAP_WRITE_TOOL.test(toolName)
  if (!isAbap || count(found.added) <= count(found.removed)) return null
  return { reason: REASON, context: CONTEXT }
}

function main() {
  let output = {}
  try {
    const raw = readFileSync(0, 'utf8').trim()
    const result = raw ? evaluate(JSON.parse(raw)) : null
    if (result) {
      output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: result.reason,
          additionalContext: result.context,
        },
      }
    }
  } catch {
    output = {}
  }
  process.stdout.write(JSON.stringify(output))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
