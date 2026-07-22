import { describe, expect, it } from 'vitest'
import { measureStepVerbosity } from './verbosity'

describe('measureStepVerbosity', () => {
  it('counts prose and payload words separately and totals them', () => {
    const result = measureStepVerbosity({
      assistantText: 'Here is your verdict — two things stand out.',
      payloads: [
        {
          headline: 'Council has clear authority',
          explanation: 'G.S. 160A-174 grants the power.',
        },
      ],
    })

    expect(result.proseWords).toBe(9)
    expect(result.payloadWords).toBe(9)
    expect(result.totalWords).toBe(18)
  })

  it('reads only human-readable strings from nested payloads', () => {
    const result = measureStepVerbosity({
      assistantText: '',
      payloads: [
        {
          status: 'pass',
          count: 42,
          nested: {
            options: [
              { label: 'thirty days', whyThisOption: 'a common threshold' },
              { label: 'ninety days', enabled: true },
            ],
          },
        },
      ],
    })

    // pass(1) + thirty days(2) + a common threshold(3) + ninety days(2);
    // numbers, booleans, and keys are not reading load.
    expect(result.payloadWords).toBe(8)
    expect(result.proseWords).toBe(0)
  })

  it('handles empty and null inputs without counting phantom words', () => {
    const result = measureStepVerbosity({
      assistantText: '   ',
      payloads: [null, undefined, '', []],
    })

    expect(result.totalWords).toBe(0)
  })
})
