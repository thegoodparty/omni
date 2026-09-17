import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils'
import { HelpCenterSearchService } from './helpCenterSearch.service'

const service = () => new HelpCenterSearchService(createMockLogger())

const respondWith = (body: unknown, ok = true) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 503,
      json: () => Promise.resolve(body),
    }),
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HelpCenterSearchService', () => {
  it('asks HubSpot for knowledge articles only, for our portal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ results: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await service().search('texting compliance')

    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).toContain('cms/v3/site-search/search')
    expect(url).toContain('portalId=21589597')
    expect(url).toContain('type=KNOWLEDGE_ARTICLE')
    expect(url).toContain('q=texting+compliance')
  })

  // Search wraps matched terms in highlight spans. Left in, the model quotes
  // markup back at the user.
  it('strips the highlight markup search injects', async () => {
    respondWith({
      results: [
        {
          title:
            'Send a <span class="hs-search-highlight">Texting</span> Campaign',
          url: 'https://support.goodparty.org/send-a-texting-campaign',
          description: 'Learn how to send <span class="x">voter</span> texts',
          category: 'Campaign Management',
          tags: ['Pro'],
          isPrivate: false,
        },
      ],
    })

    const { articles } = await service().search('texting')

    expect(articles[0]?.title).toBe('Send a Texting Campaign')
    expect(articles[0]?.summary).toBe('Learn how to send voter texts')
    expect(articles[0]?.tags).toEqual(['Pro'])
  })

  // Uniform normalization: every string field, not just the obvious ones.
  it('normalizes tags too, so no field can smuggle markup through', async () => {
    respondWith({
      results: [
        {
          title: 'Send a Texting Campaign',
          url: 'https://support.goodparty.org/send-a-texting-campaign',
          tags: ['<span class="hs-search-highlight">Pro</span>', ' Feature '],
        },
      ],
    })

    const { articles } = await service().search('pro')

    expect(articles[0]?.tags).toEqual(['Pro', 'Feature'])
  })

  it('never surfaces a private article, or one with no link', async () => {
    respondWith({
      results: [
        { title: 'Staff only', url: 'https://x/y', isPrivate: true },
        { title: 'No link', url: '' },
        { title: 'Public', url: 'https://support.goodparty.org/public' },
      ],
    })

    const { articles } = await service().search('anything')

    expect(articles.map((a) => a.title)).toEqual(['Public'])
  })

  // A help-center outage degrades the answer; it must not fail the turn.
  it('reports a usable error when the search is down', async () => {
    respondWith({}, false)

    const result = await service().search('billing')

    expect(result.articles).toEqual([])
    expect(result.error).toContain('unavailable')
  })

  it('reports the same error when the response is the wrong shape', async () => {
    respondWith({ results: 'not an array' })

    const result = await service().search('billing')

    expect(result.articles).toEqual([])
    expect(result.error).toContain('unavailable')
  })

  it('reports the same error when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timed out')))

    const result = await service().search('billing')

    expect(result.articles).toEqual([])
    expect(result.error).toContain('unavailable')
  })
})
