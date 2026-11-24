import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CampaignStrategy,
  ExperimentRun,
  ExperimentRunStatus,
} from '@/generated/prisma'
import { AnalyticsService } from '@/analytics/analytics.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { useTestService } from '@/test-service'
import { CampaignStrategyService } from './campaignStrategy.service'

const service = useTestService()

const SLUG = 'opposition-persist'
const RACE_ID = 'br-persist'
const ARTIFACT_BUCKET = 'agent-artifacts'
const ARTIFACT_KEY = 'opposition/artifact.json'

const spies: { mockRestore: () => void }[] = []
const stub = <T extends { mockRestore: () => void }>(spy: T): T => {
  spies.push(spy)
  return spy
}

const RIVAL = {
  full_name: 'Marlowe Quennell',
  party_affiliation: 'Nonpartisan',
  incumbent: true,
}

const seedCampaign = async () => {
  await service.prisma.organization.create({
    data: { slug: SLUG, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      organizationSlug: SLUG,
      userId: service.user.id,
      slug: SLUG,
      details: { raceId: RACE_ID },
    },
  })
}

const seedPlan = (
  campaignId: number,
  overrides: Record<string, unknown> = {},
): Promise<CampaignStrategy> =>
  service.prisma.campaignStrategy.create({
    data: { campaignId, raceId: RACE_ID, ...overrides },
  })

const planOf = (campaignId: number) =>
  service.prisma.campaignStrategy.findFirstOrThrow({ where: { campaignId } })

// A COMPLETED PMF Engine run carrying an artifact in S3, which is what the
// result consumer hands onExperimentRunCompleted.
const seedCompletedRun = (
  overrides: Record<string, unknown> = {},
): Promise<ExperimentRun> =>
  service.prisma.experimentRun.create({
    data: {
      organizationSlug: SLUG,
      experimentType: 'opposition_research',
      status: ExperimentRunStatus.COMPLETED,
      params: { race_id: RACE_ID },
      artifactBucket: ARTIFACT_BUCKET,
      artifactKey: ARTIFACT_KEY,
      ...overrides,
    },
  })

const stubArtifact = (artifact: unknown) =>
  stub(vi.spyOn(service.app.get(S3Service), 'getFile')).mockResolvedValue(
    JSON.stringify(artifact),
  )

afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore())
  vi.unstubAllEnvs()
})

const completionEventOf = (
  track: { mock: { calls: unknown[][] } },
  event: string,
) =>
  track.mock.calls.find((call) => call[1] === event)?.[2] as
    | { generationEngine: string }
    | undefined

describe('CampaignStrategyService.onExperimentRunCompleted', () => {
  it('persists the section the completed run generated', async () => {
    const campaign = await seedCampaign()
    const run = await seedCompletedRun()
    await seedPlan(campaign.id, { oppositionRunId: run.runId })
    stubArtifact({ opponents: [RIVAL] })

    await service.app.get(CampaignStrategyService).onExperimentRunCompleted(run)

    expect(
      await service.prisma.campaignStrategyOpponent.findMany({
        where: { campaignStrategyId: campaign.id },
      }),
    ).toEqual([
      expect.objectContaining({
        fullName: RIVAL.full_name,
        partyAffiliation: 'Nonpartisan',
        incumbent: true,
      }),
    ])
    expect((await planOf(campaign.id)).oppositionPersistedAt).not.toBeNull()
  })

  // The event's user lookup and the bootstrap's reads run after the rows
  // commit. A transient fault there must not report a section that already
  // landed as failed: marking the run FAILED is the lie, not a retry.
  it('leaves a run COMPLETED when a read after the commit faults', async () => {
    const campaign = await seedCampaign()
    const run = await seedCompletedRun()
    await seedPlan(campaign.id, {
      oppositionRunId: run.runId,
      opportunitiesPersistedAt: new Date(),
    })
    stubArtifact({ opponents: [RIVAL] })
    stub(vi.spyOn(service.prisma.campaign, 'findUnique')).mockRejectedValue(
      new Error('db down'),
    )

    await service.app.get(CampaignStrategyService).onExperimentRunCompleted(run)

    expect(
      (
        await service.prisma.experimentRun.findUniqueOrThrow({
          where: { runId: run.runId },
        })
      ).status,
    ).toBe(ExperimentRunStatus.COMPLETED)
    expect(
      await service.prisma.campaignStrategyOpponent.count({
        where: { campaignStrategyId: campaign.id },
      }),
    ).toBe(1)
    expect((await planOf(campaign.id)).trackerBootstrapped).toBe(false)
  })

  it('marks the run FAILED when its artifact is empty', async () => {
    const campaign = await seedCampaign()
    const run = await seedCompletedRun()
    await seedPlan(campaign.id, { oppositionRunId: run.runId })
    stub(vi.spyOn(service.app.get(S3Service), 'getFile')).mockResolvedValue(
      undefined,
    )

    await expect(
      service.app.get(CampaignStrategyService).onExperimentRunCompleted(run),
    ).rejects.toThrow('artifact is missing or empty')

    expect(
      (
        await service.prisma.experimentRun.findUniqueOrThrow({
          where: { runId: run.runId },
        })
      ).status,
    ).toBe(ExperimentRunStatus.FAILED)
  })

  // The label names the engine that ran the section, so a funnel joining
  // Started to Completed does not split one run in two. This run was dispatched
  // to the PMF Engine; a deploy that turns the switch on mid-run must not
  // relabel its completion as gp-api's.
  it('labels the completion with the engine that ran it, not the live switch', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', 'opposition_research')
    const campaign = await seedCampaign()
    const run = await seedCompletedRun()
    await seedPlan(campaign.id, {
      oppositionRunId: run.runId,
      opportunitiesPersistedAt: new Date(),
    })
    stubArtifact({ opponents: [RIVAL] })
    const track = stub(
      vi.spyOn(service.app.get(AnalyticsService), 'track'),
    ).mockResolvedValue({} as never)

    await service.app.get(CampaignStrategyService).onExperimentRunCompleted(run)

    expect(
      completionEventOf(
        track,
        'Campaign Plan V2 - Opposition Research Generation Completed',
      ),
    ).toMatchObject({ generationEngine: 'cap' })
  })
})

