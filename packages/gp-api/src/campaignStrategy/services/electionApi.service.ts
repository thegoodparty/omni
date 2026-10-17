import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { ApiCandidate, RaceContextFromApi } from '../types/electionApi.types'
import { ElectionCode } from '@/elections/types/elections.types'
import { CampaignStrategyContextResponse } from '@/electionDb/campaignStrategyContext/campaign-strategy-context.schema'
import { CampaignStrategyContextService } from '@/electionDb/campaignStrategyContext/campaign-strategy-context.service'
import { AgentJobContracts } from '@/generated/agent-job-contracts'

// Both CAP experiments share one input contract; the campaign_strategy_context
// slice is the experiment-facing shape the election data layer hydrates.
type StrategyContext =
  AgentJobContracts['opposition_research']['Input']['campaign_strategy_context']

// Distinguishable error for the "no Race row for the candidate's brHashId"
// case. Callers in CampaignStrategyService use this to break the infinite-poll
// loop by persisting a "no data" marker instead of retrying generation every
// 3 seconds.
export class ElectionApiRaceNotFoundError extends Error {
  constructor(public readonly brHashId: string) {
    super(`No Race row for brHashId=${brHashId}`)
    this.name = 'ElectionApiRaceNotFoundError'
  }
}

const ApiCandidateSchema = z.object({
  gp_candidate_id: z.string().nullable(),
  first_name: z.string(),
  last_name: z.string(),
  full_name: z.string(),
  email: z.string().nullable(),
  website_url: z.string().nullable(),
  party: z.string().nullable(),
  is_incumbent: z.boolean().nullable(),
})

// Narrowing, not transport validation: `.parse()` drops every key the prompts
// do not consume, so a new column on the election-side Race row cannot leak
// into a gp-api response or an LLM prompt by accident.
const ApiResponseSchema = z.object({
  candidate_count: z.number(),
  candidate_office: z.string().nullable(),
  candidates: z.array(ApiCandidateSchema),
  civics_win_number: z.number().nullable(),
  contacts_needed_estimate: z.number().nullable(),
  election_code: z.nativeEnum(ElectionCode).nullish(),
  general_election_date: z.string().nullable(),
  number_of_seats: z.number().nullable(),
  office_level: z.string().nullable(),
  office_type: z.string().nullable(),
  official_office_name: z.string().nullable(),
  primary_election_date: z.string().nullable(),
  projected_turnout: z.number().nullable(),
  relevant_election_date: z.string().nullable(),
  state: z.string().nullable(),
  win_number_effective: z.number().nullable(),
  win_number_estimate: z.number().nullable(),
  filing_date_end: z.string().nullish(),
  partisan_type: z.string().nullish(),
  registered_voters: z.number().nullish(),
  unique_cellphones: z.number().nullish(),
  unique_landlines: z.number().nullish(),
})

type ApiResponse = z.infer<typeof ApiResponseSchema>
type ApiCandidateRaw = z.infer<typeof ApiCandidateSchema>

const toCandidate = (c: ApiCandidateRaw): ApiCandidate => ({
  gpCandidateId: c.gp_candidate_id,
  firstName: c.first_name,
  lastName: c.last_name,
  fullName: c.full_name,
  email: c.email,
  websiteUrl: c.website_url,
  party: c.party,
  isIncumbent: c.is_incumbent,
})

// Substring match (case-insensitive) on the email. Filters out internal
// test candidates (e.g. someone@goodparty.org) seeded against real races
// so they don't leak into the LLM prompt as if they were genuine
// opponents. candidateCount is recomputed from the filtered array to
// keep the two fields consistent.
const TEST_CANDIDATE_EMAIL_MARKER = '@goodparty'

const isTestCandidate = (c: ApiCandidate): boolean =>
  c.email !== null &&
  c.email.toLowerCase().includes(TEST_CANDIDATE_EMAIL_MARKER)

