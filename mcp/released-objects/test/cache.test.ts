import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CacheManager, CacheError, type FileSpec } from '../src/cache'
import { fakeClock, fakeHttp, jsonResponse, notModified, unreachable } from './helpers/fixtures'

const BASE = 'https://raw.example.invalid/src'

const CORE: FileSpec = { id: 'btp/latest', fileName: 'objectReleaseInfo_BTPLatest.json', arrayKey: 'objectReleaseInfo', optional: false }
const PARTNER: FileSpec = { id: 'partner//OTX/', fileName: 'partner/objectClassifications_OTX.json', arrayKey: 'objectClassifications', optional: true }

const payload = (count: number, state = 'released') => ({
  formatVersion: 1,
  objectReleaseInfo: Array.from({ length: count }, (_unused, index) => ({
    tadirObject: 'CLAS', tadirObjName: `CL_${index}`, objectType: 'CLAS', objectKey: `CL_${index}`, state,
  })),
})

/** Every cache in this file writes into a fresh temp directory; they are all removed at the end. */
const temporaryDirs: string[] = []
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true })
})

async function makeCache(routes: Parameters<typeof fakeHttp>[0], iso = '2026-09-21T09:00:00+03:00') {
  const dataDir = await mkdtemp(join(tmpdir(), 'abap-kebap-cache-'))
  temporaryDirs.push(dataDir)
  const http = fakeHttp(routes)
  const clock = fakeClock(iso)
  const logs: string[] = []
  const cache = new CacheManager({
    dataDir, baseUrl: BASE, githubApi: null, http, now: clock.now, log: (message) => logs.push(message),
  })
  return { cache, http, clock, dataDir, logs }
}

test('a cold start downloads the file, writes the manifest and reports ready', async () => {
  const { cache, dataDir } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200), '"e1"') })
  await cache.refresh([CORE])
  assert.equal(cache.status(CORE.id), 'ready')
  assert.ok(existsSync(join(dataDir, 'objectReleaseInfo_BTPLatest.json')))
  const manifest = cache.readManifest()
  assert.equal(manifest.files[CORE.id]?.entries, 200)
  assert.equal(manifest.files[CORE.id]?.etag, '"e1"')
  assert.ok(manifest.lastCheckedAt)
})

test('a second refresh the same local day makes no HTTP call at all', async () => {
  const { cache, http } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200)) })
  await cache.refresh([CORE])
  const afterBootstrap = http.calls.length
  await cache.refresh([CORE])
  assert.equal(http.calls.length, afterBootstrap)
})

test('the next day sends If-None-Match; a 304 touches only lastCheckedAt', async () => {
  const { cache, http, clock, dataDir } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200), '"e1"') })
  await cache.refresh([CORE])
  const before = await readFile(join(dataDir, 'objectReleaseInfo_BTPLatest.json'), 'utf8')
  const downloadedAt = cache.readManifest().files[CORE.id]?.downloadedAt

  http.setRoute('objectReleaseInfo_BTPLatest.json', notModified('"e1"'))
  clock.advanceDays(1)
  await cache.refresh([CORE])

  assert.equal(http.calls.at(-1)?.options.etag, '"e1"')
  assert.equal(await readFile(join(dataDir, 'objectReleaseInfo_BTPLatest.json'), 'utf8'), before)
  assert.equal(cache.readManifest().files[CORE.id]?.downloadedAt, downloadedAt)
})

test('a changed file is swapped atomically and subscribers are notified', async () => {
  const { cache, http, clock } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200), '"e1"') })
  await cache.refresh([CORE])
  const reloaded: string[] = []
  cache.subscribe((id) => reloaded.push(id))

  http.setRoute('objectReleaseInfo_BTPLatest.json', jsonResponse(payload(300), '"e2"'))
  clock.advanceDays(1)
  await cache.refresh([CORE])

  assert.deepEqual(reloaded, [CORE.id])
  assert.equal(cache.readManifest().files[CORE.id]?.entries, 300)
  assert.equal(cache.readManifest().files[CORE.id]?.etag, '"e2"')
})

test('a truncated payload keeps the old file and records stale-error', async () => {
  const { cache, http, clock, dataDir } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(1000), '"e1"') })
  await cache.refresh([CORE])

  http.setRoute('objectReleaseInfo_BTPLatest.json', jsonResponse(payload(10), '"e2"'))
  clock.advanceDays(1)
  await cache.refresh([CORE])

  assert.equal(cache.status(CORE.id), 'stale-error')
  assert.equal(cache.readManifest().files[CORE.id]?.entries, 1000)
  assert.match(cache.readManifest().files[CORE.id]?.lastError ?? '', /truncation/)
  assert.ok(existsSync(join(dataDir, 'objectReleaseInfo_BTPLatest.json')))
})

