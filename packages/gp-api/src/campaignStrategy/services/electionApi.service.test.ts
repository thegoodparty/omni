import { BadGatewayException, NotFoundException } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CampaignStrategyContextService } from '@/electionDb/campaignStrategyContext/campaign-strategy-context.service'
import {
  ElectionApiRaceNotFoundError,
  ElectionApiService,
} from './electionApi.service'

const BR_HASH = 'hash-abc'

// The in-process shape CampaignStrategyContextService returns. It carries
// more keys than the prompts consume (the turnout/win-number bounds), which
// is exactly what the response schema narrows away.
const contextResult = {
  candidate_count: 2,
  candidate_office: 'City Council',
  candidates: [
    {
      gp_candidate_id: 'gp-1',
      first_name: 'Jane',
      last_name: 'Doe',
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      website_url: 'https://jane.example',
      party: 'Independent',
      is_incumbent: false,
    },
    {
      gp_candidate_id: null,
      first_name: 'Bob',
      last_name: 'Smith',
      full_name: 'Bob Smith',
      email: null,
      website_url: null,
      party: null,
      is_incumbent: null,
    },
  ],
  civics_win_number: null,
  contacts_needed_estimate: 2505,
  election_code: null,
  general_election_date: '2026-11-01',
  number_of_seats: 1,
  office_level: 'Local',
  office_type: 'Council',
  partisan_type: null,
  official_office_name: 'Anytown Council',
  primary_election_date: '2026-06-01',
  projected_turnout: 1000,
  projected_turnout_lower: 800,
  projected_turnout_upper: 1200,
  registered_voters: 4084,
  unique_cellphones: 2100,
  unique_landlines: 300,
  relevant_election_date: '2026-06-01',
  state: 'CA',
  win_number_effective: 501,
  win_number_estimate: 501,
  win_number_lower: 401,
  win_number_upper: 601,
}

