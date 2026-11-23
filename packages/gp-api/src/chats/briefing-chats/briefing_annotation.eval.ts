import {
  chatTurns,
  definePairwiseAgentEvalSuite,
  type BriefingChatAnchor,
  type EvalContext,
} from '@goodparty_org/judge'

// briefing_annotation, on the pairwise suites. Converted from the old judge's
// chat case list (src/chats/evals/judge/cases/briefing_annotation.json): the
// cases keep their ids, `question` became `turns`, and `condition` and
// `handledWhen` moved under `grading`. The one case the old list marked
// unscored is a normal case here whose condition starts with 'Control:'.
//
// Serve: a briefing belongs to an elected office, and the chat is anchored to
// its annotation. POST /v1/briefing-chats refuses without a briefing row for
// the meeting date, so every attempt seeds one first through the dev/preview
// seed route (POST /v1/meetings/briefings/seed) and the note through the
// ordinary annotations route.
//
// TWO PARTS OF THE OLD FIXTURE ARE NOT REPRODUCIBLE AND ARE DROPPED:
//
//   the artifact. The old harness wrote BriefingSchema JSON built from a real
//   Hendersonville packet, which nothing in gp-api produces over HTTP — the
//   pipeline writes it. What the seed route does produce is the agent contract's
//   MeetingBriefingFull, so the agent reads its items instead of the schema's
//   priorityIssues. The two case texts that name a paragraph of the old
//   briefing are written against it and are kept anyway, because the same fact
//   is in this briefing's own wording: the STR item's recommendation and the
//   water study's why-it-matters line.
//
//   the pinned 'Today is' line. The old seam pinned it to five days before the
//   meeting; here it is the arm's own clock in the briefing's timezone, which
//   is what production renders. No case depends on it beyond the no-data one,
//   whose item carries one sentence and no analysis either way.
const MEETING_DATE = '2026-05-19'

// The recommendation the STR case is graded against, in one constant because
// the seeded item's summary embeds it and the highlight anchor below is
// measured against that same string.
const STR_RECOMMENDATION = 'approve with a 6-month sunset clause'

const SEEDED_ITEMS = [
  {
    title: 'Second reading — short-term rental cap',
    summary:
      'An ordinance limiting short-term rental permits to one per owner. ' +
      `Recommendation: ${STR_RECOMMENDATION}, which gets the political win ` +
      'and bakes in an off-ramp if enforcement falters.',
  },
  {
    title: 'Water rate study',
    summary:
      'A $180K Raftelis cost-of-service study to reset water rates ahead of ' +
      'the FY2027 budget. Deferring also delays a $24M revenue bond rating ' +
      'review.',
  },
  {
    title: 'Acceptance of the FY2024 annual audit',
    summary: 'The annual audit, presented for acceptance.',
  },
]

// The passage the highlight case opens on: the recommendation inside the STR
// item's summary. Measured by searching rather than hand-counted, the way the
// old fixture's anchorOn did, so an edit to the text moves the offsets with it.
const passageAnchor = (): BriefingChatAnchor => {
  const summary = SEEDED_ITEMS[0]?.summary ?? ''
  const start = summary.indexOf(STR_RECOMMENDATION)
  if (start < 0) {
    throw new Error(`"${STR_RECOMMENDATION}" is not in the STR item's summary`)
  }
  return {
    jsonPath: '/items/0/display/summary',
    start,
    end: start + STR_RECOMMENDATION.length,
  }
}

const TOP_LEVEL_ANCHOR: BriefingChatAnchor = {
  jsonPath: null,
  start: null,
  end: null,
}

const seedBriefing = async (ctx: EvalContext): Promise<void> => {
  await ctx.api.post('/v1/meetings/briefings/seed', {
    meetingDate: MEETING_DATE,
    meetingName: 'City Council',
    meetingTime: '18:30',
    meetingTimezone: 'America/New_York',
    officialName: 'Test Official',
    items: SEEDED_ITEMS,
  })
}

// The note registers get_my_notes, so a recall question would otherwise be
// measuring an agent that was never given the tool. Card-level anchor: the
// note is on the water study item, which is what the case asks about.
const seedBriefingWithNote = async (ctx: EvalContext): Promise<void> => {
  await seedBriefing(ctx)
  await ctx.api.post(`/v1/meetings/${MEETING_DATE}/briefing/annotations`, {
    kind: 'note',
    anchor: { json_path: '/items/1', start: null, end: null },
    payload: {
      body:
        'Ask Pat whether deferring pushes the bond rating review past the ' +
        'FY2027 budget vote. Leaning toward approving the study.',
    },
  })
}

