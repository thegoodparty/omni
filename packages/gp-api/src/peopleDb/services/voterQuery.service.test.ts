import { NotFoundException } from '@nestjs/common'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { Prisma } from '../../generated/people-prisma'
import { VoterQueryService } from './voterQuery.service'
import type { PeopleDbService } from '../peopleDb.service'

const makeDbPerson = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'person-1',
    LALVOTERID: 'lal-1',
    State: 'WY',
    FirstName: 'Jane',
    MiddleName: null,
    LastName: 'Doe',
    NameSuffix: null,
    Residence_Addresses_AddressLine: null,
    Residence_Addresses_ExtraAddressLine: null,
    Residence_Addresses_City: null,
    Residence_Addresses_State: 'WY',
    Residence_Addresses_Zip: null,
    Residence_Addresses_ZipPlus4: null,
    Mailing_Addresses_AddressLine: null,
    Mailing_Addresses_ExtraAddressLine: null,
    Mailing_Addresses_City: null,
    Mailing_Addresses_State: null,
    Mailing_Addresses_Zip: null,
    Mailing_Addresses_ZipPlus4: null,
    Residence_Addresses_Latitude: null,
    Residence_Addresses_Longitude: null,
    VoterTelephones_LandlineFormatted: null,
    VoterTelephones_CellPhoneFormatted: null,
    Age: null,
    Gender: null,
    Parties_Description: null,
    Business_Owner: null,
    Education_Of_Person: null,
    Estimated_Income_Amount_Int: null,
    Homeowner_Probability_Model: null,
    Language_Code: null,
    Marital_Status: null,
    Presence_Of_Children: null,
    Veteran_Status: null,
    Voter_Status: null,
    EthnicGroups_EthnicGroup1Desc: null,
    Age_Int: null,
    VotingPerformanceEvenYearGeneral: null,
    VotingPerformanceMinorElection: null,
    ...overrides,
  }) as never

// Mirrors the real Prisma raw-query error for SQLSTATE 57014 (statement
// cancelled by statement_timeout).
const statementTimeoutError = () =>
  new Prisma.PrismaClientKnownRequestError(
    'Raw query failed. Code: `57014`. Message: `canceling statement due to statement timeout`',
    { code: 'P2010', clientVersion: 'test', meta: { code: '57014' } },
  )

