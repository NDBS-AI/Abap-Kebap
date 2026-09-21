import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CacheManager } from '../src/cache'
import { loadConfig } from '../src/config'
import { DatasetRegistry } from '../src/datasets'
import { PartnerIndex } from '../src/partner-index'
import { handleDatasetInfo } from '../src/tools/dataset-info'
import { fakeHttp, jsonResponse, notModified, unreachable } from './helpers/fixtures'
import type { FakeHttp, Route } from './helpers/fixtures'
import type { ServerContext } from '../src/tools/context'

const BTP_FILE = 'objectReleaseInfo_BTPLatest.json'

const corpus = (etag = '"v1"') => jsonResponse({
  formatVersion: 1,
  objectReleaseInfo: [
    { tadirObject: 'TABL', tadirObjName: 'MARA', objectType: 'TABL', objectKey: 'MARA', state: 'notToBeReleased' },
  ],
}, etag)

const tempDirs: string[] = []

after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true }).catch(() => {})
})

async function makeContext(route: Route = corpus(), env: NodeJS.ProcessEnv = {}): Promise<{ context: ServerContext; http: FakeHttp }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ro-info-'))
  tempDirs.push(dataDir)
  const http = fakeHttp({ [BTP_FILE]: route })
  const config = loadConfig([], {
    ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: dataDir,
    ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'btp-abap-environment',
    ABAP_KEBAP_ADT_STATE_DIR: join(dataDir, 'no-adt'),
    ...env,
  }, dataDir)
  const cache = new CacheManager({
    dataDir: config.dataDir, baseUrl: config.baseUrl, githubApi: null, http,
    now: () => new Date('2026-09-21T08:00:00Z'), log: () => {},
  })
  const context: ServerContext = {
    cache,
    registry: new DatasetRegistry(cache),
    partnerIndex: new PartnerIndex({ http, apiBaseUrl: null, repo: 'SAP/abap-atc-cr-cv-s4hc' }),
    config,
  }
  return { context, http }
}

const payloadOf = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]?.text ?? '{}')
const info = async (context: ServerContext, input: Record<string, unknown> = {}) =>
  payloadOf(await handleDatasetInfo(context, { target: 'auto', refresh: false, ...input } as never))

test('the server names itself and cites the SAP repository it copies from', async () => {
  const { context } = await makeContext()
  const payload = await info(context)
  assert.equal(payload.server.name, 'released-objects')
  assert.match(payload.source.repo, /abap-atc-cr-cv-s4hc/)
  assert.equal(payload.source.usesGithubApi, false)
})

test('a downloaded file is reported with its size, entry count and download time', async () => {
  const { context } = await makeContext()
  await info(context)
  const payload = await info(context)
  const file = payload.files.find((entry: { fileName: string }) => entry.fileName === BTP_FILE)
  assert.equal(file.status, 'ready')
  assert.equal(file.entries, 1)
  assert.ok(file.bytes > 0)
  assert.equal(typeof file.downloadedAt, 'string')
})

test('a second call on the same day does not go back to SAP', async () => {
  const { context, http } = await makeContext()
  await info(context)
  const before = http.calls.length
  await info(context)
  assert.equal(http.calls.length, before)
})

test('refresh asks SAP again and reports that the copy is unchanged', async () => {
  const { context, http } = await makeContext()
  await info(context)
  const before = http.calls.length
  http.setRoute(BTP_FILE, notModified('"v1"'))
  const payload = await info(context, { refresh: true })
  assert.ok(http.calls.length > before)
  assert.equal(payload.files.find((entry: { fileName: string }) => entry.fileName === BTP_FILE).status, 'ready')
  assert.equal(payload.lastCheckError, null)
})

test('a failed check is reported without discarding the copy already on disk', async () => {
  const { context, http } = await makeContext()
  await info(context)
  http.setRoute(BTP_FILE, unreachable('socket hang up'))
  const payload = await info(context, { refresh: true })
  assert.match(payload.lastCheckError, /socket hang up/)
  assert.equal(payload.files.find((entry: { fileName: string }) => entry.fileName === BTP_FILE).status, 'ready')
})

test('with nothing cached and no network, the answer says offline and names the missing file', async () => {
  const { context } = await makeContext(unreachable())
  const payload = await info(context, { refresh: true })
  assert.equal(payload.offline, true)
  assert.equal(payload.files.find((entry: { fileName: string }) => entry.fileName === BTP_FILE).status, 'missing')
  assert.ok(payload.hint.length > 0)
})

test('a version that the resolved system has no files for is an argument error, not a crash', async () => {
  const { context } = await makeContext()
  const result = await handleDatasetInfo(context, { target: 'auto', refresh: false, version: '2023' } as never)
  assert.equal(result.isError, true)
  assert.equal(payloadOf(result).error.code, 'INVALID_ARGUMENT')
})

test('an unresolved target is reported as a field, and the core files are still listed', async () => {
  const { context } = await makeContext(corpus(), { ABAP_KEBAP_RELEASED_OBJECTS_TARGET: '' })
  const payload = await info(context)
  assert.equal(payload.target, null)
  assert.equal(payload.targetProblem.code, 'TARGET_UNRESOLVED')
  assert.ok(payload.files.length >= 1)
})
