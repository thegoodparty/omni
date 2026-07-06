import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { FeaturesService } from '@/features/services/features.service'
import { ExperimentRunStatus } from '@/generated/prisma'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { RACE_OPPONENT_COLLECTION } from '../raceOpponent.constants'
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

// The relaxed path runs two agentic steps — race_opponent_collection then
// race_opponent_summary. GET's collectionStatus must not report 'completed'
// (which drops the page off the processing screen and flashes the raw collected
// rows) while the chained summary is still in flight (ENG-10614).
describe('RaceOpponentService.get collectionStatus (collection → summary)', () => {
  const features = { isFeatureEnabled: vi.fn() }
  const COLLECTED_AT = new Date('2026-06-30T10:00:00.000Z')
  const SUMMARY_AFTER = new Date('2026-06-30T10:05:00.000Z')
  const SUMMARY_STALE = new Date('2026-06-30T09:55:00.000Z')
  const COLLECTION_RUN_ID = 'collection-run'

  const campaign = {
    id: 42,
    organizationSlug: 'org-42',
    isPro: true,
    user: { id: 7, clerkId: 'user_abc' },
  } as unknown as CampaignWith<'user'>

  const collectedRow = {
    id: 1,
    campaignId: 42,
    runId: COLLECTION_RUN_ID,
    opponentName: 'Jane Doe',
    sourceType: 'ballotpedia',
    sourceUrl: 'https://ballotpedia.org/Jane_Doe',
    content: { text: 'raw collected text' },
    createdAt: COLLECTED_AT,
  }

  // Wire GET's prisma reads by hand (direct instantiation skips onModuleInit).
  // experimentRun.findFirst branches on experimentType so the collection and
  // summary lookups return their own configured run.
  const setup = ({
    collectionRun,
    summaryRun,
    rows = [],
  }: {
    collectionRun: {
      runId: string
      status: ExperimentRunStatus
      createdAt: Date
    } | null
    summaryRun: { status: ExperimentRunStatus; createdAt: Date } | null
    rows?: (typeof collectedRow)[]
  }): RaceOpponentService => {
    const service = new RaceOpponentService(
      features as unknown as FeaturesService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )
    Object.defineProperty(service, '_prisma', {
      value: {
        raceOpponent: {
          findMany: vi.fn().mockResolvedValue(rows),
          // Respect a runId filter so postCollectionStatus's "rows from THIS
          // collection run" check is exercised, not stubbed past.
          count: vi.fn(
            ({ where }: { where: { runId?: string } }): Promise<number> =>
              Promise.resolve(
                where.runId === undefined
                  ? rows.length
                  : rows.filter((row) => row.runId === where.runId).length,
              ),
          ),
        },
        campaignStrategy: { findUnique: vi.fn().mockResolvedValue(null) },
        raceOpponentSummary: { findMany: vi.fn().mockResolvedValue([]) },
        raceOpponentFieldAnalysis: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        experimentRun: {
          findFirst: vi.fn(({ where }: { where: { experimentType: string } }) =>
            Promise.resolve(
              where.experimentType === RACE_OPPONENT_COLLECTION
                ? collectionRun
                : summaryRun,
            ),
          ),
          findUnique: vi.fn().mockResolvedValue(null),
        },
      },
      writable: true,
    })
    Object.defineProperty(service, 'logger', {
      value: createMockLogger(),
      writable: true,
    })
    return service
  }

  beforeEach(() => {
    vi.clearAllMocks()
    features.isFeatureEnabled.mockResolvedValue(true)
  })

  it("reports 'running' while the chained summary run is still in flight", async () => {
    const service = setup({
      collectionRun: {
        runId: COLLECTION_RUN_ID,
        status: ExperimentRunStatus.COMPLETED,
        createdAt: COLLECTED_AT,
      },
      summaryRun: {
        status: ExperimentRunStatus.RUNNING,
        createdAt: SUMMARY_AFTER,
      },
      rows: [collectedRow],
    })

    const { collectionStatus } = await service.get(campaign)

    expect(collectionStatus).toBe('running')
  })

  it("reports 'completed' once the summary run has completed", async () => {
    const service = setup({
      collectionRun: {
        runId: COLLECTION_RUN_ID,
        status: ExperimentRunStatus.COMPLETED,
        createdAt: COLLECTED_AT,
      },
      summaryRun: {
        status: ExperimentRunStatus.COMPLETED,
        createdAt: SUMMARY_AFTER,
      },
      rows: [collectedRow],
    })

    const { collectionStatus } = await service.get(campaign)

    expect(collectionStatus).toBe('completed')
  })

  it("degrades to 'completed' when the summary run failed (shows raw rows)", async () => {
    const service = setup({
      collectionRun: {
        runId: COLLECTION_RUN_ID,
        status: ExperimentRunStatus.COMPLETED,
        createdAt: COLLECTED_AT,
      },
      summaryRun: {
        status: ExperimentRunStatus.FAILED,
        createdAt: SUMMARY_AFTER,
      },
      rows: [collectedRow],
    })

    const { collectionStatus } = await service.get(campaign)

    expect(collectionStatus).toBe('completed')
  })

  it("reports 'running' after collection when rows exist but no summary run has been created yet", async () => {
    const service = setup({
      collectionRun: {
        runId: COLLECTION_RUN_ID,
        status: ExperimentRunStatus.COMPLETED,
        createdAt: COLLECTED_AT,
      },
      summaryRun: null,
      rows: [collectedRow],
    })

    const { collectionStatus } = await service.get(campaign)

    expect(collectionStatus).toBe('running')
  })

  it("reports 'completed' for an empty collection (no rows, no summary to await)", async () => {
    const service = setup({
      collectionRun: {
        runId: COLLECTION_RUN_ID,
        status: ExperimentRunStatus.COMPLETED,
        createdAt: COLLECTED_AT,
      },
      summaryRun: null,
      rows: [],
    })

    const { collectionStatus } = await service.get(campaign)

    expect(collectionStatus).toBe('completed')
  })

  it("reports 'completed' when an empty re-collection preserved a prior cycle's rows", async () => {
    const service = setup({
      // The empty re-collection is the latest completed collection; its early
      // return preserved the PRIOR cycle's rows (which carry the prior run's id)
      // and dispatched no summary. Since none of the preserved rows carry this
      // empty run's id, no summary is coming for it — settle, don't strand. This
      // also covers the prior-summary-FAILED sub-case: the preserved rows are
      // still from an earlier run regardless of whether that cycle's summary
      // ever landed.
      collectionRun: {
        runId: 'empty-recollection-run',
        status: ExperimentRunStatus.COMPLETED,
        createdAt: SUMMARY_AFTER,
      },
      summaryRun: {
        status: ExperimentRunStatus.COMPLETED,
        createdAt: SUMMARY_STALE,
      },
      rows: [collectedRow],
    })

    const { collectionStatus } = await service.get(campaign)

    expect(collectionStatus).toBe('completed')
  })

  it("reports 'running' when only a stale prior-cycle summary run exists", async () => {
    const service = setup({
      collectionRun: {
        runId: COLLECTION_RUN_ID,
        status: ExperimentRunStatus.COMPLETED,
        createdAt: COLLECTED_AT,
      },
      // A COMPLETED summary from before this collection ran — its rows were
      // replaced, so it must not mask the current cycle's pending summary.
      summaryRun: {
        status: ExperimentRunStatus.COMPLETED,
        createdAt: SUMMARY_STALE,
      },
      rows: [collectedRow],
    })

    const { collectionStatus } = await service.get(campaign)

    expect(collectionStatus).toBe('running')
  })

  it("still reports 'running' while the collection run itself is in flight", async () => {
    const service = setup({
      collectionRun: {
        runId: COLLECTION_RUN_ID,
        status: ExperimentRunStatus.RUNNING,
        createdAt: COLLECTED_AT,
      },
      summaryRun: null,
    })

    const { collectionStatus } = await service.get(campaign)

    expect(collectionStatus).toBe('running')
  })
})

