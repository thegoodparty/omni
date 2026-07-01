import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { RaceOpponentPersistService } from '@/raceOpponent/services/raceOpponentPersist.service'
import { RaceOpponentService } from '@/raceOpponent/services/raceOpponent.service'
import { StrategicLandscapeParamsService } from '@/campaignStrategy/services/strategicLandscapeParams.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { ExperimentRunStatus } from '@/generated/prisma'
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
    await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
      raceId: RACE_HASH,
    })
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
    await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
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
    flagOn()
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

  it('403s when know-your-opponent is off', async () => {
    const campaign = await seedCampaign({
      slug: SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    await seedOpponents(campaign.id, [JANE])
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
    flagOn()

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
    flagOn()
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

  const summaryArtifact = (overrides: Record<string, unknown> = {}) => ({
    generated_at: '2026-06-28T00:00:00.000Z',
    opponents: [
      {
        opponent_name: JANE,
        overview: { text: 'who they are', sources: [BALLOTPEDIA_URL] },
        background: { text: 'career', sources: [BALLOTPEDIA_URL] },
        key_positions: [
          {
            label: 'Housing',
            detail: 'supports zoning',
            sources: [BALLOTPEDIA_URL],
          },
        ],
        ...overrides,
      },
    ],
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

  it('persists the artifact into race_opponent_summary and exposes it on the read endpoint', async () => {
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
      summaryArtifact({
        background: { text: 'career', sources: [WEBSITE_URL] },
      }),
    )

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    const stored = await service.prisma.raceOpponentSummary.findMany({
      where: { campaignId },
    })
    expect(stored).toHaveLength(1)
    expect(stored[0]?.opponentName).toBe(JANE)

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    expect(result.status).toBe(200)
    const opponent = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(opponent.summary.opponentName).toBe(JANE)
    expect(opponent.summary.overview.sources).toEqual([
      { sourceType: 'ballotpedia', sourceUrl: BALLOTPEDIA_URL },
    ])
    expect(opponent.summary.background.sources).toEqual([
      { sourceType: 'opponent_website', sourceUrl: WEBSITE_URL },
    ])
    expect(opponent.summary.keyPositions).toHaveLength(1)
  })

  it('read endpoint returns summary null when no summary row exists', async () => {
    await seedCollectedRow()

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    expect(result.status).toBe(200)
    const opponent = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(opponent.summary).toBeNull()
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
        overview: { text: 'updated overview', sources: [BALLOTPEDIA_URL] },
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
          sources: [BALLOTPEDIA_URL, 'https://invented.example/fake'],
        },
        background: null,
        key_positions: [],
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
      { sourceType: 'ballotpedia', sourceUrl: BALLOTPEDIA_URL },
    ])
  })

  it('fails the run when dropping uncollected URLs empties a section', async () => {
    await seedCollectedRow({
      sourceType: 'ballotpedia',
      sourceUrl: BALLOTPEDIA_URL,
    })
    const run = await seedSummaryRun('summary-all-hallucinated')
    stubSummaryArtifact(
      summaryArtifact({
        overview: {
          text: 'who they are',
          sources: ['https://invented.example/fake'],
        },
        background: null,
        key_positions: [],
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
      where: { runId: 'summary-all-hallucinated' },
    })
    expect(persisted.status).toBe(ExperimentRunStatus.FAILED)
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
          overview: { text: 'first', sources: [BALLOTPEDIA_URL] },
          background: null,
          key_positions: [],
        },
        {
          opponent_name: JANE,
          overview: { text: 'second', sources: [BALLOTPEDIA_URL] },
          background: null,
          key_positions: [],
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

  it('clears stale summaries when a collection run replaces the collected rows', async () => {
    // Seed a prior summary plus the prior collected row it was built from.
    await seedCollectedRow()
    const summaryRun = await seedSummaryRun('summary-stale')
    stubSummaryArtifact(summaryArtifact())
    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(summaryRun)
    expect(
      await service.prisma.raceOpponentSummary.count({ where: { campaignId } }),
    ).toBe(1)

    // A fresh collection run replaces the collected rows; its chained summary
    // dispatch is stubbed, so without the cleanup the stale summary would
    // survive and GET would pair fresh items with stale structured text.
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
  })

  const seedWebsite = (about: PrismaJson.WebsiteContent['about']) =>
    service.prisma.website.create({
      data: { campaignId, vanityPath: `${SLUG}-site`, content: { about } },
    })

  const analysisOverrides = {
    threat_tier: 'primary_threat',
    why_they_matter: 'The only incumbent in the field.',
    what_you_need_to_know: [
      { text: 'Two-term incumbent.', sources: [BALLOTPEDIA_URL] },
      // relaxed: an interpretive takeaway with no source still persists
      { text: 'Backed by the local PAC.' },
    ],
    where_soft: [
      { text: 'No published water position.', sources: [BALLOTPEDIA_URL] },
      // relaxed: an item with no source still persists
      { text: 'Skipped the candidate survey.' },
    ],
    issue_contrasts: [
      {
        issue: 'Housing',
        salience: 'high',
        why_it_matters: 'Families are priced out.',
        opponent_stance: 'Opposes new zoning.',
        opponent_sources: [BALLOTPEDIA_URL],
        candidate_stance: 'Supports starter homes.',
      },
    ],
  }

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

  it('persists the analytical fields and exposes them on the read endpoint', async () => {
    await seedCollectedRow({
      sourceType: 'ballotpedia',
      sourceUrl: BALLOTPEDIA_URL,
    })
    const run = await seedSummaryRun('summary-analysis')
    stubSummaryArtifact(summaryArtifact(analysisOverrides))

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    expect(result.status).toBe(200)
    const opponent = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(opponent.summary.threatTier).toBe('primary_threat')
    expect(opponent.summary.whatYouNeedToKnow).toHaveLength(2)
    // relaxed sourcing: the sourced takeaway keeps its upgraded source ref, the
    // interpretive one persists with no sources key.
    expect(opponent.summary.whatYouNeedToKnow[0]).toEqual({
      text: 'Two-term incumbent.',
      sources: [{ sourceType: 'ballotpedia', sourceUrl: BALLOTPEDIA_URL }],
    })
    expect(opponent.summary.whatYouNeedToKnow[1]).toEqual({
      text: 'Backed by the local PAC.',
    })
    // relaxed sourcing: the sourced soft spot keeps its upgraded source, the
    // unsourced one persists with no sources key.
    expect(opponent.summary.whereSoft).toHaveLength(2)
    expect(opponent.summary.whereSoft[0].sources).toEqual([
      { sourceType: 'ballotpedia', sourceUrl: BALLOTPEDIA_URL },
    ])
    expect(opponent.summary.whereSoft[1].sources).toBeUndefined()
    expect(opponent.summary.issueContrasts[0]).toMatchObject({
      issue: 'Housing',
      salience: 'high',
      candidateStance: 'Supports starter homes.',
      opponentSources: [
        { sourceType: 'ballotpedia', sourceUrl: BALLOTPEDIA_URL },
      ],
    })
  })

  it('tolerates a legacy string[] what_you_need_to_know from an in-flight run', async () => {
    // A summary run dispatched before the {text, sources?} migration completes
    // after this deploy and still emits bare strings. The persist parse must
    // normalize them to { text } rather than failing the whole summary.
    await seedCollectedRow()
    const run = await seedSummaryRun('summary-legacy-wynk')
    stubSummaryArtifact(
      summaryArtifact({
        what_you_need_to_know: ['Legacy takeaway one.', 'Legacy takeaway two.'],
      }),
    )

    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    const result = await service.client.get(GET_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    expect(result.status).toBe(200)
    const opponent = result.data.opponents.find(
      (o: { opponentName: string }) => o.opponentName === JANE,
    )
    expect(opponent.summary.whatYouNeedToKnow).toEqual([
      { text: 'Legacy takeaway one.' },
      { text: 'Legacy takeaway two.' },
    ])
  })

  it('persists a descriptive-only artifact (no analysis) without 500ing', async () => {
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
    expect(opponent.summary.threatTier).toBeUndefined()
    expect(opponent.summary.issueContrasts).toBeUndefined()
  })

  it('idempotently replaces analytical summaries on replay (no dupes)', async () => {
    await seedCollectedRow()
    const run = await seedSummaryRun('summary-analysis-replay')
    stubSummaryArtifact(summaryArtifact(analysisOverrides))
    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)
    await service.app
      .get(RaceOpponentPersistService)
      .onExperimentRunCompleted(run)

    const stored = await service.prisma.raceOpponentSummary.findMany({
      where: { campaignId },
    })
    expect(stored).toHaveLength(1)
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
})
