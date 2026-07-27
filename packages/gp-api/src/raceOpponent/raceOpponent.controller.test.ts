import { useTestService } from '@/test-service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { RaceOpponentPersistService } from '@/raceOpponent/services/raceOpponentPersist.service'
import { RaceOpponentService } from '@/raceOpponent/services/raceOpponent.service'
import { StrategicLandscapeParamsService } from '@/campaignStrategy/services/strategicLandscapeParams.service'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { ExperimentRun, ExperimentRunStatus } from '@/generated/prisma'
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

describe('POST /v1/campaigns/mine/race-opponent/collect', () => {
  it('dispatches race_opponent_collection seeded from campaign plan opponents', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    await seedOpponents(campaign.id, [JANE, 'John Foe'])
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
    await service.prisma.experimentRun.create({
      data: {
        runId: 'run-inflight',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_collection',
        status: ExperimentRunStatus.QUEUED,
      },
    })
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
    await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
      raceId: RACE_HASH,
    })
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
    await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
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

  it('dispatches without a completed self-research pass (relaxed path is not gated on it)', async () => {
    // ENG-10613: the relaxed /opponent page drives collect and never runs the
    // strict self_research engine, so a RaceOpponentResearch(kind=self) row
    // never exists. collect must still dispatch — Pro+flag is the only gate.
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    await seedOpponents(campaign.id, [JANE])
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'run-no-self' } as never)

    const result = await service.client.post(
      COLLECT_PATH,
      {},
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )

    expect(result.status).toBe(201)
    expect(result.data).toEqual({ runId: 'run-no-self', status: 'running' })
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'race_opponent_collection' }),
    )
  })

  it('403s when the campaign is not Pro', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: false,
    })
    await seedOpponents(campaign.id, [JANE])

    const result = await service.client.post(
      COLLECT_PATH,
      {},
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )

    expect(result.status).toBe(403)
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

    const result = await service.client.post(
      COLLECT_PATH,
      {},
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )

    expect(result.status).toBe(404)
  })
})

