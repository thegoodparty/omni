import { describe, expect, it } from 'vitest'
import {
  flowStage,
  previousStage,
  stageStep,
  stepperPosition,
  type CreateFlowStage,
} from './createFlowSteps'

// The three pre-draw stages hide inside the orchestrator's single `filters`
// step. That is the whole trick — the page (#1380) starts a drawing session on
// exactly the filters → draw transition, so a stage the page never hears about
// is a step this flow can add on its own.
describe('flowStage / stageStep', () => {
  it('reads the page’s filters step as whichever pre-draw stage is showing', () => {
    expect(flowStage('filters', 'purpose')).toBe('purpose')
    expect(flowStage('filters', 'name')).toBe('name')
    expect(flowStage('draw', 'name')).toBe('draw')
    expect(flowStage('confirm', 'purpose')).toBe('confirm')
  })

  it('reports every pre-draw stage back to the page as filters', () => {
    expect(stageStep('purpose')).toBe('filters')
    expect(stageStep('who')).toBe('filters')
    expect(stageStep('name')).toBe('filters')
    expect(stageStep('draw')).toBe('draw')
    expect(stageStep('confirm')).toBe('confirm')
  })

  it('round-trips: a stage’s page step maps back to that stage', () => {
    const stages: CreateFlowStage[] = [
      'purpose',
      'who',
      'name',
      'draw',
      'confirm',
    ]
    for (const stage of stages) {
      const step = stageStep(stage)
      const preDraw = step === 'filters' ? stage : 'who'
      expect(flowStage(step, preDraw as 'purpose' | 'who' | 'name')).toBe(stage)
    }
  })
})

describe('stepperPosition', () => {
  it('numbers four steps when the audience needs no saving', () => {
    expect(stepperPosition('purpose', false)).toEqual({
      currentStep: 1,
      totalSteps: 4,
    })
    expect(stepperPosition('who', false)).toEqual({
      currentStep: 2,
      totalSteps: 4,
    })
    expect(stepperPosition('draw', false)).toEqual({
      currentStep: 3,
      totalSteps: 4,
    })
    expect(stepperPosition('confirm', false)).toEqual({
      currentStep: 4,
      totalSteps: 4,
    })
  })

  it('shifts draw and confirm along when the name step is inserted', () => {
    expect(stepperPosition('name', true)).toEqual({
      currentStep: 3,
      totalSteps: 5,
    })
    expect(stepperPosition('draw', true)).toEqual({
      currentStep: 4,
      totalSteps: 5,
    })
    expect(stepperPosition('confirm', true)).toEqual({
      currentStep: 5,
      totalSteps: 5,
    })
  })

  // The property that matters more than any single number: the last step is
  // the total, so the stepper never reads "Step 4 of 5" on the screen that
  // saves, and never overruns it either.
  it('lands the final step exactly on the total, either way', () => {
    for (const needsName of [false, true]) {
      const { currentStep, totalSteps } = stepperPosition('confirm', needsName)
      expect(currentStep).toBe(totalSteps)
    }
  })
})

describe('previousStage', () => {
  it('reserves no back from the first step', () => {
    expect(previousStage('purpose', false)).toBeNull()
    expect(previousStage('purpose', true)).toBeNull()
  })

  it('returns from draw to the pre-draw stage the candidate actually left', () => {
    expect(previousStage('draw', false)).toBe('who')
    expect(previousStage('draw', true)).toBe('name')
  })

  it('walks the whole flow back to the start in exactly totalSteps - 1 moves', () => {
    for (const needsName of [false, true]) {
      let stage: CreateFlowStage | null = 'confirm'
      let moves = 0
      while (stage !== null && moves < 10) {
        stage = previousStage(stage, needsName)
        if (stage !== null) moves += 1
      }
      expect(moves).toBe(stepperPosition('confirm', needsName).totalSteps - 1)
    }
  })
})
