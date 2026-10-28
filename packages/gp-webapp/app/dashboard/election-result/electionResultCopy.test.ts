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

describe('WON_COPY.pro.points', () => {
  it('names the place, the population and what they ran on', () => {
    const [represent, loudest, ranOn] = WON_COPY.pro.points({
      place: 'Maplewood',
      population: 32_456,
      topIssue: 'the splash pad',
    })
    expect(represent).toEqual({
      title: 'You represent all of Maplewood',
      description:
        'About 32,000 people live there, and you speak for all of them.',
    })
    expect(loudest?.description).toBe(
      'A few residents from every group tell you where Maplewood stands.',
    )
    expect(ranOn?.description).toBe(
      'Learn where residents stand on the splash pad before you take office.',
    )
  })

  it('drops the number and the issue when they are unknown', () => {
    const [represent, , ranOn] = WON_COPY.pro.points({
      place: null,
      population: null,
      topIssue: null,
    })
    expect(represent?.title).toBe('You represent all of your district')
    expect(represent?.description).toBe(
      'You speak for everyone who lives there.',
    )
    expect(ranOn?.description).toBe(
      'Learn where residents stand on the issues you ran on before you take office.',
    )
  })
})

describe('LOST_COPY.title', () => {
  it('thanks them by first name when there is one', () => {
    expect(LOST_COPY.title('Sarah')).toBe('Thank you for running, Sarah')
    expect(LOST_COPY.title(null)).toBe('Thank you for running')
  })
})