test('a network error sets a one-hour backoff, flips offline and still serves the cache', async () => {
  const { cache, http, clock } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200), '"e1"') })
  await cache.refresh([CORE])

  http.setRoute('objectReleaseInfo_BTPLatest.json', unreachable())
  clock.advanceDays(1)
  await cache.refresh([CORE])

  assert.equal(cache.offline, true)
  assert.ok(cache.readManifest().lastCheckError)
  assert.equal(cache.status(CORE.id), 'ready')

  const callsAfterFailure = http.calls.length
  clock.advanceMs(30 * 60 * 1000)
  await cache.refresh([CORE])
  assert.equal(http.calls.length, callsAfterFailure, 'still inside the backoff window')
  clock.advanceMs(31 * 60 * 1000)
  await cache.refresh([CORE])
  assert.ok(http.calls.length > callsAfterFailure, 'retries once the backoff expires')
})

test('force refresh bypasses both the daily gate and the backoff', async () => {
  const { cache, http } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200)) })
  await cache.refresh([CORE])
  const before = http.calls.length
  await cache.refresh([CORE], true)
  assert.ok(http.calls.length > before)
})

test('a schemaVersion mismatch re-bootstraps instead of trusting stale entries', async () => {
  const { cache, dataDir, http } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200)) })
  await writeFile(join(dataDir, 'manifest.json'), JSON.stringify({ schemaVersion: 99, files: { 'btp/latest': { entries: 5 } } }), 'utf8')
  await cache.refresh([CORE])
  assert.equal(cache.readManifest().files[CORE.id]?.entries, 200)
  assert.ok(http.calls.length > 0)
})

test('an optional partner file failing never stops a core file from becoming ready', async () => {
  const { cache } = await makeCache({
    'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200)),
    'partner/objectClassifications_OTX.json': unreachable('403 rate limited'),
  })
  await cache.refresh([CORE, PARTNER])
  assert.equal(cache.status(CORE.id), 'ready')
  assert.equal(cache.status(PARTNER.id), 'missing')
})

test('ensureFile on a missing file with no network raises DATASET_UNAVAILABLE', async () => {
  const { cache } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': unreachable() })
  await assert.rejects(
    () => cache.ensureFile(CORE, 200),
    (error: unknown) => error instanceof CacheError && error.code === 'DATASET_UNAVAILABLE',
  )
})

test('ensureFile returns the path when the file is already on disk', async () => {
  const { cache, dataDir } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200)) })
  await cache.refresh([CORE])
  assert.equal(await cache.ensureFile(CORE, 200), join(dataDir, 'objectReleaseInfo_BTPLatest.json'))
})

test('ensureFile never hands back a path to a file it failed to write', async () => {
  const { cache, http, dataDir } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200)) })
  await cache.refresh([CORE])
  await rm(join(dataDir, 'objectReleaseInfo_BTPLatest.json'))
  // A captive portal or proxy login page: 200, but not the dataset.
  http.setRoute('objectReleaseInfo_BTPLatest.json', { status: 200, headers: {}, body: '<html>sign in to continue</html>' })

  await assert.rejects(
    () => cache.ensureFile(CORE, 200),
    (error: unknown) => error instanceof CacheError && error.code === 'DATASET_UNAVAILABLE',
  )
  assert.notEqual(cache.status(CORE.id), 'ready')
})

test('a download made by ensureFile survives into the next process', async () => {
  const { cache, http, clock, dataDir } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200), '"e1"') })
  await cache.refresh([CORE])
  await rm(join(dataDir, 'objectReleaseInfo_BTPLatest.json'))
  // Upstream moved on: what ensureFile downloads differs from what the daily check persisted,
  // and the daily gate is shut for today, so only ensureFile itself can write the manifest.
  http.setRoute('objectReleaseInfo_BTPLatest.json', jsonResponse(payload(250), '"e2"'))
  await cache.ensureFile(CORE, 200)

  const restarted = new CacheManager({
    dataDir, baseUrl: BASE, githubApi: null, http, now: clock.now, log: () => undefined,
  })
  assert.equal(restarted.readManifest().files[CORE.id]?.entries, 250)
  assert.equal(restarted.readManifest().files[CORE.id]?.etag, '"e2"')
  assert.equal(restarted.status(CORE.id), 'ready')
})

test('a refresh separates an upstream answer from an outage the same way ensureFile does', async () => {
  const { cache, http } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': { status: 404, headers: {}, body: 'not found' } })
  await cache.refresh([CORE], true)
  assert.equal(cache.offline, false, 'a 404 arrived, so the network works')
  assert.ok(cache.readManifest().lastCheckError, 'the check still failed and must say so')

  http.setRoute('objectReleaseInfo_BTPLatest.json', unreachable())
  await cache.refresh([CORE], true)
  assert.equal(cache.offline, true, 'nothing arrived at all')
})

