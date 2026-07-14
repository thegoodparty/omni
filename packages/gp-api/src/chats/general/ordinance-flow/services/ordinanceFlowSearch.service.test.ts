import { Logger } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_DESCRIPTION_CHARS,
  MAX_SEARCH_RESULTS,
  OrdinanceSearchHttp,
  OrdinanceSearchHttpResult,
  OrdinanceFlowSearchService,
} from './ordinanceFlowSearch.service'

const braveBody = (
  results: {
    title?: string
    url?: string
    description?: string
    extra_snippets?: string[]
    page_age?: string
  }[],
): string => JSON.stringify({ web: { results } })

const okResponse = (body: string): OrdinanceSearchHttpResult => ({
  kind: 'ok',
  status: 200,
  body,
})

const fakeHttp = (
  result: OrdinanceSearchHttpResult,
  capture?: { url?: string; headers?: Record<string, string> },
): OrdinanceSearchHttp => ({
  get: (url, headers) => {
    if (capture) {
      capture.url = url
      capture.headers = headers
    }
    return Promise.resolve(result)
  },
})

const EXPECTED_OK = 'expected ok'

const service = (
  result: OrdinanceSearchHttpResult,
  apiKey = 'test-key',
  capture?: { url?: string; headers?: Record<string, string> },
) => new OrdinanceFlowSearchService(fakeHttp(result, capture), apiKey)

