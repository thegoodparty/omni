import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { mswServer } from 'helpers/test-utils/api-mocking'
import {
  updateCampaign,
  getCampaign,
  createCampaignWithOffice,
  fetchCampaignVersions,
} from './ajaxActions'

describe('ajaxActions', () => {
  describe('updateCampaign', () => {
    it('returns the campaign object on 200', async () => {
      const campaign = { id: 1, slug: 'test-campaign' }
      mswServer.use(
        http.put('/api/v1/campaigns/mine', () => HttpResponse.json(campaign)),
      )

      const result = await updateCampaign({ key: 'name', value: 'Test' })

      expect(result).toEqual(campaign)
    })

    it('returns false on a 400 JSON error body', async () => {
      mswServer.use(
        http.put('/api/v1/campaigns/mine', () =>
          HttpResponse.json({ message: 'bad' }, { status: 400 }),
        ),
      )

      const result = await updateCampaign({ key: 'name', value: 'Test' })

      expect(result).toBe(false)
    })

    it('returns false on a 500', async () => {
      mswServer.use(
        http.put('/api/v1/campaigns/mine', () =>
          HttpResponse.json({ message: 'server error' }, { status: 500 }),
        ),
      )

      const result = await updateCampaign({ key: 'name', value: 'Test' })

      expect(result).toBe(false)
    })

    it('returns false on a network-level failure', async () => {
      mswServer.use(
        http.put('/api/v1/campaigns/mine', () => HttpResponse.error()),
      )

      const result = await updateCampaign({ key: 'name', value: 'Test' })

      expect(result).toBe(false)
    })
  })

  describe('createCampaignWithOffice', () => {
    it('returns false on a 400', async () => {
      mswServer.use(
        http.post('/api/v1/campaigns', () =>
          HttpResponse.json({ message: 'bad' }, { status: 400 }),
        ),
      )

      const result = await createCampaignWithOffice([
        { key: 'name', value: 'Test' },
      ])

      expect(result).toBe(false)
    })
  })

  describe('getCampaign', () => {
    it('returns false on a 404', async () => {
      mswServer.use(
        http.get('/api/v1/campaigns/mine', () =>
          HttpResponse.json({ message: 'not found' }, { status: 404 }),
        ),
      )

      const result = await getCampaign()

      expect(result).toBe(false)
    })
  })

  describe('fetchCampaignVersions', () => {
    it('returns false on a 500', async () => {
      mswServer.use(
        http.get('/api/v1/campaigns/mine/plan-version', () =>
          HttpResponse.json({ message: 'server error' }, { status: 500 }),
        ),
      )

      const result = await fetchCampaignVersions()

      expect(result).toBe(false)
    })

    it('returns false on a network-level failure', async () => {
      mswServer.use(
        http.get('/api/v1/campaigns/mine/plan-version', () =>
          HttpResponse.error(),
        ),
      )

      const result = await fetchCampaignVersions()

      expect(result).toBe(false)
    })
  })
})
