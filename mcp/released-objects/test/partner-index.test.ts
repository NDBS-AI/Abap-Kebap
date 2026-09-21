import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeHttp, jsonResponse } from './helpers/fixtures'
import {
  BUILT_IN_PARTNER_INDEX, fileNameForNamespace, namespaceFromFileName, namespaceOf,
  PartnerIndex, TEMPLATE_FILE,
} from '../src/partner-index'

const CONTENTS = 'contents/src/partner'
const listing = (names: string[]) => jsonResponse(names.map((name) => ({ name, type: 'file' })))
const indexWith = (route: unknown) =>
  new PartnerIndex({ http: fakeHttp({ [CONTENTS]: route as never }), apiBaseUrl: 'https://api.example', repo: 'SAP/repo' })

test('a namespace is recognised only at the start of a name', () => {
  assert.equal(namespaceOf('/OTX/CL_A'), '/OTX/')
  assert.equal(namespaceOf('/otx/cl_a'), '/OTX/')
  assert.equal(namespaceOf('MARA'), null)
  assert.equal(namespaceOf('CL_A/OTX/B'), null)
})

test('file names and namespaces convert both ways, and SAP\'s own file is not a namespace', () => {
  assert.equal(namespaceFromFileName('objectClassifications_OTX.json'), '/OTX/')
  assert.equal(fileNameForNamespace('/OTX/'), 'objectClassifications_OTX.json')
  assert.equal(namespaceFromFileName('objectClassifications_SAP.json'), null)
  assert.equal(namespaceFromFileName('objectReleaseInfoLatest.json'), null)
})

test('the template file is skipped by name', async () => {
  const entries = await indexWith(listing(['objectClassifications_OTX.json', TEMPLATE_FILE])).list()
  assert.deepEqual(entries, [{ namespace: '/OTX/', file: 'objectClassifications_OTX.json' }])
})

test('listings are sorted and deduplicated', async () => {
  const entries = await indexWith(listing(['objectClassifications_OTX.json', 'objectClassifications_ABC.json', 'objectClassifications_OTX.json'])).list()
  assert.deepEqual(entries.map((entry) => entry.namespace), ['/ABC/', '/OTX/'])
})

test('non-JSON and non-file entries are ignored', async () => {
  const entries = await indexWith(jsonResponse([
    { name: 'objectClassifications_OTX.json', type: 'file' },
    { name: 'README.md', type: 'file' },
    { name: 'objectClassifications_SUB.json', type: 'dir' },
  ])).list()
  assert.deepEqual(entries.map((entry) => entry.namespace), ['/OTX/'])
})

test('a rate-limited or failed listing falls back to the built-in list', async () => {
  const rateLimited = indexWith({ status: 403, headers: {}, body: 'rate limited' })
  assert.deepEqual(await rateLimited.list(), BUILT_IN_PARTNER_INDEX)
  assert.equal(rateLimited.source, 'built-in')

  const offline = indexWith(() => { throw new Error('fetch failed') })
  assert.deepEqual(await offline.list(), BUILT_IN_PARTNER_INDEX)
})

test('a mirror base URL turns discovery off entirely', async () => {
  const http = fakeHttp({ [CONTENTS]: listing(['objectClassifications_OTX.json']) })
  const index = new PartnerIndex({ http, apiBaseUrl: null, repo: 'SAP/repo' })
  assert.equal(index.usesGithubApi, false)
  assert.deepEqual(await index.list(), BUILT_IN_PARTNER_INDEX)
  assert.equal(http.calls.length, 0)
})

test('the listing is fetched once per instance and then served from memory', async () => {
  const http = fakeHttp({ [CONTENTS]: listing(['objectClassifications_OTX.json']) })
  const index = new PartnerIndex({ http, apiBaseUrl: 'https://api.example', repo: 'SAP/repo' })
  await index.list()
  await index.list()
  assert.equal(http.calls.length, 1)
  assert.equal(index.source, 'github-api')
})

test('an object name maps to its namespace entry, and a plain name maps to nothing', async () => {
  const index = indexWith(listing(['objectClassifications_OTX.json']))
  assert.deepEqual(await index.entryFor('/OTX/CL_A'), { namespace: '/OTX/', file: 'objectClassifications_OTX.json' })
  assert.equal(await index.entryFor('/ZZZ/CL_A'), null)
  assert.equal(await index.entryFor('MARA'), null)
})

test('the built-in list is non-empty, sorted and internally consistent', () => {
  assert.ok(BUILT_IN_PARTNER_INDEX.length > 0)
  const namespaces = BUILT_IN_PARTNER_INDEX.map((entry) => entry.namespace)
  assert.deepEqual(namespaces, [...namespaces].sort())
  for (const entry of BUILT_IN_PARTNER_INDEX) {
    assert.equal(fileNameForNamespace(entry.namespace), entry.file)
  }
})

test('a partner file spec is optional and lands under partner/ in the cache', async () => {
  const spec = indexWith(listing([])).specFor({ namespace: '/OTX/', file: 'objectClassifications_OTX.json' })
  assert.equal(spec.optional, true)
  assert.equal(spec.id, 'partner//OTX/')
  assert.equal(spec.fileName, 'partner/objectClassifications_OTX.json')
  assert.equal(spec.arrayKey, 'objectClassifications')
})
