import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aggregatesSchema,
  listPeopleSchema,
  overlapCountSchema,
} from '../schemas/people.schema'
import { filtersSchema, type FilterData } from '../schemas/filters.schema'
import { DatabricksVoterService } from './databricksVoter.service'
import { MAX_RANKED_PRECINCTS } from './databricksRecommendedListsSql.util'
import type { DbxDistrict } from './databricksVoterSql.util'
import {
  PeopleDbxStatementClient,
  PeopleDbxStatementTooLargeError,
  PeopleDbxTimeoutError,
  PeopleDbxUnavailableError,
} from './peopleDbxStatement.client'

const DISTRICT_ID = '635757db-1111-4111-8111-111111111111'
const STATE_DISTRICT_ID = 'aaaaaaaa-1111-4111-8111-111111111111'

describe('DatabricksVoterService', () => {
  let query: ReturnType<typeof vi.fn>
  let findDistrictById: ReturnType<typeof vi.fn>
  let service: DatabricksVoterService

  // The district comes from Postgres now, so queueing one is not a warehouse
  // query -- which is the point: `query` call counts below no longer include it.
  const stubDistrict = (type: string, name: string, id = DISTRICT_ID) =>
    findDistrictById.mockResolvedValueOnce({ id, type, name, state: 'CA' })

  const stubClient = (): PeopleDbxStatementClient =>
    ({ query }) as unknown as PeopleDbxStatementClient

  beforeEach(() => {
    query = vi.fn()
    findDistrictById = vi.fn()
    service = new DatabricksVoterService(
      {
        setContext: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as never,
      stubClient(),
      { findDistrictById } as never,
    )
  })

  describe('resolveDistrict', () => {
    it('scopes a normal district on its L2 column, not the junction', async () => {
      stubDistrict('US_Congressional_District', '29')

      const district = await service.resolveDistrict(DISTRICT_ID)

      expect(district.districtType).toBe('US_Congressional_District')
      expect(district.districtName).toBe('29')
      expect(district.useVoterOnlyPath).toBe(false)
      // Resolution costs no warehouse query at all now: the district comes from
      // election-api and the type is validated by shape, not by a lookup.
      expect(query).not.toHaveBeenCalled()
    })

    it('takes the voter-only path for a State district named for its state', async () => {
      stubDistrict('State', 'CA', STATE_DISTRICT_ID)

      const district = await service.resolveDistrict(STATE_DISTRICT_ID)

      expect(district.useVoterOnlyPath).toBe(true)
      // Nothing is interpolated on this path, so there is no column to check --
      // and the district itself no longer costs a warehouse query either.
      expect(query).not.toHaveBeenCalled()
    })

    it('keeps the district predicate for a State district named otherwise', async () => {
      stubDistrict('State', 'Statewide')

      const district = await service.resolveDistrict(DISTRICT_ID)

      expect(district.useVoterOnlyPath).toBe(false)
    })

    it('surfaces a missing district from the Postgres lookup', async () => {
      findDistrictById.mockRejectedValueOnce(
        new NotFoundException(`District not found for id=${DISTRICT_ID}`),
      )

      await expect(service.resolveDistrict(DISTRICT_ID)).rejects.toThrow(
        NotFoundException,
      )
      expect(query).not.toHaveBeenCalled()
    })

    it('resolves a district once and reuses it', async () => {
      stubDistrict('US_Congressional_District', '29')

      await service.resolveDistrict(DISTRICT_ID)
      await service.resolveDistrict(DISTRICT_ID)

      expect(query).not.toHaveBeenCalled()
      expect(findDistrictById).toHaveBeenCalledTimes(1)
    })

    // `type` is spliced in as an identifier, so anything that could change the
    // shape of the statement is refused before it gets there.
    it('refuses a district type that is not a bare identifier', async () => {
      stubDistrict('Ward"; DROP TABLE voters --', '29')

      await expect(service.resolveDistrict(DISTRICT_ID)).rejects.toThrow(
        InternalServerErrorException,
      )
    })
  })

  describe('getAggregates', () => {
    beforeEach(() => {
      stubDistrict('US_Congressional_District', '29')
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

    // There is no fallback store, so an unreachable warehouse has to surface as
    // a diagnosable 502 — and critically NOT as an empty result, which the
    // product reads as "this office has no constituent data".
    it('translates an unreachable warehouse into a 502, not a 500', async () => {
      query.mockRejectedValueOnce(
        new PeopleDbxUnavailableError('GET /statements returned 401: expired'),
      )

      await expect(
        service.getAggregates(
          aggregatesSchema.parse({ districtId: DISTRICT_ID }),
        ),
      ).rejects.toThrow(BadGatewayException)
    })

    it('translates an oversized selection into a 400', async () => {
      query.mockRejectedValueOnce(new PeopleDbxStatementTooLargeError(20e6))

      await expect(
        service.getAggregates(
          aggregatesSchema.parse({ districtId: DISTRICT_ID }),
        ),
      ).rejects.toThrow(BadRequestException)
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

  describe('getListDetailAggregates', () => {
    beforeEach(() => {
      stubDistrict('US_Congressional_District', '29')
    })

    // One statement, seven columns — the whole list-detail payload the five
    // separate aggregates calls used to assemble.
    it('reads every channel off the single row, in one statement', async () => {
      query.mockResolvedValueOnce({
        columns: [
          'count',
          'avgAge',
          'avgIncome',
          'sms',
          'robocall',
          'phoneBanking',
          'doorKnocking',
        ],
        rows: [['999', '47.5', '82000.25', '777', '222', '555', '111']],
      })

      const result = await service.getListDetailAggregates(
        aggregatesSchema.parse({ districtId: DISTRICT_ID }),
      )

      expect(query).toHaveBeenCalledOnce()
      expect(result).toEqual({
        count: 999,
        avgAge: 47.5,
        avgIncome: 82000.25,
        sms: 777,
        robocall: 222,
        phoneBanking: 555,
        doorKnocking: 111,
      })
    })

    it('keeps a null average null while the channel counts stay zero', async () => {
      query.mockResolvedValueOnce({
        columns: [
          'count',
          'avgAge',
          'avgIncome',
          'sms',
          'robocall',
          'phoneBanking',
          'doorKnocking',
        ],
        rows: [['0', null, null, '0', '0', '0', '0']],
      })

      const result = await service.getListDetailAggregates(
        aggregatesSchema.parse({ districtId: DISTRICT_ID }),
      )

      expect(result).toEqual({
        count: 0,
        avgAge: null,
        avgIncome: null,
        sms: 0,
        robocall: 0,
        phoneBanking: 0,
        doorKnocking: 0,
      })
    })

    // All-or-nothing now: there is no per-channel settling left to degrade to,
    // so a warehouse outage has to surface as a 502 rather than zeroed tiles,
    // which the product would read as "this office has nobody to reach".
    it('translates an unreachable warehouse into a 502, not zeroed tiles', async () => {
      query.mockRejectedValueOnce(
        new PeopleDbxUnavailableError('GET /statements returned 401: expired'),
      )

      await expect(
        service.getListDetailAggregates(
          aggregatesSchema.parse({ districtId: DISTRICT_ID }),
        ),
      ).rejects.toThrow(BadGatewayException)
    })
  })

  describe('getOverlapCount', () => {
    it('returns the counted overlap', async () => {
      stubDistrict('US_Congressional_District', '29')
      query.mockResolvedValueOnce({
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
      stubDistrict('US_Congressional_District', '29')
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
      // The page alone. The district is resolved off-warehouse and there is no
      // column probe any more, so the page is the only statement.
      expect(query).toHaveBeenCalledTimes(1)
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
      stubDistrict('US_Congressional_District', '29')
    })

    // Resolve then aggregate: unlike a keyed read this scopes the voter rows,
    // so it is one district lookup (not a warehouse query) plus one scan.
    it('returns null when no voters are in scope', async () => {
      query.mockResolvedValueOnce({
        columns: [],
        rows: [['TOTAL', 'all', '0', '0']],
      })

      expect(await service.findStats(DISTRICT_ID)).toBeNull()
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('aggregates the five dimensions from the voter rows', async () => {
      query.mockResolvedValueOnce({
        columns: [],
        rows: [
          ['TOTAL', 'all', '100', '40'],
          ['age', '18-25', '100', null],
          ['estimatedIncomeRange', '250k+', '60', null],
        ],
      })

      const stats = await service.findStats(DISTRICT_ID)

      expect(stats?.totalConstituents).toBe(100)
      expect(stats?.totalConstituentsWithCellPhone).toBe(40)
      expect(stats?.buckets.age).toEqual([
        { label: '18-25', count: 100, percent: 100 },
      ])
      expect(stats?.buckets.estimatedIncomeRange).toEqual([
        { label: '250k+', count: 60, percent: 60 },
      ])
    })
  })

  describe('findPerson', () => {
    beforeEach(() => {
      stubDistrict('US_Congressional_District', '29')
    })

    it('returns the person when the id is inside the district', async () => {
      query.mockResolvedValueOnce({
        columns: [],
        rows: [['voter-1', 'CA']],
      })

      const person = await service.findPerson('voter-1', DISTRICT_ID)

      expect(person.id).toBe('voter-1')
    })

    // The webapp shows different copy for these two, so the distinction has to
    // survive the move to Databricks.
    it('says not-in-district when the district is scoped', async () => {
      query.mockResolvedValueOnce({ columns: [], rows: [] })

      await expect(service.findPerson('voter-1', DISTRICT_ID)).rejects.toThrow(
        'Person not found in district',
      )
    })
  })

  describe('findPerson on a statewide district', () => {
    it('says no-such-person when the scope is the whole state', async () => {
      stubDistrict('State', 'CA', STATE_DISTRICT_ID)
      query.mockResolvedValueOnce({ columns: [], rows: [] })

      await expect(
        service.findPerson('voter-1', STATE_DISTRICT_ID),
      ).rejects.toThrow('Person with ID voter-1 not found')
    })
  })

  describe('recommended-lists aggregates', () => {
    const DISTRICT: DbxDistrict = {
      districtId: DISTRICT_ID,
      state: 'CA',
      districtType: 'US_Congressional_District',
      districtName: '29',
      useVoterOnlyPath: false,
    }
    const noFilters = (): FilterData => filtersSchema.parse({})

    it('countForFilter takes a resolved district, no lookup', async () => {
      query.mockResolvedValueOnce({ columns: ['voter_count'], rows: [['42']] })

      const count = await service.countForFilter(DISTRICT, noFilters())

      expect(count).toBe(42)
      expect(findDistrictById).not.toHaveBeenCalled()
    })

    it('districtTotal counts the scope with no filter applied', async () => {
      query.mockResolvedValueOnce({
        columns: ['voter_count'],
        rows: [['123456']],
      })

      const total = await service.districtTotal(DISTRICT)

      expect(total).toBe(123456)
      expect(query).toHaveBeenCalledOnce()
    })

    it('stops once cumulative voters hit doorTarget', async () => {
      query.mockResolvedValueOnce({
        columns: ['county', 'precinct', 'voters'],
        rows: [
          ['Los Angeles', '001', '9000'],
          ['Los Angeles', '002', '4000'],
          ['Los Angeles', '003', '3000'],
        ],
      })

      const result = await service.rankPrecincts(DISTRICT, noFilters(), 10000)

      // 9000 alone is under target; +4000 reaches it, so the third precinct
      // (already ranked lower) is never needed.
      expect(result).toEqual({
        precincts: [
          { county: 'Los Angeles', precinct: '001', voters: 9000 },
          { county: 'Los Angeles', precinct: '002', voters: 4000 },
        ],
        totalVoters: 13000,
        reachedTarget: true,
      })
    })

    it('flags reachedTarget false when precincts run out first', async () => {
      query.mockResolvedValueOnce({
        columns: ['county', 'precinct', 'voters'],
        rows: [
          ['Campti', '001', '200'],
          ['Campti', '002', '120'],
        ],
      })

      const result = await service.rankPrecincts(DISTRICT, noFilters(), 10000)

      // Every fetched row is under target -- the district has nothing more
      // to offer, not merely a slow accumulation, and reachedTarget has to
      // say so rather than leave the caller to infer it from the row count.
      expect(result).toEqual({
        precincts: [
          { county: 'Campti', precinct: '001', voters: 200 },
          { county: 'Campti', precinct: '002', voters: 120 },
        ],
        totalVoters: 320,
        reachedTarget: false,
      })
    })

    // The other way reachedTarget can come back false: MAX_RANKED_PRECINCTS
    // rows all came back (the query never signals "there could be more"), and
    // even summing every one of them doesn't reach doorTarget. This is the
    // branch a below-floor widening loop can never distinguish from a
    // genuinely small district without this flag -- and the one that will
    // otherwise go unexercised until a real large-and-fragmented district
    // hits it in production.
    it('flags reachedTarget false when the cap runs out first', async () => {
      const rows = Array.from({ length: MAX_RANKED_PRECINCTS }, (_, i) => [
        'Los Angeles',
        String(i).padStart(3, '0'),
        '10',
      ])
      query.mockResolvedValueOnce({
        columns: ['county', 'precinct', 'voters'],
        rows,
      })

      const result = await service.rankPrecincts(DISTRICT, noFilters(), 100000)

      expect(result.precincts).toHaveLength(MAX_RANKED_PRECINCTS)
      expect(result.totalVoters).toBe(MAX_RANKED_PRECINCTS * 10)
      expect(result.reachedTarget).toBe(false)
    })
  })
})
