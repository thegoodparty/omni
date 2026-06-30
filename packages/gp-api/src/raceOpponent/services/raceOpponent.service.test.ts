import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { FeaturesService } from '@/features/services/features.service'
import { RaceOpponentService } from './raceOpponent.service'

describe('RaceOpponentService.autoCollectOnProUpgrade', () => {
  let service: RaceOpponentService
  const features = { isFeatureEnabled: vi.fn() }
  const findUnique = vi.fn()

  const proCampaignWithUser = {
    id: 42,
    isPro: true,
    user: { id: 7, clerkId: 'user_abc' },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    service = new RaceOpponentService(
      features as unknown as FeaturesService,
      {} as never,
      {} as never,
      {} as never,
    )
    // PrismaBase exposes `client` via a getter over the injected `_prisma`;
    // direct instantiation skips onModuleInit, so wire the campaign delegate
    // and logger the entry method touches by hand.
    Object.defineProperty(service, '_prisma', {
      value: { campaign: { findUnique } },
      writable: true,
    })
    Object.defineProperty(service, 'logger', {
      value: createMockLogger(),
      writable: true,
    })
    service.collect = vi
      .fn()
      .mockResolvedValue({ runId: 'r1', status: 'running' })
    findUnique.mockResolvedValue(proCampaignWithUser)
    features.isFeatureEnabled.mockResolvedValue(true)
  })

  it('collects when the campaign is Pro, has a user, and the flag is on', async () => {
    await service.autoCollectOnProUpgrade(42)

    expect(features.isFeatureEnabled).toHaveBeenCalledWith({
      user: proCampaignWithUser.user,
      feature: 'win-know-your-opponent',
    })
    expect(service.collect).toHaveBeenCalledExactlyOnceWith(proCampaignWithUser)
  })

  it('skips silently when the flag is off — no collect, no flag-off throw', async () => {
    features.isFeatureEnabled.mockResolvedValue(false)

    await expect(service.autoCollectOnProUpgrade(42)).resolves.toBeUndefined()

    expect(service.collect).not.toHaveBeenCalled()
  })

  it('skips when the campaign is not Pro, without evaluating the flag', async () => {
    findUnique.mockResolvedValue({ ...proCampaignWithUser, isPro: false })

    await service.autoCollectOnProUpgrade(42)

    expect(features.isFeatureEnabled).not.toHaveBeenCalled()
    expect(service.collect).not.toHaveBeenCalled()
  })

  it('skips when the campaign has no associated user', async () => {
    findUnique.mockResolvedValue({ ...proCampaignWithUser, user: null })

    await service.autoCollectOnProUpgrade(42)

    expect(features.isFeatureEnabled).not.toHaveBeenCalled()
    expect(service.collect).not.toHaveBeenCalled()
  })
})
