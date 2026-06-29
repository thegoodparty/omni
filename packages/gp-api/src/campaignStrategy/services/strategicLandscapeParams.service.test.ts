import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrategicLandscapeParamsService } from './strategicLandscapeParams.service'

const GENERAL = 'br-general'
const PRIMARY = 'br-primary'

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
}

const campaign = (details: unknown) =>
  ({
    id: 42,
    details,
    user: {
      email: 'rob@example.com',
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
  let websites: { getIssuesForCampaign: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    electionApi = {
      getStrategyContext: vi.fn(async (id: string) =>
        id === PRIMARY ? primaryCtx : generalCtx,
      ),
    }
    races = { getPrimaryRaceId: vi.fn() }
    campaignStory = { getForCampaign: vi.fn(async () => story) }
    websites = { getIssuesForCampaign: vi.fn(async () => []) }
    const logger = { setContext: vi.fn(), warn: vi.fn() }
    service = new StrategicLandscapeParamsService(
      electionApi as never,
      races as never,
      campaignStory as never,
      websites as never,
      logger as never,
    )
  })

  it('returns null primary context and the general context when there is no primary race', async () => {
    races.getPrimaryRaceId.mockResolvedValue(null)

    const out = await service.build(campaign({ raceId: GENERAL }), GENERAL)

    expect(out.campaign_primary_strategy_context).toBeNull()
    expect(out.campaign_strategy_context).toBe(generalCtx)
    expect(out.race_id).toBe(GENERAL)
    expect(out.user_email).toBe('rob@example.com')
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
    expect(websites.getIssuesForCampaign).toHaveBeenCalledWith(42)
    // issues now come from the website (none here), so they flatten to null.
    expect(out.campaign_story).toEqual({ ...story, issues: null })
  })

  it('flattens website issues into the story issues string (HTML stripped)', async () => {
    races.getPrimaryRaceId.mockResolvedValue(null)
    websites.getIssuesForCampaign.mockResolvedValue([
      {
        title: 'Roads',
        description: '<p>Fix the <strong>potholes</strong></p>',
      },
      { title: 'Schools', description: '<p>More funding</p>' },
    ])

    const out = await service.build(campaign({ raceId: GENERAL }), GENERAL)

    expect(out.campaign_story?.issues).toBe(
      'Roads\nFix the potholes\n\nSchools\nMore funding',
    )
  })

  it('omits the story (without failing the build) when its read errors', async () => {
    races.getPrimaryRaceId.mockResolvedValue(null)
    campaignStory.getForCampaign.mockRejectedValue(new Error('db down'))

    const out = await service.build(campaign({ raceId: GENERAL }), GENERAL)

    expect(out.campaign_story).toBeUndefined()
    expect(out.campaign_strategy_context).toBe(generalCtx)
  })
})
