#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const bundle = fileURLToPath(new URL('../dist/index.js', import.meta.url))
const dataDir = await mkdtemp(join(tmpdir(), 'released-objects-smoke-'))
const child = spawn(process.execPath, [bundle], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: dataDir,
    // An unreachable mirror keeps the smoke test off the network and off the GitHub API.
    ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL: 'https://mirror.invalid/src',
  },
})

const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
const responses = new Map()
let buffer = ''
child.stdout.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    const message = JSON.parse(line)
    if (message.id !== undefined) responses.set(message.id, message)
  }
})

const waitFor = async (id, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (responses.has(id)) return responses.get(id)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`no response to request ${id} within ${timeoutMs}ms`)
}

const fail = (message) => {
  console.error(`smoke: ${message}`)
  child.kill()
  process.exit(1)
}

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } })
const initialized = await waitFor(1)
if (initialized.result?.serverInfo?.name !== 'released-objects') fail('the server did not identify itself as released-objects')

send({ jsonrpc: '2.0', method: 'notifications/initialized' })
send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
const listed = await waitFor(2)
const names = (listed.result?.tools ?? []).map((tool) => tool.name).sort()
const expected = ['check_objects', 'dataset_info', 'search_objects']
if (names.join(',') !== expected.join(',')) fail(`expected ${expected.join(', ')} but got ${names.join(', ') || 'nothing'}`)

send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dataset_info', arguments: { refresh: false } } })
const info = await waitFor(3)
const text = info.result?.content?.[0]?.text ?? '{}'
if (!JSON.parse(text).server) fail('dataset_info did not return a server block')

child.kill()
console.log(`smoke: ok — ${expected.join(', ')}`)
