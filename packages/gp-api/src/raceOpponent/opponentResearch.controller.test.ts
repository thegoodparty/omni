import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { ElectionApiService } from '@/campaignStrategy/services/electionApi.service'
import { RaceOpponentResearchPersistService } from '@/raceOpponent/services/raceOpponentResearchPersist.service'
import { OpponentResearchService } from '@/raceOpponent/services/opponentResearch.service'
import { ContrastEngineService } from '@/raceOpponent/services/contrastEngine.service'
import { RaceOpponentResearch } from '@/generated/prisma'
import { S3Service } from '@/vendors/aws/services/s3.service'
import {
  ExperimentRunStatus,
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
} from '@/generated/prisma'
import { RaceContextFromApi } from '@/campaignStrategy/types/electionApi.types'

const service = useTestService()

const SLUG = 'campaign-opp'
const ORG_SLUG_HEADER = 'X-Organization-Slug'
const IDENTIFY_PATH = '/v1/campaigns/mine/race-opponent/opponents/identify'
const RESEARCH_PATH = '/v1/campaigns/mine/race-opponent/opponents/research'
const PROFILE_PATH = '/v1/campaigns/mine/race-opponent/opponents/profile'

const OPPONENT = 'Jane Rival'
const REACHABLE = 'https://ballotpedia.org/Jane_Rival'
const UNREACHABLE = 'https://gone.example.com/missing'
const DATASET_REF = 'l2:int__l2_nationwide_uniform_w_haystaq'

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

const seedSelfComplete = (campaignId: number) =>
  service.prisma.raceOpponentResearch.create({
    data: {
      campaignId,
      kind: RaceOpponentFindingKind.self,
      status: RaceOpponentResearchStatus.completed,
      runId: 'self-done',
    },
  })

