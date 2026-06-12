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
  isActive: true,
  termEndAt: FUTURE_TERM_END,
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

  it('treats an active office with a future term end as held', async () => {
    const service = await buildService(
      [],
      [buildOffice({ isActive: true, termEndAt: FUTURE_TERM_END })],
    )

    const result = await service.evaluate(1)

    expect(result.holdsOffice).toBe(true)
    expect(result.canStartCampaign).toBe(true)
    expect(result.canGainOffice).toBe(false)
  })

  it('treats an office with a past term end as not held', async () => {
    const service = await buildService(
      [],
      [buildOffice({ isActive: true, termEndAt: PAST_TERM_END })],
    )

    const result = await service.evaluate(1)

    expect(result.holdsOffice).toBe(false)
    expect(result.canGainOffice).toBe(true)
  })

  it('treats an inactive office with a null term end as not held', async () => {
    const service = await buildService(
      [],
      [buildOffice({ isActive: false, termEndAt: null })],
    )

    const result = await service.evaluate(1)

    expect(result.holdsOffice).toBe(false)
  })

  it('returns the held office organizationSlug as reelectionOfficeSlug', async () => {
    const service = await buildService(
      [],
      [buildOffice({ organizationSlug: 'held-office-slug' })],
    )

    const result = await service.evaluate(1)

    expect(result.reelectionOfficeSlug).toBe('held-office-slug')
  })

  it('falls back to the most-recent office slug when none is held', async () => {
    const service = await buildService(
      [],
      [
        buildOffice({
          organizationSlug: 'older-office',
          isActive: false,
          createdAt: new Date('2018-01-01'),
        }),
        buildOffice({
          organizationSlug: 'newer-office',
          isActive: false,
          createdAt: new Date('2022-01-01'),
        }),
      ],
    )

    const result = await service.evaluate(1)

    expect(result.holdsOffice).toBe(false)
    expect(result.reelectionOfficeSlug).toBe('newer-office')
  })

  it('returns a null reelectionOfficeSlug when the user has no offices', async () => {
    const service = await buildService([], [])

    const result = await service.evaluate(1)

    expect(result.reelectionOfficeSlug).toBeNull()
  })
})
