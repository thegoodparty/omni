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

describe('CampaignStoryIntakeService.patchAbout (via saveWhy)', () => {
  const buildService = (
    websites: WebsitesService,
  ): CampaignStoryIntakeService =>
    new CampaignStoryIntakeService(
      {} as CampaignStoryService,
      {} as CampaignStoryRewriteService,
      websites,
      {} as CampaignStrategyService,
      {
        client: {
          campaign: {
            findUniqueOrThrow: vi.fn(() =>
              Promise.resolve({ id: 42, user: { id: 1 } }),
            ),
          },
        },
      } as unknown as CampaignsService,
    )

  it('recovers from a concurrent-create P2002 by re-reading the website', async () => {
    // isPrismaError matches on name + code, so a tagged plain error suffices.
    const p2002 = Object.assign(new Error('duplicate'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    })
    const getContentForCampaign = vi
      .fn()
      .mockResolvedValueOnce(null) // first write: no site yet
      .mockResolvedValueOnce({}) // re-read after the create conflict
    const update = vi.fn(() => Promise.resolve())
    const websites = {
      getContentForCampaign,
      createByCampaign: vi.fn(() => Promise.reject(p2002)),
      update,
    } as unknown as WebsitesService

    await expect(
      buildService(websites).saveWhy(42, 'my why'),
    ).resolves.toBeUndefined()
    expect(getContentForCampaign).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenCalledOnce()
  })

  it('rethrows a non-P2002 create failure', async () => {
    const websites = {
      getContentForCampaign: vi.fn(() => Promise.resolve(null)),
      createByCampaign: vi.fn(() => Promise.reject(new Error('boom'))),
      update: vi.fn(() => Promise.resolve()),
    } as unknown as WebsitesService

    await expect(buildService(websites).saveWhy(42, 'my why')).rejects.toThrow(
      'boom',
    )
  })
})
