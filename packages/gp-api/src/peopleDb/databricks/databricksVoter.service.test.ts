import { GatewayTimeoutException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aggregatesSchema,
  listPeopleSchema,
  overlapCountSchema,
} from '../schemas/people.schema'
import { DatabricksVoterService } from './databricksVoter.service'
import {
  PeopleDbxStatementClient,
  PeopleDbxTimeoutError,
  type PeopleDbxRows,
} from './peopleDbxStatement.client'

const DISTRICT_ID = '635757db-1111-4111-8111-111111111111'
const STATE_DISTRICT_ID = 'aaaaaaaa-1111-4111-8111-111111111111'

const districtRows = (
  type: string,
  name: string,
  id = DISTRICT_ID,
): PeopleDbxRows => ({
  columns: ['id', 'state', 'type', 'name'],
  rows: [[id, 'CA', type, name]],
})

describe('DatabricksVoterService', () => {
  let query: ReturnType<typeof vi.fn>
  let service: DatabricksVoterService

  const stubClient = (): PeopleDbxStatementClient =>
    ({ query }) as unknown as PeopleDbxStatementClient

  beforeEach(() => {
    query = vi.fn()
    service = new DatabricksVoterService(stubClient())
  })

  describe('resolveDistrict', () => {
    it('scopes a normal district on its L2 column, not the junction', async () => {
      query.mockResolvedValueOnce(
        districtRows('US_Congressional_District', '29'),
      )

      const district = await service.resolveDistrict(DISTRICT_ID)

      expect(district.districtType).toBe('US_Congressional_District')
      expect(district.districtName).toBe('29')
      expect(district.useVoterOnlyPath).toBe(false)
    })

    it('takes the voter-only path for a State district named for its state', async () => {
      query.mockResolvedValueOnce(
        districtRows('State', 'CA', STATE_DISTRICT_ID),
      )

      const district = await service.resolveDistrict(STATE_DISTRICT_ID)

      expect(district.useVoterOnlyPath).toBe(true)
    })

    it('keeps the district predicate for a State district named otherwise', async () => {
      query.mockResolvedValueOnce(districtRows('State', 'Statewide'))

      const district = await service.resolveDistrict(DISTRICT_ID)

      expect(district.useVoterOnlyPath).toBe(false)
    })

    it('404s a district that does not exist', async () => {
      query.mockResolvedValueOnce({ columns: [], rows: [] })

      await expect(service.resolveDistrict(DISTRICT_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('resolves a district once and reuses it', async () => {
      query.mockResolvedValue(districtRows('US_Congressional_District', '29'))

      await service.resolveDistrict(DISTRICT_ID)
      await service.resolveDistrict(DISTRICT_ID)

      expect(query).toHaveBeenCalledTimes(1)
    })
  })

  describe('getAggregates', () => {
    beforeEach(() => {
      query.mockResolvedValueOnce(
        districtRows('US_Congressional_District', '29'),
      )
    })

    it('coerces the string row the API returns into numbers', async () => {
      query.mockResolvedValueOnce({
        columns: ['count', 'avgAge', 'avgIncome'],
        rows: [['398619', '47.5', '82000.25']],
      })

      const result = await service.getAggregates(
        aggregatesSchema.parse({ districtId: DISTRICT_ID }),
      )

      expect(result).toEqual({
        count: 398619,
        avgAge: 47.5,
        avgIncome: 82000.25,
      })
    })

    it('keeps a null average null rather than folding it to zero', async () => {
      query.mockResolvedValueOnce({
        columns: ['count', 'avgAge', 'avgIncome'],
        rows: [['0', null, null]],
      })

      const result = await service.getAggregates(
        aggregatesSchema.parse({ districtId: DISTRICT_ID }),
      )

      expect(result).toEqual({ count: 0, avgAge: null, avgIncome: null })
    })

    it('translates a statement timeout into a 504, not a 500', async () => {
      query.mockRejectedValueOnce(new PeopleDbxTimeoutError(60_000))

      await expect(
        service.getAggregates(
          aggregatesSchema.parse({ districtId: DISTRICT_ID }),
        ),
      ).rejects.toThrow(GatewayTimeoutException)
    })

    it('lets any other query failure propagate', async () => {
      query.mockRejectedValueOnce(new Error('TABLE_OR_VIEW_NOT_FOUND'))

      await expect(
        service.getAggregates(
          aggregatesSchema.parse({ districtId: DISTRICT_ID }),
        ),
      ).rejects.toThrow('TABLE_OR_VIEW_NOT_FOUND')
    })
  })

  describe('getOverlapCount', () => {
    it('returns the counted overlap', async () => {
      query
        .mockResolvedValueOnce(districtRows('US_Congressional_District', '29'))
        .mockResolvedValueOnce({
          columns: ['overlap_count'],
          rows: [['1234']],
        })

      const result = await service.getOverlapCount(
        overlapCountSchema.parse({
          districtId: DISTRICT_ID,
          savedFilterSets: [{ hasCellPhone: true }],
        }),
      )

      expect(result).toEqual({ count: 1234 })
    })
  })

  describe('findPeople', () => {
    const personRow = (id: string): Array<string | null> => [
      id,
      'lal-1',
      'CA',
      'Jane',
      null,
      'Doe',
      null,
      ...Array.from({ length: 30 }, () => null),
      '47',
      null,
      null,
    ]

    beforeEach(() => {
      query.mockResolvedValueOnce(
        districtRows('US_Congressional_District', '29'),
      )
    })

    it('runs the count and the page as separate queries', async () => {
      query
        .mockResolvedValueOnce({ columns: ['voter_count'], rows: [['120']] })
        .mockResolvedValueOnce({
          columns: [],
          rows: [personRow('11111111-1111-4111-8111-111111111111')],
        })

      const result = await service.findPeople(
        listPeopleSchema.parse({ districtId: DISTRICT_ID, resultsPerPage: 50 }),
      )

      expect(result.pagination).toEqual({
        totalResults: 120,
        currentPage: 1,
        pageSize: 50,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: false,
      })
      expect(result.people).toHaveLength(1)
    })

    it('skips the count query when the caller does not need it', async () => {
      query.mockResolvedValueOnce({ columns: [], rows: [] })

      const result = await service.findPeople(
        listPeopleSchema.parse({ districtId: DISTRICT_ID, skipCount: true }),
      )

      expect(result.pagination.totalResults).toBe(0)
      // district lookup + the page, and no count.
      expect(query).toHaveBeenCalledTimes(2)
    })

    it('reports the page it actually fetched', async () => {
      query
        .mockResolvedValueOnce({ columns: ['voter_count'], rows: [['10']] })
        .mockResolvedValueOnce({ columns: [], rows: [] })

      const result = await service.findPeople(
        listPeopleSchema.parse({
          districtId: DISTRICT_ID,
          page: 9,
          resultsPerPage: 50,
        }),
      )

      expect(result.pagination.currentPage).toBe(9)
      expect(result.pagination.totalPages).toBe(1)
      expect(result.people).toEqual([])
    })
  })

  describe('findStats', () => {
    beforeEach(() => {
      query.mockResolvedValueOnce(
        districtRows('US_Congressional_District', '29'),
      )
    })

    it('maps a zero-voter district back to null', async () => {
      query.mockResolvedValueOnce({
        columns: [],
        rows: [['0', '0', ...Array.from({ length: 30 }, () => '0')]],
      })

      expect(await service.findStats(DISTRICT_ID)).toBeNull()
    })

    it('returns a computed row for a district with voters', async () => {
      query.mockResolvedValueOnce({
        columns: [],
        rows: [
          [
            '100',
            '40',
            // age: Unknown/18-25/26-35/36-50/51+
            '0',
            '100',
            '0',
            '0',
            '0',
            ...Array.from({ length: 25 }, () => '0'),
          ],
        ],
      })

      const stats = await service.findStats(DISTRICT_ID)

      expect(stats?.totalConstituents).toBe(100)
      expect(stats?.totalConstituentsWithCellPhone).toBe(40)
      expect(stats?.buckets.age.buckets).toEqual([
        { label: '18-25', count: 100, percent: 100 },
      ])
    })
  })
})
