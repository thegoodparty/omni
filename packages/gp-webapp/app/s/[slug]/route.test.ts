import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { serverRequest } = vi.hoisted(() => ({ serverRequest: vi.fn() }))
vi.mock('gpApi/server-request', () => ({ serverRequest }))

import { GET } from './route'

const SLUG = 'K7m2Qx4bNp3v'
const TICKETED_URL =
  'https://app.goodparty.org/serve/welcome?__clerk_ticket=eyJhbGci'

const call = (slug = SLUG) =>
  GET(new NextRequest(new URL(`https://app.goodparty.org/s/${slug}`)), {
    params: Promise.resolve({ slug }),
  })

describe('GET /s/[slug]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards to the resolved redemption URL', async () => {
    serverRequest.mockResolvedValue({ data: { url: TICKETED_URL } })

    const res = await call()

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(TICKETED_URL)
    expect(serverRequest).toHaveBeenCalledWith(
      'GET /v1/magic-link/resolve/:slug',
      { slug: SLUG },
    )
  })

  it('sends a dead slug to the login page with the expired notice', async () => {
    serverRequest.mockResolvedValue({ data: { url: null, status: 'redeemed' } })

    const res = await call()

    expect(res.headers.get('location')).toBe(
      'https://app.goodparty.org/login?magicLinkExpired=1',
    )
  })

  it('sends the lead to the same place when gp-api is unreachable', async () => {
    // ofetch throws on a non-2xx, and an unusable slug and a down gp-api leave
    // the lead in the same position, so there is nothing to distinguish.
    serverRequest.mockRejectedValue(new Error('502'))

    const res = await call()

    expect(res.headers.get('location')).toContain('/login?magicLinkExpired=1')
  })

  it('refuses to redirect off our own hosts', async () => {
    // The URL comes from our database, but it still feeds a redirect. A poisoned
    // row must not turn this into an open redirect.
    serverRequest.mockResolvedValue({
      data: { url: 'https://evil.example.com/serve/welcome?__clerk_ticket=x' },
    })

    const res = await call()

    expect(res.headers.get('location')).toContain('/login?magicLinkExpired=1')
  })

  it('allows the non-prod app origins links are minted against', async () => {
    // gp-api's APP_ROOT is dev.goodparty.org / qa.goodparty.org outside prod, so
    // a cross-host redirect here is expected and must keep working.
    serverRequest.mockResolvedValue({
      data: { url: 'https://dev.goodparty.org/win/welcome?__clerk_ticket=x' },
    })

    const res = await call()

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('dev.goodparty.org')
  })
})
