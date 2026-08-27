import { describe, expect, it } from 'vitest'
import { calcRobocallAmountInCents } from './robocallPricing.util'

// Concrete cent values, NOT calcRobocallAmountInCents echoed back as its own
// expected value — so an off-by-one in the price constant or the round-half-up
// formula fails the test instead of passing on both sides.
describe('calcRobocallAmountInCents', () => {
  it.each([
    [0, 0],
    [1, 5],
    [2, 9],
    [10, 45],
    [100, 450],
  ])('%i landline contacts -> %i cents', (count, cents) => {
    expect(calcRobocallAmountInCents(count)).toBe(cents)
  })
})
