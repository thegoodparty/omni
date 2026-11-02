import { describe, expect, it } from 'vitest'
import type { PriorityReadStatus } from '@goodparty_org/contracts'
import { answerSeats } from './AnswerSeats'

const read = (over: Partial<PriorityReadStatus>): PriorityReadStatus => ({
  answers: 40,
  needed: 100,
  groupsHeard: 7,
  groupsTotal: 20,
  groupsNext: 2,
  representativeAnswers: 34,
  representativeNeeded: 100,
  good: false,
  status: 'notYetRepresentative',
  underrepresented: ['age65plus'],
  checkOut: true,
  ...over,
})

const tally = (r: PriorityReadStatus) =>
  answerSeats(r).reduce<Record<string, number>>((acc, seat) => {
    acc[seat.state] = (acc[seat.state] ?? 0) + 1
    return acc
  }, {})

describe('answerSeats', () => {
  it('fills one seat per answer that counts, left to right', () => {
    const seats = answerSeats(read({}))
    expect(seats).toHaveLength(100)
    expect(tally(read({}))).toEqual({ heard: 34, needed: 66 })
    expect(seats.slice(0, 34).every((seat) => seat.state === 'heard')).toBe(
      true,
    )
    // Left to right: the first seat sits left of the last.
    expect(seats[0]?.x ?? 0).toBeLessThan(seats[99]?.x ?? 0)
  })

  it('scales to the 100 seats when the read needs fewer people', () => {
    expect(
      tally(read({ representativeAnswers: 15, representativeNeeded: 50 })),
    ).toEqual({ heard: 30, needed: 70 })
    expect(
      tally(read({ representativeAnswers: 50, representativeNeeded: 50 })),
    ).toEqual({ heard: 100 })
  })

  it('never fills the arc while an answer is needed, nor leaves it empty once one is in', () => {
    expect(
      tally(read({ representativeAnswers: 199, representativeNeeded: 200 })),
    ).toEqual({ heard: 99, needed: 1 })
    expect(
      tally(read({ representativeAnswers: 1, representativeNeeded: 300 })),
    ).toEqual({ heard: 1, needed: 99 })
    expect(tally(read({ representativeAnswers: 0 }))).toEqual({ needed: 100 })
  })

  it('reads an older read with no counted answers from everyone who answered', () => {
    expect(
      tally(
        read({
          representativeAnswers: undefined,
          representativeNeeded: undefined,
        }),
      ),
    ).toEqual({ heard: 40, needed: 60 })
  })
})
