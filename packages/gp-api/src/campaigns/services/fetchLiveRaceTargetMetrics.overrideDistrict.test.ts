import { BallotReadyService } from '@/elections/services/ballotReady.service'
import { ElectionsService } from '@/elections/services/elections.service'
import {
  CampaignStrategyContextResponse,
  District,
} from '@/elections/types/elections.types'
import { useTestService } from '@/test-service'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CampaignsService } from './campaigns.service'

const ELECTION_DATE = '2025-11-04'
const RACE_ID = 'Z2lkOi8vYmFsbG90LWZhY3RvcnkvUmFjZS8xMjM0NQ=='
const OVERRIDE_DISTRICT_ID = '11111111-2222-3333-4444-555555555555'

// The race's own district: big, and wrong for an overridden candidate.
const RACE_DISTRICT_TURNOUT = 120_000
// The hand-picked override district: an order of magnitude smaller.
const OVERRIDE_TURNOUT = 4_000
// gp-api's formula: ceil(turnout * 0.5) + 1, then * 5 for the contact goal.
const OVERRIDE_WIN_NUMBER = 2_001
const OVERRIDE_CONTACT_GOAL = 10_005

const raceContext: CampaignStrategyContextResponse = {
  candidate_count: 2,
  candidate_office: 'County Commissioner',
  candidates: [
    {
      gp_candidate_id: 'gp-1',
      first_name: 'Stephen',
      last_name: 'Fowler',
      full_name: 'Stephen Fowler',
      email: 'stephen@example.com',
      website_url: null,
      party: null,
      is_incumbent: false,
    },
  ],
  civics_win_number: 60_001,
  contacts_needed_estimate: 300_005,
  general_election_date: '2025-11-04',
  number_of_seats: 1,
  office_level: 'county',
  office_type: 'commissioner',
  official_office_name: 'Larimer County Commissioner At-Large',
  primary_election_date: '2025-06-24',
  projected_turnout: RACE_DISTRICT_TURNOUT,
  projected_turnout_lower: 96_000,
  projected_turnout_upper: 156_000,
  projected_voter_turnout: RACE_DISTRICT_TURNOUT,
  registered_voters: 200_000,
  unique_cellphones: 90_000,
  unique_landlines: 30_000,
  relevant_election_date: '2025-11-04',
  state: 'CO',
  win_number_effective: 60_001,
  win_number_estimate: 60_001,
  win_number_lower: 48_001,
  win_number_upper: 78_001,
}

const overrideDistrict: District = {
  id: OVERRIDE_DISTRICT_ID,
  state: 'CO',
  L2DistrictType: 'County',
  L2DistrictName: 'LARIMER COUNTY',
  projectedTurnout: null,
  registeredVoters: 7_500,
  uniqueCellphones: 3_100,
  uniqueLandlines: 900,
}

const service = useTestService()

let elections: ElectionsService
let ballotReady: BallotReadyService
let campaigns: CampaignsService
let seq = 0

const seedCampaign = async (options: {
  overrideDistrictId?: string
  raceId?: string
}) => {
  seq += 1
  const org = await service.prisma.organization.create({
    data: {
      slug: `override-org-${seq}`,
      ownerId: service.user.id,
      positionId: null,
      overrideDistrictId: options.overrideDistrictId ?? null,
    },
  })

  const created = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `override-campaign-${seq}`,
      organizationSlug: org.slug,
      details: {
        electionDate: ELECTION_DATE,
        ...(options.raceId ? { raceId: options.raceId } : {}),
      },
    },
  })

  return service.prisma.campaign.findUniqueOrThrow({
    where: { id: created.id },
  })
}

