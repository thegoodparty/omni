import { describe, expect, it } from 'vitest'
import { answersNeeded } from '@goodparty_org/contracts'
import type { MrpGroupEstimate } from './mrp.util'
import {
  holdingBackTracts,
  mrpReadStatus,
  type MrpRead,
} from './mrpReadStatus.util'

const group = (
  dimension: string,
  value: string,
  share: number,
  answers: number,
  width = 0.1,
): MrpGroupEstimate => ({
  dimension,
  value,
  share,
  answers,
  mean: 0.5,
  low: 0.5 - width / 2,
  high: 0.5 + width / 2,
})

const read = (
  groups: MrpGroupEstimate[],
  raceNameable = true,
  floor = 0,
): MrpRead => ({
  result: { district: { mean: 0.5, low: 0.45, high: 0.55 }, groups },
  raceNameable,
  answersNeeded: floor,
})

// Six age bands, two sexes and twelve tracts, the smallest holding 3% of the
// district: twenty major groups, each with at least three of the 40
// answers, every range tight.
const TWENTY_GROUPS = (scale = 1): MrpGroupEstimate[] => [
  ...[7, 7, 7, 7, 6, 6].map((answers, i) =>
    group('age', `band${i}`, 1 / 6, answers * scale, 0.15),
  ),
  group('gender', 'male', 0.5, 20 * scale, 0.15),
  group('gender', 'female', 0.5, 20 * scale, 0.15),
  ...[4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3].map((answers, i) =>
    group(
      'tract',
      `tract${i}`,
      i === 0 ? 0.03 : 0.97 / 11,
      answers * scale,
      0.15,
    ),
  ),
]

const AGES = (younger: number, older: number, width = 0.1) => [
  group('age', '18to64', 0.8, younger, width),
  group('age', '65plus', 0.2, older, width),
]

describe('holdingBackTracts', () => {
  it('names the tracts short of voices or still unsure, never a small one', () => {
    expect(
      holdingBackTracts(
        read([
          group('tract', 'short', 0.4, 2),
          group('tract', 'unsure', 0.3, 20, 0.4),
          group('tract', 'fine', 0.2, 20),
          group('tract', 'small', 0.02, 0),
          group('age', '65plus', 0.2, 0),
        ]),
      ),
    ).toEqual(['short', 'unsure'])
    expect(holdingBackTracts(null)).toEqual([])
  })
})

describe('mrpReadStatus', () => {
  it('is too early while a major group has no answer, and names it', () => {
    const status = mrpReadStatus({
      answers: 12,
      read: read(AGES(12, 0)),
    })
    expect(status).toEqual({
      answers: 12,
      needed: 15,
      groupsHeard: 1,
      groupsTotal: 2,
      good: false,
      status: 'tooEarly',
      underrepresented: ['age65plus'],
      unheard: ['age65plus'],
    })
  })

  it('is not yet representative while a major group has fewer than 3', () => {
    const status = mrpReadStatus({
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

  it('is getting close while a major group is still unsure', () => {
    const status = mrpReadStatus({
      answers: 40,
      read: read([
        group('age', '18to64', 0.8, 30, 0.12),
        group('age', '65plus', 0.2, 10, 0.3),
      ]),
    })
    expect(status).toEqual({
      answers: 40,
      needed: 40,
      groupsHeard: 2,
      groupsTotal: 2,
      good: false,
      status: 'gettingClose',
      underrepresented: ['age65plus'],
      unheard: [],
    })
  })

  it('is a good read once every major group is heard and sure', () => {
    const status = mrpReadStatus({
      answers: 60,
      read: read(AGES(45, 15, 0.18)),
    })
    expect(status).toEqual({
      answers: 60,
      needed: 60,
      groupsHeard: 2,
      groupsTotal: 2,
      good: true,
      status: 'representative',
      underrepresented: [],
      unheard: [],
    })
  })

  it('leaves out groups under 3% of the district, and other', () => {
    const status = mrpReadStatus({
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
    const named = mrpReadStatus({
      answers: 20,
      read: read(groups, true),
    })
    const unnamed = mrpReadStatus({
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
    const status = mrpReadStatus({
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
    const status = mrpReadStatus({
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

  it('counts the parts of the district as unheard when any one has no answer', () => {
    const status = mrpReadStatus({
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
    const status = mrpReadStatus({
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
    const status = mrpReadStatus({
      answers: 40,
      read: read(TWENTY_GROUPS(), false, floor),
    })
    expect(floor).toBe(100)
    expect(status).toEqual({
      answers: 40,
      needed: 100,
      groupsHeard: 20,
      groupsTotal: 20,
      good: false,
      status: 'notYetRepresentative',
      underrepresented: [],
      unheard: [],
    })
  })

  it('is representative at the floor once every group is heard and sure', () => {
    const status = mrpReadStatus({
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
      mrpReadStatus({ answers: 14, read: read(AGES(12, 2), true, 15) }).needed,
    ).toBe(15)
    expect(
      mrpReadStatus({ answers: 14, read: read(AGES(14, 0), true, 15) }).needed,
    ).toBe(17)
  })

  it('says enough answers, never representative, when the district could not be read', () => {
    expect(mrpReadStatus({ answers: 100, read: null })).toEqual({
      answers: 100,
      needed: 100,
      groupsHeard: 0,
      groupsTotal: 0,
      good: true,
      status: 'enoughAnswers',
      underrepresented: [],
      unheard: [],
    })
    expect(mrpReadStatus({ answers: 12, read: null })).toMatchObject({
      needed: 100,
      good: false,
      status: 'tooEarly',
    })
  })

  it('reads the count alone when the district has no group to hear from', () => {
    expect(mrpReadStatus({ answers: 0, read: read([]) })).toMatchObject({
      needed: 100,
      status: 'tooEarly',
    })
  })
})
