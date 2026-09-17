import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { ElectionCode } from '../generated/prisma'

// Input is the BallotReady race hash (`Race.brHashId`, a base64-encoded
// gid://... value). gp-api stores this on `campaign.details.raceId` for
// every onboarded candidate; pass it through verbatim. User-side fields
// live in the sign-up flow on the caller; the election-api endpoint
// stays purely about election data.
const campaignStrategyContextRequestSchema = z
  .object({
    brHashId: z.string().min(1),
  })
  .strict()

export class CampaignStrategyContextRequestDto extends createZodDto(
  campaignStrategyContextRequestSchema,
) {}

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

export type CampaignStrategyContextResponse = {
  candidate_count: number
  candidate_office: string | null
  candidates: CampaignStrategyContextCandidate[]
  civics_win_number: number | null
  contacts_needed_estimate: number | null
  // The electorate `projected_turnout` was drawn for, straight off the race
  // row. Classifying an election date is the warehouse's job, not a
  // caller's: the mart tags each race and the nightly loader lands the tag
  // here, so a consumer that needs to know whether a race is a November
  // general reads this rather than re-deriving it from a date.
  //
  // Nullable on the column, but NOT on the same condition as
  // `projected_turnout`. The mart derives the tag from the race's own
  // election date alone (November general day in an even year -> General,
  // the state's primary day -> Primary, everything else including specials
  // -> LocalOrMunicipal) in a `case` with an `else`, and joins it to the
  // race with an inner join. The turnout projection is a separate left
  // join. So a race outside the model's three-year horizon carries a null
  // `projected_turnout` and still carries its election code, and every
  // served race has one.
  election_code: ElectionCode | null
  general_election_date: string | null
  number_of_seats: number | null
  office_level: string | null
  office_type: string | null
  partisan_type: string | null
  official_office_name: string | null
  primary_election_date: string | null
  projected_turnout: number | null
  projected_turnout_lower: number | null
  projected_turnout_upper: number | null
  registered_voters: number | null
  unique_cellphones: number | null
  unique_landlines: number | null
  relevant_election_date: string | null
  state: string | null
  win_number_effective: number | null
  win_number_estimate: number | null
  win_number_lower: number | null
  win_number_upper: number | null
}
