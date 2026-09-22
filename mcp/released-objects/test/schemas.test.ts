import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkObjectsSchema, checkObjectsShape, datasetInfoSchema, datasetInfoShape,
  MAX_BATCH, MAX_NAME_LENGTH, normalizeObjectRef, searchObjectsSchema, searchObjectsShape,
} from '../src/schemas'

test('an object reference accepts a bare name or a name with a type', () => {
  assert.deepEqual(normalizeObjectRef('MARA'), { name: 'MARA' })
  assert.deepEqual(normalizeObjectRef({ name: 'MARA', type: 'TABL' }), { name: 'MARA', type: 'TABL' })
})

test('check_objects requires at least one object and caps the batch', () => {
  assert.equal(checkObjectsSchema.safeParse({ objects: [] }).success, false)
  assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'] }).success, true)
  assert.equal(checkObjectsSchema.safeParse({ objects: Array.from({ length: MAX_BATCH }, () => 'MARA') }).success, true)
  assert.equal(checkObjectsSchema.safeParse({ objects: Array.from({ length: MAX_BATCH + 1 }, () => 'MARA') }).success, false)
})

test('an object name is bounded and non-empty', () => {
  assert.equal(checkObjectsSchema.safeParse({ objects: [''] }).success, false)
  assert.equal(checkObjectsSchema.safeParse({ objects: ['X'.repeat(MAX_NAME_LENGTH + 1)] }).success, false)
})

test('target defaults to auto and rejects anything unknown', () => {
  assert.equal(checkObjectsSchema.parse({ objects: ['MARA'] }).target, 'auto')
  assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'cloud-erp' }).success, true)
  assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'on-prem' }).success, false)
})

test('a version must be latest or a release year, optionally with a feature pack', () => {
  for (const version of ['latest', '2023', '2022', '2021_1']) {
    assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'cloud-erp-private', version }).success, true, version)
  }
  for (const version of ['23', 'newest', '2023-FPS1', '']) {
    assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'cloud-erp-private', version }).success, false, version)
  }
})

test('a version on a public target is rejected with an explanatory message', () => {
  const result = checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'cloud-erp', version: '2023' })
  assert.equal(result.success, false)
  assert.match(result.error?.issues.map((issue) => issue.message).join(' ') ?? '', /private/i)
})

test('maxLevel is rejected on public cloud and BTP, where only Level A exists', () => {
  assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'cloud-erp-private', maxLevel: 'C' }).success, true)
  assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'cloud-erp', maxLevel: 'C' }).success, false)
  assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], target: 'btp-abap-environment', maxLevel: 'C' }).success, false)
  // `auto` cannot be validated here; check_objects re-checks once the target is known.
  assert.equal(checkObjectsSchema.safeParse({ objects: ['MARA'], maxLevel: 'C' }).success, true)
})

test('search bounds its pagination and defaults it', () => {
  const parsed = searchObjectsSchema.parse({ query: 'purchase' })
  assert.equal(parsed.limit, 20)
  assert.equal(parsed.offset, 0)
  assert.equal(searchObjectsSchema.safeParse({ query: 'purchase', limit: 0 }).success, false)
  assert.equal(searchObjectsSchema.safeParse({ query: 'purchase', limit: 201 }).success, false)
  assert.equal(searchObjectsSchema.safeParse({ query: 'purchase', offset: -1 }).success, false)
  assert.equal(searchObjectsSchema.safeParse({ query: '' }).success, false)
})

test('dataset_info takes no required input and defaults refresh to false', () => {
  assert.equal(datasetInfoSchema.parse({}).refresh, false)
  assert.equal(datasetInfoSchema.parse({}).target, 'auto')
  assert.equal(datasetInfoSchema.safeParse({ refresh: true }).success, true)
})

test('every public field carries description text for the calling model', () => {
  for (const shape of [checkObjectsShape, searchObjectsShape, datasetInfoShape]) {
    for (const [name, field] of Object.entries(shape)) {
      assert.ok((field.description ?? '').length > 20, `${name} needs a useful description`)
    }
  }
})
