import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyManifest, localDateKey, parseManifest, shouldCheck, validatePayload, sha256, SCHEMA_VERSION } from '../src/cache'

// The daily gate compares local calendar days, so a fixture written with a fixed UTC offset only
// means what it says on a machine at that offset. Build the instant from local wall-clock parts
// instead - the manager stores the same absolute UTC string a real check would.
const localIso = (year: number, monthIndex: number, day: number, hour: number, minute: number) =>
  new Date(year, monthIndex, day, hour, minute).toISOString()

const releaseInfo = (entries: number) =>
  JSON.stringify({
    formatVersion: 1,
    objectReleaseInfo: Array.from({ length: entries }, (_unused, index) => ({
      tadirObject: 'CLAS',
      tadirObjName: `CL_${index}`,
      objectType: 'CLAS',
      objectKey: `CL_${index}`,
      state: 'released',
    })),
  })

test('a manifest with no lastCheckedAt always wants a check', () => {
  assert.equal(shouldCheck(emptyManifest(), new Date('2026-09-21T08:00:00Z')), true)
})

test('a second call on the same local day does not check again', () => {
  const manifest = emptyManifest()
  manifest.lastCheckedAt = localIso(2026, 8, 21, 6, 0)
  assert.equal(shouldCheck(manifest, new Date(2026, 8, 21, 20, 0)), false)
})

test('the first call after local midnight checks again', () => {
  const manifest = emptyManifest()
  manifest.lastCheckedAt = localIso(2026, 8, 21, 23, 50)
  assert.equal(shouldCheck(manifest, new Date(2026, 8, 22, 0, 10)), true)
})

test('a one-hour backoff suppresses checks even on a brand-new manifest', () => {
  const manifest = emptyManifest()
  manifest.lastCheckError = 'fetch failed'
  manifest.nextCheckAt = '2026-09-21T09:00:00Z'
  assert.equal(shouldCheck(manifest, new Date('2026-09-21T08:30:00Z')), false)
  assert.equal(shouldCheck(manifest, new Date('2026-09-21T09:30:00Z')), true)
})

test('force bypasses both the daily gate and the backoff', () => {
  const manifest = emptyManifest()
  manifest.lastCheckedAt = localIso(2026, 8, 21, 6, 0)
  manifest.nextCheckAt = '2099-01-01T00:00:00Z'
  assert.equal(shouldCheck(manifest, new Date(2026, 8, 21, 7, 0), true), true)
})

test('localDateKey uses local components, not UTC', () => {
  assert.equal(localDateKey(new Date(2026, 8, 21, 1, 30)), '2026-09-21')
})

test('a valid payload reports its entry count', () => {
  assert.deepEqual(validatePayload(releaseInfo(120), 'objectReleaseInfo', null), { ok: true, entries: 120 })
})

test('a string formatVersion is accepted - partner files ship "2"', () => {
  const text = JSON.stringify({ formatVersion: '2', objectClassifications: [{ objectKey: 'X', state: 'classicAPI' }] })
  assert.equal(validatePayload(text, 'objectClassifications', null).ok, true)
})

test('unparsable, empty, key-less and version-less payloads are all rejected with a reason', () => {
  const cases: [string, string][] = [
    ['{ not json', 'objectReleaseInfo'],
    [JSON.stringify({ formatVersion: 1, objectReleaseInfo: [] }), 'objectReleaseInfo'],
    [JSON.stringify({ formatVersion: 1, other: [1] }), 'objectReleaseInfo'],
    [JSON.stringify({ objectReleaseInfo: [1] }), 'objectReleaseInfo'],
  ]
  for (const [text, key] of cases) {
    const result = validatePayload(text, key, null)
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.reason.length > 0)
  }
})

test('the truncation guard rejects a file that lost more than half its rows', () => {
  assert.equal(validatePayload(releaseInfo(40), 'objectReleaseInfo', 1000).ok, false)
})

test('the truncation guard is off below 100 previous entries - small partner files may shrink', () => {
  assert.equal(validatePayload(releaseInfo(3), 'objectReleaseInfo', 90).ok, true)
})

test('a corrupt or foreign-schema manifest degrades to an empty one instead of throwing', () => {
  assert.deepEqual(parseManifest('{ broken'), emptyManifest())
  assert.deepEqual(parseManifest(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, files: { a: {} } })), emptyManifest())
})

test('a well-formed manifest round-trips', () => {
  const manifest = emptyManifest()
  manifest.lastCheckedAt = localIso(2026, 8, 21, 6, 0)
  assert.deepEqual(parseManifest(JSON.stringify(manifest)), manifest)
})

test('sha256 is stable and content-sensitive', () => {
  assert.equal(sha256('abc'), sha256('abc'))
  assert.notEqual(sha256('abc'), sha256('abd'))
})