describe('fetchLiveRaceTargetMetrics — overrideDistrictId (DATA-2226)', () => {
  beforeEach(() => {
    elections = service.app.get(ElectionsService)
    ballotReady = service.app.get(BallotReadyService)
    campaigns = service.app.get(CampaignsService)

    vi.spyOn(elections, 'fetchCampaignStrategyContext').mockResolvedValue(null)
    vi.spyOn(elections, 'fetchFilingFeeByRaceHash').mockResolvedValue({
      filingFee: 25,
      filingRequirementsText: 'Pay $25 at the county clerk',
      extractionSource: 'regex',
      filingOfficeAddress: '200 W Oak St, Fort Collins, CO',
      filingPhoneNumber: '970-555-0100',
      paperworkInstructions: 'File with the Larimer County Clerk',
    })
    vi.spyOn(ballotReady, 'fetchMilestones').mockResolvedValue({
      voter_registration: { start: '2025-08-01', end: '2025-10-27' },
      early_voting: null,
      request_ballot: null,
    })
    vi.spyOn(elections, 'buildRaceTargetDetails').mockResolvedValue({
      projectedTurnout: OVERRIDE_TURNOUT,
      winNumber: OVERRIDE_WIN_NUMBER,
      voterContactGoal: OVERRIDE_CONTACT_GOAL,
    })
    vi.spyOn(elections, 'getDistrict').mockResolvedValue(overrideDistrict)
  })

  it('recomputes district-derived metrics from the override when the campaign also has a raceId', async () => {
    vi.mocked(elections.fetchCampaignStrategyContext).mockResolvedValue(
      raceContext,
    )

    const campaign = await seedCampaign({
      overrideDistrictId: OVERRIDE_DISTRICT_ID,
      raceId: RACE_ID,
    })

    const metrics = await campaigns.fetchLiveRaceTargetMetrics(campaign)

    expect(elections.buildRaceTargetDetails).toHaveBeenCalledWith({
      districtId: OVERRIDE_DISTRICT_ID,
      electionDate: ELECTION_DATE,
    })

    expect(metrics).not.toBeNull()
    expect(metrics).toMatchObject({
      projectedTurnout: OVERRIDE_TURNOUT,
      winNumber: OVERRIDE_WIN_NUMBER,
      voterContactGoal: OVERRIDE_CONTACT_GOAL,
      registeredVoters: overrideDistrict.registeredVoters,
      uniqueCellphones: overrideDistrict.uniqueCellphones,
      uniqueLandlines: overrideDistrict.uniqueLandlines,
      projectedVoterTurnout: null,
      // The prediction interval brackets the race district's turnout, so it
      // cannot travel with the override district's point values.
      projectedTurnoutLower: null,
      projectedTurnoutUpper: null,
      winNumberLower: null,
      winNumberUpper: null,
    })

    // Race-level facts stay sourced from the race context.
    expect(metrics).toMatchObject({
      officialOfficeName: raceContext.official_office_name,
      officeLevel: raceContext.office_level,
      officeType: raceContext.office_type,
      numberOfSeats: raceContext.number_of_seats,
      generalElectionDate: raceContext.general_election_date,
      primaryElectionDate: raceContext.primary_election_date,
      relevantElectionDate: raceContext.relevant_election_date,
      filingFee: 25,
      filingOfficeAddress: '200 W Oak St, Fort Collins, CO',
    })
    expect(metrics!.candidates).toHaveLength(1)
    expect(metrics!.candidates[0]?.fullName).toBe('Stephen Fowler')
    expect(metrics!.milestones?.voter_registration?.end).toBe('2025-10-27')
  })

  it('returns null rather than the race district numbers when the override cannot be resolved', async () => {
    vi.mocked(elections.fetchCampaignStrategyContext).mockResolvedValue(
      raceContext,
    )
    vi.mocked(elections.buildRaceTargetDetails).mockResolvedValue(null)

    const campaign = await seedCampaign({
      overrideDistrictId: OVERRIDE_DISTRICT_ID,
      raceId: RACE_ID,
    })

    expect(await campaigns.fetchLiveRaceTargetMetrics(campaign)).toBeNull()
  })

  it('returns null when the override district has zero registered voters despite a projected turnout', async () => {
    vi.mocked(elections.fetchCampaignStrategyContext).mockResolvedValue(
      raceContext,
    )
    vi.mocked(elections.getDistrict).mockResolvedValue({
      ...overrideDistrict,
      registeredVoters: 0,
    })

    const campaign = await seedCampaign({
      overrideDistrictId: OVERRIDE_DISTRICT_ID,
      raceId: RACE_ID,
    })

    expect(await campaigns.fetchLiveRaceTargetMetrics(campaign)).toBeNull()
  })

  it('still serves override metrics when the district aggregate has never been computed', async () => {
    vi.mocked(elections.fetchCampaignStrategyContext).mockResolvedValue(
      raceContext,
    )
    vi.mocked(elections.getDistrict).mockResolvedValue({
      ...overrideDistrict,
      registeredVoters: null,
      uniqueCellphones: null,
      uniqueLandlines: null,
    })

    const campaign = await seedCampaign({
      overrideDistrictId: OVERRIDE_DISTRICT_ID,
      raceId: RACE_ID,
    })

    const metrics = await campaigns.fetchLiveRaceTargetMetrics(campaign)

    expect(metrics).toMatchObject({
      projectedTurnout: OVERRIDE_TURNOUT,
      winNumber: OVERRIDE_WIN_NUMBER,
      registeredVoters: null,
    })
  })

  it('uses the override district when there is no raceId', async () => {
    const campaign = await seedCampaign({
      overrideDistrictId: OVERRIDE_DISTRICT_ID,
    })

    const metrics = await campaigns.fetchLiveRaceTargetMetrics(campaign)

    expect(elections.fetchCampaignStrategyContext).not.toHaveBeenCalled()
    expect(metrics).toMatchObject({
      projectedTurnout: OVERRIDE_TURNOUT,
      winNumber: OVERRIDE_WIN_NUMBER,
      voterContactGoal: OVERRIDE_CONTACT_GOAL,
      registeredVoters: overrideDistrict.registeredVoters,
      candidates: [],
      officialOfficeName: null,
    })
  })

  it('leaves race context metrics untouched when there is no override', async () => {
    vi.mocked(elections.fetchCampaignStrategyContext).mockResolvedValue(
      raceContext,
    )

    const campaign = await seedCampaign({ raceId: RACE_ID })

    const metrics = await campaigns.fetchLiveRaceTargetMetrics(campaign)

    expect(elections.buildRaceTargetDetails).not.toHaveBeenCalled()
    expect(metrics).toMatchObject({
      projectedTurnout: RACE_DISTRICT_TURNOUT,
      winNumber: raceContext.win_number_effective,
      voterContactGoal: raceContext.contacts_needed_estimate,
      registeredVoters: raceContext.registered_voters,
      uniqueCellphones: raceContext.unique_cellphones,
      uniqueLandlines: raceContext.unique_landlines,
      projectedVoterTurnout: raceContext.projected_voter_turnout,
      projectedTurnoutLower: raceContext.projected_turnout_lower,
      projectedTurnoutUpper: raceContext.projected_turnout_upper,
      winNumberLower: raceContext.win_number_lower,
      winNumberUpper: raceContext.win_number_upper,
    })
  })

  it('returns null with neither an override nor a raceId', async () => {
    const campaign = await seedCampaign({})

    expect(await campaigns.fetchLiveRaceTargetMetrics(campaign)).toBeNull()
  })
})
