import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerConfig } from './config'
import type { Target } from './types'

/** How much the resolution can be trusted; echoed to the caller on every answer. */
export type Confidence = 'high' | 'medium' | 'low'

export interface DestinationSummary {
  id: string
  protocol: string
  host: string
  systemId: string
}

/**
 * Reads the ADT destinations file. Only `id`, `protocol`, the host of
 * `properties.systemUrl` (or, for an RFC destination, of `properties.applicationServer`) and
 * `properties.systemId` are extracted. Credential fields are never bound to a named value,
 * never returned and never logged.
 */
export async function readDestinations(path: string): Promise<DestinationSummary[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return []
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { destinations?: unknown })?.destinations
  if (!Array.isArray(list)) return []

  const summaries: DestinationSummary[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const properties = (record.properties ?? {}) as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : null
    if (!id) continue
    summaries.push({
      id,
      protocol: typeof record.protocol === 'string' ? record.protocol.toLowerCase() : 'http',
      host: hostOf(typeof properties.systemUrl === 'string' ? properties.systemUrl : '')
        || hostOf(typeof properties.applicationServer === 'string' ? properties.applicationServer : ''),
      systemId: typeof properties.systemId === 'string' ? properties.systemId : '',
    })
  }
  return summaries
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * Drops any `user:password@` prefix from the authority. Applied to every spelling before a
 * host is read, so a `user@host` systemUrl can never carry a name into a candidate list.
 * Only the authority is touched: an `@` later in the path is left where it is.
 */
