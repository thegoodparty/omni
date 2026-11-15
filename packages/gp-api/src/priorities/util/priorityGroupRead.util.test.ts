import { describe, expect, it } from 'vitest'
import { answersNeeded } from '@goodparty_org/contracts'
import {
  countGroups,
  groupReadStatus,
  holdingBackTracts,
  type GroupCount,
  type PriorityGroupRead,
} from './priorityGroupRead.util'

const group = (
  dimension: string,
  value: string,
  share: number,
  answers: number,
): GroupCount => ({ dimension, value, share, answers })

const read = (
  groups: GroupCount[],
  raceNameable = true,
  floor = 0,
): PriorityGroupRead => ({
  result: { groups },
  raceNameable,
  answersNeeded: floor,
})

// Six age bands, two sexes and twelve tracts, the smallest holding 3% of the
// district: twenty major groups, each with at least three of the 40
// answers.
const TWENTY_GROUPS = (scale = 1): GroupCount[] => [
  ...[7, 7, 7, 7, 6, 6].map((answers, i) =>
    group('age', `band${i}`, 1 / 6, answers * scale),
  ),
  group('gender', 'male', 0.5, 20 * scale),
  group('gender', 'female', 0.5, 20 * scale),
  ...[4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3].map((answers, i) =>
    group('tract', `tract${i}`, i === 0 ? 0.03 : 0.97 / 11, answers * scale),
  ),
]

const AGES = (younger: number, older: number) => [
  group('age', '18to64', 0.8, younger),
  group('age', '65plus', 0.2, older),
]

describe('countGroups', () => {
  it("counts each value's share of the district and the answers in it", () => {
    expect(
      countGroups(
        [
          { count: 600, values: { tract: 't1', age: '18to64' } },
          { count: 200, values: { tract: 't2', age: '18to64' } },
          { count: 200, values: { tract: 't2', age: '65plus' } },
          { count: 0, values: { tract: 't3', age: '65plus' } },
        ],
        [
          { answers: 4, values: { tract: 't1', age: '18to64' } },
          { answers: 2, values: { tract: 't2', age: null } },
          { answers: 1, values: { tract: 't9', age: '65plus' } },
        ],
      ),
    ).toEqual([
      group('age', '18to64', 0.8, 4),
      group('age', '65plus', 0.2, 1),
      group('tract', 't1', 0.6, 4),
      group('tract', 't2', 0.4, 2),
    ])
  })
})

describe('holdingBackTracts', () => {
  it('names the major tracts short of voices, never a small one', () => {
    expect(
      holdingBackTracts(
        read([
          group('tract', 'short', 0.4, 2),
          group('tract', 'unheard', 0.3, 0),
          group('tract', 'fine', 0.2, 3),
          group('tract', 'small', 0.02, 0),
          group('age', '65plus', 0.2, 0),
        ]),
      ),
    ).toEqual(['short', 'unheard'])
    expect(holdingBackTracts(null)).toEqual([])
  })
})

