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

/**
 * A failure upstream answered with: a non-2xx status or a payload that failed validation.
 * The transport worked, so these must never flip `offline` - that flag means "no network".
 */
class UpstreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UpstreamError'
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

  /**
   * Throw one cached file away: the manifest entry, the file, and with them the etag that
   * would otherwise earn a 304 and keep a corrupt copy forever. The only way back from a file
   * that is on disk but unreadable, so a caller that finds one can repair the cache itself.
   */
  async evict(spec: FileSpec): Promise<void> {
    const manifest = this.readManifest()
    delete manifest.files[spec.id]
    await rm(this.localPath(spec), { force: true })
    await this.saveManifest()
    for (const listener of this.listeners) listener(spec.id)
  }

  /** Temp file then rename, so a reader never sees a half-written dataset. */
  private async atomicWrite(target: string, text: string): Promise<void> {
    mkdirSync(dirname(target), { recursive: true })
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`
    try {
      await writeFile(temp, text, 'utf8')
    } catch (error) {
      // A write that fails part-way still leaves a temp file behind; clean it up on the way out,
      // and never let the cleanup's own failure replace the error the caller has to see.
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
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
      // An answer arrived, so the transport worked: the caller (`refresh`) clears `offline` for it.
      previous.lastError = null
      return
    }
    if (response.status === 404) {
      throw new CacheError('UNKNOWN_VERSION', `${spec.fileName} does not exist upstream`)
    }
    if (response.status !== 200 || response.body === null) {
      throw new UpstreamError(`HTTP ${response.status} for ${spec.fileName}`)
    }

    const validation = validatePayload(response.body, spec.arrayKey, previous?.entries ?? null)
    if (!validation.ok) {
      if (previous) previous.lastError = validation.reason
      // Only a file that is actually on disk can be "kept"; without one this is a hard failure,
      // so callers hear about it instead of being handed a path to nothing.
      if (previous && onDisk) {
        this.options.log(`kept the cached ${spec.fileName}: ${validation.reason}`)
        return
      }
      throw new UpstreamError(`${spec.fileName} failed validation: ${validation.reason}`)
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
    // A check already running is not this check: it may cover other files, and a forced call must
    // not be answered by a run that started before it. Queue behind it instead of joining it - the
    // in-flight run clears `refreshing` before this continuation fires, so it chains exactly once,
    // and the daily gate above turns the chained call into a no-op when it has nothing left to do.
    if (this.refreshing) return this.refreshing.then(() => this.refresh(specs, force))

    this.refreshing = (async () => {
      let requiredFailure: string | null = null
      // `offline` means "this machine has no network", so only a failure the transport itself
      // produced may set it: a 404 or a payload that fails validation is an upstream answer, and
      // an answer proves the network works. `ensureFile` draws the same line.
      let transportFailed = false
      for (const spec of specs) {
        try {
          await this.downloadOne(spec, true)
        } catch (error) {
          const message = (error as Error).message
          this.options.log(`refresh failed for ${spec.fileName}: ${message}`)
          if (spec.optional) continue
          requiredFailure = message
          if (!(error instanceof CacheError) && !(error instanceof UpstreamError)) transportFailed = true
        }
      }
      const now = this.options.now()
      this.lastNetworkFailed = transportFailed
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
    // The file is already here, so nothing was asked of the network and nothing was learned about
    // it: `offline` keeps whatever it held. A `false` stays false because no failure happened, and
    // a `true` stays true because finding a cached file is not evidence that an outage has ended -
    // only a transport success (a download or a 304 in `refresh`) may clear the flag.
    if (existsSync(path)) return path

    let pending = this.inFlight.get(spec.id)
    if (!pending) {
      // Nothing else persists a lazy download, so this path writes the manifest itself.
      pending = this.downloadOne(spec, false)
        .then(() => this.saveManifest())
        .finally(() => this.inFlight.delete(spec.id))
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
      // An upstream answer (404, bad status, bad payload) proves the network works.
      if (!(error instanceof CacheError) && !(error instanceof UpstreamError)) this.lastNetworkFailed = true
      if (error instanceof CacheError) throw error
      throw new CacheError(
        'DATASET_UNAVAILABLE',
        `${spec.fileName} is not cached and could not be downloaded (${(error as Error).message}). Run dataset_info { refresh: true } once you are online.`,
      )
    } finally {
      clearTimeout(timer)
    }
    if (!existsSync(path)) {
      if (timedOut) {
        throw new CacheError('DATASET_DOWNLOADING', `${spec.fileName} is still downloading; retry shortly.`, 30)
      }
      throw new CacheError('DATASET_UNAVAILABLE', `${spec.fileName} is still not on disk after its download reported success.`)
    }
    this.lastNetworkFailed = false
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