describe('GET /v1/campaigns/mine/race-opponent', () => {
  it('returns rows grouped by opponent with status + lastCollectedAt', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    // A fully-settled pipeline: the collection run completed AND the chained
    // summary run completed after it. collectionStatus only reports 'completed'
    // once the summary phase settles (ENG-10614), so seed both, with the
    // summary run explicitly newer than the collection run.
    await service.prisma.experimentRun.createMany({
      data: [
        {
          runId: 'run-done',
          organizationSlug: SLUG,
          experimentType: 'race_opponent_collection',
          status: ExperimentRunStatus.COMPLETED,
          createdAt: new Date('2026-06-30T10:00:00.000Z'),
        },
        {
          runId: 'summary-done',
          organizationSlug: SLUG,
          experimentType: 'race_opponent_summary',
          status: ExperimentRunStatus.COMPLETED,
          createdAt: new Date('2026-06-30T10:05:00.000Z'),
        },
      ],
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

  it('enriches opponents with party + incumbency on a roster match, null otherwise', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    const plan = await service.prisma.campaignStrategy.create({
      data: { campaignId: campaign.id, raceId: RACE_HASH },
    })
    await service.prisma.campaignStrategyOpponent.create({
      data: {
        campaignStrategyId: plan.id,
        // Different case + surrounding whitespace from the collected name: the
        // conservative trim+lowercase match must still resolve it.
        fullName: ` ${JANE.toUpperCase()} `,
        partyAffiliation: 'Democratic',
        incumbent: true,
      },
    })
    await service.prisma.raceOpponent.createMany({
      data: [
        {
          campaignId: campaign.id,
          runId: 'run-x',
          opponentName: JANE,
          sourceType: BALLOTPEDIA,
          sourceUrl: 'https://ballotpedia.org/Jane_Rival',
          content: { text: 'bio' },
        },
        {
          campaignId: campaign.id,
          runId: 'run-x',
          opponentName: 'Unknown Foe',
          sourceType: BALLOTPEDIA,
          sourceUrl: 'https://ballotpedia.org/Unknown_Foe',
          content: { text: 'bio2' },
        },
      ],
    })

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    const jane = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(jane.party).toBe('Democratic')
    expect(jane.isIncumbent).toBe(true)
    const foe = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === 'Unknown Foe',
    )
    expect(foe.party).toBeNull()
    expect(foe.isIncumbent).toBeNull()
  })

  it('returns a clean empty response when nothing has been collected', async () => {
    await seedCampaign({ slug: SLUG, ownerId: service.user.id, isPro: true })

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data).toEqual({
      opponents: [],
      lastCollectedAt: null,
      collectionStatus: 'idle',
      fieldAnalysis: null,
      standoutActions: [],
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
    expect(rows[0]?.opponentName).toBe(JANE)
    expect(rows[0]?.sourceType).toBe('ballotpedia')
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
    expect(rows[0]?.opponentName).toBe('John Foe')
    expect(rows[0]?.runId).toBe('run-b')
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
    expect(rows[0]?.opponentName).toBe(JANE)
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
    expect(rows[0]?.runId).toBe('prior-run')
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
    expect(rows[0]?.runId).toBe('prior-run')
    expect(rows[0]?.opponentName).toBe(JANE)
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

describe('race_opponent_summary dispatch / persist / read', () => {
  const BALLOTPEDIA_URL = 'https://ballotpedia.org/Jane_Rival'
  const WEBSITE_URL = 'https://janerival.com'

  let campaignId: number

  beforeEach(async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    campaignId = campaign.id
  })

  const loadCampaign = () =>
    service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      include: { user: true },
    })

  const seedCollectedRow = (
    opts: Partial<{
      opponentName: string
      sourceType: 'ballotpedia' | 'opponent_website'
      sourceUrl: string
      text: string
    }> = {},
  ) =>
    service.prisma.raceOpponent.create({
      data: {
        campaignId,
        runId: 'collect-run',
        opponentName: opts.opponentName ?? JANE,
        sourceType: opts.sourceType ?? 'ballotpedia',
        sourceUrl: opts.sourceUrl ?? BALLOTPEDIA_URL,
        content: { text: opts.text ?? 'collected bio' },
      },
    })

  const seedSummaryRun = (runId: string) =>
    service.prisma.experimentRun.create({
      data: {
        runId,
        organizationSlug: SLUG,
        experimentType: 'race_opponent_summary',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'bucket',
        artifactKey: `${runId}.json`,
      },
    })

  const stubSummaryArtifact = (artifact: unknown) =>
    vi
      .spyOn(service.app.get(S3Service), 'getFile')
      .mockResolvedValue(JSON.stringify(artifact))

  // v2 rich source: title/publisher (and optional description) ride along
  // with the url so the persist layer can carry them through unfiltered.
  const richSource = (
    url: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    url,
    title: 'Jane Rival - Ballotpedia',
    publisher: 'Ballotpedia',
    ...overrides,
  })

  // The rich source shape a resolvable URL round-trips to: the artifact's
  // title/publisher pass through unfiltered, plus the transitional
  // sourceUrl/sourceType passthrough (ENG-10630) resolved from the collected
  // row's sourceType.
  const expectedSource = (
    url: string,
    sourceType: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    url,
    title: 'Jane Rival - Ballotpedia',
    publisher: 'Ballotpedia',
    sourceUrl: url,
    sourceType,
    ...overrides,
  })

  const summaryArtifact = (
    opponentOverrides: Record<string, unknown> = {},
    envelopeOverrides: Record<string, unknown> = {},
  ) => ({
    generated_at: '2026-06-28T00:00:00.000Z',
    opponents: [
      {
        opponent_name: JANE,
        threat_tier: 'watch_closely',
        overview: {
          text: 'who they are',
          sources: [richSource(BALLOTPEDIA_URL)],
        },
        background: { text: 'career', sources: [richSource(BALLOTPEDIA_URL)] },
        ...opponentOverrides,
      },
    ],
    ...envelopeOverrides,
  })

  const fieldAnalysisArtifact = (overrides: Record<string, unknown> = {}) => ({
    strengths: ['Strong fundraising'],
    weaknesses: ['Low name recognition'],
    opportunities: ['Opponent has no published water position'],
    threats: [],
    sources: [richSource(BALLOTPEDIA_URL)],
    ...overrides,
  })

  it('dispatchSummary builds the grouped per-source input from collected rows', async () => {
    await seedCollectedRow({
      sourceType: 'ballotpedia',
      sourceUrl: BALLOTPEDIA_URL,
    })
    await seedCollectedRow({
      sourceType: 'opponent_website',
      sourceUrl: WEBSITE_URL,
      text: 'platform',
    })
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'summary-1' } as never)

    await service.app
      .get(RaceOpponentService)
      .dispatchSummary(await loadCampaign())

    expect(dispatchRun).toHaveBeenCalledTimes(1)
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'race_opponent_summary',
        organizationSlug: SLUG,
        params: expect.objectContaining({
          opponents: [
            {
              opponent_name: JANE,
              sources: [
                {
                  source_type: 'ballotpedia',
                  source_url: BALLOTPEDIA_URL,
                  text: 'collected bio',
                },
                {
                  source_type: 'opponent_website',
                  source_url: WEBSITE_URL,
                  text: 'platform',
                },
              ],
            },
          ],
        }),
      }),
    )
  })

  it('dispatchSummary is a no-op when there are no collected rows', async () => {
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    await service.app
      .get(RaceOpponentService)
      .dispatchSummary(await loadCampaign())

    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('dispatchSummary skips when a summary run is already in flight', async () => {
    await seedCollectedRow()
    await service.prisma.experimentRun.create({
      data: {
        runId: 'summary-inflight',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_summary',
        status: ExperimentRunStatus.RUNNING,
      },
    })
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    await service.app
      .get(RaceOpponentService)
      .dispatchSummary(await loadCampaign())

    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('chains a summary dispatch when a collection run completes', async () => {
    await seedCollectedRow()
    const collectionRun = await service.prisma.experimentRun.create({
      data: {
        runId: 'collect-done',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_collection',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'bucket',
        artifactKey: 'collect-done.json',
      },
    })
    vi.spyOn(service.app.get(S3Service), 'getFile').mockResolvedValue(
      JSON.stringify({
        items: [
          {
            opponent_name: JANE,
            source_type: 'ballotpedia',
            source_url: BALLOTPEDIA_URL,
            content: { text: 'bio' },
          },
        ],
      }),
    )
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'chained-summary' } as never)

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(collectionRun)

    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'race_opponent_summary' }),
    )
  })

  it('re-chains a summary when a FAILED summary leaves a newer collection unsummarized', async () => {
    await seedCollectedRow()
    // summary#1 FAILED at T1; collection#2 completed at T2 > T1 (its rows are
    // the ones seeded above) but its chained summary was skipped by the
    // in-flight dedup while summary#1 was running.
    const failedSummary = await service.prisma.experimentRun.create({
      data: {
        runId: 'summary-failed',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_summary',
        status: ExperimentRunStatus.FAILED,
        createdAt: new Date('2026-06-30T10:00:00.000Z'),
      },
    })
    await service.prisma.experimentRun.create({
      data: {
        runId: 'collect-newer',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_collection',
        status: ExperimentRunStatus.COMPLETED,
        createdAt: new Date('2026-06-30T10:05:00.000Z'),
      },
    })
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'rechained-summary' } as never)

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(failedSummary)

    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'race_opponent_summary' }),
    )
  })

  it('does not re-chain on a FAILED summary when no newer collection exists', async () => {
    await seedCollectedRow()
    const failedSummary = await service.prisma.experimentRun.create({
      data: {
        runId: 'summary-failed-solo',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_summary',
        status: ExperimentRunStatus.FAILED,
        createdAt: new Date('2026-06-30T10:05:00.000Z'),
      },
    })
    // The only collection completed BEFORE this summary (its own cycle), so
    // there is nothing newer to re-chain for — re-dispatching would loop.
    await service.prisma.experimentRun.create({
      data: {
        runId: 'collect-older',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_collection',
        status: ExperimentRunStatus.COMPLETED,
        createdAt: new Date('2026-06-30T10:00:00.000Z'),
      },
    })
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(failedSummary)

    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('re-chains for a newer collection even when the summary artifact fails to persist', async () => {
    await seedCollectedRow()
    const summary = await service.prisma.experimentRun.create({
      data: {
        runId: 'summary-bad',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_summary',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'bucket',
        artifactKey: 'summary-bad.json',
        createdAt: new Date('2026-06-30T10:00:00.000Z'),
      },
    })
    await service.prisma.experimentRun.create({
      data: {
        runId: 'collect-after-bad',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_collection',
        status: ExperimentRunStatus.COMPLETED,
        createdAt: new Date('2026-06-30T10:05:00.000Z'),
      },
    })
    // Unparseable artifact → onSummaryCompleted marks the run FAILED and
    // rethrows, but the finally must still re-chain for the newer collection.
    stubSummaryArtifact({ notOpponents: true })
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'rechained-after-bad' } as never)

    await expect(
      service.app
        .get(RaceOpponentPersistService)
        .onExperimentRunCompleted(summary),
    ).rejects.toThrow()

    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'race_opponent_summary' }),
    )
  })

  it('persists a v2 artifact end to end: rich sources, whyTheyreRunning, issuesThatMatter, field_analysis, and websiteUrl', async () => {
    await seedCollectedRow({
      sourceType: 'ballotpedia',
      sourceUrl: BALLOTPEDIA_URL,
    })
    await seedCollectedRow({
      sourceType: 'opponent_website',
      sourceUrl: WEBSITE_URL,
    })
    const run = await seedSummaryRun('summary-persist')
    // background sourced from the website row to verify per-URL type
    // resolution across both collected source types.
    stubSummaryArtifact(
      summaryArtifact(
        {
          background: {
            text: 'career',
            sources: [richSource(WEBSITE_URL, { publisher: 'janerival.com' })],
          },
          why_theyre_running: { text: 'to protect the incumbent agenda' },
          issues_that_matter: {
            items: ['Housing'],
            sources: [richSource(BALLOTPEDIA_URL)],
          },
        },
        { field_analysis: fieldAnalysisArtifact() },
      ),
    )

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    const storedSummaries = await service.prisma.raceOpponentSummary.findMany({
      where: { campaignId },
    })
    expect(storedSummaries).toHaveLength(1)
    expect(storedSummaries[0]?.opponentName).toBe(JANE)
    const storedAnalysis =
      await service.prisma.raceOpponentFieldAnalysis.findUniqueOrThrow({
        where: { campaignId },
      })
    expect(storedAnalysis.runId).toBe('summary-persist')

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    expect(result.status).toBe(200)
    const opponent = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(opponent.summary.opponentName).toBe(JANE)
    expect(opponent.summary.threatTier).toBe('watch_closely')
    expect(opponent.summary.overview.sources).toEqual([
      expectedSource(BALLOTPEDIA_URL, 'ballotpedia'),
    ])
    expect(opponent.summary.background.sources).toEqual([
      expectedSource(WEBSITE_URL, 'opponent_website', {
        publisher: 'janerival.com',
      }),
    ])
    expect(opponent.summary.whyTheyreRunning).toEqual({
      text: 'to protect the incumbent agenda',
    })
    expect(opponent.summary.issuesThatMatter).toEqual({
      items: ['Housing'],
      sources: [expectedSource(BALLOTPEDIA_URL, 'ballotpedia')],
    })
    // Transitional: the deployed webapp reads keyPositions.length unguarded,
    // so a freshly regenerated summary must still carry the (empty) key until
    // ENG-10635 migrates the UI off it.
    expect(opponent.summary.keyPositions).toEqual([])
    // The opponent_website collected row surfaces as websiteUrl on the
    // opponent object, independent of the summary.
    expect(opponent.websiteUrl).toBe(WEBSITE_URL)
    // field_analysis sources use the plain contract shape (no sourceType/
    // sourceUrl passthrough): unlike per-opponent summary sources, no
    // pre-v2 UI ever read field-analysis sources off the wire, so there is
    // no transitional shape to preserve.
    expect(result.data.fieldAnalysis).toEqual({
      strengths: ['Strong fundraising'],
      weaknesses: ['Low name recognition'],
      opportunities: ['Opponent has no published water position'],
      threats: [],
      sources: [richSource(BALLOTPEDIA_URL)],
      generatedAt: '2026-06-28T00:00:00.000Z',
    })
  })

  it('returns websiteUrl null when the opponent has no collected opponent_website row', async () => {
    await seedCollectedRow({
      sourceType: 'ballotpedia',
      sourceUrl: BALLOTPEDIA_URL,
    })

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    const opponent = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(opponent.websiteUrl).toBeNull()
  })

  it('a campaign with only legacy summary rows still reads successfully and omits the new fields', async () => {
    await seedCollectedRow({ opponentName: JANE })
    await service.prisma.raceOpponentSummary.create({
      data: {
        campaignId,
        runId: 'summary-legacy',
        opponentName: JANE,
        sections: {
          opponentName: JANE,
          overview: {
            text: 'who they are',
            sources: [
              { sourceType: 'ballotpedia', sourceUrl: BALLOTPEDIA_URL },
            ],
          },
          background: null,
          keyPositions: [],
          generatedAt: '2026-06-01T00:00:00.000Z',
          threatTier: 'primary_threat',
          whyTheyMatter: 'The only incumbent in the field.',
        },
      },
    })

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    expect(result.status).toBe(200)
    const opponent = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(opponent.summary).not.toBeNull()
    expect(opponent.summary.threatTier).toBe('primary_threat')
    expect(opponent.summary.whyTheyreRunning).toBeUndefined()
    expect(opponent.summary.issuesThatMatter).toBeUndefined()
    expect(result.data.fieldAnalysis).toBeNull()
  })

  it('field-analysis upsert: a second run leaves one row with the latest content', async () => {
    await seedCollectedRow({
      sourceType: 'ballotpedia',
      sourceUrl: BALLOTPEDIA_URL,
    })
    const first = await seedSummaryRun('summary-fa-1')
    stubSummaryArtifact(
      summaryArtifact({}, { field_analysis: fieldAnalysisArtifact() }),
    )
    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(first)

    const second = await seedSummaryRun('summary-fa-2')
    stubSummaryArtifact(
      summaryArtifact(
        {},
        {
          field_analysis: fieldAnalysisArtifact({
            strengths: ['Updated strength'],
          }),
        },
      ),
    )
    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(second)

    const rows = await service.prisma.raceOpponentFieldAnalysis.findMany({
      where: { campaignId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.runId).toBe('summary-fa-2')
    expect((rows[0]?.sections as { strengths: string[] }).strengths).toEqual([
      'Updated strength',
    ])

    // A later run with field_analysis: null (e.g. the campaign lost its
    // candidate_platform) deletes the existing row rather than leaving the
    // stale SWOT behind.
    const third = await seedSummaryRun('summary-fa-3')
    stubSummaryArtifact(summaryArtifact({}, { field_analysis: null }))
    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(third)

    expect(
      await service.prisma.raceOpponentFieldAnalysis.findMany({
        where: { campaignId },
      }),
    ).toHaveLength(0)
  })

  it('read endpoint returns summary null + raw items when no summary row exists', async () => {
    await seedCollectedRow()

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    expect(result.status).toBe(200)
    const opponent = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(opponent.summary).toBeNull()
    // The no-summary fallback still needs the raw items to render (ENG-10622).
    expect(opponent.items).toHaveLength(1)
  })

  it('omits raw items when a structured summary is present (ENG-10622)', async () => {
    await seedCollectedRow()
    await service.prisma.raceOpponentSummary.create({
      data: {
        campaignId,
        runId: 'summary-omits-items',
        opponentName: JANE,
        sections: {
          opponentName: JANE,
          overview: {
            text: 'who they are',
            sources: [
              { sourceType: 'ballotpedia', sourceUrl: BALLOTPEDIA_URL },
            ],
          },
          background: null,
          keyPositions: [],
          generatedAt: '2026-06-28T00:00:00.000Z',
        },
      },
    })

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    expect(result.status).toBe(200)
    const opponent = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(opponent.summary).not.toBeNull()
    // Raw scraped page text is redundant once a summary exists; the response
    // drops it rather than shipping it to the client.
    expect(opponent.items).toBeUndefined()
  })

  it('resolves a summary onto its opponent despite a name casing/whitespace mismatch', async () => {
    // The collected row carries 'Jane Rival'; the summary row (a separate LLM
    // run) stored it as '  jane rival  '. Normalized matching must still pair
    // them so the stored summary surfaces on the read endpoint.
    await seedCollectedRow({ opponentName: JANE })
    await service.prisma.raceOpponentSummary.create({
      data: {
        campaignId,
        runId: 'summary-cased',
        opponentName: `  ${JANE.toLowerCase()}  `,
        sections: {
          opponentName: JANE,
          overview: {
            text: 'who they are',
            sources: [
              { sourceType: 'ballotpedia', sourceUrl: BALLOTPEDIA_URL },
            ],
          },
          background: null,
          keyPositions: [],
          generatedAt: '2026-06-28T00:00:00.000Z',
        },
      },
    })

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    expect(result.status).toBe(200)
    const opponent = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(opponent.summary).not.toBeNull()
    expect(opponent.summary.overview.text).toBe('who they are')
  })

  it('idempotently replaces summaries on re-run (no dupes)', async () => {
    await seedCollectedRow()
    const first = await seedSummaryRun('summary-first')
    stubSummaryArtifact(summaryArtifact())
    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(first)

    const second = await seedSummaryRun('summary-second')
    stubSummaryArtifact(
      summaryArtifact({
        overview: {
          text: 'updated overview',
          sources: [richSource(BALLOTPEDIA_URL)],
        },
      }),
    )
    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(second)

    const stored = await service.prisma.raceOpponentSummary.findMany({
      where: { campaignId },
    })
    expect(stored).toHaveLength(1)
    expect(stored[0]?.runId).toBe('summary-second')
  })

  it('rejects an artifact whose section has no source_url and persists nothing', async () => {
    await seedCollectedRow()
    const run = await seedSummaryRun('summary-unsourced')
    stubSummaryArtifact(
      summaryArtifact({
        overview: { text: 'unsourced overview', sources: [] },
      }),
    )

    await expect(
      service.app.get(RaceOpponentPersistService).onExperimentRunCompleted(run),
    ).rejects.toThrow()

    const stored = await service.prisma.raceOpponentSummary.findMany({
      where: { campaignId },
    })
    expect(stored).toHaveLength(0)
    const persisted = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: 'summary-unsourced' },
    })
    expect(persisted.status).toBe(ExperimentRunStatus.FAILED)
  })

  it('leaves prior summaries intact when an unsourced re-run is rejected', async () => {
    await seedCollectedRow()
    const first = await seedSummaryRun('summary-ok')
    stubSummaryArtifact(summaryArtifact())
    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(first)

    const bad = await seedSummaryRun('summary-bad')
    stubSummaryArtifact(
      summaryArtifact({
        overview: { text: 'unsourced', sources: [] },
      }),
    )
    await expect(
      service.app.get(RaceOpponentPersistService).onExperimentRunCompleted(bad),
    ).rejects.toThrow()

    const stored = await service.prisma.raceOpponentSummary.findMany({
      where: { campaignId },
    })
    expect(stored).toHaveLength(1)
    expect(stored[0]?.runId).toBe('summary-ok')
  })

  it('drops an uncollected (hallucinated) source URL rather than admitting it', async () => {
    await seedCollectedRow({
      sourceType: 'ballotpedia',
      sourceUrl: BALLOTPEDIA_URL,
    })
    const run = await seedSummaryRun('summary-hallucinated')
    // overview cites the real collected URL plus one the agent invented; the
    // invented URL must be dropped, leaving only the verified source.
    stubSummaryArtifact(
      summaryArtifact({
        overview: {
          text: 'who they are',
          sources: [
            richSource(BALLOTPEDIA_URL),
            richSource('https://invented.example/fake', {
              title: 'Invented',
              publisher: 'invented.example',
            }),
          ],
        },
        background: null,
      }),
    )

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    const opponent = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(opponent.summary.overview.sources).toEqual([
      expectedSource(BALLOTPEDIA_URL, 'ballotpedia'),
    ])
  })

  it('nulls a descriptive section when every cited source is uncollected, and the run still succeeds', async () => {
    await seedCollectedRow({
      sourceType: 'ballotpedia',
      sourceUrl: BALLOTPEDIA_URL,
    })
    const run = await seedSummaryRun('summary-all-hallucinated')
    stubSummaryArtifact(
      summaryArtifact({
        overview: {
          text: 'who they are',
          sources: [
            richSource('https://invented.example/fake', {
              title: 'Invented',
              publisher: 'invented.example',
            }),
          ],
        },
        background: null,
      }),
    )

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    const persisted = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: 'summary-all-hallucinated' },
    })
    expect(persisted.status).toBe(ExperimentRunStatus.COMPLETED)

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    const opponent = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(opponent.summary.overview).toBeNull()
  })

  it('dedups duplicate opponent_name entries instead of failing on the unique constraint', async () => {
    await seedCollectedRow({
      sourceType: 'ballotpedia',
      sourceUrl: BALLOTPEDIA_URL,
    })
    const run = await seedSummaryRun('summary-dupe')
    stubSummaryArtifact({
      generated_at: '2026-06-28T00:00:00.000Z',
      opponents: [
        {
          opponent_name: JANE,
          threat_tier: 'watch_closely',
          overview: {
            text: 'first',
            sources: [richSource(BALLOTPEDIA_URL)],
          },
          background: null,
        },
        {
          opponent_name: JANE,
          threat_tier: 'watch_closely',
          overview: {
            text: 'second',
            sources: [richSource(BALLOTPEDIA_URL)],
          },
          background: null,
        },
      ],
    })

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    const stored = await service.prisma.raceOpponentSummary.findMany({
      where: { campaignId },
    })
    expect(stored).toHaveLength(1)
    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    const opponent = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    // Last entry wins.
    expect(opponent.summary.overview.text).toBe('second')
  })

  const seedStaleCard = () =>
    service.prisma.raceOpponentStandoutAction.create({
      data: {
        campaignId,
        order: 0,
        title: 'Stale card',
        body: 'Old body.',
        smsMessage: 'Old sms.',
        issue: 'housing',
        runId: 'actions-stale',
      },
    })

  it('clears stale summaries, field analysis, and stand-out actions when a collection run replaces the collected rows', async () => {
    // Seed a prior summary + field analysis plus the prior collected row they
    // were built from.
    await seedCollectedRow()
    const summaryRun = await seedSummaryRun('summary-stale')
    stubSummaryArtifact(
      summaryArtifact({}, { field_analysis: fieldAnalysisArtifact() }),
    )
    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(summaryRun)
    expect(
      await service.prisma.raceOpponentSummary.count({ where: { campaignId } }),
    ).toBe(1)
    expect(
      await service.prisma.raceOpponentFieldAnalysis.count({
        where: { campaignId },
      }),
    ).toBe(1)
    await seedStaleCard()

    // A fresh collection run replaces the collected rows; its chained summary
    // dispatch is stubbed, so without the cleanup the stale summary and SWOT
    // would survive — indefinitely, if that chained run failed — and GET would
    // pair fresh items with stale structured analysis.
    const collectionRun = await service.prisma.experimentRun.create({
      data: {
        runId: 'collect-replace',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_collection',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'bucket',
        artifactKey: 'collect-replace.json',
      },
    })
    vi.spyOn(service.app.get(S3Service), 'getFile').mockResolvedValue(
      JSON.stringify({
        items: [
          {
            opponent_name: JANE,
            source_type: 'ballotpedia',
            source_url: BALLOTPEDIA_URL,
            content: { text: 'refreshed bio' },
          },
        ],
      }),
    )
    vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    ).mockResolvedValue({ runId: 'chained-after-replace' } as never)

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(collectionRun)

    expect(
      await service.prisma.raceOpponentSummary.count({ where: { campaignId } }),
    ).toBe(0)
    expect(
      await service.prisma.raceOpponentFieldAnalysis.count({
        where: { campaignId },
      }),
    ).toBe(0)
    expect(
      await service.prisma.raceOpponentStandoutAction.count({
        where: { campaignId },
      }),
    ).toBe(0)
  })

  it('clears stale stand-out actions when a summary run replaces the summaries', async () => {
    await seedCollectedRow()
    await seedStaleCard()

    const summaryRun = await seedSummaryRun('summary-replaces-cards')
    stubSummaryArtifact(summaryArtifact({}))
    vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    ).mockResolvedValue({ runId: 'chained-actions' } as never)

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(summaryRun)

    // The cards derived from the replaced summaries are gone in the same
    // transaction; the chained actions run (stubbed here) repopulates.
    expect(
      await service.prisma.raceOpponentSummary.count({ where: { campaignId } }),
    ).toBe(1)
    expect(
      await service.prisma.raceOpponentStandoutAction.count({
        where: { campaignId },
      }),
    ).toBe(0)
  })

  const seedWebsite = (about: PrismaJson.WebsiteContent['about']) =>
    service.prisma.website.create({
      data: { campaignId, vanityPath: `${SLUG}-site`, content: { about } },
    })

  it('dispatchSummary includes candidate_platform from Website.content.about', async () => {
    await seedCollectedRow()
    await seedWebsite({
      bio: 'A lifelong resident running for council.',
      issues: [
        { title: 'Water security', description: 'Publish a 50-year plan.' },
        // an issue missing a description is dropped (input requires both)
        { title: 'Roads' },
      ],
    })
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'summary-cp' } as never)

    await service.app
      .get(RaceOpponentService)
      .dispatchSummary(await loadCampaign())

    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          candidate_platform: {
            bio: 'A lifelong resident running for council.',
            issues: [
              {
                title: 'Water security',
                description: 'Publish a 50-year plan.',
              },
            ],
          },
        }),
      }),
    )
  })

  it('dispatchSummary omits candidate_platform when no website bio or issues', async () => {
    await seedCollectedRow()
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'summary-nocp' } as never)

    await service.app
      .get(RaceOpponentService)
      .dispatchSummary(await loadCampaign())

    const params = dispatchRun.mock.calls[0]?.[0].params as {
      candidate_platform?: unknown
    }
    expect(params.candidate_platform).toBeUndefined()
  })

  it('persists an artifact opponent without threat_tier (in-flight v1 run) and GET omits the tier', async () => {
    // A v1 run dispatched before this deploy emitted threat_tier optionally
    // and can complete after it; a missing tier must persist, not markFailed.
    await seedCollectedRow()
    const run = await seedSummaryRun('summary-no-tier')
    // JSON.stringify drops the undefined key, so the artifact omits it.
    stubSummaryArtifact(summaryArtifact({ threat_tier: undefined }))

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    const persisted = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: 'summary-no-tier' },
    })
    expect(persisted.status).toBe(ExperimentRunStatus.COMPLETED)

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    expect(result.status).toBe(200)
    const opponent = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(opponent.summary).not.toBeNull()
    expect(opponent.summary.threatTier).toBeUndefined()
    expect(opponent.threatTier).toBeUndefined()
  })

  it('persists a descriptive-only artifact (no why_theyre_running/issues_that_matter) without 500ing', async () => {
    await seedCollectedRow()
    const run = await seedSummaryRun('summary-descriptive')
    stubSummaryArtifact(summaryArtifact())

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    const opponent = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(opponent.summary.threatTier).toBe('watch_closely')
    expect(opponent.summary.whyTheyreRunning).toBeUndefined()
    expect(opponent.summary.issuesThatMatter).toBeUndefined()
  })

  const seedTieredSummary = (name: string, threatTier: string | null) =>
    service.prisma.raceOpponentSummary.create({
      data: {
        campaignId,
        runId: `summary-${name}`,
        opponentName: name,
        sections: {
          opponentName: name,
          overview: null,
          background: null,
          keyPositions: [],
          generatedAt: '2026-06-28T00:00:00.000Z',
          ...(threatTier ? { threatTier } : {}),
        },
      },
    })

  it('orders the roster by threat tier and surfaces threatTier per opponent', async () => {
    // Collected rows land in createdAt order Low, Watch, Primary, so a correct
    // response must reorder them Primary -> Watch -> Low purely from the tier.
    await seedCollectedRow({
      opponentName: 'Low Larry',
      sourceUrl: WEBSITE_URL,
    })
    await seedCollectedRow({
      opponentName: 'Watch Wanda',
      sourceUrl: WEBSITE_URL,
    })
    await seedCollectedRow({
      opponentName: 'Primary Pat',
      sourceUrl: WEBSITE_URL,
    })
    await seedTieredSummary('Low Larry', 'low_priority')
    await seedTieredSummary('Watch Wanda', 'watch_closely')
    await seedTieredSummary('Primary Pat', 'primary_threat')

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    expect(result.status).toBe(200)
    expect(
      result.data.opponents.map(
        (o: { opponentName: string }) => o.opponentName,
      ),
    ).toEqual(['Primary Pat', 'Watch Wanda', 'Low Larry'])
    expect(
      result.data.opponents.map((o: { threatTier?: string }) => o.threatTier),
    ).toEqual(['primary_threat', 'watch_closely', 'low_priority'])
  })

  it('sorts an opponent with no analysis last and returns Phase-2 fields only', async () => {
    await seedCollectedRow({
      opponentName: 'Primary Pat',
      sourceUrl: WEBSITE_URL,
    })
    await seedCollectedRow({ opponentName: 'No Analysis Nora' })
    await seedTieredSummary('Primary Pat', 'primary_threat')

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    expect(
      result.data.opponents.map(
        (o: { opponentName: string }) => o.opponentName,
      ),
    ).toEqual(['Primary Pat', 'No Analysis Nora'])
    const nora = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === 'No Analysis Nora',
    )
    expect(nora.threatTier).toBeUndefined()
    expect(nora.summary).toBeNull()
  })

  // ENG-10646: race_opponent_actions chains off a completed summary the same
  // way the summary chains off a completed collection.

  it('chains race_opponent_actions with fully-hydrated params after the summary persists', async () => {
    await seedCollectedRow({
      sourceType: 'ballotpedia',
      sourceUrl: BALLOTPEDIA_URL,
    })
    await seedWebsite({
      bio: 'A lifelong resident running for council.',
      issues: [
        { title: 'Water security', description: 'Publish a 50-year plan.' },
      ],
    })
    const run = await seedSummaryRun('summary-chains-actions')
    stubSummaryArtifact(
      summaryArtifact({
        issues_that_matter: {
          items: ['Housing'],
          sources: [richSource(BALLOTPEDIA_URL)],
        },
      }),
    )
    // Prototype spy: DistrictResolverService is provided per-module (this
    // module, campaign-manager, chief-of-staff, briefing-chats), so app.get
    // may return a different instance than the one injected here.
    vi.spyOn(
      DistrictResolverService.prototype,
      'resolveByOrgSlug',
    ).mockResolvedValue({
      state: 'NC',
      l2DistrictType: 'City',
      l2DistrictName: 'HENDERSONVILLE CITY',
      level: null,
    })
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'actions-1' } as never)

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    const actionsCall = dispatchRun.mock.calls.find(
      ([input]) => input.type === 'race_opponent_actions',
    )
    expect(actionsCall?.[0].params).toEqual({
      opponents: [
        {
          opponent_name: JANE,
          threat_tier: 'watch_closely',
          overview_text: 'who they are',
          background_text: 'career',
          issues_that_matter: ['Housing'],
        },
      ],
      candidate_platform: {
        bio: 'A lifelong resident running for council.',
        issues: [
          { title: 'Water security', description: 'Publish a 50-year plan.' },
        ],
      },
      state: 'NC',
      l2_district_type: 'City',
      l2_district_name: 'HENDERSONVILLE CITY',
      race_context: {
        city: null,
        election_date: null,
        office_name: null,
        state: null,
      },
    })
  })

  it('dispatchActions omits the flat district params entirely when resolution returns null', async () => {
    await seedTieredSummary(JANE, 'watch_closely')
    // Explicit null (not the real resolver): clearMocks doesn't restore the
    // prototype spy's implementation from the hydration test above.
    vi.spyOn(
      DistrictResolverService.prototype,
      'resolveByOrgSlug',
    ).mockResolvedValue(null)
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'actions-nodistrict' } as never)

    await service.app
      .get(RaceOpponentService)
      .dispatchActions(await loadCampaign())

    expect(dispatchRun).toHaveBeenCalledTimes(1)
    const params = dispatchRun.mock.calls[0]?.[0].params
    expect(params).not.toHaveProperty('state')
    expect(params).not.toHaveProperty('l2_district_type')
    expect(params).not.toHaveProperty('l2_district_name')
  })

  it('dispatchActions is a no-op when no summaries are persisted', async () => {
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    await service.app
      .get(RaceOpponentService)
      .dispatchActions(await loadCampaign())

    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('dispatchActions skips when an actions run is already in flight', async () => {
    await seedTieredSummary(JANE, 'watch_closely')
    await service.prisma.experimentRun.create({
      data: {
        runId: 'actions-inflight',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_actions',
        status: ExperimentRunStatus.RUNNING,
      },
    })
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    await service.app
      .get(RaceOpponentService)
      .dispatchActions(await loadCampaign())

    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('dispatchActions bounds oversized summary text producer-side', async () => {
    await service.prisma.raceOpponentSummary.create({
      data: {
        campaignId,
        runId: 'summary-long',
        opponentName: JANE,
        sections: {
          opponentName: JANE,
          overview: {
            text: 'x'.repeat(4100),
            sources: [
              { sourceType: 'ballotpedia', sourceUrl: BALLOTPEDIA_URL },
            ],
          },
          background: null,
          keyPositions: [],
          generatedAt: '2026-06-28T00:00:00.000Z',
          threatTier: 'watch_closely',
        },
      },
    })
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'actions-capped' } as never)

    await service.app
      .get(RaceOpponentService)
      .dispatchActions(await loadCampaign())

    const params = dispatchRun.mock.calls[0]?.[0].params as {
      opponents: { overview_text: string | null }[]
    }
    expect(params.opponents[0]?.overview_text).toBe('x'.repeat(4000))
  })

  it("GET collectionStatus stays 'completed' while an actions run is RUNNING", async () => {
    await seedCollectedRow()
    await service.prisma.experimentRun.create({
      data: {
        runId: 'collect-cycle',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_collection',
        status: ExperimentRunStatus.COMPLETED,
        createdAt: new Date('2026-07-01T10:00:00.000Z'),
      },
    })
    await service.prisma.experimentRun.create({
      data: {
        runId: 'summary-cycle',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_summary',
        status: ExperimentRunStatus.COMPLETED,
        createdAt: new Date('2026-07-01T10:05:00.000Z'),
      },
    })
    await service.prisma.experimentRun.create({
      data: {
        runId: 'actions-running',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_actions',
        status: ExperimentRunStatus.RUNNING,
        createdAt: new Date('2026-07-01T10:10:00.000Z'),
      },
    })

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data.collectionStatus).toBe('completed')
  })

  it("GET collectionStatus stays 'completed' when an actions run FAILED", async () => {
    await seedCollectedRow()
    await service.prisma.experimentRun.create({
      data: {
        runId: 'collect-cycle-2',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_collection',
        status: ExperimentRunStatus.COMPLETED,
        createdAt: new Date('2026-07-01T10:00:00.000Z'),
      },
    })
    await service.prisma.experimentRun.create({
      data: {
        runId: 'summary-cycle-2',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_summary',
        status: ExperimentRunStatus.COMPLETED,
        createdAt: new Date('2026-07-01T10:05:00.000Z'),
      },
    })
    await service.prisma.experimentRun.create({
      data: {
        runId: 'actions-failed-status',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_actions',
        status: ExperimentRunStatus.FAILED,
        createdAt: new Date('2026-07-01T10:10:00.000Z'),
      },
    })

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data.collectionStatus).toBe('completed')
  })

  it('re-chains actions when a terminal actions run leaves a newer summary unprocessed', async () => {
    await seedTieredSummary(JANE, 'watch_closely')
    const failedActions = await service.prisma.experimentRun.create({
      data: {
        runId: 'actions-failed',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_actions',
        status: ExperimentRunStatus.FAILED,
        createdAt: new Date('2026-07-01T10:00:00.000Z'),
      },
    })
    await service.prisma.experimentRun.create({
      data: {
        runId: 'summary-newer',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_summary',
        status: ExperimentRunStatus.COMPLETED,
        createdAt: new Date('2026-07-01T10:05:00.000Z'),
      },
    })
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'actions-rechained' } as never)

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(failedActions)

    expect(dispatchRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: 'race_opponent_actions' }),
    )
  })

  it('does not re-chain on a terminal actions run when no newer summary exists', async () => {
    await seedTieredSummary(JANE, 'watch_closely')
    const failedActions = await service.prisma.experimentRun.create({
      data: {
        runId: 'actions-failed-solo',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_actions',
        status: ExperimentRunStatus.FAILED,
        createdAt: new Date('2026-07-01T10:05:00.000Z'),
      },
    })
    // The only completed summary pre-dates this actions run (its own cycle),
    // so there is nothing newer to re-chain for — re-dispatching would loop.
    await service.prisma.experimentRun.create({
      data: {
        runId: 'summary-older',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_summary',
        status: ExperimentRunStatus.COMPLETED,
        createdAt: new Date('2026-07-01T10:00:00.000Z'),
      },
    })
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(failedActions)

    expect(dispatchRun).not.toHaveBeenCalled()
  })
})

