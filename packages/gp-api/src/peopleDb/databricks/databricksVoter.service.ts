import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
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
  SamplePeopleDTO,
} from '../schemas/people.schema'
import { filtersSchema } from '../schemas/filters.schema'
import { VOTER_DATA_UNAVAILABLE_ERROR_CODE } from '@/shared/constants/voterData.consts'
import { hash32 } from '../util/hash.util'
import { buildVoterSelectSql, type BaseDbPerson } from '../voter.select'
import { transformToPersonOutput } from '../utils/transformToPersonOutput.util'
import type { DbxStatement } from './databricksVoterSql.util'
import {
  buildAggregatesSql,
  buildCountSql,
  buildDistrictSql,
  buildOverlapCountSql,
  buildPageSql,
  buildSampleSql,
  buildVoterColumnsSql,
  type DbxDistrict,
} from './databricksVoterSql.util'
import {
  buildDistrictStatsSql,
  mapDistrictStatsRow,
  type ComputedDistrictStats,
} from './databricksDistrictStatsSql.util'
import {
  PeopleDbxStatementClient,
  PeopleDbxStatementTooLargeError,
  PeopleDbxTimeoutError,
  PeopleDbxUnavailableError,
} from './peopleDbxStatement.client'

const STATE_DISTRICT_TYPE = 'State'

const DEFAULT_SAMPLE_SIZE = 500

// Cut to roughly three times the requested size so the LIMIT has slack to fill
// even when the hash slice lands unevenly, and cap the divisor so a huge
// population cannot slice itself down to fewer rows than were asked for.
const SAMPLE_OVERSAMPLE_FACTOR = 3
const MAX_SAMPLE_HASH_DIVISOR = 10000

const EMPTY_FILTERS = filtersSchema.parse({})

// Rotates every minute so successive calls return different people, which is
// what the sample is for; stable within a minute so a retry is idempotent.
// `| 0` because hash32 returns unsigned 32-bit and the parameter binds as INT:
// a district whose hash lands above 2^31-1 is otherwise rejected outright.
const sampleSeed = (districtId: string): number =>
  hash32(`${districtId}:${Math.floor(Date.now() / 60_000)}`) | 0

const TIMEOUT_MESSAGE =
  'The voter query took too long to run. Narrow the audience and try again.'

const UNAVAILABLE_MESSAGE =
  'Voter data is temporarily unavailable. This is a connection problem, not ' +
  'an empty district — try again shortly.'

const TOO_LARGE_MESSAGE =
  'This selection carries too many individually listed people to query. ' +
  'Narrow it and try again.'

// Only these two columns of the list projection are integers; everything else
// in the L2 uniform is text, and JSON_ARRAY hands every value back as a string
// regardless.
const NUMERIC_LIST_COLUMNS = new Set<string>([
  'Age_Int',
  'Estimated_Income_Amount_Int',
])

@Injectable()
export class DatabricksVoterService {
  // District rows are immutable reference data and one list-detail request
  // resolves the same district four times over, so caching saves three round
  // trips per request rather than shaving a query.
  private readonly districts = new Map<string, DbxDistrict>()
  // The district `type` is interpolated as an identifier, so it is checked
  // against the voter table's real column set rather than a pattern. Fetched
  // once per process: the schema does not change under a running task.
  private voterColumns: Set<string> | null = null

  constructor(
    private readonly logger: PinoLogger,
    private readonly client: PeopleDbxStatementClient,
  ) {
    this.logger.setContext(DatabricksVoterService.name)
  }

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
      // A State district whose name is the state has no membership rows at
      // all, which is why the Postgres path drops the district predicate.
      useVoterOnlyPath: type === STATE_DISTRICT_TYPE && name === state,
    }
    if (!district.useVoterOnlyPath) {
      const columns = await this.ensureVoterColumns()
      if (!columns.has(type)) {
        throw new InternalServerErrorException(
          `District ${districtId} has type "${type}", which is not a column ` +
            'on the voter table',
        )
      }
    }
    this.districts.set(districtId, district)
    return district
  }

  private async ensureVoterColumns(): Promise<Set<string>> {
    if (this.voterColumns) return this.voterColumns
    const { rows } = await this.run(buildVoterColumnsSql())
    const columns = new Set(
      rows
        .map(([name]) => name)
        .filter((name): name is string => typeof name === 'string'),
    )
    if (columns.size === 0) {
      throw new BadGatewayException(UNAVAILABLE_MESSAGE)
    }
    this.voterColumns = columns
    return columns
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

  // Sizing comes from the district's own totals: the pre-cut divisor needs to
  // know how big the population is, and the two rejections below are product
  // behavior the Postgres path enforced (a missing-stats district unmounts the
  // surface rather than showing zero).
  async samplePeople(dto: SamplePeopleDTO) {
    const district = await this.resolveDistrict(dto.districtId)
    const size = dto.size ?? DEFAULT_SAMPLE_SIZE
    const hasCellPhone = dto.hasCellPhone ?? true
    const excludeIds = dto.excludeIds ?? []

    const stats = await this.findStats(dto.districtId)
    if (!stats) {
      throw new BadRequestException({
        message: `District stats not available for districtId=${dto.districtId}`,
        errorCode: VOTER_DATA_UNAVAILABLE_ERROR_CODE,
      })
    }

    const pool = hasCellPhone
      ? stats.totalConstituentsWithCellPhone
      : stats.totalConstituents
    const remaining = pool - Math.min(excludeIds.length, pool)
    if (remaining < size) {
      throw new BadRequestException(
        `Not enough non-excluded constituents ${remaining} to satisfy target: ${size}`,
      )
    }

    const desiredRows = size * SAMPLE_OVERSAMPLE_FACTOR
    const hashDivisor = Math.min(
      MAX_SAMPLE_HASH_DIVISOR,
      Math.max(1, Math.floor(remaining / desiredRows)),
    )

    const { columnNames } = buildVoterSelectSql()
    const { rows } = await this.run(
      buildSampleSql({
        district,
        filters: EMPTY_FILTERS,
        columns: columnNames,
        size,
        seed: sampleSeed(dto.districtId),
        hashDivisor,
        hasCellPhone,
        excludeIds,
      }),
    )
    return rows
      .map((row) => toDbPerson(columnNames, row))
      .map(transformToPersonOutput)
  }

  private async run(statement: DbxStatement) {
    try {
      return await this.client.query(statement)
    } catch (err) {
      if (err instanceof PeopleDbxStatementTooLargeError) {
        this.logger.error({ err }, 'databricks voter query is too large')
        throw new BadRequestException(TOO_LARGE_MESSAGE)
      }
      // 502, never a bare 500 and never an empty result: voter data has no
      // fallback store now, so an unreachable warehouse has to be diagnosable
      // and must not be mistaken for a district that simply has no voters.
      if (err instanceof PeopleDbxUnavailableError) {
        this.logger.error({ err }, 'databricks voter data is unreachable')
        throw new BadGatewayException(UNAVAILABLE_MESSAGE)
      }
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
