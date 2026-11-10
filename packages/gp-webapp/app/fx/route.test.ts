import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

const COLLECTOR_URL =
  'https://faro-collector-prod-us-east-3.grafana.net/collect/abc123'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const post = (headers: Record<string, string> = {}, body = '{"meta":{}}') =>
  POST(
    new NextRequest('https://app.goodparty.org/fx', {
      method: 'POST',
      headers,
      body,
    }),
  )

const upstreamCall = () => {
  const call = fetchMock.mock.calls[0]
  return {
    url: call?.[0] as string,
    init: call?.[1] as { headers: Headers; body: ArrayBuffer },
  }
}

describe('faro collector proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_FARO_COLLECTOR_URL', COLLECTOR_URL)
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('forwards the beacon body to the configured collector', async () => {
    await post({ 'content-type': 'application/json' }, '{"exceptions":[]}')

    expect(upstreamCall().url).toBe(COLLECTOR_URL)
    expect(new TextDecoder().decode(upstreamCall().init.body)).toBe(
      '{"exceptions":[]}',
    )
  })

  it('forwards the session id the collector keys sessions on', async () => {
    await post({ 'x-faro-session-id': 'sess-1' })

    expect(upstreamCall().init.headers.get('x-faro-session-id')).toBe('sess-1')
  })

  it('forwards the caller IP so sessions are not placed at Vercel', async () => {
    await post({ 'x-forwarded-for': '203.0.113.7' })

    expect(upstreamCall().init.headers.get('x-forwarded-for')).toBe(
      '203.0.113.7',
    )
  })

  it('never forwards the browser cookies', async () => {
    await post({ cookie: '__session=secret' })

    expect(upstreamCall().init.headers.get('cookie')).toBeNull()
  })

  it('returns the collector status and backoff hint to the transport', async () => {
    fetchMock.mockResolvedValue(
      new Response('slow down', {
        status: 429,
        headers: { 'retry-after': '30' },
      }),
    )

    const res = await post()

    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('30')
  })

  it('answers 404 without calling out when no collector is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_FARO_COLLECTOR_URL', '')

    const res = await post()

    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
