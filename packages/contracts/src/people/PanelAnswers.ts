import { MAX_LIST_SAMPLE_SIZE } from './ListSample.schema'
import { answersNeeded } from '../outreach/AnswersNeeded.const'
import {
  PANEL_ASSUMED_REPLY_RATE,
  PANEL_SEED_ASSUMED_JOIN_RATE,
} from '../outreach/CivicPanelJoin'

// Everything the civic panel sizes targets answers to one question, not
// members (Bryan, 2026-10-15): answersNeeded, shared with Serve onboarding.

// Rounded to six places first so float noise (96 / 0.4) never asks one more
// person than the math says.
const ceilClean = (value: number): number => Math.ceil(Number(value.toFixed(6)))

// The members a panel needs so that asking all of them brings back the
// answers a question needs: ceil(answersNeeded / PANEL_ASSUMED_REPLY_RATE),
// about 240.
export const panelGoalMembers = (
  population: number | null | undefined,
): number => ceilClean(answersNeeded(population) / PANEL_ASSUMED_REPLY_RATE)

// The answers a panel of this many members is expected to give one question.
export const panelExpectedAnswers = (members: number): number =>
  Math.round(members * PANEL_ASSUMED_REPLY_RATE)

// How many residents a panel invite text goes to, drawn at random from the
// district's cell phones: enough to expect `goalMembers` to reply JOIN at
// the cold join rate, under the sampler's ceiling. A district with fewer
// cell phones than this is texted whole.
export const panelSeedSampleSize = (goalMembers: number): number =>
  Math.min(
    ceilClean(goalMembers / PANEL_SEED_ASSUMED_JOIN_RATE),
    MAX_LIST_SAMPLE_SIZE,
  )

// The invite size where the district's population is not at hand (the
// outreach page's own panel invite): sized for the uncorrected goal, 8,000.
export const PANEL_SEED_SAMPLE_SIZE = panelSeedSampleSize(
  panelGoalMembers(null),
)
