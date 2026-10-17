import { describe, expect, it } from 'vitest'
import {
  MAX_LIST_SAMPLE_SIZE,
  recommendedSampleSize,
} from '@goodparty_org/contracts'
import { gatherSize } from './gatherSize.util'

const input = {
  totalConstituents: 20_000,
  sent: 2_000,
  responses: 10,
  budgetDollars: 0,
}

describe('gatherSize', () => {
  it('sizes the minimum with the shared rule, less the responses in hand', () => {
    expect(gatherSize('min', input)).toBe(
      recommendedSampleSize({ audience: 18_000, repliesAlready: 10 }),
    )
    expect(gatherSize('min', input)).toBe(Math.ceil(73 / 0.03))
  })

  it('sizes "all" as everyone not yet messaged, up to one draw', () => {
    expect(gatherSize('all', { ...input, totalConstituents: 5_000 })).toBe(
      3_000,
    )
    expect(gatherSize('all', input)).toBe(MAX_LIST_SAMPLE_SIZE)
  })

  it('divides a budget by the per-text price', () => {
    expect(gatherSize('budget', { ...input, budgetDollars: 35 })).toBe(1_000)
    expect(gatherSize('budget', { ...input, budgetDollars: 10 })).toBe(285)
  })

  it('resolves nothing for a budget of zero', () => {
    expect(gatherSize('budget', input)).toBe(0)
  })

  it('offers no count-based size without the district count', () => {
    const unknown = { ...input, totalConstituents: null }
    expect(gatherSize('min', unknown)).toBe(0)
    expect(gatherSize('all', unknown)).toBe(0)
    expect(gatherSize('budget', { ...unknown, budgetDollars: 3.5 })).toBe(100)
  })

  it('offers nothing once everyone has been messaged', () => {
    const done = { ...input, totalConstituents: 2_000 }
    expect(gatherSize('min', done)).toBe(0)
    expect(gatherSize('all', done)).toBe(0)
  })
})
