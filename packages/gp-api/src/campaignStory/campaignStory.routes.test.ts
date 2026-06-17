import { useTestService } from '@/test-service'
import { Campaign } from '../generated/prisma'
import { beforeEach, describe, expect, it } from 'vitest'

const service = useTestService()

const STORY_URL = '/v1/campaigns/mine/story'
const SAMPLE_WHY = 'Because nobody else would'

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
        why: null,
        background: null,
        issues: null,
      })
    })

    it('returns the saved story', async () => {
      await service.prisma.campaignStory.create({
        data: { campaignId: campaign.id, why: 'I saw a gap' },
      })

      const result = await service.client.get(STORY_URL, {
        headers,
      })

      expect(result.data.why).toBe('I saw a gap')
      expect(result.data.background).toBeNull()
    })
  })

  describe('PUT /campaigns/mine/story', () => {
    it('creates the story on first write', async () => {
      const result = await service.client.put(
        STORY_URL,
        { why: SAMPLE_WHY },
        { headers },
      )

      expect(result.status).toBe(200)
      expect(result.data.why).toBe(SAMPLE_WHY)

      const row = await service.prisma.campaignStory.findUnique({
        where: { campaignId: campaign.id },
      })
      expect(row?.why).toBe(SAMPLE_WHY)
    })

    it('updates only the provided field, leaving others intact', async () => {
      await service.prisma.campaignStory.create({
        data: { campaignId: campaign.id, why: 'Original why' },
      })

      const result = await service.client.put(
        STORY_URL,
        { background: 'Grew up here' },
        { headers },
      )

      expect(result.data.why).toBe('Original why')
      expect(result.data.background).toBe('Grew up here')
    })

    it('strips unknown keys from the body', async () => {
      const result = await service.client.put(
        STORY_URL,
        { why: 'kept', sneaky: 'dropped' },
        { headers },
      )

      expect(result.data).toEqual({
        why: 'kept',
        background: null,
        issues: null,
      })
    })
  })
})
