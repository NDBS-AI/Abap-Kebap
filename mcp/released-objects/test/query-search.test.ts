import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDataset } from '../src/datasets'
import { boundedLevenshtein, searchObjects, suggestNearMatches, SUGGESTION_LIMIT } from '../src/query'
import type { RawRecord } from '../src/types'

const rec = (over: Partial<RawRecord>): RawRecord => ({
  tadirObject: 'DDLS', tadirObjName: 'X', objectType: 'DDLS', objectKey: 'X', state: 'released', ...over,
})

const pool = (records: RawRecord[], origin: 'sap' | `partner:${string}` = 'sap') => ({ dataset: buildDataset(records), origin })
const noClassification = () => null

test('ranking is exact, then prefix, then substring, then all-tokens', () => {
  const records = [
    rec({ objectKey: 'I_PURCHASEORDERITEM', tadirObjName: 'I_PURCHASEORDERITEM' }),
    rec({ objectKey: 'PURCHASE', tadirObjName: 'PURCHASE' }),
    rec({ objectKey: 'ZZ_PURCHASE_HELPER', tadirObjName: 'ZZ_PURCHASE_HELPER' }),
    rec({ objectKey: 'PURCHASEREQUISITION', tadirObjName: 'PURCHASEREQUISITION' }),
  ]
  const outcome = searchObjects([pool(records)], { query: 'PURCHASE', limit: 10, offset: 0 }, 'cloud-erp', noClassification)
  assert.deepEqual(outcome.results.map((hit) => hit.objectKey), ['PURCHASE', 'PURCHASEREQUISITION', 'I_PURCHASEORDERITEM', 'ZZ_PURCHASE_HELPER'])
})

test('a multi-token query matches when every token appears as a substring', () => {
  const records = [rec({ objectKey: 'I_PURCHASEORDERITEM', tadirObjName: 'I_PURCHASEORDERITEM' }), rec({ objectKey: 'I_SALESORDER', tadirObjName: 'I_SALESORDER' })]
  const outcome = searchObjects([pool(records)], { query: 'purchase order', limit: 10, offset: 0 }, 'cloud-erp', noClassification)
  assert.deepEqual(outcome.results.map((hit) => hit.objectKey), ['I_PURCHASEORDERITEM'])
})

test('ties sort alphabetically', () => {
  const records = [rec({ objectKey: 'I_B', tadirObjName: 'I_B' }), rec({ objectKey: 'I_A', tadirObjName: 'I_A' })]
  const outcome = searchObjects([pool(records)], { query: 'I_', limit: 10, offset: 0 }, 'cloud-erp', noClassification)
  assert.deepEqual(outcome.results.map((hit) => hit.objectKey), ['I_A', 'I_B'])
})

test('objectType, applicationComponent prefix, state and label all filter', () => {
  const records = [
    rec({ objectKey: 'A1', tadirObjName: 'A1', objectType: 'CLAS', applicationComponent: 'MM-PUR-SRC-SL', state: 'released', labels: ['remote-enabled'] }),
    rec({ objectKey: 'A2', tadirObjName: 'A2', objectType: 'DDLS', applicationComponent: 'SD-SLS', state: 'notToBeReleased' }),
  ]
  const base = { query: 'A', limit: 10, offset: 0 }
  assert.equal(searchObjects([pool(records)], { ...base, objectType: 'clas' }, 'cloud-erp', noClassification).total, 1)
  assert.equal(searchObjects([pool(records)], { ...base, applicationComponent: 'mm-pur' }, 'cloud-erp', noClassification).total, 1)
  assert.equal(searchObjects([pool(records)], { ...base, state: 'released' }, 'cloud-erp', noClassification).total, 1)
  assert.equal(searchObjects([pool(records)], { ...base, label: 'remote-enabled' }, 'cloud-erp', noClassification).total, 1)
})

