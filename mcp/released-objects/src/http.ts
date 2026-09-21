import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici'

/** 15 s is enough for a conditional check; a full download gets the longer budget. */
export const HEADER_TIMEOUT_MS = 15_000
export const DOWNLOAD_TIMEOUT_MS = 120_000

export interface HttpResponse {
  status: number
  /** Lower-cased header names. */
  headers: Record<string, string>
  /** `null` for 304 and 204 — there is no body to read. */
  body: string | null
}

export interface HttpGetOptions {
  etag?: string | null
  timeoutMs?: number
  accept?: string
}

export interface HttpClient {
  get(url: string, options?: HttpGetOptions): Promise<HttpResponse>
}

/**
 * HTTPS GET honouring HTTPS_PROXY / HTTP_PROXY / NO_PROXY. Node's global fetch ignores
 * those variables, which fails on every proxied corporate network. TLS-inspecting proxies
 * additionally need NODE_EXTRA_CA_CERTS, which the README documents.
 */
export function createHttpClient(userAgent: string): HttpClient {
  const dispatcher = new EnvHttpProxyAgent()
  return {
    async get(url, options = {}) {
      const headers: Record<string, string> = {
        'user-agent': userAgent,
        accept: options.accept ?? 'application/json',
      }
      if (options.etag) headers['if-none-match'] = options.etag

      const response = await undiciFetch(url, {
        method: 'GET',
        headers,
        dispatcher,
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS),
      })

      const collected: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        collected[key.toLowerCase()] = value
      })

      const body = response.status === 304 || response.status === 204 ? null : await response.text()
      return { status: response.status, headers: collected, body }
    },
  }
}