describe('groupReadStatus', () => {
  it('is too early while a major group has no answer, and names it', () => {
    const status = groupReadStatus({
      answers: 12,
      read: read(AGES(12, 0)),
    })
    expect(status).toEqual({
      answers: 12,
      needed: 15,
      groupsHeard: 1,
      groupsTotal: 2,
      groupsNext: 1,
      representativeAnswers: 12,
      representativeNeeded: 15,
      good: false,
      status: 'tooEarly',
      underrepresented: ['age65plus'],
      unheard: ['age65plus'],
    })
  })

  it('is not yet representative while a major group has fewer than 3', () => {
    const status = groupReadStatus({
      answers: 14,
      read: read(AGES(12, 2)),
    })
    expect(status).toMatchObject({
      status: 'notYetRepresentative',
      needed: 15,
      good: false,
      underrepresented: ['age65plus'],
      unheard: [],
    })
  })

  it('is a good read once every major group has three and the floor is met', () => {
    const status = groupReadStatus({
      answers: 15,
      read: read(AGES(12, 3), true, 15),
    })
    expect(status).toEqual({
      answers: 15,
      needed: 15,
      groupsHeard: 2,
      groupsTotal: 2,
      groupsNext: 0,
      representativeAnswers: 15,
      representativeNeeded: 15,
      good: true,
      status: 'representative',
      underrepresented: [],
      unheard: [],
    })
  })

  it('names only the groups short of voices, largest first, two at most', () => {
    const status = groupReadStatus({
      answers: 30,
      read: read([
        group('age', '18to64', 0.8, 28),
        group('age', '65plus', 0.2, 2),
        group('gender', 'female', 0.5, 29),
        group('gender', 'male', 0.5, 1),
        group('race', 'white', 0.6, 30),
        group('race', 'black', 0.3, 0),
      ]),
    })
    expect(status).toMatchObject({
      status: 'tooEarly',
      groupsHeard: 3,
      groupsTotal: 6,
      underrepresented: ['men', 'black'],
      unheard: ['black'],
    })
  })

  it('is a good read once every major group is heard', () => {
    const status = groupReadStatus({
      answers: 60,
      read: read(AGES(45, 15)),
    })
    expect(status).toEqual({
      answers: 60,
      needed: 60,
      groupsHeard: 2,
      groupsTotal: 2,
      groupsNext: 0,
      representativeAnswers: 15,
      representativeNeeded: 15,
      good: true,
      status: 'representative',
      underrepresented: [],
      unheard: [],
    })
  })

  it('leaves out groups under 3% of the district, and other', () => {
    const status = groupReadStatus({
      answers: 20,
      read: read([
        ...AGES(15, 5),
        group('race', 'asian', 0.02, 0),
        group('race', 'other', 0.1, 0),
      ]),
    })
    expect(status.status).toBe('representative')
  })

  it('counts race only when race may be named, never naming it otherwise', () => {
    const groups = [...AGES(15, 5), group('race', 'black', 0.25, 1)]
    const named = groupReadStatus({
      answers: 20,
      read: read(groups, true),
    })
    const unnamed = groupReadStatus({
      answers: 20,
      read: read(groups, false),
    })
    expect(named).toMatchObject({
      status: 'notYetRepresentative',
      needed: 22,
      underrepresented: ['black'],
    })
    expect(unnamed).toMatchObject({
      status: 'representative',
      needed: 20,
      underrepresented: [],
    })
  })

  it('names every tract as the parts not reached, once', () => {
    const status = groupReadStatus({
      answers: 10,
      read: read([
        ...AGES(8, 2),
        group('tract', '53017950100', 0.5, 10),
        group('tract', '53017950200', 0.3, 0),
        group('tract', '53017950300', 0.2, 0),
      ]),
    })
    expect(status).toMatchObject({
      status: 'tooEarly',
      underrepresented: ['unreachedAreas', 'age65plus'],
      unheard: ['unreachedAreas'],
    })
  })

  it('says which named groups have no answer at all, apart from those with a few', () => {
    const status = groupReadStatus({
      answers: 14,
      read: read([
        ...AGES(12, 2),
        group('gender', 'male', 0.5, 0),
        group('gender', 'female', 0.5, 14),
      ]),
    })
    expect(status).toMatchObject({
      status: 'tooEarly',
      underrepresented: ['men', 'age65plus'],
      unheard: ['men'],
    })
  })

  it('counts each group short of voices among those named as needed next', () => {
    const status = groupReadStatus({
      answers: 12,
      read: read([
        ...AGES(10, 2),
        group('tract', '53017950100', 0.5, 9),
        group('tract', '53017950200', 0.3, 2),
        group('tract', '53017950300', 0.2, 1),
      ]),
    })
    expect(status).toMatchObject({
      groupsHeard: 2,
      groupsTotal: 5,
      groupsNext: 3,
    })
    expect(status.underrepresented).toHaveLength(2)
  })

  it('counts the parts of the district as unheard when any one has no answer', () => {
    const status = groupReadStatus({
      answers: 12,
      read: read([
        ...AGES(9, 3),
        group('tract', '53017950100', 0.5, 9),
        group('tract', '53017950200', 0.3, 2),
        group('tract', '53017950300', 0.2, 0),
      ]),
    })
    expect(status.unheard).toEqual(['unreachedAreas'])
  })

  it('needs the answers the dimension furthest short is missing', () => {
    const status = groupReadStatus({
      answers: 5,
      read: read([
        ...AGES(5, 0),
        group('gender', 'female', 0.5, 2),
        group('gender', 'male', 0.5, 3),
        group('tract', '53017950100', 0.4, 5),
        group('tract', '53017950200', 0.3, 0),
        group('tract', '53017950300', 0.3, 0),
      ]),
    })
    expect(status.needed).toBe(11)
  })

  it('is not yet representative under the district floor, however the groups split', () => {
    const floor = answersNeeded(0.03)
    const status = groupReadStatus({
      answers: 40,
      read: read(TWENTY_GROUPS(), false, floor),
    })
    expect(floor).toBe(100)
    expect(status).toEqual({
      answers: 40,
      needed: 100,
      groupsHeard: 20,
      groupsTotal: 20,
      groupsNext: 0,
      representativeAnswers: 39,
      representativeNeeded: 100,
      good: false,
      status: 'notYetRepresentative',
      underrepresented: [],
      unheard: [],
    })
  })

  it('is representative at the floor once every group is heard', () => {
    const status = groupReadStatus({
      answers: 100,
      read: read(TWENTY_GROUPS(2.5), false, 100),
    })
    expect(status).toMatchObject({
      needed: 100,
      good: true,
      status: 'representative',
    })
  })

  it('needs whichever is further off, the floor or the groups', () => {
    expect(
      groupReadStatus({ answers: 14, read: read(AGES(12, 2), true, 15) })
        .needed,
    ).toBe(15)
    expect(
      groupReadStatus({ answers: 14, read: read(AGES(14, 0), true, 15) })
        .needed,
    ).toBe(17)
  })

  it('says enough answers, never representative, when the district could not be read', () => {
    expect(groupReadStatus({ answers: 100, read: null })).toEqual({
      answers: 100,
      needed: 100,
      groupsHeard: 0,
      groupsTotal: 0,
      groupsNext: 0,
      representativeAnswers: 100,
      representativeNeeded: 100,
      good: true,
      status: 'enoughAnswers',
      underrepresented: [],
      unheard: [],
    })
    expect(groupReadStatus({ answers: 12, read: null })).toMatchObject({
      needed: 100,
      good: false,
      status: 'tooEarly',
    })
  })

  it('counts an answer only while its group is within its share of the floor', () => {
    // 65 and over is 20% of the district, so 20 of the 100 the floor needs.
    // Its 30 answers fill 20 seats; the other 10 count for nothing more.
    const status = groupReadStatus({
      answers: 60,
      read: read(AGES(30, 30), true, 100),
    })
    expect(status).toMatchObject({
      representativeAnswers: 50,
      representativeNeeded: 100,
      status: 'notYetRepresentative',
    })
  })

  it('takes the dimension furthest behind, since one answer counts on each', () => {
    const status = groupReadStatus({
      answers: 40,
      read: read(
        [
          ...AGES(32, 8),
          group('gender', 'female', 0.5, 35),
          group('gender', 'male', 0.5, 5),
        ],
        true,
        50,
      ),
    })
    // Ages: 32 of 40 and 8 of 10. Gender: 25 of 25 and 5 of 25.
    expect(status).toMatchObject({
      representativeAnswers: 30,
      representativeNeeded: 50,
    })
  })

  it('counts the known on a dimension, so unknowns never leave a seat unfillable', () => {
    const status = groupReadStatus({
      answers: 15,
      read: read(
        [group('age', '18to64', 0.6, 12), group('age', '65plus', 0.15, 3)],
        true,
        20,
      ),
    })
    // Of the 75% whose age is known: 80% and 20% of the 20 needed.
    expect(status).toMatchObject({
      representativeAnswers: 15,
      representativeNeeded: 20,
      status: 'notYetRepresentative',
    })
  })

  it('gives a small group or the pooled rest no seats to hold empty', () => {
    // Race splits 60/30, with 2% Asian and 8% other the read never decides
    // on. Neither has an answer, but neither holds a seat back: 18 and 9 of
    // the 30 the majors share fill 27.
    const status = groupReadStatus({
      answers: 27,
      read: read(
        [
          ...AGES(21, 6),
          group('race', 'white', 0.6, 18),
          group('race', 'black', 0.3, 9),
          group('race', 'asian', 0.02, 0),
          group('race', 'other', 0.08, 0),
        ],
        true,
        30,
      ),
    })
    expect(status).toMatchObject({
      representativeAnswers: 27,
      representativeNeeded: 30,
      status: 'notYetRepresentative',
    })
  })

  it('fills every seat on a good read, however its answers split', () => {
    // 65 and over has its voices, but under its share.
    const status = groupReadStatus({
      answers: 60,
      read: read(AGES(54, 6), true, 15),
    })
    expect(status).toMatchObject({
      good: true,
      representativeAnswers: 15,
      representativeNeeded: 15,
    })
  })

  it('reads the count alone when the district has no group to hear from', () => {
    expect(groupReadStatus({ answers: 0, read: read([]) })).toMatchObject({
      needed: 100,
      status: 'tooEarly',
    })
  })
})
