import type { AgentJobContracts } from '@/generated/agent-job-contracts'
import { definePairwiseAgentEvalSuite } from '@goodparty_org/judge'

// opposition_research: the campaign plan's Opposition Research section. Judged
// against the PMF Engine's arm while the two engines split the arms (dev on the
// PMF Engine, a preview on gp-api's); every environment runs it on gp-api's
// engine now, so this suite is a regression check. Converted from the
// old judge's case list: `params` is `input`, and `condition`, `handledWhen` and
// the dimension questions are `grading`.
//
// Win: the agent works over the candidate's own campaign strategy context and
// marks the candidate's row in the roster by their email.
//
// The roster is the suite's, so both arms read the same seed list and the only
// real difference between them is how each engine works it. Sources are
// live-searched, so the two arms may read different pages; the judge scores the
// rules the artifact can be checked against (the candidate excluded, seed filers
// kept, a nonpartisan race labeled Nonpartisan, a web-found name race-matched),
// not whether a name is true in the world, which it cannot see.
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

const CANDIDATE = {
  first_name: 'Test',
  last_name: 'Candidate',
  full_name: 'Test Candidate',
  email: '{judgeUserEmail}',
  website_url: null,
  party: null,
  is_incumbent: false,
}

const CHEYENNE_CONTEXT = {
  candidate_office: 'Cheyenne City Council - Ward 1',
  official_office_name: 'Cheyenne City Council Ward 1',
  office_level: 'city',
  office_type: 'City Council',
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
}

const baseInput = (
  overrides: Partial<OppositionResearchEvalInput> & {
    campaign_strategy_context: OppositionResearchEvalInput['campaign_strategy_context']
  },
): OppositionResearchEvalInput => ({
  race_id: '{judgeRaceId}',
  user_email: '{judgeUserEmail}',
  user_full_name: 'Test Candidate',
  user_first_name: 'Test',
  user_last_name: 'Candidate',
  user_party_affiliation: null,
  other_party: null,
  ...overrides,
})

const incumbent = {
  first_name: 'Marlowe',
  last_name: 'Quennell',
  full_name: 'Marlowe Quennell',
  email: null,
  website_url: 'https://example.org/test-incumbent',
  party: null,
  is_incumbent: true,
}

