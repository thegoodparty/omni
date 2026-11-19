import type { AgentJobContracts } from '@/generated/agent-job-contracts'
import { definePairwiseAgentEvalSuite } from '@goodparty_org/judge'

// opposition_research, converted from the old judge's background case list
// (src/chats/evals/judge/cases/opposition_research.json). The cases are unchanged in
// meaning: `params` is `input`, and `condition`, `handledWhen` and the dimension
// questions are `grading`. A case marked unscored there is a normal case here
// whose condition says it is a control.
//
// Win: the agent works over the candidate's own campaign strategy context
// and marks the candidate's row in the roster by their email.
//
// The org is the run's own test user's, never a case's: the suite writes the
// manifest's snake_case input shape and ctx.org names the org on every run.
// That type is the generated job contract, which is the shape the run route
// accepts on both engines, rather than a gp-api agent's own Zod input, which
// names the same fields in camelCase.
type OppositionResearchEvalInput = Omit<
  AgentJobContracts['opposition_research']['Input'],
  'organization_slug'
>

export default definePairwiseAgentEvalSuite<OppositionResearchEvalInput>(
  'opposition_research',
  {
    mode: 'win',
    profile: {},
    run: async (input, ctx) => {
      const campaign = await ctx.api.get<{
        details?: { raceId?: string | null }
      }>('/v1/campaigns/mine')
      const raceId = campaign.details?.raceId
      if (!raceId) {
        throw new Error(
          "this run's campaign has no raceId, so the case cannot run",
        )
      }
      const { email } = await ctx.api.get<{ email: string }>('/v1/users/me')

      // The old judge resolved these once per sweep from one fixture account. Here
      // each run fills them from its own campaign and its own user, so both arms
      // compare the same fields supplied by two equivalent accounts.
      const resolved = JSON.parse(
        JSON.stringify(input)
          .replaceAll('{judgeRaceId}', raceId)
          .replaceAll('{judgeUserEmail}', email)
          .replaceAll('{judgeOrgSlug}', ctx.org.slug),
      ) as OppositionResearchEvalInput

      const run = await ctx.runAgent('opposition_research', {
        ...resolved,
        organization_slug: ctx.org.slug,
      })
      // A run with no artifact has no output to compare, and a null-against-null
      // pair would read as a tie.
      if (run.error) throw new Error(`the run failed: ${run.error}`)
      return JSON.stringify(run.artifact, null, 2)
    },
    cases: [
      {
        id: 'baseline-three-way-nonpartisan',
        input: {
          race_id: '{judgeRaceId}',
          user_email: '{judgeUserEmail}',
          user_full_name: 'Test Candidate',
          user_first_name: 'Test',
          user_last_name: 'Candidate',
          user_party_affiliation: null,
          other_party: null,
          campaign_strategy_context: {
            candidate_count: 3,
            candidate_office: 'Cheyenne City Council - Ward 1',
            official_office_name: 'Cheyenne City Council Ward 1',
            office_level: 'city',
            office_type: 'City Council',
            partisan_type: 'nonpartisan',
            state: 'WY',
            number_of_seats: 1,
            general_election_date: '2026-11-03',
            primary_election_date: null,
            relevant_election_date: '2026-11-03',
            filing_date_end: '2026-05-29',
            registered_voters: 9400,
            projected_turnout: 3100,
            win_number_effective: 1240,
            contacts_needed_estimate: 7440,
            unique_cellphones: 5100,
            unique_landlines: 1200,
            candidates: [
              {
                first_name: 'Test',
                last_name: 'Candidate',
                full_name: 'Test Candidate',
                email: '{judgeUserEmail}',
                website_url: null,
                party: null,
                is_incumbent: false,
              },
              {
                first_name: 'Marlowe',
                last_name: 'Quennell',
                full_name: 'Marlowe Quennell',
                email: null,
                website_url: 'https://example.org/test-incumbent',
                party: null,
                is_incumbent: true,
              },
              {
                first_name: 'Darcey',
                last_name: 'Holloway-Pike',
                full_name: 'Darcey Holloway-Pike',
                email: null,
                website_url: null,
                party: null,
                is_incumbent: false,
              },
            ],
          },
        },
        grading: {},
      },
      {
        id: 'partisan-race-with-incumbent',
        input: {
          race_id: '{judgeRaceId}',
          user_email: '{judgeUserEmail}',
          user_full_name: 'Test Candidate',
          user_first_name: 'Test',
          user_last_name: 'Candidate',
          user_party_affiliation: 'Other',
          other_party: 'Independent',
          campaign_strategy_context: {
            candidate_count: 3,
            candidate_office: 'Cheyenne City Council - Ward 1',
            official_office_name: 'Cheyenne City Council Ward 1',
            office_level: 'city',
            office_type: 'City Council',
            partisan_type: 'partisan',
            state: 'WY',
            number_of_seats: 1,
            general_election_date: '2026-11-03',
            primary_election_date: null,
            relevant_election_date: '2026-11-03',
            filing_date_end: '2026-05-29',
            registered_voters: 9400,
            projected_turnout: 3100,
            win_number_effective: 1240,
            contacts_needed_estimate: 7440,
            unique_cellphones: 5100,
            unique_landlines: 1200,
            candidates: [
              {
                first_name: 'Test',
                last_name: 'Candidate',
                full_name: 'Test Candidate',
                email: '{judgeUserEmail}',
                website_url: null,
                party: 'Independent',
                is_incumbent: false,
              },
              {
                first_name: 'Marlowe',
                last_name: 'Quennell',
                full_name: 'Marlowe Quennell',
                email: null,
                website_url: 'https://example.org/test-incumbent',
                party: 'Democratic',
                is_incumbent: true,
              },
              {
                first_name: 'Darcey',
                last_name: 'Holloway-Pike',
                full_name: 'Darcey Holloway-Pike',
                email: null,
                website_url: null,
                party: 'Republican',
                is_incumbent: false,
              },
            ],
          },
        },
        grading: {
          condition:
            'Partisan race: the candidate (Independent), incumbent Marlowe Quennell (Democratic) and challenger Darcey Holloway-Pike (Republican). Seed candidates are authoritative filers, and in a partisan race each opponent keeps their roster party.',
          handledWhen:
            'the run lists Marlowe Quennell as the Democratic incumbent and Darcey Holloway-Pike as the Republican non-incumbent, and does not list Test Candidate. Dropping either, a missing or wrong party label, or listing the candidate is not handled.',
        },
      },
      {
        id: 'head-to-head',
        input: {
          race_id: '{judgeRaceId}',
          user_email: '{judgeUserEmail}',
          user_full_name: 'Test Candidate',
          user_first_name: 'Test',
          user_last_name: 'Candidate',
          user_party_affiliation: null,
          other_party: null,
          campaign_strategy_context: {
            candidate_count: 2,
            candidate_office: 'Cheyenne City Council - Ward 1',
            official_office_name: 'Cheyenne City Council Ward 1',
            office_level: 'city',
            office_type: 'City Council',
            partisan_type: 'nonpartisan',
            state: 'WY',
            number_of_seats: 1,
            general_election_date: '2026-11-03',
            primary_election_date: null,
            relevant_election_date: '2026-11-03',
            filing_date_end: '2026-05-29',
            registered_voters: 9400,
            projected_turnout: 3100,
            win_number_effective: 1240,
            contacts_needed_estimate: 7440,
            unique_cellphones: 5100,
            unique_landlines: 1200,
            candidates: [
              {
                first_name: 'Test',
                last_name: 'Candidate',
                full_name: 'Test Candidate',
                email: '{judgeUserEmail}',
                website_url: null,
                party: null,
                is_incumbent: false,
              },
              {
                first_name: 'Marlowe',
                last_name: 'Quennell',
                full_name: 'Marlowe Quennell',
                email: null,
                website_url: 'https://example.org/test-incumbent',
                party: null,
                is_incumbent: true,
              },
            ],
          },
        },
        grading: {},
      },
      {
        id: 'unopposed',
        input: {
          race_id: '{judgeRaceId}',
          user_email: '{judgeUserEmail}',
          user_full_name: 'Test Candidate',
          user_first_name: 'Test',
          user_last_name: 'Candidate',
          user_party_affiliation: null,
          other_party: null,
          campaign_strategy_context: {
            candidate_count: 1,
            candidate_office: 'Cheyenne City Council - Ward 1',
            official_office_name: 'Cheyenne City Council Ward 1',
            office_level: 'city',
            office_type: 'City Council',
            partisan_type: 'nonpartisan',
            state: 'WY',
            number_of_seats: 1,
            general_election_date: '2026-11-03',
            primary_election_date: null,
            relevant_election_date: '2026-11-03',
            filing_date_end: '2026-05-29',
            registered_voters: 9400,
            projected_turnout: 3100,
            win_number_effective: 1240,
            contacts_needed_estimate: 7440,
            unique_cellphones: 5100,
            unique_landlines: 1200,
            candidates: [
              {
                first_name: 'Test',
                last_name: 'Candidate',
                full_name: 'Test Candidate',
                email: '{judgeUserEmail}',
                website_url: null,
                party: null,
                is_incumbent: false,
              },
            ],
          },
        },
        grading: {},
      },
      {
        id: 'empty-roster-nonzero-count',
        input: {
          race_id: '{judgeRaceId}',
          user_email: '{judgeUserEmail}',
          user_full_name: 'Test Candidate',
          user_first_name: 'Test',
          user_last_name: 'Candidate',
          user_party_affiliation: null,
          other_party: null,
          campaign_strategy_context: {
            candidate_count: 4,
            candidate_office: 'Cheyenne City Council - Ward 1',
            official_office_name: 'Cheyenne City Council Ward 1',
            office_level: 'city',
            office_type: 'City Council',
            partisan_type: 'nonpartisan',
            state: 'WY',
            number_of_seats: 1,
            general_election_date: '2026-11-03',
            primary_election_date: null,
            relevant_election_date: '2026-11-03',
            filing_date_end: '2026-05-29',
            registered_voters: 9400,
            projected_turnout: 3100,
            win_number_effective: 1240,
            contacts_needed_estimate: 7440,
            unique_cellphones: 5100,
            unique_landlines: 1200,
            candidates: [],
          },
        },
        grading: {
          condition:
            'Empty roster: candidate_count is 4 but candidates is an empty list and there is no primary roster, so the count disagrees with the rows. No opponent is on record; any name must come from the two web searches.',
          handledWhen:
            'opponents holds at most three entries, none is the candidate, and every entry has incumbent null, since a web-found name never carries a known incumbency. Inventing opponents to meet the count of four, or giving any entry incumbent true or false, is not handled.',
        },
      },
      {
        id: 'primary-stage-roster',
        input: {
          race_id: '{judgeRaceId}',
          user_email: '{judgeUserEmail}',
          user_full_name: 'Test Candidate',
          user_first_name: 'Test',
          user_last_name: 'Candidate',
          user_party_affiliation: null,
          other_party: null,
          campaign_strategy_context: {
            candidate_count: 0,
            candidate_office: 'Cheyenne City Council - Ward 1',
            official_office_name: 'Cheyenne City Council Ward 1',
            office_level: 'city',
            office_type: 'City Council',
            partisan_type: 'nonpartisan',
            state: 'WY',
            number_of_seats: 1,
            general_election_date: '2026-11-03',
            primary_election_date: '2026-08-18',
            relevant_election_date: '2026-08-18',
            filing_date_end: '2026-05-29',
            registered_voters: 9400,
            projected_turnout: 3100,
            win_number_effective: 1240,
            contacts_needed_estimate: 7440,
            unique_cellphones: 5100,
            unique_landlines: 1200,
            candidates: [],
          },
          campaign_primary_strategy_context: {
            candidate_count: 4,
            candidates: [
              {
                first_name: 'Test',
                last_name: 'Candidate',
                full_name: 'Test Candidate',
                email: '{judgeUserEmail}',
                website_url: null,
                party: null,
                is_incumbent: false,
              },
              {
                first_name: 'Marlowe',
                last_name: 'Quennell',
                full_name: 'Marlowe Quennell',
                email: null,
                website_url: 'https://example.org/test-incumbent',
                party: null,
                is_incumbent: true,
              },
              {
                first_name: 'Darcey',
                last_name: 'Holloway-Pike',
                full_name: 'Darcey Holloway-Pike',
                email: null,
                website_url: null,
                party: null,
                is_incumbent: false,
              },
              {
                first_name: 'Tobin',
                last_name: 'Ashgrove',
                full_name: 'Tobin Ashgrove',
                email: null,
                website_url: null,
                party: null,
                is_incumbent: false,
              },
            ],
          },
        },
        grading: {
          condition:
            'Before the primary: the general roster is empty (candidate_count 0), while campaign_primary_strategy_context lists four rows, the candidate plus Marlowe Quennell, Darcey Holloway-Pike and Tobin Ashgrove, in a nonpartisan race with a primary on 2026-08-18. The instruction says a nonpartisan primary roster is the field.',
          handledWhen:
            'Test Candidate is not listed, no name appears twice, every entry is labeled Nonpartisan, and any primary-roster opponent kept carries its roster incumbency. Listing the candidate, a duplicate name, or a party label other than Nonpartisan is not handled.',
        },
      },
      {
        id: 'crowded-field',
        input: {
          race_id: '{judgeRaceId}',
          user_email: '{judgeUserEmail}',
          user_full_name: 'Test Candidate',
          user_first_name: 'Test',
          user_last_name: 'Candidate',
          user_party_affiliation: null,
          other_party: null,
          campaign_strategy_context: {
            candidate_count: 7,
            candidate_office: 'Cheyenne City Council - Ward 1',
            official_office_name: 'Cheyenne City Council Ward 1',
            office_level: 'city',
            office_type: 'City Council',
            partisan_type: 'nonpartisan',
            state: 'WY',
            number_of_seats: 1,
            general_election_date: '2026-11-03',
            primary_election_date: null,
            relevant_election_date: '2026-11-03',
            filing_date_end: '2026-05-29',
            registered_voters: 9400,
            projected_turnout: 3100,
            win_number_effective: 1240,
            contacts_needed_estimate: 7440,
            unique_cellphones: 5100,
            unique_landlines: 1200,
            candidates: [
              {
                first_name: 'Test',
                last_name: 'Candidate',
                full_name: 'Test Candidate',
                email: '{judgeUserEmail}',
                website_url: null,
                party: null,
                is_incumbent: false,
              },
              {
                first_name: 'Marlowe',
                last_name: 'Quennell',
                full_name: 'Marlowe Quennell',
                email: null,
                website_url: 'https://example.org/test-incumbent',
                party: null,
                is_incumbent: true,
              },
              {
                first_name: 'Darcey',
                last_name: 'Holloway-Pike',
                full_name: 'Darcey Holloway-Pike',
                email: null,
                website_url: null,
                party: null,
                is_incumbent: false,
              },
              {
                first_name: 'Lusa',
                last_name: 'Brennick',
                full_name: 'Lusa Brennick',
                email: null,
                website_url: null,
                party: null,
                is_incumbent: false,
              },
              {
                first_name: 'Corin',
                last_name: 'Mathe',
                full_name: 'Corin Mathe',
                email: null,
                website_url: null,
                party: null,
                is_incumbent: false,
              },
              {
                first_name: 'Ines',
                last_name: 'Valdrup',
                full_name: 'Ines Valdrup',
                email: null,
                website_url: null,
                party: null,
                is_incumbent: false,
              },
              {
                first_name: 'Perrin',
                last_name: 'Oakhurst',
                full_name: 'Perrin Oakhurst',
                email: null,
                website_url: null,
                party: null,
                is_incumbent: false,
              },
            ],
          },
        },
        grading: {},
      },
      {
        id: 'user-absent-from-roster',
        input: {
          race_id: '{judgeRaceId}',
          user_email: '{judgeUserEmail}',
          user_full_name: 'Test Candidate',
          user_first_name: 'Test',
          user_last_name: 'Candidate',
          user_party_affiliation: null,
          other_party: null,
          campaign_strategy_context: {
            candidate_count: 3,
            candidate_office: 'Cheyenne City Council - Ward 1',
            official_office_name: 'Cheyenne City Council Ward 1',
            office_level: 'city',
            office_type: 'City Council',
            partisan_type: 'nonpartisan',
            state: 'WY',
            number_of_seats: 1,
            general_election_date: '2026-11-03',
            primary_election_date: null,
            relevant_election_date: '2026-11-03',
            filing_date_end: '2026-05-29',
            registered_voters: 9400,
            projected_turnout: 3100,
            win_number_effective: 1240,
            contacts_needed_estimate: 7440,
            unique_cellphones: 5100,
            unique_landlines: 1200,
            candidates: [
              {
                first_name: 'Marlowe',
                last_name: 'Quennell',
                full_name: 'Marlowe Quennell',
                email: null,
                website_url: 'https://example.org/test-incumbent',
                party: null,
                is_incumbent: true,
              },
              {
                first_name: 'Darcey',
                last_name: 'Holloway-Pike',
                full_name: 'Darcey Holloway-Pike',
                email: null,
                website_url: null,
                party: null,
                is_incumbent: false,
              },
            ],
          },
        },
        grading: {},
      },
    ],
  },
)
