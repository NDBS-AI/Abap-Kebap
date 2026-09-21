import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