describe('OrdinanceFlowSearchService', () => {
  it('parses Brave web results into hits', async () => {
    const body = braveBody([
      {
        title: 'Chapter 9.16 Noise',
        url: 'https://codelibrary.amlegal.com/codes/x/9.16',
        description: 'Regulates noise levels.',
        extra_snippets: ['Sec. 9.16.010', 'Sec. 9.16.020'],
        page_age: '2021-05-01T00:00:00',
      },
    ])
    const result = await service(okResponse(body)).search('noise ordinance')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(EXPECTED_OK)
    expect(result.query).toBe('noise ordinance')
    expect(result.results).toEqual([
      {
        title: 'Chapter 9.16 Noise',
        url: 'https://codelibrary.amlegal.com/codes/x/9.16',
        description: 'Regulates noise levels.',
        extraSnippets: ['Sec. 9.16.010', 'Sec. 9.16.020'],
        age: '2021-05-01T00:00:00',
      },
    ])
  })

  it('sends the query and subscription token to Brave', async () => {
    const capture: { url?: string; headers?: Record<string, string> } = {}
    await service(okResponse(braveBody([])), 'secret-key', capture).search(
      'camera surveillance policy',
    )
    expect(capture.url).toContain('api.search.brave.com/res/v1/web/search')
    expect(capture.url).toContain('q=camera+surveillance+policy')
    expect(capture.headers?.['X-Subscription-Token']).toBe('secret-key')
  })

  it('caps the number of results returned', async () => {
    const body = braveBody(
      Array.from({ length: MAX_SEARCH_RESULTS + 5 }, (_v, i) => ({
        title: `r${i}`,
        url: `https://example.org/${i}`,
        description: 'd',
      })),
    )
    const result = await service(okResponse(body)).search('q')
    if (!result.ok) throw new Error(EXPECTED_OK)
    expect(result.results.length).toBe(MAX_SEARCH_RESULTS)
  })

  it('drops results missing a title or url', async () => {
    const body = braveBody([
      { title: 'ok', url: 'https://example.org/a', description: 'd' },
      { title: '', url: 'https://example.org/b', description: 'd' },
      { title: 'no url', description: 'd' },
    ])
    const result = await service(okResponse(body)).search('q')
    if (!result.ok) throw new Error(EXPECTED_OK)
    expect(result.results.map((r) => r.url)).toEqual(['https://example.org/a'])
  })

  it('returns not_configured when no api key is set', async () => {
    const result = await service(okResponse(braveBody([])), '').search('q')
    expect(result).toMatchObject({ ok: false, reason: 'not_configured' })
  })

  it('maps HTTP error statuses to an error-shaped result', async () => {
    const result = await service({
      kind: 'ok',
      status: 429,
      body: 'rate limited',
    }).search('q')
    expect(result).toMatchObject({ ok: false, reason: 'http_error' })
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(429)
  })

  it('maps transport-level failures from the http port', async () => {
    expect(
      await service({ kind: 'error', reason: 'timeout' }).search('q'),
    ).toMatchObject({ ok: false, reason: 'timeout' })
    expect(
      await service({ kind: 'error', reason: 'network' }).search('q'),
    ).toMatchObject({ ok: false, reason: 'search_failed' })
  })

  it('degrades to an error-shaped result on unparseable JSON', async () => {
    const result = await service(okResponse('not json')).search('q')
    expect(result).toMatchObject({ ok: false, reason: 'search_failed' })
  })

  it('never throws for expected failures (tool errors kill the stream)', async () => {
    const throwingHttp: OrdinanceSearchHttp = {
      get: () => Promise.reject(new Error('boom')),
    }
    const result = await new OrdinanceFlowSearchService(
      throwingHttp,
      'k',
    ).search('q')
    expect(result).toMatchObject({ ok: false, reason: 'search_failed' })
  })

  it('requests count=8 by default and clamps oversized counts', async () => {
    const capDefault: { url?: string } = {}
    await service(okResponse(braveBody([])), 'k', capDefault).search('q')
    expect(capDefault.url).toContain('count=8')
    expect(capDefault.url).toContain('extra_snippets=true')

    const capClamped: { url?: string } = {}
    await service(okResponse(braveBody([])), 'k', capClamped).search('q', 50)
    expect(capClamped.url).toContain('count=8')

    const capSmall: { url?: string } = {}
    await service(okResponse(braveBody([])), 'k', capSmall).search('q', 3)
    expect(capSmall.url).toContain('count=3')
  })

  it('caps each result description to MAX_DESCRIPTION_CHARS', async () => {
    const body = braveBody([
      {
        title: 'Long',
        url: 'https://example.org/long',
        description: 'x'.repeat(800),
      },
    ])
    const result = await service(okResponse(body)).search('q')
    if (!result.ok) throw new Error(EXPECTED_OK)
    expect(result.results[0]?.description).toHaveLength(MAX_DESCRIPTION_CHARS)
  })

  it('omits extraSnippets and age when Brave did not supply them', async () => {
    const minimal = await service(
      okResponse(
        braveBody([
          { title: 't', url: 'https://example.org/a', description: 'd' },
        ]),
      ),
    ).search('q')
    if (!minimal.ok) throw new Error(EXPECTED_OK)
    expect(minimal.results[0]).toStrictEqual({
      title: 't',
      url: 'https://example.org/a',
      description: 'd',
    })

    const emptySnippets = await service(
      okResponse(
        braveBody([
          {
            title: 't',
            url: 'https://example.org/a',
            description: 'd',
            extra_snippets: [],
          },
        ]),
      ),
    ).search('q')
    if (!emptySnippets.ok) throw new Error(EXPECTED_OK)
    expect(emptySnippets.results[0]).toStrictEqual({
      title: 't',
      url: 'https://example.org/a',
      description: 'd',
    })
  })

  it('slices the parsed results down to the requested count', async () => {
    const body = braveBody(
      Array.from({ length: 10 }, (_v, i) => ({
        title: `r${i}`,
        url: `https://example.org/${i}`,
        description: 'd',
      })),
    )
    const result = await service(okResponse(body)).search('q', 3)
    if (!result.ok) throw new Error(EXPECTED_OK)
    expect(result.results.length).toBe(3)
  })

  it('warns (with status and query) when Brave rate-limits', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn')
    await service({ kind: 'ok', status: 429, body: 'slow down' }).search('q')
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 429, query: 'q' }),
      expect.stringContaining('rate-limited'),
    )
  })

  it('warns with an auth-specific message on 401/403', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn')
    await service({ kind: 'ok', status: 401, body: 'nope' }).search('q')
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 401, query: 'q' }),
      expect.stringContaining('BRAVE_API_KEY'),
    )
  })

  it('warns when the Brave body is unparseable', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn')
    await service(okResponse('not json')).search('q')
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'q' }),
      expect.stringContaining('unparseable'),
    )
  })

  it('warns on a transport failure from the http port', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn')
    await service({ kind: 'error', reason: 'network' }).search('q')
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'network', query: 'q' }),
      expect.stringContaining('transport failure'),
    )
  })
})
