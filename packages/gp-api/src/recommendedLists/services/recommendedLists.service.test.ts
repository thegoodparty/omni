import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { convertVoterFileFilterToFilters } from '@/contacts/utils/voterFileFilter.utils'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import {
  calcRobocallAmountInCents,
  calcRobocallTotalInCents,
} from '@/shared/util/robocallPricing.util'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'
import type { VoterFilterBase } from '@/shared/schemas/voterFilterBase.schema'
import type { FilterData } from '@/peopleDb/schemas/filters.schema'
import { DOOR_PRECINCT_COUNT } from '@/peopleDb/databricks/databricksRecommendedListsSql.util'
import type { DbxDistrict } from '@/peopleDb/databricks/databricksVoterSql.util'
import type { Campaign, Organization } from '../../generated/prisma'
import { VOTE_GOAL_FLOOR_SHARE } from '../recommendedLists.consts'
import { RecommendedListsService } from './recommendedLists.service'

const DISTRICT_ID = '11111111-2222-3333-4444-555555555555'
const RACE_ID = 'br-race-hash'
const VOTES_NEEDED = 4_000
// The floor every non-exempt variant is held to, derived rather than
// restated so a change to the share moves every expectation with it.
const FLOOR = VOTES_NEEDED * VOTE_GOAL_FLOOR_SHARE

const organization = { slug: 'win-org' } as Organization
const electedOffice = { slug: 'eo-town-council' } as Organization
const campaign = {
  id: 42,
  details: { raceId: RACE_ID },
} as unknown as Campaign

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

// A variant asking for supporters and nobody else — the shape the registry's
// `supporterBased` flag marks, used here to key a mock on the id'd-supporter
// universes without naming variants.
const isSupporterUniverse = (filter: VoterFilterBase) =>
  filter.supportStatus?.length === 1 && filter.supportStatus[0] === 'supporter'

