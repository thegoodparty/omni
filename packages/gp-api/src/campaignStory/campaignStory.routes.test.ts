import { useTestService } from '@/test-service'
import { Campaign } from '../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CampaignStoryRewriteService } from './services/campaignStoryRewrite.service'
import { CampaignStoryService } from './services/campaignStory.service'

const service = useTestService()

const STORY_URL = '/v1/campaigns/mine/story'
const REWRITE_URL = '/v1/campaigns/mine/story/rewrite'
const SAMPLE_BACKGROUND = 'Grew up here, ran a small business'
const REWRITE_TEXT = 'i care about schools'

describe('CampaignStory routes', () => {
  let campaign: Campaign
  let orgSlug: string
  let headers: { 'x-organization-slug': string }

  beforeEach(async () => {
    const suffix = Date.now()
    orgSlug = `campaign-${suffix}`
    headers = { 'x-organization-slug': orgSlug }
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `test-campaign-${suffix}`,
        organizationSlug: orgSlug,
      },
    })
  })

  describe('GET /campaigns/mine/story', () => {
    it('returns null fields when no story exists yet', async () => {
      const result = await service.client.get(STORY_URL, {
        headers,
      })

      expect(result.status).toBe(200)
      expect(result.data).toEqual({
        background: null,
      })
    })

    it('returns the saved story', async () => {
      await service.prisma.campaignStory.create({
        data: { campaignId: campaign.id, background: 'Grew up here' },
      })

      const result = await service.client.get(STORY_URL, {
        headers,
      })

      expect(result.data.background).toBe('Grew up here')
    })
  })

  describe('PUT /campaigns/mine/story', () => {
    it('creates the story on first write', async () => {
      const result = await service.client.put(
        STORY_URL,
        { background: SAMPLE_BACKGROUND },
        { headers },
      )

      expect(result.status).toBe(200)
      expect(result.data.background).toBe(SAMPLE_BACKGROUND)

      const row = await service.prisma.campaignStory.findUnique({
        where: { campaignId: campaign.id },
      })
      expect(row?.background).toBe(SAMPLE_BACKGROUND)
    })

    it('updates the background on an existing story', async () => {
      await service.prisma.campaignStory.create({
        data: { campaignId: campaign.id, background: 'Original background' },
      })

      const result = await service.client.put(
        STORY_URL,
        { background: 'Grew up here' },
        { headers },
      )

      expect(result.data.background).toBe('Grew up here')
    })

    it('strips unknown keys from the body', async () => {
      const result = await service.client.put(
        STORY_URL,
        { background: 'kept', sneaky: 'dropped' },
        { headers },
      )

      expect(result.data).toEqual({
        background: 'kept',
      })
    })

    it('rejects an empty body', async () => {
      const result = await service.client.put(STORY_URL, {}, { headers })

      expect(result.status).toBe(400)
    })

    it('trims whitespace-only input so it reads as empty', async () => {
      const result = await service.client.put(
        STORY_URL,
        { background: '   ' },
        { headers },
      )

      expect(result.data.background).toBe('')
    })
  })

  // The real rewrite calls Gemini, so the happy path spies on the service to
  // exercise the full HTTP pipeline (validation, controller name derivation,
  // ZodResponseInterceptor) without a live LLM call.
  describe('POST /campaigns/mine/story/rewrite', () => {
    it('returns the rewritten text on a valid request', async () => {
      const rewriteService = service.app.get(CampaignStoryRewriteService)
      const spy = vi
        .spyOn(rewriteService, 'rewrite')
        .mockResolvedValue({ rewrite: 'Polished text.' })

      const result = await service.client.post(
        REWRITE_URL,
        { field: 'why', text: REWRITE_TEXT },
        { headers },
      )

      expect(result.status).toBe(201)
      expect(result.data).toEqual({ rewrite: 'Polished text.' })
      expect(spy).toHaveBeenCalledWith(
        { field: 'why', text: REWRITE_TEXT },
        'Johnny Goodparty',
        campaign.id,
      )
      spy.mockRestore()
    })

    it('returns 403 once the lifetime rewrite limit is reached', async () => {
      await service.prisma.campaignStory.create({
        data: { campaignId: campaign.id, rewriteCount: 200 },
      })

      const result = await service.client.post(
        REWRITE_URL,
        { field: 'why', text: REWRITE_TEXT },
        { headers },
      )

      expect(result.status).toBe(403)
    })

    it('rejects an unknown field', async () => {
      const result = await service.client.post(
        REWRITE_URL,
        { field: 'slogan', text: 'something' },
        { headers },
      )

      expect(result.status).toBe(400)
    })

    it('rejects a missing field', async () => {
      const result = await service.client.post(
        REWRITE_URL,
        { text: 'something' },
        { headers },
      )

      expect(result.status).toBe(400)
    })

    it('rejects whitespace-only text', async () => {
      const result = await service.client.post(
        REWRITE_URL,
        { field: 'why', text: '   ' },
        { headers },
      )

      expect(result.status).toBe(400)
    })
  })

  // Exercises the real upsert + atomic increment (the rewrite happy path mocks
  // the service, so this is the only coverage of admitRewriteAttempt's lazy
  // row-create branch).
  describe('admitRewriteAttempt', () => {
    it('creates the story row and counts the first attempt', async () => {
      const stories = service.app.get(CampaignStoryService)

      const admitted = await stories.admitRewriteAttempt(campaign.id)

      expect(admitted).toBe(true)
      const row = await service.prisma.campaignStory.findUnique({
        where: { campaignId: campaign.id },
      })
      expect(row?.rewriteCount).toBe(1)
    })

    it('stops admitting once the lifetime cap is reached', async () => {
      await service.prisma.campaignStory.create({
        data: { campaignId: campaign.id, rewriteCount: 200 },
      })
      const stories = service.app.get(CampaignStoryService)

      expect(await stories.admitRewriteAttempt(campaign.id)).toBe(false)
    })
  })
})
