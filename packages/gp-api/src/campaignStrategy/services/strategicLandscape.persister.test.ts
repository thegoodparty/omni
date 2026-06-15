import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrategicLandscapePersister } from './strategicLandscape.persister'

describe('StrategicLandscapePersister', () => {
  let persister: StrategicLandscapePersister
  let tx: {
    campaignStrategy: { updateMany: ReturnType<typeof vi.fn> }
    campaignStrategyOpponent: Record<string, ReturnType<typeof vi.fn>>
    campaignStrategyOpportunity: Record<string, ReturnType<typeof vi.fn>>
    campaignStrategyChallenge: Record<string, ReturnType<typeof vi.fn>>
  }
  let warn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    persister = new StrategicLandscapePersister()
    tx = {
      campaignStrategy: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      campaignStrategyOpponent: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      campaignStrategyOpportunity: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      campaignStrategyChallenge: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    warn = vi.fn()
    Object.defineProperty(persister, '_prisma', {
      value: {
        $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) =>
          fn(tx),
        ),
      },
    })
    Object.assign(persister, { logger: { warn } })
  })

  it('persists opponents only after claiming the row on the generating race', async () => {
    await persister.persistOpponents(42, 'br-general', [
      { fullName: 'Rival', partyAffiliation: 'Nonpartisan', incumbent: true },
    ])

    // Accepts the run's race OR a still-unstamped legacy row — adoption
    // mid-flight doesn't invalidate a result generated for the same race.
    expect(tx.campaignStrategy.updateMany).toHaveBeenCalledWith({
      where: { id: 42, OR: [{ raceId: 'br-general' }, { raceId: null }] },
      data: { oppositionPersistedAt: expect.any(Date) },
    })
    expect(tx.campaignStrategyOpponent.createMany).toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('drops a stale opposition result when the row moved to another race', async () => {
    tx.campaignStrategy.updateMany.mockResolvedValue({ count: 0 })

    await persister.persistOpponents(42, 'br-stale', [
      { fullName: 'Rival', partyAffiliation: 'Nonpartisan', incumbent: true },
    ])

    expect(tx.campaignStrategyOpponent.deleteMany).not.toHaveBeenCalled()
    expect(tx.campaignStrategyOpponent.createMany).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('drops a stale opportunities result when the row moved to another race', async () => {
    tx.campaignStrategy.updateMany.mockResolvedValue({ count: 0 })

    await persister.persistOpportunitiesAndChallenges(
      42,
      'br-stale',
      ['o1'],
      ['c1'],
    )

    expect(tx.campaignStrategyOpportunity.deleteMany).not.toHaveBeenCalled()
    expect(tx.campaignStrategyChallenge.createMany).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('persists opportunities and challenges after claiming the row on the generating race', async () => {
    await persister.persistOpportunitiesAndChallenges(
      42,
      'br-general',
      ['o1'],
      ['c1'],
    )

    expect(tx.campaignStrategy.updateMany).toHaveBeenCalledWith({
      where: { id: 42, OR: [{ raceId: 'br-general' }, { raceId: null }] },
      data: { opportunitiesPersistedAt: expect.any(Date) },
    })
    expect(tx.campaignStrategyOpportunity.deleteMany).toHaveBeenCalled()
    expect(tx.campaignStrategyChallenge.deleteMany).toHaveBeenCalled()
    expect(tx.campaignStrategyOpportunity.createMany).toHaveBeenCalled()
    expect(tx.campaignStrategyChallenge.createMany).toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('claims unconditionally when the run carries no race', async () => {
    await persister.persistOpportunitiesAndChallenges(42, null, ['o1'], ['c1'])

    expect(tx.campaignStrategy.updateMany).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { opportunitiesPersistedAt: expect.any(Date) },
    })
    expect(tx.campaignStrategyOpportunity.deleteMany).toHaveBeenCalled()
    expect(tx.campaignStrategyChallenge.deleteMany).toHaveBeenCalled()
    expect(tx.campaignStrategyOpportunity.createMany).toHaveBeenCalled()
    expect(tx.campaignStrategyChallenge.createMany).toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })
})
