import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { RaceOpponentPersistService } from '@/raceOpponent/services/raceOpponentPersist.service'
import { StrategicLandscapeParamsService } from '@/campaignStrategy/services/strategicLandscapeParams.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import {
  ExperimentRunStatus,
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
} from '@/generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = useTestService()

const SLUG = 'campaign-koo'
const OTHER_OWNER_ID = 999
const ORG_SLUG_HEADER = 'X-Organization-Slug'
const COLLECT_PATH = '/v1/campaigns/mine/race-opponent/collect'
const GET_PATH = '/v1/campaigns/mine/race-opponent'
const JANE = 'Jane Rival'
const BALLOTPEDIA = 'ballotpedia'

const RACE_HASH = 'race-hash-1'

const seedCampaign = async (opts: {
  slug: string
  ownerId: number
  isPro: boolean
  raceId?: string
}) => {
  await service.prisma.organization.create({
    data: { slug: opts.slug, ownerId: opts.ownerId },
  })
  return service.prisma.campaign.create({
    data: {
      userId: opts.ownerId,
      slug: `${opts.slug}-campaign`,
      organizationSlug: opts.slug,
      isPro: opts.isPro,
      ...(opts.raceId ? { details: { raceId: opts.raceId } } : {}),
    },
  })
}

// collect is now gated server-side on a completed self-research pass, so the
// happy-path collect tests must seed one. The gate is exercised on its own in
// the "403s collect when no self pass is completed" test below.
const seedCompletedSelfPass = (campaignId: number) =>
  service.prisma.raceOpponentResearch.create({
    data: {
      campaignId,
      kind: RaceOpponentFindingKind.self,
      status: RaceOpponentResearchStatus.completed,
      runId: 'self-done',
    },
  })

const seedOpponents = async (campaignId: number, names: string[]) => {
  const plan = await service.prisma.campaignStrategy.upsert({
    where: { campaignId },
    create: { campaignId, raceId: RACE_HASH },
    update: {},
  })
  await service.prisma.campaignStrategyOpponent.createMany({
    data: names.map((fullName) => ({
      campaignStrategyId: plan.id,
      fullName,
      partyAffiliation: 'Independent',
    })),
  })
  return plan
}

// Stub the opposition_research params build (election-api) so a discovery
// dispatch is exercised without real HTTP. dispatchRun itself is stubbed
// per-test; the fire-and-forget analytics track is a no-op in test env.
const stubDiscoveryDispatch = () => {
  vi.spyOn(
    service.app.get(StrategicLandscapeParamsService),
    'build',
  ).mockResolvedValue({} as never)
}

const flagOn = () =>
  vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(true)

