import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDataset } from '../src/datasets'
import { deriveLevel, isAllowed, lookupObject, normalizeSuccessors, impliedLevelFor, NOT_FOUND_HINT } from '../src/query'
import type { RawRecord } from '../src/types'

const rec = (over: Partial<RawRecord>): RawRecord => ({
  tadirObject: 'CLAS', tadirObjName: 'X', objectType: 'CLAS', objectKey: 'X', state: 'released', ...over,
})

const sources = (releaseInfo: RawRecord[], classification: RawRecord[] = [], partner: RawRecord[] = []) => ({
  target: 'cloud-erp-private' as const,
  releaseInfo: buildDataset(releaseInfo),
  classification: classification.length ? buildDataset(classification) : null,
  partner: partner.length ? buildDataset(partner) : null,
  partnerNamespace: partner.length ? '/OTX/' : null,
})

test('on private, released and deprecated are Level A and everything else falls through', () => {
  assert.equal(deriveLevel('cloud-erp-private', 'released', null), 'A')
  assert.equal(deriveLevel('cloud-erp-private', 'deprecated', null), 'A')
  assert.equal(deriveLevel('cloud-erp-private', null, 'classicAPI'), 'B')
  assert.equal(deriveLevel('cloud-erp-private', 'notToBeReleased', 'classicAPI'), 'B')
  assert.equal(deriveLevel('cloud-erp-private', null, 'noAPI'), 'D')
  assert.equal(deriveLevel('cloud-erp-private', 'notToBeReleased', null), 'C')
  assert.equal(deriveLevel('cloud-erp-private', 'stable', null), 'C')
  assert.equal(deriveLevel('cloud-erp-private', null, null), 'C')
})

test('on public cloud and BTP only Level A exists and absent is never released', () => {
  for (const target of ['cloud-erp', 'btp-abap-environment'] as const) {
    assert.equal(deriveLevel(target, 'released', null), 'A')
    assert.equal(deriveLevel(target, 'deprecated', null), 'A')
    assert.equal(deriveLevel(target, 'notToBeReleased', null), 'none')
    assert.equal(deriveLevel(target, null, 'classicAPI'), 'none')
    assert.equal(deriveLevel(target, null, null), 'none')
  }
})

test('levels are cumulative against maxLevel and none is never allowed', () => {
  assert.equal(isAllowed('A', 'A'), true)
  assert.equal(isAllowed('B', 'A'), false)
  assert.equal(isAllowed('B', 'B'), true)
  assert.equal(isAllowed('C', 'B'), false)
  assert.equal(isAllowed('C', 'C'), true)
  assert.equal(isAllowed('D', 'C'), false)
  assert.equal(isAllowed('D', 'D'), true)
  assert.equal(isAllowed('none', 'D'), false)
})

test('successors normalise to objects and concepts, one hop only', () => {
  assert.deepEqual(
    normalizeSuccessors(rec({ successors: [{ objectType: 'DDLS', objectKey: 'I_PRODUCT' }], successorConceptName: 'I_MaintenanceNotificationTP_3' })),
    [{ kind: 'object', objectType: 'DDLS', objectKey: 'I_PRODUCT' }, { kind: 'concept', name: 'I_MaintenanceNotificationTP_3' }],
  )
  assert.deepEqual(normalizeSuccessors(rec({})), [])
})

test('a released object is allowed and carries both raw facts', () => {
  const result = lookupObject(sources([rec({ objectKey: 'CL_ABAP_UNIT_ASSERT', tadirObjName: 'CL_ABAP_UNIT_ASSERT', state: 'released', softwareComponent: 'SAP_BASIS' })]), { name: 'cl_abap_unit_assert' }, 'A')
  assert.equal(result.verdict, 'allowed')
  assert.equal(result.matches[0]?.releaseState, 'released')
  assert.equal(result.matches[0]?.classification, null)
  assert.equal(result.matches[0]?.cleanCoreLevel, 'A')
  assert.equal(result.matches[0]?.origin, 'sap')
})

