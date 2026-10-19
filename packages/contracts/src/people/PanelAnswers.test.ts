import { describe, expect, it } from 'vitest'
import { MAX_LIST_SAMPLE_SIZE } from './ListSample.schema'
import {
  panelExpectedAnswers,
  panelGoalMembers,
  panelSeedSampleSize,
  PANEL_SEED_SAMPLE_SIZE,
} from './PanelAnswers'
import { PANEL_SEED_ASSUMED_JOIN_RATE } from '../outreach/CivicPanelJoin'

describe('panelGoalMembers', () => {
  it('is the members it takes to give the answers needed', () => {
    expect(panelGoalMembers(105_154)).toBe(240)
    expect(panelGoalMembers(2_000)).toBe(230)
    expect(panelGoalMembers(null)).toBe(240)
  })
})

describe('panelExpectedAnswers', () => {
  it('is members at the panel reply rate, rounded', () => {
    expect(panelExpectedAnswers(0)).toBe(0)
    expect(panelExpectedAnswers(61)).toBe(24)
    expect(panelExpectedAnswers(240)).toBe(96)
  })
})

describe('panelSeedSampleSize', () => {
  it('texts enough residents to reach the goal at the join rate', () => {
    expect(panelSeedSampleSize(230)).toBe(7667)
    expect(PANEL_SEED_SAMPLE_SIZE).toBe(8000)
    expect(
      PANEL_SEED_SAMPLE_SIZE * PANEL_SEED_ASSUMED_JOIN_RATE,
    ).toBeGreaterThanOrEqual(panelGoalMembers(null))
  })

  it('stays under the sampler ceiling', () => {
    expect(panelSeedSampleSize(1_000)).toBe(MAX_LIST_SAMPLE_SIZE)
  })
})
