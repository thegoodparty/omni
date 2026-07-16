import { describe, expect, it } from 'vitest'
import { api } from 'helpers/test-utils/api-mocking'
import { dashboardApi } from './dashboard-api'
import type {
  DashboardCard,
  DashboardCardBucket,
  SupportEstimate,
} from './contracts'

const ESTIMATE: SupportEstimate = {
  likelySupport: 1200,
  districtSize: 5000,
  percentOfDistrict: 24,
}

const CARD: DashboardCard = {
  id: 'card_1',
  type: 'briefing',
  title: 'Prepare for the council meeting',
  summary: 'Three items need your attention.',
  ctaLabel: 'Prepare for the meeting',
  ctaHref: '/dashboard/briefings/2026-06-20',
  dueDate: '2026-06-20T00:00:00.000Z',
  sourceExternalId: 'b_1',
  sourceItemId: null,
  dismissedAt: null,
  createdAt: '2026-06-15T00:00:00.000Z',
  updatedAt: '2026-06-15T00:00:00.000Z',
}

describe('dashboardApi', () => {
  describe('getSupportEstimate', () => {
    it('GETs the support-estimate endpoint and returns the estimate', async () => {
      api.mock('GET /v1/elected-office/support-estimate', {
        status: 200,
        data: ESTIMATE,
      })

      expect(await dashboardApi.getSupportEstimate()).toEqual(ESTIMATE)
    })

    it('returns null when no estimate exists yet', async () => {
      api.mock('GET /v1/elected-office/support-estimate', {
        status: 200,
        data: null,
      })

      expect(await dashboardApi.getSupportEstimate()).toBeNull()
    })

    it('throws on a non-2xx response', async () => {
      api.mock('GET /v1/elected-office/support-estimate', {
        status: 500,
        data: {},
      })
      await expect(dashboardApi.getSupportEstimate()).rejects.toThrow(/500/)
    })
  })

  describe('getCards', () => {
    it('GETs the cards endpoint with the bucket query and unwraps the list', async () => {
      let capturedBucket: DashboardCardBucket | undefined
      api.mock('GET /v1/dashboard/cards', ({ query }) => {
        capturedBucket = query.bucket
        return { status: 200, data: { bucket: 'active', cards: [CARD] } }
      })

      expect(await dashboardApi.getCards('active')).toEqual([CARD])
      expect(capturedBucket).toBe('active')
    })

    it('passes the requested bucket through to the query string', async () => {
      let capturedBucket: DashboardCardBucket | undefined
      api.mock('GET /v1/dashboard/cards', ({ query }) => {
        capturedBucket = query.bucket
        return { status: 200, data: { bucket: 'skipped', cards: [] } }
      })

      await dashboardApi.getCards('skipped')
      expect(capturedBucket).toBe('skipped')
    })
  })

  describe('dismissCard', () => {
    it('PUTs to the dismiss endpoint for the given card id', async () => {
      let capturedId: string | undefined
      api.mock('PUT /v1/dashboard/cards/:id/dismiss', ({ params }) => {
        capturedId = params.id
        return { status: 200, data: undefined }
      })

      await expect(dashboardApi.dismissCard('card_1')).resolves.toBeUndefined()
      expect(capturedId).toBe('card_1')
    })

    it('throws on a non-2xx response', async () => {
      api.mock('PUT /v1/dashboard/cards/:id/dismiss', {
        status: 500,
        data: {},
      })
      await expect(dashboardApi.dismissCard('card_x')).rejects.toThrow(/500/)
    })
  })
})
