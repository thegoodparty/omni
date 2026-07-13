import { afterAll, describe, expect, it } from 'vitest'
import * as http from 'http'
import type { AddressInfo } from 'net'
import {
  defaultOrdinanceFetchHttp,
  MAX_FETCH_CONTENT_CHARS,
  OrdinanceFetchHttp,
  OrdinanceFetchHttpResult,
  OrdinanceFlowFetchService,
} from './ordinanceFlowFetch.service'

const okResponse = (
  overrides: Partial<Extract<OrdinanceFetchHttpResult, { kind: 'ok' }>> = {},
): OrdinanceFetchHttpResult => ({
  kind: 'ok',
  status: 200,
  contentType: 'text/html; charset=utf-8',
  body: '<html><body><h1>Title</h1><p>Hello</p></body></html>',
  finalUrl: 'https://example.org/code',
  ...overrides,
})

const fakeHttp = (result: OrdinanceFetchHttpResult): OrdinanceFetchHttp => ({
  get: () => Promise.resolve(result),
})

const service = (result: OrdinanceFetchHttpResult) =>
  new OrdinanceFlowFetchService(fakeHttp(result))

describe('OrdinanceFlowFetchService', () => {
  it('converts an HTML page to markdown', async () => {
    const result = await service(okResponse()).fetchUrl(
      'https://example.org/code',
    )
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      finalUrl: 'https://example.org/code',
      truncated: false,
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.content).toContain('Title')
    expect(result.content).toContain('Hello')
    expect(result.content).not.toContain('<h1>')
  })

  it('strips script and style content from HTML', async () => {
    const body =
      '<html><body><script>evil()</script><style>.x{}</style>' +
      '<p>Chapter 9.16 Noise</p></body></html>'
    const result = await service(okResponse({ body })).fetchUrl(
      'https://example.org/code',
    )
    if (!result.ok) throw new Error('expected ok')
    expect(result.content).toContain('Chapter 9.16 Noise')
    expect(result.content).not.toContain('evil()')
    expect(result.content).not.toContain('.x{}')
  })

  it('passes text/plain bodies through unconverted', async () => {
    const result = await service(
      okResponse({ contentType: 'text/plain', body: 'Sec. 1. Purpose.' }),
    ).fetchUrl('https://example.org/code.txt')
    if (!result.ok) throw new Error('expected ok')
    expect(result.content).toBe('Sec. 1. Purpose.')
  })

  it('truncates oversized content and flags it', async () => {
    const body = `<p>${'a'.repeat(MAX_FETCH_CONTENT_CHARS + 5_000)}</p>`
    const result = await service(okResponse({ body })).fetchUrl(
      'https://example.org/long',
    )
    if (!result.ok) throw new Error('expected ok')
    expect(result.truncated).toBe(true)
    expect(result.content.length).toBeLessThanOrEqual(MAX_FETCH_CONTENT_CHARS)
    expect(result.totalChars).toBeGreaterThan(MAX_FETCH_CONTENT_CHARS)
  })

  it('rejects unsupported content types without fetching content', async () => {
    const result = await service(
      okResponse({ contentType: 'application/pdf', body: '%PDF-1.7' }),
    ).fetchUrl('https://example.org/code.pdf')
    expect(result).toMatchObject({
      ok: false,
      reason: 'unsupported_content_type',
    })
  })

  it('maps HTTP error statuses to an error-shaped result', async () => {
    const result = await service(
      okResponse({ status: 404, body: 'not found' }),
    ).fetchUrl('https://example.org/missing')
    expect(result).toMatchObject({ ok: false, reason: 'http_error' })
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(404)
  })

  it('rejects non-http(s) and malformed URLs before fetching', async () => {
    const svc = service(okResponse())
    expect(await svc.fetchUrl('ftp://example.org/code')).toMatchObject({
      ok: false,
      reason: 'invalid_url',
    })
    expect(await svc.fetchUrl('not a url')).toMatchObject({
      ok: false,
      reason: 'invalid_url',
    })
  })

  it('rejects literal non-public IP addresses without fetching', async () => {
    const svc = service(okResponse())
    expect(await svc.fetchUrl('http://127.0.0.1/admin')).toMatchObject({
      ok: false,
      reason: 'blocked_host',
    })
    expect(await svc.fetchUrl('http://169.254.169.254/meta')).toMatchObject({
      ok: false,
      reason: 'blocked_host',
    })
    expect(await svc.fetchUrl('http://[::1]/admin')).toMatchObject({
      ok: false,
      reason: 'blocked_host',
    })
  })

  it('maps transport-level failures from the http port', async () => {
    expect(
      await service({ kind: 'error', reason: 'timeout' }).fetchUrl(
        'https://example.org/slow',
      ),
    ).toMatchObject({ ok: false, reason: 'timeout' })
    expect(
      await service({ kind: 'error', reason: 'blocked_host' }).fetchUrl(
        'https://rebind.example.org/x',
      ),
    ).toMatchObject({ ok: false, reason: 'blocked_host' })
    expect(
      await service({ kind: 'error', reason: 'network' }).fetchUrl(
        'https://down.example.org/x',
      ),
    ).toMatchObject({ ok: false, reason: 'fetch_failed' })
  })

  it('never throws for expected failures (tool errors kill the stream)', async () => {
    const throwingHttp: OrdinanceFetchHttp = {
      get: () => Promise.reject(new Error('boom')),
    }
    const result = await new OrdinanceFlowFetchService(throwingHttp).fetchUrl(
      'https://example.org/code',
    )
    expect(result).toMatchObject({ ok: false, reason: 'fetch_failed' })
  })
})

// The real axios adapter's redirect handling can't be exercised through the
// fake port (the seam sits above redirect-following), so these drive
// defaultOrdinanceFetchHttp.get against a real loopback server. The service's
// own literalHostBlocked gate is bypassed here on purpose — we're proving the
// beforeRedirect hop guard, which is the only SSRF defense on a redirect to a
// literal private IP (Node skips the agent lookup for IP-literal hosts).
describe('defaultOrdinanceFetchHttp (real adapter)', () => {
  const servers: http.Server[] = []

  const startServer = (handler: http.RequestListener): Promise<string> =>
    new Promise((resolve) => {
      const server = http.createServer(handler)
      servers.push(server)
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo
        resolve(`http://127.0.0.1:${port}`)
      })
    })

  afterAll(() => {
    for (const s of servers) s.close()
  })

  it('fetches a normal 200 page through the guarded agents', async () => {
    const base = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body><h1>Ordinance</h1></body></html>')
    })
    const result = await defaultOrdinanceFetchHttp.get(`${base}/code`)
    expect(result).toMatchObject({ kind: 'ok', status: 200 })
    if (result.kind !== 'ok') throw new Error('expected ok')
    expect(result.body).toContain('Ordinance')
  })

  it('blocks a redirect to a literal private IP (SSRF via redirect)', async () => {
    const base = await startServer((_req, res) => {
      res.writeHead(302, { location: 'http://10.255.255.1/internal-admin' })
      res.end()
    })
    const result = await defaultOrdinanceFetchHttp.get(`${base}/redirect`)
    expect(result).toMatchObject({ kind: 'error', reason: 'blocked_host' })
  })

  it('blocks a redirect to loopback (SSRF via redirect)', async () => {
    const base = await startServer((_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1:9/secret' })
      res.end()
    })
    const result = await defaultOrdinanceFetchHttp.get(`${base}/redirect`)
    expect(result).toMatchObject({ kind: 'error', reason: 'blocked_host' })
  })
})