const challenger = {
  first_name: 'Darcey',
  last_name: 'Holloway-Pike',
  full_name: 'Darcey Holloway-Pike',
  email: null,
  website_url: null,
  party: null,
  is_incumbent: false,
}

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

      // The old judge resolved these once per sweep from one fixture account.
      // Here each run fills them from its own campaign and its own user, so
      // both arms compare the same fields supplied by two equivalent accounts.
      // JSON.parse returns `any`; the object is this suite's own input type,
      // round-tripped, and the run route validates it against the agent's.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
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
        input: baseInput({
          campaign_strategy_context: {
            ...CHEYENNE_CONTEXT,
            candidate_count: 3,
            partisan_type: 'nonpartisan',
            candidates: [CANDIDATE, incumbent, challenger],
          },
        }),
        grading: {
          condition:
            'Control: a three-way nonpartisan city council race with a complete roster (candidate, a nonpartisan incumbent and one challenger) and no stressor. The mutation base the other cases are built from.',
          handledWhen:
            'exactly two opponents are listed, Marlowe Quennell and Darcey Holloway-Pike, the candidate is not listed, both are labeled Nonpartisan, and Quennell is incumbent true while Holloway-Pike is incumbent false.',
        },
      },
      {
        id: 'partisan-race-with-incumbent',
        input: baseInput({
          user_party_affiliation: 'Other',
          other_party: 'Independent',
          campaign_strategy_context: {
            ...CHEYENNE_CONTEXT,
            candidate_count: 3,
            partisan_type: 'partisan',
            candidates: [
              { ...CANDIDATE, party: 'Independent' },
              { ...incumbent, party: 'Democratic' },
              { ...challenger, party: 'Republican' },
            ],
          },
        }),
        grading: {
          condition:
            'Partisan race: the candidate (Independent), incumbent Marlowe Quennell (Democratic) and challenger Darcey Holloway-Pike (Republican). Seed candidates are authoritative filers, and in a partisan race each opponent keeps their roster party.',
          handledWhen:
            'the run lists Marlowe Quennell as the Democratic incumbent and Darcey Holloway-Pike as the Republican non-incumbent, and does not list Test Candidate. Dropping either, a missing or wrong party label, or listing the candidate is not handled.',
        },
      },
      {
        id: 'thin-empty-roster',
        input: baseInput({
          campaign_strategy_context: {
            ...CHEYENNE_CONTEXT,
            candidate_count: 0,
            partisan_type: 'nonpartisan',
            candidates: [],
          },
        }),
        grading: {
          condition:
            'Thin data: an empty roster with candidate_count 0 and no primary roster, for an office a two-query search is unlikely to confirm anyone for. Nothing on record, so any name has to come from the two web searches and be confirmed against an authoritative roster for THIS office.',
          handledWhen:
            'opponents is empty, or holds at most three entries, none of which is the candidate and each of which has incumbent null since a web-found name never carries a known incumbency. Inventing opponents, or giving any entry incumbent true or false, is not handled.',
        },
      },
      {
        id: 'wrong-jurisdiction-lookalike',
        input: baseInput({
          campaign_strategy_context: {
            ...CHEYENNE_CONTEXT,
            candidate_office: 'Springfield City Council - Ward 3',
            official_office_name: 'Springfield City Council Ward 3',
            state: 'IL',
            candidate_count: 2,
            partisan_type: 'nonpartisan',
            candidates: [CANDIDATE, incumbent],
          },
        }),
        grading: {
          condition:
            'Wrong jurisdiction: a Springfield, Illinois ward 3 race, where searches also surface Springfield in Missouri and Massachusetts. The roster names only the candidate and Marlowe Quennell. Nothing in the input says which Springfield a web result belongs to; only a result whose page names this office and this state is this race.',
          handledWhen:
            'the only opponent listed is Marlowe Quennell (labeled Nonpartisan, incumbent true), or the list is that one plus at most three names each confirmed as Springfield, Illinois ward 3 filers. Adding a name whose only support is a Springfield in another state, or an office or ward that is not ward 3, is not handled.',
        },
      },
      {
        id: 'primary-stage-roster',
        input: baseInput({
          campaign_strategy_context: {
            ...CHEYENNE_CONTEXT,
            candidate_count: 0,
            partisan_type: 'nonpartisan',
            primary_election_date: '2026-08-18',
            relevant_election_date: '2026-08-18',
            candidates: [],
          },
          campaign_primary_strategy_context: {
            candidate_count: 4,
            candidates: [
              CANDIDATE,
              incumbent,
              challenger,
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
        }),
        grading: {
          condition:
            'Before the primary: the general roster is empty (candidate_count 0), while campaign_primary_strategy_context lists four rows, the candidate plus Marlowe Quennell, Darcey Holloway-Pike and Tobin Ashgrove, in a nonpartisan race with a primary on 2026-08-18. The instruction says a nonpartisan primary roster is the field.',
          handledWhen:
            'Test Candidate is not listed, no name appears twice, every entry is labeled Nonpartisan, and each primary-roster opponent kept carries its roster incumbency. Listing the candidate, a duplicate name, or a party label other than Nonpartisan is not handled.',
        },
      },
      {
        id: 'unopposed',
        input: baseInput({
          campaign_strategy_context: {
            ...CHEYENNE_CONTEXT,
            candidate_count: 1,
            partisan_type: 'nonpartisan',
            candidates: [CANDIDATE],
          },
        }),
        grading: {
          condition:
            'Uncontested: the roster holds only the candidate and candidate_count is 1. A real uncontested race is a legitimate empty result, not a failed run.',
          handledWhen:
            'opponents is empty. Listing any name, the candidate included, is not handled.',
        },
      },
      {
        id: 'user-absent-from-roster',
        input: baseInput({
          campaign_strategy_context: {
            ...CHEYENNE_CONTEXT,
            candidate_count: 2,
            partisan_type: 'nonpartisan',
            candidates: [incumbent, challenger],
          },
        }),
        grading: {
          condition:
            "The candidate's row is not in the roster at all, so the email cannot match one; the instruction's fallback is a fuzzy match on user_full_name. Two real opponents are on record and nothing else.",
          handledWhen:
            'both Marlowe Quennell and Darcey Holloway-Pike are listed, neither labeled anything but Nonpartisan, and Test Candidate is not listed. Dropping either real filer because the candidate was absent, or listing Test Candidate, is not handled.',
        },
      },
      {
        id: 'partisan-primary-roster-other-party',
        input: baseInput({
          user_party_affiliation: 'Democratic',
          campaign_strategy_context: {
            ...CHEYENNE_CONTEXT,
            candidate_count: 0,
            partisan_type: 'partisan',
            primary_election_date: '2026-08-18',
            relevant_election_date: '2026-08-18',
            candidates: [],
          },
          campaign_primary_strategy_context: {
            candidate_count: 3,
            candidates: [
              { ...CANDIDATE, party: 'Democratic' },
              { ...incumbent, party: 'Republican' },
              {
                first_name: 'Lusa',
                last_name: 'Brennick',
                full_name: 'Lusa Brennick',
                email: null,
                website_url: null,
                party: 'Democratic',
                is_incumbent: false,
              },
            ],
          },
        }),
        grading: {
          condition:
            "A partisan race before its primary, so the primary roster spans both parties' primaries: the candidate and Lusa Brennick are Democrats, Marlowe Quennell is a Republican. Only the eventual nominees are general-election opponents, so a rival in the candidate's OWN primary is not one of them either, and the Republican is not yet the nominee.",
          handledWhen:
            'Test Candidate is not listed, no name appears twice, and any entry kept carries its roster party. Listing Test Candidate, duplicating a name, or inventing a party label is not handled.',
        },
      },
    ],
  },
)
