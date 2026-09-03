import { describe, expect, it } from 'vitest'
import { OUTREACH_PURPOSE_VALUES } from '@goodparty_org/contracts'
import {
  RECOMMENDED_LISTS_REGISTRY,
  fillCopy,
  intentForPurpose,
  variantsForIntent,
} from './recommendedLists.registry'

describe('intentForPurpose', () => {
  it('maps every purpose in the shared vocabulary', () => {
    expect(intentForPurpose('introduce_myself')).toBe('introduce')
    expect(intentForPurpose('persuade_voters')).toBe('persuade')
    expect(intentForPurpose('event_invite')).toBe('event')
    expect(intentForPurpose('early_voting')).toBe('earlyVote')
    expect(intentForPurpose('election_day_turnout')).toBe('electionDay')
  })

  it('returns null for custom, which gets no recommendation', () => {
    expect(intentForPurpose('custom')).toBeNull()
  })

  it('returns null for social issue_update, which is out of scope', () => {
    expect(intentForPurpose('issue_update')).toBeNull()
  })

  it('covers the shared vocabulary exhaustively', () => {
    for (const purpose of OUTREACH_PURPOSE_VALUES) {
      expect(() => intentForPurpose(purpose)).not.toThrow()
    }
  })
})

describe('variantsForIntent', () => {
  it('returns one variant for introduce', () => {
    expect(variantsForIntent('introduce')).toEqual(['introNeverIded'])
  })

  it('returns three variants for persuade in display order', () => {
    expect(variantsForIntent('persuade')).toEqual([
      'persuadeAffinity',
      'persuadeIdeology',
      'persuadeUndecided',
    ])
  })

  it('covers all five intents and all thirteen variants exactly once', () => {
    const intents = [
      'introduce',
      'persuade',
      'event',
      'earlyVote',
      'electionDay',
    ] as const
    const all = intents.flatMap((intent) => variantsForIntent(intent))
    expect(all).toHaveLength(13)
    expect(new Set(all).size).toBe(13)
    expect(new Set(all)).toEqual(
      new Set(Object.keys(RECOMMENDED_LISTS_REGISTRY)),
    )
  })
})

describe('RECOMMENDED_LISTS_REGISTRY copy', () => {
  it('never says likely voters', () => {
    for (const entry of Object.values(RECOMMENDED_LISTS_REGISTRY)) {
      expect(entry.copy.criteriaSummary.toLowerCase()).not.toContain(
        'likely voter',
      )
      expect(entry.copy.title.toLowerCase()).not.toContain('likely voter')
    }
  })

  it('marks exactly the three ideology variants as needing a bucket', () => {
    const needing = Object.entries(RECOMMENDED_LISTS_REGISTRY)
      .filter(([, entry]) => entry.requiresIdeologyBucket)
      .map(([key]) => key)
      .sort()
    expect(needing).toEqual(
      [
        'earlyVoteIdeology',
        'electionDayIdeology',
        'eventIdeology',
        'persuadeIdeology',
      ].sort(),
    )
  })
})

describe('fillCopy', () => {
  it('fills a {bucket} token with the supplied value', () => {
    const copy = fillCopy('persuadeIdeology', { bucket: 'progressive' })
    expect(copy).toEqual({
      title: 'Voters who may lean progressive',
      criteriaSummary:
        'Moderate to high propensity voters whose behavior suggests a ' +
        'progressive lean — a hypothesis worth testing with your message.',
    })
  })

  it('leaves the token literal when no value is supplied', () => {
    const copy = fillCopy('persuadeIdeology')
    expect(copy.title).toBe('Voters who may lean {bucket}')
  })

  it('leaves the token literal when tokens omit that key', () => {
    const copy = fillCopy('persuadeIdeology', { other: 'ignored' })
    expect(copy.title).toBe('Voters who may lean {bucket}')
  })

  it('passes through copy with no tokens unchanged', () => {
    const copy = fillCopy('introNeverIded')
    expect(copy).toEqual(RECOMMENDED_LISTS_REGISTRY.introNeverIded.copy)
  })
})
