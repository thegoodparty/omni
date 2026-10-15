import { describe, expect, it } from 'vitest'
import { MAX_LIST_SAMPLE_SIZE } from './ListSample.schema'
import {
  answersNeeded,
  panelExpectedAnswers,
  panelGoalMembers,
  panelSeedSampleSize,
  PANEL_SEED_SAMPLE_SIZE,
  sizePanelAsk,
} from './PanelAnswers'
import { PANEL_SEED_ASSUMED_JOIN_RATE } from '../outreach/CivicPanelJoin'

describe('answersNeeded', () => {
  it('is about 96 for a city', () => {
    expect(answersNeeded(105_154)).toBe(96)
    expect(answersNeeded(10_000_000)).toBe(96)
  })

  it('corrects for a small town', () => {
    expect(answersNeeded(2_000)).toBe(92)
    expect(answersNeeded(200)).toBe(65)
  })

  it('falls back to the uncorrected 96 without a population', () => {
    expect(answersNeeded(null)).toBe(96)
    expect(answersNeeded(undefined)).toBe(96)
    expect(answersNeeded(0)).toBe(96)
    expect(answersNeeded(Number.NaN)).toBe(96)
  })
})

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

describe('sizePanelAsk', () => {
  const ask = (panelCanAsk: number, freshCanReach = 50_000) =>
    sizePanelAsk({ answersNeeded: 96, panelCanAsk, freshCanReach })

  it('asks fresh residents alone with no panel', () => {
    expect(ask(0)).toEqual({
      answersNeeded: 96,
      panelSize: 0,
      freshSize: 3200,
      sampleSize: 3200,
      expectedAnswers: 96,
    })
  })

  it('makes up what a small panel cannot give', () => {
    const size = ask(50)
    expect(size.panelSize).toBe(50)
    expect(size.freshSize).toBe(2534)
    expect(size.expectedAnswers).toBeGreaterThanOrEqual(96)
  })

  it('keeps inviting as many new residents as members once the panel answers alone', () => {
    expect(ask(240)).toMatchObject({
      panelSize: 240,
      freshSize: 240,
      sampleSize: 480,
      expectedAnswers: 103.2,
    })
  })

  it('leaves members past the answers needed rested', () => {
    expect(ask(400)).toMatchObject({ panelSize: 240, freshSize: 240 })
  })

  it('never asks more fresh residents than it can reach', () => {
    expect(ask(50, 1_000)).toMatchObject({
      freshSize: 1_000,
      expectedAnswers: 50,
    })
  })

  it('stays under the sampler ceiling', () => {
    const size = sizePanelAsk({
      answersNeeded: 400,
      panelCanAsk: 0,
      freshCanReach: 50_000,
    })
    expect(size.sampleSize).toBe(MAX_LIST_SAMPLE_SIZE)
  })
})
