import { z } from 'zod'
import { VERSION_PATTERN } from './datasets'

export const MAX_BATCH = 100
export const MAX_NAME_LENGTH = 120

export const targetSchema = z
  .enum(['auto', 'cloud-erp', 'cloud-erp-private', 'btp-abap-environment'])
  .default('auto')
  .describe(
    'Which SAP system the code must run on. `cloud-erp` is SAP S/4HANA Cloud Public Edition, ' +
      '`cloud-erp-private` is Private Edition or on-premise, `btp-abap-environment` is the SAP BTP ABAP environment. ' +
      'Leave it at `auto` to resolve it from the connected ADT system; if that is not unambiguous the tool asks rather than guesses.',
  )

export const versionSchema = z
  .string()
  .regex(VERSION_PATTERN, 'Use `latest`, a release year such as `2023`, or a year with a feature pack such as `2021_1`.')
  .optional()
  .describe(
    'Release of SAP S/4HANA Cloud Private Edition to check against, such as `2023`. ' +
      'Only meaningful for `cloud-erp-private`; omit it for the public and BTP targets, which have one current state.',
  )

export const maxLevelSchema = z
  .enum(['A', 'B', 'C', 'D'])
  .optional()
  .describe(
    'Strictest Clean Core level still acceptable, and the levels are cumulative: A is released APIs, ' +
      'B adds classic APIs that are not released, C adds anything unclassified, D adds objects marked as no API. ' +
      'Only applies to `cloud-erp-private`; the public and BTP targets have Level A or nothing.',
  )

const objectRefObject = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  type: z
    .string()
    .min(1)
    .max(8)
    .optional()
    .describe('ABAP object type, when the name alone is ambiguous: `TABL`, `DDLS` for a CDS entity, `CLAS`, `INTF`, `FUNC` for a function module, `FUGR`, `DTEL`.'),
})

export const objectRefSchema = z.union([z.string().min(1).max(MAX_NAME_LENGTH), objectRefObject])

export function normalizeObjectRef(ref: z.infer<typeof objectRefSchema>): { name: string; type?: string } {
  return typeof ref === 'string' ? { name: ref } : ref
}

/** A version or a Clean Core level only means something on the private target. */
const privateOnlyRules = (value: { target?: string; version?: string; maxLevel?: string }, context: z.RefinementCtx) => {
  const isPrivate = value.target === 'cloud-erp-private'
  const isAuto = value.target === 'auto' || value.target === undefined
  if (value.version && !isPrivate && !isAuto) {
    context.addIssue({ code: 'custom', path: ['version'], message: '`version` applies only to `cloud-erp-private`; the public cloud and BTP targets have a single current state.' })
  }
  if (value.maxLevel && !isPrivate && !isAuto) {
    context.addIssue({ code: 'custom', path: ['maxLevel'], message: '`maxLevel` applies only to `cloud-erp-private`; on the public cloud and BTP targets an object is either released or it is not.' })
  }
}

export const checkObjectsShape = {
  objects: z
    .array(objectRefSchema)
    .min(1)
    .max(MAX_BATCH)
    .describe(
      'The ABAP objects to check, as names such as `MARA` or as `{name, type}` when the name is ambiguous. ' +
        `Send every object from one piece of code in a single call, up to ${MAX_BATCH}.`,
    ),
  target: targetSchema,
  version: versionSchema,
  maxLevel: maxLevelSchema,
} as const

export const searchObjectsShape = {
  query: z
    .string()
    .min(1)
    .max(MAX_NAME_LENGTH)
    .describe('Name or fragment to look for. Several words all have to appear, so `purchase order` finds `I_PurchaseOrderItem`.'),
  objectType: z.string().min(1).max(8).optional().describe('Restrict to one ABAP object type, such as `DDLS` for CDS entities or `CLAS` for classes.'),
  applicationComponent: z.string().min(1).max(40).optional().describe('Restrict to an SAP application component path or its start, such as `MM-PUR` for purchasing.'),
  state: z
    .enum(['released', 'deprecated', 'notToBeReleased', 'classicAPI', 'noAPI'])
    .optional()
    .describe('Restrict to one published state, exactly as SAP records it.'),
  maxLevel: maxLevelSchema,
  label: z.string().min(1).max(40).optional().describe('Restrict to objects carrying an SAP label, such as `remote-enabled`.'),
  limit: z.number().int().min(1).max(200).default(20).describe('How many results to return; the response always reports the full match count too.'),
  offset: z.number().int().min(0).default(0).describe('How many results to skip, for paging through a large match set.'),
  target: targetSchema,
  version: versionSchema,
} as const

export const datasetInfoShape = {
  target: targetSchema,
  version: versionSchema,
  refresh: z
    .boolean()
    .default(false)
    .describe('Check SAP for newer data right now instead of waiting for the once-a-day check. Use it when the data looks stale, not routinely.'),
} as const

export const checkObjectsSchema = z.object(checkObjectsShape).superRefine(privateOnlyRules)
export const searchObjectsSchema = z.object(searchObjectsShape).superRefine(privateOnlyRules)
export const datasetInfoSchema = z.object(datasetInfoShape).superRefine(privateOnlyRules)

export type CheckObjectsInput = z.infer<typeof checkObjectsSchema>
export type SearchObjectsInput = z.infer<typeof searchObjectsSchema>
export type DatasetInfoInput = z.infer<typeof datasetInfoSchema>
