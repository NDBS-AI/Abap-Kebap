import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { assertNodeVersion, buildContext, createLogger, createServer, MIN_NODE_VERSION, toolDefinitions } from '../src/index'

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
  assert.throws(() => assertNodeVersion('v18.19.0'), /Node\.js 20\.18\.1/)
  assert.doesNotThrow(() => assertNodeVersion(`v${MIN_NODE_VERSION}`))
  assert.doesNotThrow(() => assertNodeVersion('v22.11.0'))
})

test('the floor is the whole version, because a Node 20 below 20.18.1 cannot run the HTTP client', () => {
  // undici 7 declares >=20.18.1. A major-only check lets the server start and then fail on the
  // first download, from inside a dependency, with nothing pointing at the Node version.
  assert.throws(() => assertNodeVersion('v20.5.0'), /Node\.js 20\.18\.1/)
  assert.throws(() => assertNodeVersion('v20.18.0'), /Node\.js 20\.18\.1/)
  assert.doesNotThrow(() => assertNodeVersion('v20.18.2'))
  assert.doesNotThrow(() => assertNodeVersion('v20.19.0'))
})

test('a version that cannot be read is refused rather than assumed new enough', () => {
  assert.throws(() => assertNodeVersion('v'), /Node\.js 20\.18\.1/)
  assert.throws(() => assertNodeVersion('not-a-version'), /Node\.js 20\.18\.1/)
})

test('a pre-release of a new enough Node is accepted, since the tag is not part of the order', () => {
  assert.doesNotThrow(() => assertNodeVersion('v22.0.0-nightly20240101'))
})

test('a connecting client is told what the server is for, not just its bare name', async () => {
  // Client pickers (VS Code's MCP list among them) show this string next to the server name.
  // Without it "released-objects" reads as an unlabelled entry alongside servers that do supply one.
  const context = buildContext([], { ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: await dataDir() })
  const server = createServer(context)
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  try {
    const instructions = client.getInstructions()
    assert.ok(instructions && instructions.length > 40, 'expected a real sentence, not a blank or token label')
    assert.match(instructions, /ABAP Kebap/)
    assert.match(instructions, /SAP/)
  } finally {
    await client.close()
  }
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