describe('POST /v1/campaigns/mine/race-opponent/collect', () => {
  it('dispatches race_opponent_collection seeded from campaign plan opponents', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    await seedOpponents(campaign.id, [JANE, 'John Foe'])
    await seedCompletedSelfPass(campaign.id)
    flagOn()
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'run-123' } as never)

    const result = await service.client.post(
      COLLECT_PATH,
      {},
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )

    expect(result.status).toBe(201)
    expect(result.data).toEqual({ runId: 'run-123', status: 'running' })
    expect(dispatchRun).toHaveBeenCalledTimes(1)
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'race_opponent_collection',
        organizationSlug: SLUG,
        params: expect.objectContaining({
          opponents: [{ full_name: JANE }, { full_name: 'John Foe' }],
        }),
      }),
    )
    // Plan already has opponents — no discovery run.
    expect(dispatchRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'opposition_research' }),
    )
  })

  it('reuses an in-flight run instead of dispatching a duplicate', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    await seedOpponents(campaign.id, [JANE])
    await seedCompletedSelfPass(campaign.id)
    await service.prisma.experimentRun.create({
      data: {
        runId: 'run-inflight',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_collection',
        status: ExperimentRunStatus.QUEUED,
      },
    })
    flagOn()
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    const result = await service.client.post(
      COLLECT_PATH,
      {},
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )

    expect(result.status).toBe(201)
    expect(result.data).toEqual({ runId: 'run-inflight', status: 'running' })
    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('dispatches opposition_research (not a 400) when there are no plan opponents but a resolvable race', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
      raceId: RACE_HASH,
    })
    await seedCompletedSelfPass(campaign.id)
    flagOn()
    stubDiscoveryDispatch()
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'opp-run-1' } as never)

    const result = await service.client.post(
      COLLECT_PATH,
      {},
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )

    expect(result.status).toBe(201)
    expect(result.data).toEqual({ runId: 'opp-run-1', status: 'discovering' })
    expect(dispatchRun).toHaveBeenCalledTimes(1)
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'opposition_research' }),
    )
    // No names yet — collection is deferred until discovery completes and the
    // page re-fires collect.
    expect(dispatchRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'race_opponent_collection' }),
    )
  })

  it('reuses an in-flight opposition_research run instead of dispatching a duplicate', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
      raceId: RACE_HASH,
    })
    await service.prisma.experimentRun.create({
      data: {
        runId: 'opp-inflight',
        organizationSlug: SLUG,
        experimentType: 'opposition_research',
        status: ExperimentRunStatus.RUNNING,
      },
    })
    await service.prisma.campaignStrategy.create({
      data: {
        campaignId: campaign.id,
        raceId: RACE_HASH,
        oppositionRunId: 'opp-inflight',
      },
    })
    await seedCompletedSelfPass(campaign.id)
    flagOn()
    stubDiscoveryDispatch()
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    const result = await service.client.post(
      COLLECT_PATH,
      {},
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )

    expect(result.status).toBe(201)
    expect(result.data).toEqual({
      runId: 'opp-inflight',
      status: 'discovering',
    })
    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('settles to idle (no 500, no dispatch) when there is no resolvable race', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    await seedCompletedSelfPass(campaign.id)
    flagOn()
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    const result = await service.client.post(
      COLLECT_PATH,
      {},
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )

    expect(result.status).toBe(201)
    expect(result.data).toEqual({ runId: null, status: 'idle' })
    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('does not re-dispatch discovery for an uncontested race already discovered', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
      raceId: RACE_HASH,
    })
    // Discovery already ran and found nobody: persisted marker set, no opponents.
    await service.prisma.campaignStrategy.create({
      data: {
        campaignId: campaign.id,
        raceId: RACE_HASH,
        oppositionPersistedAt: new Date(),
      },
    })
    await seedCompletedSelfPass(campaign.id)
    flagOn()
    stubDiscoveryDispatch()
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    const result = await service.client.post(
      COLLECT_PATH,
      {},
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )

    expect(result.status).toBe(201)
    expect(result.data).toEqual({ runId: null, status: 'idle' })
    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('403s collect when no self-research pass is completed (the gate)', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    await seedOpponents(campaign.id, [JANE])
    // No completed self pass seeded — the gate must block the real opponent
    // trigger, not just the identify stub.
    flagOn()
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    const result = await service.client.post(
      COLLECT_PATH,
      {},
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )

    expect(result.status).toBe(403)
    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('403s when know-your-opponent is off', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    await seedOpponents(campaign.id, [JANE])
    await seedCompletedSelfPass(campaign.id)
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(false)
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    const result = await service.client.post(
      COLLECT_PATH,
      {},
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )

    expect(result.status).toBe(403)
    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('403s when the campaign is not Pro', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: false,
    })
    await seedOpponents(campaign.id, [JANE])
    // A completed self pass clears the self-research gate so this test exercises
    // the Pro gate specifically, not the gate added in this change.
    await seedCompletedSelfPass(campaign.id)
    const isFeatureEnabled = flagOn()

    const result = await service.client.post(
      COLLECT_PATH,
      {},
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )

    expect(result.status).toBe(403)
    // The Pro gate runs before the flag is read.
    expect(isFeatureEnabled).not.toHaveBeenCalled()
  })

  it('404s for a user who does not own the organization', async () => {
    await service.prisma.user.create({
      data: { id: OTHER_OWNER_ID, clerkId: 'user_other', email: 'o@gp.org' },
    })
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: OTHER_OWNER_ID,
      isPro: true,
    })
    await seedOpponents(campaign.id, [JANE])
    const isFeatureEnabled = flagOn()

    const result = await service.client.post(
      COLLECT_PATH,
      {},
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )

    expect(result.status).toBe(404)
    expect(isFeatureEnabled).not.toHaveBeenCalled()
  })
})

