import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { loadConfig, DEFAULT_BASE_URL } from '../src/config'

/** A synthetic absolute home; never a real path on the machine running the tests. */
const HOME = process.platform === 'win32' ? 'C:\\test-home\\tester' : '/home/tester'

test('--data-dir wins over the environment and the home fallback', () => {
  const dir = join(HOME, 'plugin-data', 'released-objects')
  const cfg = loadConfig(['--data-dir', dir], { ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR: join(HOME, 'other') }, HOME)
  assert.equal(cfg.dataDir, dir)
})

test('an unexpanded placeholder never becomes a literal directory', () => {
  const cfg = loadConfig(['--data-dir', '${CLAUDE_PLUGIN_DATA}/released-objects'], {}, HOME)
  assert.equal(cfg.dataDir, join(HOME, '.abap-kebap', 'released-objects'))
  assert.equal(cfg.warnings.length, 1)
})

test('with no argument and no environment it falls back to the home directory', () => {
  const cfg = loadConfig([], {}, HOME)
  assert.equal(cfg.dataDir, join(HOME, '.abap-kebap', 'released-objects'))
  assert.equal(cfg.baseUrl, DEFAULT_BASE_URL)
  assert.equal(cfg.targetPin, null)
  assert.equal(cfg.verbose, false)
})

test('a mirror base URL is accepted and its trailing slashes stripped', () => {
  const cfg = loadConfig([], { ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL: 'https://mirror.example.com/atc/src//' }, HOME)
  assert.equal(cfg.baseUrl, 'https://mirror.example.com/atc/src')
})

test('a non-http base URL is rejected with a warning, not adopted', () => {
  const cfg = loadConfig([], { ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL: 'file:///etc/passwd' }, HOME)
  assert.equal(cfg.baseUrl, DEFAULT_BASE_URL)
  assert.match(cfg.warnings.join(' '), /BASE_URL/)
})

test('the target pin accepts the three targets and warns on anything else', () => {
  assert.equal(loadConfig([], { ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'cloud-erp-private' }, HOME).targetPin, 'cloud-erp-private')
  const bad = loadConfig([], { ABAP_KEBAP_RELEASED_OBJECTS_TARGET: 'on-prem' }, HOME)
  assert.equal(bad.targetPin, null)
  assert.match(bad.warnings.join(' '), /on-prem/)
})

test('ADT paths default under the state directory and are individually overridable', () => {
  const dflt = loadConfig([], {}, HOME)
  assert.equal(dflt.adtStateDir, join(HOME, '.adtls'))
  assert.equal(dflt.adtDestinationsPath, join(HOME, '.adtls', 'destinations.json'))
  const custom = loadConfig([], { ABAP_KEBAP_ADT_DESTINATIONS_PATH: join(HOME, 'alt.json') }, HOME)
  assert.equal(custom.adtDestinationsPath, join(HOME, 'alt.json'))
})

test('--verbose is recognised', () => {
  assert.equal(loadConfig(['--verbose'], {}, HOME).verbose, true)
})

test('the version pin accepts latest, a year and a feature pack, and warns otherwise', () => {
  assert.equal(loadConfig([], { ABAP_KEBAP_RELEASED_OBJECTS_VERSION: '2023' }, HOME).versionPin, '2023')
  assert.equal(loadConfig([], { ABAP_KEBAP_RELEASED_OBJECTS_VERSION: '2021_1' }, HOME).versionPin, '2021_1')
  const bad = loadConfig([], { ABAP_KEBAP_RELEASED_OBJECTS_VERSION: 'FPS1' }, HOME)
  assert.equal(bad.versionPin, null)
  assert.match(bad.warnings.join(' '), /VERSION/)
})
