import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRunStatus } from '@/generated/prisma'
import { AgentsService } from '@/agents/agents.service'
import { useTestService } from '@/test-service'
import {
  RACE_OPPONENT_ACTIONS,
  RACE_OPPONENT_SUMMARY,
} from '../raceOpponent.constants'
import { RaceOpponentPersistService } from './raceOpponentPersist.service'
import { RaceOpponentService } from './raceOpponent.service'

const service = useTestService()

const SLUG = 'test-org-chain'

const seedCampaign = async (isPro = true) => {
  await service.prisma.organization.create({
    data: { slug: SLUG, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${SLUG}-campaign`,
      organizationSlug: SLUG,
      isPro,
    },
    include: { user: true },
  })
}

const seedSummaryRun = (status: AgentRunStatus, createdAt: Date) =>
  service.prisma.agentRun.create({
    data: {
      agentName: RACE_OPPONENT_SUMMARY,
      organizationSlug: SLUG,
      status,
      manifest: {},
      shapeHash: 'shape',
      input: { organizationSlug: SLUG },
      createdAt,
    },
  })

const seedCompletedCollection = (createdAt: Date) =>
  service.prisma.agentRun.create({
    data: {
      agentName: 'race_opponent_collection',
      organizationSlug: SLUG,
      status: AgentRunStatus.completed,
      manifest: {},
      shapeHash: 'shape',
      input: { organizationSlug: SLUG },
      createdAt,
    },
  })

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// The engine calls onArtifact BEFORE it marks a run terminal, so the deferred
// re-chain runs while its own row is still `running`. If it counts itself as in
// flight, dispatchSummary returns and the newer collection is never structured,
// which strands the page on 'running' (ENG-10614).
describe('the re-chain excludes the run that is finishing', () => {
  it('dispatches a newer collection instead of matching the finishing summary', async () => {
    vi.stubEnv(
      'AGENTS_ON_GP_API',
      `${RACE_OPPONENT_SUMMARY},race_opponent_collection`,
    )
    const campaign = await seedCampaign()
    // A collection that landed while this summary was in flight, so the
    // re-chain has work to do and the finishing run is the only thing that
    // could wrongly look in flight.
    const summaryAt = new Date('2026-01-01T00:00:00Z')
    const collectionAt = new Date('2026-01-01T00:30:00Z')
    await seedCompletedCollection(collectionAt)
    const finishing = await seedSummaryRun(AgentRunStatus.running, summaryAt)
    await service.prisma.raceOpponent.create({
      data: {
        campaignId: campaign.id,
        runId: 'collect-run',
        opponentName: 'Jane Rival',
        sourceType: 'ballotpedia',
        sourceUrl: 'https://ballotpedia.org/Jane_Rival',
        content: { text: 'collected bio' },
      },
    })
    const dispatchSummary = vi
      .spyOn(service.app.get(RaceOpponentService), 'dispatchSummary')
      .mockResolvedValue()

    await service.app
      .get(RaceOpponentPersistService)
      .onSummaryFailure({ runId: finishing.id })

    const [dispatched, exceptRunId] = dispatchSummary.mock.calls[0] ?? []
    expect(dispatched?.id).toBe(campaign.id)
    expect(exceptRunId).toBe(finishing.id)
  })

  // The other half of the same rule: a summary run that is NOT the finishing one
  // is genuinely in flight, so the re-chain still refuses to double-dispatch.
  it('leaves a genuinely in-flight summary run alone', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', RACE_OPPONENT_SUMMARY)
    const campaign = await seedCampaign()
    await service.prisma.raceOpponent.create({
      data: {
        campaignId: campaign.id,
        runId: 'collect-run',
        opponentName: 'Jane Rival',
        sourceType: 'ballotpedia',
        sourceUrl: 'https://ballotpedia.org/Jane_Rival',
        content: { text: 'collected bio' },
      },
    })
    const inFlight = await seedSummaryRun(
      AgentRunStatus.running,
      new Date('2026-01-01T00:00:00Z'),
    )
    const run = vi.spyOn(service.app.get(AgentsService), 'run')

    await service.app.get(RaceOpponentService).dispatchSummary(campaign)

    expect(run).not.toHaveBeenCalled()
    // And the exception is what makes the difference: asked to exclude nobody,
    // the same in-flight row is still enough to refuse a second dispatch.
    const stillBlocked = await service.app
      .get(RaceOpponentService)
      .dispatchSummary(campaign, 'some-other-run-id')
    expect(stillBlocked).toBeUndefined()
    expect(run).not.toHaveBeenCalled()
    expect(inFlight.id).toBeTruthy()
  })
})

// A failed link must release the next one, or the page polls a chain that can
// never settle.
describe('a failed gp-api chain link re-chains', () => {
  it('re-chains after a failed summary run', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', RACE_OPPONENT_SUMMARY)
    const campaign = await seedCampaign()
    await seedCompletedCollection(new Date('2026-01-01T00:30:00Z'))
    const failed = await seedSummaryRun(
      AgentRunStatus.failed,
      new Date('2026-01-01T00:00:00Z'),
    )
    const rechain = vi
      .spyOn(
        service.app.get(RaceOpponentService),
        'rechainSummaryForNewerCollection',
      )
      .mockResolvedValue()

    await service.app
      .get(RaceOpponentPersistService)
      .onSummaryFailure({ runId: failed.id })

    const [rechained, at, exceptRunId] = rechain.mock.calls[0] ?? []
    expect(rechained?.id).toBe(campaign.id)
    expect(at).toEqual(failed.createdAt)
    expect(exceptRunId).toBe(failed.id)
  })

  it('re-chains after a failed actions run', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', RACE_OPPONENT_ACTIONS)
    const campaign = await seedCampaign()
    const failed = await service.prisma.agentRun.create({
      data: {
        agentName: RACE_OPPONENT_ACTIONS,
        organizationSlug: SLUG,
        status: AgentRunStatus.failed,
        manifest: {},
        shapeHash: 'shape',
        input: { organizationSlug: SLUG },
      },
    })
    const rechain = vi
      .spyOn(
        service.app.get(RaceOpponentService),
        'rechainActionsForNewerSummary',
      )
      .mockResolvedValue()

    await service.app
      .get(RaceOpponentPersistService)
      .onActionsFailure({ runId: failed.id })

    const [rechained, at, exceptRunId] = rechain.mock.calls[0] ?? []
    expect(rechained?.id).toBe(campaign.id)
    expect(at).toEqual(failed.createdAt)
    expect(exceptRunId).toBe(failed.id)
  })

  // The hooks are keyed on the agent name, so a run of another agent must not
  // trigger this link's re-chain.
  it('ignores a failed run of another agent', async () => {
    await service.prisma.organization.create({
      data: { slug: 'elsewhere', ownerId: service.user.id },
    })
    const other = await service.prisma.agentRun.create({
      data: {
        agentName: 'trending_issues',
        organizationSlug: 'elsewhere',
        status: AgentRunStatus.failed,
        manifest: {},
        shapeHash: 'shape',
        input: { organizationSlug: 'elsewhere' },
      },
    })
    const rechain = vi.spyOn(
      service.app.get(RaceOpponentService),
      'rechainSummaryForNewerCollection',
    )

    await service.app
      .get(RaceOpponentPersistService)
      .onSummaryFailure({ runId: other.id })

    expect(rechain).not.toHaveBeenCalled()
  })
})
