import { describe, expect, it } from 'vitest'
import {
  PRIORITY_STATUS_VERSION,
  PRIORITY_STEP_IDS,
  mergeStepCheck,
  parsePriorityStatus,
  type PriorityStepCheck,
} from './PriorityStatus.schema'

const NOW = '2026-10-01T12:00:00Z'

describe('parsePriorityStatus', () => {
  it('reads a version 1 row with no checks', () => {
    const status = parsePriorityStatus({
      version: 1,
      steps: [{ id: 'define', state: 'settled', summary: 'Potholes on Elm' }],
    })
    expect(status.version).toBe(1)
    expect(status.steps).toHaveLength(PRIORITY_STEP_IDS.length)
    expect(status.steps[0]).toEqual({
      id: 'define',
      state: 'settled',
      summary: 'Potholes on Elm',
    })
  })

  it('reads a stored check and fills its defaults', () => {
    const status = parsePriorityStatus({
      version: 2,
      steps: [
        {
          id: 'define',
          state: 'settled',
          summary: 'Potholes on Elm',
          check: { state: 'deferred', when: 'after the budget hearing' },
        },
      ],
    })
    expect(status.steps[0]?.check).toEqual({
      state: 'deferred',
      who: '',
      question: '',
      when: 'after the budget hearing',
      raised: 0,
    })
  })

  it('drops an unreadable check without emptying the status', () => {
    const status = parsePriorityStatus({
      version: 3,
      steps: [
        {
          id: 'define',
          state: 'settled',
          summary: 'Potholes on Elm',
          check: { state: 'something_newer' },
        },
      ],
    })
    expect(status.steps[0]?.state).toBe('settled')
    expect(status.steps[0]?.summary).toBe('Potholes on Elm')
    expect(status.steps[0]?.check).toBeUndefined()
  })

  it('degrades a garbage value to every step open', () => {
    const status = parsePriorityStatus('nope')
    expect(status.version).toBe(PRIORITY_STATUS_VERSION)
    expect(status.steps.every((step) => step.state === 'open')).toBe(true)
  })
})

describe('mergeStepCheck', () => {
  const deferred: PriorityStepCheck = {
    state: 'deferred',
    who: 'Renters on the flood blocks',
    question: 'Is flooding the problem, or is it the landlord response?',
    when: 'after the budget hearing',
    raised: 0,
  }

  it('keeps the stored check when the patch has none', () => {
    expect(mergeStepCheck(deferred, undefined, NOW)).toBe(deferred)
  })

  it('starts a new check at zero raises', () => {
    expect(
      mergeStepCheck(
        undefined,
        { state: 'asked', who: 'Renters', question: 'Is this it?' },
        NOW,
      ),
    ).toEqual({
      state: 'asked',
      who: 'Renters',
      question: 'Is this it?',
      raised: 0,
      updatedAt: NOW,
    })
  })

  it('counts a deferral recorded over a deferral as a raise', () => {
    const once = mergeStepCheck(deferred, { state: 'deferred' }, NOW)
    expect(once?.raised).toBe(1)
    expect(once?.who).toBe(deferred.who)
    expect(once?.when).toBe(deferred.when)
    const twice = mergeStepCheck(once, { state: 'deferred' }, NOW)
    expect(twice?.raised).toBe(2)
  })

  it('does not count a first deferral or a move out of one', () => {
    const asked: PriorityStepCheck = { ...deferred, state: 'asked' }
    expect(mergeStepCheck(asked, { state: 'deferred' }, NOW)?.raised).toBe(0)
    expect(mergeStepCheck(deferred, { state: 'out' }, NOW)).toMatchObject({
      state: 'out',
      raised: 0,
      who: deferred.who,
    })
  })
})
