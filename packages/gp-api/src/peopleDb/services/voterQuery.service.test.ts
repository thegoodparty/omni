import { GatewayTimeoutException, NotFoundException } from '@nestjs/common'
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
    findTotalCounts: ReturnType<typeof vi.fn>
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
      findTotalCounts: vi.fn().mockResolvedValue({
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
        groupByHousehold: true,
        resultsPerPage: 10,
        page: 1,
      } as never)

      expect(result.pagination.totalResults).toBe(42)
      expect(result.people[0]?.id).toBe('person-2')
      // Voter-only: the whole state is in scope, so neither the household
      // count nor the data query joins DistrictVoter.
      const countSql = (
        mockClient.$queryRaw.mock.calls[0]?.[0] as { sql?: string }
      )?.sql
      const dataSql = (
        mockClient.$queryRaw.mock.calls[1]?.[0] as { sql?: string }
      )?.sql
      expect(countSql).toContain('COUNT(DISTINCT')
      expect(countSql).not.toContain('DistrictVoter')
      expect(dataSql).toContain('DISTINCT ON')
      expect(dataSql).not.toContain('DistrictVoter')
    })

    it('guards both the household count and the data query under the statement timeout', async () => {
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
        groupByHousehold: true,
        resultsPerPage: 10,
        page: 1,
      } as never)

      expect(mockClient.$queryRaw).toHaveBeenCalledTimes(2)
      expect(result.pagination.totalResults).toBe(7)
      // Both the count and the list data query run under the 25s statement
      // timeout now — one transaction each (SET LOCAL + the query).
      expect(mockClient.$transaction).toHaveBeenCalledTimes(2)
      expect(mockClient.$executeRaw).toHaveBeenCalledTimes(2)
      // The data query is not name-search, so it keeps the plain shape (no
      // MATERIALIZED CTE) even though it now runs inside the timeout guard.
      const dataSql = (
        mockClient.$queryRaw.mock.calls[1]?.[0] as { sql?: string }
      )?.sql
      expect(dataSql).not.toContain('SELECT v.*')
    })

    it('propagates a 57014 count cancellation as a GatewayTimeoutException (504), no fenced fallback', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([
        makeDbPerson({ id: 'hh-person', householdId: 'hh-1' }),
      ])
      // Grouped mode resolves the count first, so the cancelled count throws
      // before the data query runs.
      mockClient.$transaction.mockRejectedValueOnce(statementTimeoutError())

      await expect(
        service.findPeople({
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
        } as never),
      ).rejects.toBeInstanceOf(GatewayTimeoutException)
    })
  })

  describe('findPeople name-search trigram plan + statement-timeout guard', () => {
    const sqlOf = (call: unknown): string =>
      (call as { sql?: string })?.sql ?? ''

    // Household grouping is the only list shape people-db still serves, so
    // every name-search query that reaches Postgres is a grouped one.
    const searchDto = (overrides: Record<string, unknown> = {}) =>
      ({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        search: 'zzq',
        filters: { filters: [], filterOperators: {} },
        groupByHousehold: true,
        resultsPerPage: 10,
        page: 2,
        ...overrides,
      }) as never

    it('guards the count under a statement timeout and forces the trigram plan (MATERIALIZED CTE) on the name-search data query', async () => {
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 1n }])
        .mockResolvedValueOnce([makeDbPerson()])

      const result = await service.findPeople(searchDto())

      expect(result.people).toHaveLength(1)
      // Both the count and the name-search data query run under the 25s
      // statement timeout — one transaction each (SET LOCAL + the query), no
      // fenced retry. The data query additionally uses a MATERIALIZED CTE.
      expect(mockClient.$transaction).toHaveBeenCalledTimes(2)
      expect(mockClient.$transaction.mock.calls[0]?.[0]).toHaveLength(2)
      expect(sqlOf(mockClient.$executeRaw.mock.calls[0]?.[0])).toBe(
        "SET LOCAL statement_timeout = '25000ms'",
      )
      // Call 0 is the count; call 1 is the data query.
      const countSql = sqlOf(mockClient.$queryRaw.mock.calls[0]?.[0])
      expect(countSql).toContain('COUNT(DISTINCT')
      expect(countSql).not.toContain('WITH matched AS MATERIALIZED')
      const dataSql = sqlOf(mockClient.$queryRaw.mock.calls[1]?.[0])
      // Trigram plan: the match set is resolved up front in a MATERIALIZED CTE
      // (no truncating LIMIT), then the outer SELECT / ORDER BY / LIMIT run
      // over `matched`.
      expect(dataSql).toContain('WITH matched AS MATERIALIZED')
      expect(dataSql).toContain('SELECT v.* FROM "green"."Voter" v')
      expect(dataSql).toMatch(
        /FROM matched v\s+ORDER BY CONCAT_WS\(.+\), v\."id"\s+LIMIT \? OFFSET \?/,
      )
    })

    it('propagates a 57014 count cancellation as a GatewayTimeoutException (504), no fenced retry', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([makeDbPerson()])
      mockClient.$transaction.mockRejectedValueOnce(statementTimeoutError())

      await expect(service.findPeople(searchDto())).rejects.toBeInstanceOf(
        GatewayTimeoutException,
      )
    })

    it('forces the trigram plan while keeping DISTINCT ON + window grouping for a grouped name-search', async () => {
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 1n }])
        .mockResolvedValueOnce([
          makeDbPerson({ id: 'rep-1', householdId: 'A', householdSize: 2n }),
        ])

      const result = await service.findPeople(
        searchDto({ groupByHousehold: true, page: 1 }),
      )

      expect(result.people[0]?.householdSize).toBe(2)
      const dataSql = sqlOf(mockClient.$queryRaw.mock.calls[1]?.[0])
      expect(dataSql).toContain('WITH matched AS MATERIALIZED')
      expect(dataSql).toContain('DISTINCT ON')
      expect(dataSql).toContain('COUNT(*) OVER (PARTITION BY')
      // The CTE resolves the match set first; DISTINCT ON / window / ORDER BY
      // run over `matched` afterwards.
      expect(dataSql.indexOf('WITH matched AS MATERIALIZED')).toBeLessThan(
        dataSql.indexOf('DISTINCT ON'),
      )
    })

    it('propagates non-timeout errors as-is', async () => {
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
    })

    it('guards the phone-search data query under the timeout without the trigram CTE', async () => {
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 1n }])
        .mockResolvedValueOnce([makeDbPerson()])

      await service.findPeople(searchDto({ search: '4155551234' }))

      // Count + data query each run under the statement timeout (a transaction
      // apiece). A phone search is not a name search, so its data query keeps
      // the plain, non-CTE shape even though it is now guarded.
      expect(mockClient.$transaction).toHaveBeenCalledTimes(2)
      expect(mockClient.$executeRaw).toHaveBeenCalledTimes(2)
      const dataSql = sqlOf(mockClient.$queryRaw.mock.calls[1]?.[0])
      expect(dataSql).toContain('VoterTelephones_CellPhoneFormatted')
      expect(dataSql).not.toContain('WITH matched AS MATERIALIZED')
      expect(dataSql).toMatch(/FROM "green"\."Voter" v\s+JOIN/)
    })

    it('guards the searchless-list data query but does not force the trigram plan', async () => {
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 1n }])
        .mockResolvedValueOnce([makeDbPerson()])

      await service.findPeople(searchDto({ search: undefined }))

      // The count and the data query each run under the 25s statement
      // timeout — one transaction apiece.
      expect(mockClient.$transaction).toHaveBeenCalledTimes(2)
      expect(mockClient.$executeRaw).toHaveBeenCalledTimes(2)
      const dataSql = sqlOf(mockClient.$queryRaw.mock.calls[1]?.[0])
      expect(dataSql).not.toContain('WITH matched AS MATERIALIZED')
      expect(dataSql).toMatch(/FROM "green"\."Voter" v\s+JOIN/)
    })
  })

  describe('findPeople household grouping (door knocking)', () => {
    const sqlTextOf = (call: unknown): string => {
      const arg = (call as { strings?: readonly string[] }) ?? {}
      return arg.strings ? arg.strings.join('?') : ''
    }

    it('counts households (COUNT DISTINCT) and de-dupes rows (DISTINCT ON)', async () => {
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

      expect(result.pagination.totalResults).toBe(3)

      const countSql = sqlTextOf(mockClient.$queryRaw.mock.calls[0]?.[0])
      const dataSql = sqlTextOf(mockClient.$queryRaw.mock.calls[1]?.[0])
      expect(countSql).toContain('COUNT(DISTINCT')
      expect(countSql).toContain('Residence_Addresses_AddressLine')
      expect(dataSql).toContain('DISTINCT ON')
      expect(dataSql).toContain('"householdId"')
      expect(dataSql).toContain('"householdSize"')
      expect(dataSql).toContain('Residence_Addresses_AddressLine')

      // The key + the count of matching voters at the address surface through
      // to the output.
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
      groupByHousehold: true,
      resultsPerPage: 10,
      page: 1,
    } as never

    it('warns once when a filtered count is 0 for a district with stats but no DistrictVoter rows', async () => {
      const warnSpy = vi.spyOn(service.logger, 'warn')
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 0n }]) // household count
        .mockResolvedValueOnce([{ has_rows: false }]) // EXISTS probe
        .mockResolvedValueOnce([]) // data query
      mockStatsService.findTotalConstituents.mockResolvedValue(39932)

      const result = await service.findPeople(filteredDto)

      expect(result.pagination.totalResults).toBe(0)
      const probeSql = sqlOf(mockClient.$queryRaw.mock.calls[1]?.[0])
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
        .mockResolvedValueOnce([{ has_rows: true }])
        .mockResolvedValueOnce([])

      const result = await service.findPeople(filteredDto)

      expect(result.pagination.totalResults).toBe(0)
      expect(mockStatsService.findTotalConstituents).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('does not warn when the empty district has no stats row either', async () => {
      const warnSpy = vi.spyOn(service.logger, 'warn')
      mockClient.$queryRaw
        .mockResolvedValueOnce([{ voter_count: 0n }])
        .mockResolvedValueOnce([{ has_rows: false }])
        .mockResolvedValueOnce([])
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

  // These entry points read from Databricks unconditionally; the only list
  // shape still served by people-db is household de-dup.
  describe('store routing', () => {
    const databricks = {
      findPeople: vi.fn(),
      getAggregates: vi.fn(),
      getOverlapCount: vi.fn(),
    }

    beforeEach(() => {
      databricks.findPeople.mockResolvedValue({ pagination: {}, people: [] })
      databricks.getAggregates.mockResolvedValue({
        count: 1,
        avgAge: null,
        avgIncome: null,
      })
      databricks.getOverlapCount.mockResolvedValue({ count: 1 })
      ;(service as unknown as { databricks: unknown }).databricks = databricks
    })

    it('routes getAggregates to Databricks and issues no Postgres query', async () => {
      await service.getAggregates({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: { filters: [], filterOperators: {} },
      } as never)

      expect(databricks.getAggregates).toHaveBeenCalledTimes(1)
      expect(mockClient.$queryRaw).not.toHaveBeenCalled()
    })

    it('routes getOverlapCount to Databricks', async () => {
      await service.getOverlapCount({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: { filters: [], filterOperators: {} },
        savedFilterSets: [],
      } as never)

      expect(databricks.getOverlapCount).toHaveBeenCalledTimes(1)
      expect(mockClient.$queryRaw).not.toHaveBeenCalled()
    })

    it('routes an ungrouped findPeople to Databricks', async () => {
      await service.findPeople({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: { filters: [], filterOperators: {} },
        page: 1,
        resultsPerPage: 50,
        groupByHousehold: false,
      } as never)

      expect(databricks.findPeople).toHaveBeenCalledTimes(1)
      expect(mockClient.$queryRaw).not.toHaveBeenCalled()
    })

    // Door-knocking de-dup has no Databricks equivalent, so it is the one
    // list shape that still reads Postgres.
    it('keeps a household-grouped findPeople on Postgres', async () => {
      mockClient.$queryRaw.mockResolvedValue([])

      await service.findPeople({
        districtId: '0e5bafca-93a9-86a5-2522-f373979720df',
        filters: { filters: [], filterOperators: {} },
        page: 1,
        resultsPerPage: 50,
        groupByHousehold: true,
      } as never)

      expect(databricks.findPeople).not.toHaveBeenCalled()
      expect(mockClient.$queryRaw).toHaveBeenCalled()
    })
  })
})
