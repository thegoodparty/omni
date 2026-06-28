import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { FeaturesService } from '@/features/services/features.service'
import { RaceOpponentResearchPersistService } from '@/raceOpponent/services/raceOpponentResearchPersist.service'
import { OpponentResearchService } from '@/raceOpponent/services/opponentResearch.service'
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

const seedCampaign = async ({
  isPro = true,
  slug = SLUG,
}: { isPro?: boolean; slug?: string } = {}) => {
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${slug}-campaign`,
      organizationSlug: slug,
      isPro,
    },
  })
}

const seedOpponentRow = (
  campaignId: number,
  status: RaceOpponentResearchStatus,
  runId: string,
  opponentName: string = OPPONENT,
) =>
  service.prisma.raceOpponentResearch.create({
    data: {
      campaignId,
      kind: RaceOpponentFindingKind.opponent,
      opponentName,
      status,
      runId,
    },
  })

const campaignWithUser = (id: number) =>
  service.prisma.campaign.findUniqueOrThrow({
    where: { id },
    include: { user: true },
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

const flagOn = () =>
  vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(true)

describe('OpponentResearchScheduleService.refreshOpponentResearch', () => {
  beforeEach(() => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
    flagOn()
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

  it('spreads the tick across campaigns: two campaigns each get one dispatch', async () => {
    const campA = await seedCampaign({ slug: 'sched-a' })
    const campB = await seedCampaign({ slug: 'sched-b' })
    await seedOpponentRow(campA.id, RaceOpponentResearchStatus.completed, 'a1')
    await seedOpponentRow(campB.id, RaceOpponentResearchStatus.completed, 'b1')
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'fresh' } as never)

    await service.app
      .get(OpponentResearchScheduleService)
      .refreshOpponentResearch()

    const slugs = dispatchRun.mock.calls
      .map((c) => c[0].organizationSlug)
      .sort()
    expect(slugs).toEqual(['sched-a', 'sched-b'])
  })

  it('dispatches at most one row per campaign per tick', async () => {
    const campaign = await seedCampaign()
    // Two settled rows for the same campaign (distinct opponents). Only one may
    // dispatch per tick so one org cannot consume the whole budget.
    await seedOpponentRow(
      campaign.id,
      RaceOpponentResearchStatus.completed,
      'c1',
      'Jane Rival',
    )
    await seedOpponentRow(
      campaign.id,
      RaceOpponentResearchStatus.completed,
      'c2',
      'Bob Other',
    )
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'fresh' } as never)

    await service.app
      .get(OpponentResearchScheduleService)
      .refreshOpponentResearch()

    expect(dispatchRun).toHaveBeenCalledTimes(1)
  })

  it('does not re-dispatch a row already moved to queued by a concurrent path', async () => {
    const campaign = await seedCampaign()
    // A settled row that a concurrent user start() will have moved to queued.
    await seedOpponentRow(
      campaign.id,
      RaceOpponentResearchStatus.completed,
      'settled-1',
      'Jane Rival',
    )
    await seedOpponentRow(
      campaign.id,
      RaceOpponentResearchStatus.queued,
      'already-queued',
      'Bob Other',
    )
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'fresh' } as never)

    await service.app
      .get(OpponentResearchScheduleService)
      .refreshOpponentResearch()

    // Only the genuinely-settled row is re-dispatched; the queued one is not.
    expect(dispatchRun).toHaveBeenCalledTimes(1)
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          opponent: expect.objectContaining({ full_name: 'Jane Rival' }),
        }),
      }),
    )
  })

  it('atomic claim skips a row whose status is no longer settled', async () => {
    const seeded = await seedCampaign()
    const campaign = await campaignWithUser(seeded.id)
    // The cron selected this row as completed, but a concurrent start() flipped
    // it to queued before the cron's claim. The atomic settled->queued claim
    // must find count===0 and skip — no second dispatch, runId untouched.
    const staleSelection = await seedOpponentRow(
      campaign.id,
      RaceOpponentResearchStatus.completed,
      'concurrent-bind',
    )
    await service.prisma.raceOpponentResearch.update({
      where: { id: staleSelection.id },
      data: {
        status: RaceOpponentResearchStatus.queued,
        runId: 'concurrent-bind',
      },
    })
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    const dispatched = await service.app
      .get(OpponentResearchService)
      .redispatchForRow(campaign, staleSelection)

    expect(dispatched).toBe(false)
    expect(dispatchRun).not.toHaveBeenCalled()
    const row = await service.prisma.raceOpponentResearch.findUniqueOrThrow({
      where: { id: staleSelection.id },
    })
    expect(row.runId).toBe('concurrent-bind')
    expect(row.attempts).toBe(0)
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

  it('skips a settled row whose campaign is not Pro', async () => {
    const campaign = await seedCampaign({ isPro: false })
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

  it('skips a settled Pro row whose know-your-opponent flag is off', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedOpponentRow(
      campaign.id,
      RaceOpponentResearchStatus.completed,
      'r1',
    )
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(false)
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    await service.app
      .get(OpponentResearchScheduleService)
      .refreshOpponentResearch()

    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('leaves a failed-dispatch row as failed (not stuck queued) and continues the tick', async () => {
    const campA = await seedCampaign({ slug: 'sched-fail-a' })
    const campB = await seedCampaign({ slug: 'sched-fail-b' })
    const rowA = await seedOpponentRow(
      campA.id,
      RaceOpponentResearchStatus.completed,
      'a1',
    )
    await seedOpponentRow(campB.id, RaceOpponentResearchStatus.completed, 'b1')
    // First org's dispatch throws; the second must still be attempted, and the
    // first row must self-heal to failed rather than sit queued forever.
    let call = 0
    vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    ).mockImplementation(() => {
      call += 1
      return call === 1
        ? Promise.reject(new Error('SQS down'))
        : (Promise.resolve({ runId: 'ok' }) as never)
    })

    await service.app
      .get(OpponentResearchScheduleService)
      .refreshOpponentResearch()

    const failedRow =
      await service.prisma.raceOpponentResearch.findUniqueOrThrow({
        where: { id: rowA.id },
      })
    expect(failedRow.status).toBe(RaceOpponentResearchStatus.failed)
    expect(failedRow.runId).toBeNull()
    expect(failedRow.attempts).toBe(0)
    // The tick continued to the second org despite the first's failure.
    expect(call).toBe(2)
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
