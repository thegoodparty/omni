import { MAX_LIST_SAMPLE_SIZE } from './ListSample.schema'
import {
  answersNeeded,
  MIN_VOICES_PER_GROUP,
} from '../outreach/AnswersNeeded.const'
import {
  PANEL_ASSUMED_REPLY_RATE,
  PANEL_SEED_ASSUMED_JOIN_RATE,
} from '../outreach/CivicPanelJoin'

// The civic panel is sized so every major group is expected to answer one
// question three times: the district's answersNeeded, over the answer rate.

// Rounded to six places first so float noise (100 / 0.4) never asks one
// more person than the math says.
const ceilClean = (value: number): number => Math.ceil(Number(value.toFixed(6)))

// The members a panel needs so that asking all of them brings back the
// answers a question needs: ceil(answers / PANEL_ASSUMED_REPLY_RATE), 250
// at most.
export const panelGoalMembers = (answers: number): number =>
  ceilClean(answers / PANEL_ASSUMED_REPLY_RATE)

// The members a group needs on the panel to expect three answers to one
// question. A group with this many is covered.
export const PANEL_MEMBERS_PER_GROUP = ceilClean(
  MIN_VOICES_PER_GROUP / PANEL_ASSUMED_REPLY_RATE,
)

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

// The invite size where the district's mix is not at hand (the outreach
// page's own panel invite): sized for the largest goal, 8,334.
export const PANEL_SEED_SAMPLE_SIZE = panelSeedSampleSize(
  panelGoalMembers(answersNeeded()),
)
