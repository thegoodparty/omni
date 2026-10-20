import { describe, expect, it } from 'vitest'
import type { MrpGroupEstimate } from './mrp.util'
import { mrpReadStatus, type MrpRead } from './mrpReadStatus.util'

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

const read = (groups: MrpGroupEstimate[], raceNameable = true): MrpRead => ({
  result: { district: { mean: 0.5, low: 0.45, high: 0.55 }, groups },
  raceNameable,
})

const AGES = (younger: number, older: number, width = 0.1) => [
  group('age', '18to64', 0.8, younger, width),
  group('age', '65plus', 0.2, older, width),
]

describe('mrpReadStatus', () => {
  it('is too early while a major group has no answer, and names it', () => {
    const status = mrpReadStatus({
      answers: 12,
      population: 2_000,
      read: read(AGES(12, 0)),
    })
    expect(status).toEqual({
      answers: 12,
      needed: 15,
      good: false,
      status: 'tooEarly',
      underrepresented: ['age65plus'],
    })
  })

  it('is not yet representative while a major group has fewer than 3', () => {
    const status = mrpReadStatus({
      answers: 14,
      population: 2_000,
      read: read(AGES(12, 2)),
    })
    expect(status).toMatchObject({
      status: 'notYetRepresentative',
      needed: 15,
      good: false,
      underrepresented: ['age65plus'],
    })
  })

  it('is getting close while a major group is still unsure', () => {
    const status = mrpReadStatus({
      answers: 40,
      population: 2_000,
      read: read([
        group('age', '18to64', 0.8, 30, 0.12),
        group('age', '65plus', 0.2, 10, 0.3),
      ]),
    })
    expect(status).toEqual({
      answers: 40,
      needed: 40,
      good: false,
      status: 'gettingClose',
      underrepresented: ['age65plus'],
    })
  })

  it('is a good read once every major group is heard and sure', () => {
    const status = mrpReadStatus({
      answers: 60,
      population: 2_000,
      read: read(AGES(45, 15, 0.18)),
    })
    expect(status).toEqual({
      answers: 60,
      needed: 60,
      good: true,
      status: 'representative',
      underrepresented: [],
    })
  })

  it('leaves out groups under 3% of the district, and other', () => {
    const status = mrpReadStatus({
      answers: 20,
      population: 2_000,
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
      population: 2_000,
      read: read(groups, true),
    })
    const unnamed = mrpReadStatus({
      answers: 20,
      population: 2_000,
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
      population: 2_000,
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
    })
  })

  it('needs the answers the dimension furthest short is missing', () => {
    const status = mrpReadStatus({
      answers: 5,
      population: 2_000,
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

  it('says enough answers, never representative, when the district could not be read', () => {
    expect(
      mrpReadStatus({ answers: 92, population: 2_000, read: null }),
    ).toEqual({
      answers: 92,
      needed: 92,
      good: true,
      status: 'enoughAnswers',
      underrepresented: [],
    })
    expect(
      mrpReadStatus({ answers: 12, population: null, read: null }),
    ).toMatchObject({ needed: 96, good: false, status: 'tooEarly' })
  })

  it('reads the count alone when the district has no group to hear from', () => {
    expect(
      mrpReadStatus({ answers: 0, population: 2_000, read: read([]) }),
    ).toMatchObject({ needed: 92, status: 'tooEarly' })
  })
})
