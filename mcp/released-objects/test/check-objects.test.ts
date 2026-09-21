import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CacheManager } from '../src/cache'
import { loadConfig } from '../src/config'
import { DatasetRegistry } from '../src/datasets'
import { PartnerIndex } from '../src/partner-index'
import { handleCheckObjects } from '../src/tools/check-objects'
import { loadTarget } from '../src/tools/context'
import { fakeHttp, jsonResponse, unreachable } from './helpers/fixtures'
import type { Route } from './helpers/fixtures'
import type { ServerContext } from '../src/tools/context'

const record = (over: Record<string, unknown>) => ({ tadirObject: 'TABL', tadirObjName: 'X', objectType: 'TABL', objectKey: 'X', state: 'released', ...over })

const BTP_FILE = 'objectReleaseInfo_BTPLatest.json'

const btpCorpus = () => jsonResponse({
  formatVersion: 1,
  objectReleaseInfo: [
    record({ objectKey: 'MARA', tadirObjName: 'MARA', state: 'notToBeReleased' }),
    record({ objectKey: 'I_PRODUCT', tadirObjName: 'I_PRODUCT', objectType: 'DDLS', tadirObject: 'DDLS', state: 'released' }),
    record({ objectKey: 'CL_OLD', tadirObjName: 'CL_OLD', objectType: 'CLAS', tadirObject: 'CLAS', state: 'deprecated', successors: [{ objectType: 'CLAS', objectKey: 'CL_NEW' }] }),
  ],
})

const tempDirs: string[] = []

after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true }).catch(() => {})
})

async function contextFor(routes: Record<string, Route>, env: NodeJS.ProcessEnv): Promise<ServerContext> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ro-check-'))
  tempDirs.push(dataDir)
  const http = fakeHttp(routes)
  const config = loadConfig([], {
    ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: dataDir,
    ABAP_KEBAP_ADT_STATE_DIR: join(dataDir, 'no-adt'),
    ...env,
  }, dataDir)
  const cache = new CacheManager({
    dataDir: config.dataDir,
    baseUrl: config.baseUrl,
    githubApi: null,
    http,
    now: () => new Date('2026-09-21T08:00:00Z'),
    log: () => {},
  })
  return { cache, registry: new DatasetRegistry(cache), partnerIndex: new PartnerIndex({ http, apiBaseUrl: null, repo: 'SAP/repo' }), config }
}

const makeContext = (route: Route = btpCorpus(), env: NodeJS.ProcessEnv = {}): Promise<ServerContext> =>
  contextFor({ [BTP_FILE]: route }, { ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'btp-abap-environment', ...env })

const payloadOf = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]?.text ?? '{}')

test('a released object comes back allowed, with the resolved target echoed', async () => {
  const payload = payloadOf(await handleCheckObjects(await makeContext(), { objects: ['I_PRODUCT'], target: 'auto' } as never))
  assert.equal(payload.target, 'btp-abap-environment')
  assert.equal(payload.resolvedFrom, 'environment')
  assert.equal(payload.results[0].verdict, 'allowed')
})

test('a blocked object comes back blocked and the summary counts it', async () => {
  const payload = payloadOf(await handleCheckObjects(await makeContext(), { objects: ['MARA', 'I_PRODUCT'], target: 'auto' } as never))
  assert.equal(payload.results[0].verdict, 'blocked')
  assert.deepEqual(payload.summary, { total: 2, allowed: 1, blocked: 1, deprecated: 0, notFound: 0, ambiguous: 0 })
})

test('a deprecated object reports its successor', async () => {
  const payload = payloadOf(await handleCheckObjects(await makeContext(), { objects: [{ name: 'CL_OLD', type: 'CLAS' }], target: 'auto' } as never))
  assert.equal(payload.results[0].verdict, 'allowed-deprecated')
  assert.deepEqual(payload.results[0].matches[0].successors, [{ kind: 'object', objectType: 'CLAS', objectKey: 'CL_NEW' }])
})

test('an unknown object carries suggestions and the standing hint', async () => {
  const payload = payloadOf(await handleCheckObjects(await makeContext(), { objects: ['I_PRODUC'], target: 'auto' } as never))
  assert.equal(payload.results[0].verdict, 'not-found')
  assert.equal(payload.results[0].suggestions[0].objectKey, 'I_PRODUCT')
  assert.ok(payload.results[0].hint.length > 0)
})

