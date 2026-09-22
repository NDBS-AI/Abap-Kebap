/** The three products the Cloudification Repository covers (spec 6.1). */
export type Target = 'cloud-erp' | 'cloud-erp-private' | 'btp-abap-environment'

/** Clean Core Level (spec 2.4). `none` = no level applies: blocked on public cloud and BTP. */
export type CleanCoreLevel = 'A' | 'B' | 'C' | 'D' | 'none'
export type MaxLevel = 'A' | 'B' | 'C' | 'D'

/** Where a classification came from: SAP's own file, or a partner namespace file (spec 6.5). */
export type Origin = 'sap' | `partner:${string}`

/** One row of objectReleaseInfo[] / objectClassifications[] exactly as SAP ships it. */
export interface RawRecord {
  tadirObject: string
  tadirObjName: string
  objectType: string
  objectKey: string
  softwareComponent?: string
  applicationComponent?: string
  state: string
  successorClassification?: string
  successors?: { tadirObject?: string; tadirObjName?: string; objectType: string; objectKey: string }[]
  successorConceptName?: string
  labels?: string[]
}

/** Normalised successor (spec 6.3): one hop, object or concept. */
export type Successor =
  | { kind: 'object'; objectType: string; objectKey: string }
  | { kind: 'concept'; name: string }

/** One concrete object that matched a lookup, with both raw facts and the derived level. */
export interface Match {
  objectType: string
  objectKey: string
  tadirObject: string
  tadirObjName: string
  softwareComponent: string | null
  applicationComponent: string | null
  releaseState: string | null
  classification: string | null
  origin: Origin
  cleanCoreLevel: CleanCoreLevel
  allowed: boolean
  deprecated: boolean
  successors: Successor[]
  successorClassification: string | null
  labels: string[]
}

export const ALL_TARGETS: Target[] = ['cloud-erp', 'cloud-erp-private', 'btp-abap-environment']
