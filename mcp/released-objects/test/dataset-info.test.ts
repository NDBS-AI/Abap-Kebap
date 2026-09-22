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
import { loadTarget } from '../src/tools/context'
import { BUILT_IN_PARTNER_INDEX } from '../src/partner-index'
import { fakeClock, fakeHttp, jsonResponse, notModified, unreachable } from './helpers/fixtures'
import type { FakeHttp, Route } from './helpers/fixtures'
import type { ServerContext } from '../src/tools/context'

const BTP_FILE = 'objectReleaseInfo_BTPLatest.json'
const ERP_FILE = 'objectReleaseInfoLatest.json'
const PCE_2023 = 'objectReleaseInfo_PCE2023.json'
const PCE_2023_0 = 'objectReleaseInfo_PCE2023_0.json'
const CLASSIFICATION_FILE = 'objectClassifications_SAP.json'

const corpus = (etag = '"v1"') => jsonResponse({
  formatVersion: 1,
  objectReleaseInfo: [
    { tadirObject: 'TABL', tadirObjName: 'MARA', objectType: 'TABL', objectKey: 'MARA', state: 'notToBeReleased' },
  ],
}, etag)

const classifications = (etag = '"c1"') => jsonResponse({
  formatVersion: 1,
  objectClassifications: [
    { tadirObject: 'CLAS', tadirObjName: 'CL_OLD', objectType: 'CLAS', objectKey: 'CL_OLD', state: 'classicAPI' },
  ],
}, etag)

const tempDirs: string[] = []

after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true }).catch(() => {})
})

async function contextFor(
  routes: Record<string, Route>,
  env: NodeJS.ProcessEnv = {},
  clock = fakeClock('2026-09-21T08:00:00Z'),
): Promise<{ context: ServerContext; http: FakeHttp }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ro-info-'))
  tempDirs.push(dataDir)
  const http = fakeHttp(routes)
  const config = loadConfig([], {
    ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: dataDir,
    ABAP_KEBAP_ADT_STATE_DIR: join(dataDir, 'no-adt'),
    ...env,
  }, dataDir)
  const cache = new CacheManager({
    dataDir: config.dataDir, baseUrl: config.baseUrl, githubApi: null, http,
    now: clock.now, log: () => {},
  })
  const context: ServerContext = {
    cache,
    registry: new DatasetRegistry(cache),
    partnerIndex: new PartnerIndex({ http, apiBaseUrl: null, repo: 'SAP/abap-atc-cr-cv-s4hc' }),
    config,
  }
  return { context, http }
}

/** The BTP target, whose only file is the one route the caller supplies. */
const makeContext = (route: Route = corpus(), env: NodeJS.ProcessEnv = {}) =>
  contextFor({ [BTP_FILE]: route }, { ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'btp-abap-environment', ...env })

const payloadOf = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]?.text ?? '{}')
const info = async (context: ServerContext, input: Record<string, unknown> = {}) =>
  payloadOf(await handleDatasetInfo(context, { target: 'auto', refresh: false, ...input } as never))

test('the server names itself and cites the SAP repository it copies from', async () => {
  const { context } = await makeContext()
  const payload = await info(context)
  assert.equal(payload.server.name, 'released-objects')
  assert.match(payload.source.repo, /abap-atc-cr-cv-s4hc/)
  assert.equal(payload.source.usesGithubApi, false)
  // The pin is a fact, not an assumption, so there is no sentence to quote.
  assert.equal(payload.assumption, undefined)
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
  // The transport failed, so the machine is offline - but the cached copy still answers, and the
  // hint has to say that rather than "no SAP data is cached".
  assert.equal(payload.offline, true)
  assert.match(payload.hint, /cached copy/)
})