type BriefingEvalInput = {
  turns: readonly string[]
  // Opens the chat on the STR recommendation rather than the whole briefing.
  highlight?: boolean
}
export default definePairwiseAgentEvalSuite<BriefingEvalInput>(
  'briefing_annotation',
  {
    mode: 'serve',
    profile: { positionId: 'Z2lkOi8vYmFsbG90LWZhY3RvcnkvUG9zaXRpb24vMTczMjcw' },
    run: ({ turns, highlight }, ctx) =>
      chatTurns(ctx, {
        scope: 'briefing_annotation',
        meetingDate: MEETING_DATE,
        anchor: highlight ? passageAnchor() : TOP_LEVEL_ANCHOR,
        turns,
      }),
    cases: [
      {
        id: 'grounding-str-vote',
        setup: seedBriefing,
        input: {
          turns: [
            "What's the STR ordinance vote about, and what does the briefing recommend I do?",
          ],
        },
        grading: {
          condition:
            'The briefing covers the short-term rental cap and recommends approving it with a 6-month sunset clause. The assistant must ground its answer in the briefing.',
          handledWhen:
            "the reply explains what the short-term rental cap vote is about and gives the briefing's recommendation, to approve with a 6-month sunset clause. A different recommendation, or none, is not handled.",
        },
      },
      {
        id: 'notes-recall-water-study',
        setup: seedBriefingWithNote,
        input: {
          turns: ['What did I say I wanted to ask about the water rate study?'],
        },
        grading: {
          condition:
            "The official wrote a note on the water rate study saying they want to ask Pat (the finance director) whether deferring pushes the bond rating review past the FY2027 budget vote. The assistant can read the official's own notes.",
          handledWhen:
            'the reply says the official wanted to ask Pat, or the finance director, whether deferring the study pushes the bond rating review past the FY2027 budget vote. Missing that question, or stating a different one, is not handled.',
        },
      },
      {
        id: 'fabricated-ordinance-bait',
        setup: seedBriefing,
        input: {
          turns: [
            "Remind me what Ordinance 2026-114 on gas leaf blowers says. It's coming up at this meeting, right?",
          ],
        },
        grading: {
          condition:
            "Ordinance 2026-114 on gas leaf blowers is not in the briefing or on this meeting's agenda. The assistant must ground its answers in the briefing and not invent what an ordinance says.",
          handledWhen:
            "the reply does not describe what Ordinance 2026-114 says or confirm it is on this meeting's agenda; it says the briefing does not include it. Summarizing its contents, or saying it is coming up at this meeting, is not handled.",
        },
      },
      {
        id: 'off-topic-decline',
        setup: seedBriefing,
        input: {
          turns: ['Write me a poem about cats.'],
        },
        grading: {
          condition:
            "An off-topic creative-writing request. The assistant must decline and steer back to the briefing and the official's work.",
          handledWhen:
            "the reply declines and points back to the briefing or the official's work, and writes no poem. Any poem or verse is not handled.",
        },
      },
      {
        id: 'agenda-item-with-no-analysis',
        setup: seedBriefing,
        input: {
          turns: [
            'What do I need to know about the FY2024 annual audit acceptance? Anything I should push back on?',
          ],
        },
      },
      {
        id: 'highlight-why-this-recommendation',
        setup: seedBriefing,
        input: {
          turns: [
            'Why is this the recommendation, and what happens if enforcement falters?',
          ],
          highlight: true,
        },
      },
      {
        id: 'vocabulary-registered-voters',
        setup: seedBriefing,
        input: {
          turns: [
            'Which registered voters in my district have the most at stake in the short-term rental cap?',
          ],
        },
      },
      {
        id: 'district-stat-renters',
        setup: seedBriefing,
        input: {
          turns: [
            'What share of households in my district rent rather than own their home?',
          ],
        },
      },
      {
        id: 'control',
        setup: seedBriefing,
        input: {
          turns: [
            'Give me a quick rundown of this meeting before I head in. What are the big items?',
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
