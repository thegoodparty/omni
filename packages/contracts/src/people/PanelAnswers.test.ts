import { describe, expect, it } from 'vitest'
import { MAX_LIST_SAMPLE_SIZE } from './ListSample.schema'
import {
  panelExpectedAnswers,
  panelGoalMembers,
  panelSeedSampleSize,
  PANEL_SEED_SAMPLE_SIZE,
} from './PanelAnswers'
import { PANEL_SEED_ASSUMED_JOIN_RATE } from '../outreach/CivicPanelJoin'
import { answersNeeded } from '../outreach/AnswersNeeded.const'

describe('panelGoalMembers', () => {
  it('is the members it takes to give the answers needed', () => {
    expect(panelGoalMembers(100)).toBe(250)
    expect(panelGoalMembers(15)).toBe(38)
    expect(panelGoalMembers(answersNeeded())).toBe(250)
  })
})

describe('panelExpectedAnswers', () => {
  it('is members at the panel reply rate, rounded', () => {
    expect(panelExpectedAnswers(0)).toBe(0)
    expect(panelExpectedAnswers(61)).toBe(24)
    expect(panelExpectedAnswers(250)).toBe(100)
  })
})

describe('panelSeedSampleSize', () => {
  it('texts enough residents to reach the goal at the join rate', () => {
    expect(panelSeedSampleSize(230)).toBe(7667)
    expect(PANEL_SEED_SAMPLE_SIZE).toBe(8334)
    expect(
      PANEL_SEED_SAMPLE_SIZE * PANEL_SEED_ASSUMED_JOIN_RATE,
    ).toBeGreaterThanOrEqual(panelGoalMembers(answersNeeded()))
  })

  it('stays under the sampler ceiling', () => {
    expect(panelSeedSampleSize(1_000)).toBe(MAX_LIST_SAMPLE_SIZE)
  })
})
