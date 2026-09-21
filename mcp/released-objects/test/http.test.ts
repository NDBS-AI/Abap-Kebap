import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server, type RequestListener } from 'node:http'
import { createHttpClient } from '../src/http'

// EnvHttpProxyAgent has no implicit loopback bypass: with a proxy configured and no matching
// NO_PROXY entry it would route these 127.0.0.1 requests to that proxy, failing for the wrong
// reason and putting bytes on the network. Loopback tests must never leave the machine.
process.env.NO_PROXY = '127.0.0.1'
process.env.HTTP_PROXY = ''
process.env.HTTPS_PROXY = ''
process.env.http_proxy = ''
process.env.https_proxy = ''

async function listen(handler: RequestListener): Promise<{ server: Server; base: string }> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('no port assigned')
  return { server, base: `http://127.0.0.1:${address.port}` }
}

test('a plain GET returns status, lower-cased headers and the body', async () => {
  const { server, base } = await listen((_req, res) => {
    res.setHeader('ETag', '"abc"')
    res.setHeader('Content-Type', 'application/json')
    res.end('{"ok":true}')
  })
  try {
    const response = await createHttpClient('test-agent/1').get(`${base}/file.json`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.etag, '"abc"')
    assert.equal(response.body, '{"ok":true}')
  } finally {
    server.close()
  }
})

test('an etag is sent as If-None-Match and a 304 yields a null body', async () => {
  let seen: string | undefined
  const { server, base } = await listen((req, res) => {
    seen = req.headers['if-none-match'] as string | undefined
    res.statusCode = 304
    res.end()
  })
  try {
    const response = await createHttpClient('test-agent/1').get(`${base}/file.json`, { etag: '"abc"' })
    assert.equal(seen, '"abc"')
    assert.equal(response.status, 304)
    assert.equal(response.body, null)
  } finally {
    server.close()
  }
})

test('the user agent is sent on every request', async () => {
  let seen: string | undefined
  const { server, base } = await listen((req, res) => {
    seen = req.headers['user-agent'] as string | undefined
    res.end('{}')
  })
  try {
    await createHttpClient('abap-kebap-released-objects/0.3.0').get(`${base}/x`)
    assert.equal(seen, 'abap-kebap-released-objects/0.3.0')
  } finally {
    server.close()
  }
})

test('a request that exceeds its timeout rejects instead of hanging', async () => {
  const { server, base } = await listen(() => {
    // deliberately never respond
  })
  try {
    await assert.rejects(() => createHttpClient('test-agent/1').get(`${base}/slow`, { timeoutMs: 120 }), {
      name: 'TimeoutError',
    })
  } finally {
    server.close()
  }
})
