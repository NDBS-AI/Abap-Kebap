// Cross-checks the issue forms against triage.mjs: the bot addresses fields by their rendered
// heading, so renaming a field label without updating FORMS must fail here, not in production.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FORMS } from './triage.mjs'

const FORMS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'ISSUE_TEMPLATE')

// Element labels sit at six spaces; checkbox options ("- label:") sit deeper behind a dash.
function fieldLabels(yaml) {
  return [...yaml.matchAll(/^ {6}label: *(.+?) *\r?$/gm)].map((match) => match[1].replace(/^(["'])(.*)\1$/, '$2'))
}

test('every form file belongs to a triage form', () => {
  const files = readdirSync(FORMS_DIR).filter((name) => name.endsWith('.yml') && name !== 'config.yml').sort()
  assert.deepEqual(files, Object.values(FORMS).map((form) => form.file).sort())
})

for (const [type, form] of Object.entries(FORMS)) {
  test(`${form.file} field labels match the triage headings`, () => {
    assert.deepEqual(fieldLabels(readFileSync(join(FORMS_DIR, form.file), 'utf8')), form.fields)
  })

  test(`${form.file} applies the ${type} label`, () => {
    assert.match(readFileSync(join(FORMS_DIR, form.file), 'utf8'), new RegExp(`^labels: \\["${type}"\\]\\r?$`, 'm'))
  })
}
