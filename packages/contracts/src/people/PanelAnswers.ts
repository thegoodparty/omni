import { MAX_LIST_SAMPLE_SIZE } from './ListSample.schema'
import { DEFAULT_TEXT_REPLY_RATE } from '../outreach/SampleSizing.const'
import {
  PANEL_ASSUMED_REPLY_RATE,
  PANEL_SEED_ASSUMED_JOIN_RATE,
} from '../outreach/CivicPanelJoin'

// Everything the civic panel sizes targets answers to one question, not
// members (Bryan, 2026-10-15): enough to read a question within 10 points
// either way, 95 times in 100, when residents split about evenly.
export const ANSWERS_MARGIN_OF_ERROR = 0.1
export const ANSWERS_CONFIDENCE_Z = 1.96
// An even split is the worst case, so it sizes for every other split too.
export const ANSWERS_ASSUMED_SPLIT = 0.5

// The sample size for an unlimited population: 1.96² × 0.25 / 0.1² ≈ 96.04.
const UNCORRECTED_ANSWERS =
  (ANSWERS_CONFIDENCE_Z ** 2 *
    ANSWERS_ASSUMED_SPLIT *
    (1 - ANSWERS_ASSUMED_SPLIT)) /
  ANSWERS_MARGIN_OF_ERROR ** 2

// Rounded to six places first so float noise (96 / 0.4) never asks one more
// person than the math says.
const ceilClean = (value: number): number => Math.ceil(Number(value.toFixed(6)))

// The answers one question needs from a district of `population` people,
// with the finite population correction: n0 / (1 + (n0 - 1) / N), rounded.
// About 96 for any district of a few thousand or more. Without a census
// population (null, or not a positive number), the uncorrected 96.
export const answersNeeded = (
  population: number | null | undefined,
): number => {
  if (!population || !Number.isFinite(population) || population <= 0) {
    return Math.round(UNCORRECTED_ANSWERS)
  }
  return Math.round(
    UNCORRECTED_ANSWERS / (1 + (UNCORRECTED_ANSWERS - 1) / population),
  )
}

// The members a panel needs so that asking all of them brings back the
// answers a question needs: ceil(answersNeeded / PANEL_ASSUMED_REPLY_RATE),
// about 240.
export const panelGoalMembers = (
  population: number | null | undefined,
): number => ceilClean(answersNeeded(population) / PANEL_ASSUMED_REPLY_RATE)

// The answers a panel of this many members is expected to give one question.
export const panelExpectedAnswers = (members: number): number =>
  Math.round(members * PANEL_ASSUMED_REPLY_RATE)

export type PanelAskSize = {
  answersNeeded: number
  // Rested panel members to ask. 0 when there are none.
  panelSize: number
  // Residents not on the panel, asked the question and asked to join.
  freshSize: number
  // panelSize + freshSize, the whole send.
  sampleSize: number
  // panelSize × PANEL_ASSUMED_REPLY_RATE + freshSize × DEFAULT_TEXT_REPLY_RATE,
  // to one decimal.
  expectedAnswers: number
}

// One priority ask: the rested panel plus a fresh sample, sized so the
// answers expected reach answersNeeded.
// - The panel part is every member who can be asked, up to the members it
//   takes to bring back answersNeeded on their own. The rest stay rested.
// - The fresh sample makes up the answers the panel cannot, at the cold text
//   reply rate, capped by who it can reach and the sampler's ceiling.
// - It never drops below the panel part: every ask also invites at least as
//   many new residents to join as it asks members, so the panel keeps
//   growing even once it can answer on its own.
export const sizePanelAsk = (input: {
  answersNeeded: number
  panelCanAsk: number
  freshCanReach: number
}): PanelAskSize => {
  const needed = input.answersNeeded
  const panelSize = Math.max(
    0,
    Math.min(
      input.panelCanAsk,
      ceilClean(needed / PANEL_ASSUMED_REPLY_RATE),
      MAX_LIST_SAMPLE_SIZE - 1,
    ),
  )
  const missing = needed - panelSize * PANEL_ASSUMED_REPLY_RATE
  const forAnswers =
    missing > 0 ? ceilClean(missing / DEFAULT_TEXT_REPLY_RATE) : 0
  const freshSize = Math.max(
    0,
    Math.min(
      Math.max(forAnswers, panelSize),
      input.freshCanReach,
      MAX_LIST_SAMPLE_SIZE - panelSize,
    ),
  )
  const expected =
    panelSize * PANEL_ASSUMED_REPLY_RATE + freshSize * DEFAULT_TEXT_REPLY_RATE
  return {
    answersNeeded: needed,
    panelSize,
    freshSize,
    sampleSize: panelSize + freshSize,
    expectedAnswers: Math.round(expected * 10) / 10,
  }
}

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
