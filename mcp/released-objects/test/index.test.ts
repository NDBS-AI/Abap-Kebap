import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertNodeVersion, buildContext, createLogger, MIN_NODE_MAJOR, toolDefinitions } from '../src/index'

const dataDir = async () => mkdtemp(join(tmpdir(), 'ro-index-'))
const payloadOf = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]?.text ?? '{}')

test('exactly three tools are exposed, under their agreed names', async () => {
  const context = buildContext([], { ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: await dataDir() })
  const names = toolDefinitions(context).map((tool) => tool.name)
  assert.deepEqual(names, ['check_objects', 'search_objects', 'dataset_info'])
})

test('every tool carries a description long enough to be useful to the calling model', async () => {
  const context = buildContext([], { ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: await dataDir() })
  for (const tool of toolDefinitions(context)) {
    assert.ok(tool.description.length > 80, `${tool.name} needs a real description`)
    assert.ok(Object.keys(tool.inputSchema).length > 0, `${tool.name} needs an input schema`)
  }
})

test('the handlers are wired, and dataset_info answers without any network', async () => {
  const context = buildContext([], {
    ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: await dataDir(),
    ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL: 'https://mirror.invalid/src',
    ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'btp-abap-environment',
  })
  const tool = toolDefinitions(context).find((entry) => entry.name === 'dataset_info')!
  const payload = payloadOf(await tool.handler({ target: 'auto', refresh: false } as never))
  assert.equal(payload.server.name, 'released-objects')
})

test('the tool boundary parses the full schema, so the cross-field rules actually run', async () => {
  const context = buildContext([], { ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: await dataDir() })
  const tool = toolDefinitions(context).find((entry) => entry.name === 'check_objects')!
  const result = await tool.handler({ objects: ['MARA'], target: 'cloud-erp', version: '2023' } as never)
  assert.equal(result.isError, true)
  const payload = payloadOf(result)
  assert.equal(payload.error.code, 'INVALID_ARGUMENT')
  assert.match(payload.error.message, /version/)
})

test('a mirror base URL keeps the server away from the GitHub API entirely', async () => {
  const mirrored = buildContext([], {
    ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: await dataDir(),
    ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL: 'https://mirror.invalid/src',
  })
  assert.equal(mirrored.partnerIndex.usesGithubApi, false)

  const direct = buildContext([], { ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: await dataDir() })
  assert.equal(direct.partnerIndex.usesGithubApi, true)
})

test('Node older than the floor is refused by name, and the floor itself is accepted', () => {
  assert.throws(() => assertNodeVersion('v18.19.0'), /Node\.js 20/)
  assert.doesNotThrow(() => assertNodeVersion(`v${MIN_NODE_MAJOR}.0.0`))
  assert.doesNotThrow(() => assertNodeVersion('v22.11.0'))
})

test('the logger writes to stderr only, because stdout carries the protocol', () => {
  const written: string[] = []
  const stderr = { write: (chunk: string) => { written.push(chunk); return true } }
  const stdout = { write: () => { throw new Error('the server must never write to stdout') } }
  const log = createLogger(true, stderr as never, stdout as never)
  log('cache warmed')
  assert.equal(written.length, 1)
  assert.match(written[0] ?? '', /released-objects.*cache warmed/)
})
