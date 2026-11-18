import { afterEach, describe, expect, it, vi } from 'vitest'
import { webSearch } from './webSearch'

const ctx = {
  runId: 'run-1',
  stepKey: '0:webSearch:0',
  organizationSlug: 'eo-test',
  signal: new AbortController().signal,
  get: () => {
    throw new Error('unused')
  },
}

const braveReply = (body: unknown, init: ResponseInit = { status: 200 }) =>
  new Response(JSON.stringify(body), init)

describe('webSearch', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns Brave\u2019s ranked results for the query', async () => {
    vi.stubEnv('BRAVE_API_KEY', 'test-brave-key')
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(url)
        expect(init.headers).toMatchObject({
          'X-Subscription-Token': 'test-brave-key',
        })
        return braveReply({
          web: {
            results: [
              {
                title: 'City code',
                url: 'https://example.gov/code',
                description: 'The code.',
                extra_snippets: ['Chapter 12'],
                page_age: '2026-01-01',
              },
              { title: 'No url', description: 'dropped' },
            ],
          },
        })
      }),
    )

    await expect(
      webSearch.execute({ query: 'city code' }, ctx),
    ).resolves.toEqual({
      ok: true,
      query: 'city code',
      results: [
        {
          title: 'City code',
          url: 'https://example.gov/code',
          description: 'The code.',
          extraSnippets: ['Chapter 12'],
          age: '2026-01-01',
        },
      ],
    })
    expect(calls[0]).toContain('q=city+code')
  })

  it('caps the result count at the tool\u2019s own maximum', async () => {
    vi.stubEnv('BRAVE_API_KEY', 'test-brave-key')
    let requested = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested = url
        return braveReply({ web: { results: [] } })
      }),
    )

    await webSearch.execute({ query: 'code', count: 50 }, ctx)

    expect(new URL(requested).searchParams.get('count')).toBe('8')
  })

  it('reports a missing key instead of throwing, so the model can carry on', async () => {
    vi.stubEnv('BRAVE_API_KEY', undefined)

    await expect(webSearch.execute({ query: 'code' }, ctx)).resolves.toEqual({
      ok: false,
      reason: 'not_configured',
    })
  })

  it('reports an HTTP error with its status', async () => {
    vi.stubEnv('BRAVE_API_KEY', 'test-brave-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => braveReply({}, { status: 429 })),
    )

    await expect(webSearch.execute({ query: 'code' }, ctx)).resolves.toEqual({
      ok: false,
      reason: 'http_error',
      status: 429,
    })
  })

  it('reports a transport failure and an unparseable body', async () => {
    vi.stubEnv('BRAVE_API_KEY', 'test-brave-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    await expect(webSearch.execute({ query: 'code' }, ctx)).resolves.toEqual({
      ok: false,
      reason: 'search_failed',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => braveReply({ web: 'nope' })),
    )
    await expect(webSearch.execute({ query: 'code' }, ctx)).resolves.toEqual({
      ok: false,
      reason: 'search_failed',
    })
  })
})
