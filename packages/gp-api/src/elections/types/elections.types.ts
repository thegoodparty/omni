import type {
  BallotReadyPositionLevel,
  RaceTargetMetrics,
} from '@goodparty_org/contracts'
export type { RaceTargetMetrics } from '@goodparty_org/contracts'

export type BDElection = {
  id: string
  electionDay: string
  name: string
  originalElectionDate: string
  state: string
  timezone: string
  primaryElectionDate?: string
  primaryElectionId?: string
}

export type PrimaryElectionDates = {
  [key: string]: {
    electionDay: string
    primaryElectionId: string
  }
}

export type GeoData = {
  name: string
  type: string
  city?: string
  county?: string
  state?: string
  township?: string
  town?: string
  village?: string
  borough?: string
}

export enum OfficeLevel {
  FEDERAL = 10,
  STATE = 8,
  COUNTY = 6,
  CITY = 4,
  LOCAL = 0,
  DEFAULT = 12,
}

export enum ElectionCode {
  // Should directly reflect ElectionCode in election-api/prisma/schema/projectedTurnout.prisma
  General = 'General',
  LocalOrMunicipal = 'LocalOrMunicipal',
  ConsolidatedGeneral = 'ConsolidatedGeneral',
}

export type ProjectedTurnout = {
  id: string
  brPositionId: string
  createdAt: Date
  updatedAt: Date
  geoid: string
  state: string
  L2DistrictType: string
  L2DistrictName: string
  year: number
  electionCode: ElectionCode
  projectedTurnout: number
  inferenceDate: Date
  modelVersion: string
}

/**
 * District-only race target calculation result. Does NOT include filing fee
 * fields — those only come from the position lookup path. Callers using this
 * (e.g. `buildRaceTargetDetails`) must default filingFee/filingRequirementsText
 * to null themselves when assembling the final `RaceTargetMetrics`.
 */
export type RaceTargetDetailsResult = Pick<
  RaceTargetMetrics,
  'winNumber' | 'voterContactGoal' | 'projectedTurnout'
>

export type VoterIssue = {
  label: string
  score: number
  priority: 'high' | 'medium' | 'low'
}

export type VoterIssueLevel = 'local' | 'regional' | 'state' | 'federal'

export enum ProjectedTurnoutSourceColumns {
  id = 'id',
  createdAt = 'createdAt',
  updatedAt = 'updatedAt',
  electionYear = 'electionYear',
  electionCode = 'electionCode',
  projectedTurnout = 'projectedTurnout',
  inferenceAt = 'inferenceAt',
  modelVersion = 'modelVersion',
  districtId = 'districtId',
}

export enum DistrictSourceColumns {
  id = 'id',
  createdAt = 'createdAt',
  updatedAt = 'updatedAt',
  state = 'state',
  L2DistrictType = 'L2DistrictType',
  L2DistrictName = 'L2DistrictName',
}

export type DistrictTypeItem = {
  id: string
  L2DistrictType: string
}

export type DistrictNameItem = {
  id: string
  L2DistrictName: string
}

interface DistrictInfo {
  state: string
  L2DistrictType: string
  L2DistrictName: string
}

interface DistrictIdInfo {
  districtId: string
}

interface ByDate {
  electionDate: string
  electionYear?: never
  electionCode?: never
}

interface ByYearAndCode {
  electionDate?: never
  electionYear: string
  electionCode: string
}

export type BuildRaceTargetDetailsInput = (DistrictInfo | DistrictIdInfo) &
  (ByDate | ByYearAndCode)

export type District = {
  id: string
  state: string
  L2DistrictType: string
  L2DistrictName: string
  projectedTurnout: SourceProjectedTurnout | null
  // L2-derived voter aggregates. Only `GET /districts/:id` returns the whole
  // District row; the position lookup hand-shapes a district response without
  // them, hence optional. `null` means the aggregate hasn't been computed for
  // this district type (common for school districts) — it is not evidence of
  // an empty electorate.
  registeredVoters?: number | null
  uniqueCellphones?: number | null
  uniqueLandlines?: number | null
}

