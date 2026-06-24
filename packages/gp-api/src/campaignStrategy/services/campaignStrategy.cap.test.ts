import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common'
import { ExperimentRunStatus } from '../../generated/prisma'
import { CampaignStrategyService } from './campaignStrategy.service'
import { ElectionApiRaceNotFoundError } from './electionApi.service'

const campaign = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 99,
    organizationSlug: 'org-99',
    details: { raceId: 'br-general' },
    user: {
      clerkId: 'clerk-1',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      name: null,
    },
    ...overrides,
  }) as never

const run = (overrides: Record<string, unknown> = {}) =>
  ({
    runId: 'run-x',
    organizationSlug: 'org-99',
    experimentType: 'opposition_research',
    status: ExperimentRunStatus.COMPLETED,
    params: { race_id: 'br-general' },
    artifactBucket: 'bucket',
    artifactKey: 'key',
    durationSeconds: null,
    costUsd: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as never

describe('CampaignStrategyService', () => {
  let service: CampaignStrategyService
  let params: { build: ReturnType<typeof vi.fn> }
  let experimentRuns: {
    findUnique: ReturnType<typeof vi.fn>
    dispatchRun: ReturnType<typeof vi.fn>
    markFailed: ReturnType<typeof vi.fn>
  }
  let persister: {
    persistOpponents: ReturnType<typeof vi.fn>
    persistOpportunitiesAndChallenges: ReturnType<typeof vi.fn>
  }
  let s3: { getFile: ReturnType<typeof vi.fn> }
  let analytics: { track: ReturnType<typeof vi.fn> }
  let prisma: {
    campaignStrategy: Record<string, ReturnType<typeof vi.fn>>
    campaignStrategyOpportunity: Record<string, ReturnType<typeof vi.fn>>
    campaignStrategyChallenge: Record<string, ReturnType<typeof vi.fn>>
    campaignStrategyOpponent: Record<string, ReturnType<typeof vi.fn>>
    campaign: Record<string, ReturnType<typeof vi.fn>>
    $transaction: ReturnType<typeof vi.fn>
  }

  const planRow = (overrides: Record<string, unknown> = {}) => ({
    id: 42,
    campaignId: 99,
    oppositionRunId: null,
    opportunitiesRunId: null,
    oppositionAttempts: 0,
    opportunitiesAttempts: 0,
    raceId: 'br-general',
    previousRaceIds: [],
    ...overrides,
  })

  beforeEach(() => {
    params = { build: vi.fn().mockResolvedValue({ race_id: 'br-general' }) }
    experimentRuns = {
      findUnique: vi.fn().mockResolvedValue(null),
      dispatchRun: vi.fn(),
      markFailed: vi.fn().mockResolvedValue(undefined),
    }
    persister = {
      persistOpponents: vi.fn().mockResolvedValue(undefined),
      persistOpportunitiesAndChallenges: vi.fn().mockResolvedValue(undefined),
    }
    s3 = { getFile: vi.fn() }
    analytics = { track: vi.fn().mockResolvedValue(undefined) }
    prisma = {
      campaignStrategy: {
        upsert: vi.fn().mockResolvedValue(planRow()),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn().mockResolvedValue(planRow()),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue(planRow()),
      },
      campaignStrategyOpportunity: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      campaignStrategyChallenge: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      campaignStrategyOpponent: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      campaign: {
        findUnique: vi.fn().mockResolvedValue({ userId: 7 }),
      },
      // Supports both the array form and the interactive (callback) form,
      // handing the same mock delegates in as the tx client.
      $transaction: vi.fn(
        async (
          arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>),
        ) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)),
      ),
    }
    // The last three deps (communityEvents, electionApi, races) belong to the
    // community-events pipeline and are never touched by the CAP strategic-
    // landscape paths exercised here, so no-op mocks suffice. Community-events
    // behavior is covered in campaignStrategy.service.test.ts.
    service = new CampaignStrategyService(
      params as never,
      experimentRuns as never,
      persister as never,
      s3 as never,
      { generate: vi.fn() } as never,
      { getRaceContext: vi.fn() } as never,
      { getZipCodesByRaceId: vi.fn() } as never,
      analytics as never,
      { bootstrapForCampaign: vi.fn() } as never,
    )
    Object.defineProperty(service, '_prisma', { value: prisma })
    Object.assign(service, {
      findFirst: prisma.campaignStrategy.findFirst,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    })
  })

  it('rejects a campaign with no raceId', async () => {
    await expect(
      service.getOrGenerateStrategicLandscape(campaign({ details: {} })),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  const testUserCampaign = (overrides: Record<string, unknown> = {}) =>
    campaign({
      user: {
        clerkId: 'clerk-1',
        email: 'jane@test.goodparty.org',
        firstName: 'Jane',
        lastName: 'Doe',
        name: null,
      },
      ...overrides,
    })

  it('returns ready-empty for a test-user strategic landscape, no dispatch', async () => {
    const res =
      await service.getOrGenerateStrategicLandscape(testUserCampaign())
    expect(res).toEqual({
      status: 'ready',
      data: { opportunities: [], challenges: [], opponents: [] },
    })
    expect(experimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('returns ready-empty for a test user even with no raceId (guard runs before the no-raceId check)', async () => {
    const res = await service.getOrGenerateStrategicLandscape(
      testUserCampaign({ details: {} }),
    )
    expect(res).toEqual({
      status: 'ready',
      data: { opportunities: [], challenges: [], opponents: [] },
    })
    expect(experimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('returns ready-empty for test-user community events, no generate', async () => {
    const res = await service.getOrGenerateCommunityEvents(testUserCampaign())
    expect(res).toEqual({ status: 'ready', data: { events: [] } })
    expect(experimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('resolves the raceId even when an unrelated details field is off-shape', async () => {
    // Regression: officeTermLength is a string per the details contract
    // ("4 years", written by the campaign-details editor), and a strict
    // whole-object parse failure used to make a present raceId look
    // missing — a bogus 400 that blocked regeneration after a race edit.
    experimentRuns.dispatchRun
      .mockResolvedValueOnce({ runId: 'opp-run' })
      .mockResolvedValueOnce({ runId: 'oc-run' })

    const res = await service.getOrGenerateStrategicLandscape(
      campaign({
        details: { raceId: 'br-general', officeTermLength: '4 years' },
      }),
    )

    expect(res).toEqual({ status: 'generating' })
  })

  it('dispatches both experiments and stores run ids when none exist', async () => {
    experimentRuns.dispatchRun
      .mockResolvedValueOnce({ runId: 'opp-run' })
      .mockResolvedValueOnce({ runId: 'oc-run' })

    const res = await service.getOrGenerateStrategicLandscape(campaign())

    expect(res).toEqual({ status: 'generating' })
    expect(params.build).toHaveBeenCalledTimes(1)
    expect(experimentRuns.dispatchRun).toHaveBeenCalledTimes(2)
    const types = experimentRuns.dispatchRun.mock.calls.map((c) => c[0].type)
    expect(types.sort()).toEqual([
      'opportunities_and_challenges',
      'opposition_research',
    ])
    // both dispatches carry the resolved org slug, clerk id, and built params
    for (const type of [
      'opposition_research',
      'opportunities_and_challenges',
    ]) {
      expect(experimentRuns.dispatchRun).toHaveBeenCalledWith(
        expect.objectContaining({
          type,
          organizationSlug: 'org-99',
          clerkUserId: 'clerk-1',
          params: { race_id: 'br-general' },
        }),
      )
    }
    // A from-idle start also stamps generationStartedAt (the duration anchor).
    expect(prisma.campaignStrategy.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        oppositionRunId: 'opp-run',
        generationStartedAt: expect.any(Date),
      },
    })
    expect(prisma.campaignStrategy.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        opportunitiesRunId: 'oc-run',
        generationStartedAt: expect.any(Date),
      },
    })
  })

  it('reports failed (not generating) when NO dispatch produces a run', async () => {
    experimentRuns.dispatchRun.mockResolvedValue(undefined) // no queue configured

    const res = await service.getOrGenerateStrategicLandscape(campaign())

    expect(res).toEqual({ status: 'failed' })
    expect(prisma.campaignStrategy.update).not.toHaveBeenCalled()
  })

  it('stays generating on a partial dispatch (one run created), no failed flip', async () => {
    // opposition dispatches, opportunities send fails -> keep the one that
    // worked and report generating; the other retries next poll.
    experimentRuns.dispatchRun
      .mockResolvedValueOnce({ runId: 'opp-run' })
      .mockResolvedValueOnce(undefined)

    const res = await service.getOrGenerateStrategicLandscape(campaign())

    expect(res).toEqual({ status: 'generating' })
    expect(prisma.campaignStrategy.update).toHaveBeenCalledTimes(1)
    expect(prisma.campaignStrategy.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        oppositionRunId: 'opp-run',
        generationStartedAt: expect.any(Date),
      },
    })
  })

  it('throws when the user has no clerkId', async () => {
    await expect(
      service.getOrGenerateStrategicLandscape(
        campaign({
          user: {
            clerkId: null,
            email: 'j@e.com',
            firstName: 'J',
            lastName: 'D',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(experimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('returns ready with mapped data once both sections are persisted', async () => {
    prisma.campaignStrategy.upsert.mockResolvedValue(
      planRow({
        oppositionRunId: 'opp-run',
        opportunitiesRunId: 'oc-run',
        oppositionPersistedAt: new Date(),
        opportunitiesPersistedAt: new Date(),
      }),
    )
    prisma.campaignStrategy.findUnique.mockResolvedValue({
      opportunities: [{ content: 'o1' }],
      challenges: [{ content: 'c1' }],
      opponents: [
        {
          fullName: 'Rival',
          partyAffiliation: 'Nonpartisan',
          incumbent: false,
        },
      ],
    })

    const res = await service.getOrGenerateStrategicLandscape(campaign())

    expect(res).toEqual({
      status: 'ready',
      data: {
        opportunities: ['o1'],
        challenges: ['c1'],
        opponents: [
          {
            fullName: 'Rival',
            partyAffiliation: 'Nonpartisan',
            incumbent: false,
          },
        ],
      },
    })
    expect(experimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('stays generating when a run is COMPLETED but its section is not persisted', async () => {
    // The race window: both runs done, but only one section's rows have landed.
    prisma.campaignStrategy.upsert.mockResolvedValue(
      planRow({
        oppositionRunId: 'opp-run',
        opportunitiesRunId: 'oc-run',
        oppositionPersistedAt: new Date(),
        opportunitiesPersistedAt: null,
      }),
    )
    const runsById: Record<string, unknown> = {
      'opp-run': run({ runId: 'opp-run' }),
      'oc-run': run({
        runId: 'oc-run',
        experimentType: 'opportunities_and_challenges',
      }),
    }
    experimentRuns.findUnique.mockImplementation(
      (args: { where: { runId: string } }) =>
        Promise.resolve(runsById[args.where.runId] ?? null),
    )

    const res = await service.getOrGenerateStrategicLandscape(campaign())

    expect(res).toEqual({ status: 'generating' })
    expect(experimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('re-dispatches a COMPLETED-but-unpersisted section past the grace window', async () => {
    // markFailed + persist both failed: run stuck COMPLETED with no marker.
    // Instead of terminal-failing, the section re-dispatches on this call.
    const stale = new Date(Date.now() - 30 * 60 * 1000) // 30 min ago
    prisma.campaignStrategy.upsert.mockResolvedValue(
      planRow({
        oppositionRunId: 'opp-run',
        opportunitiesRunId: 'oc-run',
        oppositionPersistedAt: null,
        opportunitiesPersistedAt: new Date(),
      }),
    )
    const runsById: Record<string, unknown> = {
      'opp-run': run({ runId: 'opp-run', updatedAt: stale }),
      'oc-run': run({
        runId: 'oc-run',
        experimentType: 'opportunities_and_challenges',
      }),
    }
    experimentRuns.findUnique.mockImplementation(
      (args: { where: { runId: string } }) =>
        Promise.resolve(runsById[args.where.runId] ?? null),
    )
    experimentRuns.dispatchRun.mockResolvedValue({ runId: 'opp-retry' })

    const res = await service.getOrGenerateStrategicLandscape(campaign())

    expect(res).toEqual({ status: 'generating' })
    expect(experimentRuns.dispatchRun).toHaveBeenCalledTimes(1)
    expect(experimentRuns.dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'opposition_research' }),
    )
    // Nothing else was in flight (opportunities already persisted), so this
    // retry is a fresh start and re-stamps the duration anchor.
    expect(prisma.campaignStrategy.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        oppositionRunId: 'opp-retry',
        generationStartedAt: expect.any(Date),
      },
    })
  })

  it('reports failed (not 502) when an SQS dispatch throws', async () => {
    experimentRuns.dispatchRun.mockRejectedValue(new Error('sqs unavailable'))

    const res = await service.getOrGenerateStrategicLandscape(campaign())

    expect(res).toEqual({ status: 'failed' })
    expect(prisma.campaignStrategy.update).not.toHaveBeenCalled()
  })

  it('reports failed (not 500) when election-api has no data for the race', async () => {
    params.build.mockRejectedValue(
      new ElectionApiRaceNotFoundError('br-general'),
    )

    const res = await service.getOrGenerateStrategicLandscape(campaign())

    expect(res).toEqual({ status: 'failed' })
    expect(experimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('throws if the strategy row vanishes between upsert and read', async () => {
    prisma.campaignStrategy.upsert.mockResolvedValue(
      planRow({
        oppositionRunId: 'opp-run',
        opportunitiesRunId: 'oc-run',
        oppositionPersistedAt: new Date(),
        opportunitiesPersistedAt: new Date(),
      }),
    )
    prisma.campaignStrategy.findUnique.mockResolvedValue(null)

    await expect(
      service.getOrGenerateStrategicLandscape(campaign()),
    ).rejects.toBeInstanceOf(InternalServerErrorException)
  })

  it('stays generating without re-dispatching while a run is still RUNNING', async () => {
    prisma.campaignStrategy.upsert.mockResolvedValue(
      planRow({ oppositionRunId: 'opp-run', opportunitiesRunId: 'oc-run' }),
    )
    const runsById: Record<string, unknown> = {
      'opp-run': run({
        runId: 'opp-run',
        status: ExperimentRunStatus.COMPLETED,
      }),
      'oc-run': run({ runId: 'oc-run', status: ExperimentRunStatus.RUNNING }),
    }
    experimentRuns.findUnique.mockImplementation(
      (args: { where: { runId: string } }) =>
        Promise.resolve(runsById[args.where.runId] ?? null),
    )

    const res = await service.getOrGenerateStrategicLandscape(campaign())

    expect(res).toEqual({ status: 'generating' })
    expect(params.build).not.toHaveBeenCalled()
    expect(experimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('stays generating without re-dispatching while a run is still QUEUED', async () => {
    prisma.campaignStrategy.upsert.mockResolvedValue(
      planRow({ oppositionRunId: 'opp-run', opportunitiesRunId: 'oc-run' }),
    )
    const runsById: Record<string, unknown> = {
      'opp-run': run({
        runId: 'opp-run',
        status: ExperimentRunStatus.COMPLETED,
      }),
      'oc-run': run({ runId: 'oc-run', status: ExperimentRunStatus.QUEUED }),
    }
    experimentRuns.findUnique.mockImplementation(
      (args: { where: { runId: string } }) =>
        Promise.resolve(runsById[args.where.runId] ?? null),
    )

    const res = await service.getOrGenerateStrategicLandscape(campaign())

    expect(res).toEqual({ status: 'generating' })
    expect(params.build).not.toHaveBeenCalled()
    expect(experimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('stays generating without re-dispatching while a run is AWAITING_RESUME', async () => {
    prisma.campaignStrategy.upsert.mockResolvedValue(
      planRow({ oppositionRunId: 'opp-run', opportunitiesRunId: 'oc-run' }),
    )
    const runsById: Record<string, unknown> = {
      'opp-run': run({
        runId: 'opp-run',
        status: ExperimentRunStatus.COMPLETED,
      }),
      'oc-run': run({
        runId: 'oc-run',
        status: ExperimentRunStatus.AWAITING_RESUME,
      }),
    }
    experimentRuns.findUnique.mockImplementation(
      (args: { where: { runId: string } }) =>
        Promise.resolve(runsById[args.where.runId] ?? null),
    )

    const res = await service.getOrGenerateStrategicLandscape(campaign())

    expect(res).toEqual({ status: 'generating' })
    expect(params.build).not.toHaveBeenCalled()
    expect(experimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('re-dispatches a section whose previous run FAILED', async () => {
    prisma.campaignStrategy.upsert.mockResolvedValue(
      planRow({ oppositionRunId: 'opp-run', opportunitiesRunId: 'oc-run' }),
    )
    const runsById: Record<string, unknown> = {
      'opp-run': run({ runId: 'opp-run', status: ExperimentRunStatus.FAILED }),
      'oc-run': run({ runId: 'oc-run', status: ExperimentRunStatus.RUNNING }),
    }
    experimentRuns.findUnique.mockImplementation(
      (args: { where: { runId: string } }) =>
        Promise.resolve(runsById[args.where.runId] ?? null),
    )
    experimentRuns.dispatchRun.mockResolvedValue({ runId: 'opp-retry' })

    const res = await service.getOrGenerateStrategicLandscape(campaign())

    expect(res).toEqual({ status: 'generating' })
    expect(experimentRuns.dispatchRun).toHaveBeenCalledTimes(1)
    expect(experimentRuns.dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'opposition_research' }),
    )
    // The opportunities run is still in flight, so this retry joins the
    // existing generation and must NOT re-stamp the duration anchor.
    expect(prisma.campaignStrategy.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { oppositionRunId: 'opp-retry' },
    })
  })

  it('claims an attempt slot per re-dispatch via an atomic conditional update', async () => {
    prisma.campaignStrategy.upsert.mockResolvedValue(
      planRow({ oppositionRunId: 'opp-run', opportunitiesRunId: 'oc-run' }),
    )
    const runsById: Record<string, unknown> = {
      'opp-run': run({ runId: 'opp-run', status: ExperimentRunStatus.FAILED }),
      'oc-run': run({ runId: 'oc-run', status: ExperimentRunStatus.RUNNING }),
    }
    experimentRuns.findUnique.mockImplementation(
      (args: { where: { runId: string } }) =>
        Promise.resolve(runsById[args.where.runId] ?? null),
    )
    experimentRuns.dispatchRun.mockResolvedValue({ runId: 'opp-retry' })

    await service.getOrGenerateStrategicLandscape(campaign())

    expect(prisma.campaignStrategy.updateMany).toHaveBeenCalledWith({
      where: { id: 42, oppositionAttempts: { lt: 10 } },
      data: { oppositionAttempts: { increment: 1 } },
    })
  })

  it('reports failed (terminal) once a section hits the attempt cap', async () => {
    prisma.campaignStrategy.upsert.mockResolvedValue(
      planRow({ oppositionRunId: 'opp-run', opportunitiesRunId: 'oc-run' }),
    )
    const runsById: Record<string, unknown> = {
      'opp-run': run({ runId: 'opp-run', status: ExperimentRunStatus.FAILED }),
      'oc-run': run({ runId: 'oc-run', status: ExperimentRunStatus.RUNNING }),
    }
    experimentRuns.findUnique.mockImplementation(
      (args: { where: { runId: string } }) =>
        Promise.resolve(runsById[args.where.runId] ?? null),
    )
    // The atomic claim finds no remaining slots -> cap reached, no new run.
    prisma.campaignStrategy.updateMany.mockResolvedValue({ count: 0 })

    const res = await service.getOrGenerateStrategicLandscape(campaign())

    expect(res).toEqual({ status: 'failed' })
    expect(experimentRuns.dispatchRun).not.toHaveBeenCalled()
    expect(prisma.campaignStrategy.update).not.toHaveBeenCalled()
  })

  it('persists opponents when an opposition run completes', async () => {
    s3.getFile.mockResolvedValue(
      JSON.stringify({
        opponents: [
          {
            full_name: 'Rival',
            party_affiliation: 'Nonpartisan',
            incumbent: true,
          },
        ],
      }),
    )

    await service.onExperimentRunCompleted(
      run({ runId: 'opp-run', experimentType: 'opposition_research' }),
    )

    expect(persister.persistOpponents).toHaveBeenCalledWith(42, 'br-general', [
      { fullName: 'Rival', partyAffiliation: 'Nonpartisan', incumbent: true },
    ])
  })

  it('persists opportunities + challenges when that run completes', async () => {
    s3.getFile.mockResolvedValue(
      JSON.stringify({ opportunities: ['o1', 'o2'], challenges: ['c1'] }),
    )

    await service.onExperimentRunCompleted(
      run({ runId: 'oc-run', experimentType: 'opportunities_and_challenges' }),
    )

    expect(persister.persistOpportunitiesAndChallenges).toHaveBeenCalledWith(
      42,
      'br-general',
      ['o1', 'o2'],
      ['c1'],
    )
  })

  it('ignores non-CAP and non-completed runs', async () => {
    await service.onExperimentRunCompleted(
      run({ experimentType: 'district_issue_pulse' }),
    )
    await service.onExperimentRunCompleted(
      run({ status: ExperimentRunStatus.FAILED }),
    )

    expect(s3.getFile).not.toHaveBeenCalled()
    expect(persister.persistOpponents).not.toHaveBeenCalled()
    expect(persister.persistOpportunitiesAndChallenges).not.toHaveBeenCalled()
    expect(experimentRuns.markFailed).not.toHaveBeenCalled()
  })

  it('marks the run failed when a completed run has no artifact location', async () => {
    await expect(
      service.onExperimentRunCompleted(
        run({ runId: 'opp-run', artifactKey: null }),
      ),
    ).rejects.toThrow()

    expect(experimentRuns.markFailed).toHaveBeenCalledWith(
      'opp-run',
      'completed run has no artifact location',
    )
    expect(s3.getFile).not.toHaveBeenCalled()
  })

  it('persists an empty opponent list for an uncontested race', async () => {
    s3.getFile.mockResolvedValue(JSON.stringify({ opponents: [] }))

    await service.onExperimentRunCompleted(
      run({ runId: 'opp-run', experimentType: 'opposition_research' }),
    )

    expect(persister.persistOpponents).toHaveBeenCalledWith(
      42,
      'br-general',
      [],
    )
    expect(experimentRuns.markFailed).not.toHaveBeenCalled()
  })

  it('does nothing when no plan references the completed run', async () => {
    prisma.campaignStrategy.findFirst.mockResolvedValue(null)
    s3.getFile.mockResolvedValue(JSON.stringify({ opponents: [] }))

    await service.onExperimentRunCompleted(
      run({ runId: 'orphan', experimentType: 'opposition_research' }),
    )

    expect(s3.getFile).not.toHaveBeenCalled()
    expect(persister.persistOpponents).not.toHaveBeenCalled()
    expect(experimentRuns.markFailed).not.toHaveBeenCalled()
  })

  it('marks the run failed when persisting the artifact throws', async () => {
    s3.getFile.mockResolvedValue(
      JSON.stringify({
        opponents: [
          {
            full_name: 'Rival',
            party_affiliation: 'Nonpartisan',
            incumbent: true,
          },
        ],
      }),
    )
    persister.persistOpponents.mockRejectedValue(new Error('db down'))

    await expect(
      service.onExperimentRunCompleted(
        run({ runId: 'opp-run', experimentType: 'opposition_research' }),
      ),
    ).rejects.toThrow('db down')

    expect(experimentRuns.markFailed).toHaveBeenCalledWith('opp-run', 'db down')
  })

  it('marks the run failed when the artifact body is empty', async () => {
    s3.getFile.mockResolvedValue(undefined)

    await expect(
      service.onExperimentRunCompleted(
        run({ runId: 'opp-run', experimentType: 'opposition_research' }),
      ),
    ).rejects.toThrow()

    expect(experimentRuns.markFailed).toHaveBeenCalledWith(
      'opp-run',
      'artifact is missing or empty',
    )
    expect(persister.persistOpponents).not.toHaveBeenCalled()
  })

  describe('race change alignment', () => {
    it('resets content in place and regenerates when the campaign race changed', async () => {
      prisma.campaignStrategy.upsert.mockResolvedValue(
        planRow({
          raceId: 'br-old',
          oppositionRunId: 'old-opp-run',
          opportunitiesRunId: 'old-oc-run',
          oppositionPersistedAt: new Date(),
          opportunitiesPersistedAt: new Date(),
          oppositionAttempts: 2,
          opportunitiesAttempts: 2,
        }),
      )
      prisma.campaignStrategy.findUniqueOrThrow.mockResolvedValue(
        planRow({ raceId: 'br-general', previousRaceIds: ['br-old'] }),
      )
      experimentRuns.dispatchRun
        .mockResolvedValueOnce({ runId: 'opp-run' })
        .mockResolvedValueOnce({ runId: 'oc-run' })

      const res = await service.getOrGenerateStrategicLandscape(campaign())

      // The previous race's ready content must not be served.
      expect(res).toEqual({ status: 'generating' })
      for (const delegate of [
        prisma.campaignStrategyOpportunity,
        prisma.campaignStrategyChallenge,
        prisma.campaignStrategyOpponent,
      ]) {
        expect(delegate.deleteMany).toHaveBeenCalledWith({
          where: { campaignStrategyId: 42 },
        })
      }
      // The reset is an optimistic claim on the snapshot's race — a
      // concurrent reset that already committed makes it miss.
      expect(prisma.campaignStrategy.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 42, raceId: 'br-old' },
        data: expect.objectContaining({
          raceId: 'br-general',
          previousRaceIds: { push: 'br-old' },
          oppositionRunId: null,
          opportunitiesRunId: null,
          oppositionPersistedAt: null,
          opportunitiesPersistedAt: null,
          generationStartedAt: null,
        }),
      })
      // Attempt counters survive the reset — they bound lifetime spend.
      const resetData = prisma.campaignStrategy.updateMany.mock.calls[0][0].data
      expect(resetData).not.toHaveProperty('oppositionAttempts')
      expect(resetData).not.toHaveProperty('opportunitiesAttempts')
      expect(analytics.track).toHaveBeenCalledWith(
        7,
        'Campaign Plan V2 - Strategy Race Changed',
        expect.objectContaining({
          campaignId: 99,
          previousRaceId: 'br-old',
          newRaceId: 'br-general',
          raceChangeCount: 1,
        }),
      )
    })

    it('a lost reset claim defers to the concurrent winner without re-appending', async () => {
      prisma.campaignStrategy.upsert.mockResolvedValue(
        planRow({ raceId: 'br-old' }),
      )
      // The concurrent reset committed first: this request's claim misses.
      prisma.campaignStrategy.updateMany.mockResolvedValueOnce({ count: 0 })
      prisma.campaignStrategy.findUniqueOrThrow.mockResolvedValue(
        planRow({ raceId: 'br-general', previousRaceIds: ['br-old'] }),
      )
      experimentRuns.dispatchRun
        .mockResolvedValueOnce({ runId: 'opp-run' })
        .mockResolvedValueOnce({ runId: 'oc-run' })

      const res = await service.getOrGenerateStrategicLandscape(campaign())

      expect(res).toEqual({ status: 'generating' })
      expect(
        prisma.campaignStrategyOpportunity.deleteMany,
      ).not.toHaveBeenCalled()
      expect(analytics.track).not.toHaveBeenCalledWith(
        7,
        'Campaign Plan V2 - Strategy Race Changed',
        expect.anything(),
      )
    })

    it('adopts the current race onto an unstamped legacy row without resetting', async () => {
      prisma.campaignStrategy.upsert.mockResolvedValue(
        planRow({
          raceId: null,
          oppositionPersistedAt: new Date(),
          opportunitiesPersistedAt: new Date(),
        }),
      )
      prisma.campaignStrategy.update.mockResolvedValueOnce(
        planRow({
          raceId: 'br-general',
          oppositionPersistedAt: new Date(),
          opportunitiesPersistedAt: new Date(),
        }),
      )
      prisma.campaignStrategy.findUnique.mockResolvedValue({
        opportunities: [{ content: 'o1' }],
        challenges: [{ content: 'c1' }],
        opponents: [],
      })

      const res = await service.getOrGenerateStrategicLandscape(campaign())

      expect(res.status).toBe('ready')
      expect(prisma.campaignStrategy.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { raceId: 'br-general' },
      })
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(analytics.track).not.toHaveBeenCalled()
    })

    it('leaves a matching stamp untouched', async () => {
      prisma.campaignStrategy.upsert.mockResolvedValue(
        planRow({
          oppositionPersistedAt: new Date(),
          opportunitiesPersistedAt: new Date(),
        }),
      )
      prisma.campaignStrategy.findUnique.mockResolvedValue({
        opportunities: [{ content: 'o1' }],
        challenges: [{ content: 'c1' }],
        opponents: [],
      })

      const res = await service.getOrGenerateStrategicLandscape(campaign())

      expect(res.status).toBe('ready')
      expect(prisma.campaignStrategy.update).not.toHaveBeenCalled()
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('stamps new rows with the campaign race at creation', async () => {
      experimentRuns.dispatchRun
        .mockResolvedValueOnce({ runId: 'opp-run' })
        .mockResolvedValueOnce({ runId: 'oc-run' })

      await service.getOrGenerateStrategicLandscape(campaign())

      expect(prisma.campaignStrategy.upsert).toHaveBeenCalledWith({
        where: { campaignId: 99 },
        create: { campaignId: 99, raceId: 'br-general' },
        update: {},
      })
    })
  })
})
