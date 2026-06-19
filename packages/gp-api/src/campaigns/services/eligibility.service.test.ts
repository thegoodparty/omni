import { Test, TestingModule } from '@nestjs/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Campaign, ElectedOffice } from '../../generated/prisma'
import { ElectedOfficeService } from '@/electedOffice/services/electedOffice.service'
import { CampaignsService } from './campaigns.service'
import { EligibilityService } from './eligibility.service'

const FUTURE_ELECTION_DATE = '2999-11-04'
const PAST_ELECTION_DATE = '2000-11-04'
const FUTURE_TERM_END = new Date('2999-01-01')
const PAST_TERM_END = new Date('2000-01-01')

const buildCampaign = (
  overrides: Partial<Campaign> = {},
): Partial<Campaign> => ({
  didWin: null,
  details: { electionDate: FUTURE_ELECTION_DATE },
  ...overrides,
})

const buildOffice = (
  overrides: Partial<ElectedOffice> = {},
): Partial<ElectedOffice> => ({
  organizationSlug: 'office-slug',
  termEndDate: FUTURE_TERM_END,
  createdAt: new Date('2020-01-01'),
  ...overrides,
})

const buildService = async (
  campaigns: Partial<Campaign>[],
  electedOffices: Partial<ElectedOffice>[],
) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      {
        provide: CampaignsService,
        useValue: { findMany: vi.fn().mockResolvedValue(campaigns) },
      },
      {
        provide: ElectedOfficeService,
        useValue: { findMany: vi.fn().mockResolvedValue(electedOffices) },
      },
      EligibilityService,
    ],
  }).compile()

  return module.get<EligibilityService>(EligibilityService)
}

