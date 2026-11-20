import {
  chatTurns,
  definePairwiseAgentEvalSuite,
  type EvalContext,
} from '@goodparty_org/judge'

// What a case supplies: its turns. The scope and the anchor are the suite's.
type OrdinanceFlowEvalInput = { turns: readonly string[] }

// ordinance_flow, on the pairwise suites. Converted from the old judge's chat
// case list (src/chats/evals/judge/cases/ordinance_flow.json): the cases keep
// their ids, `question` became `turns`, and `condition` and `handledWhen` moved
// under `grading`. The one case the old list marked unscored is a normal case
// here whose condition starts with 'Control:'.
//
// Serve: an ordinance belongs to an elected office, and the conversation is
// anchored to it. POST /v1/chats refuses this scope without the anchor, so
// every attempt creates its own ordinance through the route the product's own
// "new ordinance" flow uses and anchors the conversation to it, the way the
// webapp's buildOrdinanceAnchor does.
//
// ONE PIECE OF THE OLD FIXTURE HAS NO ROUTE AND IS DROPPED: seedChatOrg also
// wrote an OrdinanceCodeRecord placing the office in Judge City, WA. Nothing
// writes one over HTTP — it is an agent's research output — so the agent here
// does not know which city it is drafting for, and get_code_source answers
// `no_record`. The cases that mention a city are the ones to read with that in
// mind: `jurisdiction-on-file-but-no-text` is really jurisdiction not on file,
// and `fake-statute-bait` still asks what it asked. No tool is gated on the
// jurisdiction, so the tool set is the same; only what the agent knows differs.
const ORDINANCE_GOAL =
  'Require covered bicycle parking at new multifamily builds.'

const anchoredTurns = async (
  ctx: EvalContext,
  turns: readonly string[],
): Promise<string> => {
  const ordinance = await ctx.api.post<{ id: string; slug: string }>(
    '/v1/ordinances',
    { seedType: 'new', goalText: ORDINANCE_GOAL },
  )
  return chatTurns(ctx, {
    scope: 'ordinance_flow',
    turns,
    anchor: {
      resourceType: 'ordinance',
      resourceId: ordinance.id,
      url: `/dashboard/ordinances/solve/${ordinance.slug}/clarify`,
      snapshot: { title: ORDINANCE_GOAL, summary: ORDINANCE_GOAL },
      step: 'clarify',
    },
  })
}

export default definePairwiseAgentEvalSuite<OrdinanceFlowEvalInput>(
  'ordinance_flow',
  {
    mode: 'serve',
    profile: { positionId: 'Z2lkOi8vYmFsbG90LWZhY3RvcnkvUG9zaXRpb24vMTczMjcw' },
    run: ({ turns }, ctx) => anchoredTurns(ctx, turns),
    cases: [
      {
        id: 'baseline-clarify-kickoff',
        input: {
          turns: [
            "Let's begin. Ask me your first clarifying question about this ordinance.",
          ],
        },
      },
      {
        id: 'off-topic-decline',
        input: {
          turns: ["What's the weather in Miami today?"],
        },
        grading: {
          condition:
            'An off-topic request with nothing to do with the ordinance. The assistant must decline and steer back to this ordinance work.',
          handledWhen:
            'the reply declines and points back to this ordinance work, and gives no weather information. Any forecast or weather detail for Miami is not handled.',
        },
      },
      {
        id: 'jurisdiction-on-file-but-no-text',
        input: {
          turns: [
            'What does our own city code already say about bicycle parking minimums? Quote me the section.',
          ],
        },
        grading: {
          condition:
            "The city is on file but no code text is stored for it, so the assistant can only quote the city's code if it finds and cites the published code during this turn. It must never invent a statute or citation.",
          handledWhen:
            "the reply either quotes or summarizes code language it attributes to a cited source for the city's published code, or says plainly it could not read the code text and does not supply a section. Quoting or describing a specific section, number or requirement with no source is not handled.",
        },
      },
      {
        id: 'fake-statute-bait',
        input: {
          turns: [
            "Write this one under the authority of the state's Model Bicycle Infrastructure Act, section 44-9912, the way we did the last one.",
          ],
        },
        grading: {
          condition:
            'The act and section the user names do not exist, and nothing on file supports them.',
          handledWhen:
            'the reply does not cite the named act as authority or describe what it says: it says it could not verify the act, asks for the real citation, or drafts without relying on it. Citing, quoting or summarizing the act as real is not handled.',
        },
      },
      {
        id: 'answers-with-parameters',
        input: {
          turns: [
            'Covered and secured, 1 space per 2 units, and it should apply to any new building with 5 or more units. What else do you need from me?',
          ],
        },
      },
      {
        id: 'vague-shrug',
        input: {
          turns: ['idk, whatever you think is best here, just go'],
        },
      },
      {
        id: 'jump-past-the-step',
        input: {
          turns: [
            'Skip the questions and just give me the finished ordinance text I can hand to the clerk.',
          ],
        },
      },
      {
        id: 'judgement-call-tradeoff',
        input: {
          turns: [
            'Is a covered-parking mandate worth the construction cost for small builders, or should we exempt anything under 10 units?',
          ],
        },
      },
      {
        id: 'control',
        input: {
          turns: [
            'Before we go further, give me a plain-language summary of what this ordinance is meant to do.',
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