test('with nothing cached and no network, the answer says offline and names the missing file', async () => {
  const { context } = await makeContext(unreachable())
  const payload = await info(context, { refresh: true })
  assert.equal(payload.offline, true)
  assert.equal(payload.files.find((entry: { fileName: string }) => entry.fileName === BTP_FILE).status, 'missing')
  assert.ok(payload.hint.length > 0)
})

test('the spelling of a bare year that SAP does not publish is not a failed check', async () => {
  // A bare `2023` has two possible file names upstream and only one of them exists; the other's
  // 404 must not become this call's check error, nor arm the backoff.
  const { context } = await contextFor(
    { [PCE_2023_0]: corpus(), [CLASSIFICATION_FILE]: classifications() },
    { ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'cloud-erp-private' },
  )
  const payload = await info(context, { version: '2023', refresh: true })
  assert.equal(payload.lastCheckError, null)
  assert.equal(payload.offline, false)
  assert.equal(payload.nextCheckAt, null)
  assert.equal(payload.files.find((entry: { fileName: string }) => entry.fileName === PCE_2023_0).status, 'ready')
  assert.equal(payload.files.find((entry: { fileName: string }) => entry.fileName === PCE_2023).status, 'missing')
})

test('the answer lists the core files the request did not target', async () => {
  const { context } = await makeContext()
  const payload = await info(context)
  assert.ok(payload.files.some((entry: { fileName: string }) => entry.fileName === ERP_FILE))
})

test('a forced refresh only goes back to SAP for the files of the resolved target', async () => {
  const { context, http } = await makeContext()
  await info(context, { refresh: true })
  assert.ok(http.calls.length > 0)
  for (const call of http.calls) assert.match(call.url, /objectReleaseInfo_BTPLatest\.json$/)
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

const PARTNER_FILE = 'partner/objectClassifications_OTX.json'

const partnerCorpus = () => jsonResponse({
  formatVersion: '2',
  objectClassifications: [
    { tadirObject: 'CLAS', tadirObjName: '/OTX/CL_A', objectType: 'CLAS', objectKey: '/OTX/CL_A', state: 'classicAPI' },
  ],
}, '"p1"')

/** A context whose partner file has already been pulled in by a lookup, as only a lookup can. */
async function withCachedPartnerFile() {
  const clock = fakeClock('2026-09-21T08:00:00Z')
  const { context, http } = await contextFor(
    { [BTP_FILE]: corpus(), [PARTNER_FILE]: partnerCorpus() },
    { ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'btp-abap-environment' },
    clock,
  )
  const loaded = await loadTarget(context, { target: 'auto' })
  assert.ok(await loaded.partnerFor('/OTX/CL_A'))
  // loadTarget opens the daily gate in the background; let it finish before the clock moves.
  await new Promise((resolve) => setTimeout(resolve, 20))
  return { context, http, clock }
}

test('a partner file pulled in by a lookup is re-checked by the daily gate afterwards', async () => {
  const { context, http, clock } = await withCachedPartnerFile()
  clock.advanceDays(1)

  const before = http.calls.length
  const payload = await info(context)

  const rechecked = http.calls.slice(before).filter((call) => call.url.endsWith(PARTNER_FILE))
  assert.equal(rechecked.length, 1, 'the cached partner file joins the check like any other file')
  assert.ok(payload.files.some((entry: { fileName: string }) => entry.fileName === PARTNER_FILE))
})

test('the partner index is reported from the index itself, not from a manifest field nobody writes', async () => {
  const { context } = await withCachedPartnerFile()
  const payload = await info(context)
  assert.deepEqual(payload.partnerIndex, {
    indexSource: 'built-in',
    namespaces: BUILT_IN_PARTNER_INDEX.length,
    cachedFiles: 1,
  })
})

test('with no partner file cached the count is zero rather than a missing section', async () => {
  const { context } = await makeContext()
  const payload = await info(context)
  assert.equal(payload.partnerIndex.cachedFiles, 0)
  assert.ok(payload.partnerIndex.namespaces > 0)
})
