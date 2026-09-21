import { CacheError, type FileSpec } from '../cache'
import { DEFAULT_BASE_URL, SERVER_VERSION, SOURCE_REPO } from '../config'
import { coreFileSpecs, resolveFiles, type ResolvedFiles } from '../datasets'
import { cachedPartnerSpecs } from '../partner-index'
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

const SERVING_CACHED_HINT =
  'SAP could not be reached, so answers are served from the cached copy listed below. Check HTTPS_PROXY, NO_PROXY and ' +
  'NODE_EXTRA_CA_CERTS, then call this tool again with refresh.'

/** Deduplicates by spec id, keeping the first occurrence, so the file list reads in a stable order. */
function uniqueSpecs(specs: FileSpec[]): FileSpec[] {
  const seen = new Map<string, FileSpec>()
  for (const spec of specs) if (!seen.has(spec.id)) seen.set(spec.id, spec)
  return [...seen.values()]
}

/**
 * The spellings of a bare `YYYY` are alternatives, not a set: only one of them exists upstream,
 * so checking both would record the other's 404 as this call's `lastCheckError` and arm the
 * one-hour backoff over a file that was never supposed to be there. Pick the winner the way
 * `loadTarget` does — a candidate already on disk, else the first that downloads. Only when none
 * can be had is the whole list checked, so the offline or unknown-version state is still recorded.
 */
async function releaseInfoToCheck(context: ServerContext, candidates: FileSpec[]): Promise<FileSpec[]> {
  const onDisk = candidates.find((spec) => context.cache.status(spec.id) === 'ready')
  if (onDisk) return [onDisk]
  try {
    const { spec } = await context.registry.loadFirstAvailable(candidates)
    return [spec]
  } catch (error) {
    if (error instanceof CacheError) return candidates
    throw error
  }
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
  let checked: FileSpec[]
  let listed: FileSpec[]
  try {
    const targeted: ResolvedFiles | null = resolution ? resolveFiles(resolution.target, resolution.version) : null
    const classification = targeted?.classification ? [targeted.classification] : []
    // Partner files are downloaded by a lookup and never checked again on their own; this is the
    // one tool that can re-check them, so every cached one joins the check and the list. They are
    // optional, so a partner file that fails cannot become this call's `lastCheckError`.
    const partner = cachedPartnerSpecs(context.cache, context.partnerIndex)
    // What the check covers: the files this request is about, or — with no target to be about —
    // every core file. Checking the other targets' files too would report their failures as this
    // request's `lastCheckError` and hide the one the caller ran the tool to see.
    checked = targeted
      ? uniqueSpecs([...(await releaseInfoToCheck(context, targeted.releaseInfoCandidates)), ...classification, ...partner])
      : uniqueSpecs([...coreFileSpecs(), ...partner])
    // What the answer lists: every candidate, checked or not, plus every core file, so the caller
    // sees the whole cache and not only the slice this call touched.
    listed = uniqueSpecs([...(targeted?.releaseInfoCandidates ?? []), ...classification, ...checked, ...coreFileSpecs(), ...partner])
  } catch (error) {
    return failureFor(error)
  }

  // `refresh` forces the check; without it this still opens the once-a-day gate, and both are awaited
  // so the numbers reported below describe the state after the check rather than before it.
  try {
    await context.cache.refresh(checked, input.refresh)
  } catch (error) {
    return failureFor(error)
  }

  const manifest = context.cache.readManifest()
  const files: FileSummary[] = listed.map((spec) => summarizeFile(context.cache, spec))
  // Resolved before the answer is built so `partnerIndexSource` below reports the route the list
  // actually came from rather than the built-in default nobody has asked to replace yet. The
  // namespaces are the ones this server knows of; the cached files are the ones it has.
  const partnerNamespaces = (await context.partnerIndex.list()).length
  const cachedPartnerFiles = cachedPartnerSpecs(context.cache, context.partnerIndex).length

  // Offline with a cached copy is a different situation from offline with nothing: the first
  // still answers questions, and telling the user to fix their proxy before anything works would
  // be wrong. Online needs no hint at all.
  const offline = context.cache.offline
  const serving = files.some((file) => file.status === 'ready')
  const hint = offline ? (serving ? SERVING_CACHED_HINT : OFFLINE_HINT) : null

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
    // Only present when the target was assumed rather than told; it is the sentence the agent quotes.
    ...(resolution?.assumption ? { assumption: resolution.assumption } : {}),
    ...(targetProblem ? { targetProblem } : {}),
    dataDir: context.config.dataDir,
    offline,
    lastCheckedAt: manifest.lastCheckedAt,
    nextCheckAt: manifest.nextCheckAt,
    lastCheckError: manifest.lastCheckError,
    partnerIndex: {
      indexSource: context.partnerIndex.source,
      namespaces: partnerNamespaces,
      cachedFiles: cachedPartnerFiles,
    },
    files,
    warnings: context.config.warnings,
    ...(hint ? { hint } : {}),
  })
}
