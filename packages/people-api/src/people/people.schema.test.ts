import { describe, expect, it } from 'vitest'
import {
  aggregatesSchema,
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

  // ENG-10830: completing the party rule (ENG-10696) plus suppressing
  // turnout propensity and vote history for Serve downloads.
  it('accepts every ENG-10830 excludeColumns entry on the download query', () => {
    const parsed = downloadPeopleSchema.parse({
      districtId: DISTRICT_ID,
      filters: {},
      excludeColumns: [
        'Residence_HHParties_Description',
        'VoterParties_Change_Changed_Party',
        'VotingPerformanceEvenYearGeneral',
        'VotingPerformanceEvenYearPrimary',
        'VotingPerformanceEvenYearGeneralAndPrimary',
        'General_2026',
        'General_2024',
        'General_2022',
        'General_2020',
        'Primary_2026',
        'Primary_2024',
        'Primary_2022',
        'Primary_2020',
      ],
    })
    expect(parsed.excludeColumns).toHaveLength(13)
  })

  it('accepts districtId getPerson query', () => {
    const parsed = getPersonQuerySchema.parse({
      districtId: DISTRICT_ID,
    })
    expect(parsed.districtId).toBe(DISTRICT_ID)
  })

  const PERSON_ID = '11111111-1111-1111-1111-111111111111'

  it('accepts an id.in filter', () => {
    const parsed = listPeopleSchema.parse({
      districtId: DISTRICT_ID,
      filters: { id: { in: [PERSON_ID] } },
    })

    expect(parsed.filters.filterOperators.id).toEqual({
      operator: 'in',
      values: [PERSON_ID],
      includeNull: false,
    })
  })

  it('accepts an id.notIn filter', () => {
    const parsed = listPeopleSchema.parse({
      districtId: DISTRICT_ID,
      filters: { id: { notIn: [PERSON_ID] } },
    })

    expect(parsed.filters.filterOperators.id).toEqual({
      operator: 'notIn',
      values: [PERSON_ID],
    })
  })

  it('rejects id.in and id.notIn specified together', () => {
    expect(() =>
      listPeopleSchema.parse({
        districtId: DISTRICT_ID,
        filters: { id: { in: [PERSON_ID], notIn: [PERSON_ID] } },
      }),
    ).toThrow()
  })

  it('rejects an empty id filter object', () => {
    expect(() =>
      listPeopleSchema.parse({
        districtId: DISTRICT_ID,
        filters: { id: {} },
      }),
    ).toThrow()
  })

  it('rejects an id filter array over the 100,000 cap', () => {
    const tooMany = Array.from({ length: 100_001 }, () => PERSON_ID)

    expect(() =>
      listPeopleSchema.parse({
        districtId: DISTRICT_ID,
        filters: { id: { in: tooMany } },
      }),
    ).toThrow()
  })

  it('accepts a hasAddress filter', () => {
    const parsed = listPeopleSchema.parse({
      districtId: DISTRICT_ID,
      filters: { hasAddress: true },
    })

    expect(parsed.filters.filterOperators.hasAddress).toEqual({
      operator: 'is',
      value: 'not_null',
    })
  })

  it('accepts id and hasAddress filters on the download query (shared schema)', () => {
    const parsed = downloadPeopleSchema.parse({
      districtId: DISTRICT_ID,
      filters: { id: { in: [PERSON_ID] }, hasAddress: false },
    })

    expect(parsed.filters.filterOperators.id).toEqual({
      operator: 'in',
      values: [PERSON_ID],
      includeNull: false,
    })
    expect(parsed.filters.filterOperators.hasAddress).toEqual({
      operator: 'is',
      value: 'null',
    })
  })

  it('accepts districtId + filters on the aggregates request', () => {
    const parsed = aggregatesSchema.parse({
      districtId: DISTRICT_ID,
      filters: { id: { in: [PERSON_ID] }, hasCellPhone: true },
    })

    expect(parsed.districtId).toBe(DISTRICT_ID)
    expect(parsed.filters.filterOperators.id).toEqual({
      operator: 'in',
      values: [PERSON_ID],
      includeNull: false,
    })
    expect(parsed.filters.filterOperators.hasCellPhone).toEqual({
      operator: 'is',
      value: 'not_null',
    })
  })

  it('rejects the aggregates request without a districtId', () => {
    expect(() => aggregatesSchema.parse({ filters: {} })).toThrow()
  })

  describe('idOverrides (ENG-10838)', () => {
    const INCLUDED_ID = '22222222-2222-2222-2222-222222222222'
    const EXCLUDED_ID = '33333333-3333-3333-3333-333333333333'

    it('accepts include/exclude on the list request and is optional', () => {
      const withOverrides = listPeopleSchema.parse({
        districtId: DISTRICT_ID,
        filters: {},
        idOverrides: { include: [INCLUDED_ID], exclude: [EXCLUDED_ID] },
      })
      expect(withOverrides.idOverrides).toEqual({
        include: [INCLUDED_ID],
        exclude: [EXCLUDED_ID],
      })

      const withoutOverrides = listPeopleSchema.parse({
        districtId: DISTRICT_ID,
        filters: {},
      })
      expect(withoutOverrides.idOverrides).toBeUndefined()
    })

    it('accepts idOverrides on download and aggregates requests', () => {
      expect(
        downloadPeopleSchema.parse({
          districtId: DISTRICT_ID,
          filters: {},
          idOverrides: { include: [INCLUDED_ID] },
        }).idOverrides,
      ).toEqual({ include: [INCLUDED_ID] })

      expect(
        aggregatesSchema.parse({
          districtId: DISTRICT_ID,
          filters: {},
          idOverrides: { exclude: [EXCLUDED_ID] },
        }).idOverrides,
      ).toEqual({ exclude: [EXCLUDED_ID] })
    })

    it('rejects a non-uuid entry in include/exclude', () => {
      expect(() =>
        listPeopleSchema.parse({
          districtId: DISTRICT_ID,
          filters: {},
          idOverrides: { include: ['not-a-uuid'] },
        }),
      ).toThrow()
    })
  })
})
