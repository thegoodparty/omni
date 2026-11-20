import {
  chatTurns,
  definePairwiseAgentEvalSuite,
  type EvalContext,
} from '@goodparty_org/judge'

// What a case supplies: its turns. The scope is the suite's, not a case's.
type CampaignAssistantEvalInput = { turns: readonly string[] }

// campaign_assistant, on the pairwise suites. Converted from the old judge's
// chat case list (src/chats/evals/judge/cases/campaign_assistant.json): the
// cases keep their ids, `question` became `turns`, and `condition` and
// `handledWhen` moved under `grading`. The one case the old list marked
// unscored is a normal case here whose condition starts with 'Control:'.
//
// Win: the assistant answers a candidate about their own campaign. The race on
// record and the filing window are what three of these cases are graded
// against, and the arm's bootstrap creates a campaign, not these details — so
// every case writes them through PUT /v1/campaigns/mine first. The values are
// the old harness's own (seedChatOrg.ts JUDGE_CAMPAIGN_DETAILS, field for
// field), because the case text was authored against them: Judge City, WA,
// District 1, filing May 10 to May 21 2027. One difference from the old seed
// is unavoidable and the cases already allow for it: `raceId` there was a
// synthetic 'judge-race-1', which registers get_ballot_requirements and then
// resolves nothing, so a ballot-access answer is graded on how it handles a
// requirement it cannot look up rather than on a real filing rule.
const CAMPAIGN_DETAILS = {
  normalizedOffice: 'City Council',
  ballotLevel: 'CITY',
  district: 'District 1',
  state: 'WA',
  city: 'Judge City',
  electionDate: '2027-11-02',
  primaryElectionDate: '2027-08-03',
  filingPeriodsStart: '2027-05-10',
  filingPeriodsEnd: '2027-05-21',
  raceId: 'judge-race-1',
}

// Through the product's own routes, never a row: the details the cases read
// off the record, and the Pro flag the voter-file family registers on. The Pro
// flip is the test-only route, which refuses unless the caller is a test user
// on a non-prod deploy — which every arm of a pairwise run is.
const setupCampaign = async (ctx: EvalContext): Promise<void> => {
  await ctx.api.put('/v1/campaigns/mine', { details: CAMPAIGN_DETAILS })
  await ctx.api.post('/v1/campaigns/mine/test-set-pro', {})
}

export default definePairwiseAgentEvalSuite<CampaignAssistantEvalInput>(
  'campaign_assistant',
  {
    mode: 'win',
    profile: { firstName: 'Robin', lastName: 'Calloway' },
    run: ({ turns }, ctx) =>
      chatTurns(ctx, { scope: 'campaign_assistant', turns }),
    cases: [
      {
        id: 'baseline-where-do-i-start',
        setup: setupCampaign,
        input: {
          turns: [
            "I just signed up and I'm not sure what to do first. Where should I start?",
          ],
        },
        grading: {
          condition:
            "A new candidate asks where to start. Their Campaign Story is unstarted (why they are running, their background and their positions are all missing), there are no tracker tasks yet, and the race on record is City Council, District 1, in Judge City, WA, with a filing period of May 10 to May 21, 2027. The assistant's job is judgment and sequencing: name the two or three things that matter most right now and move the candidate into the work, which for an unstarted Campaign Story means asking its first question.",
          handledWhen:
            'the reply names no more than about three first steps that fit this campaign (such as the unstarted Campaign Story or the filing period on record) and starts the first one in this same reply by asking the candidate a question they can answer now, such as the first Campaign Story question (why they are running). Naming steps without asking the question that starts one, or generic campaign advice, is not handled.',
        },
      },
      {
        id: 'signature-count-one-right-answer',
        setup: setupCampaign,
        input: {
          turns: [
            'How many signatures do I need on my petition, and when is the deadline to turn them in?',
          ],
        },
        grading: {
          condition:
            "Petition signature counts and filing deadlines are set per state, office and district, and the assistant does not know them from memory. The race on record is City Council, District 1, in Judge City, WA, and its filing period on record runs May 10 to May 21, 2027, so the deadline is on the record. A signature count is not: it has to come from the race's filing requirements or a source the assistant finds. It may only state a requirement it can attribute to the race record or a source it found.",
          handledWhen:
            "the reply gives the filing deadline from the race record (the filing period closes May 21, 2027) and says where it came from; for signatures it either states the requirement (a count, or that no petition is needed) with the named source, or names where it looked (such as BallotReady's requirements for this race or a state or county elections page) and says no count was there; and it says to confirm with the local elections office. Missing the record's deadline, or a figure with no source, is not handled.",
        },
      },
      {
        id: 'compliance-question-to-redirect',
        setup: setupCampaign,
        input: {
          turns: ['Am I allowed to robocall everyone in my voter list?'],
        },
        grading: {
          condition:
            'A legal compliance question about robocalls. The assistant must not tell the candidate they are legally cleared on its own authority, and any substantive answer to a legal question must carry a line that it is not legal advice. GoodParty offers robocalls as a Voter Outreach channel, sent to a saved voter list; that is a product fact, not a legal clearance. A good answer separates the two, names what the legal answer turns on, and gives a next step that does not depend on it.',
          handledWhen:
            'the reply does not say robocalling their whole list is legal or allowed; names at least one specific legal point the answer turns on (such as consent rules for automated calls to cell phones, or state limits on robocalls); says what GoodParty itself offers for robocalls, kept apart from the law; and includes a line that this is not legal advice and to confirm with legal counsel or the relevant authority. Saying they are cleared, a caution that only says rules vary and to ask a lawyer, or a reply missing any of these parts, is not handled.',
        },
      },
      {
        id: 'product-how-to-from-the-map',
        setup: setupCampaign,
        input: {
          turns: ['How do I build a voter list to text from inside GoodParty?'],
        },
        grading: {
          condition:
            'A product question about GoodParty.org itself. The assistant answers from its product map and must never point the candidate to an outside tool for something GoodParty does, such as voter lists or texting. In GoodParty a list is built in Voter Data with Create new list and its filters (such as voter likelihood, party, age, phone on file and precinct), and a saved list reaches a text through Send outreach on the list or as who to reach in Voter Outreach. The campaign has Pro, so the assistant can also count voters and offer a list in this chat.',
          handledWhen:
            'the reply walks through building the list inside GoodParty by its real place and controls (Voter Data, Create new list, at least one named filter), says how the saved list becomes the audience for a text (Send outreach on the list, or picking it as who to reach in Voter Outreach), and offers to build or count the list with the candidate in this chat. Recommending an outside tool, declining the question, or a pointer to a page with no steps is not handled.',
        },
      },
      {
        id: 'ballot-access-for-the-seeded-race',
        setup: setupCampaign,
        input: {
          turns: ['How do I get on the ballot for my race?'],
        },
      },
      {
        id: 'voter-filters-with-pro',
        setup: setupCampaign,
        input: {
          turns: ['What can I filter voters by? Just curious.'],
        },
      },
      {
        id: 'judgement-weekly-focus',
        setup: setupCampaign,
        input: {
          turns: ['What should I focus on this week to win?'],
        },
      },
      {
        id: 'vague-still-deciding',
        setup: setupCampaign,
        input: {
          turns: ['I am not sure yet if I want to run. What would it take?'],
        },
      },
      {
        id: 'control',
        setup: setupCampaign,
        input: {
          turns: [
            "Help me write a short introduction I can use when I knock on a voter's door.",
          ],
        },
        grading: {
          condition:
            'Control: the old list marked this case unscored, so a difference reported here is one called with nothing to find.',
        },
      },
    ],
  },
)
