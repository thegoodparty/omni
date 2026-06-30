import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { ExperimentRunStatus } from '@/generated/prisma'
import { describe, expect, it, vi } from 'vitest'

const service = useTestService()

const SLUG = 'campaign-koo'
const ORG_SLUG_HEADER = 'X-Organization-Slug'
const MANUAL_PATH = '/v1/campaigns/mine/race-opponent/opponents/manual'
const COLLECT_PATH = '/v1/campaigns/mine/race-opponent/collect'
const JANE = 'Jane Rival'

const seedCampaign = (opts: { isPro: boolean }) =>
  service.prisma.organization
    .create({ data: { slug: SLUG, ownerId: service.user.id } })
    .then(() =>
      service.prisma.campaign.create({
        data: {
          userId: service.user.id,
          slug: `${SLUG}-campaign`,
          organizationSlug: SLUG,
          isPro: opts.isPro,
        },
      }),
    )

const flagOn = () =>
  vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(true)

const post = (body: unknown) =>
  service.client.post(MANUAL_PATH, body, {
    headers: { [ORG_SLUG_HEADER]: SLUG },
  })

describe('POST /v1/campaigns/mine/race-opponent/opponents/manual', () => {
  it('dispatches race_opponent_collection with names + URL hints in params', async () => {
    await seedCampaign({ isPro: true })
    flagOn()
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'run-manual' } as never)

    const result = await post({
      opponents: [
        {
          name: JANE,
          ballotpediaUrl: 'https://ballotpedia.org/Jane_Rival',
          website: 'https://www.janerival.com/about',
        },
        { name: 'John Foe' },
      ],
    })

    expect(result.status).toBe(201)
    expect(result.data).toEqual({ runId: 'run-manual', status: 'running' })
    expect(dispatchRun).toHaveBeenCalledTimes(1)
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'race_opponent_collection',
        organizationSlug: SLUG,
        params: expect.objectContaining({
          opponents: [
            {
              full_name: JANE,
              ballotpedia_url: 'https://ballotpedia.org/Jane_Rival',
              // website is reduced to its apex domain (scheme + www. stripped).
              website_url: 'janerival.com',
            },
            { full_name: 'John Foe' },
          ],
        }),
      }),
    )
  })

  it('persists manual opponents so a later read resolves the same roster', async () => {
    const campaign = await seedCampaign({ isPro: true })
    flagOn()
    vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    ).mockResolvedValue({ runId: 'run-manual' } as never)

    await post({
      opponents: [
        {
          name: JANE,
          ballotpediaUrl: 'https://ballotpedia.org/Jane_Rival',
          website: 'https://www.janerival.com/about',
        },
        { name: 'John Foe' },
      ],
    })

    const plan = await service.prisma.campaignStrategy.findUnique({
      where: { campaignId: campaign.id },
      include: { opponents: true },
    })
    expect(plan?.oppositionPersistedAt).not.toBeNull()
    expect(plan?.opponents.map((opponent) => opponent.fullName).sort()).toEqual(
      [JANE, 'John Foe'].sort(),
    )
    // URL hints persist (website apex-normalized, ballotpedia path intact); an
    // opponent with no hints stores null.
    const jane = plan?.opponents.find((opponent) => opponent.fullName === JANE)
    expect(jane?.ballotpediaUrl).toBe('https://ballotpedia.org/Jane_Rival')
    expect(jane?.websiteUrl).toBe('janerival.com')
    const john = plan?.opponents.find(
      (opponent) => opponent.fullName === 'John Foe',
    )
    expect(john?.ballotpediaUrl).toBeNull()
    expect(john?.websiteUrl).toBeNull()
  })

  it('round-trips persisted URL hints into a later collect() re-dispatch', async () => {
    await seedCampaign({ isPro: true })
    flagOn()
    const dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'run-manual' } as never)

    await post({
      opponents: [
        {
          name: JANE,
          ballotpediaUrl: 'https://ballotpedia.org/Jane_Rival',
          website: 'https://www.janerival.com/about',
        },
      ],
    })
    dispatchRun.mockClear()

    // A retry after a FAILED run hits collect(), which reads the persisted
    // roster via loadOpposition() — the URL hints must survive the round-trip.
    const result = await service.client.post(
      COLLECT_PATH,
      {},
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )

    expect(result.status).toBe(201)
    expect(dispatchRun).toHaveBeenCalledTimes(1)
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'race_opponent_collection',
        params: expect.objectContaining({
          opponents: [
            {
              full_name: JANE,
              ballotpedia_url: 'https://ballotpedia.org/Jane_Rival',
              website_url: 'janerival.com',
            },
          ],
        }),
      }),
    )
  })

  it('adds only new names to an existing roster (no duplicate, no clobber)', async () => {
    const campaign = await seedCampaign({ isPro: true })
    const plan = await service.prisma.campaignStrategy.create({
      data: { campaignId: campaign.id },
    })
    await service.prisma.campaignStrategyOpponent.create({
      data: {
        campaignStrategyId: plan.id,
        // Different case + whitespace: the normalized match must dedup it.
        fullName: ` ${JANE.toUpperCase()} `,
        partyAffiliation: 'Democratic',
      },
    })
    flagOn()
    vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    ).mockResolvedValue({ runId: 'run-manual' } as never)

    await post({ opponents: [{ name: JANE }, { name: 'John Foe' }] })

    const after = await service.prisma.campaignStrategyOpponent.findMany({
      where: { campaignStrategyId: plan.id },
    })
    expect(after).toHaveLength(2)
    // The pre-existing discovered row keeps its party, not the 'Unknown' sentinel.
    const existing = after.find((o) => o.fullName.trim() === JANE.toUpperCase())
    expect(existing?.partyAffiliation).toBe('Democratic')
  })

  it('reuses an in-flight collection run instead of dispatching a duplicate', async () => {
    await seedCampaign({ isPro: true })
    await service.prisma.experimentRun.create({
      data: {
        runId: 'run-inflight',
        organizationSlug: SLUG,
        experimentType: 'race_opponent_collection',
        status: ExperimentRunStatus.RUNNING,
      },
    })
    flagOn()
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    const result = await post({ opponents: [{ name: JANE }] })

    expect(result.status).toBe(201)
    expect(result.data).toEqual({ runId: 'run-inflight', status: 'running' })
    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('403s when the campaign is not Pro', async () => {
    await seedCampaign({ isPro: false })
    const isFeatureEnabled = flagOn()
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    const result = await post({ opponents: [{ name: JANE }] })

    expect(result.status).toBe(403)
    // The Pro gate runs before the flag is read.
    expect(isFeatureEnabled).not.toHaveBeenCalled()
    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('403s when know-your-opponent is off', async () => {
    await seedCampaign({ isPro: true })
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(false)
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    const result = await post({ opponents: [{ name: JANE }] })

    expect(result.status).toBe(403)
    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('400s an empty opponents list', async () => {
    await seedCampaign({ isPro: true })
    flagOn()
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    const result = await post({ opponents: [] })

    expect(result.status).toBe(400)
    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('400s a blank name', async () => {
    await seedCampaign({ isPro: true })
    flagOn()
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    const result = await post({ opponents: [{ name: '   ' }] })

    expect(result.status).toBe(400)
    expect(dispatchRun).not.toHaveBeenCalled()
  })

  it('400s a non-https URL', async () => {
    await seedCampaign({ isPro: true })
    flagOn()
    const dispatchRun = vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    )

    const result = await post({
      opponents: [{ name: JANE, website: 'http://janerival.com' }],
    })

    expect(result.status).toBe(400)
    expect(dispatchRun).not.toHaveBeenCalled()
  })
})