describe('GET /v1/campaigns/mine/race-opponent', () => {
  it('returns rows grouped by opponent with status + lastCollectedAt', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    await service.prisma.experimentRun.create({
      data: {
        runId: 'run-done',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_collection',
        status: ExperimentRunStatus.COMPLETED,
      },
    })
    await service.prisma.raceOpponent.createMany({
      data: [
        {
          campaignId: campaign.id,
          runId: 'run-done',
          opponentName: JANE,
          sourceType: BALLOTPEDIA,
          sourceUrl: 'https://ballotpedia.org/Jane_Rival',
          content: { text: 'bio' },
        },
        {
          campaignId: campaign.id,
          runId: 'run-done',
          opponentName: JANE,
          sourceType: 'opponent_website',
          sourceUrl: 'https://janerival.com',
          content: { text: 'platform' },
        },
        {
          campaignId: campaign.id,
          runId: 'run-done',
          opponentName: 'John Foe',
          sourceType: BALLOTPEDIA,
          sourceUrl: 'https://ballotpedia.org/John_Foe',
          content: { text: 'bio2' },
        },
      ],
    })
    flagOn()

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data.collectionStatus).toBe('completed')
    expect(result.data.lastCollectedAt).not.toBeNull()
    expect(result.data.opponents).toHaveLength(2)
    const jane = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(jane.items).toHaveLength(2)
  })

  it('returns a clean empty response when nothing has been collected', async () => {
    await seedCampaign({ slug: SLUG, ownerId: service.user.id, isPro: true })
    flagOn()

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data).toEqual({
      opponents: [],
      lastCollectedAt: null,
      collectionStatus: 'idle',
    })
  })

  it("reports discovering while this campaign's plan opposition_research is in flight and no collection run exists", async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    await service.prisma.experimentRun.create({
      data: {
        runId: 'opp-running',
        organizationSlug: SLUG,
        experimentType: 'opposition_research',
        status: ExperimentRunStatus.RUNNING,
      },
    })
    await service.prisma.campaignStrategy.create({
      data: {
        campaignId: campaign.id,
        raceId: RACE_HASH,
        oppositionRunId: 'opp-running',
      },
    })
    flagOn()

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data.collectionStatus).toBe('discovering')
  })

  it('does not report discovering for an opposition run not linked to this plan', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    await service.prisma.experimentRun.create({
      data: {
        runId: 'opp-unlinked',
        organizationSlug: SLUG,
        experimentType: 'opposition_research',
        status: ExperimentRunStatus.RUNNING,
      },
    })
    // Plan exists but its oppositionRunId was never linked (e.g. the run is the
    // campaign plan's own, or a transient link fault left it orphaned).
    await service.prisma.campaignStrategy.create({
      data: { campaignId: campaign.id, raceId: RACE_HASH },
    })
    flagOn()

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data.collectionStatus).toBe('idle')
  })

  it('reports failed when this campaign discovery run failed (so the page does not loop re-firing)', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    await service.prisma.experimentRun.create({
      data: {
        runId: 'opp-failed',
        organizationSlug: SLUG,
        experimentType: 'opposition_research',
        status: ExperimentRunStatus.FAILED,
      },
    })
    await service.prisma.campaignStrategy.create({
      data: {
        campaignId: campaign.id,
        raceId: RACE_HASH,
        oppositionRunId: 'opp-failed',
      },
    })
    flagOn()

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data.collectionStatus).toBe('failed')
  })

  it('a completed collection run wins over an in-flight opposition run', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    await service.prisma.experimentRun.createMany({
      data: [
        {
          runId: 'opp-running-2',
          organizationSlug: SLUG,
          experimentType: 'opposition_research',
          status: ExperimentRunStatus.RUNNING,
        },
        {
          runId: 'collection-done',
          organizationSlug: SLUG,
          experimentType: 'race_opponent_collection',
          status: ExperimentRunStatus.COMPLETED,
        },
      ],
    })
    // Link the in-flight opposition run to this campaign's plan so the discovery
    // branch WOULD report 'discovering' — the collection run must override it.
    await service.prisma.campaignStrategy.create({
      data: {
        campaignId: campaign.id,
        raceId: RACE_HASH,
        oppositionRunId: 'opp-running-2',
      },
    })
    flagOn()

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data.collectionStatus).toBe('completed')
  })
})

