import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { RaceOpponentResearchPersistService } from '@/raceOpponent/services/raceOpponentResearchPersist.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import {
  ExperimentRunStatus,
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
} from '@/generated/prisma'
import { OpponentResearchScheduleService } from './opponentResearchSchedule.service'

const service = useTestService()

const SLUG = 'campaign-sched'
const OPPONENT = 'Jane Rival'
const REACHABLE = 'https://ballotpedia.org/Jane_Rival'

const seedCampaign = async () => {
  await service.prisma.organization.create({
    data: { slug: SLUG, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${SLUG}-campaign`,
      organizationSlug: SLUG,
      isPro: true,
    },
  })
}

const seedOpponentRow = (
  campaignId: number,
  status: RaceOpponentResearchStatus,
  runId: string,
) =>
  service.prisma.raceOpponentResearch.create({
    data: {
      campaignId,
      kind: RaceOpponentFindingKind.opponent,
      opponentName: OPPONENT,
      status,
      runId,
    },
  })

const seedRun = (runId: string, status: ExperimentRunStatus) =>
  service.prisma.experimentRun.create({
    data: {
      runId,
      organizationSlug: SLUG,
      experimentType: 'opponent_research',
      status,
      ...(status === ExperimentRunStatus.COMPLETED
        ? { artifactBucket: 'bucket', artifactKey: `${runId}.json` }
        : {}),
    },
  })

const opponentFinding = (claim: string) => ({
  category: 'record',
  claim,
  source_extract: 'extract',
  source_url: REACHABLE,
  source_title: 'City Council Minutes',
  occurred_at: '2021-06-01',
})

const stubArtifact = (findings: unknown[]) =>
  vi
    .spyOn(service.app.get(S3Service), 'getFile')
    .mockResolvedValue(JSON.stringify({ findings }))

type ReachabilitySeam = { checkReachable(url: string): Promise<Date | null> }
const stubReachability = () =>
  vi
    .spyOn(
      service.app.get(
        RaceOpponentResearchPersistService,
      ) as unknown as ReachabilitySeam,
      'checkReachable',
    )
    .mockResolvedValue(new Date())

describe('OpponentResearchScheduleService.refreshOpponentResearch', () => {
  beforeEach(() => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('re-dispatches opponent_research for a settled (completed) row', async () => {
    const campaign = await seedCampaign()
    await seedOpponentRow(
      campaign.id,
      RaceOpponentResearchStatus.completed,
      'r1',
    )
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'r2' } as never)

    await service.app
      .get(OpponentResearchScheduleService)
      .refreshOpponentResearch()

    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'opponent_research',
        organizationSlug: SLUG,
        params: expect.objectContaining({
          opponent: expect.objectContaining({ full_name: OPPONENT }),
        }),
      }),
    )
    const row = await service.prisma.raceOpponentResearch.findFirstOrThrow({
      where: {
        campaignId: campaign.id,
        kind: RaceOpponentFindingKind.opponent,
      },
    })
    expect(row.runId).toBe('r2')
    expect(row.status).toBe(RaceOpponentResearchStatus.queued)
    expect(row.attempts).toBe(1)
  })

  it('skips a row whose org already has an in-flight run', async () => {
    const campaign = await seedCampaign()
    await seedOpponentRow(
      campaign.id,
      RaceOpponentResearchStatus.completed,
      'r1',
    )
    await seedRun('inflight', ExperimentRunStatus.RUNNING)
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    await service.app
      .get(OpponentResearchScheduleService)
      .refreshOpponentResearch()

    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('does not duplicate findings when the re-dispatched run persists an overlapping set', async () => {
    const campaign = await seedCampaign()
    const row = await seedOpponentRow(
      campaign.id,
      RaceOpponentResearchStatus.completed,
      'r1',
    )
    // The row already carries a finding from its first pass.
    await service.prisma.raceOpponentFinding.create({
      data: {
        researchId: row.id,
        claim: 'Voted to raise property taxes in 2021',
        sourceUrl: REACHABLE,
        sourceExtract: 'extract',
        category: 'record',
        occurredAt: new Date('2021-06-01'),
        sourceReachableAt: new Date(),
      },
    })

    vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    ).mockResolvedValue({ runId: 'r2' } as never)

    await service.app
      .get(OpponentResearchScheduleService)
      .refreshOpponentResearch()

    // The re-dispatched run completes with the same finding plus a new one.
    const run = await seedRun('r2', ExperimentRunStatus.COMPLETED)
    stubArtifact([
      opponentFinding('Voted to raise property taxes in 2021'),
      opponentFinding('Missed 12 council votes in 2022'),
    ])
    stubReachability()

    await service.app
      .get(RaceOpponentResearchPersistService)
      .onExperimentRunCompleted(run)

    // Replace-on-persist keyed by the research row: exactly the run's findings,
    // no carryover duplicate of the overlapping claim.
    const findings = await service.prisma.raceOpponentFinding.findMany({
      where: { research: { campaignId: campaign.id } },
    })
    expect(findings).toHaveLength(2)
    const claims = findings.map((f) => f.claim).sort()
    expect(claims).toEqual([
      'Missed 12 council votes in 2022',
      'Voted to raise property taxes in 2021',
    ])
  })

  it('does nothing when automation is disabled', async () => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'false')
    const campaign = await seedCampaign()
    await seedOpponentRow(
      campaign.id,
      RaceOpponentResearchStatus.completed,
      'r1',
    )
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    await service.app
      .get(OpponentResearchScheduleService)
      .refreshOpponentResearch()

    expect(dispatchRun).not.toHaveBeenCalled()
  })
})
