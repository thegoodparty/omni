import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { RaceOpponentResearchPersistService } from '@/raceOpponent/services/raceOpponentResearchPersist.service'
import { SelfResearchService } from '@/raceOpponent/services/selfResearch.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { RaceOpponentResearch } from '@/generated/prisma'
import { S3Service } from '@/vendors/aws/services/s3.service'
import {
  ExperimentRunStatus,
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
} from '@/generated/prisma'

const service = useTestService()

const SLUG = 'campaign-self'
const ORG_SLUG_HEADER = 'X-Organization-Slug'
const START_PATH = '/v1/campaigns/mine/race-opponent/self-research'
const STATUS_PATH = '/v1/campaigns/mine/race-opponent/self-research/status'
const REPORT_PATH = '/v1/campaigns/mine/race-opponent/self-research/report'
const IDENTIFY_PATH = '/v1/campaigns/mine/race-opponent/opponents/identify'

const REACHABLE = 'https://ballotpedia.org/Jane_Self'
const UNREACHABLE = 'https://gone.example.com/missing'

const seedCampaign = async (opts: { isPro: boolean }) => {
  await service.prisma.organization.create({
    data: { slug: SLUG, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${SLUG}-campaign`,
      organizationSlug: SLUG,
      isPro: opts.isPro,
    },
  })
}

const seedSelfResearch = (
  campaignId: number,
  status: RaceOpponentResearchStatus,
  runId: string,
) =>
  service.prisma.raceOpponentResearch.create({
    data: {
      campaignId,
      kind: RaceOpponentFindingKind.self,
      status,
      runId,
    },
  })

const seedRun = (runId: string, status: ExperimentRunStatus) =>
  service.prisma.experimentRun.create({
    data: {
      runId,
      organizationSlug: SLUG,
      experimentType: 'self_research',
      status,
      ...(status === ExperimentRunStatus.COMPLETED
        ? { artifactBucket: 'bucket', artifactKey: `${runId}.json` }
        : {}),
    },
  })

const flagOn = () =>
  vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(true)

const stubArtifact = (
  findings: unknown[],
  generatedAt = '2026-06-27T00:00:00.000Z',
) =>
  vi
    .spyOn(service.app.get(S3Service), 'getFile')
    .mockResolvedValue(JSON.stringify({ findings, generated_at: generatedAt }))

// Mock the network layer the persist service uses, not the persist method
// itself: REACHABLE resolves to a timestamp, everything else to null (dropped).
// checkReachable is the protected axios/SSRF wrapper, so spying on it is the
// network seam — the persist logic (parse, drop, transaction) still runs.
type ReachabilitySeam = {
  checkReachable(url: string): Promise<Date | null>
}
type MarkFailedSeam = {
  markResearchFailed(runId: string): Promise<void>
}
type ModelArgs = { where: { id: number }; data: { runId: string } }
type ModelSeam = {
  model: { update(args: ModelArgs): Promise<RaceOpponentResearch> }
}
const stubReachability = () =>
  vi
    .spyOn(
      service.app.get(
        RaceOpponentResearchPersistService,
      ) as unknown as ReachabilitySeam,
      'checkReachable',
    )
    .mockImplementation((url: string) =>
      Promise.resolve(url === REACHABLE ? new Date() : null),
    )

const stubTrack = () =>
  vi
    .spyOn(service.app.get(AnalyticsService), 'track')
    .mockResolvedValue(undefined as never)

const validFinding = (overrides: Record<string, unknown> = {}) => ({
  category: 'record',
  claim: 'Voted to raise property taxes in 2021',
  drafted_response: 'The 2021 budget funded schools; I stand by that vote.',
  source_extract: 'Council member voted yes on the 2021 levy.',
  source_url: REACHABLE,
  source_title: 'City Council Minutes',
  occurred_at: '2021-06-01',
  ...overrides,
})

describe('Self-research dispatch + persist + opponent gate', () => {
  describe('the server-side opponent gate', () => {
    it('403s opponent identify when no self-research pass is completed', async () => {
      await seedCampaign({ isPro: true })
      flagOn()

      const result = await service.client.post(
        IDENTIFY_PATH,
        {},
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(403)
    })

    it('403s opponent identify when self-research is only queued (not completed)', async () => {
      const campaign = await seedCampaign({ isPro: true })
      await seedSelfResearch(
        campaign.id,
        RaceOpponentResearchStatus.queued,
        'run-q',
      )
      flagOn()

      const result = await service.client.post(
        IDENTIFY_PATH,
        {},
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(403)
    })

    it('allows opponent identify once a self-research pass is completed', async () => {
      const campaign = await seedCampaign({ isPro: true })
      await seedSelfResearch(
        campaign.id,
        RaceOpponentResearchStatus.completed,
        'run-done',
      )
      flagOn()

      const result = await service.client.post(
        IDENTIFY_PATH,
        {},
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(201)
      expect(result.data).toEqual({ opponentNames: [] })
    })

    it('403s opponent identify for a non-Pro campaign even with a completed self pass', async () => {
      const campaign = await seedCampaign({ isPro: false })
      await seedSelfResearch(
        campaign.id,
        RaceOpponentResearchStatus.completed,
        'run-done',
      )
      flagOn()

      const result = await service.client.post(
        IDENTIFY_PATH,
        {},
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(403)
    })

    it('403s opponent identify when the flag is off even with a completed self pass', async () => {
      const campaign = await seedCampaign({ isPro: true })
      await seedSelfResearch(
        campaign.id,
        RaceOpponentResearchStatus.completed,
        'run-done',
      )
      vi.spyOn(
        service.app.get(FeaturesService),
        'isFeatureEnabled',
      ).mockResolvedValue(false)

      const result = await service.client.post(
        IDENTIFY_PATH,
        {},
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(403)
    })
  })

  describe('POST /self-research (start)', () => {
    it('dispatches self_research and claims a queued research row', async () => {
      await seedCampaign({ isPro: true })
      flagOn()
      const dispatchRun = vi
        .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
        .mockResolvedValue({ runId: 'run-1' } as never)

      const result = await service.client.post(
        START_PATH,
        {},
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(201)
      expect(result.data.research.status).toBe('queued')
      expect(result.data.research.runId).toBe('run-1')
      expect(result.data.research.attempts).toBe(1)
      expect(dispatchRun).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'self_research',
          organizationSlug: SLUG,
          params: expect.objectContaining({ full_name: expect.any(String) }),
        }),
      )
    })

    it('reuses an in-flight pass instead of dispatching a duplicate', async () => {
      const campaign = await seedCampaign({ isPro: true })
      await seedSelfResearch(
        campaign.id,
        RaceOpponentResearchStatus.running,
        'run-inflight',
      )
      flagOn()
      const dispatchRun = vi.spyOn(
        service.app.get(ExperimentRunsService),
        'dispatchRun',
      )

      const result = await service.client.post(
        START_PATH,
        {},
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(201)
      expect(result.data.research.runId).toBe('run-inflight')
      expect(dispatchRun).not.toHaveBeenCalled()
    })

    it('returns the existing pass without re-dispatching after completion', async () => {
      const campaign = await seedCampaign({ isPro: true })
      const completed = await seedSelfResearch(
        campaign.id,
        RaceOpponentResearchStatus.completed,
        'run-complete',
      )
      flagOn()
      const dispatchRun = vi.spyOn(
        service.app.get(ExperimentRunsService),
        'dispatchRun',
      )

      const result = await service.client.post(
        START_PATH,
        {},
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(201)
      expect(result.data.research.status).toBe('completed')
      expect(result.data.research.runId).toBe('run-complete')
      expect(dispatchRun).not.toHaveBeenCalled()
      // The completed row is untouched (not overwritten to queued/null).
      const row = await service.prisma.raceOpponentResearch.findFirstOrThrow({
        where: { id: completed.id },
      })
      expect(row.status).toBe(RaceOpponentResearchStatus.completed)
      expect(row.runId).toBe('run-complete')
    })

    it('rolls the claim back to failed when dispatch throws (no orphan run)', async () => {
      await seedCampaign({ isPro: true })
      flagOn()
      vi.spyOn(
        service.app.get(ExperimentRunsService),
        'dispatchRun',
      ).mockRejectedValue(new Error('SQS down'))

      const result = await service.client.post(
        START_PATH,
        {},
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(500)
      const row = await service.prisma.raceOpponentResearch.findFirstOrThrow({
        where: { kind: RaceOpponentFindingKind.self },
      })
      expect(row.status).toBe(RaceOpponentResearchStatus.failed)
      expect(row.runId).toBeNull()
    })

    it('rolls the row to failed when the runId-bind update throws', async () => {
      await seedCampaign({ isPro: true })
      flagOn()
      vi.spyOn(
        service.app.get(ExperimentRunsService),
        'dispatchRun',
      ).mockResolvedValue({ runId: 'run-bind' } as never)
      // No existing row, so the claim uses model.create and the only model.update
      // call is the runId bind; rollbackClaim then updates the row to failed.
      // Make the bind (first update) throw while the rollback (second) succeeds.
      const seam = service.app.get(SelfResearchService) as unknown as ModelSeam
      const realUpdate = seam.model.update.bind(seam.model)
      let updateCalls = 0
      vi.spyOn(seam.model, 'update').mockImplementation((args: ModelArgs) => {
        updateCalls += 1
        return updateCalls === 1
          ? Promise.reject(new Error('bind failed'))
          : realUpdate(args)
      })

      const result = await service.client.post(
        START_PATH,
        {},
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(500)
      const row = await service.prisma.raceOpponentResearch.findFirstOrThrow({
        where: { kind: RaceOpponentFindingKind.self },
      })
      expect(row.status).toBe(RaceOpponentResearchStatus.failed)
      expect(row.runId).toBeNull()
    })

    it('403s when the campaign is not Pro', async () => {
      await seedCampaign({ isPro: false })
      flagOn()

      const result = await service.client.post(
        START_PATH,
        {},
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(403)
    })
  })

  describe('GET /self-research/status', () => {
    it('reports not_started when no pass exists', async () => {
      await seedCampaign({ isPro: true })
      flagOn()

      const result = await service.client.get(STATUS_PATH, {
        headers: { [ORG_SLUG_HEADER]: SLUG },
      })

      expect(result.status).toBe(200)
      expect(result.data).toEqual({ status: 'not_started', research: null })
    })

    it('reports the persisted status', async () => {
      const campaign = await seedCampaign({ isPro: true })
      await seedSelfResearch(
        campaign.id,
        RaceOpponentResearchStatus.completed,
        'run-c',
      )
      flagOn()

      const result = await service.client.get(STATUS_PATH, {
        headers: { [ORG_SLUG_HEADER]: SLUG },
      })

      expect(result.status).toBe(200)
      expect(result.data.status).toBe('completed')
    })
  })

  describe('RaceOpponentResearchPersistService.onExperimentRunCompleted', () => {
    let campaignId: number

    beforeEach(async () => {
      const campaign = await seedCampaign({ isPro: true })
      campaignId = campaign.id
    })

    it('persists findings with drafted responses and sets the row completed', async () => {
      await seedSelfResearch(
        campaignId,
        RaceOpponentResearchStatus.running,
        'run-a',
      )
      const run = await seedRun('run-a', ExperimentRunStatus.COMPLETED)
      stubArtifact([validFinding()])
      stubReachability()
      const track = stubTrack()

      await service.app
        .get(RaceOpponentResearchPersistService)
        .onExperimentRunCompleted(run)

      const research =
        await service.prisma.raceOpponentResearch.findFirstOrThrow({
          where: { campaignId },
          include: { findings: true },
        })
      expect(research.status).toBe(RaceOpponentResearchStatus.completed)
      expect(research.completedAt).not.toBeNull()
      expect(research.findings).toHaveLength(1)
      const finding = firstOrThrow(research.findings)
      expect(finding.claim).toBe('Voted to raise property taxes in 2021')
      expect(finding.draftedResponse).toBe(
        'The 2021 budget funded schools; I stand by that vote.',
      )
      expect(finding.sourceUrl).toBe(REACHABLE)
      expect(finding.sourceReachableAt).not.toBeNull()

      // Self-research completion is the funnel's first server-truth step.
      expect(track).toHaveBeenCalledWith(
        service.user.id,
        EVENTS.RaceOpponent.SelfResearchCompleted,
        expect.objectContaining({ campaignId, findingCount: 1 }),
      )
    })

    it('does not fire Self Research Completed when the run failed', async () => {
      await seedSelfResearch(
        campaignId,
        RaceOpponentResearchStatus.running,
        'run-fail-track',
      )
      const run = await seedRun('run-fail-track', ExperimentRunStatus.FAILED)
      const track = stubTrack()

      await service.app
        .get(RaceOpponentResearchPersistService)
        .onExperimentRunCompleted(run)

      expect(track).not.toHaveBeenCalledWith(
        expect.anything(),
        EVENTS.RaceOpponent.SelfResearchCompleted,
        expect.anything(),
      )
    })

    it('drops a finding whose source_url is unreachable, keeps reachable ones', async () => {
      await seedSelfResearch(
        campaignId,
        RaceOpponentResearchStatus.running,
        'run-mixed',
      )
      const run = await seedRun('run-mixed', ExperimentRunStatus.COMPLETED)
      stubArtifact([
        validFinding(),
        validFinding({
          claim: 'Unverifiable claim',
          source_url: UNREACHABLE,
        }),
      ])
      stubReachability()

      await service.app
        .get(RaceOpponentResearchPersistService)
        .onExperimentRunCompleted(run)

      const findings = await service.prisma.raceOpponentFinding.findMany({
        where: { research: { campaignId } },
      })
      expect(findings).toHaveLength(1)
      expect(findings[0]?.sourceUrl).toBe(REACHABLE)
    })

    it('is idempotent: a replayed callback (same runId) does not duplicate', async () => {
      await seedSelfResearch(
        campaignId,
        RaceOpponentResearchStatus.running,
        'run-dup',
      )
      const run = await seedRun('run-dup', ExperimentRunStatus.COMPLETED)
      stubArtifact([validFinding()])
      stubReachability()

      const persist = service.app.get(RaceOpponentResearchPersistService)
      await persist.onExperimentRunCompleted(run)
      await persist.onExperimentRunCompleted(run)

      const findings = await service.prisma.raceOpponentFinding.findMany({
        where: { research: { campaignId } },
      })
      expect(findings).toHaveLength(1)
    })

    it('a failed run leaves zero findings and status=failed', async () => {
      await seedSelfResearch(
        campaignId,
        RaceOpponentResearchStatus.running,
        'run-fail',
      )
      const run = await seedRun('run-fail', ExperimentRunStatus.FAILED)
      const getFile = vi.spyOn(service.app.get(S3Service), 'getFile')

      await service.app
        .get(RaceOpponentResearchPersistService)
        .onExperimentRunCompleted(run)

      const research =
        await service.prisma.raceOpponentResearch.findFirstOrThrow({
          where: { campaignId },
          include: { findings: true },
        })
      expect(research.status).toBe(RaceOpponentResearchStatus.failed)
      expect(research.findings).toHaveLength(0)
      expect(getFile).not.toHaveBeenCalled()
    })

    it('swallows a markResearchFailed fault on the FAILED branch (no rethrow)', async () => {
      await seedSelfResearch(
        campaignId,
        RaceOpponentResearchStatus.running,
        'run-fail-throws',
      )
      const run = await seedRun('run-fail-throws', ExperimentRunStatus.FAILED)
      const persist = service.app.get(RaceOpponentResearchPersistService)
      // A DB fault marking the row failed must not propagate: rethrowing would
      // requeue, but the consumer's terminal-status guard drops the redelivery,
      // leaving the row stuck running forever.
      vi.spyOn(
        persist as unknown as MarkFailedSeam,
        'markResearchFailed',
      ).mockRejectedValue(new Error('db down'))

      await expect(
        persist.onExperimentRunCompleted(run),
      ).resolves.toBeUndefined()
    })

    it('is a no-op for a non-self_research run', async () => {
      const run = await service.prisma.experimentRun.create({
        data: {
          runId: 'run-other',
          organizationSlug: SLUG,
          experimentType: 'opposition_research',
          status: ExperimentRunStatus.COMPLETED,
          artifactBucket: 'bucket',
          artifactKey: 'run-other.json',
        },
      })
      const getFile = vi.spyOn(service.app.get(S3Service), 'getFile')

      await service.app
        .get(RaceOpponentResearchPersistService)
        .onExperimentRunCompleted(run)

      expect(getFile).not.toHaveBeenCalled()
    })

    it('completed report route returns persisted findings for the owner', async () => {
      await seedSelfResearch(
        campaignId,
        RaceOpponentResearchStatus.running,
        'run-report',
      )
      const run = await seedRun('run-report', ExperimentRunStatus.COMPLETED)
      stubArtifact([validFinding()])
      stubReachability()
      await service.app
        .get(RaceOpponentResearchPersistService)
        .onExperimentRunCompleted(run)
      flagOn()

      const result = await service.client.get(REPORT_PATH, {
        headers: { [ORG_SLUG_HEADER]: SLUG },
      })

      expect(result.status).toBe(200)
      expect(result.data.research.status).toBe('completed')
      expect(result.data.research.findings).toHaveLength(1)
      expect(result.data.research.findings[0].draftedResponse).toBe(
        'The 2021 budget funded schools; I stand by that vote.',
      )
    })
  })
})
