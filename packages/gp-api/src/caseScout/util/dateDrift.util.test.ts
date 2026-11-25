import { parseISO } from 'date-fns'
import { describe, expect, it } from 'vitest'
import { findDateDrift } from './dateDrift.util'

const STARTED = parseISO('2026-11-04T15:00:00.000Z')
const SOURCE = ['How did turnout in Lakemoor compare to last time?']

const drift = (userTurns: string[], sourceTexts: string[] = SOURCE) =>
  findDateDrift({ userTurns, sourceTexts, sessionStartedAt: STARTED })

describe('findDateDrift', () => {
  it('keeps a draft that names the chat year or an earlier one', () => {
    expect(drift(['What did the 2026 primary teach us?'])).toBeUndefined()
    expect(
      drift(['Compare it with the 2022 general election.']),
    ).toBeUndefined()
  })

  it('flags a past event moved into the future', () => {
    expect(
      drift(['How did turnout in the 2028 general election compare?']),
    ).toEqual({
      years: [2028],
      sessionYear: 2026,
      reason: 'names 2028; the chat is from 2026',
    })
  })

  it('allows a future year when the chat named one', () => {
    expect(
      drift(
        ['My election is March 9, 2029. How many doors a week?'],
        ['My election is March 9, 2028.', 'Plan for about 400 doors a week.'],
      ),
    ).toBeUndefined()
  })

  it('reads the year of the session start in UTC', () => {
    expect(
      findDateDrift({
        userTurns: ['What happens in the 2027 session?'],
        sourceTexts: SOURCE,
        sessionStartedAt: parseISO('2026-12-31T23:30:00-05:00'),
      }),
    ).toBeUndefined()
  })

  it('lists every later year once, in order, across turns', () => {
    expect(
      drift([
        'Plan the 2030 race for me.',
        'And the 2028 one, and the 2030 one again, from 2024 numbers.',
      ])?.reason,
    ).toBe('names 2028 and 2030; the chat is from 2026')
  })

  it('counts a year range and an ISO date', () => {
    expect(drift(['What is the 2026-2027 budget?'])?.years).toEqual([2027])
    expect(drift(['The hearing is on 2027-02-10.'])?.years).toEqual([2027])
  })

  it('counts a hyphenated month-day-year date', () => {
    expect(drift(['Results came in on 12-31-2028.'])?.years).toEqual([2028])
    expect(drift(['The vote was on 3-9-2028.'])?.years).toEqual([2028])
  })

  it('ignores numbers that are not years', () => {
    expect(
      drift([
        'We knocked 2500 doors and 12028 flyers went out.',
        'Ordinance 245-2028 passed. Call 555-2031 or text 555-0142.',
        'The fund holds $2029 and the rate is 2.2030 percent.',
        'Their 2030s plan is ready.',
      ]),
    ).toBeUndefined()
  })
})
