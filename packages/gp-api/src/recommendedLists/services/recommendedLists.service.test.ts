import { beforeEach, describe, expect, it, vi } from 'vitest'
import { convertVoterFileFilterToFilters } from '@/contacts/utils/voterFileFilter.utils'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import type { VoterFilterBase } from '@/shared/schemas/voterFilterBase.schema'
import type { FilterData } from '@/peopleDb/schemas/filters.schema'
import type { DbxDistrict } from '@/peopleDb/databricks/databricksVoterSql.util'
import type { Organization } from '../../generated/prisma'
import {
  DOOR_TARGET_VOTERS,
  DOOR_WIDENING_FACTOR,
  RECOMMENDED_LIST_SIZE_FLOOR,
} from '../recommendedLists.consts'
import { RecommendedListsService } from './recommendedLists.service'

const DISTRICT_ID = '11111111-2222-3333-4444-555555555555'
const DISTRICT_TOTAL = 100_000
const CAMPAIGN_ID = 42

const organization = { slug: 'win-org' } as Organization
const electedOffice = { slug: 'eo-town-council' } as Organization

const district: DbxDistrict = {
  districtId: DISTRICT_ID,
  state: 'PA',
  districtType: 'Congressional_District',
  districtName: '12',
  useVoterOnlyPath: false,
}

const rankedPrecincts = (count: number) =>
  Array.from({ length: count }, (_unused, index) => ({
    county: 'ALLEGHENY',
    precinct: `P${index}`,
    voters: 100,
  }))