const seedOpponentResearch = (
  campaignId: number,
  status: RaceOpponentResearchStatus,
  runId: string,
  opponentName = OPPONENT,
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

const seedRun = (
  runId: string,
  status: ExperimentRunStatus,
  experimentType = 'opponent_research',
) =>
  service.prisma.experimentRun.create({
    data: {
      runId,
      organizationSlug: SLUG,
      experimentType,
      status,
      ...(status === ExperimentRunStatus.COMPLETED
        ? { artifactBucket: 'bucket', artifactKey: `${runId}.json` }
        : {}),
    },
  })

const seedSelfRunning = (campaignId: number, runId: string) =>
  service.prisma.raceOpponentResearch.create({
    data: {
      campaignId,
      kind: RaceOpponentFindingKind.self,
      status: RaceOpponentResearchStatus.running,
      runId,
    },
  })

const flagOn = () =>
  vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(true)

const stubRaceContext = (candidates: string[]) =>
  vi
    .spyOn(service.app.get(ElectionApiService), 'getRaceContext')
    .mockResolvedValue({
      state: 'NC',
      candidateOffice: 'City Council',
      officialOfficeName: 'Fayetteville City Council',
      officeLevel: null,
      officeType: null,
      primaryElectionDate: null,
      generalElectionDate: '2026-11-03',
      relevantElectionDate: null,
      numberOfSeats: null,
      projectedTurnout: null,
      civicsWinNumber: null,
      winNumberEstimate: null,
      winNumberEffective: null,
      contactsNeededEstimate: null,
      candidateCount: candidates.length,
      candidates: candidates.map((fullName) => ({
        gpCandidateId: null,
        firstName: fullName.split(' ')[0],
        lastName: fullName.split(' ').slice(1).join(' '),
        fullName,
        email: null,
        websiteUrl: null,
        party: null,
        isIncumbent: null,
      })),
    } satisfies RaceContextFromApi)

const stubArtifact = (
  findings: unknown[],
  generatedAt = '2026-06-27T00:00:00.000Z',
) =>
  vi.spyOn(service.app.get(S3Service), 'getFile').mockResolvedValue(
    JSON.stringify({
      findings,
      generated_at: generatedAt,
      residency_data: 'available',
    }),
  )

type ReachabilitySeam = { checkReachable(url: string): Promise<Date | null> }
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

const opponentFinding = (overrides: Record<string, unknown> = {}) => ({
  category: 'record',
  claim: 'Voted to raise property taxes in 2021',
  source_extract: 'Council member voted yes on the 2021 levy.',
  source_url: REACHABLE,
  source_title: 'City Council Minutes',
  occurred_at: '2021-06-01',
  ...overrides,
})

// A candidate position the engine can pair with an opponent finding: its issue
// name must appear as a whole word in the finding's claim/category ('taxes'
// matches the default opponentFinding claim).
const seedCandidatePosition = async (
  campaignId: number,
  issueName: string,
  description: string,
) => {
  const topIssue = await service.prisma.topIssue.create({
    data: { name: issueName },
  })
  const position = await service.prisma.position.create({
    data: { name: `${issueName} position`, topIssueId: topIssue.id },
  })
  await service.prisma.campaignPosition.create({
    data: {
      campaignId,
      positionId: position.id,
      topIssueId: topIssue.id,
      description,
    },
  })
}

describe('Opponent research dispatch + persist', () => {
  describe('the self-research + access gates on start', () => {
    it('403s opponent research when no self-research pass is completed', async () => {
      await seedCampaign({ isPro: true })
      flagOn()

      const result = await service.client.post(
        RESEARCH_PATH,
        { opponentName: OPPONENT },
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(403)
    })

    it('403s opponent research for a non-Pro campaign with a completed self pass', async () => {
      const campaign = await seedCampaign({ isPro: false })
      await seedSelfComplete(campaign.id)
      flagOn()

      const result = await service.client.post(
        RESEARCH_PATH,
        { opponentName: OPPONENT },
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(403)
    })

    it('403s opponent research when the flag is off with a completed self pass', async () => {
      const campaign = await seedCampaign({ isPro: true })
      await seedSelfComplete(campaign.id)
      vi.spyOn(
        service.app.get(FeaturesService),
        'isFeatureEnabled',
      ).mockResolvedValue(false)

      const result = await service.client.post(
        RESEARCH_PATH,
        { opponentName: OPPONENT },
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(403)
    })

    it('400s opponent research without a confirmed opponentName', async () => {
      const campaign = await seedCampaign({ isPro: true })
      await seedSelfComplete(campaign.id)
      flagOn()
      const dispatchRun = vi.spyOn(
        service.app.get(ExperimentRunsService),
        'dispatchRun',
      )

      const result = await service.client.post(
        RESEARCH_PATH,
        { opponentName: '' },
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(400)
      expect(dispatchRun).not.toHaveBeenCalled()
    })
  })

  describe('POST /opponents/research (start)', () => {
    it('dispatches opponent_research and claims a queued row', async () => {
      const campaign = await seedCampaign({ isPro: true })
      await seedSelfComplete(campaign.id)
      flagOn()
      const dispatchRun = vi
        .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
        .mockResolvedValue({ runId: 'opp-1' } as never)

      const result = await service.client.post(
        RESEARCH_PATH,
        { opponentName: OPPONENT },
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(201)
      expect(result.data.research.status).toBe('queued')
      expect(result.data.research.runId).toBe('opp-1')
      expect(result.data.research.opponentName).toBe(OPPONENT)
      expect(result.data.research.attempts).toBe(1)
      expect(dispatchRun).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'opponent_research',
          organizationSlug: SLUG,
          params: expect.objectContaining({
            opponent: expect.objectContaining({ full_name: OPPONENT }),
          }),
        }),
      )
    })

    it('reuses an in-flight pass instead of dispatching a duplicate', async () => {
      const campaign = await seedCampaign({ isPro: true })
      await seedSelfComplete(campaign.id)
      await seedOpponentResearch(
        campaign.id,
        RaceOpponentResearchStatus.running,
        'opp-inflight',
      )
      flagOn()
      const dispatchRun = vi.spyOn(
        service.app.get(ExperimentRunsService),
        'dispatchRun',
      )

      const result = await service.client.post(
        RESEARCH_PATH,
        { opponentName: OPPONENT },
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(201)
      expect(result.data.research.runId).toBe('opp-inflight')
      expect(dispatchRun).not.toHaveBeenCalled()
    })

    it('rolls the claim back to failed when dispatch throws (no orphan run)', async () => {
      const campaign = await seedCampaign({ isPro: true })
      await seedSelfComplete(campaign.id)
      flagOn()
      vi.spyOn(
        service.app.get(ExperimentRunsService),
        'dispatchRun',
      ).mockRejectedValue(new Error('SQS down'))

      const result = await service.client.post(
        RESEARCH_PATH,
        { opponentName: OPPONENT },
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(500)
      const row = await service.prisma.raceOpponentResearch.findFirstOrThrow({
        where: { kind: RaceOpponentFindingKind.opponent },
      })
      expect(row.status).toBe(RaceOpponentResearchStatus.failed)
      expect(row.runId).toBeNull()
    })

    it('returns the existing in-flight row on a concurrent P2002 claim', async () => {
      const campaign = await seedCampaign({ isPro: true })
      await seedSelfComplete(campaign.id)
      flagOn()
      const winner = await seedOpponentResearch(
        campaign.id,
        RaceOpponentResearchStatus.queued,
        'opp-winner',
      )
      // Force the create path (no existing row visible to this caller's read)
      // and have create trip the unique constraint, mirroring a concurrent POST.
      const opp = service.app.get(OpponentResearchService) as unknown as {
        opponentRow(id: number, name: string): Promise<RaceOpponentResearch>
        model: { findFirst(args: unknown): Promise<RaceOpponentResearch> }
      }
      let calls = 0
      vi.spyOn(opp, 'opponentRow').mockImplementation(
        (id: number, name: string) => {
          calls += 1
          return calls === 1
            ? Promise.resolve(null as unknown as RaceOpponentResearch)
            : opp.model.findFirst({
                where: {
                  campaignId: id,
                  kind: RaceOpponentFindingKind.opponent,
                  opponentName: name,
                },
              })
        },
      )

      const result = await service.client.post(
        RESEARCH_PATH,
        { opponentName: OPPONENT },
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(201)
      expect(result.data.research.id).toBe(winner.id)
      expect(result.data.research.runId).toBe('opp-winner')
    })
  })

  describe('the self-research + access gates on GET /opponents/profile', () => {
    it('403s profile when no self-research pass is completed', async () => {
      await seedCampaign({ isPro: true })
      flagOn()

      const result = await service.client.get(PROFILE_PATH, {
        headers: { [ORG_SLUG_HEADER]: SLUG },
        params: { opponentName: OPPONENT },
      })

      expect(result.status).toBe(403)
    })

    it('403s profile for a non-Pro campaign with a completed self pass', async () => {
      const campaign = await seedCampaign({ isPro: false })
      await seedSelfComplete(campaign.id)
      flagOn()

      const result = await service.client.get(PROFILE_PATH, {
        headers: { [ORG_SLUG_HEADER]: SLUG },
        params: { opponentName: OPPONENT },
      })

      expect(result.status).toBe(403)
    })

    it('403s profile when the flag is off with a completed self pass', async () => {
      const campaign = await seedCampaign({ isPro: true })
      await seedSelfComplete(campaign.id)
      vi.spyOn(
        service.app.get(FeaturesService),
        'isFeatureEnabled',
      ).mockResolvedValue(false)

      const result = await service.client.get(PROFILE_PATH, {
        headers: { [ORG_SLUG_HEADER]: SLUG },
        params: { opponentName: OPPONENT },
      })

      expect(result.status).toBe(403)
    })
  })

  describe('POST /opponents/identify', () => {
    it('defaults opponent names from the roster, excluding the candidate', async () => {
      const campaign = await seedCampaign({ isPro: true })
      await seedSelfComplete(campaign.id)
      flagOn()
      await service.prisma.campaign.update({
        where: { id: campaign.id },
        data: { details: { raceId: 'br-1' } },
      })
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { firstName: 'Me', lastName: 'Candidate' },
      })
      stubRaceContext(['Me Candidate', OPPONENT, 'Bob Other'])

      const result = await service.client.post(
        IDENTIFY_PATH,
        {},
        { headers: { [ORG_SLUG_HEADER]: SLUG } },
      )

      expect(result.status).toBe(201)
      expect(result.data.opponentNames).toEqual([OPPONENT, 'Bob Other'])
    })
  })

  describe('RaceOpponentResearchPersistService (opponent_research)', () => {
    let campaignId: number

    beforeEach(async () => {
      const campaign = await seedCampaign({ isPro: true })
      campaignId = campaign.id
    })

    it('persists only the reachable web finding, dropping the unreachable one', async () => {
      await seedOpponentResearch(
        campaignId,
        RaceOpponentResearchStatus.running,
        'opp-mixed',
      )
      const run = await seedRun('opp-mixed', ExperimentRunStatus.COMPLETED)
      stubArtifact([
        opponentFinding(),
        opponentFinding({
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
      expect(findings[0].sourceUrl).toBe(REACHABLE)
      expect(findings[0].sourceReachableAt).not.toBeNull()
      // Opponent findings carry no drafted response.
      expect(findings[0].draftedResponse).toBeNull()
    })

    it('persists a dataset (l2:) finding with sourceReachableAt and no network call', async () => {
      await seedOpponentResearch(
        campaignId,
        RaceOpponentResearchStatus.running,
        'opp-residency',
      )
      const run = await seedRun('opp-residency', ExperimentRunStatus.COMPLETED)
      stubArtifact([
        opponentFinding({
          category: 'residency',
          claim: 'Registered to vote outside the district',
          source_url: DATASET_REF,
          source_extract: 'Registration state: SC; registered 2019.',
          occurred_at: null,
        }),
      ])
      const checkReachable = stubReachability()

      await service.app
        .get(RaceOpponentResearchPersistService)
        .onExperimentRunCompleted(run)

      const findings = await service.prisma.raceOpponentFinding.findMany({
        where: { research: { campaignId } },
      })
      expect(findings).toHaveLength(1)
      expect(findings[0].sourceUrl).toBe(DATASET_REF)
      expect(findings[0].sourceReachableAt).not.toBeNull()
      expect(checkReachable).not.toHaveBeenCalled()
    })

    it('drops a self-research finding whose source_url is an l2: ref (no dataset path for self)', async () => {
      await seedSelfRunning(campaignId, 'self-l2')
      const run = await seedRun(
        'self-l2',
        ExperimentRunStatus.COMPLETED,
        'self_research',
      )
      // A self finding can never legitimately carry an l2: source (self-research
      // has no L2 path) — the URL-scheme schema rejects it at parse, so it must
      // never be persisted as grounded without the reachability check.
      stubArtifact([
        {
          category: 'record',
          claim: 'Fabricated dataset-sourced self claim',
          drafted_response: 'A response that should never persist.',
          source_extract: 'Registration state: SC.',
          source_url: DATASET_REF,
        },
      ])
      const checkReachable = stubReachability()

      await service.app
        .get(RaceOpponentResearchPersistService)
        .onExperimentRunCompleted(run)

      const research =
        await service.prisma.raceOpponentResearch.findFirstOrThrow({
          where: { campaignId, kind: RaceOpponentFindingKind.self },
          include: { findings: true },
        })
      expect(research.status).toBe(RaceOpponentResearchStatus.completed)
      expect(research.findings).toHaveLength(0)
      expect(checkReachable).not.toHaveBeenCalled()
    })

    it('is idempotent: a replayed callback (same runId) does not duplicate', async () => {
      await seedOpponentResearch(
        campaignId,
        RaceOpponentResearchStatus.running,
        'opp-dup',
      )
      const run = await seedRun('opp-dup', ExperimentRunStatus.COMPLETED)
      stubArtifact([opponentFinding()])
      stubReachability()

      const persist = service.app.get(RaceOpponentResearchPersistService)
      await persist.onExperimentRunCompleted(run)
      await persist.onExperimentRunCompleted(run)

      const findings = await service.prisma.raceOpponentFinding.findMany({
        where: { research: { campaignId } },
      })
      expect(findings).toHaveLength(1)
    })

    it('auto-generates contrasts from the new findings on opponent completion', async () => {
      await seedCandidatePosition(
        campaignId,
        'taxes',
        'will freeze the property tax rate',
      )
      await seedOpponentResearch(
        campaignId,
        RaceOpponentResearchStatus.running,
        'opp-contrast',
      )
      const run = await seedRun('opp-contrast', ExperimentRunStatus.COMPLETED)
      // category must be in the contrast allowlist for the engine to pair it.
      stubArtifact([opponentFinding({ category: 'voting_record' })])
      stubReachability()

      await service.app
        .get(RaceOpponentResearchPersistService)
        .onExperimentRunCompleted(run)

      const contrasts = await service.prisma.raceOpponentContrast.findMany({
        where: { campaignId },
      })
      expect(contrasts).toHaveLength(1)
      expect(contrasts[0].opponentFact).toBe(opponentFinding().claim)
    })

    it('a contrast-generation failure does not fail the persist', async () => {
      await seedOpponentResearch(
        campaignId,
        RaceOpponentResearchStatus.running,
        'opp-contrast-fail',
      )
      const run = await seedRun(
        'opp-contrast-fail',
        ExperimentRunStatus.COMPLETED,
      )
      stubArtifact([opponentFinding()])
      stubReachability()
      vi.spyOn(
        service.app.get(ContrastEngineService),
        'generate',
      ).mockRejectedValue(new Error('contrast engine boom'))

      await expect(
        service.app
          .get(RaceOpponentResearchPersistService)
          .onExperimentRunCompleted(run),
      ).resolves.toBeUndefined()

      const research =
        await service.prisma.raceOpponentResearch.findFirstOrThrow({
          where: { campaignId, kind: RaceOpponentFindingKind.opponent },
          include: { findings: true },
        })
      expect(research.status).toBe(RaceOpponentResearchStatus.completed)
      expect(research.findings).toHaveLength(1)
    })

    it('a failed run leaves zero findings and status=failed', async () => {
      await seedOpponentResearch(
        campaignId,
        RaceOpponentResearchStatus.running,
        'opp-fail',
      )
      const run = await seedRun('opp-fail', ExperimentRunStatus.FAILED)
      const getFile = vi.spyOn(service.app.get(S3Service), 'getFile')

      await service.app
        .get(RaceOpponentResearchPersistService)
        .onExperimentRunCompleted(run)

      const research =
        await service.prisma.raceOpponentResearch.findFirstOrThrow({
          where: { campaignId, kind: RaceOpponentFindingKind.opponent },
          include: { findings: true },
        })
      expect(research.status).toBe(RaceOpponentResearchStatus.failed)
      expect(research.findings).toHaveLength(0)
      expect(getFile).not.toHaveBeenCalled()
    })

    it('profile route returns persisted findings for the owner', async () => {
      await seedSelfComplete(campaignId)
      await seedOpponentResearch(
        campaignId,
        RaceOpponentResearchStatus.running,
        'opp-profile',
      )
      const run = await seedRun('opp-profile', ExperimentRunStatus.COMPLETED)
      stubArtifact([opponentFinding()])
      stubReachability()
      await service.app
        .get(RaceOpponentResearchPersistService)
        .onExperimentRunCompleted(run)
      flagOn()

      const result = await service.client.get(PROFILE_PATH, {
        headers: { [ORG_SLUG_HEADER]: SLUG },
        params: { opponentName: OPPONENT },
      })

      expect(result.status).toBe(200)
      expect(result.data.research.status).toBe('completed')
      expect(result.data.research.findings).toHaveLength(1)
      expect(result.data.research.findings[0].sourceUrl).toBe(REACHABLE)
    })
  })
})
