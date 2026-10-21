import { describe, expect, it } from 'vitest'
import { answersNeeded } from './AnswersNeeded.const'

describe('answersNeeded', () => {
  it('gives the smallest major group three expected answers', () => {
    expect(answersNeeded(0.03)).toBe(100)
    expect(answersNeeded(0.05)).toBe(60)
    expect(answersNeeded(0.2)).toBe(15)
    expect(answersNeeded(0.07)).toBe(43)
  })

  it('never sizes for a group under the major share', () => {
    expect(answersNeeded(0.01)).toBe(100)
  })

  it('sizes for the smallest major group when the mix is unknown', () => {
    expect(answersNeeded(null)).toBe(100)
    expect(answersNeeded(undefined)).toBe(100)
    expect(answersNeeded()).toBe(100)
  })
})
