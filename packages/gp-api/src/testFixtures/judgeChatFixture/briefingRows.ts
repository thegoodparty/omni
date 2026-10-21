import type { BriefingChatAnchor } from '@/chats/briefing-chats/services/briefingChatCreate.service'

// THE MEETING BRIEFING ROWS the judge's briefing_annotation fixture writes,
// and the anchors that point into the artifact it names.
//
// Split out of the eval harness's briefingFixture.ts, which keeps the
// artifact itself: the artifact is served by a seam that only ever runs
// in-process, while these are columns on rows a DEPLOYED arm has to be able
// to ask for over HTTP. `src/chats/evals/**` is excluded from the production
// build, so the seeder cannot read them from there.
//
// The two passage strings below are the single source: the artifact embeds
// them and the anchors are located by searching within them, so an edit moves
// the offsets rather than silently highlighting the wrong words.
//
// FIXED, like everything else the seeder writes. Both arms must render the
// same system prompt when the branch changed nothing the agent can see, or
// every configDigest differs and the identical-config refusal is disarmed.

// A bucket nothing in any deployment writes to. The artifact seam in
// chatSeam.ts answers reads of it, and only of it.
export const JUDGE_BRIEFING_BUCKET = 'judge-fixture-briefings'

export const judgeBriefingKey = (organizationSlug: string): string =>
  `judge-fixture/${organizationSlug}/briefing.json`

export const JUDGE_MEETING_DATE = '2026-05-19'
export const JUDGE_MEETING_TIME = '6:30 PM'
export const JUDGE_MEETING_TIMEZONE = 'America/New_York'

// Exported so the eval harness's artifact embeds the SAME bytes the anchors
// below are measured against.
export const STR_RECOMMENDATION =
  'Approve with the sunset clause. Gets the political win and bakes in an ' +
  'off-ramp if enforcement falters.'

export const WATER_WHY_IT_MATTERS =
  'Without the study, the council will be setting rates blind during the ' +
  'FY2027 budget. Deferring also delays a $24M revenue bond rating review.'

// A passage anchor, located by searching rather than hand-counted, so an
// edit to the text above moves the offsets with it instead of silently
// highlighting the wrong words.
const anchorOn = (
  jsonPath: string,
  node: string,
  phrase: string,
): BriefingChatAnchor => {
  const start = node.indexOf(phrase)
  if (start < 0) {
    throw new Error(`"${phrase}" is not in the text at ${jsonPath}`)
  }
  return { jsonPath, start, end: start + phrase.length }
}

export const TOP_LEVEL_ANCHOR: BriefingChatAnchor = {
  jsonPath: null,
  start: null,
  end: null,
}

// The passage a `briefingHighlight` case opens its chat on: the
// recommendation on the short-term-rental vote.
export const JUDGE_HIGHLIGHT_ANCHOR = anchorOn(
  '/priorityIssues/0/detail/recommendation',
  STR_RECOMMENDATION,
  'Approve with the sunset clause.',
)

// The one note the seeded official has written on this briefing. A note on
// the briefing is what registers get_my_notes, so without it a recall
// question would measure an agent that was never given the tool.
export const JUDGE_NOTE = {
  anchor: anchorOn(
    '/priorityIssues/1/detail/whyItMatters',
    WATER_WHY_IT_MATTERS,
    '$24M revenue bond rating review',
  ),
  body:
    'Ask Pat whether deferring pushes the bond rating review past the ' +
    'FY2027 budget vote. Leaning toward approving the study.',
}
