import type { HttpClient, HttpGetOptions, HttpResponse } from '../../src/http'

export interface RecordedCall {
  url: string
  options: HttpGetOptions
}

export type Route = HttpResponse | ((options: HttpGetOptions, url: string) => HttpResponse | Promise<HttpResponse>)

export interface FakeHttp extends HttpClient {
  calls: RecordedCall[]
  /** Replace a route mid-test, e.g. to simulate upstream changing overnight. */
  setRoute(urlSuffix: string, route: Route): void
}

/** Routes match by URL suffix, so tests can key on `objectReleaseInfoLatest.json`. */
export function fakeHttp(routes: Record<string, Route>): FakeHttp {
  const table = new Map<string, Route>(Object.entries(routes))
  const calls: RecordedCall[] = []
  return {
    calls,
    setRoute(urlSuffix, route) {
      table.set(urlSuffix, route)
    },
    async get(url, options = {}) {
      calls.push({ url, options })
      for (const [suffix, route] of table) {
        if (url.endsWith(suffix) || url.includes(suffix)) {
          return typeof route === 'function' ? route(options, url) : route
        }
      }
      return { status: 404, headers: {}, body: 'not found' }
    },
  }
}

export function jsonResponse(payload: unknown, etag = '"v1"'): HttpResponse {
  return { status: 200, headers: { etag }, body: JSON.stringify(payload) }
}

export function notModified(etag = '"v1"'): HttpResponse {
  return { status: 304, headers: { etag }, body: null }
}

/** A route that behaves like an unreachable host. */
export function unreachable(message = 'fetch failed'): Route {
  return () => {
    throw new Error(message)
  }
}

export interface FakeClock {
  now: () => Date
  advanceMs(ms: number): void
  advanceDays(days: number): void
  set(iso: string): void
}

export function fakeClock(iso: string): FakeClock {
  let current = new Date(iso).getTime()
  return {
    now: () => new Date(current),
    advanceMs(ms) {
      current += ms
    },
    advanceDays(days) {
      current += days * 24 * 60 * 60 * 1000
    },
    set(next) {
      current = new Date(next).getTime()
    },
  }
}