test('a 404 is an upstream answer, not an outage - offline stays false', async () => {
  const { cache } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': { status: 404, headers: {}, body: 'not found' } })
  await assert.rejects(
    () => cache.ensureFile(CORE, 200),
    (error: unknown) => error instanceof CacheError && error.code === 'UNKNOWN_VERSION',
  )
  assert.equal(cache.offline, false)
})

test('a successful ensureFile download clears the offline flag again', async () => {
  const { cache, http } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': unreachable() })
  await assert.rejects(() => cache.ensureFile(CORE, 200))
  assert.equal(cache.offline, true)

  http.setRoute('objectReleaseInfo_BTPLatest.json', jsonResponse(payload(200)))
  await cache.ensureFile(CORE, 200)
  assert.equal(cache.offline, false)
})

test('evict throws the file, its manifest entry and its etag away together', async () => {
  const { cache, dataDir, http } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200), '"e1"') })
  await cache.refresh([CORE])
  const notified: string[] = []
  cache.subscribe((id) => notified.push(id))

  await cache.evict(CORE)

  assert.equal(cache.status(CORE.id), 'missing')
  assert.equal(existsSync(join(dataDir, 'objectReleaseInfo_BTPLatest.json')), false)
  assert.deepEqual(notified, [CORE.id])
  // The etag went with the entry, so the re-download is unconditional and cannot earn a 304.
  await cache.ensureFile(CORE, 500)
  assert.equal(http.calls.at(-1)?.options.etag ?? null, null)
  assert.equal(cache.status(CORE.id), 'ready')
})

test('evicting a file that is already gone is not an error', async () => {
  const { cache } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200)) })
  await cache.evict(CORE)
  assert.equal(cache.status(CORE.id), 'missing')
})

test('a write that cannot even be started leaves no temp file behind', async () => {
  // A path no file system can hold: the temp file is refused before a byte is written, which is
  // the one failure the rename path's cleanup never saw.
  const impossible: FileSpec = { ...CORE, id: 'btp/impossible', fileName: `objectReleaseInfo_BTP${String.fromCharCode(0)}Latest.json` }
  const { cache, dataDir } = await makeCache({ 'objectReleaseInfo_BTP': jsonResponse(payload(200)) })
  await cache.refresh([impossible])

  assert.equal(cache.status(impossible.id), 'missing')
  assert.deepEqual((await readdir(dataDir)).filter((entry) => entry.endsWith('.tmp')), [])
})

test('a forced refresh for other files is not swallowed by one already in flight', async () => {
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const { cache, http } = await makeCache({
    'objectReleaseInfo_BTPLatest.json': async () => {
      await held
      return jsonResponse(payload(200))
    },
    'partner/objectClassifications_OTX.json': jsonResponse({
      formatVersion: '2',
      objectClassifications: [{ tadirObject: 'CLAS', tadirObjName: '/OTX/CL_A', objectType: 'CLAS', objectKey: '/OTX/CL_A', state: 'classicAPI' }],
    }),
  })

  const slow = cache.refresh([CORE])
  const forced = cache.refresh([PARTNER], true)
  release()
  await Promise.all([slow, forced])

  assert.ok(http.calls.some((call) => call.url.endsWith('partner/objectClassifications_OTX.json')), 'the second call was queued, not dropped')
  assert.equal(cache.status(PARTNER.id), 'ready')
})

test('a 304 proves the network is back and clears the offline flag', async () => {
  const { cache, http, clock } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200), '"e1"') })
  await cache.refresh([CORE])

  http.setRoute('objectReleaseInfo_BTPLatest.json', unreachable())
  clock.advanceDays(1)
  await cache.refresh([CORE])
  assert.equal(cache.offline, true)

  http.setRoute('objectReleaseInfo_BTPLatest.json', notModified('"e1"'))
  await cache.refresh([CORE], true)
  assert.equal(cache.offline, false, 'an answer arrived, even though nothing was downloaded')
})

test('finding a file already on disk says nothing about the network, so offline is left alone', async () => {
  const { cache, http, clock } = await makeCache({ 'objectReleaseInfo_BTPLatest.json': jsonResponse(payload(200), '"e1"') })
  await cache.refresh([CORE])

  http.setRoute('objectReleaseInfo_BTPLatest.json', unreachable())
  clock.advanceDays(1)
  await cache.refresh([CORE])
  assert.equal(cache.offline, true)

  // The cached file answers immediately; an outage that is still on is still on.
  await cache.ensureFile(CORE, 200)
  assert.equal(cache.offline, true)
})
