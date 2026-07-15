import { describe, expect, it } from 'vitest'

import {
  calcTextAmountInCents,
  PRICE_PER_TEXT_TENTH_CENTS,
} from './textPricing.util'

describe('PRICE_PER_TEXT_TENTH_CENTS', () => {
  it('is 3.5 cents per text expressed as tenth-cents', () => {
    expect(PRICE_PER_TEXT_TENTH_CENTS).toBe(35)
  })
})

describe('calcTextAmountInCents', () => {
  it('charges nothing for zero texts', () => {
    expect(calcTextAmountInCents(0)).toBe(0)
  })

  it('rounds a single text (3.5 cents) up to 4 cents', () => {
    // 1 * 35 = 35 tenth-cents = 3.5 cents; the +5 half-cent bias rounds up.
    expect(calcTextAmountInCents(1)).toBe(4)
  })

  // Small counts exercise the +5 half-cent rounding bias: odd counts land on a
  // half-cent (…5 tenth-cents) and round up, even counts land exactly on a cent.
  it('rounds small counts, biasing the trailing half-cent upward', () => {
    expect(calcTextAmountInCents(2)).toBe(7)
    expect(calcTextAmountInCents(3)).toBe(11)
    expect(calcTextAmountInCents(4)).toBe(14)
    expect(calcTextAmountInCents(5)).toBe(18)
    expect(calcTextAmountInCents(6)).toBe(21)
    expect(calcTextAmountInCents(7)).toBe(25)
  })

  it('rounds an even multiple exactly (10 texts = 35 cents)', () => {
    expect(calcTextAmountInCents(10)).toBe(35)
  })

  it('scales to round hundreds and thousands', () => {
    expect(calcTextAmountInCents(100)).toBe(350)
    expect(calcTextAmountInCents(1000)).toBe(3500)
  })

  it('handles a large count without precision drift', () => {
    // 123456 * 35 = 4,320,960 tenth-cents; (4,320,960 + 5) / 10 = 432096.5 → 432096.
    expect(calcTextAmountInCents(123456)).toBe(432096)
  })
})
