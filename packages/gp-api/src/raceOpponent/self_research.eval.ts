import type { AgentJobContracts } from '@/generated/agent-job-contracts'
import { definePairwiseAgentEvalSuite } from '@goodparty_org/judge'

// self_research, converted from the old judge's background case list
// (src/chats/evals/judge/cases/self_research.json). A case keeps its id and its
// meaning: `params` is `input`, and `condition`, `handledWhen` and the dimension
// questions are `grading`. A case marked unscored there is a normal case here
// whose condition says it is a control.
//
// Two deliberate differences from that list. Every case here carries a
// `handledWhen`, because a case without one cannot catch a regression. And
// `wrong-jurisdiction-namesake` replaces that list's `small-borough-many-hints`:
// a place-name collision in the wrong state is the failure this agent is most
// likely to make (Fayetteville AR for Fayetteville NC, Portland OR for Portland
// ME), and the two probes it kept already cover a rich hint set.
//
// Win: the agent researches the candidate the campaign belongs to.
//
// The org is the run's own test user's, never a case's: the suite writes the
// manifest's snake_case input shape and ctx.org names the org on every run.
// That type is the generated job contract, which is the shape the run route
// accepts on both engines, rather than a gp-api agent's own Zod input, which
// names the same fields in camelCase.
//
// Every case is a fictional person ("Test ..." in the e2e house style, on
// example.org) against a real office, state and place, because this file is
// public and a finding is a claim about a real person's record.
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
            'Thin data and no hints: a fictional candidate (Test County Candidate) for the Flathead County Commission, Montana, city Kalispell, with website null, empty social and coverage lists, and no prior roles. Every source must be discovered, this county has one weekly paper and no archive, and searches on a thin name tend to surface other people. An empty findings list is the expected result, and padding it to look thorough is the failure this case exists to catch.',
          handledWhen:
            'findings is short or empty, every finding is about this candidate in the Flathead County race with its extract, title or source tying it to Flathead County, Kalispell or the commission race, and no finding rests on a statewide or regional story presented as this candidate. A generic claim with no named instance is not handled; neither is a same-named person elsewhere.',
          dimensions: {
            proportionality:
              'Does the volume and detail of each finding match the volume of evidence behind it? A long entry over thin evidence is disproportionate; shortness is not a virtue by itself.',
          },
        },
      },
      {
        id: 'wrong-jurisdiction-namesake',
        input: {
          full_name: 'Test Fayetteville Candidate',
          state: 'NC',
          city: 'Fayetteville',
          office_name: 'Fayetteville City Council',
          prior_roles: [],
          website_url: null,
        },
        grading: {
          condition:
            'A place-name collision: a fictional candidate (Test Fayetteville Candidate) for Fayetteville City Council, North Carolina. Fayetteville, Arkansas draws far more political coverage than Fayetteville, North Carolina, so searches return Arkansas council members, Arkansas votes and an Arkansas campaign site. state is NC and it is the authority: an Arkansas page is a page to drop, not a record of this candidate. The agent is told to confirm the identity on every fetched page, and this case is whether it did.',
          handledWhen:
            'every finding belongs to Fayetteville, North Carolina, or to an office this candidate actually held, and no finding carries an Arkansas vote, statement, donation or source. One Arkansas source in a finding is not handled; an empty findings list is handled.',
          dimensions: {
            entity_discipline:
              "Are distinct people kept distinct? Facts from one person appearing in another person's finding count against; naming the ambiguity counts in favor.",
          },
        },
      },
      {
        id: 'long-public-record-allowlist',
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
            'Empty footprint, thin data: a fictional candidate (Test Selectboard Candidate) for the Middlebury Selectboard, Vermont, with prior_roles, social_urls and coverage_urls all empty and no website. The input names no prior public role, so a record finding needs its own evidence of one.',
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
        grading: {
          condition:
            'The three required fields and nothing else: a fictional first-time candidate (Test First Time Candidate) for Hendersonville City Council, North Carolina. No city, no prior roles, no hints. A first-time candidate genuinely may have no attackable public record, and this case is whether the agent says so instead of manufacturing vulnerabilities out of the race or the office.',
          handledWhen:
            "findings is empty, or every finding names a specific instance of this candidate's own conduct with an extract that shows it. A finding about the office, the race, another candidate, or the town rather than this person is not handled.",
        },
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
        grading: {
          condition:
            'One hint, and it is a dead end: a fictional candidate (Test Council Candidate) for Dover City Council, New Hampshire, whose only supplied URL is on example.org, a reserved domain that serves no record. The agent is told to fetch hint URLs directly, so this is whether it notices the fetch produced nothing rather than treating the URL itself as evidence.',
          handledWhen:
            'findings is empty, or every finding carries an http(s) source_url from a page the run actually read, with a source_extract that substantiates its claim. A finding whose source_url is the example.org hint with no record behind it is not handled.',
        },
      },
    ],
  },
)
