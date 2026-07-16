import { NotFoundException } from '@nestjs/common'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { PeopleService } from './people.service'

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

describe('PeopleService', () => {
  let service: PeopleService
  let mockSampleService: { samplePeople: ReturnType<typeof vi.fn> }
  let mockDistrictService: {
    findDistrictById: ReturnType<typeof vi.fn>
  }
  let mockStatsService: {
    getTotalCounts: ReturnType<typeof vi.fn>
  }
  let mockClient: {
    $queryRaw: ReturnType<typeof vi.fn>
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
    }
    mockClient = {
      $queryRaw: vi.fn(),
    }

    service = new PeopleService(
      mockSampleService as never,
      mockDistrictService as never,
      mockStatsService as never,
    )

    Object.defineProperty(service, '_prisma', {
      get: () => mockClient,
      configurable: true,
    })
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

    it('uses raw count path (not stats shortcut) when filters are provided', async () => {
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
})
