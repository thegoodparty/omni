import { describe, it, expect } from 'vitest'
import { RaceOpponentStandoutActionSchema } from './index'

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
})
