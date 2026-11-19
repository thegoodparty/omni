import { describe, expect, it } from 'vitest'
import {
  emailChargeCents,
  emailPriceCents,
  nextWarmingStep,
  recipientCapFor,
  warmingCapFor,
} from './emailPricing.util'

describe('emailPriceCents', () => {
  it.each([
    [1, 50],
    [50, 50],
    [51, 51],
    [1_000, 1_000],
    [100_000, 100_000],
  ])('%i emails cost %i cents', (emails, cents) => {
    expect(emailPriceCents(emails)).toBe(cents)
  })
})

describe('emailChargeCents', () => {
  it('charges nothing when nothing sent', () => {
    expect(emailChargeCents(0)).toBe(0)
  })

  it('charges the minimum for a small send', () => {
    expect(emailChargeCents(3)).toBe(50)
  })

  it('charges a cent an email past the minimum', () => {
    expect(emailChargeCents(4_800)).toBe(4_800)
  })
})

describe('warming', () => {
  it('steps through the caps and stops at the last', () => {
    expect(warmingCapFor(0)).toBe(1_000)
    expect(warmingCapFor(1)).toBe(5_000)
    expect(warmingCapFor(4)).toBe(250_000)
    expect(warmingCapFor(9)).toBe(250_000)
    expect(nextWarmingStep(4)).toBe(4)
    expect(nextWarmingStep(0)).toBe(1)
  })

  it('takes off what other unfinished sends reserved', () => {
    expect(
      recipientCapFor({
        warmingStep: 0,
        reservedByOtherSends: 600,
        recipientCount: 4_800,
      }),
    ).toBe(400)
  })

  it('never exceeds the recipient count', () => {
    expect(
      recipientCapFor({
        warmingStep: 1,
        reservedByOtherSends: 0,
        recipientCount: 300,
      }),
    ).toBe(300)
  })

  it('is zero when other sends use the whole step', () => {
    expect(
      recipientCapFor({
        warmingStep: 0,
        reservedByOtherSends: 1_200,
        recipientCount: 10,
      }),
    ).toBe(0)
  })
})
