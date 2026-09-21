import { namespaceOf } from '../partner-index'
import { impliedLevelFor, lookupObject, suggestNearMatches, vendorHint, type ObjectResult } from '../query'
import { normalizeObjectRef, type CheckObjectsInput } from '../schemas'
import { failureFor, loadTarget, toolFailure, toolSuccess, type LoadedTarget, type ServerContext, type ToolResult } from './context'
import type { MaxLevel } from '../types'

export const CHECK_OBJECTS_DESCRIPTION =
  'Checks whether SAP standard objects may be used on a given SAP system, using SAP\'s own released-object data. ' +
  'Call it before writing or reviewing ABAP that touches SAP tables, CDS entities, classes or function modules. ' +
  'Returns a verdict per object, the Clean Core level on private systems, and the successor for deprecated objects. ' +
  'Custom Z or Y objects are never listed and come back as not-found, which is not a verdict about them.'

export async function handleCheckObjects(context: ServerContext, input: CheckObjectsInput): Promise<ToolResult> {
  let loaded: LoadedTarget
  try {
    loaded = await loadTarget(context, { target: input.target, version: input.version })
  } catch (error) {
    return failureFor(error)
  }

  const { resolution } = loaded
  if (input.maxLevel && resolution.target !== 'cloud-erp-private') {
    return toolFailure(
      'INVALID_ARGUMENT',
      `\`maxLevel\` applies only to cloud-erp-private, and this request resolved to ${resolution.target}, where an object is either released or it is not.`,
    )
  }
  const maxLevel: MaxLevel = input.maxLevel ?? (resolution.target === 'cloud-erp-private' ? 'C' : 'A')

  const results: ObjectResult[] = []
  for (const ref of input.objects) {
    const request = normalizeObjectRef(ref)
    const partner = await loaded.partnerFor(request.name)
    const result = lookupObject(
      {
        target: resolution.target,
        releaseInfo: loaded.releaseInfo,
        classification: loaded.classification,
        partner: partner?.dataset ?? null,
        partnerNamespace: partner?.namespace ?? null,
      },
      request,
      maxLevel,
    )
    if (!result.found) {
      result.suggestions = suggestNearMatches(loaded.pools(), request.name, resolution.target, loaded.classificationOf)
      const namespace = namespaceOf(request.name)
      if (namespace && !partner) result.hint = [result.hint, vendorHint(namespace)].filter(Boolean).join(' ')
    }
    results.push(result)
  }

  return toolSuccess({
    target: resolution.target,
    version: resolution.version,
    resolvedFrom: resolution.resolvedFrom,
    confidence: resolution.confidence,
    ...(resolution.assumption ? { assumption: resolution.assumption } : {}),
    maxLevel,
    impliedLevelWhenAbsent: impliedLevelFor(resolution.target),
    dataset: { status: loaded.datasetStatus(), files: loaded.fileSummaries() },
    summary: {
      total: results.length,
      allowed: results.filter((result) => result.verdict === 'allowed' || result.verdict === 'allowed-deprecated').length,
      blocked: results.filter((result) => result.verdict === 'blocked').length,
      deprecated: results.filter((result) => result.verdict === 'allowed-deprecated').length,
      notFound: results.filter((result) => result.verdict === 'not-found').length,
      ambiguous: results.filter((result) => result.verdict === 'ambiguous').length,
    },
    results,
  })
}