describe('RecommendedListsService.recommend', () => {
  let resolveEligibleDistrictId: ReturnType<typeof vi.fn>
  let resolveSavedFilterForQuery: ReturnType<typeof vi.fn>
  let bucketForCampaign: ReturnType<typeof vi.fn>
  let findByOrganizationSlug: ReturnType<typeof vi.fn>
  let resolveDistrict: ReturnType<typeof vi.fn>
  let countForFilter: ReturnType<typeof vi.fn>
  let districtTotal: ReturnType<typeof vi.fn>
  let rankPrecincts: ReturnType<typeof vi.fn>
  let service: RecommendedListsService

  beforeEach(() => {
    resolveEligibleDistrictId = vi.fn().mockResolvedValue(DISTRICT_ID)
    // The real conversion, so the FilterData each count receives is the
    // one the variant's own universe produces and a test can key on it.
    resolveSavedFilterForQuery = vi.fn(
      async (_organization: Organization, filter: VoterFilterBase) => ({
        filters: convertVoterFileFilterToFilters(filter),
        empty: false,
      }),
    )
    bucketForCampaign = vi.fn().mockResolvedValue(null)
    findByOrganizationSlug = vi.fn().mockResolvedValue([])
    resolveDistrict = vi.fn().mockResolvedValue(district)
    countForFilter = vi.fn().mockResolvedValue(1000)
    districtTotal = vi.fn().mockResolvedValue(DISTRICT_TOTAL)
    rankPrecincts = vi.fn().mockResolvedValue({
      precincts: rankedPrecincts(4),
      totalVoters: DOOR_TARGET_VOTERS,
      reachedTarget: true,
    })

    service = new RecommendedListsService(
      { resolveEligibleDistrictId, resolveSavedFilterForQuery } as never,
      { bucketForCampaign } as never,
      { findByOrganizationSlug } as never,
      {
        resolveDistrict,
        countForFilter,
        districtTotal,
        rankPrecincts,
      } as never,
      createMockLogger(),
    )
  })

  it('omits ideology variants when the campaign has no bucket', async () => {
    const results = await service.recommend(
      organization,
      CAMPAIGN_ID,
      'sms',
      'persuade',
    )

    expect(results.map((result) => result.variant)).toEqual([
      'persuadeAffinity',
      'persuadeUndecided',
    ])
  })

  it('includes ideology variants when the campaign has a bucket', async () => {
    bucketForCampaign.mockResolvedValue('progressive')

    const results = await service.recommend(
      organization,
      CAMPAIGN_ID,
      'sms',
      'persuade',
    )
    const ideology = results.find(
      (result) => result.variant === 'persuadeIdeology',
    )

    // `progressive` is the product's word; `Liberal` is the mart column's,
    // and the filter has to carry the column's.
    expect(ideology?.filter.ideologyLiberal).toBe(true)
    expect(ideology?.copy.title).toBe('Voters who may lean progressive')
  })

  it('returns variants in registry display order', async () => {
    bucketForCampaign.mockResolvedValue('progressive')

    const results = await service.recommend(
      organization,
      CAMPAIGN_ID,
      'sms',
      'persuade',
    )

    expect(results.map((result) => result.variant)).toEqual([
      'persuadeAffinity',
      'persuadeIdeology',
      'persuadeUndecided',
    ])
  })

  it('omits a variant one voter under the size floor', async () => {
    countForFilter.mockResolvedValue(RECOMMENDED_LIST_SIZE_FLOOR - 1)

    const results = await service.recommend(
      organization,
      CAMPAIGN_ID,
      'sms',
      'introduce',
    )

    expect(results).toEqual([])
  })

  it('keeps a variant sitting exactly on the size floor', async () => {
    countForFilter.mockResolvedValue(RECOMMENDED_LIST_SIZE_FLOOR)

    const results = await service.recommend(
      organization,
      CAMPAIGN_ID,
      'sms',
      'introduce',
    )

    expect(results).toHaveLength(1)
    expect(results[0]?.count).toBe(RECOMMENDED_LIST_SIZE_FLOOR)
  })

  it('counts every variant concurrently, not in series', async () => {
    bucketForCampaign.mockResolvedValue('progressive')
    let inFlight = 0
    let peak = 0
    countForFilter.mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return 1000
    })

    await service.recommend(organization, CAMPAIGN_ID, 'sms', 'persuade')

    expect(peak).toBe(3)
  })

  it('divides the count by the mart district total for the share', async () => {
    countForFilter.mockResolvedValue(2_500)

    const [first] = await service.recommend(
      organization,
      CAMPAIGN_ID,
      'sms',
      'introduce',
    )

    expect(districtTotal).toHaveBeenCalledWith(district)
    expect(first?.districtShare).toBeCloseTo(2_500 / DISTRICT_TOTAL, 10)
  })

  // Field-level: `estimatedCost` is deferred and must not appear at all,
  // and `districtShare` must be absent rather than null when the total is
  // unreadable. An extra key here is invisible to a partial match.
  it('omits districtShare entirely when the district total fails', async () => {
    districtTotal.mockRejectedValue(new Error('warehouse timeout'))

    const [first] = await service.recommend(
      organization,
      CAMPAIGN_ID,
      'sms',
      'introduce',
    )

    expect(Object.keys(first ?? {}).sort()).toEqual([
      'copy',
      'count',
      'existingFilterId',
      'filter',
      'variant',
    ])
  })

  it('returns the existing filter id when the list exists', async () => {
    findByOrganizationSlug.mockResolvedValue([
      {
        id: 77,
        // Same universe, arrays written the other way round: the dedupe
        // compares normalized payloads, not stored order.
        voterStatus: ['Likely', 'Super'],
        supportStatus: ['unknown'],
        hasCellPhone: true,
        activityConditions: [],
      },
    ])

    const [first] = await service.recommend(
      organization,
      CAMPAIGN_ID,
      'sms',
      'introduce',
    )

    expect(first?.existingFilterId).toBe(77)
  })

  // The over-match the loaded `activityConditions` relation exists to
  // prevent: same universe, one extra condition, and it is a different
  // list. A saved row read without the relation looks condition-free and
  // would hand this candidate someone else's audience.
  it('does not match a list differing only by a condition', async () => {
    findByOrganizationSlug.mockResolvedValue([
      {
        id: 79,
        voterStatus: ['Super', 'Likely'],
        supportStatus: ['unknown'],
        hasCellPhone: true,
        activityConditions: [
          { outreachType: 'sms', outreachId: null, actions: ['delivered'] },
        ],
      },
    ])

    const [first] = await service.recommend(
      organization,
      CAMPAIGN_ID,
      'sms',
      'introduce',
    )

    expect(first?.existingFilterId).toBeNull()
  })

  it('returns a null existing id when nothing matches', async () => {
    findByOrganizationSlug.mockResolvedValue([
      {
        id: 78,
        voterStatus: ['Super'],
        supportStatus: ['supporter'],
        activityConditions: [],
      },
    ])

    const [first] = await service.recommend(
      organization,
      CAMPAIGN_ID,
      'sms',
      'introduce',
    )

    expect(first?.existingFilterId).toBeNull()
  })

  it('drops a failed variant without losing the others', async () => {
    bucketForCampaign.mockResolvedValue('progressive')
    // Keyed on the universe rather than call order, so the rejection lands
    // on the affinity variant however the concurrent calls interleave.
    countForFilter.mockImplementation((_district, filters: FilterData) =>
      filters.filters.includes('independentAffinity')
        ? Promise.reject(new Error('warehouse timeout'))
        : Promise.resolve(1000),
    )

    const results = await service.recommend(
      organization,
      CAMPAIGN_ID,
      'sms',
      'persuade',
    )

    expect(results.map((result) => result.variant)).toEqual([
      'persuadeIdeology',
      'persuadeUndecided',
    ])
  })

  it('omits a variant whose support status resolves to nobody', async () => {
    resolveSavedFilterForQuery.mockResolvedValue({
      filters: {},
      empty: true,
    })

    const results = await service.recommend(
      organization,
      CAMPAIGN_ID,
      'sms',
      'introduce',
    )

    expect(results).toEqual([])
    expect(countForFilter).not.toHaveBeenCalled()
  })

  it('returns nothing for an intent with no variants', async () => {
    const results = await service.recommend(
      organization,
      CAMPAIGN_ID,
      'sms',
      null,
    )

    expect(results).toEqual([])
    expect(resolveEligibleDistrictId).not.toHaveBeenCalled()
  })

  it('returns nothing for an elected-office organization', async () => {
    const results = await service.recommend(
      electedOffice,
      CAMPAIGN_ID,
      'sms',
      'introduce',
    )

    expect(results).toEqual([])
    expect(resolveEligibleDistrictId).not.toHaveBeenCalled()
  })

  describe('door knocking', () => {
    it('takes the count from the ranking, not a second query', async () => {
      rankPrecincts.mockResolvedValue({
        precincts: rankedPrecincts(4),
        totalVoters: 6_000,
        reachedTarget: true,
      })

      const [first] = await service.recommend(
        organization,
        CAMPAIGN_ID,
        'doorKnocking',
        'introduce',
      )

      expect(first?.count).toBe(6_000)
      expect(first?.filter.precincts).toEqual([
        'ALLEGHENY|P0',
        'ALLEGHENY|P1',
        'ALLEGHENY|P2',
        'ALLEGHENY|P3',
      ])
      expect(countForFilter).not.toHaveBeenCalled()
    })

    it('widens the precinct set when a door list is short', async () => {
      rankPrecincts
        .mockResolvedValueOnce({
          precincts: rankedPrecincts(3),
          totalVoters: 100,
          reachedTarget: true,
        })
        .mockResolvedValueOnce({
          precincts: rankedPrecincts(6),
          totalVoters: 400,
          reachedTarget: true,
        })

      const [first] = await service.recommend(
        organization,
        CAMPAIGN_ID,
        'doorKnocking',
        'introduce',
      )

      expect(first?.filter.precincts).toHaveLength(6)
      expect(first?.count).toBe(400)
      expect(rankPrecincts.mock.calls.map((call) => call[2])).toEqual([
        DOOR_TARGET_VOTERS,
        DOOR_TARGET_VOTERS * DOOR_WIDENING_FACTOR,
      ])
    })

    // The third outcome, and the one that would otherwise never run until a
    // real district hit it: the ranking is spent, so widening cannot help
    // and the district-wide list is what gets sized.
    it('stops widening a spent ranking and sizes the district', async () => {
      rankPrecincts.mockResolvedValue({
        precincts: rankedPrecincts(2),
        totalVoters: 100,
        reachedTarget: false,
      })
      countForFilter.mockResolvedValue(900)

      const [first] = await service.recommend(
        organization,
        CAMPAIGN_ID,
        'doorKnocking',
        'introduce',
      )

      expect(rankPrecincts).toHaveBeenCalledTimes(1)
      expect(first?.count).toBe(900)
      expect(first?.filter.precincts).toBeUndefined()
    })

    it('omits a door variant whose district-wide count is short', async () => {
      rankPrecincts.mockResolvedValue({
        precincts: rankedPrecincts(2),
        totalVoters: 10,
        reachedTarget: false,
      })
      countForFilter.mockResolvedValue(RECOMMENDED_LIST_SIZE_FLOOR - 1)

      const results = await service.recommend(
        organization,
        CAMPAIGN_ID,
        'doorKnocking',
        'introduce',
      )

      expect(results).toEqual([])
    })
  })
})