const toRaceContext = (data: ApiResponse): RaceContextFromApi => {
  const candidates = data.candidates
    .map(toCandidate)
    .filter((c) => !isTestCandidate(c))
  return {
    state: data.state,
    candidateOffice: data.candidate_office,
    officialOfficeName: data.official_office_name,
    officeLevel: data.office_level,
    officeType: data.office_type,
    electionCode: data.election_code ?? null,
    primaryElectionDate: data.primary_election_date,
    generalElectionDate: data.general_election_date,
    relevantElectionDate: data.relevant_election_date,
    numberOfSeats: data.number_of_seats,
    projectedTurnout: data.projected_turnout,
    civicsWinNumber: data.civics_win_number,
    winNumberEstimate: data.win_number_estimate,
    winNumberEffective: data.win_number_effective,
    contactsNeededEstimate: data.contacts_needed_estimate,
    candidateCount: candidates.length,
    candidates,
  }
}

const isTestCandidateRaw = (c: ApiCandidateRaw): boolean =>
  c.email !== null &&
  c.email.toLowerCase().includes(TEST_CANDIDATE_EMAIL_MARKER)

// The roster already arrives in the snake_case shape the experiment expects,
// so candidates pass through untouched (test rows filtered). Deliberately
// omits civics_win_number and win_number_estimate — the CAP experiments
// dropped those.
const toStrategyContext = (data: ApiResponse): StrategyContext => {
  const candidates = data.candidates.filter((c) => !isTestCandidateRaw(c))
  return {
    candidate_count: candidates.length,
    candidate_office: data.candidate_office,
    candidates,
    contacts_needed_estimate: data.contacts_needed_estimate,
    filing_date_end: data.filing_date_end ?? null,
    general_election_date: data.general_election_date,
    number_of_seats: data.number_of_seats,
    office_level: data.office_level,
    office_type: data.office_type,
    official_office_name: data.official_office_name,
    partisan_type: data.partisan_type ?? null,
    primary_election_date: data.primary_election_date,
    projected_turnout: data.projected_turnout,
    registered_voters: data.registered_voters ?? null,
    relevant_election_date: data.relevant_election_date,
    state: data.state,
    unique_cellphones: data.unique_cellphones ?? null,
    unique_landlines: data.unique_landlines ?? null,
    win_number_effective: data.win_number_effective,
  }
}

@Injectable()
export class ElectionApiService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly campaignStrategyContext: CampaignStrategyContextService,
  ) {
    this.logger.setContext(ElectionApiService.name)
  }

  private async fetchRaw(brHashId: string): Promise<ApiResponse> {
    let raw: CampaignStrategyContextResponse
    try {
      raw = await this.campaignStrategyContext.getCampaignStrategyContext({
        brHashId,
      })
    } catch (error) {
      if (error instanceof NotFoundException) {
        // Warn, not error: usually a dev-env data gap that resolves on the
        // next dbt run, and the caller decides whether to escalate.
        this.logger.warn(
          { brHashId },
          'no Race row for brHashId; caller should mark race as unavailable',
        )
        throw new ElectionApiRaceNotFoundError(brHashId)
      }
      this.logger.error(
        {
          brHashId,
          message: error instanceof Error ? error.message : String(error),
        },
        'campaign-strategy-context lookup failed',
      )
      // The election database is a separate, fail-soft cluster, so an outage
      // stays a gateway failure: CampaignStrategyService keys off this to end
      // the poll loop rather than retry forever.
      throw new BadGatewayException('election data lookup failed')
    }

    const parsed = ApiResponseSchema.safeParse(raw)
    if (!parsed.success) {
      this.logger.error(
        { issues: parsed.error.issues },
        'campaign-strategy-context result failed schema validation',
      )
      throw new BadGatewayException(
        'election data lookup returned an unexpected shape',
      )
    }
    return parsed.data
  }

  async getRaceContext(brHashId: string): Promise<RaceContextFromApi> {
    return toRaceContext(await this.fetchRaw(brHashId))
  }

  async getStrategyContext(brHashId: string): Promise<StrategyContext> {
    return toStrategyContext(await this.fetchRaw(brHashId))
  }
}