describe('ElectionApiService', () => {
  let service: ElectionApiService
  let getCampaignStrategyContext: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    getCampaignStrategyContext = vi.fn()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElectionApiService,
        { provide: PinoLogger, useValue: createMockLogger() },
        {
          provide: CampaignStrategyContextService,
          useValue: { getCampaignStrategyContext },
        },
      ],
    }).compile()

    service = module.get<ElectionApiService>(ElectionApiService)
  })

  it('passes the brHashId through and returns camelCase RaceContextFromApi', async () => {
    getCampaignStrategyContext.mockResolvedValue(contextResult)

    const result = await service.getRaceContext(BR_HASH)

    expect(getCampaignStrategyContext).toHaveBeenCalledWith({
      brHashId: BR_HASH,
    })
    expect(result).toEqual({
      state: 'CA',
      candidateOffice: 'City Council',
      officialOfficeName: 'Anytown Council',
      officeLevel: 'Local',
      officeType: 'Council',
      electionCode: null,
      primaryElectionDate: '2026-06-01',
      generalElectionDate: '2026-11-01',
      relevantElectionDate: '2026-06-01',
      numberOfSeats: 1,
      projectedTurnout: 1000,
      civicsWinNumber: null,
      winNumberEstimate: 501,
      winNumberEffective: 501,
      contactsNeededEstimate: 2505,
      candidateCount: 2,
      candidates: [
        {
          gpCandidateId: 'gp-1',
          firstName: 'Jane',
          lastName: 'Doe',
          fullName: 'Jane Doe',
          email: 'jane@example.com',
          websiteUrl: 'https://jane.example',
          party: 'Independent',
          isIncumbent: false,
        },
        {
          gpCandidateId: null,
          firstName: 'Bob',
          lastName: 'Smith',
          fullName: 'Bob Smith',
          email: null,
          websiteUrl: null,
          party: null,
          isIncumbent: null,
        },
      ],
    })
  })

  // Removing the network boundary removed the parse that used to happen on
  // the way in. The response schema still runs, so a column the election
  // Race row grows cannot reach a gp-api response or an LLM prompt.
  it('narrows away keys the prompts do not consume', async () => {
    getCampaignStrategyContext.mockResolvedValue({
      ...contextResult,
      some_new_election_column: 'leaked',
    })

    const strategy = await service.getStrategyContext(BR_HASH)

    expect(Object.keys(strategy).sort()).toEqual([
      'candidate_count',
      'candidate_office',
      'candidates',
      'contacts_needed_estimate',
      'filing_date_end',
      'general_election_date',
      'number_of_seats',
      'office_level',
      'office_type',
      'official_office_name',
      'partisan_type',
      'primary_election_date',
      'projected_turnout',
      'registered_voters',
      'relevant_election_date',
      'state',
      'unique_cellphones',
      'unique_landlines',
      'win_number_effective',
    ])
    expect(strategy.registered_voters).toBe(4084)
    // Not part of the campaign-strategy-context result at all, so the
    // experiment sees an explicit null rather than undefined.
    expect(strategy.filing_date_end).toBeNull()
  })

  // The electorate the race's own projection was drawn for. Read off the
  // race row rather than derived from a date -- the recommended-lists
  // propensity band keys on it.
  it.each(['General', 'LocalOrMunicipal', 'Primary'])(
    'carries the %s election code through to the race context',
    async (code) => {
      getCampaignStrategyContext.mockResolvedValue({
        ...contextResult,
        election_code: code,
      })

      const result = await service.getRaceContext(BR_HASH)

      expect(result.electionCode).toBe(code)
    },
  )

  it('throws BadGateway when the election database lookup fails', async () => {
    getCampaignStrategyContext.mockRejectedValue(new Error('connection reset'))

    await expect(service.getRaceContext(BR_HASH)).rejects.toThrow(
      BadGatewayException,
    )
  })

  it('throws ElectionApiRaceNotFoundError when there is no Race row', async () => {
    // A missing Race row is a distinguishable condition the caller uses to
    // break the poll loop. Other failures stay BadGateway since they may be
    // transient.
    getCampaignStrategyContext.mockRejectedValue(
      new NotFoundException(`Race not found for brHashId=${BR_HASH}`),
    )

    await expect(service.getRaceContext(BR_HASH)).rejects.toBeInstanceOf(
      ElectionApiRaceNotFoundError,
    )
  })

  it('throws BadGateway without leaking upstream error detail', async () => {
    getCampaignStrategyContext.mockRejectedValue(
      new Error('postgres password=secret'),
    )

    await expect(service.getRaceContext(BR_HASH)).rejects.not.toThrow(/secret/)
  })

  it('strips candidates whose email contains @goodparty and recomputes candidateCount', async () => {
    getCampaignStrategyContext.mockResolvedValue({
      ...contextResult,
      candidate_count: 4,
      candidates: [
        contextResult.candidates[0],
        {
          gp_candidate_id: 'test-1',
          first_name: 'Internal',
          last_name: 'Tester',
          full_name: 'Internal Tester',
          email: 'felix@goodparty.org',
          website_url: null,
          party: null,
          is_incumbent: null,
        },
        {
          gp_candidate_id: 'test-2',
          first_name: 'Mixed',
          last_name: 'Case',
          full_name: 'Mixed Case',
          email: 'Admin@GoodParty.com',
          website_url: null,
          party: null,
          is_incumbent: null,
        },
        contextResult.candidates[1],
      ],
    })

    const result = await service.getRaceContext(BR_HASH)

    expect(result.candidates.map((c) => c.fullName)).toEqual([
      'Jane Doe',
      'Bob Smith',
    ])
    expect(result.candidateCount).toBe(2)
  })

  it('keeps candidates with null email even though @goodparty filter is on email', async () => {
    getCampaignStrategyContext.mockResolvedValue({
      ...contextResult,
      candidate_count: 1,
      candidates: [
        {
          gp_candidate_id: null,
          first_name: 'No',
          last_name: 'Email',
          full_name: 'No Email',
          email: null,
          website_url: null,
          party: null,
          is_incumbent: null,
        },
      ],
    })

    const result = await service.getRaceContext(BR_HASH)

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.fullName).toBe('No Email')
  })

  it('throws BadGateway when the result fails schema validation', async () => {
    getCampaignStrategyContext.mockResolvedValue({
      ...contextResult,
      candidate_count: 'two',
    })

    await expect(service.getRaceContext(BR_HASH)).rejects.toThrow(
      BadGatewayException,
    )
  })
})
