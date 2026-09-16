import { describe, expect, it } from 'vitest'
import {
  flowStage,
  previousStage,
  stageStep,
  stepperPosition,
  type CreateFlowStage,
} from './createFlowSteps'

// The two pre-draw stages hide inside the orchestrator's single `filters`
// step. That is the whole trick — the page (#1380) starts a drawing session on
// exactly the filters → draw transition, so a stage the page never hears about
// is a step this flow can add on its own.
describe('flowStage / stageStep', () => {
  it('reads the page’s filters step as whichever pre-draw stage is showing', () => {
    expect(flowStage('filters', 'purpose')).toBe('purpose')
    expect(flowStage('filters', 'who')).toBe('who')
    expect(flowStage('draw', 'who')).toBe('draw')
    expect(flowStage('confirm', 'purpose')).toBe('confirm')
    expect(flowStage('route', 'purpose')).toBe('route')
  })

  it('reports every pre-draw stage back to the page as filters', () => {
    expect(stageStep('purpose')).toBe('filters')
    expect(stageStep('who')).toBe('filters')
    expect(stageStep('draw')).toBe('draw')
    expect(stageStep('confirm')).toBe('confirm')
    expect(stageStep('points')).toBe('points')
    expect(stageStep('route')).toBe('route')
  })

  it('round-trips: a stage’s page step maps back to that stage', () => {
    const stages: CreateFlowStage[] = [
      'purpose',
      'who',
      'draw',
      'confirm',
      'points',
      'route',
    ]
    for (const stage of stages) {
      const step = stageStep(stage)
      const preDraw = step === 'filters' ? stage : 'who'
      expect(flowStage(step, preDraw as 'purpose' | 'who')).toBe(stage)
    }
  })
})

// One path of six steps, always. Door knocking has no ending that skips the
// boundary and the route, so there is no audience choice — picking a saved
// list, or cutting a new one from the filter pills — that shortens the flow.
describe('stepperPosition', () => {
  it('numbers six steps, in order, on the only path there is', () => {
    expect(stepperPosition('purpose')).toEqual({
      currentStep: 1,
      totalSteps: 6,
    })
    expect(stepperPosition('who')).toEqual({ currentStep: 2, totalSteps: 6 })
    expect(stepperPosition('draw')).toEqual({ currentStep: 3, totalSteps: 6 })
    expect(stepperPosition('confirm')).toEqual({
      currentStep: 4,
      totalSteps: 6,
    })
    expect(stepperPosition('points')).toEqual({
      currentStep: 5,
      totalSteps: 6,
    })
    expect(stepperPosition('route')).toEqual({ currentStep: 6, totalSteps: 6 })
  })

  // The regression that sent a candidate who touched a filter pill from
  // "Step 1 of 5" to "Step 1 of 3": the total was derived from the audience,
  // so choosing one renumbered the flow underneath them. Nothing about the
  // audience may move either number.
  it('never renumbers a step because of the audience chosen', () => {
    const stages: CreateFlowStage[] = [
      'purpose',
      'who',
      'draw',
      'confirm',
      'points',
      'route',
    ]
    for (const stage of stages) {
      expect(stepperPosition(stage).totalSteps).toBe(6)
    }
  })

  // The property that matters more than any single number: the last step is
  // the total, so the stepper never reads "Step 5 of 6" on the screen that
  // finishes, and never overruns it either.
  it('lands the final step exactly on the total', () => {
    expect(stepperPosition('route')).toMatchObject({
      currentStep: 6,
      totalSteps: 6,
    })
  })
})

describe('previousStage', () => {
  it('reserves no back from the first step', () => {
    expect(previousStage('purpose')).toBeNull()
  })

  it('returns from draw to the who step', () => {
    expect(previousStage('draw')).toBe('who')
  })

  // The talking-points step sits between the name and the paid press, so Back
  // from the route step lands on the card rather than on the name field.
  it('returns from route to the talking points, and from those to the name', () => {
    expect(previousStage('route')).toBe('points')
    expect(previousStage('points')).toBe('confirm')
  })

  it('walks the path back to the start in exactly totalSteps - 1 moves', () => {
    let stage: CreateFlowStage | null = 'route'
    let moves = 0
    while (stage !== null && moves < 10) {
      stage = previousStage(stage)
      if (stage !== null) moves += 1
    }
    expect(moves).toBe(stepperPosition('route').totalSteps - 1)
  })
})
