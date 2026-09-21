import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BUILT_IN_PCE_VERSIONS,
  DatasetRegistry,
  VERSION_PATTERN,
  buildDataset,
  coreFileSpecs,
  parseRecords,
  resolveFiles,
  versionFileNames,
} from '../src/datasets'
import { CacheError, CacheManager, type FileSpec } from '../src/cache'
import { fakeClock, fakeHttp, jsonResponse } from './helpers/fixtures'
import type { RawRecord } from '../src/types'

test('each target maps to its release-info file; only private has a classification file', () => {
  assert.equal(resolveFiles('cloud-erp').releaseInfoCandidates[0]?.fileName, 'objectReleaseInfoLatest.json')
  assert.equal(resolveFiles('btp-abap-environment').releaseInfoCandidates[0]?.fileName, 'objectReleaseInfo_BTPLatest.json')
  assert.equal(resolveFiles('cloud-erp').classification, null)
  assert.equal(resolveFiles('btp-abap-environment').classification, null)

  const priv = resolveFiles('cloud-erp-private')
  assert.equal(priv.releaseInfoCandidates[0]?.fileName, 'objectReleaseInfo_PCELatest.json')
  assert.equal(priv.classification?.fileName, 'objectClassifications_SAP.json')
})

test('a YYYY_N version resolves to exactly one file, a bare YYYY to two candidates', () => {
  assert.deepEqual(versionFileNames('2023_2'), ['objectReleaseInfo_PCE2023_2.json'])
  assert.deepEqual(versionFileNames('2022'), ['objectReleaseInfo_PCE2022.json', 'objectReleaseInfo_PCE2022_0.json'])
  assert.deepEqual(versionFileNames('latest'), ['objectReleaseInfo_PCELatest.json'])
})

test('the version pattern accepts latest, YYYY and YYYY_N and nothing else', () => {
  for (const good of ['latest', '2022', '2023_2', '2025_1']) assert.ok(VERSION_PATTERN.test(good))
  for (const bad of ['../etc/passwd', '2023-2', 'PCE2023', '20233', '']) assert.equal(VERSION_PATTERN.test(bad), false)
})

test('every built-in version is itself a valid version and resolves to a file name', () => {
  // The set Task 0 observed upstream: 2022 has no _0 form, 2023 and 2025 have only _0 forms.
  assert.deepEqual(BUILT_IN_PCE_VERSIONS, [
    'latest', '2022', '2022_1', '2022_2', '2023_0', '2023_1', '2023_2', '2023_3', '2025_0', '2025_1',
  ])
  for (const version of BUILT_IN_PCE_VERSIONS) {
    assert.ok(VERSION_PATTERN.test(version), `${version} must match VERSION_PATTERN`)
    assert.ok(versionFileNames(version).length >= 1)
  }
})

test('passing a version to a non-private target is refused, not ignored', () => {
  assert.throws(() => resolveFiles('cloud-erp', '2023'), /cloud-erp-private/)
})

test('a version that would escape the data directory is refused before it reaches a file name', () => {
  assert.throws(
    () => resolveFiles('cloud-erp-private', '../../etc/passwd'),
    (error: unknown) => error instanceof CacheError && error.code === 'UNKNOWN_VERSION',
  )
})

test('the core file set is the four files the bootstrap downloads', () => {
  assert.deepEqual(
    coreFileSpecs().map((spec) => spec.fileName).sort(),
    ['objectClassifications_SAP.json', 'objectReleaseInfoLatest.json', 'objectReleaseInfo_BTPLatest.json', 'objectReleaseInfo_PCELatest.json'].sort(),
  )
})

test('the latest files carry the bootstrap ids, so one download serves both paths', () => {
  const core = coreFileSpecs()
  const coreIdFor = (fileName: string) => core.find((spec) => spec.fileName === fileName)?.id
  const priv = resolveFiles('cloud-erp-private')
  assert.equal(priv.releaseInfoCandidates[0]?.id, coreIdFor('objectReleaseInfo_PCELatest.json'))
  assert.equal(priv.classification?.id, coreIdFor('objectClassifications_SAP.json'))
  assert.equal(resolveFiles('cloud-erp').releaseInfoCandidates[0]?.id, coreIdFor('objectReleaseInfoLatest.json'))
})

test('two spellings of the same release share one cache id, different files do not', () => {
  const candidates = (version: string) => resolveFiles('cloud-erp-private', version).releaseInfoCandidates
  // `2023` falls back to `_PCE2023_0.json`, which is what `2023_0` asks for directly.
  const viaBareYear = candidates('2023')[1]
  const viaExplicit = candidates('2023_0')[0]
  assert.equal(viaBareYear?.fileName, viaExplicit?.fileName)
  assert.equal(viaBareYear?.id, viaExplicit?.id)

  const ids = [...candidates('2022'), ...candidates('2023'), ...candidates('latest')].map((spec) => spec.id)
  const files = [...candidates('2022'), ...candidates('2023'), ...candidates('latest')].map((spec) => spec.fileName)
  assert.equal(new Set(ids).size, new Set(files).size)
})

