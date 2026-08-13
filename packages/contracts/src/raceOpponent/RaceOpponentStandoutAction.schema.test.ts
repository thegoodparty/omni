import { describe, it, expect } from 'vitest'
import {
  RaceOpponentStandoutActionSchema,
  RaceOpponentStandoutActionHaystaqSchema,
} from './index'

const validHaystaq = {
  hsColumn: 'hs_infrastructure_support',
  positionPhrase: 'funding infrastructure more',
  positionDir: 'high' as const,
  totalActive: 12000,
  voterCountGe50: 6400,
  voterPercentageGe50: 53.3,
  voterCountGe70: 3100,
  voterPercentageGe70: 25.8,
}

const validAction = {
  title: 'Knock the north precinct',
  body: 'Your opponent skipped the last three council votes on road repair.',
  smsMessage: 'Hi, this is Jane — I show up for every road-repair vote.',
  opponentName: 'John Smith',
  issue: 'infrastructure',
}

describe('RaceOpponentStandoutActionSchema', () => {
  it('parses a full valid action', () => {
    expect(RaceOpponentStandoutActionSchema.parse(validAction)).toEqual(
      validAction,
    )
  })

  it('parses a minimal action with opponentName null', () => {
    const result = RaceOpponentStandoutActionSchema.parse({
      ...validAction,
      opponentName: null,
    })
    expect(result.opponentName).toBeNull()
  })

  it('parses with opponentName absent (DB nulls and omissions round-trip)', () => {
    const { opponentName, ...withoutOpponent } = validAction
    const result = RaceOpponentStandoutActionSchema.parse(withoutOpponent)
    expect(result.opponentName).toBeUndefined()
  })

  it('rejects a title over 99 chars', () => {
    expect(
      RaceOpponentStandoutActionSchema.safeParse({
        ...validAction,
        title: 'a'.repeat(100),
      }).success,
    ).toBe(false)
  })

  it('accepts a title of exactly 99 chars', () => {
    const result = RaceOpponentStandoutActionSchema.parse({
      ...validAction,
      title: 'a'.repeat(99),
    })
    expect(result.title).toHaveLength(99)
  })

  it('rejects an smsMessage over 320 chars', () => {
    expect(
      RaceOpponentStandoutActionSchema.safeParse({
        ...validAction,
        smsMessage: 'a'.repeat(321),
      }).success,
    ).toBe(false)
  })

  it('accepts an smsMessage of exactly 320 chars', () => {
    const result = RaceOpponentStandoutActionSchema.parse({
      ...validAction,
      smsMessage: 'a'.repeat(320),
    })
    expect(result.smsMessage).toHaveLength(320)
  })

  const requiredNonEmpty = ['title', 'body', 'smsMessage', 'issue'] as const

  it.each(requiredNonEmpty)('rejects an empty %s', (field) => {
    expect(
      RaceOpponentStandoutActionSchema.safeParse({
        ...validAction,
        [field]: '',
      }).success,
    ).toBe(false)
  })

  it.each(requiredNonEmpty)('rejects an action missing %s', (field) => {
    const { [field]: _omitted, ...rest } = validAction
    expect(RaceOpponentStandoutActionSchema.safeParse(rest).success).toBe(false)
  })

  it('parses an action with a full haystaq object', () => {
    const result = RaceOpponentStandoutActionSchema.parse({
      ...validAction,
      haystaq: validHaystaq,
    })
    expect(result.haystaq).toEqual(validHaystaq)
  })

  it('parses an action with haystaq null (DB null round-trips)', () => {
    const result = RaceOpponentStandoutActionSchema.parse({
      ...validAction,
      haystaq: null,
    })
    expect(result.haystaq).toBeNull()
  })

  it('parses a legacy action with haystaq absent', () => {
    const result = RaceOpponentStandoutActionSchema.parse(validAction)
    expect(result.haystaq).toBeUndefined()
  })
})

describe('RaceOpponentStandoutActionHaystaqSchema', () => {
  it('parses a full haystaq object', () => {
    expect(RaceOpponentStandoutActionHaystaqSchema.parse(validHaystaq)).toEqual(
      validHaystaq,
    )
  })

  it('parses with only hsColumn (all counts omitted)', () => {
    const result = RaceOpponentStandoutActionHaystaqSchema.parse({
      hsColumn: 'hs_infrastructure_support',
    })
    expect(result.hsColumn).toBe('hs_infrastructure_support')
    expect(result.totalActive).toBeUndefined()
    expect(result.voterPercentageGe50).toBeUndefined()
  })

  it('accepts null for nullish count and phrase fields', () => {
    const result = RaceOpponentStandoutActionHaystaqSchema.parse({
      hsColumn: 'hs_infrastructure_support',
      positionPhrase: null,
      positionDir: null,
      totalActive: null,
      voterCountGe50: null,
      voterPercentageGe50: null,
      voterCountGe70: null,
      voterPercentageGe70: null,
    })
    expect(result.totalActive).toBeNull()
    expect(result.positionDir).toBeNull()
  })

  it('rejects an empty hsColumn', () => {
    expect(
      RaceOpponentStandoutActionHaystaqSchema.safeParse({
        ...validHaystaq,
        hsColumn: '',
      }).success,
    ).toBe(false)
  })

  it('rejects a missing hsColumn', () => {
    const { hsColumn: _omitted, ...rest } = validHaystaq
    expect(
      RaceOpponentStandoutActionHaystaqSchema.safeParse(rest).success,
    ).toBe(false)
  })

  it('rejects a percentage over 100', () => {
    expect(
      RaceOpponentStandoutActionHaystaqSchema.safeParse({
        ...validHaystaq,
        voterPercentageGe50: 100.1,
      }).success,
    ).toBe(false)
  })

  it('rejects a negative percentage', () => {
    expect(
      RaceOpponentStandoutActionHaystaqSchema.safeParse({
        ...validHaystaq,
        voterPercentageGe70: -1,
      }).success,
    ).toBe(false)
  })

  it('rejects a negative count', () => {
    expect(
      RaceOpponentStandoutActionHaystaqSchema.safeParse({
        ...validHaystaq,
        totalActive: -5,
      }).success,
    ).toBe(false)
  })

  it('rejects a non-integer count', () => {
    expect(
      RaceOpponentStandoutActionHaystaqSchema.safeParse({
        ...validHaystaq,
        voterCountGe50: 6400.5,
      }).success,
    ).toBe(false)
  })

  it('rejects an invalid positionDir', () => {
    expect(
      RaceOpponentStandoutActionHaystaqSchema.safeParse({
        ...validHaystaq,
        positionDir: 'medium',
      }).success,
    ).toBe(false)
  })
})
