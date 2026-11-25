import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperimentRunStatus } from '@/generated/prisma'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CampaignWith } from '@/campaigns/campaigns.types'
import {
  RACE_OPPONENT_ACTIONS,
  RACE_OPPONENT_COLLECTION,
  RACE_OPPONENT_SUMMARY,
} from '../raceOpponent.constants'
import { RaceOpponentService } from './raceOpponent.service'

// The chain's engine switch: a link's dispatch and its readers must pick the
// same table, so `runsOnGpApi` is the only thing that moves a run between them.
const campaign = {
  id: 42,
  organizationSlug: 'org-1',
  isPro: true,
  user: { id: 7, clerkId: 'user_abc' },
  details: {},
} as unknown as CampaignWith<'user'>

const build = (prisma: Record<string, unknown>) => {
  const service = new RaceOpponentService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )
  Object.defineProperty(service, '_prisma', { value: prisma, writable: true })
  Object.defineProperty(service, 'logger', {
    value: createMockLogger(),
    writable: true,
  })
  return service
}

// A service with its collaborators injected: the gp-api dispatch takes
// AgentsService, and the actions dispatch also reads DistrictResolverService.
const buildWith = (
  prisma: Record<string, unknown>,
  agents: object,
  districtResolver: object = {},
) => {
  const service = new RaceOpponentService(
    {} as never,
    agents as never,
    {} as never,
    {} as never,
    districtResolver as never,
  )
  Object.defineProperty(service, '_prisma', { value: prisma, writable: true })
  Object.defineProperty(service, 'logger', {
    value: createMockLogger(),
    writable: true,
  })
  return service
}

const basePrisma = () => ({
  raceOpponent: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn() },
  campaignStrategy: { findUnique: vi.fn().mockResolvedValue(null) },
  raceOpponentSummary: { findMany: vi.fn().mockResolvedValue([]) },
  raceOpponentFieldAnalysis: { findUnique: vi.fn().mockResolvedValue(null) },
  raceOpponentStandoutAction: { findMany: vi.fn().mockResolvedValue([]) },
  organization: {
    findUnique: vi.fn().mockResolvedValue({
      owner: { email: 'real@example.com' },
      testModeCreatedAt: null,
    }),
  },
  experimentRun: { findFirst: vi.fn().mockResolvedValue(null) },
  agentRun: { findFirst: vi.fn().mockResolvedValue(null) },
  website: { findUnique: vi.fn().mockResolvedValue(null) },
  campaignDetails: { findUnique: vi.fn().mockResolvedValue(null) },
})

