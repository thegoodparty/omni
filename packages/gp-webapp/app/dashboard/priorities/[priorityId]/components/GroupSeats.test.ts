import { describe, expect, it } from 'vitest'
import type { PriorityReadStatus } from '@goodparty_org/contracts'
import { groupSeats } from './GroupSeats'

const read = (over: Partial<PriorityReadStatus>): PriorityReadStatus => ({
  answers: 30,
  needed: 100,
  groupsHeard: 7,
  groupsTotal: 20,
  groupsNext: 2,
  good: false,
  status: 'notYetRepresentative',
  underrepresented: ['age65plus'],
  checkOut: true,
  ...over,
})

const tally = (r: PriorityReadStatus) =>
  groupSeats(r).reduce<Record<string, number>>((acc, seat) => {
    acc[seat.state] = (acc[seat.state] ?? 0) + 1
    return acc
  }, {})

describe('groupSeats', () => {
  it('gives each group an equal block of the 100 seats, heard first', () => {
    const seats = groupSeats(read({}))
    expect(seats).toHaveLength(100)
    expect(tally(read({}))).toEqual({ heard: 35, next: 10, notYet: 55 })
    expect(seats.slice(0, 35).every((seat) => seat.state === 'heard')).toBe(
      true,
    )
    // Left to right: the first seat sits left of the last.
    expect(seats[0]?.x ?? 0).toBeLessThan(seats[99]?.x ?? 0)
  })

  it('spreads the remainder when the groups do not divide 100', () => {
    expect(
      tally(read({ groupsTotal: 12, groupsHeard: 12, groupsNext: 0 })),
    ).toEqual({ heard: 100 })
    const third = tally(read({ groupsTotal: 3, groupsHeard: 1, groupsNext: 1 }))
    expect((third.heard ?? 0) + (third.next ?? 0) + (third.notYet ?? 0)).toBe(
      100,
    )
    expect(third.heard).toBe(34)
  })

  it('reads an older read with no groups next as heard and not yet', () => {
    expect(tally(read({ groupsNext: undefined }))).toEqual({
      heard: 35,
      notYet: 65,
    })
  })

  it('never counts more groups next than are left unheard', () => {
    expect(tally(read({ groupsHeard: 19, groupsNext: 5 }))).toEqual({
      heard: 95,
      next: 5,
    })
  })
})
