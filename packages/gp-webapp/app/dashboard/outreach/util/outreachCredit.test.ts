import { describe, expect, it } from 'vitest'
import { creditLines } from './outreachCredit'

describe('creditLines', () => {
  it('covers a send smaller than the balance', () => {
    expect(creditLines(8400, 17500)).toEqual({
      creditCents: 8400,
      totalCents: 0,
      leftCents: 9100,
    })
  })

  it('takes the whole balance off a bigger send', () => {
    expect(creditLines(30000, 17500)).toEqual({
      creditCents: 17500,
      totalCents: 12500,
      leftCents: 0,
    })
  })

  it('applies nothing with no balance', () => {
    expect(creditLines(8400, 0)).toEqual({
      creditCents: 0,
      totalCents: 8400,
      leftCents: 0,
    })
  })

  it('forgives a remainder under the card minimum', () => {
    expect(creditLines(8400, 8360).totalCents).toBe(0)
    expect(creditLines(8400, 8350).totalCents).toBe(50)
  })
})