test('an empty version means latest for every target, not a rejection', () => {
  assert.equal(resolveFiles('cloud-erp-private', '').releaseInfoCandidates[0]?.fileName, 'objectReleaseInfo_PCELatest.json')
  assert.equal(resolveFiles('cloud-erp', '').releaseInfoCandidates[0]?.fileName, 'objectReleaseInfoLatest.json')
})

test('parseRecords reads the array and tolerates a string formatVersion', () => {
  const text = JSON.stringify({
    formatVersion: '2',
    objectClassifications: [{ tadirObject: 'CLAS', tadirObjName: '/OTX/CL_A', objectType: 'CLAS', objectKey: '/OTX/CL_A', state: 'classicAPI' }],
  })
  assert.equal(parseRecords(text, 'objectClassifications').length, 1)
})

test('parseRecords on a wrong key returns an empty array instead of throwing', () => {
  assert.deepEqual(parseRecords(JSON.stringify({ formatVersion: 1, other: [] }), 'objectReleaseInfo'), [])
})

test('parseRecords on text that is not a JSON object returns an empty array', () => {
  assert.deepEqual(parseRecords('<html>sign in to continue</html>', 'objectReleaseInfo'), [])
  assert.deepEqual(parseRecords('null', 'objectReleaseInfo'), [])
})

test('the index is case-insensitive and keyed on both objectKey and tadirObjName', () => {
  const records: RawRecord[] = [
    { tadirObject: 'FUGR', tadirObjName: 'REBD_BAPI_BUILDING', objectType: 'FUNC', objectKey: 'BAPI_RE_BU_GET_DETAIL', state: 'released' },
    { tadirObject: 'TABL', tadirObjName: 'MARA', objectType: 'TABL', objectKey: 'MARA', state: 'notToBeReleased' },
  ]
  const dataset = buildDataset(records)
  assert.equal(dataset.byKey.get('bapi_re_bu_get_detail'.toUpperCase())?.length, 1)
  assert.equal(dataset.byTadirName.get('REBD_BAPI_BUILDING')?.length, 1)
  assert.equal(dataset.byKey.get('MARA')?.length, 1)
  assert.equal(dataset.records.length, 2)
})

test('several object types under one name all land in the same bucket', () => {
  const dataset = buildDataset([
    { tadirObject: 'TABL', tadirObjName: 'X', objectType: 'TABL', objectKey: 'X', state: 'released' },
    { tadirObject: 'DTEL', tadirObjName: 'X', objectType: 'DTEL', objectKey: 'X', state: 'notToBeReleased' },
  ])
  assert.equal(dataset.byKey.get('X')?.length, 2)
})

test('a record that arrives lower-cased is found under its upper-cased key', () => {
  const dataset = buildDataset([{ tadirObject: 'CLAS', tadirObjName: 'cl_a', objectType: 'CLAS', objectKey: 'cl_a', state: 'released' }])
  assert.equal(dataset.byKey.get('CL_A')?.length, 1)
  assert.equal(dataset.byTadirName.get('CL_A')?.length, 1)
})

// --- DatasetRegistry, over a real CacheManager on a fake transport ------------------------

const BASE = 'https://raw.example.invalid/src'

/** Every registry in this file writes into a fresh temp directory; they are all removed at the end. */
const temporaryDirs: string[] = []
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true })
})

const payload = (names: string[]) => ({
  formatVersion: 1,
  objectReleaseInfo: names.map((name) => ({ tadirObject: 'CLAS', tadirObjName: name, objectType: 'CLAS', objectKey: name, state: 'released' })),
})

async function makeRegistry(routes: Parameters<typeof fakeHttp>[0], iso = '2026-09-21T09:00:00+03:00') {
  const dataDir = await mkdtemp(join(tmpdir(), 'abap-kebap-datasets-'))
  temporaryDirs.push(dataDir)
  const http = fakeHttp(routes)
  const clock = fakeClock(iso)
  const cache = new CacheManager({ dataDir, baseUrl: BASE, githubApi: null, http, now: clock.now, log: () => undefined })
  return { registry: new DatasetRegistry(cache), cache, http, clock, dataDir }
}

const PCE_LATEST: FileSpec = {
  id: 'cloud-erp-private/latest',
  fileName: 'objectReleaseInfo_PCELatest.json',
  arrayKey: 'objectReleaseInfo',
  optional: false,
}

test('load downloads, parses and indexes a file the cache did not have yet', async () => {
  const { registry } = await makeRegistry({ 'objectReleaseInfo_PCELatest.json': jsonResponse(payload(['CL_A', 'CL_B'])) })
  const dataset = await registry.load(PCE_LATEST, 500)
  assert.equal(dataset.records.length, 2)
  assert.equal(dataset.byKey.get('CL_A')?.length, 1)
})

