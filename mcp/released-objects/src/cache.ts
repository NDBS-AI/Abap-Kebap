import { createHash } from 'node:crypto'

export const SCHEMA_VERSION = 1
/** After a network or HTTP failure, wait an hour before trying again (spec 8). */
export const BACKOFF_MS = 60 * 60 * 1000
/** A file that suddenly loses more than half its rows is treated as truncated. */
export const TRUNCATION_FLOOR = 0.5
/** Below this many previous entries the guard is off - small partner files legitimately shrink. */
export const TRUNCATION_MIN_ENTRIES = 100

export interface ManifestFileEntry {
  url: string
  etag: string | null
  sha256: string
  bytes: number
  entries: number
  downloadedAt: string
  upstreamCommittedAt: string | null
  lastError: string | null
}

export interface PartnerIndexState {
  indexSource: 'github-api' | 'built-in'
  indexedAt: string | null
  files: { fileName: string; namespace: string; sha: string | null }[]
}

export interface Manifest {
  schemaVersion: number
  lastCheckedAt: string | null
  nextCheckAt: string | null
  lastCheckError: string | null
  partnerIndex: PartnerIndexState | null
  files: Record<string, ManifestFileEntry>
}

export function emptyManifest(): Manifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    lastCheckedAt: null,
    nextCheckAt: null,
    lastCheckError: null,
    partnerIndex: null,
    files: {},
  }
}

/** A schemaVersion bump or a corrupt file means: throw the cache away and bootstrap. */
export function parseManifest(text: string): Manifest {
  try {
    const parsed = JSON.parse(text) as Partial<Manifest> | null
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || typeof parsed.files !== 'object' || parsed.files === null) {
      return emptyManifest()
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      lastCheckedAt: parsed.lastCheckedAt ?? null,
      nextCheckAt: parsed.nextCheckAt ?? null,
      lastCheckError: parsed.lastCheckError ?? null,
      partnerIndex: parsed.partnerIndex ?? null,
      files: parsed.files as Record<string, ManifestFileEntry>,
    }
  } catch {
    return emptyManifest()
  }
}

/** YYYY-MM-DD in the machine's local time - "first run of the day" is the user's day. */
export function localDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function shouldCheck(manifest: Manifest, now: Date, force = false): boolean {
  if (force) return true
  if (manifest.nextCheckAt && Date.parse(manifest.nextCheckAt) > now.getTime()) return false
  if (!manifest.lastCheckedAt) return true
  return localDateKey(new Date(manifest.lastCheckedAt)) !== localDateKey(now)
}

export type ValidationResult = { ok: true; entries: number } | { ok: false; reason: string }

/** Guard a download before it is allowed to replace a good file (spec 8). */
export function validatePayload(text: string, arrayKey: string, previousEntries: number | null): ValidationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, reason: `payload is not valid JSON: ${(error as Error).message}` }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: 'payload is not a JSON object' }

  const document = parsed as Record<string, unknown>
  const formatVersion = document.formatVersion
  if (typeof formatVersion !== 'number' && typeof formatVersion !== 'string') {
    return { ok: false, reason: 'formatVersion is missing (SAP files carry a number, partner files the string "2")' }
  }

  const rows = document[arrayKey]
  if (!Array.isArray(rows)) return { ok: false, reason: `"${arrayKey}" is missing or not an array` }
  if (rows.length === 0) return { ok: false, reason: `"${arrayKey}" is empty` }

  if (previousEntries !== null && previousEntries >= TRUNCATION_MIN_ENTRIES && rows.length < previousEntries * TRUNCATION_FLOOR) {
    return { ok: false, reason: `truncation guard: ${rows.length} entries is below half of the previous ${previousEntries}` }
  }
  return { ok: true, entries: rows.length }
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