function stripUserInfo(systemUrl: string): string {
  const scheme = SCHEME.exec(systemUrl)?.[0] ?? ''
  const rest = systemUrl.slice(scheme.length)
  const boundary = rest.search(/[/?#]/)
  const authority = boundary === -1 ? rest : rest.slice(0, boundary)
  const tail = boundary === -1 ? '' : rest.slice(boundary)
  const lastAt = authority.lastIndexOf('@')
  return `${scheme}${lastAt === -1 ? authority : authority.slice(lastAt + 1)}${tail}`
}

/** The host of an ADT `systemUrl`, with user info removed whichever spelling it arrives in. */
export function hostOf(systemUrl: string): string {
  if (!systemUrl) return ''
  const withoutUserInfo = stripUserInfo(systemUrl)
  // A schemeless `host:port/path` parses as a URL whose scheme is the host — dots are legal
  // scheme characters — and its `hostname` is empty, so only a real `://` spelling is parsed.
  if (systemUrl.includes('://')) {
    try {
      return new URL(withoutUserInfo).hostname
    } catch {
      // Not a URL after all; read it textually below.
    }
  }
  // RFC destinations carry a message-server string rather than a URL.
  return withoutUserInfo.replace(SCHEME, '').split(/[/:]/)[0] ?? ''
}

/** Anything shown to a model or a user keeps at most the last three labels. */
export function redactHost(host: string): string {
  if (!host) return 'unknown-host'
  const labels = host.split('.')
  return labels.length <= 3 ? host : labels.slice(-3).join('.')
}

const PUBLIC_CLOUD = [/\.s4hana\.cloud\.sap$/i, /\.s4hana\.ondemand\.com$/i]
const BTP_ABAP = [/\.abap\.[a-z0-9-]+\.hana\.ondemand\.com$/i, /\.abap-web\.[a-z0-9-]+\.hana\.ondemand\.com$/i]

export function classifyDestination(summary: DestinationSummary): { target: Target; confidence: Confidence } {
  if (summary.protocol === 'rfc') return { target: 'cloud-erp-private', confidence: 'high' }
  if (BTP_ABAP.some((pattern) => pattern.test(summary.host))) return { target: 'btp-abap-environment', confidence: 'high' }
  if (PUBLIC_CLOUD.some((pattern) => pattern.test(summary.host))) return { target: 'cloud-erp', confidence: 'high' }
  // An unrecognised host over HTTP is most often a customer-hosted system.
  return { target: 'cloud-erp-private', confidence: 'low' }
}

/** The most recently touched `session-<id>-<hash>` folder names the last system used. */
export async function lastLoggedOnDestination(stateDir: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await readdir(stateDir)
  } catch {
    return null
  }
  let newest: { id: string; at: number } | null = null
  for (const entry of entries) {
    const match = /^session-(.+)-[^-]+$/.exec(entry)
    if (!match?.[1]) continue
    let modifiedAt = 0
    try {
      modifiedAt = (await stat(join(stateDir, entry))).mtimeMs
    } catch {
      continue
    }
    if (!newest || modifiedAt > newest.at) newest = { id: match[1], at: modifiedAt }
  }
  return newest?.id ?? null
}

export interface ResolveInput {
  requested?: Target | 'auto'
  version?: string
  config: ServerConfig
}

export interface TargetResolution {
  target: Target
  version: string
  resolvedFrom: 'request' | 'environment' | 'adt-session' | 'single-destination'
  confidence: Confidence
  assumption?: string
}

export interface TargetCandidate {
  id: string
  systemId: string
  host: string
  target: Target
}

export class TargetResolutionError extends Error {
  constructor(
    readonly code: 'TARGET_AMBIGUOUS' | 'TARGET_UNRESOLVED',
    message: string,
    readonly candidates: TargetCandidate[],
  ) {
    super(message)
    this.name = 'TargetResolutionError'
  }
}

export async function resolveTarget(input: ResolveInput): Promise<TargetResolution> {
  const { config } = input
  /**
   * Only the private edition ships per-release files, so the pin is a fact about that target
   * alone: applied to a public or BTP system it would turn every call into an argument error
   * the caller never asked for. An explicit `version` is passed through whatever the target is,
   * so the datasets gate can still refuse it in the caller's own words.
   */
  // `||`, not `??`: an empty version string is "not given", and must not beat the pin.
  const versionFor = (target: Target): string =>
    input.version || (target === 'cloud-erp-private' ? config.versionPin || 'latest' : 'latest')

  if (input.requested && input.requested !== 'auto') {
    return { target: input.requested, version: versionFor(input.requested), resolvedFrom: 'request', confidence: 'high' }
  }

  if (config.targetPin) {
    return { target: config.targetPin, version: versionFor(config.targetPin), resolvedFrom: 'environment', confidence: 'high' }
  }

  const destinations = await readDestinations(config.adtDestinationsPath)
  const candidates: TargetCandidate[] = destinations.map((summary) => ({
    id: summary.id,
    systemId: summary.systemId,
    host: redactHost(summary.host),
    target: classifyDestination(summary).target,
  }))

  const only = destinations.length === 1 ? destinations[0] : undefined
  if (only) {
    const classified = classifyDestination(only)
    return {
      target: classified.target,
      version: versionFor(classified.target),
      resolvedFrom: 'single-destination',
      confidence: classified.confidence,
      assumption: `Assumed the only configured ADT destination, ${only.id} (${only.systemId || 'no system id'}), which looks like ${classified.target}.`,
    }
  }

  if (destinations.length > 1) {
    const lastId = await lastLoggedOnDestination(config.adtStateDir)
    const hinted = lastId ? destinations.find((summary) => summary.id === lastId) : undefined
    if (hinted) {
      const classified = classifyDestination(hinted)
      return {
        target: classified.target,
        version: versionFor(classified.target),
        // A stale session folder is a hint, never a fact: cap the confidence.
        confidence: classified.confidence === 'low' ? 'low' : 'medium',
        resolvedFrom: 'adt-session',
        assumption: `Assumed the last ADT system logged on to, ${hinted.id} (${hinted.systemId || 'no system id'}), which looks like ${classified.target}.`,
      }
    }
    throw new TargetResolutionError(
      'TARGET_AMBIGUOUS',
      'Several ADT destinations are configured and none is clearly current. Ask which system this code targets, then pass `target` explicitly.',
      candidates,
    )
  }

  throw new TargetResolutionError(
    'TARGET_UNRESOLVED',
    'No target could be determined. Ask whether this code targets SAP Cloud ERP, SAP Cloud ERP Private, or the SAP BTP ABAP environment, then pass `target` explicitly.',
    [],
  )
}