export type PositionWithOptionalDistrict = {
  id: string
  brPositionId: string
  brDatabaseId: string
  state: string
  name: string
  level?: BallotReadyPositionLevel | null
  // Optional until election-api's ICP columns deploy and backfill; null =
  // the office's voter_count is unknown upstream (gp-data-platform#473).
  isWinIcp?: boolean | null
  isServeIcp?: boolean | null
  district?: District
  filingFee?: number | null
  filingRequirementsText?: string | null
  filingFeeExtractionSource?: string | null
}

/**
 * Shape returned by election-api `GET /races/by-br-hash-id/:hashId/filing-fee`.
 * Mirrors `FilingDetailsByBrHashResult` on the election-api side so the shapes
 * stay aligned. `extractionSource` is informational (audit / debugging) and not
 * surfaced to clients today. The three `filing*`/`paperwork*` office-contact
 * fields are sourced straight off the matched BallotReady race row and feed the
 * Pro-upgrade filing-instructions screen.
 */
export type FilingFeeByBrHashResult = {
  filingFee: number | null
  filingRequirementsText: string | null
  extractionSource: string | null
  filingOfficeAddress: string | null
  filingPhoneNumber: string | null
  paperworkInstructions: string | null
}

/**
 * Candidate row from election-api's campaign-strategy-context endpoint.
 * snake_case to match the upstream payload.
 */
export type CampaignStrategyContextCandidate = {
  gp_candidate_id: string | null
  first_name: string
  last_name: string
  full_name: string
  email: string | null
  website_url: string | null
  party: string | null
  is_incumbent: boolean | null
}

/**
 * Response shape from election-api `POST /campaign-strategy-context`. The
 * endpoint takes the BR race hash on `campaign.details.raceId` and returns
 * the per-race civics context — voter counts, candidate roster, win-number
 * variants, election dates. See election-api
 * `CampaignStrategyContextResponse` for the source of truth. Milestone
 * windows are NOT on this response — gp-api calls BR's GraphQL directly
 * for those via `BallotReadyService.fetchMilestones` and merges them onto
 * `RaceTargetMetrics` in `fetchLiveRaceTargetMetrics`.
 */
export type CampaignStrategyContextResponse = {
  candidate_count: number
  candidate_office: string | null
  candidates: CampaignStrategyContextCandidate[]
  civics_win_number: number | null
  contacts_needed_estimate: number | null
  general_election_date: string | null
  number_of_seats: number | null
  office_level: string | null
  office_type: string | null
  official_office_name: string | null
  // BallotReady position partisanship ('partisan' | 'nonpartisan'). Present on
  // the election-api response but historically untyped here; the recommended-
  // lists engine reads it to fork the partisan universe. Optional so existing
  // fixtures that predate it still satisfy the type.
  partisan_type?: string | null
  primary_election_date: string | null
  projected_turnout: number | null
  // Prediction bounds, and the same interval carried through the win-number
  // math below. Optional because the two services deploy in parallel: mid
  // rollout an older election-api omits them, and the mapper has to turn that
  // absence into null — an undefined fails the contract's response schema and
  // 500s the campaign read.
  projected_turnout_lower?: number | null
  projected_turnout_upper?: number | null
  projected_voter_turnout: number | null
  registered_voters: number | null
  unique_cellphones: number | null
  unique_landlines: number | null
  relevant_election_date: string | null
  state: string | null
  win_number_effective: number | null
  win_number_estimate: number | null
  win_number_lower?: number | null
  win_number_upper?: number | null
}

type SourceProjectedTurnout = {
  id: string
  createdAt: Date
  updatedAt: Date
  electionYear: number
  electionCode: ElectionCode
  projectedTurnout: number
  inferenceAt: Date
  modelVersion: string
  districtId: string
}
