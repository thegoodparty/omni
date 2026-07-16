import { describe, expect, it } from 'vitest'
import {
  downloadPeopleSchema,
  getPersonQuerySchema,
  listPeopleSchema,
  samplePeopleSchema,
  StatsDTO,
} from './people.schema'

const DISTRICT_ID = '0e5bafca-93a9-86a5-2522-f373979720df'

describe('people query schemas', () => {
  it('accepts districtId list query', () => {
    const parsed = listPeopleSchema.parse({
      districtId: DISTRICT_ID,
      filters: {},
    })

    expect(parsed.districtId).toBe(DISTRICT_ID)
  })

  it('rejects missing districtId', () => {
    expect(() =>
      listPeopleSchema.parse({
        filters: {},
      }),
    ).toThrow()
  })

  it('rejects invalid districtId format', () => {
    expect(() =>
      listPeopleSchema.parse({
        districtId: 'not-a-uuid',
        filters: {},
      }),
    ).toThrow()
  })

  it('defaults resultsPerPage and page when omitted', () => {
    const parsed = listPeopleSchema.parse({
      districtId: DISTRICT_ID,
      filters: {},
    })

    expect(parsed.resultsPerPage).toBe(50)
    expect(parsed.page).toBe(1)
  })

  it('rejects an unbounded resultsPerPage (full-dataset extraction / OOM)', () => {
    expect(() =>
      listPeopleSchema.parse({
        districtId: DISTRICT_ID,
        filters: {},
        resultsPerPage: 100000000,
      }),
    ).toThrow()
  })

  it('rejects a non-positive page (negative SQL OFFSET)', () => {
    expect(() =>
      listPeopleSchema.parse({
        districtId: DISTRICT_ID,
        filters: {},
        page: 0,
      }),
    ).toThrow()
  })

  it('rejects an excessively deep page (enormous SQL OFFSET / full scan)', () => {
    expect(() =>
      listPeopleSchema.parse({
        districtId: DISTRICT_ID,
        filters: {},
        page: 2147483647,
      }),
    ).toThrow()
  })

  it('accepts resultsPerPage at the max bound', () => {
    const parsed = listPeopleSchema.parse({
      districtId: DISTRICT_ID,
      filters: {},
      resultsPerPage: 10000,
    })

    expect(parsed.resultsPerPage).toBe(10000)
  })

  it('rejects a page × resultsPerPage offset beyond the cap', () => {
    // (201 - 1) * 10000 = 2,000,000 > 1,000,000.
    expect(() =>
      listPeopleSchema.parse({
        districtId: DISTRICT_ID,
        filters: {},
        page: 201,
        resultsPerPage: 10000,
      }),
    ).toThrow()
  })

  it('accepts districtId stats query', () => {
    const parsed = StatsDTO.create({ districtId: DISTRICT_ID })
    expect(parsed.districtId).toBe(DISTRICT_ID)
  })

  it('accepts districtId sample query', () => {
    const parsed = samplePeopleSchema.parse({
      districtId: DISTRICT_ID,
      size: 25,
    })
    expect(parsed.districtId).toBe(DISTRICT_ID)
    expect(parsed.size).toBe(25)
  })

  it('accepts districtId download query', () => {
    const parsed = downloadPeopleSchema.parse({
      districtId: DISTRICT_ID,
      filters: {},
    })
    expect(parsed.districtId).toBe(DISTRICT_ID)
    expect(parsed.excludeColumns).toBeUndefined()
  })

  // ENG-10696: bounded to a known-safe enum — never an arbitrary
  // caller-supplied column name reaching raw SQL.
  it('accepts a known excludeColumns entry on the download query', () => {
    const parsed = downloadPeopleSchema.parse({
      districtId: DISTRICT_ID,
      filters: {},
      excludeColumns: ['Parties_Description'],
    })
    expect(parsed.excludeColumns).toEqual(['Parties_Description'])
  })

  it('rejects an excludeColumns entry outside the known-safe enum', () => {
    expect(() =>
      downloadPeopleSchema.parse({
        districtId: DISTRICT_ID,
        filters: {},
        excludeColumns: ['LALVOTERID'],
      }),
    ).toThrow()
  })

  it('accepts districtId getPerson query', () => {
    const parsed = getPersonQuerySchema.parse({
      districtId: DISTRICT_ID,
    })
    expect(parsed.districtId).toBe(DISTRICT_ID)
  })
})
