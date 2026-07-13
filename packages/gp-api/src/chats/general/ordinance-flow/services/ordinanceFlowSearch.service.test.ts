import { describe, expect, it } from 'vitest'
import {
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
})
