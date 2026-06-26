import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrategicLandscapeParamsService } from './strategicLandscapeParams.service'

const GENERAL = 'br-general'
const PRIMARY = 'br-primary'
const USER_EMAIL = 'rob@example.com'

const generalCtx = {
  candidate_count: 2,
  candidates: [{ full_name: 'Jane Doe' }],
}
const primaryCtx = {
  candidate_count: 3,
  candidates: [{ full_name: 'Jane Doe' }, { full_name: 'Sam Roe' }],
}
const story = {
  why: 'To fix the roads',
  background: 'Lifelong resident',
  issues: null,
}

const campaign = (details: unknown) =>
  ({
    id: 42,
    details,
    user: {
      email: USER_EMAIL,
      firstName: 'Rob',
      lastName: 'Newland',
      name: null,
    },
  }) as never

describe('StrategicLandscapeParamsService', () => {
  let service: StrategicLandscapeParamsService
  let electionApi: { getStrategyContext: ReturnType<typeof vi.fn> }
  let races: { getPrimaryRaceId: ReturnType<typeof vi.fn> }
  let campaignStory: { getForCampaign: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    electionApi = {
      getStrategyContext: vi.fn(async (id: string) =>
        id === PRIMARY ? primaryCtx : generalCtx,
      ),
    }
    races = { getPrimaryRaceId: vi.fn() }
    campaignStory = { getForCampaign: vi.fn(async () => story) }
    const logger = { setContext: vi.fn(), warn: vi.fn() }
    service = new StrategicLandscapeParamsService(
      electionApi as never,
      races as never,
      campaignStory as never,
      logger as never,
    )
  })

  it('returns null primary context and the general context when there is no primary race', async () => {
    races.getPrimaryRaceId.mockResolvedValue(null)

    const out = await service.build(campaign({ raceId: GENERAL }), GENERAL)

    expect(out.campaign_primary_strategy_context).toBeNull()
    expect(out.campaign_strategy_context).toBe(generalCtx)
    expect(out.race_id).toBe(GENERAL)
    expect(out.user_email).toBe(USER_EMAIL)
    expect(out.user_full_name).toBe('Rob Newland')
    // only the general context was fetched (no primary round-trip)
    expect(electionApi.getStrategyContext).toHaveBeenCalledTimes(1)
    expect(electionApi.getStrategyContext).toHaveBeenCalledWith(GENERAL)
  })

  it('folds the primary roster into campaign_primary_strategy_context when a primary race exists', async () => {
    races.getPrimaryRaceId.mockResolvedValue(PRIMARY)

    const out = await service.build(campaign({ raceId: GENERAL }), GENERAL)

    expect(electionApi.getStrategyContext).toHaveBeenCalledWith(PRIMARY)
    expect(out.campaign_primary_strategy_context).toEqual({
      candidate_count: primaryCtx.candidate_count,
      candidates: primaryCtx.candidates,
    })
  })

  it('passes party + otherParty through from campaign.details', async () => {
    races.getPrimaryRaceId.mockResolvedValue(null)

    const out = await service.build(
      campaign({ party: 'Other', otherParty: 'Working Families' }),
      GENERAL,
    )

    expect(out.user_party_affiliation).toBe('Other')
    expect(out.other_party).toBe('Working Families')
  })

  it('falls back to null party when details fail to parse', async () => {
    races.getPrimaryRaceId.mockResolvedValue(null)

    const out = await service.build(campaign('not-an-object'), GENERAL)

    expect(out.user_party_affiliation).toBeNull()
    expect(out.other_party).toBeNull()
  })

  it('hydrates the campaign story for the candidate', async () => {
    races.getPrimaryRaceId.mockResolvedValue(null)

    const out = await service.build(campaign({ raceId: GENERAL }), GENERAL)

    expect(campaignStory.getForCampaign).toHaveBeenCalledWith(42)
    expect(out.campaign_story).toEqual(story)
  })

  it('omits the story (without failing the build) when its read errors', async () => {
    races.getPrimaryRaceId.mockResolvedValue(null)
    campaignStory.getForCampaign.mockRejectedValue(new Error('db down'))

    const out = await service.build(campaign({ raceId: GENERAL }), GENERAL)

    expect(out.campaign_story).toBeUndefined()
    expect(out.campaign_strategy_context).toBe(generalCtx)
  })

  it('leaves a small roster (and its website_url hints) untouched', async () => {
    races.getPrimaryRaceId.mockResolvedValue(null)
    const ctx = {
      candidate_count: 1,
      candidates: [
        {
          full_name: 'Jane Doe',
          website_url: 'https://jane.example.com',
          gp_candidate_id: 'gp-1',
        },
      ],
    }
    electionApi.getStrategyContext.mockResolvedValue(ctx)

    const out = await service.build(campaign({ raceId: GENERAL }), GENERAL)

    // Under budget: passes through verbatim, hint fields preserved.
    expect(out.campaign_strategy_context).toBe(ctx)
  })

  describe('oversized primary roster', () => {
    // The service's internal compact-bytes invariant. It budgets below the PMF
    // Engine's raw 6000-byte cap so the agent's spaced (json.dumps) serialization
    // still fits; asserting against the raw 6000 would be tautological.
    const PARAMS_CAP = 5000

    // A filed primary roster large enough that the serialized params exceed the
    // PMF Engine's param-size cap (the 47- and 60-candidate primaries seen in
    // prod). Index 7 is the user; a few are incumbents.
    const bigPrimary = (n: number) => ({
      candidate_count: n,
      candidates: Array.from({ length: n }, (_, i) => ({
        gp_candidate_id: `01928374-aaaa-bbbb-cccc-00000000${i}`,
        first_name: `Firstname${i}`,
        last_name: `Lastname${i}`,
        full_name: `Firstname${i} Lastname${i}`,
        email: i === 7 ? USER_EMAIL : `candidate${i}@example.com`,
        website_url: `https://candidate-${i}-for-office.example.com`,
        party: 'Independent',
        is_incumbent: i === 0 || i === 3,
      })),
    })

    const bytesOf = (out: unknown) => Buffer.byteLength(JSON.stringify(out))

    beforeEach(() => {
      races.getPrimaryRaceId.mockResolvedValue(PRIMARY)
      electionApi.getStrategyContext.mockImplementation(async (id: string) =>
        id === PRIMARY
          ? bigPrimary(60)
          : { candidate_count: 0, candidates: [] },
      )
    })

    it('caps the roster so the serialized params fit the size limit', async () => {
      const out = await service.build(campaign({ raceId: GENERAL }), GENERAL)

      expect(bytesOf(out)).toBeLessThanOrEqual(PARAMS_CAP)
      const kept = out.campaign_primary_strategy_context?.candidates ?? []
      expect(kept.length).toBeLessThan(60)
    })

    it('keeps the true candidate_count even after capping the roster', async () => {
      const out = await service.build(campaign({ raceId: GENERAL }), GENERAL)

      expect(out.campaign_primary_strategy_context?.candidate_count).toBe(60)
    })

    it('retains the user and incumbents, and strips internal-only fields', async () => {
      const out = await service.build(campaign({ raceId: GENERAL }), GENERAL)
      const kept = out.campaign_primary_strategy_context?.candidates ?? []

      // The user's own row survives so the agent can still mark is_user.
      expect(kept.some((c) => c.email === USER_EMAIL)).toBe(true)
      // Incumbents (the real opponents) are prioritized over the long tail.
      expect(kept.some((c) => c.is_incumbent)).toBe(true)
      // gp_candidate_id (trace id) and website_url (rediscoverable) are dropped.
      expect(kept.every((c) => c.gp_candidate_id === undefined)).toBe(true)
      expect(kept.every((c) => c.website_url === undefined)).toBe(true)
    })

    it('prioritizes the primary roster over the general roster when both are large', async () => {
      // Both stages return a large roster; the shared budget must go to the
      // primary (the real filed field) before the provisional general seed list.
      electionApi.getStrategyContext.mockImplementation(async () =>
        bigPrimary(60),
      )

      const out = await service.build(campaign({ raceId: GENERAL }), GENERAL)

      expect(
        (out.campaign_primary_strategy_context?.candidates ?? []).length,
      ).toBeGreaterThan(0)
      expect(out.campaign_strategy_context.candidates.length).toBe(0)
      expect(bytesOf(out)).toBeLessThanOrEqual(PARAMS_CAP)
    })

    it('drops the story as a last resort when it alone blows the budget', async () => {
      // A maximal story (fields cap at 10k chars) exceeds the budget even with
      // an empty roster; the story is dropped so the roster still dispatches.
      campaignStory.getForCampaign.mockResolvedValue({
        why: 'w'.repeat(6000),
        background: 'b'.repeat(6000),
        issues: null,
      })
      electionApi.getStrategyContext.mockImplementation(async (id: string) =>
        id === PRIMARY ? bigPrimary(5) : { candidate_count: 0, candidates: [] },
      )

      const out = await service.build(campaign({ raceId: GENERAL }), GENERAL)

      expect(out.campaign_story).toBeUndefined()
      expect(bytesOf(out)).toBeLessThanOrEqual(PARAMS_CAP)
      // The roster is preserved (the agent's primary reasoning surface).
      expect(
        (out.campaign_primary_strategy_context?.candidates ?? []).length,
      ).toBeGreaterThan(0)
    })
  })
})
