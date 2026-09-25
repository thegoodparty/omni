import { describe, expect, it } from 'vitest'
import {
  flowStage,
  previousStage,
  stageStep,
  stepperPosition,
  type CreateFlowStage,
} from './createFlowSteps'

// Every stage the stepper counts. `success` is deliberately not one of them —
// see its own describe below.
const COUNTED_STAGES: CreateFlowStage[] = [
  'purpose',
  'who',
  'points',
  'name',
  'draw',
]

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
    expect(flowStage('success', 'purpose')).toBe('success')
  })

  it('reports every pre-draw stage back to the page as filters', () => {
    expect(stageStep('purpose')).toBe('filters')
    expect(stageStep('who')).toBe('filters')
    expect(stageStep('draw')).toBe('draw')
    expect(stageStep('name')).toBe('name')
    expect(stageStep('points')).toBe('points')
    expect(stageStep('success')).toBe('success')
  })

  it('round-trips: a stage’s page step maps back to that stage', () => {
    for (const stage of [...COUNTED_STAGES, 'success' as const]) {
      const step = stageStep(stage)
      const preDraw = step === 'filters' ? stage : 'who'
      expect(flowStage(step, preDraw as 'purpose' | 'who')).toBe(stage)
    }
  })
})

// One path of five steps, always. Drawing is the last thing the candidate
// does — the route is bought at first knock, so there is nothing left to ask
// once the map is cut — and no audience choice shortens the path.
describe('stepperPosition', () => {
  it('numbers five steps, in order, on the only path there is', () => {
    expect(stepperPosition('purpose')).toEqual({
      currentStep: 1,
      totalSteps: 5,
    })
    expect(stepperPosition('who')).toEqual({ currentStep: 2, totalSteps: 5 })
    expect(stepperPosition('points')).toEqual({
      currentStep: 3,
      totalSteps: 5,
    })
    expect(stepperPosition('name')).toEqual({
      currentStep: 4,
      totalSteps: 5,
    })
    expect(stepperPosition('draw')).toEqual({ currentStep: 5, totalSteps: 5 })
  })

  // The regression that sent a candidate who touched a filter pill from
  // "Step 1 of 5" to "Step 1 of 3": the total was derived from the audience,
  // so choosing one renumbered the flow underneath them. Nothing about the
  // audience may move either number.
  it('never renumbers a step because of the audience chosen', () => {
    for (const stage of COUNTED_STAGES) {
      expect(stepperPosition(stage).totalSteps).toBe(5)
    }
  })

  // The property that matters more than any single number: the last step is
  // the total, so the stepper never reads "Step 4 of 5" on the screen that
  // finishes, and never overruns it either.
  it('lands the final step exactly on the total', () => {
    expect(stepperPosition('draw')).toMatchObject({
      currentStep: 5,
      totalSteps: 5,
    })
  })

  // `totalSteps: 0` is what the shell reads as "draw no stepper", the same
  // thing SMS and social do on their own last screens. The campaign exists by
  // then, so numbering it would invite a Back into creating it twice.
  it('draws no stepper on the success screen', () => {
    expect(stepperPosition('success')).toEqual({
      currentStep: 0,
      totalSteps: 0,
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
  // between talking points and draw), and draw lands last. So Back from draw
  // walks draw → name → points → who → purpose without detouring back into
  // an audience step.
  it('walks draw → name → points → who → purpose in one back per step', () => {
    expect(previousStage('draw')).toBe('name')
    expect(previousStage('name')).toBe('points')
    expect(previousStage('points')).toBe('who')
    expect(previousStage('who')).toBe('purpose')
  })

  // The campaign is already created by the time this renders, so there is
  // nothing to go back to that would not mean creating it again.
  it('offers no back from the success screen', () => {
    expect(previousStage('success')).toBeNull()
  })

  it('walks the path back to the start in exactly totalSteps - 1 moves', () => {
    let stage: CreateFlowStage | null = 'draw'
    let moves = 0
    while (stage !== null && moves < 10) {
      stage = previousStage(stage)
      if (stage !== null) moves += 1
    }
    expect(moves).toBe(stepperPosition('draw').totalSteps - 1)
  })
})
