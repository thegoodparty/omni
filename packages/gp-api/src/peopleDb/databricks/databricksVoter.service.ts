import {
  GatewayTimeoutException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import {
  PeopleAggregatesResponse,
  PeopleAggregatesResponseSchema,
  PeopleOverlapCountResponse,
  PeopleOverlapCountResponseSchema,
} from '@goodparty_org/contracts'
import {
  AggregatesDTO,
  ListPeopleDTO,
  OverlapCountDTO,
} from '../schemas/people.schema'
import { buildVoterSelectSql, type BaseDbPerson } from '../voter.select'
import { transformToPersonOutput } from '../utils/transformToPersonOutput.util'
import {
  buildAggregatesSql,
  buildCountSql,
  buildDistrictSql,
  buildOverlapCountSql,
  buildPageSql,
  type DbxDistrict,
} from './databricksVoterSql.util'
import {
  buildDistrictStatsSql,
  mapDistrictStatsRow,
  type ComputedDistrictStats,
} from './databricksDistrictStatsSql.util'
import {
  PeopleDbxStatementClient,
  PeopleDbxTimeoutError,
} from './peopleDbxStatement.client'

const STATE_DISTRICT_TYPE = 'State'

const TIMEOUT_MESSAGE =
  'The voter query took too long to run. Narrow the audience and try again.'

// Only these two columns of the list projection are integers; everything else
// in the L2 uniform is text, and JSON_ARRAY hands every value back as a string
// regardless.
const NUMERIC_LIST_COLUMNS = new Set<string>([
  'Age_Int',
  'Estimated_Income_Amount_Int',
])

@Injectable()
export class DatabricksVoterService {
  private readonly logger = new Logger(DatabricksVoterService.name)
  // District rows are immutable reference data and one list-detail request
  // resolves the same district four times over, so caching saves three round
  // trips per request rather than shaving a query.
  private readonly districts = new Map<string, DbxDistrict>()

  constructor(private readonly client: PeopleDbxStatementClient) {}

  async resolveDistrict(districtId: string): Promise<DbxDistrict> {
    const cached = this.districts.get(districtId)
    if (cached) return cached
    const { rows } = await this.run(buildDistrictSql(districtId))
    const [row] = rows
    if (!row) {
      throw new NotFoundException(`District not found for id=${districtId}`)
    }
    const [id, state, type, name] = row
    if (!id || !state || !type || !name) {
      throw new NotFoundException(`District ${districtId} is incomplete`)
    }
    const district: DbxDistrict = {
      districtId: id,
      state,
      districtType: type,
      districtName: name,
      // A State district whose name is the state has no junction rows at all,
      // which is why the Postgres path drops the district predicate for it.
      useVoterOnlyPath: type === STATE_DISTRICT_TYPE && name === state,
    }
    this.districts.set(districtId, district)
    return district
  }

  async getAggregates(dto: AggregatesDTO): Promise<PeopleAggregatesResponse> {
    const district = await this.resolveDistrict(dto.districtId)
    const { rows } = await this.run(
      buildAggregatesSql({
        district,
        filters: dto.filters,
        idOverrides: dto.idOverrides,
        contactsMadeIdOverrides: dto.contactsMadeIdOverrides,
      }),
    )
    const [row] = rows
    return PeopleAggregatesResponseSchema.parse({
      count: Number(row?.[0] ?? 0),
      avgAge: row?.[1] == null ? null : Number(row[1]),
      avgIncome: row?.[2] == null ? null : Number(row[2]),
    })
  }

  async getOverlapCount(
    dto: OverlapCountDTO,
  ): Promise<PeopleOverlapCountResponse> {
    const district = await this.resolveDistrict(dto.districtId)
    const { rows } = await this.run(
      buildOverlapCountSql({
        district,
        filters: dto.filters,
        search: dto.search,
        savedFilterSets: dto.savedFilterSets,
        idOverrides: dto.idOverrides,
        contactsMadeIdOverrides: dto.contactsMadeIdOverrides,
      }),
    )
    return PeopleOverlapCountResponseSchema.parse({
      count: Number(rows[0]?.[0] ?? 0),
    })
  }

  async findPeople(dto: ListPeopleDTO) {
    const district = await this.resolveDistrict(dto.districtId)
    const { columnNames } = buildVoterSelectSql()
    const scope = {
      district,
      filters: dto.filters,
      search: dto.search,
      idOverrides: dto.idOverrides,
      contactsMadeIdOverrides: dto.contactsMadeIdOverrides,
    }
    const page = Math.max(1, dto.page)

    // Count and page run in PARALLEL, the same shape the Postgres path uses:
    // it is what decides the request's latency. There is no precomputed-stats
    // shortcut for the unfiltered count here — DistrictStats runs 8-22 days
    // stale and the live count is cheap enough not to need it.
    const [countRows, pageRows] = await Promise.all([
      dto.skipCount ? Promise.resolve(null) : this.run(buildCountSql(scope)),
      this.run(
        buildPageSql({
          ...scope,
          columns: columnNames,
          take: dto.resultsPerPage,
          skip: (page - 1) * dto.resultsPerPage,
        }),
      ),
    ])

    const totalResults = countRows ? Number(countRows.rows[0]?.[0] ?? 0) : 0
    const totalPages = Math.max(1, Math.ceil(totalResults / dto.resultsPerPage))
    return {
      pagination: {
        totalResults,
        currentPage: page,
        pageSize: dto.resultsPerPage,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      people: pageRows.rows
        .map((row) => toDbPerson(columnNames, row))
        .map(transformToPersonOutput),
    }
  }

  // Computed on demand rather than read from the precomputed DistrictStats
  // table, which runs 8-22 days stale.
  async findStats(districtId: string): Promise<ComputedDistrictStats | null> {
    const district = await this.resolveDistrict(districtId)
    const { rows } = await this.run(buildDistrictStatsSql(district))
    return mapDistrictStatsRow(districtId, rows[0], new Date())
  }

  private async run(sql: string) {
    try {
      return await this.client.query(sql)
    } catch (err) {
      if (!(err instanceof PeopleDbxTimeoutError)) throw err
      this.logger.error({ err }, 'databricks voter query exceeded its ceiling')
      throw new GatewayTimeoutException(TIMEOUT_MESSAGE)
    }
  }
}

const toDbPerson = (
  columns: readonly string[],
  row: Array<string | null>,
): BaseDbPerson => {
  const record: Record<string, string | number | null> = {}
  columns.forEach((column, index) => {
    const value = row[index] ?? null
    record[column] =
      value !== null && NUMERIC_LIST_COLUMNS.has(column) ? Number(value) : value
  })
  // The projection is built from the same column list the Postgres select
  // uses, so the row is assembled dynamically and asserted once here rather
  // than restated field by field.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return record as BaseDbPerson
}
