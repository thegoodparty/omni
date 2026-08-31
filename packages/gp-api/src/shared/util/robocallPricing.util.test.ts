import { describe, expect, it } from 'vitest'
import {
  calcRobocallAmountInCents,
  calcRobocallTotalInCents,
  ROBOCALL_NUMBER_FEE_CENTS,
} from './robocallPricing.util'

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

describe('ROBOCALL_NUMBER_FEE_CENTS', () => {
  it('equals 200', () => {
    expect(ROBOCALL_NUMBER_FEE_CENTS).toBe(200)
  })
})

// Concrete totals (calls + the $2 number fee), NOT the function echoed back,
// so a wrong fee constant or a broken sum fails here instead of passing on both
// sides of the service-test assertions.
describe('calcRobocallTotalInCents', () => {
  it.each([
    [0, 200],
    [1, 205],
    [10, 245],
    [100, 650],
  ])('%i contacts -> %i cents total', (count, cents) => {
    expect(calcRobocallTotalInCents(count)).toBe(cents)
  })
})
