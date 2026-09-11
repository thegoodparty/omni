import { describe, expect, it } from 'vitest'
import { buildStepPrompt } from './stepPrompts'
import { PRIORITY_FLOW_STEP_VALUES } from './steps'

const priority = {
  title: 'School funding',
  description: 'Our district lost two teaching positions last year.',
}

describe('buildStepPrompt', () => {
  it('puts the actual priority in every step, so no step can answer generically', () => {
    for (const step of PRIORITY_FLOW_STEP_VALUES) {
      const prompt = buildStepPrompt(step, priority)
      expect(prompt).toContain('School funding')
      expect(prompt).toContain('lost two teaching positions')
    }
  })

  it('carries the grounding and method-not-position rules into every step', () => {
    for (const step of PRIORITY_FLOW_STEP_VALUES) {
      const prompt = buildStepPrompt(step, priority)
      expect(prompt).toContain('never invent a figure')
      expect(prompt).toContain('method, not on what position to hold')
    }
  })

  it('asks the define step for one question with options, not for an answer', () => {
    const prompt = buildStepPrompt('define', priority)
    expect(prompt).toContain('ONE question')
    expect(prompt).toContain('do not answer it yourself')
  })

  it('asks the method step to search for the bar rather than infer it', () => {
    const prompt = buildStepPrompt('method', priority)
    expect(prompt).toContain('Search for the bar directly')
    expect(prompt).toContain('preemption')
  })
})
