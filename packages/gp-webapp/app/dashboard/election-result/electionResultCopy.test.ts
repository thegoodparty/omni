import { describe, it, expect } from 'vitest'
import { LOST_COPY, WON_COPY, roundPopulation } from './electionResultCopy'

describe('roundPopulation', () => {
  it.each([
    [32_456, '32,000'],
    [4_567, '4,600'],
    [812, '810'],
  ])('rounds %d to %s', (population, expected) => {
    expect(roundPopulation(population)).toBe(expected)
  })
})

describe('the Pro winner’s what-comes-next copy', () => {
  it('names the place and the population', () => {
    expect(WON_COPY.pro.nextTitle('Maplewood')).toBe(
      'Get ready to serve Maplewood',
    )
    expect(WON_COPY.pro.nextCaption(32_456)).toBe(
      "You're about to represent all 32,000 people who live there, not just the ones at the mic.",
    )
  })

  it('drops the place and the number when they are unknown', () => {
    expect(WON_COPY.pro.nextTitle(null)).toBe(
      'Get ready to serve your district',
    )
    expect(WON_COPY.pro.nextCaption(null)).toBe(
      "You're about to represent everyone who lives there, not just the ones at the mic.",
    )
  })
})

describe('LOST_COPY.title', () => {
  it('thanks them by first name when there is one', () => {
    expect(LOST_COPY.title('Sarah')).toBe('Thank you for running, Sarah')
    expect(LOST_COPY.title(null)).toBe('Thank you for running')
  })
})
