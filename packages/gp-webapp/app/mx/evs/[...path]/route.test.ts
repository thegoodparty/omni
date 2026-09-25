import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const post = (
  endpoint: string,
  headers: Record<string, string> = {},
  body = '{"type":"track"}',
) =>
  POST(
    new NextRequest(`https://app.goodparty.org/mx/evs/${endpoint}`, {
      method: 'POST',
      headers,
      body,
    }),
    { params: Promise.resolve({ path: endpoint.split('/') }) },
  )

const upstreamCall = () => {
  const call = fetchMock.mock.calls[0]
  return {
    url: call?.[0] as string,
    init: call?.[1] as { headers: Record<string, string>; body: string },
  }
}

describe('segment ingestion proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockResolvedValue(
      new Response('{"success":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  // The whole reason this is a route handler and not a next.config rewrite: a
  // rewrite reaches Segment from the platform's egress IPs, so every event
  // would be geo-enriched to a datacenter.
  it('forwards the caller IP so Segment geo-enriches the real client', async () => {
    await post('t', { 'x-forwarded-for': '203.0.113.7' })

    expect(upstreamCall().init.headers['x-forwarded-for']).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip when no forwarded-for is present', async () => {
    await post('t', { 'x-real-ip': '198.51.100.22' })

    expect(upstreamCall().init.headers['x-forwarded-for']).toBe('198.51.100.22')
  })

  it('omits the header entirely rather than sending an empty one', async () => {
    await post('t')

    expect(upstreamCall().init.headers).not.toHaveProperty('x-forwarded-for')
  })

  it('maps the event verb onto Segment v1 and passes the body through', async () => {
    await post('i', {}, '{"type":"identify"}')

    expect(upstreamCall().url).toBe('https://api.segment.io/v1/i')
    expect(upstreamCall().init.body).toBe('{"type":"identify"}')
  })

  // analytics-next sends text/plain on purpose, to avoid a CORS preflight.
  it('preserves the content type analytics-next chose', async () => {
    await post('t', { 'content-type': 'text/plain' })

    expect(upstreamCall().init.headers['content-type']).toBe('text/plain')
  })

  it('returns Segment’s own status and body to the browser', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 429 }))

    const res = await post('t')

    expect(res.status).toBe(429)
    await expect(res.text()).resolves.toBe('nope')
  })

  it.each(['t', 'i', 'p', 'g', 'a', 'b', 'm'])(
    'accepts the %s ingestion endpoint',
    async (endpoint) => {
      const res = await post(endpoint)

      expect(res.status).toBe(200)
    },
  )

  // Without an allowlist this route is an open relay to any api.segment.io/v1
  // path, under our own origin's name.
  it.each(['import', 'projects/secret/settings', '../admin'])(
    'refuses to relay %s',
    async (endpoint) => {
      const res = await post(endpoint)

      expect(res.status).toBe(404)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
})
