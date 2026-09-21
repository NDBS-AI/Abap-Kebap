import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DOWNLOAD_TIMEOUT_MS, HEADER_TIMEOUT_MS, type HttpClient } from './http'

export const SCHEMA_VERSION = 1
/** After a network or HTTP failure, wait an hour before trying again (spec 8). */
export const BACKOFF_MS = 60 * 60 * 1000
/** A file that suddenly loses more than half its rows is treated as truncated. */
export const TRUNCATION_FLOOR = 0.5
/** Below this many previous entries the guard is off - small partner files legitimately shrink. */
export const TRUNCATION_MIN_ENTRIES = 100

/**
 * A downloaded file as the manager writes it - every field is filled in. The nullable types
 * describe what may come back from a manifest on disk, which the user can edit or corrupt.
 */
export interface ManifestFileEntry {
  url: string | null
  etag: string | null
  sha256: string | null
  bytes: number | null
  entries: number | null
  downloadedAt: string | null
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/**
 * The manifest sits in a user-writable directory, so no field may be trusted. A `null`
 * `entries` that survived would silently disarm the truncation guard on the next download.
 */
function parseFiles(raw: Record<string, unknown>): Record<string, ManifestFileEntry> {
  const files: Record<string, ManifestFileEntry> = {}
  for (const [id, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry)) continue
    files[id] = {
      url: asText(entry.url),
      etag: asText(entry.etag),
      sha256: asText(entry.sha256),
      bytes: asNumber(entry.bytes),
      entries: asNumber(entry.entries),
      downloadedAt: asText(entry.downloadedAt),
      upstreamCommittedAt: asText(entry.upstreamCommittedAt),
      lastError: asText(entry.lastError),
    }
  }
  return files
}

