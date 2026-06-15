import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dashboardApi } from './dashboard-api'
import type { DashboardCard, SupportEstimate } from './contracts'

type FetchMock = ReturnType<typeof vi.fn>

function asJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ESTIMATE: SupportEstimate = {
  likelySupport: 1200,
  districtSize: 5000,
  percentOfDistrict: 24,
  trendVsLastMonth: 1.5,
}

const CARD: DashboardCard = {
  id: 'card_1',
  type: 'briefing',
  title: 'Prepare for the council meeting',
  summary: 'Three items need your attention.',
  ctaLabel: 'Prepare for the meeting',
  ctaHref: '/dashboard/briefings/2026-06-20',
  dueDate: '2026-06-20T00:00:00.000Z',
  sourceBriefingId: 'b_1',
  sourceItemId: null,
  dismissedAt: null,
  createdAt: '2026-06-15T00:00:00.000Z',
  updatedAt: '2026-06-15T00:00:00.000Z',
}

describe('dashboardApi', () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('getSupportEstimate', () => {
    it('GETs the support-estimate endpoint and returns the estimate', async () => {
      fetchMock.mockResolvedValueOnce(asJsonResponse(200, ESTIMATE))

      const result = await dashboardApi.getSupportEstimate()

      expect(result).toEqual(ESTIMATE)
      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toBe('/api/v1/dashboard/support-estimate')
    })

    it('throws on a non-2xx response', async () => {
      fetchMock.mockResolvedValueOnce(asJsonResponse(500, {}))
      await expect(dashboardApi.getSupportEstimate()).rejects.toThrow(/500/)
    })
  })

  describe('getCards', () => {
    it('GETs the cards endpoint with the bucket query and unwraps the list', async () => {
      fetchMock.mockResolvedValueOnce(asJsonResponse(200, { cards: [CARD] }))

      const result = await dashboardApi.getCards('active')

      expect(result).toEqual([CARD])
      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toBe('/api/v1/dashboard/cards?bucket=active')
    })

    it('passes the requested bucket through to the query string', async () => {
      fetchMock.mockResolvedValueOnce(asJsonResponse(200, { cards: [] }))
      await dashboardApi.getCards('skipped')
      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toBe('/api/v1/dashboard/cards?bucket=skipped')
    })
  })

  describe('dismissCard', () => {
    it('PUTs to the dismiss endpoint for the given card id', async () => {
      fetchMock.mockResolvedValueOnce(asJsonResponse(200, {}))

      await expect(dashboardApi.dismissCard('card_1')).resolves.toBeUndefined()
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/v1/dashboard/cards/card_1/dismiss')
      expect(init.method).toBe('PUT')
    })

    it('throws on a non-2xx response', async () => {
      fetchMock.mockResolvedValueOnce(asJsonResponse(500, {}))
      await expect(dashboardApi.dismissCard('card_x')).rejects.toThrow(/500/)
    })
  })
})
