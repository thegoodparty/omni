import { describe, expect, it } from 'vitest'
import {
  buildResumePrompt,
  buildStepPrompt,
  stepFromMarker,
} from './stepPrompts'
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

  it('makes every step ask before it can settle', () => {
    for (const step of PRIORITY_FLOW_STEP_VALUES) {
      const prompt = buildStepPrompt(step, priority)
      // The interaction contract: one question per turn, in a block the
      // client can render, and no settling on the opening turn.
      expect(prompt).toContain('Ask ONE question per turn')
      expect(prompt).toContain('Never settle on the first turn of a step')
      expect(prompt).toContain('```priority')
    }
  })

  it('says it is mid-flow only when the API could not be told', () => {
    // An anchor-aware gp-api drops its own session-opening blocks, so saying
    // it again here would be the client arguing with a prompt that already
    // agrees. The declaration is the fallback for an API that refused the
    // priority anchor.
    expect(buildStepPrompt('define', priority)).not.toContain(
      'I am not opening a session with you',
    )
    const fallback = buildStepPrompt('define', priority, [], {
      declareFlowContext: true,
    })
    expect(fallback).toContain('I am not opening a session with you')
    expect(fallback).toContain('do not introduce yourself')
  })

  it('marks every step ask so a resumed transcript knows where it stopped', () => {
    for (const step of PRIORITY_FLOW_STEP_VALUES) {
      const prompt = buildStepPrompt(step, priority)
      expect(prompt).toContain(`[step:${step}]`)
      expect(stepFromMarker(prompt, PRIORITY_FLOW_STEP_VALUES)).toBe(step)
    }
  })

  it('reads no step out of a transcript that carries no marker', () => {
    expect(
      stepFromMarker('just a message', PRIORITY_FLOW_STEP_VALUES),
    ).toBeNull()
    expect(
      stepFromMarker('[step:not_a_step]', PRIORITY_FLOW_STEP_VALUES),
    ).toBeNull()
  })

  it('nudges on what the priority was waiting for when it resumes', () => {
    const prompt = buildResumePrompt('the engineer estimate')
    expect(prompt).toContain('the engineer estimate')
    expect(prompt).toContain('Do not re-run the step')
  })

  it('holds the define step to at least two questions', () => {
    const prompt = buildStepPrompt('define', priority)
    expect(prompt).toContain('at least two questions')
    expect(prompt).toContain('settle the step with the problem in my own words')
  })

  it('asks the method step to search for the bar rather than infer it', () => {
    const prompt = buildStepPrompt('method', priority)
    expect(prompt).toContain('Search for the bar directly')
    expect(prompt).toContain('preemption')
  })
})