describe('RecommendedListsService.recommend', () => {
  let resolveEligibleDistrictId: ReturnType<typeof vi.fn>
  let resolveSavedFilterForQuery: ReturnType<typeof vi.fn>
  let bucketForCampaign: ReturnType<typeof vi.fn>
  let findByOrganizationSlug: ReturnType<typeof vi.fn>
  let resolveDistrict: ReturnType<typeof vi.fn>
  let countForFilter: ReturnType<typeof vi.fn>
  let rankPrecincts: ReturnType<typeof vi.fn>
  let getRaceContext: ReturnType<typeof vi.fn>
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
    countForFilter = vi.fn().mockResolvedValue(2_000)
    rankPrecincts = vi.fn().mockResolvedValue({
      precincts: rankedPrecincts(DOOR_PRECINCT_COUNT),
      totalVoters: 100 * DOOR_PRECINCT_COUNT,
    })
    getRaceContext = vi
      .fn()
      .mockResolvedValue({ winNumberEffective: VOTES_NEEDED })

    service = new RecommendedListsService(
      { resolveEligibleDistrictId, resolveSavedFilterForQuery } as never,
      { bucketForCampaign } as never,
      { findByOrganizationSlug } as never,
      {
        resolveDistrict,
        countForFilter,
        rankPrecincts,
      } as never,
      { getRaceContext } as never,
      createMockLogger(),
    )
  })

  it('omits ideology variants when the campaign has no bucket', async () => {
    const results = await service.recommend(
      organization,
      campaign,
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
      campaign,
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
      campaign,
      'sms',
      'persuade',
    )

    expect(results.map((result) => result.variant)).toEqual([
      'persuadeAffinity',
      'persuadeIdeology',
      'persuadeUndecided',
    ])
  })

  describe('the vote-goal size floor', () => {
    it('omits a variant one voter under a quarter of the vote goal', async () => {
      countForFilter.mockResolvedValue(FLOOR - 1)

      const results = await service.recommend(
        organization,
        campaign,
        'sms',
        'introduce',
      )

      expect(results).toEqual([])
    })

    it('keeps a variant sitting exactly on a quarter of the vote goal', async () => {
      countForFilter.mockResolvedValue(FLOOR)

      const results = await service.recommend(
        organization,
        campaign,
        'sms',
        'introduce',
      )

      expect(results).toHaveLength(1)
      expect(results[0]?.count).toBe(FLOOR)
    })

    // The case this change is for. 300 people cleared the old absolute floor
    // of 250 and shipped a card; against a 4,000-vote goal it is 7.5% of what
    // the race needs, and no longer worth one.
    it('omits a list that is comfortably over 250 but under the share', async () => {
      countForFilter.mockResolvedValue(300)

      const results = await service.recommend(
        organization,
        campaign,
        'sms',
        'introduce',
      )

      expect(results).toEqual([])
    })

    // A door list is three precincts, so precinct size sets how big it is
    // and the race has nothing to say about it. Holding it to a race-wide
    // goal would suppress nearly every one.
    it('keeps a door list far under the share', async () => {
      rankPrecincts.mockResolvedValue({
        precincts: rankedPrecincts(3),
        totalVoters: 300,
      })

      const [first] = await service.recommend(
        organization,
        campaign,
        'doorKnocking',
        'introduce',
      )

      expect(first?.count).toBe(300)
    })

    // A supporter list is additive: it is always offered beside a bigger
    // recommendation for the same intent, so a small one is still useful.
    it('keeps a supporter variant far under the share', async () => {
      resolveSavedFilterForQuery.mockImplementation(
        async (_organization: Organization, filter: VoterFilterBase) => ({
          filters: convertVoterFileFilterToFilters(filter),
          empty: false,
          // Carried through so the count mock below can tell the supporter
          // universe apart from the exclusion-list one.
          idOverrides: isSupporterUniverse(filter)
            ? { include: ['supporter-1'] }
            : undefined,
        }),
      )
      countForFilter.mockImplementation(
        (_district, _filters, idOverrides?: { include: string[] }) =>
          Promise.resolve(idOverrides ? 300 : 2_000),
      )

      const results = await service.recommend(
        organization,
        campaign,
        'sms',
        'event',
      )

      expect(results.map((result) => [result.variant, result.count])).toEqual([
        ['eventSupporters', 300],
        ['eventAffinity', 2_000],
      ])
    })

    // No floor is not the same as no minimum: an exempt variant with nobody
    // in it is still dropped, because a card offering nobody is worse than
    // no card. `resolved.empty` does not cover this — the campaign has
    // supporters, none of whom carry a cell phone.
    it('drops an exempt supporter variant that counts zero', async () => {
      resolveSavedFilterForQuery.mockImplementation(
        async (_organization: Organization, filter: VoterFilterBase) => ({
          filters: convertVoterFileFilterToFilters(filter),
          empty: false,
          idOverrides: isSupporterUniverse(filter)
            ? { include: ['supporter-1'] }
            : undefined,
        }),
      )
      countForFilter.mockImplementation(
        (_district, _filters, idOverrides?: { include: string[] }) =>
          Promise.resolve(idOverrides ? 0 : 2_000),
      )

      const results = await service.recommend(
        organization,
        campaign,
        'sms',
        'event',
      )

      expect(results.map((result) => result.variant)).toEqual(['eventAffinity'])
    })

    it('drops an exempt door variant with nobody in it', async () => {
      rankPrecincts.mockResolvedValue({ precincts: [], totalVoters: 0 })

      const results = await service.recommend(
        organization,
        campaign,
        'doorKnocking',
        'introduce',
      )

      expect(results).toEqual([])
    })

    // Nothing to take a share of, so there is nothing to hold the list to.
    // A race we cannot price still gets its recommendations.
    it('applies no floor when the vote goal cannot be resolved', async () => {
      getRaceContext.mockRejectedValue(new Error('election-api down'))
      countForFilter.mockResolvedValue(3)

      const results = await service.recommend(
        organization,
        campaign,
        'sms',
        'introduce',
      )

      expect(results).toHaveLength(1)
      expect(results[0]?.count).toBe(3)
    })

    it('applies no floor when the campaign has no raceId', async () => {
      countForFilter.mockResolvedValue(3)

      const results = await service.recommend(
        organization,
        { id: 42, details: {} } as unknown as Campaign,
        'sms',
        'introduce',
      )

      expect(getRaceContext).not.toHaveBeenCalled()
      expect(results).toHaveLength(1)
    })

    // A zero or negative win number is not a vote goal, and treating it as
    // one makes every list pass a floor of zero while reporting an infinite
    // or negative share.
    it('treats a non-positive win number as no vote goal', async () => {
      getRaceContext.mockResolvedValue({ winNumberEffective: 0 })
      countForFilter.mockResolvedValue(3)

      const [first] = await service.recommend(
        organization,
        campaign,
        'sms',
        'introduce',
      )

      expect(first?.count).toBe(3)
      expect(first).not.toHaveProperty('voteGoalShare')
    })

    it('still empties when every variant is merely too small', async () => {
      bucketForCampaign.mockResolvedValue('progressive')
      countForFilter.mockResolvedValue(FLOOR - 1)

      const results = await service.recommend(
        organization,
        campaign,
        'sms',
        'persuade',
      )

      expect(results).toEqual([])
    })
  })

  describe('voteGoalShare', () => {
    it('divides the count by the vote goal', async () => {
      countForFilter.mockResolvedValue(2_500)

      const [first] = await service.recommend(
        organization,
        campaign,
        'sms',
        'introduce',
      )

      expect(getRaceContext).toHaveBeenCalledWith(RACE_ID)
      expect(first?.voteGoalShare).toBeCloseTo(2_500 / VOTES_NEEDED, 10)
    })

    // A list can hold several times the votes a race needs, so the share is
    // not a percentage of anything and must not be clamped.
    it('reports a share above one rather than clamping it', async () => {
      countForFilter.mockResolvedValue(VOTES_NEEDED * 3)

      const [first] = await service.recommend(
        organization,
        campaign,
        'sms',
        'introduce',
      )

      expect(first?.voteGoalShare).toBe(3)
    })

    // Field-level rather than a partial match: `voteGoalShare` has to be
    // absent, not null, and an extra key here is invisible to toMatchObject.
    it('omits voteGoalShare entirely when the vote goal fails', async () => {
      getRaceContext.mockRejectedValue(new Error('election-api down'))

      const [first] = await service.recommend(
        organization,
        campaign,
        'sms',
        'introduce',
      )

      expect(Object.keys(first ?? {}).sort()).toEqual([
        'copy',
        'count',
        'estimatedCostCents',
        'existingFilterId',
        'filter',
        'variant',
      ])
    })

    // One election-api round trip per request, not one per variant.
    it('resolves the vote goal once for a three-variant intent', async () => {
      bucketForCampaign.mockResolvedValue('progressive')

      const results = await service.recommend(
        organization,
        campaign,
        'sms',
        'persuade',
      )

      expect(results).toHaveLength(3)
      expect(getRaceContext).toHaveBeenCalledTimes(1)
    })
  })

  describe('estimatedCostCents', () => {
    it('prices an sms list at the text rate the checkout charges', async () => {
      countForFilter.mockResolvedValue(2_000)

      const [first] = await service.recommend(
        organization,
        campaign,
        'sms',
        'introduce',
      )

      expect(first?.estimatedCostCents).toBe(calcTextAmountInCents(2_000))
      expect(first?.estimatedCostCents).toBe(7_000)
    })

    // The calls portion alone. The $2 caller-ID number fee is charged once
    // per run, not per contact, and no pre-purchase screen shows it in an
    // estimate — so pricing off the total would make this card the only
    // surface that disagrees with the robocall review step.
    it('prices a robocall list per call, without the number fee', async () => {
      countForFilter.mockResolvedValue(2_000)

      const [first] = await service.recommend(
        organization,
        campaign,
        'robocall',
        'introduce',
      )

      expect(first?.estimatedCostCents).toBe(calcRobocallAmountInCents(2_000))
      expect(first?.estimatedCostCents).toBe(9_000)
      expect(first?.estimatedCostCents).not.toBe(
        calcRobocallTotalInCents(2_000),
      )
    })

    // Volunteer-run, so there is no per-contact price to report. Absent
    // rather than zero: a "$0" on the card reads as "free" where the truth
    // is "not applicable". Key-level, because a zero would slip past a
    // partial match.
    it('omits the cost entirely for phone banking', async () => {
      const [first] = await service.recommend(
        organization,
        campaign,
        'phoneBanking',
        'introduce',
      )

      expect(Object.keys(first ?? {}).sort()).toEqual([
        'copy',
        'count',
        'existingFilterId',
        'filter',
        'variant',
        'voteGoalShare',
      ])
    })

    it('omits the cost entirely for door knocking', async () => {
      const [first] = await service.recommend(
        organization,
        campaign,
        'doorKnocking',
        'introduce',
      )

      expect(Object.keys(first ?? {}).sort()).toEqual([
        'copy',
        'count',
        'existingFilterId',
        'filter',
        'variant',
        'voteGoalShare',
      ])
    })

    // The count the price is computed from is the channel-refined one: the
    // filter already carries `hasCellPhone`, so the number the candidate is
    // quoted is what it costs to text the people who can be texted, not the
    // whole universe.
    it('prices the channel-refined count, not the raw universe', async () => {
      countForFilter.mockImplementation((_district, filters: FilterData) =>
        Promise.resolve(
          filters.filters.includes('hasCellPhone') ? 1_000 : 9_999,
        ),
      )

      const [first] = await service.recommend(
        organization,
        campaign,
        'sms',
        'introduce',
      )

      expect(first?.count).toBe(1_000)
      expect(first?.estimatedCostCents).toBe(calcTextAmountInCents(1_000))
    })
  })

  describe('the concurrent fan-out', () => {
    // The vote goal gates the size floor, so it has to land before the
    // counts — but it is an election-api round trip and nothing else in the
    // first hop waits on it. Resolving it serially in front would show up
    // here as a peak of one.
    it('resolves the vote goal alongside the district lookup', async () => {
      let inFlight = 0
      let peak = 0
      const track = async <Value>(value: Value): Promise<Value> => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 1))
        inFlight -= 1
        return value
      }
      resolveEligibleDistrictId.mockImplementation(() => track(DISTRICT_ID))
      getRaceContext.mockImplementation(() =>
        track({ winNumberEffective: VOTES_NEEDED }),
      )

      await service.recommend(organization, campaign, 'sms', 'introduce')

      expect(peak).toBe(2)
    })

    it('fans the variant counts out together', async () => {
      bucketForCampaign.mockResolvedValue('progressive')
      let inFlight = 0
      let peak = 0
      countForFilter.mockImplementation(async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 1))
        inFlight -= 1
        return 2_000
      })

      await service.recommend(organization, campaign, 'sms', 'persuade')

      expect(peak).toBe(3)
    })
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
      campaign,
      'sms',
      'introduce',
    )

    expect(first?.existingFilterId).toBe(77)
  })

  // A list the candidate built in the CRM stores propensity as the
  // `audience*Voters` booleans, never as a `voterStatus` array — that column
  // is only populated by a recommendation-derived create. The converter
  // emits the same payload from either spelling, which is the whole reason
  // dedupe compares payloads; nothing pinned that until here.
  it('matches a saved list storing the same universe as booleans', async () => {
    findByOrganizationSlug.mockResolvedValue([
      {
        id: 78,
        audienceSuperVoters: true,
        audienceLikelyVoters: true,
        supportStatus: ['unknown'],
        hasCellPhone: true,
        activityConditions: [],
      },
    ])

    const [first] = await service.recommend(
      organization,
      campaign,
      'sms',
      'introduce',
    )

    expect(first?.existingFilterId).toBe(78)
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
      campaign,
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
      campaign,
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
        : Promise.resolve(2_000),
    )

    const results = await service.recommend(
      organization,
      campaign,
      'sms',
      'persuade',
    )

    expect(results.map((result) => result.variant)).toEqual([
      'persuadeIdeology',
      'persuadeUndecided',
    ])
  })

  // A warehouse outage nulls every variant. Returning [] for that is the
  // service telling a candidate they have no recommendations, which is a
  // different claim from "we could not look".
  it('rethrows when every variant fails, rather than emptying', async () => {
    bucketForCampaign.mockResolvedValue('progressive')
    const outage = new BadGatewayException('Voter data is unavailable')
    countForFilter.mockRejectedValue(outage)

    await expect(
      service.recommend(organization, campaign, 'sms', 'persuade'),
    ).rejects.toBe(outage)
  })

  // The near miss the equality check let through. `event` has a
  // support-status variant that resolves to nobody (a Postgres answer, which
  // an outage does not touch), so a failure count of one against two drafts
  // is still a total warehouse failure — there is nothing to show.
  it('rethrows when the only surviving draft was a Postgres null', async () => {
    const outage = new BadGatewayException('Voter data is unavailable')
    // eventSupporters asks for supporters and nobody else, so a campaign
    // with no logged support answers resolves it to nobody; eventAffinity's
    // support clause is an exclusion and still resolves.
    resolveSavedFilterForQuery.mockImplementation(
      async (_organization: Organization, filter: VoterFilterBase) =>
        isSupporterUniverse(filter)
          ? { filters: {}, empty: true }
          : { filters: convertVoterFileFilterToFilters(filter), empty: false },
    )
    countForFilter.mockRejectedValue(outage)

    await expect(
      service.recommend(organization, campaign, 'sms', 'event'),
    ).rejects.toBe(outage)
  })

  it('omits a variant whose support status resolves to nobody', async () => {
    resolveSavedFilterForQuery.mockResolvedValue({
      filters: {},
      empty: true,
    })

    const results = await service.recommend(
      organization,
      campaign,
      'sms',
      'introduce',
    )

    expect(results).toEqual([])
    expect(countForFilter).not.toHaveBeenCalled()
  })

  // The classifier is an LLM call, and `introduce` has no variant that could
  // use a bucket — so asking for one buys nothing on the intent every flow
  // opens on.
  it('does not classify ideology for an intent with no ideology variant', async () => {
    await service.recommend(organization, campaign, 'sms', 'introduce')

    expect(bucketForCampaign).not.toHaveBeenCalled()
  })

  it('classifies ideology for an intent that has an ideology variant', async () => {
    await service.recommend(organization, campaign, 'sms', 'persuade')

    expect(bucketForCampaign).toHaveBeenCalledWith(campaign.id)
  })

  it('returns nothing for an intent with no variants', async () => {
    const results = await service.recommend(organization, campaign, 'sms', null)

    expect(results).toEqual([])
    expect(resolveEligibleDistrictId).not.toHaveBeenCalled()
    expect(getRaceContext).not.toHaveBeenCalled()
  })

  it('refuses an elected-office org rather than emptying', async () => {
    await expect(
      service.recommend(electedOffice, campaign, 'sms', 'introduce'),
    ).rejects.toBeInstanceOf(BadRequestException)

    expect(resolveEligibleDistrictId).not.toHaveBeenCalled()
  })

  describe('door knocking', () => {
    it('takes the count from the ranking, not a second query', async () => {
      rankPrecincts.mockResolvedValue({
        precincts: rankedPrecincts(3),
        totalVoters: 6_000,
      })

      const [first] = await service.recommend(
        organization,
        campaign,
        'doorKnocking',
        'introduce',
      )

      expect(first?.count).toBe(6_000)
      expect(first?.filter.precincts).toEqual([
        'ALLEGHENY|P0',
        'ALLEGHENY|P1',
        'ALLEGHENY|P2',
      ])
      expect(countForFilter).not.toHaveBeenCalled()
    })

    // The whole door rule, and the mutation it guards: a district-wide
    // fallback, or any second read, would show up here as an extra call and
    // hand a canvasser the district instead of three precincts.
    it('reads the ranking once and never widens or falls back', async () => {
      rankPrecincts.mockResolvedValue({
        precincts: rankedPrecincts(1),
        totalVoters: 100,
      })

      const [first] = await service.recommend(
        organization,
        campaign,
        'doorKnocking',
        'introduce',
      )

      expect(rankPrecincts).toHaveBeenCalledTimes(1)
      expect(rankPrecincts.mock.calls[0]).toHaveLength(3)
      expect(countForFilter).not.toHaveBeenCalled()
      expect(first?.count).toBe(100)
      expect(first?.filter.precincts).toEqual(['ALLEGHENY|P0'])
    })
  })
})