test('absent means not released on BTP, and that is stated in the payload', async () => {
  const payload = payloadOf(await handleCheckObjects(await makeContext(), { objects: ['ZZ_CUSTOM'], target: 'auto' } as never))
  assert.equal(payload.impliedLevelWhenAbsent, 'none')
  assert.equal(payload.results[0].allowed, false)
})

test('the dataset provenance travels with every answer', async () => {
  const payload = payloadOf(await handleCheckObjects(await makeContext(), { objects: ['MARA'], target: 'auto' } as never))
  assert.equal(payload.dataset.status, 'fresh')
  assert.equal(payload.dataset.files[0].fileName, BTP_FILE)
  assert.equal(typeof payload.dataset.files[0].downloadedAt, 'string')
  assert.equal(payload.dataset.files[0].entries, 3)
})

test('an unresolvable target is an error result, not a guess', async () => {
  const context = await makeContext(btpCorpus(), { ABAP_KEBAP_RELEASED_OBJECTS_TARGET: '' })
  const result = await handleCheckObjects(context, { objects: ['MARA'], target: 'auto' } as never)
  assert.equal(result.isError, true)
  assert.equal(payloadOf(result).error.code, 'TARGET_UNRESOLVED')
})

test('maxLevel on a resolved public target is refused after resolution, not silently ignored', async () => {
  const result = await handleCheckObjects(await makeContext(), { objects: ['MARA'], target: 'auto', maxLevel: 'C' } as never)
  assert.equal(result.isError, true)
  assert.equal(payloadOf(result).error.code, 'INVALID_ARGUMENT')
})

test('the classification pool holds only what release info does not, so nothing is searchable twice', async () => {
  const context = await contextFor(
    {
      'objectReleaseInfo_PCELatest.json': jsonResponse({
        formatVersion: 1,
        objectReleaseInfo: [
          record({ objectKey: 'MARA', tadirObjName: 'MARA', state: 'notToBeReleased' }),
          record({ objectKey: 'I_PRODUCT', tadirObjName: 'I_PRODUCT', objectType: 'DDLS', tadirObject: 'DDLS' }),
        ],
      }),
      'objectClassifications_SAP.json': jsonResponse({
        formatVersion: 1,
        objectClassifications: [
          record({ objectKey: 'MARA', tadirObjName: 'MARA', state: 'classicAPI' }),
          // Same key, different type: a distinct object, and release info says nothing about it.
          record({ objectKey: 'MARA', tadirObjName: 'MARA', objectType: 'VIEW', tadirObject: 'VIEW', state: 'classicAPI' }),
          record({ objectKey: 'BAPI_ONLY', tadirObjName: 'BAPI_ONLY', objectType: 'FUNC', tadirObject: 'FUGR', state: 'classicAPI' }),
        ],
      }),
    },
    { ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'cloud-erp-private' },
  )
  const loaded = await loadTarget(context, { target: 'auto' })
  const pools = loaded.pools()
  assert.equal(pools.length, 2)
  // The TABL duplicate is filtered; the VIEW of the same name is a different object and survives.
  assert.deepEqual(
    pools[1]?.dataset.records.map((entry) => `${entry.objectType}:${entry.objectKey}`),
    ['VIEW:MARA', 'FUNC:BAPI_ONLY'],
  )
  // The whole classification file is still what a lookup sees, so MARA keeps its Level B state.
  assert.equal(loaded.classification?.records.length, 3)
})

test('a version that does not exist upstream is an invalid argument, not an internal error', async () => {
  const missing: Route = { status: 404, headers: {}, body: null }
  const context = await contextFor(
    {
      'objectReleaseInfo_PCE2099.json': missing,
      'objectReleaseInfo_PCE2099_0.json': missing,
      'objectClassifications_SAP.json': jsonResponse({ formatVersion: 1, objectClassifications: [record({})] }),
    },
    { ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'cloud-erp-private' },
  )
  const result = await handleCheckObjects(context, { objects: ['MARA'], target: 'auto', version: '2099' } as never)
  assert.equal(result.isError, true)
  assert.equal(payloadOf(result).error.code, 'INVALID_ARGUMENT')
})

test('an unavailable dataset is an error result with a recovery hint', async () => {
  const result = await handleCheckObjects(await makeContext(unreachable()), { objects: ['MARA'], target: 'auto' } as never)
  assert.equal(result.isError, true)
  assert.equal(payloadOf(result).error.code, 'DATASET_UNAVAILABLE')
  assert.ok(payloadOf(result).error.hint.length > 0)
})