test('maxLevel filters on the derived level, and total counts before pagination', () => {
  const records = Array.from({ length: 30 }, (_unused, index) => rec({ objectKey: `I_A${String(index).padStart(2, '0')}`, tadirObjName: `I_A${String(index).padStart(2, '0')}` }))
  const withUnreleased = [...records, rec({ objectKey: 'I_ABLOCKED', tadirObjName: 'I_ABLOCKED', state: 'notToBeReleased' })]
  const outcome = searchObjects([pool(records)], { query: 'I_A', limit: 10, offset: 20 }, 'cloud-erp', noClassification)
  assert.equal(outcome.total, 30)
  assert.equal(outcome.results.length, 10)
  assert.equal(outcome.results[0]?.objectKey, 'I_A20')
  assert.equal(searchObjects([pool(withUnreleased)], { query: 'I_A', limit: 50, offset: 0 }, 'cloud-erp', noClassification).total, 31)
  assert.equal(searchObjects([pool(withUnreleased)], { query: 'I_A', limit: 50, offset: 0, maxLevel: 'A' }, 'cloud-erp', noClassification).total, 30)
})

test('partner hits carry their origin and labels', () => {
  const outcome = searchObjects(
    [pool([rec({ objectKey: '/OTX/CL_A', tadirObjName: '/OTX/CL_A', state: 'classicAPI', labels: ['transactional-consistent'] })], 'partner:/OTX/')],
    { query: 'OTX', limit: 10, offset: 0 }, 'cloud-erp-private', noClassification,
  )
  assert.equal(outcome.results[0]?.origin, 'partner:/OTX/')
  assert.equal(outcome.results[0]?.cleanCoreLevel, 'B')
  assert.deepEqual(outcome.results[0]?.labels, ['transactional-consistent'])
})

test('bounded Levenshtein returns the distance inside the bound and null beyond it', () => {
  assert.equal(boundedLevenshtein('MARA', 'MARA', 2), 0)
  assert.equal(boundedLevenshtein('MARA', 'MARC', 2), 1)
  assert.equal(boundedLevenshtein('MARA', 'MRAC', 2), 2)
  assert.equal(boundedLevenshtein('MARA', 'COMPLETELY_OTHER', 2), null)
})

test('a typo is recovered by edit distance and reported with its reason', () => {
  const records = [rec({ objectKey: 'SOME_UNKNOWN_OBJ', tadirObjName: 'SOME_UNKNOWN_OBJ', objectType: 'TABL', state: 'released' })]
  const suggestions = suggestNearMatches([pool(records)], 'SOME_UNKNOWN_OBJX', 'cloud-erp', noClassification, SUGGESTION_LIMIT)
  assert.equal(suggestions[0]?.objectKey, 'SOME_UNKNOWN_OBJ')
  assert.equal(suggestions[0]?.reason, 'edit-distance')
})

test('a namespace variant is recovered when the slashes are ignored', () => {
  const records = [rec({ objectKey: '/OTX/CL_A', tadirObjName: '/OTX/CL_A', objectType: 'CLAS' })]
  const suggestions = suggestNearMatches([pool(records)], 'OTX_CL_A', 'cloud-erp', noClassification, SUGGESTION_LIMIT)
  assert.equal(suggestions[0]?.objectKey, '/OTX/CL_A')
})

test('exact-other-type, prefix and substring are each reported, in that order', () => {
  const records = [
    rec({ objectKey: 'I_PRODUCTTEXT', tadirObjName: 'I_PRODUCTTEXT' }),
    rec({ objectKey: 'PRODUCTGROUP', tadirObjName: 'PRODUCTGROUP' }),
    rec({ objectKey: 'PRODUCT', tadirObjName: 'PRODUCT', objectType: 'TABL' }),
  ]
  const suggestions = suggestNearMatches([pool(records)], 'PRODUCT', 'cloud-erp', noClassification, SUGGESTION_LIMIT)
  assert.deepEqual(
    suggestions.map((suggestion) => [suggestion.objectKey, suggestion.reason]),
    [['PRODUCT', 'exact-other-type'], ['PRODUCTGROUP', 'prefix'], ['I_PRODUCTTEXT', 'substring']],
  )
})

test('no near match yields an empty list rather than noise', () => {
  const records = [rec({ objectKey: 'AAAA', tadirObjName: 'AAAA' })]
  assert.deepEqual(suggestNearMatches([pool(records)], 'ZZZZZZZZZZZZ', 'cloud-erp', noClassification, SUGGESTION_LIMIT), [])
})

test('suggestions are capped at five', () => {
  const records = Array.from({ length: 40 }, (_unused, index) => rec({ objectKey: `I_PROD${index}`, tadirObjName: `I_PROD${index}` }))
  assert.equal(suggestNearMatches([pool(records)], 'I_PROD', 'cloud-erp', noClassification, SUGGESTION_LIMIT).length, SUGGESTION_LIMIT)
})