// onArtifact runs before a gp-api run is stamped finished and can run again
// after a crash. The persister writes the rows and sets the section's marker in
// one transaction, so a set marker means the rows are already there — but the
// tracker bootstrap comes after it, so the marker must not skip the bootstrap.
describe('CampaignStrategyService.onOppositionResearchArtifact', () => {
  it('still bootstraps the tracker on a retry whose rows are already persisted', async () => {
    const campaign = await seedCampaign()
    const plan = await seedPlan(campaign.id, {
      oppositionRunId: 'a-run-whose-rows-are-in',
      oppositionPersistedAt: new Date(),
      opportunitiesPersistedAt: new Date(),
    })

    await service.app
      .get(CampaignStrategyService)
      .onOppositionResearchArtifact({
        runId: 'a-run-whose-rows-are-in',
        raceId: RACE_ID,
        artifact: { opponents: [RIVAL] },
      })

    // Nothing rewritten: the marker says the rows are already in.
    expect(
      await service.prisma.campaignStrategyOpponent.count({
        where: { campaignStrategyId: plan.id },
      }),
    ).toBe(0)
    expect((await planOf(campaign.id)).trackerBootstrapped).toBe(true)
  })

  it('persists the section when no rows have landed yet', async () => {
    const campaign = await seedCampaign()
    const plan = await seedPlan(campaign.id, {
      oppositionRunId: 'a-fresh-run',
      opportunitiesPersistedAt: new Date(),
    })

    await service.app
      .get(CampaignStrategyService)
      .onOppositionResearchArtifact({
        runId: 'a-fresh-run',
        raceId: RACE_ID,
        artifact: { opponents: [RIVAL] },
      })

    expect(
      await service.prisma.campaignStrategyOpponent.findMany({
        where: { campaignStrategyId: plan.id },
      }),
    ).toEqual([
      expect.objectContaining({ fullName: RIVAL.full_name, incumbent: true }),
    ])
    const read = await planOf(campaign.id)
    expect(read.oppositionPersistedAt).not.toBeNull()
    expect(read.trackerBootstrapped).toBe(true)
  })

  // The mirror of the PMF Engine case: gp-api's agent wrote this section, so its
  // completion is gp-api's even if the switch flips off before the event fires.
  it('labels the completion gp-api even with the switch already off', async () => {
    vi.stubEnv('AGENTS_ON_GP_API', '')
    const campaign = await seedCampaign()
    const plan = await seedPlan(campaign.id, {
      oppositionRunId: 'a-gp-api-run',
      opportunitiesPersistedAt: new Date(),
    })
    const track = stub(
      vi.spyOn(service.app.get(AnalyticsService), 'track'),
    ).mockResolvedValue({} as never)

    await service.app
      .get(CampaignStrategyService)
      .onOppositionResearchArtifact({
        runId: 'a-gp-api-run',
        raceId: RACE_ID,
        artifact: { opponents: [RIVAL] },
      })

    expect(
      completionEventOf(
        track,
        'Campaign Plan V2 - Opposition Research Generation Completed',
      ),
    ).toMatchObject({ generationEngine: 'gp-api' })
    expect((await planOf(campaign.id)).oppositionPersistedAt).not.toBeNull()
    expect(plan.oppositionPersistedAt).toBeNull()
  })
})