test('a second load reuses the parsed dataset instead of reading the file again', async () => {
  const { registry, dataDir } = await makeRegistry({ 'objectReleaseInfo_PCELatest.json': jsonResponse(payload(['CL_A'])) })
  const first = await registry.load(PCE_LATEST, 500)
  // Rewriting the file behind the registry's back proves the second call never touched the disk.
  await writeFile(join(dataDir, 'objectReleaseInfo_PCELatest.json'), JSON.stringify(payload(['CL_A', 'CL_B', 'CL_C'])), 'utf8')
  const second = await registry.load(PCE_LATEST, 500)
  assert.equal(second, first)
  assert.equal(second.records.length, 1)
})

test('a refresh that replaces the file drops the memoised dataset', async () => {
  const { registry, cache, http, clock } = await makeRegistry({ 'objectReleaseInfo_PCELatest.json': jsonResponse(payload(['CL_A']), '"e1"') })
  assert.equal((await registry.load(PCE_LATEST, 500)).records.length, 1)

  http.setRoute('objectReleaseInfo_PCELatest.json', jsonResponse(payload(['CL_A', 'CL_B']), '"e2"'))
  clock.advanceDays(1)
  await cache.refresh([PCE_LATEST])

  assert.equal((await registry.load(PCE_LATEST, 500)).records.length, 2)
})

test('invalidate forgets one dataset and leaves the others alone', async () => {
  const classification: FileSpec = {
    id: 'classification/sap',
    fileName: 'objectClassifications_SAP.json',
    arrayKey: 'objectClassifications',
    optional: false,
  }
  const { registry, dataDir } = await makeRegistry({
    'objectReleaseInfo_PCELatest.json': jsonResponse(payload(['CL_A'])),
    'objectClassifications_SAP.json': jsonResponse({
      formatVersion: 1,
      objectClassifications: [{ tadirObject: 'TABL', tadirObjName: 'MARA', objectType: 'TABL', objectKey: 'MARA', state: 'classicAPI' }],
    }),
  })
  const kept = await registry.load(classification, 500)
  await registry.load(PCE_LATEST, 500)

  await writeFile(join(dataDir, 'objectReleaseInfo_PCELatest.json'), JSON.stringify(payload(['CL_A', 'CL_B'])), 'utf8')
  registry.invalidate(PCE_LATEST.id)

  assert.equal((await registry.load(PCE_LATEST, 500)).records.length, 2)
  assert.equal(await registry.load(classification, 500), kept)
})

test('a file that holds no records is refused instead of answering as an empty dataset', async () => {
  const { registry, dataDir } = await makeRegistry({ 'objectReleaseInfo_PCELatest.json': jsonResponse(payload(['CL_A'])) })
  await registry.load(PCE_LATEST, 500)
  // Truncated or hand-edited on disk: the cache itself never writes a payload with zero rows.
  await writeFile(join(dataDir, 'objectReleaseInfo_PCELatest.json'), '{}', 'utf8')
  registry.invalidate(PCE_LATEST.id)

  await assert.rejects(
    () => registry.load(PCE_LATEST, 500),
    (error: unknown) => error instanceof CacheError && error.code === 'DATASET_UNAVAILABLE' && /truncated/.test(error.message),
  )
})

test('loadFirstAvailable falls through a candidate that does not exist upstream', async () => {
  const { registry } = await makeRegistry({ 'objectReleaseInfo_PCE2022_0.json': jsonResponse(payload(['CL_A'])) })
  const { dataset, spec } = await registry.loadFirstAvailable(resolveFiles('cloud-erp-private', '2022').releaseInfoCandidates, 500)
  assert.equal(spec.fileName, 'objectReleaseInfo_PCE2022_0.json')
  assert.equal(dataset.records.length, 1)
})

test('loadFirstAvailable reports an unknown version when no candidate exists upstream', async () => {
  const { registry } = await makeRegistry({})
  await assert.rejects(
    () => registry.loadFirstAvailable(resolveFiles('cloud-erp-private', '2019').releaseInfoCandidates, 500),
    (error: unknown) => error instanceof CacheError && error.code === 'UNKNOWN_VERSION',
  )
})

test('loadFirstAvailable surfaces a download in progress instead of trying the next candidate', async () => {
  const { registry, http } = await makeRegistry({ 'objectReleaseInfo_PCE2022.json': () => new Promise(() => undefined) })
  await assert.rejects(
    () => registry.loadFirstAvailable(resolveFiles('cloud-erp-private', '2022').releaseInfoCandidates, 20),
    (error: unknown) => error instanceof CacheError && error.code === 'DATASET_DOWNLOADING',
  )
  assert.equal(http.calls.filter((call) => call.url.endsWith('objectReleaseInfo_PCE2022_0.json')).length, 0)
})
