import { describe, expect, it } from 'vitest'
import {
  PRIORITY_NUMBERED_STEPS,
  isPriorityStep,
  nextPriorityStep,
  previousPriorityStep,
  priorityStepNumber,
} from './steps'

describe('priority flow steps', () => {
  it('enters the numbered flow from intro', () => {
    expect(nextPriorityStep('intro')).toBe('define')
  })

  it('walks the numbered steps in order', () => {
    const walked: string[] = []
    let step = nextPriorityStep('intro')
    while (step && step !== 'track') {
      walked.push(step)
      step = nextPriorityStep(step)
    }
    expect(walked).toEqual([...PRIORITY_NUMBERED_STEPS])
  })

  it('lands on track after the last numbered step, and stops there', () => {
    expect(nextPriorityStep('plan')).toBe('track')
    expect(nextPriorityStep('track')).toBeNull()
  })

  it('numbers only the substantive steps', () => {
    expect(priorityStepNumber('define')).toBe(1)
    expect(priorityStepNumber('plan')).toBe(PRIORITY_NUMBERED_STEPS.length)
    // Intro is an entry point and track is a standing step; neither counts
    // toward "step N of 7".
    expect(priorityStepNumber('intro')).toBeNull()
    expect(priorityStepNumber('track')).toBeNull()
  })

  it('steps back through the numbered flow, and stops at its start', () => {
    expect(previousPriorityStep('evidence')).toBe('define')
    expect(previousPriorityStep('define')).toBeNull()
    // Track sits outside the numbered flow, so back from it is the last one.
    expect(previousPriorityStep('track')).toBe('plan')
  })

  it('recognizes its own step ids and nothing else', () => {
    expect(isPriorityStep('method')).toBe(true)
    expect(isPriorityStep('comparables')).toBe(false)
  })
})
