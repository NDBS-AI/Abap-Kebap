import type { FileSpec } from './cache'
import { HEADER_TIMEOUT_MS, type HttpClient } from './http'
import builtIn from './partner-index.json'

export const PARTNER_DIR = 'partner'
/** SAP's empty template (`{"formatVersion":"2"}`); skipped by name, never by shape. */
export const TEMPLATE_FILE = 'objectClassifications_NAMESPACE.json'

const FILE_PREFIX = 'objectClassifications_'

/** A namespace is only a namespace at the start of the name: `/OTX/CL_A`. */
export function namespaceOf(objectName: string): string | null {
  const match = /^\/([A-Za-z0-9_]{1,8})\//.exec(objectName.trim())
  return match?.[1] ? `/${match[1].toUpperCase()}/` : null
}

export function namespaceFromFileName(fileName: string): string | null {
  if (fileName === TEMPLATE_FILE) return null
  if (!fileName.startsWith(FILE_PREFIX) || !fileName.endsWith('.json')) return null
  const middle = fileName.slice(FILE_PREFIX.length, -'.json'.length)
  // `objectClassifications_SAP.json` is SAP's own file, not a partner namespace.
  if (!middle || middle === 'SAP') return null
  return `/${middle.toUpperCase()}/`
}

export function fileNameForNamespace(namespace: string): string {
  return `${FILE_PREFIX}${namespace.replace(/^\/|\/$/g, '')}.json`
}

export interface PartnerEntry {
  namespace: string
  file: string
}

export const BUILT_IN_PARTNER_INDEX: PartnerEntry[] = (builtIn.namespaces as PartnerEntry[]).slice()

export interface PartnerIndexOptions {
  http: HttpClient
  /** GitHub API root, or null when the data comes from an internal mirror. */
  apiBaseUrl: string | null
  repo: string
}

export class PartnerIndex {
  private cached: PartnerEntry[] | null = null
  private origin: 'github-api' | 'built-in' = 'built-in'

  constructor(private readonly options: PartnerIndexOptions) {}

  get usesGithubApi(): boolean {
    return this.options.apiBaseUrl !== null
  }

  /** Which route produced the current list; reported by dataset_info. */
  get source(): 'github-api' | 'built-in' {
    return this.origin
  }

  async list(): Promise<PartnerEntry[]> {
    if (!this.cached) this.cached = await this.discover()
    return this.cached
  }

  private async discover(): Promise<PartnerEntry[]> {
    if (!this.options.apiBaseUrl) return BUILT_IN_PARTNER_INDEX
    const url = `${this.options.apiBaseUrl}/repos/${this.options.repo}/contents/src/partner`
    try {
      const response = await this.options.http.get(url, { accept: 'application/vnd.github+json', timeoutMs: HEADER_TIMEOUT_MS })
      if (response.status !== 200 || !response.body) return BUILT_IN_PARTNER_INDEX
      const listing = JSON.parse(response.body) as unknown
      if (!Array.isArray(listing)) return BUILT_IN_PARTNER_INDEX

      const seen = new Map<string, PartnerEntry>()
      for (const item of listing) {
        const entry = item as { name?: unknown; type?: unknown }
        if (entry.type !== 'file' || typeof entry.name !== 'string') continue
        const namespace = namespaceFromFileName(entry.name)
        if (namespace && !seen.has(namespace)) seen.set(namespace, { namespace, file: entry.name })
      }
      const entries = [...seen.values()].sort((left, right) => left.namespace.localeCompare(right.namespace))
      if (entries.length === 0) return BUILT_IN_PARTNER_INDEX
      this.origin = 'github-api'
      return entries
    } catch {
      // Offline, rate-limited or blocked by a proxy: the committed list still works.
      return BUILT_IN_PARTNER_INDEX
    }
  }

  async entryFor(objectName: string): Promise<PartnerEntry | null> {
    const namespace = namespaceOf(objectName)
    if (!namespace) return null
    return (await this.list()).find((entry) => entry.namespace === namespace) ?? null
  }

  /** Partner files are optional: a 404 or a proxy block must never fail a lookup. */
  specFor(entry: PartnerEntry): FileSpec {
    return {
      id: `partner/${entry.namespace}`,
      fileName: `${PARTNER_DIR}/${entry.file}`,
      arrayKey: 'objectClassifications',
      optional: true,
    }
  }
}
