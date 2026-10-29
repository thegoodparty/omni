import { describe, it, expect } from 'vitest'
import {
  HOME_CARD_COPY,
  LOST_COPY,
  WON_COPY,
  issueInSentence,
  roundPopulation,
} from './electionResultCopy'

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
  const { pro } = WON_COPY

  it('names the place, the population and the issue', () => {
    expect(pro.nextTitle('Maplewood')).toBe('Get ready to serve Maplewood')
    expect(pro.nextLine('Maplewood')).toBe(
      'Serving starts with staying connected to Maplewood.',
    )
    expect(pro.points.represent.title('Maplewood')).toBe(
      "You'll represent all of Maplewood",
    )
    expect(pro.points.represent.description(32_456)).toBe(
      "About 32,000 people live there, and you'll speak for all of them.",
    )
    expect(pro.points.hear.description('Maplewood')).toBe(
      'A few residents from every group tell you where Maplewood stands.',
    )
    expect(pro.points.ask.description('public safety')).toBe(
      'Learn where residents stand on public safety before you take office.',
    )
  })

  it('drops the place, the number and the issue when they are unknown', () => {
    expect(pro.nextTitle(null)).toBe('Get ready to serve your district')
    expect(pro.points.represent.description(null)).toBe(
      "You'll speak for everyone who lives there.",
    )
    expect(pro.points.ask.description(null)).toBe(
      'Learn where residents stand on the issues you ran on before you take office.',
    )
  })
})

describe('issueInSentence', () => {
  const row = (name: string | null, order: number | null) => ({
    order,
    topIssue: name ? { name } : null,
  })

  it('takes the first issue by order, in sentence case', () => {
    expect(
      issueInSentence([
        row('Housing', 2),
        row('Public  Safety', 1),
        row('Roads', null),
      ]),
    ).toBe('public safety')
  })

  it('keeps acronyms and skips rows without an issue', () => {
    expect(issueInSentence([row(null, 1), row('LGBTQ+ Rights', 2)])).toBe(
      'LGBTQ+ rights',
    )
  })

  it('has nothing to say without an issue', () => {
    expect(issueInSentence([])).toBeNull()
    expect(issueInSentence([row(null, 1)])).toBeNull()
  })
})

describe('HOME_CARD_COPY.description', () => {
  it('names election day when there is one', () => {
    expect(HOME_CARD_COPY.description('November 3')).toBe(
      "Your election was on November 3. Tell me how it went so I can help with what's next.",
    )
    expect(HOME_CARD_COPY.description(null)).toBe(
      "Tell me how it went so I can help with what's next.",
    )
  })
})

describe('LOST_COPY.title', () => {
  it('thanks them by first name when there is one', () => {
    expect(LOST_COPY.title('Sarah')).toBe('Thank you for running, Sarah')
    expect(LOST_COPY.title(null)).toBe('Thank you for running')
  })
})
