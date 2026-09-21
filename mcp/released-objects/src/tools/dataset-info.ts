import type { FileSpec } from '../cache'
import { DEFAULT_BASE_URL, SERVER_VERSION, SOURCE_REPO } from '../config'
import { coreFileSpecs, resolveFiles, type ResolvedFiles } from '../datasets'
import type { DatasetInfoInput } from '../schemas'
import { resolveTarget, TargetResolutionError, type TargetResolution } from '../target-resolver'
import { failureFor, summarizeFile, toolSuccess, type FileSummary, type ServerContext, type ToolResult } from './context'

export const DATASET_INFO_DESCRIPTION =
  'Reports where the released-object data came from, which SAP files are cached, how big they are, when they were downloaded ' +
  'and when SAP last changed them. Call it when an answer looks stale or wrong, or when check_objects reports the data as unavailable. ' +
  'Set refresh to true to check SAP for newer data immediately instead of waiting for the once-a-day check.'

const OFFLINE_HINT =
  'No SAP data is cached and the source could not be reached. Check HTTPS_PROXY, NO_PROXY and NODE_EXTRA_CA_CERTS, ' +
  'or point ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL at an internal mirror of the SAP repository, then call this tool again with refresh.'

/** Deduplicates by spec id, keeping the first occurrence, so the file list reads in a stable order. */
function uniqueSpecs(specs: FileSpec[]): FileSpec[] {
  const seen = new Map<string, FileSpec>()
  for (const spec of specs) if (!seen.has(spec.id)) seen.set(spec.id, spec)
  return [...seen.values()]
}

export async function handleDatasetInfo(context: ServerContext, input: DatasetInfoInput): Promise<ToolResult> {
  let resolution: TargetResolution | null = null
  let targetProblem: { code: string; message: string; candidates?: unknown } | null = null
  try {
    resolution = await resolveTarget({ requested: input.target, version: input.version, config: context.config })
  } catch (error) {
    if (!(error instanceof TargetResolutionError)) return failureFor(error)
    targetProblem = { code: error.code, message: error.message, candidates: error.candidates }
  }

  // `version` with `target: auto` passes the schema, so only resolution can find out that the
  // resolved system has no versions at all; that is an argument error, not a broken cache.
  let targeted: ResolvedFiles | null = null
  try {
    targeted = resolution ? resolveFiles(resolution.target, resolution.version) : null
  } catch (error) {
    return failureFor(error)
  }

  // What the check covers: the files this request is about, or — with no target to be about —
  // every core file. Checking the other targets' files too would report their failures as this
  // request's `lastCheckError` and hide the one the caller ran the tool to see.
  const checked = uniqueSpecs(
    targeted
      ? [...targeted.releaseInfoCandidates, ...(targeted.classification ? [targeted.classification] : [])]
      : coreFileSpecs(),
  )
  // What the answer lists: the checked files plus every core file, so the caller sees the whole
  // cache and not only the slice this call touched.
  const listed = uniqueSpecs([...checked, ...coreFileSpecs()])

  // `refresh` forces the check; without it this still opens the once-a-day gate, and both are awaited
  // so the numbers reported below describe the state after the check rather than before it.
  try {
    await context.cache.refresh(checked, input.refresh)
  } catch (error) {
    return failureFor(error)
  }

  const manifest = context.cache.readManifest()
  const files: FileSummary[] = listed.map((spec) => summarizeFile(context.cache, spec))

  const offline = context.cache.offline
  return toolSuccess({
    server: { name: 'released-objects', version: SERVER_VERSION },
    source: {
      repo: SOURCE_REPO,
      baseUrl: context.config.baseUrl,
      isDefaultSource: context.config.baseUrl === DEFAULT_BASE_URL,
      usesGithubApi: context.partnerIndex.usesGithubApi,
      partnerIndexSource: context.partnerIndex.source,
    },
    target: resolution?.target ?? null,
    version: resolution?.version ?? null,
    resolvedFrom: resolution?.resolvedFrom ?? null,
    confidence: resolution?.confidence ?? null,
    ...(targetProblem ? { targetProblem } : {}),
    dataDir: context.config.dataDir,
    offline,
    lastCheckedAt: manifest.lastCheckedAt,
    nextCheckAt: manifest.nextCheckAt,
    lastCheckError: manifest.lastCheckError,
    partnerIndex: manifest.partnerIndex
      ? { indexSource: manifest.partnerIndex.indexSource, indexedAt: manifest.partnerIndex.indexedAt, fileCount: manifest.partnerIndex.files.length }
      : null,
    files,
    warnings: context.config.warnings,
    ...(offline ? { hint: OFFLINE_HINT } : {}),
  })
}
