import { describe, expect, it, vi } from 'vitest'
import type { CampaignStoryService } from '@/campaignStory/services/campaignStory.service'
import type { CampaignStoryRewriteService } from '@/campaignStory/services/campaignStoryRewrite.service'
import type { WebsitesService } from '@/websites/services/websites.service'
import type { CampaignStrategyService } from '@/campaignStrategy/services/campaignStrategy.service'
import type { CampaignsService } from '@/campaigns/services/campaigns.service'
import { CampaignStoryIntakeService } from './campaignStoryIntake.service'

describe('CampaignStoryIntakeService.generate', () => {
  // Sources that make read() report a complete story (why + background +
  // one position), so generate proceeds past the completeness gate.
  const completeSources = () => ({
    stories: {
      getForCampaign: vi.fn(() => Promise.resolve({ background: 'b' })),
    } as unknown as CampaignStoryService,
    websites: {
      getBioForCampaign: vi.fn(() => Promise.resolve('my why')),
      getIssuesForCampaign: vi.fn(() =>
        Promise.resolve([{ title: 't', description: 'd' }]),
      ),
    } as unknown as WebsitesService,
  })

  it('returns incomplete without dispatching when the story is unfinished', async () => {
    const strategy = {
      getOrGenerateStrategicLandscape: vi.fn(),
    } as unknown as CampaignStrategyService
    const service = new CampaignStoryIntakeService(
      {
        getForCampaign: vi.fn(() => Promise.resolve({ background: null })),
      } as unknown as CampaignStoryService,
      {} as CampaignStoryRewriteService,
      {
        getBioForCampaign: vi.fn(() => Promise.resolve(null)),
        getIssuesForCampaign: vi.fn(() => Promise.resolve([])),
      } as unknown as WebsitesService,
      strategy,
      {} as CampaignsService,
    )

    await expect(service.generate(42)).resolves.toEqual({
      status: 'incomplete',
    })
    expect(strategy.getOrGenerateStrategicLandscape).not.toHaveBeenCalled()
  })

  it('throws when the campaign is gone rather than returning an opaque status', async () => {
    const { stories, websites } = completeSources()
    const campaigns = {
      client: { campaign: { findUnique: vi.fn(() => Promise.resolve(null)) } },
    } as unknown as CampaignsService
    const strategy = {
      getOrGenerateStrategicLandscape: vi.fn(),
    } as unknown as CampaignStrategyService
    const service = new CampaignStoryIntakeService(
      stories,
      {} as CampaignStoryRewriteService,
      websites,
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

  it('serializes concurrent about writes so neither field is lost', async () => {
    // Mutable store: getContent returns the latest, update replaces it. Without
    // serialization both saves read the same empty snapshot and the second
    // update drops the first field.
    let stored: { about?: { bio?: string; issues?: unknown[] } } = { about: {} }
    const websites = {
      getContentForCampaign: vi.fn(() => Promise.resolve(stored)),
      createByCampaign: vi.fn(),
      update: vi.fn((args: { data: { content: typeof stored } }) => {
        stored = args.data.content
        return Promise.resolve()
      }),
    } as unknown as WebsitesService
    const service = buildService(websites)

    await Promise.all([
      service.saveWhy(42, 'my why'),
      service.savePositions(42, [{ title: 'Schools', description: 'Fund' }]),
    ])

    expect(stored.about?.bio).toBe('my why')
    expect(stored.about?.issues).toEqual([
      { title: 'Schools', description: 'Fund' },
    ])
  })
})