describe('RaceOpponentPersistService.onExperimentRunCompleted', () => {
  let campaignId: number

  beforeEach(async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    campaignId = campaign.id
  })

  const seedRun = (runId: string) =>
    service.prisma.experimentRun.create({
      data: {
        runId,
        organizationSlug: SLUG,
        experimentType: 'race_opponent_collection',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'bucket',
        artifactKey: `${runId}.json`,
      },
    })

  const stubArtifact = (items: unknown[]) =>
    vi
      .spyOn(service.app.get(S3Service), 'getFile')
      .mockResolvedValue(JSON.stringify({ items }))

  it('persists artifact items into race_opponent', async () => {
    const run = await seedRun('run-a')
    stubArtifact([
      {
        opponent_name: JANE,
        source_type: 'ballotpedia',
        source_url: 'https://ballotpedia.org/Jane_Rival',
        content: { text: 'bio' },
      },
    ])

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    const rows = await service.prisma.raceOpponent.findMany({
      where: { campaignId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].opponentName).toBe(JANE)
    expect(rows[0].sourceType).toBe('ballotpedia')
  })

  it('replaces prior rows on re-run (idempotent)', async () => {
    const first = await seedRun('run-a')
    stubArtifact([
      {
        opponent_name: JANE,
        source_type: 'ballotpedia',
        source_url: 'https://ballotpedia.org/Jane_Rival',
        content: { text: 'bio' },
      },
    ])
    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(first)

    const second = await seedRun('run-b')
    stubArtifact([
      {
        opponent_name: 'John Foe',
        source_type: 'opponent_website',
        source_url: 'https://johnfoe.com',
        content: { text: 'platform' },
      },
    ])
    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(second)

    const rows = await service.prisma.raceOpponent.findMany({
      where: { campaignId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].opponentName).toBe('John Foe')
    expect(rows[0].runId).toBe('run-b')
  })

  it('is a no-op for opposition_research (discovery does not auto-chain collection)', async () => {
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
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    expect(getFile).not.toHaveBeenCalled()
    expect(dispatchRun).not.toHaveBeenCalled()
    const rows = await service.prisma.raceOpponent.findMany({
      where: { campaignId },
    })
    expect(rows).toHaveLength(0)
  })

  it('drops items with no source_url but keeps valid ones, run stays COMPLETED', async () => {
    const run = await seedRun('run-mixed')
    stubArtifact([
      {
        opponent_name: JANE,
        source_type: 'ballotpedia',
        source_url: 'https://ballotpedia.org/Jane_Rival',
        content: { text: 'bio' },
      },
      {
        // No source_url — sourced-or-silent: dropped, not fatal.
        opponent_name: 'John Foe',
        source_type: 'opponent_website',
        content: { text: 'unsourced' },
      },
    ])

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    const rows = await service.prisma.raceOpponent.findMany({
      where: { campaignId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].opponentName).toBe(JANE)
    const persisted = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: 'run-mixed' },
    })
    expect(persisted.status).toBe(ExperimentRunStatus.COMPLETED)
  })

  it('completes with no rows when the agent found no sources', async () => {
    const run = await seedRun('run-empty')
    stubArtifact([])

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    const rows = await service.prisma.raceOpponent.findMany({
      where: { campaignId },
    })
    expect(rows).toHaveLength(0)
    const persisted = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: 'run-empty' },
    })
    expect(persisted.status).toBe(ExperimentRunStatus.COMPLETED)
  })

  it('preserves prior rows and stays COMPLETED on an empty re-run', async () => {
    await service.prisma.raceOpponent.create({
      data: {
        campaignId,
        runId: 'prior-run',
        opponentName: JANE,
        sourceType: 'ballotpedia',
        sourceUrl: 'https://ballotpedia.org/Jane_Rival',
        content: { text: 'prior bio' },
      },
    })
    const run = await seedRun('run-empty-rerun')
    stubArtifact([])

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    const rows = await service.prisma.raceOpponent.findMany({
      where: { campaignId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].runId).toBe('prior-run')
    const persisted = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: 'run-empty-rerun' },
    })
    expect(persisted.status).toBe(ExperimentRunStatus.COMPLETED)
  })

  it('keeps existing rows but marks the run FAILED when every item is dropped', async () => {
    await service.prisma.raceOpponent.create({
      data: {
        campaignId,
        runId: 'prior-run',
        opponentName: JANE,
        sourceType: 'ballotpedia',
        sourceUrl: 'https://ballotpedia.org/Jane_Rival',
        content: { text: 'prior bio' },
      },
    })
    const run = await seedRun('run-all-invalid')
    stubArtifact([
      {
        opponent_name: 'John Foe',
        source_type: 'opponent_website',
        content: { text: 'a' },
      },
      {
        opponent_name: 'Sue Rival',
        source_type: 'ballotpedia',
        content: { text: 'b' },
      },
    ])

    await expect(
      service.app.get(RaceOpponentPersistService).onExperimentRunCompleted(run),
    ).rejects.toThrow()

    // Prior rows are preserved — the throw happens before any deleteMany.
    const rows = await service.prisma.raceOpponent.findMany({
      where: { campaignId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].runId).toBe('prior-run')
    expect(rows[0].opponentName).toBe(JANE)
    const persisted = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: 'run-all-invalid' },
    })
    expect(persisted.status).toBe(ExperimentRunStatus.FAILED)
  })

  it('marks the run FAILED when the artifact envelope is unparseable', async () => {
    const run = await seedRun('run-bad-envelope')
    vi.spyOn(service.app.get(S3Service), 'getFile').mockResolvedValue(
      JSON.stringify({ notItems: true }),
    )

    await expect(
      service.app.get(RaceOpponentPersistService).onExperimentRunCompleted(run),
    ).rejects.toThrow()

    const persisted = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: 'run-bad-envelope' },
    })
    expect(persisted.status).toBe(ExperimentRunStatus.FAILED)
  })
})
