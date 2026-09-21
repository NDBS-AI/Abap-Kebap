import { CacheError, type CacheManager, type FileSpec } from '../cache'
import type { ServerConfig } from '../config'
import { buildDataset, resolveFiles, type Dataset, type DatasetRegistry } from '../datasets'
import { namespaceOf, type PartnerIndex } from '../partner-index'
import type { ClassificationLookup, SearchPool } from '../query'
import { resolveTarget, TargetResolutionError, type TargetResolution } from '../target-resolver'
import type { RawRecord, Target } from '../types'

export interface ServerContext {
  cache: CacheManager
  registry: DatasetRegistry
  partnerIndex: PartnerIndex
  config: ServerConfig
}

export const TOOL_ERROR_CODES = [
  'TARGET_AMBIGUOUS', 'TARGET_UNRESOLVED', 'DATASET_UNAVAILABLE',
  'DATASET_DOWNLOADING', 'INVALID_ARGUMENT', 'INTERNAL_ERROR',
] as const
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number]

export interface ToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

export function toolSuccess(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

export function toolFailure(code: ToolErrorCode, message: string, extra: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: { code, message, ...extra } }, null, 2) }], isError: true }
}

const OFFLINE_HINT =
  'SAP data is not cached and this machine cannot reach the source. Check the proxy settings (HTTPS_PROXY, NO_PROXY, ' +
  'NODE_EXTRA_CA_CERTS) or set ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL to an internal mirror, then call dataset_info with refresh.'

export function failureFor(error: unknown): ToolResult {
  if (error instanceof TargetResolutionError) {
    return toolFailure(error.code, error.message, { candidates: error.candidates })
  }
  if (error instanceof CacheError) {
    if (error.code === 'DATASET_UNAVAILABLE') return toolFailure('DATASET_UNAVAILABLE', error.message, { hint: OFFLINE_HINT })
    if (error.code === 'DATASET_DOWNLOADING') return toolFailure('DATASET_DOWNLOADING', error.message, { retryAfterSeconds: error.retryAfterSeconds ?? 30 })
    return toolFailure('INVALID_ARGUMENT', error.message)
  }
  return toolFailure('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
}

/** One cached file as reported to the caller; drawn from the manifest, never guessed. */
export interface FileSummary {
  id: string
  fileName: string
  status: string
  entries: number | null
  bytes: number | null
  downloadedAt: string | null
  upstreamCommittedAt: string | null
  error: string | null
}

export interface LoadedTarget {
  resolution: TargetResolution
  releaseInfo: Dataset
  classification: Dataset | null
  classificationOf: ClassificationLookup
  specs: FileSpec[]
  fileSummaries(): FileSummary[]
  datasetStatus(): 'fresh' | 'stale'
  pools(): SearchPool[]
  partnerFor(objectName: string): Promise<{ dataset: Dataset; namespace: string } | null>
}

export async function loadTarget(context: ServerContext, request: { target?: Target | 'auto'; version?: string }): Promise<LoadedTarget> {
  const resolution = await resolveTarget({ requested: request.target, version: request.version, config: context.config })
  const resolved = resolveFiles(resolution.target, resolution.version)

  const { dataset: releaseInfo, spec: releaseSpec } = await context.registry.loadFirstAvailable(resolved.releaseInfoCandidates)
  const classification = resolved.classification ? await context.registry.load(resolved.classification) : null

  const specs: FileSpec[] = resolved.classification ? [releaseSpec, resolved.classification] : [releaseSpec]
  // Open the daily gate for exactly the files this request touches; never block on it.
  context.cache.ensureFresh(specs)

  const classificationOf: ClassificationLookup = (record: RawRecord) => {
    if (!classification) return null
    const bucket = classification.byKey.get(record.objectKey.toUpperCase())
    return bucket?.find((entry) => entry.objectType === record.objectType)?.state ?? null
  }

  /**
   * Most classified objects are also in the release-info file, and `lookupObject` already merges
   * the two onto one match. Search and suggestions do not merge, so the whole classification file
   * as a second pool would list those objects twice. Only what release info does not carry is
   * searchable out of the classification pool; `classificationOf` still supplies the state for the
   * rest. Built at most once per request, and only if a pool is actually asked for.
   */
  let searchClassification: Dataset | null | undefined
  function classificationPool(): Dataset | null {
    if (searchClassification === undefined) {
      const extra = classification?.records.filter((record) => !releaseInfo.byKey.has(record.objectKey.toUpperCase())) ?? []
      searchClassification = extra.length > 0 ? buildDataset(extra) : null
    }
    return searchClassification
  }

  const partnerCache = new Map<string, Dataset | null>()

  return {
    resolution,
    releaseInfo,
    classification,
    classificationOf,
    specs,
    fileSummaries() {
      const manifest = context.cache.readManifest()
      return specs.map((spec) => {
        const entry = manifest.files[spec.id] ?? null
        return {
          id: spec.id,
          fileName: spec.fileName,
          status: context.cache.status(spec.id),
          entries: entry?.entries ?? null,
          bytes: entry?.bytes ?? null,
          downloadedAt: entry?.downloadedAt ?? null,
          upstreamCommittedAt: entry?.upstreamCommittedAt ?? null,
          error: entry?.lastError ?? null,
        }
      })
    },
    datasetStatus() {
      const manifest = context.cache.readManifest()
      const clean = specs.every((spec) => !(manifest.files[spec.id]?.lastError))
      return clean && !manifest.lastCheckError ? 'fresh' : 'stale'
    },
    pools() {
      const pools: SearchPool[] = [{ dataset: releaseInfo, origin: 'sap' }]
      const unreleased = classificationPool()
      if (unreleased) pools.push({ dataset: unreleased, origin: 'sap' })
      for (const [namespace, dataset] of partnerCache) {
        if (dataset) pools.push({ dataset, origin: `partner:${namespace}` })
      }
      return pools
    },
    async partnerFor(objectName: string) {
      const namespace = namespaceOf(objectName)
      if (!namespace) return null
      if (!partnerCache.has(namespace)) {
        const entry = await context.partnerIndex.entryFor(objectName)
        let dataset: Dataset | null = null
        if (entry) {
          try {
            dataset = await context.registry.load(context.partnerIndex.specFor(entry))
          } catch {
            // Optional by design: a missing partner file never fails the lookup.
            dataset = null
          }
        }
        partnerCache.set(namespace, dataset)
      }
      const dataset = partnerCache.get(namespace) ?? null
      return dataset ? { dataset, namespace } : null
    },
  }
}
