import { searchObjects, type SearchRequest } from '../query'
import type { SearchObjectsInput } from '../schemas'
import { failureFor, loadTarget, toolFailure, toolSuccess, type LoadedTarget, type ServerContext, type ToolResult } from './context'

export const SEARCH_OBJECTS_DESCRIPTION =
  'Searches SAP\'s released-object data by name fragment, object type, application component, state or label. ' +
  'Use it to find the released API for a task, or the replacement for an object that check_objects reported as blocked or deprecated. ' +
  'Returns the matches with their Clean Core level for the resolved system, plus the full match count for paging.'

export const EMPTY_RESULT_HINT =
  'Nothing matched. Try a shorter fragment or the SAP business term rather than a table name, drop the filters, ' +
  'or search the application component (for example `MM-PUR`) to see what that area publishes.'

export async function handleSearchObjects(context: ServerContext, input: SearchObjectsInput): Promise<ToolResult> {
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

  // A query written in a partner namespace only makes sense if that partner's file is in the pool.
  await loaded.partnerFor(input.query)

  const request: SearchRequest = {
    query: input.query,
    objectType: input.objectType,
    applicationComponent: input.applicationComponent,
    state: input.state,
    maxLevel: input.maxLevel,
    label: input.label,
    limit: input.limit,
    offset: input.offset,
  }
  const outcome = searchObjects(loaded.pools(), request, resolution.target, loaded.classificationOf)

  return toolSuccess({
    target: resolution.target,
    version: resolution.version,
    resolvedFrom: resolution.resolvedFrom,
    confidence: resolution.confidence,
    ...(resolution.assumption ? { assumption: resolution.assumption } : {}),
    query: input.query,
    total: outcome.total,
    returned: outcome.results.length,
    offset: input.offset,
    limit: input.limit,
    dataset: { status: loaded.datasetStatus(), files: loaded.fileSummaries() },
    results: outcome.results,
    ...(outcome.total === 0 ? { hint: EMPTY_RESULT_HINT } : {}),
  })
}
