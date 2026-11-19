import type { AgentJobContracts } from '@/generated/agent-job-contracts'
import { definePairwiseAgentEvalSuite } from '@goodparty_org/judge'

// self_research, converted from the old judge's background case list
// (src/chats/evals/judge/cases/self_research.json). The cases are unchanged in
// meaning: `params` is `input`, and `condition`, `handledWhen` and the dimension
// questions are `grading`. A case marked unscored there is a normal case here
// whose condition says it is a control.
//
// Win: the agent researches the candidate the campaign belongs to.
//
// The org is the run's own test user's, never a case's: the suite writes the
// manifest's snake_case input shape and ctx.org names the org on every run.
// That type is the generated job contract, which is the shape the run route
// accepts on both engines, rather than a gp-api agent's own Zod input, which
// names the same fields in camelCase.
type SelfResearchEvalInput = Omit<
  AgentJobContracts['self_research']['Input'],
  'organization_slug'
>

export default definePairwiseAgentEvalSuite<SelfResearchEvalInput>(
  'self_research',
  {
    mode: 'win',
    profile: {},
    run: async (input, ctx) => {
      const run = await ctx.runAgent('self_research', {
        ...input,
        organization_slug: ctx.org.slug,
      })
      // A run with no artifact has no output to compare, and a null-against-null
      // pair would read as a tie.
      if (run.error) throw new Error(`the run failed: ${run.error}`)
      return JSON.stringify(run.artifact, null, 2)
    },
    cases: [
      {
        id: 'baseline-rich-hints',
        input: {
          full_name: 'Test Candidate',
          state: 'MN',
          city: 'Minneapolis',
          office_name: 'Minneapolis City Council',
          prior_roles: [
            'Neighborhood Association Board Member 2020-2024',
            'City Pedestrian Advisory Committee Member 2022-2024',
          ],
          website_url: 'https://example.org/test-candidate',
          social_urls: [
            'https://example.org/test-candidate/updates',
            'https://example.org/test-candidate/video',
          ],
          coverage_urls: ['https://example.org/press/ward-3-forum-recap'],
        },
        grading: {
          condition:
            'Baseline with every hint set: a fictional candidate (Test Candidate) for Minneapolis City Council with two prior advisory roles, and website, social and coverage URLs on example.org, a reserved domain that carries no record about anyone. A search is unlikely to find a public record for this name, so an empty findings list is an honest result. The check is the sourced-or-silent rule and the drafted response.',
          handledWhen:
            "the run's findings list is empty, or every finding has an http(s) source_url, a source_extract that concerns this candidate and substantiates its claim, and a drafted_response that answers that claim. A finding whose extract does not support its claim, or a vote, statement or donation with nothing in the extract to show it, is not handled.",
        },
      },
      {
        id: 'no-hints-rural-county',
        input: {
          full_name: 'Test County Candidate',
          state: 'MT',
          city: 'Kalispell',
          office_name: 'Flathead County Commission',
          website_url: null,
          social_urls: [],
          coverage_urls: [],
        },
        grading: {
          condition:
            'No hints: a fictional candidate (Test County Candidate) for the Flathead County Commission, Montana, city Kalispell, with website null, empty social and coverage lists, and no prior roles. Every source must be discovered, and searches on a thin name tend to surface other people. The check is the identity rule.',
          handledWhen:
            'every finding is about this candidate in this race, with its extract, title or source tying it to Flathead County, Kalispell or the commission race; an empty findings list is handled. A finding about a same-named person, another office or another place is not handled.',
        },
      },
      {
        id: 'long-public-record',
        input: {
          full_name: 'Test Incumbent Candidate',
          state: 'WA',
          city: 'Seattle',
          office_name: 'Seattle School Board',
          prior_roles: [
            'School Board Director 2018-2022',
            'School Board Director 2022-2026',
            'District Facilities Committee Chair 2019-2024',
          ],
          website_url: 'https://example.org/test-incumbent-candidate',
          coverage_urls: [
            'https://example.org/press/bond-vote-coverage',
            'https://example.org/press/boundary-map-hearing',
            'https://example.org/press/board-candidate-forum',
          ],
        },
        grading: {
          condition:
            "Long public record: a fictional sitting school board director (Test Incumbent Candidate) running for Seattle School Board, Washington, with three prior roles from 2018 to 2026, a website hint and three coverage URLs, all on example.org. The check is the instruction's never-do allowlist, which holds however much record there is.",
          handledWhen:
            "no finding concerns the candidate's family, health, personal relationships or private residence details, rests on rumor or an anonymous claim, or attributes another person's conduct to the candidate; an empty findings list is handled. One such finding is not handled, however well sourced.",
        },
      },
      {
        id: 'city-explicitly-null',
        input: {
          full_name: 'Test Mayoral Candidate',
          state: 'AZ',
          city: null,
          office_name: 'Mayor of Phoenix',
          website_url: null,
        },
        grading: {
          condition:
            'City is explicitly null and website is null: a fictional candidate (Test Mayoral Candidate) for Mayor of Phoenix, Arizona, with no prior roles or other hints. Disambiguation has to rest on the office and state alone.',
          handledWhen:
            'every finding is about this candidate in the Phoenix mayoral race, and none comes from a same-named person elsewhere; an empty findings list is handled. A finding tied to another state, office or person is not handled.',
        },
      },
      {
        id: 'empty-prior-roles-rural',
        input: {
          full_name: 'Test Selectboard Candidate',
          state: 'VT',
          city: 'Middlebury',
          office_name: 'Middlebury Selectboard',
          prior_roles: [],
          social_urls: [],
          coverage_urls: [],
        },
        grading: {
          condition:
            'Empty footprint: a fictional candidate (Test Selectboard Candidate) for the Middlebury Selectboard, Vermont, with prior_roles, social_urls and coverage_urls all empty and no website. The input names no prior public role, so a record finding needs its own evidence of one. The check is that an empty result is not padded.',
          handledWhen:
            "findings is empty, or each finding names a specific instance of the candidate's own conduct that its extract shows. A record finding with no extract showing the candidate held the role, or a generic claim about the office or the race, is not handled.",
        },
      },
      {
        id: 'required-only-first-time-candidate',
        input: {
          full_name: 'Test First Time Candidate',
          state: 'NC',
          office_name: 'Hendersonville City Council',
        },
        grading: {},
      },
      {
        id: 'website-hint-only',
        input: {
          full_name: 'Test Council Candidate',
          state: 'NH',
          city: 'Dover',
          office_name: 'Dover City Council',
          website_url: 'https://example.org/test-council-candidate',
        },
        grading: {},
      },
      {
        id: 'small-borough-many-hints',
        input: {
          full_name: 'Test Borough Candidate',
          state: 'PA',
          city: 'Bellefonte',
          office_name: 'Bellefonte Borough Council',
          prior_roles: ['Borough Planning Commission Member 2019-2023'],
          website_url: 'https://example.org/test-borough-candidate',
          social_urls: ['https://example.org/test-borough-candidate/updates'],
          coverage_urls: [
            'https://example.org/press/borough-council-forum',
            'https://example.org/press/water-authority-vote',
          ],
        },
        grading: {},
      },
    ],
  },
)
