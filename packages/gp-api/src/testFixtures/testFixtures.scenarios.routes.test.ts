import { RacesService } from '@/elections/services/races.service'
import { useTestService } from '@/test-service'
import { RaceListItem } from '@goodparty_org/contracts'
import { HttpStatus } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { envNonProd } = vi.hoisted(() => ({ envNonProd: { value: true } }))
vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  return {
    ...actual,
    get IS_NON_PROD_DEPLOY() {
      return envNonProd.value
    },
  }
})

const service = useTestService()

const OFFICE = 'Cheyenne City Council - Ward 1'
const TEST_USER_EMAIL = 'test-scenarios@test.goodparty.org'

const race = (id: string, electionDay: string, office = OFFICE) =>
  ({
    id,
    brPositionId: 'br_pos_1',
    position: { name: office, level: 'city', state: 'WY' },
    election: { electionDay },
  }) satisfies RaceListItem

// What dev's election-api answers once the default office's 2026-11-03
// election has passed: nothing upcoming, its primaries and generals behind it.
const PAST_ONLY: Record<'future' | 'past', RaceListItem[]> = {
  future: [race('other_upcoming', '2027-04-06', 'Some Other Office')],
  past: [
    race('primary_2022', '2022-08-16'),
    race('general_2022', '2022-11-08'),
    race('primary_2026', '2026-08-18'),
    race('general_2026', '2026-11-03'),
  ],
}

let getRacesByZip: ReturnType<typeof vi.fn>

const stubRaces = (byTimeframe: Record<'future' | 'past', RaceListItem[]>) => {
  getRacesByZip = vi
    .spyOn(service.app.get(RacesService), 'getRacesByZip')
    .mockImplementation(({ timeframe }) =>
      Promise.resolve(byTimeframe[timeframe === 'past' ? 'past' : 'future']),
    ) as unknown as ReturnType<typeof vi.fn>
}

// The day after the default office's election, and every day after it.
const afterElectionDay = () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-10T15:00:00Z'))
}

const seedCampaign = async (
  userId: number,
  details: PrismaJson.CampaignDetails = { electionDate: '2026-11-03' },
) => {
  const slug = `scenario-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({ data: { slug, ownerId: userId } })
  return service.prisma.campaign.create({
    data: { userId, slug, organizationSlug: slug, details },
  })
}

const applyElection = (campaignId: number, preset: string) =>
  service.client.post(`/v1/test-fixtures/campaigns/${campaignId}/election`, {
    preset,
  })

beforeEach(async () => {
  envNonProd.value = true
  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { email: TEST_USER_EMAIL },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /v1/test-fixtures/races/resolve', () => {
  const resolve = () =>
    service.client.get('/v1/test-fixtures/races/resolve', {
      params: { zip: '82001', office: OFFICE },
    })

  it('answers the next upcoming race while there is one', async () => {
    stubRaces({
      future: [race('next', '2026-11-03'), race('after', '2028-11-07')],
      past: [race('general_2022', '2022-11-08')],
    })

    const res = await resolve()

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.id).toBe('next')
    expect(getRacesByZip).toHaveBeenCalledTimes(1)
    expect(getRacesByZip).toHaveBeenCalledWith({
      zipcode: '82001',
      timeframe: 'future',
    })
  })

  it('still resolves the office after its election has passed', async () => {
    afterElectionDay()
    stubRaces(PAST_ONLY)

    const res = await resolve()

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.id).toBe('general_2026')
    expect(res.data.brPositionId).toBe('br_pos_1')
  })

  it('400s only when the office does not exist at that zip', async () => {
    stubRaces({ future: [], past: [] })

    const res = await resolve()

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('refuses a user who is not a test user', async () => {
    stubRaces(PAST_ONLY)
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'staff@goodparty.org' },
    })

    expect((await resolve()).status).toBe(HttpStatus.FORBIDDEN)
  })

  it('404s on a production deploy', async () => {
    stubRaces(PAST_ONLY)
    envNonProd.value = false

    expect((await resolve()).status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('POST /v1/test-fixtures/campaigns/:id/election', () => {
  it('declares an election eight weeks from the server clock, after election day too', async () => {
    afterElectionDay()
    const campaign = await seedCampaign(service.user.id, {
      electionDate: '2026-11-03',
      wonGeneral: true,
      primaryElectionDate: '2026-08-18',
    })

    const res = await applyElection(campaign.id, 'in_8_weeks')

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      campaignId: campaign.id,
      preset: 'in_8_weeks',
      electionDate: '2027-01-05',
    })
    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.details.electionDate).toBe('2027-01-05')
    expect(row.details.wonGeneral).toBeUndefined()
    expect(row.details.primaryElectionDate).toBeUndefined()
  })

  it.each([
    ['in_1_week', '2026-11-17', undefined],
    ['passed_unanswered', '2026-10-27', undefined],
    ['passed_lost', '2026-10-27', false],
  ])('declares %s as %s', async (preset, electionDate, wonGeneral) => {
    afterElectionDay()
    const campaign = await seedCampaign(service.user.id)

    const res = await applyElection(campaign.id, preset)

    expect(res.status).toBe(HttpStatus.OK)
    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.details.electionDate).toBe(electionDate)
    expect(row.details.wonGeneral).toBe(wonGeneral)
  })

  it('marks a won race only when the win flow already linked its office', async () => {
    afterElectionDay()
    const campaign = await seedCampaign(service.user.id)

    const refused = await applyElection(campaign.id, 'passed_won')
    expect(refused.status).toBe(HttpStatus.CONFLICT)

    const officeSlug = `eo-scenario-${campaign.id}`
    await service.prisma.organization.create({
      data: { slug: officeSlug, ownerId: service.user.id },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: officeSlug,
        userId: service.user.id,
        campaignId: campaign.id,
      },
    })

    const res = await applyElection(campaign.id, 'passed_won')

    expect(res.status).toBe(HttpStatus.OK)
    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.details.electionDate).toBe('2026-10-11')
    expect(row.details.wonGeneral).toBe(true)
  })

  it("404s on another user's campaign and leaves it alone", async () => {
    const other = await service.prisma.user.create({
      data: { email: `other-${Date.now()}@test.goodparty.org` },
    })
    const campaign = await seedCampaign(other.id)

    const res = await applyElection(campaign.id, 'in_8_weeks')

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.details.electionDate).toBe('2026-11-03')
  })

  it('refuses an unknown preset', async () => {
    const campaign = await seedCampaign(service.user.id)

    expect((await applyElection(campaign.id, 'tomorrow')).status).toBe(
      HttpStatus.BAD_REQUEST,
    )
  })

  it('refuses a user who is not a test user, and 404s on prod', async () => {
    const campaign = await seedCampaign(service.user.id)
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'staff@goodparty.org' },
    })
    expect((await applyElection(campaign.id, 'in_8_weeks')).status).toBe(
      HttpStatus.FORBIDDEN,
    )

    envNonProd.value = false
    expect((await applyElection(campaign.id, 'in_8_weeks')).status).toBe(
      HttpStatus.NOT_FOUND,
    )
  })
})
