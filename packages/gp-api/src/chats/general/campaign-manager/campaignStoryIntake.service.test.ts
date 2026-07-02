import { describe, expect, it, vi } from 'vitest'
import type { CampaignStoryService } from '@/campaignStory/services/campaignStory.service'
import type { CampaignStoryRewriteService } from '@/campaignStory/services/campaignStoryRewrite.service'
import type { WebsitesService } from '@/websites/services/websites.service'
import type { CampaignStrategyService } from '@/campaignStrategy/services/campaignStrategy.service'
import type { CampaignsService } from '@/campaigns/services/campaigns.service'
import { CampaignStoryIntakeService } from './campaignStoryIntake.service'

describe('CampaignStoryIntakeService.generate', () => {
  it('throws when the campaign is gone rather than returning an opaque status', async () => {
    const campaigns = {
      client: { campaign: { findUnique: vi.fn(() => Promise.resolve(null)) } },
    } as unknown as CampaignsService
    const strategy = {
      getOrGenerateStrategicLandscape: vi.fn(),
    } as unknown as CampaignStrategyService
    const service = new CampaignStoryIntakeService(
      {} as CampaignStoryService,
      {} as CampaignStoryRewriteService,
      {} as WebsitesService,
      strategy,
      campaigns,
    )

    await expect(service.generate(42)).rejects.toThrow('not found')
    expect(strategy.getOrGenerateStrategicLandscape).not.toHaveBeenCalled()
  })
})