test('a deprecated object is allowed-deprecated and carries the successor', () => {
  const result = lookupObject(
    sources([rec({ objectKey: 'CL_OLD', tadirObjName: 'CL_OLD', state: 'deprecated', successors: [{ objectType: 'CLAS', objectKey: 'CL_NEW' }], successorClassification: 'oneObject' })]),
    { name: 'CL_OLD' }, 'A',
  )
  assert.equal(result.verdict, 'allowed-deprecated')
  assert.equal(result.matches[0]?.deprecated, true)
  assert.deepEqual(result.matches[0]?.successors, [{ kind: 'object', objectType: 'CLAS', objectKey: 'CL_NEW' }])
  assert.equal(result.matches[0]?.successorClassification, 'oneObject')
})

test('a classic API is blocked at maxLevel A and allowed at maxLevel B', () => {
  const data = sources([], [rec({ objectKey: 'BAPI_X', tadirObjName: 'BAPI_X', objectType: 'FUNC', state: 'classicAPI' })])
  assert.equal(lookupObject(data, { name: 'BAPI_X' }, 'A').verdict, 'blocked')
  assert.equal(lookupObject(data, { name: 'BAPI_X' }, 'B').verdict, 'allowed')
  assert.equal(lookupObject(data, { name: 'BAPI_X' }, 'B').matches[0]?.cleanCoreLevel, 'B')
})

test('a function module is found through its function group name too', () => {
  const data = sources([rec({ tadirObject: 'FUGR', tadirObjName: 'REBD_BAPI_BUILDING', objectType: 'FUNC', objectKey: 'BAPI_RE_BU_GET_DETAIL', state: 'released' })])
  assert.equal(lookupObject(data, { name: 'REBD_BAPI_BUILDING' }, 'A').found, true)
})

test('one name under two types with different outcomes and no type given is ambiguous', () => {
  const data = sources([
    rec({ objectType: 'TABL', objectKey: 'X', tadirObject: 'TABL', state: 'released' }),
    rec({ objectType: 'DTEL', objectKey: 'X', tadirObject: 'DTEL', state: 'notToBeReleased' }),
  ])
  assert.equal(lookupObject(data, { name: 'X' }, 'A').verdict, 'ambiguous')
  assert.equal(lookupObject(data, { name: 'X', type: 'TABL' }, 'A').verdict, 'allowed')
  assert.equal(lookupObject(data, { name: 'X', type: 'DTEL' }, 'A').verdict, 'blocked')
})

test('an absent name is not-found with an implied level and the standing hint', () => {
  const priv = lookupObject(sources([rec({})]), { name: 'NOPE' }, 'C')
  assert.equal(priv.verdict, 'not-found')
  assert.equal(priv.impliedLevel, 'C')
  assert.equal(priv.allowed, true, 'implied C is inside maxLevel C')
  assert.equal(priv.hint, NOT_FOUND_HINT)

  const strict = lookupObject(sources([rec({})]), { name: 'NOPE' }, 'A')
  assert.equal(strict.allowed, false)
})

test('implied level is none on public cloud and BTP - absent is never treated as released', () => {
  assert.equal(impliedLevelFor('cloud-erp'), 'none')
  assert.equal(impliedLevelFor('btp-abap-environment'), 'none')
  assert.equal(impliedLevelFor('cloud-erp-private'), 'C')
})

test('a partner classification supplies the level and stamps origin and labels', () => {
  const data = sources([], [], [rec({ objectKey: '/OTX/CL_A', tadirObjName: '/OTX/CL_A', state: 'classicAPI', labels: ['remote-enabled'] })])
  const result = lookupObject(data, { name: '/OTX/CL_A' }, 'B')
  assert.equal(result.matches[0]?.origin, 'partner:/OTX/')
  assert.equal(result.matches[0]?.cleanCoreLevel, 'B')
  assert.deepEqual(result.matches[0]?.labels, ['remote-enabled'])
})

test('SAP data wins over a partner file for a namespace SAP also ships', () => {
  const data = sources([rec({ objectKey: '/AIF/CL_X', tadirObjName: '/AIF/CL_X', state: 'released' })], [], [rec({ objectKey: '/AIF/CL_X', tadirObjName: '/AIF/CL_X', state: 'noAPI' })])
  const result = lookupObject(data, { name: '/AIF/CL_X' }, 'A')
  assert.equal(result.matches[0]?.origin, 'sap')
  assert.equal(result.matches[0]?.cleanCoreLevel, 'A')
})
