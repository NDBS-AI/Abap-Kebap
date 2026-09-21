import type { RawRecord, Target } from './types'
import { CacheError, type CacheManager, type FileSpec } from './cache'

export const RELEASE_INFO_FILES: Record<Target, string> = {
  'cloud-erp': 'objectReleaseInfoLatest.json',
  'cloud-erp-private': 'objectReleaseInfo_PCELatest.json',
  'btp-abap-environment': 'objectReleaseInfo_BTPLatest.json',
}

export const SAP_CLASSIFICATION_FILE = 'objectClassifications_SAP.json'

/** Manifest key for a target's `*Latest` file; shared by the bootstrap set and `resolveFiles`. */
const latestId = (target: Target): string => `${target}/latest`
/** Manifest key for SAP's classification file. */
const CLASSIFICATION_ID = 'classification/sap'

/**
 * The `objectReleaseInfo_PCE*` files observed upstream. Only a fallback: `dataset_info`
 * refreshes the list best-effort from the contents API when it is called, because SAP adds
 * a file per private-edition release.
 */
export const BUILT_IN_PCE_VERSIONS: string[] = [
  'latest',
  '2022',
  '2022_1',
  '2022_2',
  '2023_0',
  '2023_1',
  '2023_2',
  '2023_3',
  '2025_0',
  '2025_1',
]

/** `latest`, `YYYY` or `YYYY_N`. Validated before it can reach a URL or a file name. */
export const VERSION_PATTERN = /^(latest|\d{4}(_\d+)?)$/

/**
 * Upstream is not consistent: 2022 ships as `_PCE2022.json` while 2023 and 2025 ship only
 * as `_PCE2023_0.json`. A bare `YYYY` therefore yields both spellings, tried in order.
 */
export function versionFileNames(version: string): string[] {
  if (version === 'latest') return ['objectReleaseInfo_PCELatest.json']
  if (/^\d{4}_\d+$/.test(version)) return [`objectReleaseInfo_PCE${version}.json`]
  return [`objectReleaseInfo_PCE${version}.json`, `objectReleaseInfo_PCE${version}_0.json`]
}

export interface ResolvedFiles {
  /** Tried in order; the first that downloads wins. More than one only for a bare `YYYY`. */
  releaseInfoCandidates: FileSpec[]
  classification: FileSpec | null
}

export function resolveFiles(target: Target, version?: string): ResolvedFiles {
  if (version && version !== 'latest' && target !== 'cloud-erp-private') {
    throw new CacheError('UNKNOWN_VERSION', `version is only meaningful for cloud-erp-private, not ${target}`)
  }

  if (target !== 'cloud-erp-private') {
    return {
      releaseInfoCandidates: [
        { id: latestId(target), fileName: RELEASE_INFO_FILES[target], arrayKey: 'objectReleaseInfo', optional: false },
      ],
      classification: null,
    }
  }

  const effective = version ?? 'latest'
  // The only gate between a caller-supplied string and a file name: nothing else may build a path.
  if (!VERSION_PATTERN.test(effective)) {
    throw new CacheError('UNKNOWN_VERSION', `"${effective}" is not a valid version (expected latest, YYYY or YYYY_N)`)
  }
  return {
    releaseInfoCandidates: versionFileNames(effective).map((fileName) => ({
      // `latest` keeps the bootstrap's id so the downloaded file is not tracked twice.
      id: effective === 'latest' ? latestId(target) : `${target}/${effective}:${fileName}`,
      fileName,
      arrayKey: 'objectReleaseInfo' as const,
      optional: false,
    })),
    classification: { id: CLASSIFICATION_ID, fileName: SAP_CLASSIFICATION_FILE, arrayKey: 'objectClassifications', optional: false },
  }
}

/** The four files the bootstrap downloads; everything else is lazy. */
export function coreFileSpecs(): FileSpec[] {
  return [
    ...(['cloud-erp', 'cloud-erp-private', 'btp-abap-environment'] as Target[]).map((target) => ({
      id: latestId(target),
      fileName: RELEASE_INFO_FILES[target],
      arrayKey: 'objectReleaseInfo' as const,
      optional: false,
    })),
    { id: CLASSIFICATION_ID, fileName: SAP_CLASSIFICATION_FILE, arrayKey: 'objectClassifications', optional: false },
  ]
}

/**
 * The cache already validated the payload before it reached the disk, so a file that fails
 * to parse here is one the user edited: answer with no records rather than crashing a tool.
 */
export function parseRecords(text: string, arrayKey: 'objectReleaseInfo' | 'objectClassifications'): RawRecord[] {
  try {
    const document = JSON.parse(text) as Record<string, unknown> | null
    const rows = document?.[arrayKey]
    return Array.isArray(rows) ? (rows as RawRecord[]) : []
  } catch {
    return []
  }
}

export interface Dataset {
  records: RawRecord[]
  /** Upper-cased objectKey to records. */
  byKey: Map<string, RawRecord[]>
  /** Upper-cased tadirObjName to records (a function module's function group, for instance). */
  byTadirName: Map<string, RawRecord[]>
}

function push(index: Map<string, RawRecord[]>, key: string | undefined, record: RawRecord): void {
  if (!key) return
  const upper = key.toUpperCase()
  const bucket = index.get(upper)
  if (bucket) bucket.push(record)
  else index.set(upper, [record])
}

export function buildDataset(records: RawRecord[]): Dataset {
  const byKey = new Map<string, RawRecord[]>()
  const byTadirName = new Map<string, RawRecord[]>()
  for (const record of records) {
    push(byKey, record.objectKey, record)
    push(byTadirName, record.tadirObjName, record)
  }
  return { records, byKey, byTadirName }
}

/** A candidate that is simply absent upstream; the next spelling of the version may still exist. */
function isMissingCandidate(error: unknown): boolean {
  // A 404 surfaces as UNKNOWN_VERSION; a file that could not be produced at all as
  // DATASET_UNAVAILABLE. Both mean "not this one" - DATASET_DOWNLOADING does not.
  return error instanceof CacheError && (error.code === 'UNKNOWN_VERSION' || error.code === 'DATASET_UNAVAILABLE')
}

/** Parses each file at most once per process, and forgets it when the cache swaps the file. */
export class DatasetRegistry {
  private readonly loaded = new Map<string, Dataset>()

  constructor(private readonly cache: CacheManager) {
    cache.subscribe((id) => this.invalidate(id))
  }

  invalidate(id: string): void {
    this.loaded.delete(id)
  }

  async load(spec: FileSpec, timeoutMs = 30_000): Promise<Dataset> {
    const cached = this.loaded.get(spec.id)
    if (cached) return cached
    await this.cache.ensureFile(spec, timeoutMs)
    const dataset = buildDataset(parseRecords(await this.cache.readFileText(spec), spec.arrayKey))
    this.loaded.set(spec.id, dataset)
    return dataset
  }

  /** Try each candidate in order; all missing means the version does not exist upstream. */
  async loadFirstAvailable(candidates: FileSpec[], timeoutMs = 30_000): Promise<{ dataset: Dataset; spec: FileSpec }> {
    let lastError: CacheError | null = null
    for (const spec of candidates) {
      try {
        return { dataset: await this.load(spec, timeoutMs), spec }
      } catch (error) {
        // A download still running, or anything that is not a cache failure, is the caller's answer.
        if (!isMissingCandidate(error)) throw error
        lastError = error as CacheError
      }
    }
    if (lastError) throw lastError
    throw new CacheError('UNKNOWN_VERSION', `none of ${candidates.map((spec) => spec.fileName).join(', ')} exists upstream`)
  }
}