describe('VoterQueryService', () => {
  let service: VoterQueryService
  let mockSampleService: { samplePeople: ReturnType<typeof vi.fn> }
  let mockDistrictService: {
    findDistrictById: ReturnType<typeof vi.fn>
  }
  let mockStatsService: {
    getTotalCounts: ReturnType<typeof vi.fn>
    findTotalConstituents: ReturnType<typeof vi.fn>
  }
  let mockClient: {
    $queryRaw: ReturnType<typeof vi.fn>
    $executeRaw: ReturnType<typeof vi.fn>
    $transaction: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockSampleService = {
      samplePeople: vi.fn().mockResolvedValue([]),
    }
    mockDistrictService = {
      findDistrictById: vi.fn().mockResolvedValue({
        id: '0e5bafca-93a9-86a5-2522-f373979720df',
        type: 'City_Ward',
        name: 'CHEYENNE CITY WARD 1',
        state: 'WY',
      }),
    }
    mockStatsService = {
      getTotalCounts: vi.fn().mockResolvedValue({
        totalConstituents: 120,
        totalConstituentsWithCellPhone: 80,
      }),
      findTotalConstituents: vi.fn().mockResolvedValue(null),
    }
    mockClient = {
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn().mockResolvedValue(0),
      $transaction: vi
        .fn()
        .mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    }

    service = new VoterQueryService(
      mockSampleService as never,
      mockDistrictService as never,
      mockStatsService as never,
    )
    ;(service as unknown as { _peopleDb: PeopleDbService })._peopleDb = {
      get instance() {
        return mockClient
      },
    } as unknown as PeopleDbService
  })

  describe('findPeople query modes and pagination', () => {
    it('resolves district by id and uses fast count path', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([makeDbPerson()])

      const result = await service.findPeople({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: { filters: [], filterOperators: {} },
        resultsPerPage: 10,
        page: 1,
      } as never)

      expect(mockDistrictService.findDistrictById).toHaveBeenCalledWith(
        '0e5bafca-93a9-86a5-2522-f373979720df',
      )
      expect(mockStatsService.getTotalCounts).toHaveBeenCalledWith(
        '0e5bafca-93a9-86a5-2522-f373979720df',
      )
      expect(result.pagination.totalResults).toBe(120)
      expect(result.pagination.totalPages).toBe(12)
      expect(result.people.length).toBeGreaterThan(0)
    })

    it('uses voter-only path for state district', async () => {
      mockDistrictService.findDistrictById.mockResolvedValue({
        id: 'district-wy',
        type: 'State',
        name: 'WY',
        state: 'WY',
      })
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 42n }])
        .mockResolvedValueOnce([makeDbPerson({ id: 'person-2' })])

      const result = await service.findPeople({
        districtId: 'district-wy',
        filters: { filters: [], filterOperators: {} },
        resultsPerPage: 10,
        page: 1,
      } as never)

      expect(mockStatsService.getTotalCounts).not.toHaveBeenCalled()
      expect(result.pagination.totalResults).toBe(42)
      expect(result.people[0]?.id).toBe('person-2')
    })

    it('uses raw count path (not stats shortcut) when search is provided', async () => {
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 5n }])
        .mockResolvedValueOnce([makeDbPerson({ id: 'person-search' })])

      const result = await service.findPeople({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        search: 'jane',
        filters: { filters: [], filterOperators: {} },
        resultsPerPage: 10,
        page: 1,
      } as never)

      expect(mockStatsService.getTotalCounts).not.toHaveBeenCalled()
      expect(mockClient.$queryRaw).toHaveBeenCalledTimes(2)
      expect(result.pagination.totalResults).toBe(5)
    })

    it('uses raw count path (not stats shortcut) when filters are provided, guarded by the statement timeout', async () => {
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 7n }])
        .mockResolvedValueOnce([makeDbPerson({ id: 'person-filtered' })])

      const result = await service.findPeople({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: {
          filters: ['hasCellPhone'],
          filterOperators: {
            hasCellPhone: { operator: 'is', value: 'not_null' },
          },
        },
        resultsPerPage: 10,
        page: 1,
      } as never)

      expect(mockStatsService.getTotalCounts).not.toHaveBeenCalled()
      expect(mockClient.$queryRaw).toHaveBeenCalledTimes(2)
      expect(result.pagination.totalResults).toBe(7)
      // A broad/low-selectivity filter (not just name-search) can trip the same
      // pathological plan, so this count runs through the same guard: exactly
      // one transaction carrying the SET LOCAL statement_timeout + the count.
      expect(mockClient.$transaction).toHaveBeenCalledTimes(1)
      expect(mockClient.$executeRaw).toHaveBeenCalledTimes(1)
      // The data query itself is not name-search, so it stays outside the
      // transaction (list fencing remains name-search-only).
      const dataSql = (
        mockClient.$queryRaw.mock.calls[1]?.[0] as { sql?: string }
      )?.sql
      expect(dataSql).not.toContain('SELECT v.*')
    })

    it('caps distinct households (not raw voters) in the grouped fenced count on 57014', async () => {
      mockClient.$queryRaw
        .mockRejectedValueOnce(statementTimeoutError())
        .mockResolvedValueOnce([{ voter_count: 4000n }])
        .mockResolvedValueOnce([
          makeDbPerson({ id: 'hh-person', householdId: 'hh-1' }),
        ])

      const result = await service.findPeople({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: {
          filters: ['hasCellPhone'],
          filterOperators: {
            hasCellPhone: { operator: 'is', value: 'not_null' },
          },
        },
        groupByHousehold: true,
        resultsPerPage: 10,
        page: 1,
      } as never)

      // The fenced count (2nd $queryRaw, after the cancelled primary) must cap
      // DISTINCT households, not raw voters: COUNT(DISTINCT hh) over a
      // voter-capped set floors well below FENCE_LIMIT and under-reports totalPages.
      const fenced = mockClient.$queryRaw.mock.calls[1]?.[0] as {
        sql?: string
        values?: unknown[]
      }
      const fencedSql = fenced?.sql ?? ''
      expect(fencedSql).toContain('SELECT DISTINCT')
      expect(fencedSql).not.toContain('SELECT v.*')
      expect(fencedSql).toMatch(/LIMIT \?\) distinct_hh/)
      expect(fenced?.values?.at(-1)).toBe(10000)
      expect(result.pagination.totalResults).toBe(4000)
    })

    it('reports the requested out-of-bounds page (unclamped) so metadata matches the fetched rows', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([makeDbPerson()])
      mockStatsService.getTotalCounts.mockResolvedValue({
        totalConstituents: 15,
        totalConstituentsWithCellPhone: 10,
      })

      const result = await service.findPeople({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: { filters: [], filterOperators: {} },
        resultsPerPage: 10,
        page: 99,
      } as never)

      // The ungrouped path fetches at the requested offset (parallel with the
      // count), so currentPage reflects the page actually queried rather than a
      // clamped page whose rows were never fetched. totalPages still bounds the
      // valid range; hasNextPage is false because there is nothing beyond.
      expect(result.pagination.totalPages).toBe(2)
      expect(result.pagination.currentPage).toBe(99)
      expect(result.pagination.hasPreviousPage).toBe(true)
      expect(result.pagination.hasNextPage).toBe(false)
    })

    it('keeps the ungrouped count and data queries parallel and fetches at the requested offset (no serialization / no clamp)', async () => {
      // 25 constituents, 10 per page → 3 pages. An out-of-bounds page (99) is
      // fetched at the RAW offset (980) in parallel with the count, so it comes
      // back empty. currentPage reports the requested page — no divergence with
      // a clamped page, and no extra round trip / serialization behind the
      // count (that would regress the hot voter-list path).
      const dataset = Array.from({ length: 25 }, (_, i) =>
        makeDbPerson({ id: `person-${i}` }),
      )
      mockStatsService.getTotalCounts.mockResolvedValue({
        totalConstituents: dataset.length,
        totalConstituentsWithCellPhone: 0,
      })
      mockClient.$queryRaw.mockImplementation((query: unknown) => {
        const values = (query as { values?: unknown[] })?.values ?? []
        const skip = Number(values[values.length - 1] ?? 0)
        const take = Number(values[values.length - 2] ?? dataset.length)
        return Promise.resolve(dataset.slice(skip, skip + take))
      })

      const result = await service.findPeople({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: { filters: [], filterOperators: {} },
        resultsPerPage: 10,
        page: 99,
      } as never)

      expect(result.pagination.totalResults).toBe(25)
      expect(result.pagination.totalPages).toBe(3)
      expect(result.pagination.currentPage).toBe(99)
      expect(result.pagination.hasNextPage).toBe(false)
      expect(result.pagination.hasPreviousPage).toBe(true)
      expect(result.people).toHaveLength(0)

      // The data query used the raw requested offset (99 - 1) * 10 = 980, proving
      // it was not clamped or made dependent on the count result.
      const dataSql = mockClient.$queryRaw.mock.calls[0]?.[0] as {
        values?: unknown[]
      }
      expect(dataSql.values?.[dataSql.values.length - 1]).toBe(980)
    })
  })

  describe('findPeople name-search timeout guard (rare-pattern fallback)', () => {
    const sqlOf = (call: unknown): string =>
      (call as { sql?: string })?.sql ?? ''
    const valuesOf = (call: unknown): unknown[] =>
      (call as { values?: unknown[] })?.values ?? []

    const searchDto = (overrides: Record<string, unknown> = {}) =>
      ({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        search: 'zzq',
        filters: { filters: [], filterOperators: {} },
        resultsPerPage: 10,
        page: 2,
        ...overrides,
      }) as never

    it('runs the name-search count and data queries in transactions with a SET LOCAL statement timeout', async () => {
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 1n }])
        .mockResolvedValueOnce([makeDbPerson()])

      const result = await service.findPeople(searchDto())

      expect(result.people).toHaveLength(1)
      // Both the count (constructed first) and the data query are guarded.
      expect(mockClient.$transaction).toHaveBeenCalledTimes(2)
      expect(mockClient.$transaction.mock.calls[0]?.[0]).toHaveLength(2)
      expect(mockClient.$transaction.mock.calls[1]?.[0]).toHaveLength(2)
      for (const call of mockClient.$executeRaw.mock.calls) {
        expect(sqlOf(call[0])).toBe("SET LOCAL statement_timeout = '2500ms'")
      }
      // Call 0 is the count; call 1 is the primary data query — normal,
      // unfenced shape.
      const countSql = sqlOf(mockClient.$queryRaw.mock.calls[0]?.[0])
      expect(countSql).toContain('COUNT(*)')
      expect(countSql).not.toContain('SELECT v.*')
      const dataSql = sqlOf(mockClient.$queryRaw.mock.calls[1]?.[0])
      expect(dataSql).not.toContain('SELECT v.*')
      expect(dataSql).toMatch(/ORDER BY v\."id"\s+LIMIT \? OFFSET \?/)
    })

    it('retries exactly once with a trigram-fenced subquery on statement cancellation (57014)', async () => {
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 1n }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeDbPerson({ id: 'fenced-person' })])
      // First transaction is the count (succeeds); second is the data query.
      mockClient.$transaction
        .mockImplementationOnce((ops: Promise<unknown>[]) => Promise.all(ops))
        .mockRejectedValueOnce(statementTimeoutError())

      const result = await service.findPeople(searchDto())

      expect(result.people[0]?.id).toBe('fenced-person')
      expect(mockClient.$transaction).toHaveBeenCalledTimes(2)
      expect(mockClient.$queryRaw).toHaveBeenCalledTimes(3)

      const primary = mockClient.$queryRaw.mock.calls[1]?.[0]
      const fenced = mockClient.$queryRaw.mock.calls[2]?.[0]
      const fencedSql = sqlOf(fenced)
      // Unordered inner subquery with the fence cap; original ORDER BY +
      // LIMIT/OFFSET applied outside.
      expect(fencedSql).toContain('FROM (SELECT v.* FROM "green"."Voter" v')
      expect(fencedSql).toMatch(
        /LIMIT \?\) v\s+ORDER BY v\."id"\s+LIMIT \? OFFSET \?/,
      )
      expect(valuesOf(fenced).slice(-3)).toEqual([10000, 10, 10])

      // The fenced WHERE is byte-identical to the primary's, same params.
      const primarySql = sqlOf(primary)
      const primaryWhere = primarySql
        .slice(primarySql.indexOf('WHERE'), primarySql.indexOf('ORDER BY'))
        .trim()
      const fencedWhere = fencedSql
        .slice(fencedSql.indexOf('WHERE'), fencedSql.indexOf('LIMIT ?) v'))
        .trim()
      expect(fencedWhere).toBe(primaryWhere)
      const whereParamCount = valuesOf(primary).length - 2
      expect(valuesOf(fenced).slice(0, whereParamCount)).toEqual(
        valuesOf(primary).slice(0, whereParamCount),
      )
    })

    it('keeps DISTINCT ON + window grouping outside the fence on a grouped fenced retry', async () => {
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 1n }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          makeDbPerson({ id: 'rep-1', householdId: 'A', householdSize: 2n }),
        ])
      mockClient.$transaction
        .mockImplementationOnce((ops: Promise<unknown>[]) => Promise.all(ops))
        .mockRejectedValueOnce(statementTimeoutError())

      const result = await service.findPeople(
        searchDto({ groupByHousehold: true, page: 1 }),
      )

      expect(result.people[0]?.householdSize).toBe(2)
      expect(mockClient.$transaction).toHaveBeenCalledTimes(2)
      const fencedSql = sqlOf(mockClient.$queryRaw.mock.calls[2]?.[0])
      expect(fencedSql).toContain('DISTINCT ON')
      expect(fencedSql).toContain('COUNT(*) OVER (PARTITION BY')
      expect(fencedSql).toContain('FROM (SELECT v.* FROM "green"."Voter" v')
      // DISTINCT ON / window / ORDER BY sit outside the fenced subquery.
      expect(fencedSql.indexOf('DISTINCT ON')).toBeLessThan(
        fencedSql.indexOf('FROM (SELECT v.*'),
      )
      expect(fencedSql.indexOf('LIMIT ?) v')).toBeLessThan(
        fencedSql.indexOf('ORDER BY'),
      )
    })

    it('retries the count once with a trigram-fenced subquery on statement cancellation (57014)', async () => {
      mockClient.$queryRaw
        .mockResolvedValueOnce([]) // count primary (cancelled inside txn)
        .mockResolvedValueOnce([makeDbPerson()]) // data primary
        .mockResolvedValueOnce([{ voter_count: 42n }]) // fenced count retry
      // First transaction is the count — cancel it; the data query succeeds.
      mockClient.$transaction
        .mockRejectedValueOnce(statementTimeoutError())
        .mockImplementationOnce((ops: Promise<unknown>[]) => Promise.all(ops))

      const result = await service.findPeople(searchDto())

      expect(result.pagination.totalResults).toBe(42)
      expect(mockClient.$queryRaw).toHaveBeenCalledTimes(3)
      const primaryCountSql = sqlOf(mockClient.$queryRaw.mock.calls[0]?.[0])
      const fencedCountSql = sqlOf(mockClient.$queryRaw.mock.calls[2]?.[0])
      // The fenced count wraps the same FROM+WHERE, unordered, capped, with the
      // COUNT applied outside over the re-aliased row set.
      expect(fencedCountSql).toContain('FROM (SELECT v.* FROM')
      expect(fencedCountSql).toContain('LIMIT ?) v')
      expect(fencedCountSql.indexOf('COUNT(*)')).toBeLessThan(
        fencedCountSql.indexOf('FROM (SELECT v.*'),
      )
      expect(
        valuesOf(mockClient.$queryRaw.mock.calls[2]?.[0]).slice(-1),
      ).toEqual([10000])
      // Same WHERE, same params as the primary count.
      const primaryWhere = primaryCountSql
        .slice(primaryCountSql.indexOf('WHERE'))
        .trim()
      const fencedWhere = fencedCountSql
        .slice(
          fencedCountSql.indexOf('WHERE'),
          fencedCountSql.indexOf('LIMIT ?) v'),
        )
        .trim()
      expect(fencedWhere).toBe(primaryWhere)
    })

    it('retries a filtered (non-name-search) count with the fenced subquery on statement cancellation (57014)', async () => {
      // A broad/low-selectivity filter (e.g. hasCellPhone) can trip the same
      // pathological DistrictVoter -> Voter nested loop as a rare name-search
      // pattern, so every count — not just name-search — carries this guard.
      mockClient.$queryRaw
        .mockResolvedValueOnce([]) // count primary (cancelled inside txn)
        .mockResolvedValueOnce([makeDbPerson({ id: 'person-filtered' })]) // data query (unguarded, not name-search)
        .mockResolvedValueOnce([{ voter_count: 10000n }]) // fenced count retry
      mockClient.$transaction
        .mockRejectedValueOnce(statementTimeoutError())
        .mockImplementationOnce((ops: Promise<unknown>[]) => Promise.all(ops))

      const result = await service.findPeople({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: {
          filters: ['hasCellPhone'],
          filterOperators: {
            hasCellPhone: { operator: 'is', value: 'not_null' },
          },
        },
        resultsPerPage: 10,
        page: 1,
      } as never)

      expect(result.pagination.totalResults).toBe(10000)
      expect(mockClient.$queryRaw).toHaveBeenCalledTimes(3)
      // The data query is not name-search, so it never entered a transaction —
      // only the count's cancelled attempt + its fenced retry did.
      expect(mockClient.$transaction).toHaveBeenCalledTimes(1)
      const fencedCountSql = sqlOf(mockClient.$queryRaw.mock.calls[2]?.[0])
      expect(fencedCountSql).toContain('FROM (SELECT v.* FROM')
      expect(fencedCountSql).toContain('LIMIT ?) v')
      expect(
        valuesOf(mockClient.$queryRaw.mock.calls[2]?.[0]).slice(-1),
      ).toEqual([10000])
    })

    it('propagates non-timeout errors without a fenced retry', async () => {
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 1n }])
        .mockResolvedValueOnce([])
      mockClient.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError(
          'Raw query failed. Code: `40001`. Message: `serialization failure`',
          { code: 'P2010', clientVersion: 'test', meta: { code: '40001' } },
        ),
      )

      await expect(service.findPeople(searchDto())).rejects.toThrow('40001')
      // Count + primary data only — no third (fenced) query.
      expect(mockClient.$queryRaw).toHaveBeenCalledTimes(2)
    })

    it('guards the count but not the data query for phone searches (list SQL unchanged)', async () => {
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 1n }])
        .mockResolvedValueOnce([makeDbPerson()])

      await service.findPeople(searchDto({ search: '4155551234' }))

      // The count is guarded like every other count; the phone-search list
      // itself is not a name-search, so its query stays unfenced/unguarded.
      expect(mockClient.$transaction).toHaveBeenCalledTimes(1)
      expect(mockClient.$executeRaw).toHaveBeenCalledTimes(1)
      const dataSql = sqlOf(mockClient.$queryRaw.mock.calls[1]?.[0])
      expect(dataSql).toContain('VoterTelephones_CellPhoneFormatted')
      expect(dataSql).not.toContain('SELECT v.*')
      expect(dataSql).toMatch(/FROM "green"\."Voter" v\s+JOIN/)
    })

    it('does not apply the timeout/fallback to searchless lists (SQL unchanged)', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([makeDbPerson()])

      await service.findPeople(searchDto({ search: undefined }))

      expect(mockClient.$transaction).not.toHaveBeenCalled()
      expect(mockClient.$executeRaw).not.toHaveBeenCalled()
      const dataSql = sqlOf(mockClient.$queryRaw.mock.calls[0]?.[0])
      expect(dataSql).not.toContain('SELECT v.*')
      expect(dataSql).toMatch(/FROM "green"\."Voter" v\s+JOIN/)
    })
  })

  describe('findPeople household grouping (door knocking)', () => {
    const sqlTextOf = (call: unknown): string => {
      const arg = (call as { strings?: readonly string[] }) ?? {}
      return arg.strings ? arg.strings.join('?') : ''
    }

    it('counts households (COUNT DISTINCT) and de-dupes rows (DISTINCT ON) and skips the voter-count fast path', async () => {
      // Count query returns 3 households; data query returns 2 representatives.
      // The point: grouped totalResults (households) is independent of and
      // smaller than the raw voter population the same district would list.
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 3n }])
        .mockResolvedValueOnce([
          makeDbPerson({ id: 'rep-1', householdId: 'A', householdSize: 4n }),
          makeDbPerson({ id: 'rep-2', householdId: 'B', householdSize: 1n }),
        ])

      const result = await service.findPeople({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: { filters: [], filterOperators: {} },
        resultsPerPage: 10,
        page: 1,
        groupByHousehold: true,
      } as never)

      // The pre-computed totalConstituents stat (120) must NOT be used: it
      // counts voters, so it would over-report door-knocking households.
      expect(mockStatsService.getTotalCounts).not.toHaveBeenCalled()
      expect(result.pagination.totalResults).toBe(3)

      const countSql = sqlTextOf(mockClient.$queryRaw.mock.calls[0]?.[0])
      const dataSql = sqlTextOf(mockClient.$queryRaw.mock.calls[1]?.[0])
      expect(countSql).toContain('COUNT(DISTINCT')
      expect(countSql).toContain('Residence_Addresses_AddressLine')
      expect(dataSql).toContain('DISTINCT ON')
      expect(dataSql).toContain('"householdId"')
      expect(dataSql).toContain('"householdSize"')
      expect(dataSql).toContain('Residence_Addresses_AddressLine')

      // Household count is strictly fewer than the constituents the same
      // district reports for the ungrouped list (120), and the key + count of
      // matching voters at the address surface through to the output.
      expect(result.pagination.totalResults).toBeLessThan(120)
      expect(result.people[0]?.householdSize).toBe(4)
      expect(result.people[0]?.householdId).toBe('A')
    })

    it('clamps a too-high page to the last household page instead of returning empty', async () => {
      // 3 households, 10 per page → 1 page. A client paging from the voter list
      // (which has many more pages) into door knocking on page 99 must get the
      // last household page, not an empty result. The data query must therefore
      // run AFTER the count with a clamped offset of 0, not (99-1)*10.
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 3n }])
        .mockResolvedValueOnce([
          makeDbPerson({ id: 'rep-1', householdId: 'A', householdSize: 1n }),
        ])

      const result = await service.findPeople({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: { filters: [], filterOperators: {} },
        resultsPerPage: 10,
        page: 99,
        groupByHousehold: true,
      } as never)

      // Count resolved before the data query (sequential), so the offset was
      // clamped: the page is non-empty and currentPage is the last page.
      expect(result.people.length).toBeGreaterThan(0)
      expect(result.pagination.totalPages).toBe(1)
      expect(result.pagination.currentPage).toBe(1)

      const dataSql = mockClient.$queryRaw.mock.calls[1]?.[0] as {
        values?: unknown[]
      }
      // buildRawPeopleQuery binds [..., take, skip]; the clamped skip is 0.
      expect(dataSql.values?.[dataSql.values.length - 1]).toBe(0)
    })

    it('does not group (one row per voter) when groupByHousehold is false', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([makeDbPerson()])

      const result = await service.findPeople({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: { filters: [], filterOperators: {} },
        resultsPerPage: 10,
        page: 1,
        groupByHousehold: false,
      } as never)

      // Ungrouped + no filters/search still uses the fast stat path (120).
      expect(mockStatsService.getTotalCounts).toHaveBeenCalled()
      expect(result.pagination.totalResults).toBe(120)
      const dataSql = sqlTextOf(mockClient.$queryRaw.mock.calls[0]?.[0])
      expect(dataSql).not.toContain('DISTINCT ON')
      expect(result.people[0]?.householdId).toBeNull()
      expect(result.people[0]?.householdSize).toBeNull()
    })
  })

  describe('zero-count stats-but-no-rows guardrail (ENG-10745)', () => {
    const districtId = '0e5bafca-93a9-86a5-2522-f373979720df'
    const sqlOf = (call: unknown): string =>
      (call as { sql?: string })?.sql ?? ''

    const filteredDto = {
      districtId,
      filters: {
        filters: ['hasCellPhone'],
        filterOperators: {
          hasCellPhone: { operator: 'is', value: 'not_null' },
        },
      },
      resultsPerPage: 10,
      page: 1,
    } as never

    it('warns once when a filtered count is 0 for a district with stats but no DistrictVoter rows', async () => {
      const warnSpy = vi.spyOn(service.logger, 'warn')
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 0n }]) // filtered count
        .mockResolvedValueOnce([]) // data query
        .mockResolvedValueOnce([{ has_rows: false }]) // EXISTS probe
      mockStatsService.findTotalConstituents.mockResolvedValue(39932)

      const result = await service.findPeople(filteredDto)

      expect(result.pagination.totalResults).toBe(0)
      const probeSql = sqlOf(mockClient.$queryRaw.mock.calls[2]?.[0])
      expect(probeSql).toContain('SELECT EXISTS')
      expect(probeSql).toContain('"green"."DistrictVoter"')
      expect(mockStatsService.findTotalConstituents).toHaveBeenCalledWith(
        districtId,
      )
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        { districtId, state: 'WY', statsTotalConstituents: 39932 },
        expect.stringContaining('no DistrictVoter rows'),
      )
    })

    it('does not warn on a genuine filtered 0 for a populated district', async () => {
      const warnSpy = vi.spyOn(service.logger, 'warn')
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 0n }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ has_rows: true }])

      const result = await service.findPeople(filteredDto)

      expect(result.pagination.totalResults).toBe(0)
      expect(mockStatsService.findTotalConstituents).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('does not warn when the empty district has no stats row either', async () => {
      const warnSpy = vi.spyOn(service.logger, 'warn')
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 0n }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ has_rows: false }])
      mockStatsService.findTotalConstituents.mockResolvedValue(null)

      await service.findPeople(filteredDto)

      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('never probes on a non-zero filtered count (hot path pays nothing)', async () => {
      const warnSpy = vi.spyOn(service.logger, 'warn')
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 7n }])
        .mockResolvedValueOnce([makeDbPerson()])

      await service.findPeople(filteredDto)

      expect(mockClient.$queryRaw).toHaveBeenCalledTimes(2)
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('never probes on the voter-only (state district) path', async () => {
      const warnSpy = vi.spyOn(service.logger, 'warn')
      mockDistrictService.findDistrictById.mockResolvedValue({
        id: 'district-wy',
        type: 'State',
        name: 'WY',
        state: 'WY',
      })
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 0n }])
        .mockResolvedValueOnce([])

      await service.findPeople({
        ...(filteredDto as object),
        districtId: 'district-wy',
      } as never)

      expect(mockClient.$queryRaw).toHaveBeenCalledTimes(2)
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('warns when a filtered aggregates count is 0 for a stats-but-no-rows district', async () => {
      const warnSpy = vi.spyOn(service.logger, 'warn')
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ count: 0n, avgAge: null, avgIncome: null }])
        .mockResolvedValueOnce([{ has_rows: false }])
      mockStatsService.findTotalConstituents.mockResolvedValue(120)

      const result = await service.getAggregates({
        districtId,
        filters: {
          filters: ['hasCellPhone'],
          filterOperators: {
            hasCellPhone: { operator: 'is', value: 'not_null' },
          },
        },
      } as never)

      expect(result.count).toBe(0)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        { districtId, state: 'WY', statsTotalConstituents: 120 },
        expect.stringContaining('no DistrictVoter rows'),
      )
    })
  })

  describe('findPerson', () => {
    it('returns person for district path', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([
        makeDbPerson({ id: 'person-ok' }),
      ])

      const person = await service.findPerson('person-ok', {
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
      } as never)

      expect(person.id).toBe('person-ok')
      expect(person.state).toBe('WY')
      expect(mockDistrictService.findDistrictById).toHaveBeenCalled()
    })

    it('returns district-specific not found message for non-state district', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([])

      await expect(
        service.findPerson('person-1', {
          districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        } as never),
      ).rejects.toThrow(new NotFoundException('Person not found in district'))
    })

    it('returns generic not found message for state district', async () => {
      mockDistrictService.findDistrictById.mockResolvedValue({
        id: 'district-wy',
        type: 'State',
        name: 'WY',
        state: 'WY',
      })
      mockClient.$queryRaw.mockResolvedValueOnce([])

      await expect(
        service.findPerson('person-1', {
          districtId: 'district-wy',
        } as never),
      ).rejects.toThrow(
        new NotFoundException('Person with ID person-1 not found'),
      )
    })
  })

  describe('getAggregates', () => {
    const sqlTextOf = (call: unknown): string => {
      const arg = (call as { strings?: readonly string[] }) ?? {}
      return arg.strings ? arg.strings.join('?') : ''
    }
    const sqlOf = (call: unknown): string =>
      (call as { sql?: string })?.sql ?? ''
    const valuesOf = (call: unknown): unknown[] =>
      (call as { values?: unknown[] })?.values ?? []

    it('runs the aggregates query through the same statement-timeout guard as the count', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([
        { count: 1n, avgAge: 45, avgIncome: 50000 },
      ])

      await service.getAggregates({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: { filters: [], filterOperators: {} },
      } as never)

      expect(mockClient.$transaction).toHaveBeenCalledTimes(1)
      expect(mockClient.$executeRaw).toHaveBeenCalledTimes(1)
      expect(sqlOf(mockClient.$executeRaw.mock.calls[0]?.[0])).toBe(
        "SET LOCAL statement_timeout = '2500ms'",
      )
    })

    it('retries with the fenced aggregate SQL on statement cancellation (57014), yielding a sampled AVG', async () => {
      mockClient.$queryRaw
        .mockResolvedValueOnce([]) // primary aggregate (cancelled inside the txn)
        .mockResolvedValueOnce([
          { count: 10000n, avgAge: 41, avgIncome: 48000 },
        ]) // fenced retry
      mockClient.$transaction.mockRejectedValueOnce(statementTimeoutError())

      const result = await service.getAggregates({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: { filters: [], filterOperators: {} },
      } as never)

      expect(result).toEqual({
        count: 10000,
        avgAge: 41,
        avgIncome: 48000,
        fenced: true,
      })
      expect(mockClient.$queryRaw).toHaveBeenCalledTimes(2)

      const primarySql = sqlTextOf(mockClient.$queryRaw.mock.calls[0]?.[0])
      expect(primarySql).not.toContain('SELECT v.*')

      // The fenced retry wraps the same FROM+WHERE in an unordered, capped
      // subquery: the aggregates then run over that sample, not the full
      // filtered set.
      const fenced = mockClient.$queryRaw.mock.calls[1]?.[0]
      const fencedSql = sqlTextOf(fenced)
      expect(fencedSql).toContain('FROM (SELECT v.* FROM')
      expect(fencedSql).toContain('LIMIT')
      expect(valuesOf(fenced).slice(-1)).toEqual([10000])
    })

    it('resolves the district and returns count/avgAge/avgIncome', async () => {
      // A seeded set of 3 matching voters: ages [20, 30, 40] avg to 30;
      // incomes [10000, 20000, null] average over the 2 non-null rows to
      // 15000 — Postgres AVG() ignores NULLs, so the hand-computed value
      // already reflects that.
      mockClient.$queryRaw.mockResolvedValueOnce([
        { count: 3n, avgAge: 30, avgIncome: 15000 },
      ])

      const result = await service.getAggregates({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: { filters: [], filterOperators: {} },
      } as never)

      expect(mockDistrictService.findDistrictById).toHaveBeenCalledWith(
        '0e5bafca-93a9-86a5-2522-f373979720df',
      )
      expect(result).toEqual({
        count: 3,
        avgAge: 30,
        avgIncome: 15000,
        fenced: false,
      })
      const sql = sqlTextOf(mockClient.$queryRaw.mock.calls[0]?.[0])
      expect(sql).toContain('COUNT(*)::bigint AS count')
      expect(sql).toContain('AVG(v."Age_Int")::float8 AS "avgAge"')
    })

    it('reports null averages over an empty match set without dividing by zero', async () => {
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ count: 0n, avgAge: null, avgIncome: null }])
        // ENG-10745 guardrail probe: this district has voter rows, so the
        // zero is genuine and no warning is emitted.
        .mockResolvedValueOnce([{ has_rows: true }])

      const result = await service.getAggregates({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: { filters: [], filterOperators: {} },
      } as never)

      expect(result).toEqual({
        count: 0,
        avgAge: null,
        avgIncome: null,
        fenced: false,
      })
    })

    it('scopes to the whole state (no DistrictVoter join) for the voter-only path', async () => {
      mockDistrictService.findDistrictById.mockResolvedValue({
        id: 'district-wy',
        type: 'State',
        name: 'WY',
        state: 'WY',
      })
      mockClient.$queryRaw.mockResolvedValueOnce([
        { count: 1n, avgAge: 45, avgIncome: 50000 },
      ])

      await service.getAggregates({
        districtId: 'district-wy',
        filters: { filters: [], filterOperators: {} },
      } as never)

      const sql = sqlTextOf(mockClient.$queryRaw.mock.calls[0]?.[0])
      expect(sql).toContain('FROM "green"."Voter" v')
      expect(sql).not.toContain('DistrictVoter')
    })
  })
})