beforeEach(() => {
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('race opponent chain engine switch', () => {
  it('reads the collection run from AgentRun when the switch is on', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', RACE_OPPONENT_COLLECTION)
    const prisma = basePrisma()
    prisma.agentRun.findFirst.mockResolvedValue({
      id: 'agent-run-1',
      status: 'running',
      createdAt: new Date(),
    })

    const status = await build(prisma).get(campaign)

    expect(status.collectionStatus).toBe('running')
    expect(prisma.agentRun.findFirst).toHaveBeenCalled()
    expect(prisma.experimentRun.findFirst).not.toHaveBeenCalled()
  })

  it('reads the collection run from ExperimentRun when the switch is off', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', '')
    const prisma = basePrisma()
    prisma.experimentRun.findFirst.mockResolvedValue({
      runId: 'pmf-run-1',
      status: ExperimentRunStatus.RUNNING,
      createdAt: new Date(),
    })

    const status = await build(prisma).get(campaign)

    expect(status.collectionStatus).toBe('running')
    expect(prisma.experimentRun.findFirst).toHaveBeenCalled()
    expect(prisma.agentRun.findFirst).not.toHaveBeenCalled()
  })

  // A reader left on the other engine's table sees no run, settles to idle, and
  // the page re-dispatches a paid run. Reading the summary from the wrong table
  // is the same bug one link down.
  it('reads the chained summary from AgentRun when that link is switched on', async () => {
    vi.stubEnv(
      'AGENTS_ON_GP_API',
      `${RACE_OPPONENT_COLLECTION},${RACE_OPPONENT_SUMMARY}`,
    )
    const prisma = basePrisma()
    const collectionAt = new Date('2026-01-01T00:00:00Z')
    prisma.agentRun.findFirst
      .mockResolvedValueOnce({
        id: 'agent-run-1',
        status: 'completed',
        createdAt: collectionAt,
      })
      .mockResolvedValueOnce({
        id: 'agent-run-2',
        status: 'running',
        createdAt: new Date('2026-01-01T01:00:00Z'),
      })
    prisma.raceOpponent.count = vi.fn().mockResolvedValue(1)

    const status = await build(prisma).get(campaign)

    expect(status.collectionStatus).toBe('running')
    expect(prisma.experimentRun.findFirst).not.toHaveBeenCalled()
  })

  it('dispatches the collection to AgentsService when the switch is on', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', RACE_OPPONENT_COLLECTION)
    const prisma = basePrisma()
    // Opponents already discovered, so collect() takes the dispatch branch
    // rather than the discovery one.
    prisma.campaignStrategy.findUnique = vi.fn().mockResolvedValue({
      opponents: [{ fullName: 'Jane Rival', partyAffiliation: 'Unknown' }],
      oppositionPersistedAt: new Date(),
    })
    const run = vi.fn().mockResolvedValue({ runId: 'agent-run-1' })
    const dispatchRun = vi.fn()
    const service = new RaceOpponentService(
      { dispatchRun } as never,
      { run } as never,
      { getRaceContext: vi.fn().mockResolvedValue({}) } as never,
      {} as never,
      {} as never,
    )
    Object.defineProperty(service, '_prisma', { value: prisma, writable: true })
    Object.defineProperty(service, 'logger', {
      value: createMockLogger(),
      writable: true,
    })

    const res = await service.collect(campaign)

    expect(res).toEqual({ runId: 'agent-run-1', status: 'running' })
    expect(run).toHaveBeenCalledWith(
      RACE_OPPONENT_COLLECTION,
      expect.objectContaining({
        organizationSlug: 'org-1',
        opponents: [expect.objectContaining({ fullName: 'Jane Rival' })],
      }),
    )
    expect(dispatchRun).not.toHaveBeenCalled()
  })

  // The PMF Engine's dispatchRun makes the test-user check and `run` does not, so
  // the gp-api branch has to make it itself or a synthetic org spends a paid run.
  it('skips the dispatch for a test-user org on the gp-api branch', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', RACE_OPPONENT_SUMMARY)
    const prisma = basePrisma()
    prisma.organization.findUnique = vi.fn().mockResolvedValue({
      owner: { email: 'someone@test.goodparty.org' },
      testModeCreatedAt: null,
    })
    const run = vi.fn()
    const service = buildWith(prisma, { run })

    await service.dispatchSummary(campaign)

    expect(run).not.toHaveBeenCalled()
  })

  it('skips the dispatch for a test-mode org on the gp-api branch', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', RACE_OPPONENT_COLLECTION)
    const prisma = basePrisma()
    prisma.organization.findUnique = vi.fn().mockResolvedValue({
      owner: { email: 'real@example.com' },
      testModeCreatedAt: new Date(),
    })
    const run = vi.fn()
    const service = buildWith(prisma, { run })

    await service.dispatchSummary(campaign)

    expect(run).not.toHaveBeenCalled()
  })

  // The camelCase input the agent's strict schema parses: a mapping slip only
  // fails at runtime, in the worker, after the run is created.
  it('sends the summary agent its input in gp-api names', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', RACE_OPPONENT_SUMMARY)
    const prisma = basePrisma()
    prisma.raceOpponent.findMany = vi.fn().mockResolvedValue([
      {
        opponentName: 'Jane Rival',
        sourceType: 'ballotpedia',
        sourceUrl: 'https://ballotpedia.org/Jane_Rival',
        content: { text: 'collected bio' },
      },
    ])
    const run = vi.fn().mockResolvedValue({ runId: 'summary-run' })
    const service = buildWith(prisma, { run })

    await service.dispatchSummary(campaign)

    expect(run).toHaveBeenCalledWith(
      RACE_OPPONENT_SUMMARY,
      expect.objectContaining({
        organizationSlug: 'org-1',
        today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        opponents: [
          {
            opponentName: 'Jane Rival',
            sources: [
              {
                sourceType: 'ballotpedia',
                sourceUrl: 'https://ballotpedia.org/Jane_Rival',
                text: 'collected bio',
              },
            ],
          },
        ],
      }),
    )
  })

  // A persisted row the summary input schema would reject must be dropped, not
  // forwarded: AgentsService.run parses the whole input, so one bad source fails
  // every opponent's summary.
  it('drops a source the summary input cannot accept', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', RACE_OPPONENT_SUMMARY)
    const prisma = basePrisma()
    prisma.raceOpponent.findMany = vi.fn().mockResolvedValue([
      {
        opponentName: 'Jane Rival',
        sourceType: 'ballotpedia',
        sourceUrl: 'not-a-url',
        content: { text: 'collected bio' },
      },
      {
        opponentName: 'Sue Rival',
        sourceType: 'ballotpedia',
        sourceUrl: 'https://ballotpedia.org/Sue_Rival',
        content: {},
      },
    ])
    const run = vi.fn().mockResolvedValue({ runId: 'summary-run' })
    const service = buildWith(prisma, { run })

    await service.dispatchSummary(campaign)

    expect(run).not.toHaveBeenCalled()
  })

  it('sends the actions agent its district trio and threat tiers', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', RACE_OPPONENT_ACTIONS)
    const prisma = basePrisma()
    prisma.raceOpponentSummary.findMany = vi.fn().mockResolvedValue([
      {
        opponentName: 'Jane Rival',
        // The contract's minimum: a threat tier (which drives card order) and
        // an overview. The actions input flattens exactly this.
        sections: {
          opponentName: 'Jane Rival',
          threatTier: 'primary_threat',
          overview: null,
          background: null,
          generatedAt: '2026-06-28T00:00:00.000Z',
        },
      },
    ])
    const run = vi.fn().mockResolvedValue({ runId: 'actions-run' })
    const service = buildWith(
      prisma,
      { run },
      {
        resolveByOrgSlug: vi.fn().mockResolvedValue({
          state: 'GA',
          l2DistrictType: 'City',
          l2DistrictName: 'ROCKVALE CITY',
        }),
      },
    )

    await service.dispatchActions(campaign)

    expect(run).toHaveBeenCalledWith(
      RACE_OPPONENT_ACTIONS,
      expect.objectContaining({
        organizationSlug: 'org-1',
        state: 'GA',
        l2DistrictType: 'City',
        l2DistrictName: 'ROCKVALE CITY',
        opponents: [
          expect.objectContaining({
            opponentName: 'Jane Rival',
            threatTier: 'primary_threat',
          }),
        ],
      }),
    )
  })
})
