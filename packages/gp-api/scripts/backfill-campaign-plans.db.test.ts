import { describe, expect, it } from 'vitest'
import { addDays, format, subDays } from 'date-fns'
import { useTestService } from '../src/test-service'
import { selectCandidates } from './backfill-campaign-plans'

// The eligibility predicate is five SQL conditions and the one that matters
// most is invisible from the outside: a campaign whose plan generation failed
// half way has a campaign_strategy row with one persisted marker, and it has to
// be picked up rather than read as "already has a plan".
describe('selectCandidates against the database', () => {
  const service = useTestService()

  const dateString = (date: Date): string => format(date, 'yyyy-MM-dd')
  const future = dateString(addDays(new Date(), 30))
  const past = dateString(subDays(new Date(), 30))

  let seq = 0
  const seedCampaign = async (
    details: Record<string, unknown> = {},
    overrides: Record<string, unknown> = {},
  ) => {
    const slug = `backfill-${++seq}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    return service.prisma.campaign.create({
      data: {
        organizationSlug: slug,
        userId: service.user.id,
        slug,
        isActive: true,
        isDemo: false,
        details: { raceId: 'br-race', electionDate: future, ...details },
        ...overrides,
      },
    })
  }

  const idsFromSelect = async (): Promise<number[]> =>
    (await selectCandidates(service.prisma)).map((row) => row.id)

  it('selects an active campaign with a race, an upcoming election and no plan', async () => {
    const campaign = await seedCampaign()

    expect(await idsFromSelect()).toEqual([campaign.id])
  })

  it('falls back to the primary when there is no general election date', async () => {
    const campaign = await seedCampaign({
      electionDate: undefined,
      primaryElectionDate: future,
    })

    expect(await idsFromSelect()).toEqual([campaign.id])
  })

  it('skips an inactive campaign', async () => {
    await seedCampaign({}, { isActive: false })

    expect(await idsFromSelect()).toEqual([])
  })

  it('skips a demo campaign', async () => {
    await seedCampaign({}, { isDemo: true })

    expect(await idsFromSelect()).toEqual([])
  })

  it.each([[{ raceId: undefined }], [{ raceId: '' }]])(
    'skips a campaign with no usable raceId (%o)',
    async (details) => {
      await seedCampaign(details)

      expect(await idsFromSelect()).toEqual([])
    },
  )

  it('skips a campaign whose election has passed', async () => {
    await seedCampaign({ electionDate: past })

    expect(await idsFromSelect()).toEqual([])
  })

  it('skips a campaign with no date at all', async () => {
    await seedCampaign({ electionDate: undefined })

    expect(await idsFromSelect()).toEqual([])
  })

  it('skips a campaign whose plan is fully persisted', async () => {
    const campaign = await seedCampaign()
    await service.prisma.campaignStrategy.create({
      data: {
        campaignId: campaign.id,
        oppositionPersistedAt: new Date(),
        opportunitiesPersistedAt: new Date(),
      },
    })

    expect(await idsFromSelect()).toEqual([])
  })

  // The non-obvious case: a generation that died between its two sections.
  it.each([
    ['opposition only', { oppositionPersistedAt: new Date() }],
    ['opportunities only', { opportunitiesPersistedAt: new Date() }],
    ['neither', {}],
  ])('selects a half-finished plan (%s)', async (_label, markers) => {
    const campaign = await seedCampaign()
    await service.prisma.campaignStrategy.create({
      data: { campaignId: campaign.id, ...markers },
    })

    expect(await idsFromSelect()).toEqual([campaign.id])
  })

  it('returns the oldest campaign first so --limit is a stable prefix', async () => {
    const first = await seedCampaign()
    const second = await seedCampaign()

    expect(await idsFromSelect()).toEqual([first.id, second.id])
  })

  it('carries the election date and email the dry-run report prints', async () => {
    await seedCampaign()

    const [row] = await selectCandidates(service.prisma)

    expect(row?.electionDate).toBe(future)
    expect(row?.email).toBe(service.user.email)
  })
})
