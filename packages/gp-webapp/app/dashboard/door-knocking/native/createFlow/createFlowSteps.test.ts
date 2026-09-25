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
    expect(flowStage('name', 'purpose')).toBe('name')
    expect(flowStage('route', 'purpose')).toBe('route')
  })

  it('reports every pre-draw stage back to the page as filters', () => {
    expect(stageStep('purpose')).toBe('filters')
    expect(stageStep('who')).toBe('filters')
    expect(stageStep('draw')).toBe('draw')
    expect(stageStep('name')).toBe('name')
    expect(stageStep('points')).toBe('points')
    expect(stageStep('route')).toBe('route')
  })

  it('round-trips: a stage’s page step maps back to that stage', () => {
    const stages: CreateFlowStage[] = [
      'purpose',
      'who',
      'draw',
      'name',
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
    expect(stepperPosition('points')).toEqual({
      currentStep: 3,
      totalSteps: 6,
    })
    expect(stepperPosition('name')).toEqual({
      currentStep: 4,
      totalSteps: 6,
    })
    expect(stepperPosition('draw')).toEqual({ currentStep: 5, totalSteps: 6 })
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
      'name',
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

  it('returns from draw to the name step, since the campaign is named before the polygon is drawn', () => {
    expect(previousStage('draw')).toBe('name')
  })

  // The campaign name is settled before the polygon is drawn (name sits
  // between talking points and draw), and route lands last. So Back from
  // route walks route → draw → name → points → who → purpose without
  // detouring back into an audience step.
  it('walks route → draw → name → points → who → purpose in one back per step', () => {
    expect(previousStage('route')).toBe('draw')
    expect(previousStage('draw')).toBe('name')
    expect(previousStage('name')).toBe('points')
    expect(previousStage('points')).toBe('who')
    expect(previousStage('who')).toBe('purpose')
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

// The community-input purpose inserts one stage after `purpose`, making the
// path seven long. Everything else about the flow is unchanged, which is what
// the default-argument shape is for.
describe('the community-input question stage', () => {
  it('sits second and pushes every later stage along by one', () => {
    expect(stepperPosition('purpose', true)).toEqual({
      currentStep: 1,
      totalSteps: 7,
    })
    expect(stepperPosition('question', true)).toEqual({
      currentStep: 2,
      totalSteps: 7,
    })
    expect(stepperPosition('who', true)).toEqual({
      currentStep: 3,
      totalSteps: 7,
    })
    expect(stepperPosition('route', true)).toEqual({
      currentStep: 7,
      totalSteps: 7,
    })
  })

  it('walks back through the question rather than past it', () => {
    expect(previousStage('who', true)).toBe('question')
    expect(previousStage('question', true)).toBe('purpose')
    expect(previousStage('purpose', true)).toBeNull()
  })

  // The orchestrator must not learn about this stage: it lives inside the
  // page's single `filters` step, so the canvas's draw-session transition is
  // untouched by its existence.
  it('reports the filters step, like every other pre-draw stage', () => {
    expect(stageStep('question')).toBe('filters')
  })

  it('still walks back to the start in totalSteps - 1 moves', () => {
    let stage: CreateFlowStage | null = 'route'
    let moves = 0
    while (stage !== null && moves < 12) {
      stage = previousStage(stage, true)
      if (stage !== null) moves += 1
    }
    expect(moves).toBe(stepperPosition('route', true).totalSteps - 1)
  })
})