// ENG-10647: the actions artifact persists into race_opponent_standout_action
// and GET serves the cards back through the contract.
describe('race_opponent_actions persist / read', () => {
  let campaignId: number

  beforeEach(async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    campaignId = campaign.id
  })

  const seedActionsRun = (
    runId: string,
    overrides: Partial<{
      status: ExperimentRunStatus
      artifactBucket: string | null
      artifactKey: string | null
      createdAt: Date
    }> = {},
  ) =>
    service.prisma.experimentRun.create({
      data: {
        runId,
        organizationSlug: SLUG,
        experimentType: 'race_opponent_actions',
        status: overrides.status ?? ExperimentRunStatus.COMPLETED,
        artifactBucket:
          overrides.artifactBucket === undefined
            ? 'bucket'
            : overrides.artifactBucket,
        artifactKey:
          overrides.artifactKey === undefined
            ? `${runId}.json`
            : overrides.artifactKey,
        ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      },
    })

  const stubActionsArtifact = (actions: unknown[]) =>
    vi.spyOn(service.app.get(S3Service), 'getFile').mockResolvedValue(
      JSON.stringify({
        generated_at: '2026-07-06T00:00:00.000Z',
        haystaq_status: 'no_district',
        actions,
      }),
    )

  const actionCard = (overrides: Record<string, unknown> = {}) => ({
    title: `Stand out against ${JANE} on housing`,
    body: 'Jane has no published housing plan. You have committed to one.',
    sms_message:
      'Hi, this is Alex — unlike my opponent, I have a housing plan.',
    opponent_name: JANE,
    issue: 'housing',
    ...overrides,
  })

  const seedStandoutRow = (
    order: number,
    overrides: Record<string, unknown> = {},
  ) =>
    service.prisma.raceOpponentStandoutAction.create({
      data: {
        campaignId,
        runId: 'prior-actions-run',
        order,
        title: `Prior card ${order}`,
        body: 'Prior body.',
        smsMessage: 'Prior sms.',
        opponentName: JANE,
        issue: 'roads',
        ...overrides,
      },
    })

  const persist = (run: ExperimentRun) =>
    service.app.get(RaceOpponentPersistService).onExperimentRunCompleted(run)

  it('persists artifact cards with order = array index, runId, and camelCase mapping', async () => {
    const run = await seedActionsRun('actions-a')
    stubActionsArtifact([
      actionCard(),
      actionCard({
        title: 'Own the roads issue',
        opponent_name: null,
        issue: 'roads',
      }),
    ])

    await persist(run)

    const rows = await service.prisma.raceOpponentStandoutAction.findMany({
      where: { campaignId },
      orderBy: { order: 'asc' },
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      order: 0,
      runId: 'actions-a',
      title: `Stand out against ${JANE} on housing`,
      body: 'Jane has no published housing plan. You have committed to one.',
      smsMessage:
        'Hi, this is Alex — unlike my opponent, I have a housing plan.',
      opponentName: JANE,
      issue: 'housing',
    })
    expect(rows[1]).toMatchObject({
      order: 1,
      title: 'Own the roads issue',
      opponentName: null,
      issue: 'roads',
    })
    const persisted = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: 'actions-a' },
    })
    expect(persisted.status).toBe(ExperimentRunStatus.COMPLETED)
  })

  it('replaces prior cards on re-run and (campaignId, order) stays unique', async () => {
    const first = await seedActionsRun('actions-first')
    stubActionsArtifact([actionCard(), actionCard({ issue: 'water' })])
    await persist(first)

    const second = await seedActionsRun('actions-second')
    stubActionsArtifact([actionCard({ title: 'Fresh card', issue: 'schools' })])
    await persist(second)

    const rows = await service.prisma.raceOpponentStandoutAction.findMany({
      where: { campaignId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      order: 0,
      runId: 'actions-second',
      title: 'Fresh card',
    })
  })

  it('a valid empty artifact clears prior cards and the run stays COMPLETED', async () => {
    await seedStandoutRow(0)
    const run = await seedActionsRun('actions-empty')
    stubActionsArtifact([])

    await persist(run)

    expect(
      await service.prisma.raceOpponentStandoutAction.count({
        where: { campaignId },
      }),
    ).toBe(0)
    const persisted = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: 'actions-empty' },
    })
    expect(persisted.status).toBe(ExperimentRunStatus.COMPLETED)
  })

  it('drops a card failing per-card validation and persists the remainder compacted', async () => {
    const run = await seedActionsRun('actions-mixed')
    stubActionsArtifact([
      actionCard({ title: 'x'.repeat(100) }),
      actionCard({ title: 'Valid card', issue: 'water' }),
      // Non-object elements must hit per-card salvage, not fail the envelope.
      null as never,
      'not an object' as never,
      actionCard({ sms_message: 'y'.repeat(321), issue: 'roads' }),
      actionCard({ title: 'Another valid card', issue: 'schools' }),
    ])

    await persist(run)

    const rows = await service.prisma.raceOpponentStandoutAction.findMany({
      where: { campaignId },
      orderBy: { order: 'asc' },
    })
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => [row.order, row.title])).toEqual([
      [0, 'Valid card'],
      [1, 'Another valid card'],
    ])
    const persisted = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: 'actions-mixed' },
    })
    expect(persisted.status).toBe(ExperimentRunStatus.COMPLETED)
  })

  it('fails the run and leaves prior cards untouched when every card is invalid', async () => {
    await seedStandoutRow(0)
    const run = await seedActionsRun('actions-all-invalid')
    stubActionsArtifact([
      actionCard({ title: '' }),
      actionCard({ sms_message: 'y'.repeat(321) }),
    ])

    await expect(persist(run)).rejects.toThrow()

    const rows = await service.prisma.raceOpponentStandoutAction.findMany({
      where: { campaignId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.runId).toBe('prior-actions-run')
    const persisted = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: 'actions-all-invalid' },
    })
    expect(persisted.status).toBe(ExperimentRunStatus.FAILED)
  })

  it('fails a COMPLETED run that has no artifact location', async () => {
    const run = await seedActionsRun('actions-no-artifact', {
      artifactBucket: null,
      artifactKey: null,
    })

    await expect(persist(run)).rejects.toThrow()

    const persisted = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: 'actions-no-artifact' },
    })
    expect(persisted.status).toBe(ExperimentRunStatus.FAILED)
  })

  it('a FAILED actions run leaves prior cards untouched and still re-chains', async () => {
    await seedStandoutRow(0)
    // dispatchActions (the re-chain target) reads persisted summaries; seed one
    // so the re-chain has something to dispatch.
    await service.prisma.raceOpponentSummary.create({
      data: {
        campaignId,
        runId: 'summary-for-rechain',
        opponentName: JANE,
        sections: {
          opponentName: JANE,
          overview: null,
          background: null,
          keyPositions: [],
          generatedAt: '2026-07-06T00:00:00.000Z',
          threatTier: 'watch_closely',
        },
      },
    })
    const failed = await seedActionsRun('actions-failed-prior', {
      status: ExperimentRunStatus.FAILED,
      createdAt: new Date('2026-07-06T10:00:00.000Z'),
    })
    await service.prisma.experimentRun.create({
      data: {
        runId: 'summary-newer-than-failed',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_summary',
        status: ExperimentRunStatus.COMPLETED,
        createdAt: new Date('2026-07-06T10:05:00.000Z'),
      },
    })
    const getFile = vi.spyOn(service.app.get(S3Service), 'getFile')
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'actions-rechained-2' } as never)

    await persist(failed)

    // No artifact is read on the FAILED path; the prior cards survive.
    expect(getFile).not.toHaveBeenCalled()
    expect(
      await service.prisma.raceOpponentStandoutAction.count({
        where: { campaignId },
      }),
    ).toBe(1)
    expect(dispatchRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: 'race_opponent_actions' }),
    )
  })

  it('re-chains for a newer summary even when the actions artifact fails to persist', async () => {
    await service.prisma.raceOpponentSummary.create({
      data: {
        campaignId,
        runId: 'summary-for-rechain-2',
        opponentName: JANE,
        sections: {
          opponentName: JANE,
          overview: null,
          background: null,
          keyPositions: [],
          generatedAt: '2026-07-06T00:00:00.000Z',
          threatTier: 'watch_closely',
        },
      },
    })
    const run = await seedActionsRun('actions-bad-artifact', {
      createdAt: new Date('2026-07-06T10:00:00.000Z'),
    })
    await service.prisma.experimentRun.create({
      data: {
        runId: 'summary-newer-than-bad',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_summary',
        status: ExperimentRunStatus.COMPLETED,
        createdAt: new Date('2026-07-06T10:05:00.000Z'),
      },
    })
    vi.spyOn(service.app.get(S3Service), 'getFile').mockResolvedValue(
      JSON.stringify({ notActions: true }),
    )
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'actions-rechained-3' } as never)

    await expect(persist(run)).rejects.toThrow()

    const persisted = await service.prisma.experimentRun.findUniqueOrThrow({
      where: { runId: 'actions-bad-artifact' },
    })
    expect(persisted.status).toBe(ExperimentRunStatus.FAILED)
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'race_opponent_actions' }),
    )
  })

  it('GET returns the cards ordered by order through the response contract', async () => {
    // Insert out of order so the read's orderBy (not insertion order) is what
    // produces the sequence.
    await seedStandoutRow(2, { title: 'Third card', issue: 'schools' })
    await seedStandoutRow(0, { title: 'First card' })
    await seedStandoutRow(1, {
      title: 'Second card',
      issue: 'water',
      opponentName: null,
    })

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(
      result.data.standoutActions.map((a: { title: string }) => a.title),
    ).toEqual(['First card', 'Second card', 'Third card'])
    expect(result.data.standoutActions[0]).toEqual({
      title: 'First card',
      body: 'Prior body.',
      smsMessage: 'Prior sms.',
      opponentName: JANE,
      issue: 'roads',
    })
    expect(result.data.standoutActions[1].opponentName).toBeNull()
  })

  it('GET omits a persisted card that fails contract re-parse instead of 500ing', async () => {
    await seedStandoutRow(0, { title: 'Good card' })
    // Directly-seeded bad row: over the contract's 99-char title cap. The DB
    // column has no length limit, so a drifted row must be tolerated on read.
    await seedStandoutRow(1, { title: 'z'.repeat(120) })

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(
      result.data.standoutActions.map((a: { title: string }) => a.title),
    ).toEqual(['Good card'])
  })

  it('GET returns an empty standoutActions array for a campaign with no cards', async () => {
    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data.standoutActions).toEqual([])
  })
})
