import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CacheManager } from '../src/cache'
import { loadConfig } from '../src/config'
import { DatasetRegistry } from '../src/datasets'
import { PartnerIndex } from '../src/partner-index'
import { handleSearchObjects } from '../src/tools/search-objects'
import { fakeHttp, jsonResponse } from './helpers/fixtures'
import type { ServerContext } from '../src/tools/context'

const BTP_FILE = 'objectReleaseInfo_BTPLatest.json'
const PARTNER_FILE = 'objectClassifications_OTX.json'
const PARTNER_LISTING = 'contents/src/partner'

const record = (over: Record<string, unknown>) => ({
  tadirObject: 'DDLS', tadirObjName: 'X', objectType: 'DDLS', objectKey: 'X',
  softwareComponent: 'SAP_BASIS', applicationComponent: 'BC-SRV', state: 'released', ...over,
})

const corpus = () => jsonResponse({
  formatVersion: 1,
  objectReleaseInfo: [
    record({ objectKey: 'I_PURCHASEORDER', tadirObjName: 'I_PURCHASEORDER', applicationComponent: 'MM-PUR-PO' }),
    record({ objectKey: 'I_PURCHASEORDERITEM', tadirObjName: 'I_PURCHASEORDERITEM', applicationComponent: 'MM-PUR-PO' }),
    record({ objectKey: 'CL_PURCHASE_HELPER', tadirObjName: 'CL_PURCHASE_HELPER', objectType: 'CLAS', tadirObject: 'CLAS', state: 'deprecated' }),
    record({ objectKey: 'I_SALESORDER', tadirObjName: 'I_SALESORDER', applicationComponent: 'SD-SLS', labels: ['remote-enabled'] }),
  ],
})

const tempDirs: string[] = []

after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true }).catch(() => {})
})

async function makeContext(): Promise<ServerContext> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ro-search-'))
  tempDirs.push(dataDir)
  const http = fakeHttp({
    [PARTNER_LISTING]: jsonResponse([{ name: PARTNER_FILE, type: 'file' }]),
    [PARTNER_FILE]: jsonResponse({
      formatVersion: '2',
      objectClassifications: [record({ objectKey: '/OTX/CL_PURCHASE_BRIDGE', tadirObjName: '/OTX/CL_PURCHASE_BRIDGE', objectType: 'CLAS', tadirObject: 'CLAS', state: 'classicAPI' })],
    }),
    [BTP_FILE]: corpus(),
  })
  const config = loadConfig([], {
    ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: dataDir,
    ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'btp-abap-environment',
    ABAP_KEBAP_ADT_STATE_DIR: join(dataDir, 'no-adt'),
  }, dataDir)
  const cache = new CacheManager({
    dataDir: config.dataDir, baseUrl: config.baseUrl, githubApi: null, http,
    now: () => new Date('2026-09-21T08:00:00Z'), log: () => {},
  })
  return {
    cache,
    registry: new DatasetRegistry(cache),
    partnerIndex: new PartnerIndex({ http, apiBaseUrl: 'https://api.example', repo: 'SAP/repo' }),
    config,
  }
}

const payloadOf = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]?.text ?? '{}')
const search = async (input: Record<string, unknown>) =>
  payloadOf(await handleSearchObjects(await makeContext(), { target: 'auto', limit: 20, offset: 0, ...input } as never))

test('a fragment matches every object that contains it', async () => {
  const payload = await search({ query: 'purchaseorder' })
  assert.equal(payload.total, 2)
  assert.deepEqual(payload.results.map((hit: { objectKey: string }) => hit.objectKey), ['I_PURCHASEORDER', 'I_PURCHASEORDERITEM'])
  assert.equal(payload.hint, undefined)
})

test('a result set echoes the resolved target and the file it was read from', async () => {
  const payload = await search({ query: 'purchaseorder' })
  assert.equal(payload.target, 'btp-abap-environment')
  assert.equal(payload.resolvedFrom, 'environment')
  assert.equal(payload.dataset.files[0].fileName, BTP_FILE)
})

test('paging reports the full total and returns only the requested window', async () => {
  const payload = await search({ query: 'purchase', limit: 1, offset: 1 })
  assert.equal(payload.total, 3)
  assert.equal(payload.results.length, 1)
  assert.equal(payload.returned, 1)
  assert.equal(payload.offset, 1)
})

test('an object type filter narrows the result set', async () => {
  const payload = await search({ query: 'purchase', objectType: 'CLAS' })
  assert.equal(payload.total, 1)
  assert.equal(payload.results[0].objectKey, 'CL_PURCHASE_HELPER')
})

test('an application component filter matches on the path prefix', async () => {
  const payload = await search({ query: 'I_', applicationComponent: 'MM-PUR' })
  assert.equal(payload.total, 2)
})

test('a state filter selects the published state exactly', async () => {
  const payload = await search({ query: 'purchase', state: 'deprecated' })
  assert.equal(payload.total, 1)
  assert.equal(payload.results[0].releaseState, 'deprecated')
})

test('a label filter selects objects carrying that SAP label', async () => {
  const payload = await search({ query: 'I_', label: 'remote-enabled' })
  assert.equal(payload.total, 1)
  assert.equal(payload.results[0].objectKey, 'I_SALESORDER')
})

test('a query in a partner namespace pulls that partner file into the search', async () => {
  const payload = await search({ query: '/OTX/CL_PURCHASE' })
  assert.equal(payload.total, 1)
  assert.equal(payload.results[0].origin, 'partner:/OTX/')
})

test('maxLevel is refused once the target resolves to a non-private system', async () => {
  const result = await handleSearchObjects(await makeContext(), { query: 'purchase', target: 'auto', maxLevel: 'C', limit: 20, offset: 0 } as never)
  assert.equal(result.isError, true)
  assert.equal(payloadOf(result).error.code, 'INVALID_ARGUMENT')
})

test('no match returns an empty list with a hint rather than an error', async () => {
  const payload = await search({ query: 'zzz_nothing_here' })
  assert.equal(payload.total, 0)
  assert.deepEqual(payload.results, [])
  assert.ok(payload.hint.length > 0)
})

test('a namespace with no published file says so instead of blaming the query', async () => {
  const payload = await search({ query: '/ABC/CL_X' })
  assert.equal(payload.total, 0)
  assert.ok(payload.hint.includes('/ABC/'))
  assert.ok(payload.hint.includes('vendor'))
})