describe('EligibilityService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('treats a future-dated campaign with didWin null as active', async () => {
    const service = await buildService(
      [
        buildCampaign({
          didWin: null,
          details: { electionDate: FUTURE_ELECTION_DATE },
        }),
      ],
      [],
    )

    const result = await service.evaluate(1)

    expect(result.hasActiveCampaign).toBe(true)
    expect(result.canStartCampaign).toBe(false)
  })

  it('does not count a demo campaign as active', async () => {
    const service = await buildService(
      [
        buildCampaign({
          isDemo: true,
          didWin: null,
          details: { electionDate: FUTURE_ELECTION_DATE },
        }),
      ],
      [],
    )

    const result = await service.evaluate(1)

    expect(result.hasActiveCampaign).toBe(false)
    expect(result.canStartCampaign).toBe(true)
  })

  it('treats a concluded campaign (didWin set) as not active', async () => {
    const service = await buildService([buildCampaign({ didWin: false })], [])

    const result = await service.evaluate(1)

    expect(result.hasActiveCampaign).toBe(false)
    expect(result.canStartCampaign).toBe(true)
  })

  it('treats a past election date with didWin null as concluded', async () => {
    const service = await buildService(
      [
        buildCampaign({
          didWin: null,
          details: { electionDate: PAST_ELECTION_DATE },
        }),
      ],
      [],
    )

    const result = await service.evaluate(1)

    expect(result.hasActiveCampaign).toBe(false)
    expect(result.canStartCampaign).toBe(true)
  })

  it('treats a primary loss as concluded even with a future general election', async () => {
    const service = await buildService(
      [
        buildCampaign({
          didWin: null,
          primaryResult: 'lost',
          details: { electionDate: FUTURE_ELECTION_DATE },
        }),
      ],
      [],
    )

    const result = await service.evaluate(1)

    expect(result.hasActiveCampaign).toBe(false)
    expect(result.canStartCampaign).toBe(true)
  })

  it('keeps a primary winner active until the general election', async () => {
    const service = await buildService(
      [
        buildCampaign({
          didWin: null,
          primaryResult: 'won',
          details: { electionDate: FUTURE_ELECTION_DATE },
        }),
      ],
      [],
    )

    const result = await service.evaluate(1)

    expect(result.hasActiveCampaign).toBe(true)
    expect(result.canStartCampaign).toBe(false)
  })

  it('treats a campaign as active at midday on election day', async () => {
    const today = '2026-11-03'
    vi.setSystemTime(new Date(`${today}T14:00:00Z`))

    const service = await buildService(
      [buildCampaign({ didWin: null, details: { electionDate: today } })],
      [],
    )

    const result = await service.evaluate(1)

    expect(result.hasActiveCampaign).toBe(true)
    expect(result.canStartCampaign).toBe(false)

    vi.useRealTimers()
  })

  it('treats a campaign as concluded the day after its election', async () => {
    vi.setSystemTime(new Date('2026-11-04T14:00:00Z'))

    const service = await buildService(
      [
        buildCampaign({
          didWin: null,
          details: { electionDate: '2026-11-03' },
        }),
      ],
      [],
    )

    const result = await service.evaluate(1)

    expect(result.hasActiveCampaign).toBe(false)
    expect(result.canStartCampaign).toBe(true)

    vi.useRealTimers()
  })

  it('treats an office with a future term end as held', async () => {
    const service = await buildService(
      [],
      [buildOffice({ termEndDate: FUTURE_TERM_END })],
    )

    const result = await service.evaluate(1)

    expect(result.holdsOffice).toBe(true)
    expect(result.canStartCampaign).toBe(true)
    expect(result.canGainOffice).toBe(false)
  })

  it('treats an office with a past term end as not held', async () => {
    const service = await buildService(
      [],
      [buildOffice({ termEndDate: PAST_TERM_END })],
    )

    const result = await service.evaluate(1)

    expect(result.holdsOffice).toBe(false)
    expect(result.canGainOffice).toBe(true)
  })

  it('treats an office with a null term end as not held (derived inactive)', async () => {
    // isActive is derived from termEndDate; a null end means term data is
    // missing, so the office is not held until the holder supplies dates.
    const service = await buildService([], [buildOffice({ termEndDate: null })])

    const result = await service.evaluate(1)

    expect(result.holdsOffice).toBe(false)
    expect(result.canGainOffice).toBe(true)
  })

  it('returns the held office organizationSlug as reelectionOfficeSlug', async () => {
    const service = await buildService(
      [],
      [buildOffice({ organizationSlug: 'held-office-slug' })],
    )

    const result = await service.evaluate(1)

    expect(result.reelectionOfficeSlug).toBe('held-office-slug')
  })

  it('falls back to the office with the latest term start, not createdAt', async () => {
    const service = await buildService(
      [],
      [
        buildOffice({
          organizationSlug: 'older-office',
          termStartDate: new Date('2018-01-01'),
          termEndDate: new Date('2019-01-01'),
          createdAt: new Date('2022-06-01'),
        }),
        buildOffice({
          organizationSlug: 'newer-office',
          termStartDate: new Date('2022-01-01'),
          termEndDate: new Date('2023-01-01'),
          createdAt: new Date('2018-06-01'),
        }),
      ],
    )

    const result = await service.evaluate(1)

    expect(result.holdsOffice).toBe(false)
    expect(result.reelectionOfficeSlug).toBe('newer-office')
  })

  it('falls back to termEndDate when termStartDate is null', async () => {
    const service = await buildService(
      [],
      [
        buildOffice({
          organizationSlug: 'earlier-end',
          termStartDate: null,
          termEndDate: new Date('2019-06-01'),
          createdAt: new Date('2022-01-01'),
        }),
        buildOffice({
          organizationSlug: 'later-end',
          termStartDate: null,
          termEndDate: new Date('2023-06-01'),
          createdAt: new Date('2018-01-01'),
        }),
      ],
    )

    const result = await service.evaluate(1)

    expect(result.holdsOffice).toBe(false)
    expect(result.reelectionOfficeSlug).toBe('later-end')
  })

  it('falls back to createdAt when both term dates are null', async () => {
    const service = await buildService(
      [],
      [
        buildOffice({
          organizationSlug: 'older-created',
          termStartDate: null,
          termEndDate: null,
          createdAt: new Date('2018-01-01'),
        }),
        buildOffice({
          organizationSlug: 'newer-created',
          termStartDate: null,
          termEndDate: null,
          createdAt: new Date('2022-01-01'),
        }),
      ],
    )

    const result = await service.evaluate(1)

    expect(result.holdsOffice).toBe(false)
    expect(result.reelectionOfficeSlug).toBe('newer-created')
  })

  it('returns a null reelectionOfficeSlug when the user has no offices', async () => {
    const service = await buildService([], [])

    const result = await service.evaluate(1)

    expect(result.reelectionOfficeSlug).toBeNull()
  })
})
