import { describe, expect, it } from 'vitest'
import { proposeRemovalForCase, type SweepAttempt } from './noisyCases.util'

// One sweep per entry, newest last: the number of its three attempts handled.
const history = (handledPerSweep: number[]): SweepAttempt[] =>
  handledPerSweep.flatMap((handled, sweep) =>
    [0, 1, 2].map((attempt) => ({
      sweepId: `sweep-${sweep}`,
      startedAt: `2026-11-${String(sweep + 1).padStart(2, '0')}T00:00:0${attempt}Z`,
      status: attempt < handled ? 'produced' : 'blocked',
    })),
  )

const propose = (attempts: SweepAttempt[]) =>
  proposeRemovalForCase('chief_of_staff', 'a-case', attempts)

describe('proposeRemovalForCase', () => {
  it('proposes a case split in at least half of its last six sweeps', () => {
    expect(propose(history([3, 3, 3, 1, 2, 1]))).toEqual({
      caseId: 'a-case',
      agentId: 'chief_of_staff',
      reason:
        'base arm split 3/6 of its last sweeps (neither 0/3 nor 3/3 handled)',
    })
  })

  it('looks only at the six most recent sweeps', () => {
    expect(propose(history([1, 2, 1, 3, 3, 3, 3, 3, 3]))).toBeUndefined()
  })

  it('never proposes a case that fails or passes every time', () => {
    expect(propose(history([0, 0, 0, 0, 0, 0]))).toBeUndefined()
    expect(propose(history([3, 3, 3, 3, 3, 3]))).toBeUndefined()
  })

  it('needs six complete sweeps', () => {
    expect(propose(history([1, 1, 1, 1, 1]))).toBeUndefined()
    const partial = history([1, 1, 1, 1, 1, 1]).slice(1)
    expect(propose(partial)).toBeUndefined()
  })
})
