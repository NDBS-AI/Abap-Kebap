import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config'
import {
  classifyDestination, lastLoggedOnDestination, readDestinations, redactHost,
  resolveTarget, TargetResolutionError,
} from '../src/target-resolver'
import type { ServerConfig } from '../src/config'

/**
 * Every fake ADT state directory lives under the system temp directory and is removed at the
 * end; the real `~/.adtls` is never read, because nothing here ever falls back to the home
 * directory of the machine running the tests.
 */
const temporaryDirs: string[] = []
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true })
})

const workspace = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ro-target-'))
  temporaryDirs.push(dir)
  return dir
}

/** A real config, so the test cannot drift from what the server actually passes. */
const configFor = async (stateDir: string, env: NodeJS.ProcessEnv = {}): Promise<ServerConfig> =>
  loadConfig([], { ABAP_KEBAP_ADT_STATE_DIR: stateDir, ...env }, await workspace())

const writeDestinations = async (dir: string, value: unknown) => {
  const path = join(dir, 'destinations.json')
  await writeFile(path, JSON.stringify(value), 'utf8')
  return path
}

const SAMPLE = {
  destinations: [
    {
      id: 'DEV', protocol: 'http',
      properties: { systemUrl: 'https://my123456.s4hana.cloud.sap:443/sap/bc/adt', systemId: 'S4D' },
      user: 'SOME_USER', authenticationKind: 'basic', password: 'never-read-this',
    },
  ],
}

test('the destinations reader keeps only id, protocol, host and systemId', async () => {
  const dir = await workspace()
  const summaries = await readDestinations(await writeDestinations(dir, SAMPLE))
  assert.deepEqual(summaries, [{ id: 'DEV', protocol: 'http', host: 'my123456.s4hana.cloud.sap', systemId: 'S4D' }])
})

test('no credential-like value survives into the serialized summary', async () => {
  const dir = await workspace()
  const serialized = JSON.stringify(await readDestinations(await writeDestinations(dir, SAMPLE)))
  for (const secret of ['SOME_USER', 'never-read-this', 'basic', 'password', 'authenticationKind']) {
    assert.equal(serialized.includes(secret), false, `${secret} leaked into the summary`)
  }
})

test('a missing or malformed destinations file yields an empty list rather than throwing', async () => {
  const dir = await workspace()
  assert.deepEqual(await readDestinations(join(dir, 'absent.json')), [])
  assert.deepEqual(await readDestinations(await writeDestinations(dir, { nope: 1 })), [])
})

test('hosts are reduced to their last three labels before they can be shown', () => {
  assert.equal(redactHost('my123456.s4hana.cloud.sap'), 's4hana.cloud.sap')
  assert.equal(redactHost('abap.internal.corp.example.com'), 'corp.example.com')
  assert.equal(redactHost('localhost'), 'localhost')
  assert.equal(redactHost(''), 'unknown-host')
})

test('the RFC protocol always means a private or on-premise system', () => {
  assert.deepEqual(
    classifyDestination({ id: 'PRD', protocol: 'rfc', host: 'anything.example.com', systemId: 'PRD' }),
    { target: 'cloud-erp-private', confidence: 'high' },
  )
})

test('host shapes classify public cloud and the BTP ABAP environment', () => {
  assert.equal(classifyDestination({ id: 'A', protocol: 'http', host: 'my123456.s4hana.cloud.sap', systemId: 'S4D' }).target, 'cloud-erp')
  assert.equal(classifyDestination({ id: 'B', protocol: 'http', host: 'my123456-api.s4hana.ondemand.com', systemId: 'S4D' }).target, 'cloud-erp')
  assert.equal(classifyDestination({ id: 'C', protocol: 'http', host: 'abcd-1234.abap.eu10.hana.ondemand.com', systemId: 'BTP' }).target, 'btp-abap-environment')
  const unknown = classifyDestination({ id: 'D', protocol: 'http', host: 'sap-internal.example.com', systemId: 'DEV' })
  assert.equal(unknown.target, 'cloud-erp-private')
  assert.equal(unknown.confidence, 'low')
})

test('an explicit request wins over everything and is high confidence', async () => {
  const config = await configFor(join(await workspace(), 'nope'))
  assert.deepEqual(await resolveTarget({ requested: 'btp-abap-environment', config }), {
    target: 'btp-abap-environment', version: 'latest', resolvedFrom: 'request', confidence: 'high',
  })
})

test('the configured pin resolves auto and carries the pinned version', async () => {
  const config = await configFor(join(await workspace(), 'nope'), {
    ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'cloud-erp-private',
    ABAP_KEBAP_RELEASED_OBJECTS_VERSION: '2023',
  })
  const resolution = await resolveTarget({ requested: 'auto', config })
  assert.equal(resolution.target, 'cloud-erp-private')
  assert.equal(resolution.version, '2023')
  assert.equal(resolution.resolvedFrom, 'environment')
})

test('a single destination resolves auto and echoes an assumption without the full host', async () => {
  const dir = await workspace()
  await writeDestinations(dir, SAMPLE)
  const resolution = await resolveTarget({ requested: 'auto', config: await configFor(dir) })
  assert.equal(resolution.target, 'cloud-erp')
  assert.equal(resolution.resolvedFrom, 'single-destination')
  assert.match(resolution.assumption ?? '', /DEV/)
  assert.equal((resolution.assumption ?? '').includes('my123456'), false)
})

test('the last logged-on session breaks a tie but is never better than medium confidence', async () => {
  const dir = await workspace()
  await writeDestinations(dir, {
    destinations: [
      { id: 'DEV', protocol: 'http', properties: { systemUrl: 'https://my1.s4hana.cloud.sap', systemId: 'S4D' } },
      { id: 'PRD', protocol: 'rfc', properties: { systemUrl: 'sapmsPRD', systemId: 'PRD' } },
    ],
  })
  await mkdir(join(dir, 'session-PRD-abc123'), { recursive: true })
  const resolution = await resolveTarget({ requested: 'auto', config: await configFor(dir) })
  assert.equal(resolution.target, 'cloud-erp-private')
  assert.equal(resolution.resolvedFrom, 'adt-session')
  assert.equal(resolution.confidence, 'medium')
  assert.equal(await lastLoggedOnDestination(dir), 'PRD')
})

test('several destinations and no hint is ambiguous, with redacted candidates', async () => {
  const dir = await workspace()
  await writeDestinations(dir, {
    destinations: [
      { id: 'DEV', protocol: 'http', properties: { systemUrl: 'https://my1.s4hana.cloud.sap', systemId: 'S4D' } },
      { id: 'PRD', protocol: 'rfc', properties: { systemUrl: 'sapmsPRD', systemId: 'PRD' } },
    ],
  })
  const config = await configFor(dir)
  const error = await resolveTarget({ requested: 'auto', config }).then(() => null, (caught: unknown) => caught)
  assert.ok(error instanceof TargetResolutionError)
  assert.equal(error.code, 'TARGET_AMBIGUOUS')
  assert.deepEqual(error.candidates.map((candidate) => candidate.id), ['DEV', 'PRD'])
  assert.equal(JSON.stringify(error.candidates).includes('my1.'), false)
})

test('nothing to go on is unresolved rather than a silent default', async () => {
  const config = await configFor(join(await workspace(), 'nope'))
  const error = await resolveTarget({ requested: 'auto', config }).then(() => null, (caught: unknown) => caught)
  assert.ok(error instanceof TargetResolutionError)
  assert.equal(error.code, 'TARGET_UNRESOLVED')
  assert.deepEqual(error.candidates, [])
})
