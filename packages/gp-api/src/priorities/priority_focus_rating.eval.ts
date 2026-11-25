import { defineExpectedResultEvalSuite } from '@goodparty_org/judge'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { GeminiService } from '@/vendors/google/services/gemini.service'
import {
  FOCUS_RATING_MODEL,
  FocusRatingsSchema,
  focusRatingSearchPrompt,
  focusRatingStructuredPrompt,
  type FocusRatingIssue,
  type FocusRatingPlace,
} from './services/priorityFocusRating.service'

// The rating a winner's welcome cards get for what they ran on: the two
// prompts and the schema PriorityFocusRatingService sends, against the real
// model. The judgment is the first win each issue got, which the design's
// rubric decides by who has to say yes, and whether every issue came back
// rated with a recap phrase, since a card may never show a blank.
//
// Every place and issue below is invented, so no local source exists and each
// rating is the model's estimate. omni is public: never commit a real
// official's issues here.
//
// The only model calls are the rating's own, so a run needs GEMINI_API_KEY
// and no JUDGE_MODEL. Run it with
// `npm run eval -w packages/gp-api -- priority_focus_rating`.

type RatingInput = { place: FocusRatingPlace; issues: FocusRatingIssue[] }

type RatingJudgment = {
  firstWins: Record<string, string>
  everyIssueHasARecapPhrase: boolean
}

export default defineExpectedResultEvalSuite('priority_focus_rating', {
  run: async ({ place, issues }: RatingInput, ctx) => {
    const gemini = new GeminiService(createMockLogger())
    const search = await gemini.generateWithSearch(
      focusRatingSearchPrompt(place, issues),
      { model: FOCUS_RATING_MODEL },
    )
    await ctx.annotate(search.text, 'search')
    const { ratings } = await gemini.generateStructured(
      focusRatingStructuredPrompt(place, issues, search.text),
      FocusRatingsSchema,
      { model: FOCUS_RATING_MODEL },
    )
    await ctx.annotate(JSON.stringify(ratings), 'ratings')
    return ratings
  },
  judge: async (ratings, { input }): Promise<RatingJudgment> => ({
    firstWins: Object.fromEntries(
      ratings.map((rating) => [rating.id, rating.first_win]),
    ),
    everyIssueHasARecapPhrase: input.issues.every((issue) =>
      ratings.some(
        (rating) =>
          rating.id === issue.id && rating.recap_line.trim().length > 0,
      ),
    ),
  }),
  cases: [
    {
      id: 'city-council',
      input: {
        place: {
          office: 'Quillhaven City Council',
          jurisdiction: 'Quillhaven, MN',
          officeLevel: 'local',
          districtIssues: ['Road repair', 'Housing costs', 'Public safety'],
        },
        issues: [
          {
            id: 'p1',
            title: 'Hold a public hearing on downtown parking',
            description:
              'Ask the council to schedule a public hearing on the two-hour parking limit downtown.',
          },
          {
            id: 'p2',
            title: 'License short-term rentals',
            description:
              'The city has no rules for short-term rentals. Write and pass a new ordinance that licenses them.',
          },
          {
            id: 'p3',
            title: 'Rebuild the Mill Street bridge',
            description:
              'The state owns the Mill Street bridge. It is closed and needs state funding and construction to reopen.',
          },
        ],
      },
      expected: {
        firstWins: { p1: 'weeks', p2: 'months', p3: 'year_or_more' },
        everyIssueHasARecapPhrase: true,
      },
    },
    {
      id: 'school-board',
      input: {
        place: {
          office: 'Quillhaven School Board',
          jurisdiction: 'Quillhaven School District, MN',
          officeLevel: 'local',
          districtIssues: [],
        },
        issues: [
          {
            id: 'p1',
            title: 'Put the reading curriculum on the next agenda',
            description:
              'Ask the board chair to add a public review of the reading curriculum to the next board meeting.',
          },
          {
            id: 'p2',
            title: 'Build a new elementary school',
            description:
              'The east side needs a new elementary school, paid for by a bond that voters must approve.',
          },
        ],
      },
      expected: {
        firstWins: { p1: 'weeks', p2: 'year_or_more' },
        everyIssueHasARecapPhrase: true,
      },
    },
  ],
})