// A summary run completing must re-chain a fresh summary when an overlapping
// re-collection landed newer rows while it was in flight (dispatchSummary's
// in-flight dedup skipped them), or collectionStatus would trap on 'running'
// forever (ENG-10614).
describe('RaceOpponentService.rechainSummaryForNewerCollection', () => {
  const features = { isFeatureEnabled: vi.fn() }
  const SUMMARY_RUN_AT = new Date('2026-06-30T10:00:00.000Z')
  const COLLECTION_NEWER = new Date('2026-06-30T10:03:00.000Z')
  const COLLECTION_OLDER = new Date('2026-06-30T09:57:00.000Z')

  const campaign = {
    id: 42,
    organizationSlug: 'org-42',
    isPro: true,
    user: { id: 7, clerkId: 'user_abc' },
  } as unknown as CampaignWith<'user'>

  const setup = (
    latestCompletedCollection: { createdAt: Date } | null,
  ): RaceOpponentService => {
    const service = new RaceOpponentService(
      features as unknown as FeaturesService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )
    Object.defineProperty(service, '_prisma', {
      value: {
        experimentRun: {
          findFirst: vi.fn().mockResolvedValue(latestCompletedCollection),
        },
      },
      writable: true,
    })
    Object.defineProperty(service, 'logger', {
      value: createMockLogger(),
      writable: true,
    })
    service.dispatchSummary = vi.fn().mockResolvedValue(undefined)
    return service
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('re-dispatches a summary when a completed collection is newer than the summary run', async () => {
    const service = setup({ createdAt: COLLECTION_NEWER })

    await service.rechainSummaryForNewerCollection(campaign, SUMMARY_RUN_AT)

    expect(service.dispatchSummary).toHaveBeenCalledExactlyOnceWith(campaign)
  })

  it('does not re-dispatch on the normal cycle (the completed collection pre-dates its own summary run)', async () => {
    const service = setup({ createdAt: COLLECTION_OLDER })

    await service.rechainSummaryForNewerCollection(campaign, SUMMARY_RUN_AT)

    expect(service.dispatchSummary).not.toHaveBeenCalled()
  })

  it('does not re-dispatch when no completed collection run exists', async () => {
    const service = setup(null)

    await service.rechainSummaryForNewerCollection(campaign, SUMMARY_RUN_AT)

    expect(service.dispatchSummary).not.toHaveBeenCalled()
  })
})

// The same deferred-chain problem one link later: an actions run completing
// must re-chain when a summary newer than it completed while it was in flight
// (dispatchActions' in-flight dedup skipped that summary's chained dispatch).
describe('RaceOpponentService.rechainActionsForNewerSummary', () => {
  const features = { isFeatureEnabled: vi.fn() }
  const ACTIONS_RUN_AT = new Date('2026-07-01T10:00:00.000Z')
  const SUMMARY_NEWER = new Date('2026-07-01T10:03:00.000Z')
  const SUMMARY_OLDER = new Date('2026-07-01T09:57:00.000Z')

  const campaign = {
    id: 42,
    organizationSlug: 'org-42',
    isPro: true,
    user: { id: 7, clerkId: 'user_abc' },
  } as unknown as CampaignWith<'user'>

  const setup = (
    latestCompletedSummary: { createdAt: Date } | null,
  ): RaceOpponentService => {
    const service = new RaceOpponentService(
      features as unknown as FeaturesService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )
    Object.defineProperty(service, '_prisma', {
      value: {
        experimentRun: {
          findFirst: vi.fn().mockResolvedValue(latestCompletedSummary),
        },
      },
      writable: true,
    })
    Object.defineProperty(service, 'logger', {
      value: createMockLogger(),
      writable: true,
    })
    service.dispatchActions = vi.fn().mockResolvedValue(undefined)
    return service
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('re-dispatches actions when a completed summary is newer than the actions run', async () => {
    const service = setup({ createdAt: SUMMARY_NEWER })

    await service.rechainActionsForNewerSummary(campaign, ACTIONS_RUN_AT)

    expect(service.dispatchActions).toHaveBeenCalledExactlyOnceWith(campaign)
  })

  it('does not re-dispatch on the normal cycle (the completed summary pre-dates its own actions run)', async () => {
    const service = setup({ createdAt: SUMMARY_OLDER })

    await service.rechainActionsForNewerSummary(campaign, ACTIONS_RUN_AT)

    expect(service.dispatchActions).not.toHaveBeenCalled()
  })

  it('does not re-dispatch when no completed summary run exists', async () => {
    const service = setup(null)

    await service.rechainActionsForNewerSummary(campaign, ACTIONS_RUN_AT)

    expect(service.dispatchActions).not.toHaveBeenCalled()
  })
})
