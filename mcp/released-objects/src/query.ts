import type { Dataset } from './datasets'
import type { CleanCoreLevel, Match, MaxLevel, Origin, RawRecord, Successor, Target } from './types'

export const LEVEL_ORDER: Record<CleanCoreLevel, number> = { A: 0, B: 1, C: 2, D: 3, none: 99 }

/** Only these two states are a release contract; `stable` is tolerated but not a release. */
const RELEASED_STATES = new Set(['released', 'deprecated'])

export function deriveLevel(target: Target, releaseState: string | null, classification: string | null): CleanCoreLevel {
  const released = releaseState !== null && RELEASED_STATES.has(releaseState)
  if (target !== 'cloud-erp-private') return released ? 'A' : 'none'
  if (released) return 'A'
  if (classification === 'classicAPI') return 'B'
  if (classification === 'noAPI') return 'D'
  return 'C'
}

export function isAllowed(level: CleanCoreLevel, maxLevel: MaxLevel): boolean {
  if (level === 'none') return false
  return LEVEL_ORDER[level] <= LEVEL_ORDER[maxLevel]
}

/** Absent from the data is not the same as released (spec 6.2). */
export function impliedLevelFor(target: Target): CleanCoreLevel {
  return target === 'cloud-erp-private' ? 'C' : 'none'
}

export function normalizeSuccessors(record: RawRecord): Successor[] {
  const out: Successor[] = []
  for (const successor of record.successors ?? []) {
    out.push({ kind: 'object', objectType: successor.objectType, objectKey: successor.objectKey })
  }
  if (record.successorConceptName) out.push({ kind: 'concept', name: record.successorConceptName })
  return out
}

export const NOT_FOUND_HINT =
  'Not in the SAP data for this target. Check the type (CDS entity DDLS vs SQL view, function group FUGR vs function module FUNC) and namespaces (/NS/CL_X). Custom Z/Y objects are never listed.'

export function vendorHint(namespace: string): string {
  return `No classification published for ${namespace} in the Cloudification Repository - ask the vendor.`
}

export type Verdict = 'allowed' | 'allowed-deprecated' | 'blocked' | 'not-found' | 'ambiguous'

/** Why a near match was offered instead of the name that was asked for (spec 7.1). */
export type SuggestionReason = 'exact-other-type' | 'prefix' | 'substring' | 'namespace-variant' | 'edit-distance'

/** Produced by the search half of this module; carried on a not-found result. */
export interface Suggestion {
  objectType: string
  objectKey: string
  cleanCoreLevel: CleanCoreLevel
  reason: SuggestionReason
}

export interface LookupSources {
  target: Target
  releaseInfo: Dataset
  /** SAP's classification file; only loaded for cloud-erp-private. */
  classification: Dataset | null
  /** The partner file for the namespace of the requested object, when one exists. */
  partner: Dataset | null
  partnerNamespace: string | null
}

export interface ObjectRequest {
  name: string
  type?: string
}

export interface ObjectResult {
  name: string
  verdict: Verdict
  found: boolean
  matches: Match[]
  impliedLevel?: CleanCoreLevel
  allowed?: boolean
  suggestions?: Suggestion[]
  hint?: string
}

function recordsFor(dataset: Dataset | null, key: string): RawRecord[] {
  if (!dataset) return []
  // A hit on the TADIR name is only interesting when it is not already a hit on the key itself
  // (a function module found through its function group, for instance).
  const byTadirName = (dataset.byTadirName.get(key) ?? []).filter((record) => record.objectKey.toUpperCase() !== key)
  return [...(dataset.byKey.get(key) ?? []), ...byTadirName]
}

const identity = (record: RawRecord) => `${record.objectType}\u0000${record.objectKey.toUpperCase()}`

export function lookupObject(sources: LookupSources, request: ObjectRequest, maxLevel: MaxLevel): ObjectResult {
  const key = request.name.trim().toUpperCase()
  const releaseRecords = recordsFor(sources.releaseInfo, key)
  const sapClassRecords = recordsFor(sources.classification, key)
  const partnerRecords = recordsFor(sources.partner, key)
  const partnerOrigin: Origin = sources.partnerNamespace ? `partner:${sources.partnerNamespace}` : 'sap'

  /** One entry per concrete object; release info and classifications are merged onto it. */
  const merged = new Map<string, { release: RawRecord | null; classification: RawRecord | null; origin: Origin }>()
  const slot = (record: RawRecord, origin: Origin) => {
    const id = identity(record)
    let entry = merged.get(id)
    if (!entry) {
      entry = { release: null, classification: null, origin }
      merged.set(id, entry)
    }
    return entry
  }

  for (const record of releaseRecords) slot(record, 'sap').release = record
  // SAP first, then partner: a namespace SAP also ships resolves through SAP (spec 6.5).
  for (const record of sapClassRecords) {
    const entry = slot(record, 'sap')
    if (!entry.classification) entry.classification = record
  }
  for (const record of partnerRecords) {
    const entry = slot(record, partnerOrigin)
    // Only an object SAP says nothing about is answered out of the partner file; the entry the
    // guard lets through is always one this loop just created, so its origin is already partner's.
    if (!entry.classification && !entry.release) entry.classification = record
  }

  let matches: Match[] = [...merged.values()].map(({ release, classification, origin }) => {
    const base = release ?? classification
    if (!base) throw new Error('unreachable: a merged entry always carries a record')
    const releaseState = release?.state ?? null
    const classificationState = classification?.state ?? null
    const level = deriveLevel(sources.target, releaseState, classificationState)
    return {
      objectType: base.objectType,
      objectKey: base.objectKey,
      tadirObject: base.tadirObject,
      tadirObjName: base.tadirObjName,
      softwareComponent: base.softwareComponent ?? null,
      applicationComponent: base.applicationComponent ?? null,
      releaseState,
      classification: classificationState,
      origin,
      cleanCoreLevel: level,
      allowed: isAllowed(level, maxLevel),
      deprecated: releaseState === 'deprecated',
      successors: normalizeSuccessors(base),
      successorClassification: base.successorClassification ?? null,
      labels: base.labels ?? [],
    }
  })

  if (request.type) {
    const wanted = request.type.toUpperCase()
    matches = matches.filter((match) => match.objectType.toUpperCase() === wanted || match.tadirObject.toUpperCase() === wanted)
  }

  if (matches.length === 0) {
    const implied = impliedLevelFor(sources.target)
    return {
      name: request.name,
      verdict: 'not-found',
      found: false,
      matches: [],
      impliedLevel: implied,
      allowed: isAllowed(implied, maxLevel),
      hint: NOT_FOUND_HINT,
    }
  }

  const distinctOutcomes = new Set(matches.map((match) => match.allowed))
  if (matches.length > 1 && !request.type && distinctOutcomes.size > 1) {
    return { name: request.name, verdict: 'ambiguous', found: true, matches }
  }

  const allAllowed = matches.every((match) => match.allowed)
  const anyDeprecated = matches.some((match) => match.deprecated)
  const verdict: Verdict = allAllowed ? (anyDeprecated ? 'allowed-deprecated' : 'allowed') : 'blocked'
  return { name: request.name, verdict, found: true, matches }
}
