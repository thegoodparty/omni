import { describe, expect, it } from 'vitest'
import { priorityReadStatus } from './priorityReadStatus.util'

describe('priorityReadStatus', () => {
  it('needs the district-corrected answers before it is a good read', () => {
    expect(priorityReadStatus({ answers: 91, population: 2_000 })).toEqual({
      answers: 91,
      needed: 92,
      good: false,
    })
    expect(priorityReadStatus({ answers: 92, population: 2_000 }).good).toBe(
      true,
    )
  })

  it('uses the uncorrected figure when the population is unknown', () => {
    expect(priorityReadStatus({ answers: 0, population: null })).toEqual({
      answers: 0,
      needed: 96,
      good: false,
    })
  })
})