/** A schemaVersion bump or a corrupt file means: throw the cache away and bootstrap. */
export function parseManifest(text: string): Manifest {
  try {
    const parsed = JSON.parse(text) as Partial<Manifest> | null
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !isPlainObject(parsed.files)) {
      return emptyManifest()
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      lastCheckedAt: parsed.lastCheckedAt ?? null,
      nextCheckAt: parsed.nextCheckAt ?? null,
      lastCheckError: parsed.lastCheckError ?? null,
      partnerIndex: parsed.partnerIndex ?? null,
      files: parseFiles(parsed.files),
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

export interface FileSpec {
  /** Stable manifest key, e.g. `cloud-erp/latest`, `classification/sap`, `partner//OTX/`. */
  id: string
  /** Path under the source `src/` directory, e.g. `partner/objectClassifications_OTX.json`. */
  fileName: string
  arrayKey: 'objectReleaseInfo' | 'objectClassifications'
  /** Optional files (partner sets) never block core readiness and never set the global error. */
  optional: boolean
}

/** Only set when the base URL is SAP's own repository; a mirror gets no API calls. */
export interface GithubApi {
  baseUrl: string
  repo: string
}

export interface CacheOptions {
  dataDir: string
  baseUrl: string
  githubApi: GithubApi | null
  http: HttpClient
  now: () => Date
  log: (message: string) => void
}

export type FileStatus = 'ready' | 'downloading' | 'missing' | 'stale-error'

export class CacheError extends Error {
  constructor(
    readonly code: 'DATASET_DOWNLOADING' | 'DATASET_UNAVAILABLE' | 'UNKNOWN_VERSION',
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'CacheError'
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class CacheManager {
  private manifest: Manifest | null = null
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly listeners: ((id: string) => void)[] = []
  private refreshing: Promise<void> | null = null
  private lastNetworkFailed = false

  constructor(private readonly options: CacheOptions) {
    mkdirSync(options.dataDir, { recursive: true })
  }

  subscribe(listener: (id: string) => void): void {
    this.listeners.push(listener)
  }

  localPath(spec: FileSpec): string {
    return join(this.options.dataDir, ...spec.fileName.split('/'))
  }

  private manifestPath(): string {
    return join(this.options.dataDir, 'manifest.json')
  }

  /** Synchronous on purpose: `status()` and `offline` are called from result-shaping code. */
  readManifest(): Manifest {
    if (!this.manifest) {
      try {
        this.manifest = parseManifest(readFileSync(this.manifestPath(), 'utf8'))
      } catch {
        this.manifest = emptyManifest()
      }
    }
    return this.manifest
  }

  private async saveManifest(): Promise<void> {
    await this.atomicWrite(this.manifestPath(), JSON.stringify(this.readManifest(), null, 2))
  }

  get offline(): boolean {
    return this.lastNetworkFailed
  }

  status(id: string): FileStatus {
    if (this.inFlight.has(id)) return 'downloading'
    const entry = this.readManifest().files[id]
    if (!entry) return 'missing'
    if (entry.lastError) return 'stale-error'
    return 'ready'
  }

  /** Temp file then rename, so a reader never sees a half-written dataset. */
  private async atomicWrite(target: string, text: string): Promise<void> {
    mkdirSync(dirname(target), { recursive: true })
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temp, text, 'utf8')
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(temp, target)
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') {
          await rm(temp, { force: true })
          throw error
        }
        await delay(50 * (attempt + 1))
      }
    }
    await rm(temp, { force: true })
    throw new Error(`could not replace ${target}: the file stayed locked`)
  }

  /** Best-effort upstream commit date; only asked for when the file actually changed. */
  private async commitDate(fileName: string): Promise<string | null> {
    const api = this.options.githubApi
    if (!api) return null
    try {
      const url = `${api.baseUrl}/repos/${api.repo}/commits?path=src/${fileName}&per_page=1`
      const response = await this.options.http.get(url, { timeoutMs: HEADER_TIMEOUT_MS, accept: 'application/vnd.github+json' })
      if (response.status !== 200 || !response.body) return null
      const rows = JSON.parse(response.body) as { commit?: { committer?: { date?: string } } }[]
      return rows[0]?.commit?.committer?.date ?? null
    } catch {
      return null
    }
  }

  private async downloadOne(spec: FileSpec, conditional: boolean): Promise<void> {
    const manifest = this.readManifest()
    const previous = manifest.files[spec.id] ?? null
    const url = `${this.options.baseUrl}/${spec.fileName}`
    const onDisk = existsSync(this.localPath(spec))

    const response = await this.options.http.get(url, {
      etag: conditional && previous && onDisk ? previous.etag : null,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
    })

    if (response.status === 304 && previous && onDisk) {
      previous.lastError = null
      return
    }
    if (response.status === 404) {
      throw new CacheError('UNKNOWN_VERSION', `${spec.fileName} does not exist upstream`)
    }
    if (response.status !== 200 || response.body === null) {
      throw new Error(`HTTP ${response.status} for ${spec.fileName}`)
    }

    const validation = validatePayload(response.body, spec.arrayKey, previous?.entries ?? null)
    if (!validation.ok) {
      if (previous) {
        previous.lastError = validation.reason
        this.options.log(`kept the cached ${spec.fileName}: ${validation.reason}`)
        return
      }
      throw new Error(`${spec.fileName} failed validation: ${validation.reason}`)
    }

    await this.atomicWrite(this.localPath(spec), response.body)
    const now = this.options.now()
    manifest.files[spec.id] = {
      url,
      etag: response.headers.etag ?? null,
      sha256: sha256(response.body),
      bytes: Buffer.byteLength(response.body, 'utf8'),
      entries: validation.entries,
      downloadedAt: now.toISOString(),
      upstreamCommittedAt: await this.commitDate(spec.fileName),
      lastError: null,
    }
    for (const listener of this.listeners) listener(spec.id)
  }

  /**
   * Run the daily gate over `specs`. Optional files never set the global error, so a
   * rate-limited partner download cannot delay core readiness (spec 6.5). A transport or
   * HTTP failure is a property of the check, not of the cached file: it sets
   * `lastCheckError` and the backoff, and the file keeps serving (spec 8). Only a payload
   * that fails validation marks a file `stale-error`.
   */
  async refresh(specs: FileSpec[], force = false): Promise<void> {
    const manifest = this.readManifest()
    if (!shouldCheck(manifest, this.options.now(), force)) return
    if (this.refreshing) return this.refreshing

    this.refreshing = (async () => {
      let requiredFailure: string | null = null
      for (const spec of specs) {
        try {
          await this.downloadOne(spec, true)
        } catch (error) {
          const message = (error as Error).message
          this.options.log(`refresh failed for ${spec.fileName}: ${message}`)
          if (!spec.optional) requiredFailure = message
        }
      }
      const now = this.options.now()
      this.lastNetworkFailed = requiredFailure !== null
      if (requiredFailure) {
        manifest.lastCheckError = requiredFailure
        manifest.nextCheckAt = new Date(now.getTime() + BACKOFF_MS).toISOString()
      } else {
        manifest.lastCheckError = null
        manifest.nextCheckAt = null
        manifest.lastCheckedAt = now.toISOString()
      }
      await this.saveManifest()
    })()

    try {
      await this.refreshing
    } finally {
      this.refreshing = null
    }
  }

  /** Kick the daily check off without blocking the caller (server start, every tool call). */
  ensureFresh(specs: FileSpec[]): void {
    void this.refresh(specs).catch((error: unknown) => this.options.log(`background refresh failed: ${(error as Error).message}`))
  }

  /**
   * Guarantee one file is on disk. Waits only when it is genuinely missing; otherwise
   * returns immediately and lets the daily check run in the background.
   */
  async ensureFile(spec: FileSpec, timeoutMs = 30_000): Promise<string> {
    const path = this.localPath(spec)
    if (existsSync(path)) return path

    let pending = this.inFlight.get(spec.id)
    if (!pending) {
      pending = this.downloadOne(spec, false).finally(() => this.inFlight.delete(spec.id))
      this.inFlight.set(spec.id, pending)
    }

    let timedOut = false
    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true
        resolve()
      }, timeoutMs)
    })
    try {
      await Promise.race([pending, deadline])
    } catch (error) {
      this.lastNetworkFailed = true
      if (error instanceof CacheError) throw error
      throw new CacheError(
        'DATASET_UNAVAILABLE',
        `${spec.fileName} is not cached and could not be downloaded (${(error as Error).message}). Run dataset_info { refresh: true } once you are online.`,
      )
    } finally {
      clearTimeout(timer)
    }
    if (timedOut && !existsSync(path)) {
      throw new CacheError('DATASET_DOWNLOADING', `${spec.fileName} is still downloading; retry shortly.`, 30)
    }
    return path
  }

  async fileStats(spec: FileSpec): Promise<{ bytes: number } | null> {
    try {
      return { bytes: (await stat(this.localPath(spec))).size }
    } catch {
      return null
    }
  }

  async readFileText(spec: FileSpec): Promise<string> {
    return readFile(this.localPath(spec), 'utf8')
  }
}
