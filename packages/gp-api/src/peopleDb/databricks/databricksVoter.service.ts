import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { ElectionApiDistrictService } from '../services/electionApiDistrict.service'
import {
  PeopleAggregatesResponse,
  PeopleAggregatesResponseSchema,
  PeopleListDetailAggregatesResponse,
  PeopleListDetailAggregatesResponseSchema,
  PeopleOverlapCountResponse,
  PeopleOverlapCountResponseSchema,
  PeoplePrecinctsResponseSchema,
  type PeoplePrecinctsResponse,
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
  buildListDetailAggregatesSql,
  buildCountSql,
  buildOverlapCountSql,
  buildPrecinctsSql,
  MAX_PRECINCT_OPTIONS,
  buildPageSql,
  buildPersonSql,
  buildSampleSql,
  HOUSEHOLD_PAGE_COLUMNS,
  buildDoorKnockingEvaluateSql,
  buildDoorKnockingResidentsSql,
  DOOR_KNOCKING_RESIDENT_COLUMNS,
  type DbxDistrict,
  type DbxEvaluateRow,
  type DbxResidentRow,
} from './databricksVoterSql.util'
import {
  DoorKnockingEvaluateDTO,
  DoorKnockingResidentsDTO,
} from '../schemas/doorKnocking.schema'
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

// L2 district-type columns are word characters only -- all 181 in use match.
const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/

const NUMERIC_RESIDENT_COLUMNS = new Set<string>([
  'Age_Int',
  'Estimated_Income_Amount_Int',
])

const toRecord = (
  columns: readonly string[],
  row: Array<string | null>,
): Record<string, string | null> => {
  const record: Record<string, string | null> = {}
  columns.forEach((column, index) => {
    record[column] = row[index] ?? null
  })
  return record
}

@Injectable()
export class DatabricksVoterService {
  // District rows are immutable reference data and one list-detail request
  // resolves the same district four times over, so caching saves three round
  // trips per request rather than shaving a query.
  private readonly districts = new Map<string, DbxDistrict>()

  constructor(
    private readonly logger: PinoLogger,
    private readonly client: PeopleDbxStatementClient,
    private readonly districtService: ElectionApiDistrictService,
  ) {
    this.logger.setContext(DatabricksVoterService.name)
  }

  // Resolved from election-api, which owns the District table -- not from
  // Databricks (a measured p90 of 8.6s for one keyed row, at the head of every
  // voter read) and no longer from people-db either. Reading the upstream
  // directly is what leaves a Databricks-served read touching people-db not at
  // all. Memoized per process, so a district costs one hop per task.
  async resolveDistrict(districtId: string): Promise<DbxDistrict> {
    const cached = this.districts.get(districtId)
    if (cached) return cached
    const { type, name, state } =
      await this.districtService.findDistrictById(districtId)
    const district: DbxDistrict = {
      districtId,
      state,
      districtType: type,
      districtName: name,
      // A State district whose name is the state has no membership rows at
      // all, which is why the Postgres path drops the district predicate.
      useVoterOnlyPath: type === STATE_DISTRICT_TYPE && name === state,
    }
    // `type` is spliced into the SQL as a column IDENTIFIER, which cannot be a
    // bound parameter, so it is checked before it gets there. It arrives from
    // election-api's District table rather than from a caller, so this guards
    // our own ingest rather than user input -- and a character class is the
    // whole of that guard: a value that fails it cannot form valid SQL. This
    // used to query information_schema on every process to confirm the column
    // existed too, which answered a different question at the cost of an
    // uncached metadata round trip on the first voter read of every task.
    if (!district.useVoterOnlyPath && !SAFE_IDENTIFIER.test(type)) {
      throw new InternalServerErrorException(
        `District ${districtId} has type "${type}", which is not a usable ` +
          'column name on the voter table',
      )
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

  async getListDetailAggregates(
    dto: AggregatesDTO,
  ): Promise<PeopleListDetailAggregatesResponse> {
    const district = await this.resolveDistrict(dto.districtId)
    const { rows } = await this.run(
      buildListDetailAggregatesSql({
        district,
        filters: dto.filters,
        idOverrides: dto.idOverrides,
        contactsMadeIdOverrides: dto.contactsMadeIdOverrides,
      }),
    )
    const [row] = rows
    return PeopleListDetailAggregatesResponseSchema.parse({
      count: Number(row?.[0] ?? 0),
      avgAge: row?.[1] == null ? null : Number(row[1]),
      avgIncome: row?.[2] == null ? null : Number(row[2]),
      sms: Number(row?.[3] ?? 0),
      robocall: Number(row?.[4] ?? 0),
      phoneBanking: Number(row?.[5] ?? 0),
      doorKnocking: Number(row?.[6] ?? 0),
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

  // Scoped to the district for the same reason the Postgres path is: an id
  // from another office must not resolve through this drawer. The two
  // not-found messages mirror Postgres exactly, because the webapp
  // distinguishes "not in this district" from "no such person".
  async findPerson(id: string, districtId: string) {
    const district = await this.resolveDistrict(districtId)
    const { columnNames } = buildVoterSelectSql()
    const { rows } = await this.run(
      buildPersonSql({
        district,
        filters: EMPTY_FILTERS,
        columns: columnNames,
        id,
      }),
    )
    const [row] = rows
    if (!row) {
      if (!district.useVoterOnlyPath) {
        throw new NotFoundException('Person not found in district')
      }
      throw new NotFoundException(`Person with ID ${id} not found`)
    }
    return transformToPersonOutput(toDbPerson(columnNames, row))
  }

  async findPrecincts(districtId: string): Promise<PeoplePrecinctsResponse> {
    const district = await this.resolveDistrict(districtId)
    const { rows } = await this.run(buildPrecinctsSql({ district }))
    // The statement asks for one row past the cap purely so this comparison
    // can tell a full list from a clipped one; that extra row is dropped.
    const truncated = rows.length > MAX_PRECINCT_OPTIONS
    const options = (
      truncated ? rows.slice(0, MAX_PRECINCT_OPTIONS) : rows
    ).map((row) => ({
      county: row[0] ?? '',
      // A SQL NULL precinct is the Unknown bucket. Normalised to '' here so
      // the wire shape stays a plain string and encode/decode round-trips
      // it, rather than making every consumer handle a nullable.
      precinct: row[1] ?? '',
      voters: Number(row[2] ?? 0),
    }))
    return PeoplePrecinctsResponseSchema.parse({ options, truncated })
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
    const { groupByHousehold } = dto
    const [countRows, pageRows] = await Promise.all([
      dto.skipCount
        ? Promise.resolve(null)
        : this.run(buildCountSql({ ...scope, groupByHousehold })),
      this.run(
        buildPageSql({
          ...scope,
          columns: columnNames,
          take: dto.resultsPerPage,
          skip: (page - 1) * dto.resultsPerPage,
          groupByHousehold,
        }),
      ),
    ])
    // Grouped mode appends the two household columns after the projection, so
    // the names have to grow with the row or toDbPerson misaligns them.
    const rowColumns = groupByHousehold
      ? [...columnNames, ...HOUSEHOLD_PAGE_COLUMNS]
      : columnNames

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
        .map((row) => toDbPerson(rowColumns, row))
        .map(transformToPersonOutput),
    }
  }

  // No district resolution needed: the stats table is keyed by district id, so
  // this is one lookup rather than a resolve plus an aggregate over the voters.
  async findStats(districtId: string): Promise<ComputedDistrictStats | null> {
    const { rows } = await this.run(buildDistrictStatsSql(districtId))
    return mapDistrictStatsRow(districtId, rows[0])
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

  // Both door-knocking reads return ROWS, not a finished response. The cap
  // check and the roster shaping stay in VoterDoorKnockingService so the
  // reject-rather-than-truncate guard and the display mapping have one
  // implementation across both engines rather than two that can drift.
  async doorKnockingEvaluateRows(
    dto: DoorKnockingEvaluateDTO,
  ): Promise<DbxEvaluateRow[]> {
    const district = await this.resolveDistrict(dto.districtId)
    const { columns, rows } = await this.run(
      buildDoorKnockingEvaluateSql({
        district,
        filters: dto.filters,
        idOverrides: dto.idOverrides,
        contactsMadeIdOverrides: dto.contactsMadeIdOverrides,
        bbox: dto.bbox,
        maxPeople: dto.maxPeople,
        excludePersonIds: dto.excludePersonIds,
      }),
    )
    return rows.map((row) => {
      const record = toRecord(columns, row)
      return {
        id: String(record.id),
        firstName: record.firstName ?? null,
        lastName: record.lastName ?? null,
        lat: Number(record.lat),
        lng: Number(record.lng),
        addressKey: String(record.addressKey),
        displayAddress: record.displayAddress ?? '',
      }
    })
  }

  async doorKnockingResidentRows(
    dto: DoorKnockingResidentsDTO,
    residentsCap: number,
  ): Promise<DbxResidentRow[]> {
    const district = await this.resolveDistrict(dto.districtId)
    const { columns, rows } = await this.run(
      buildDoorKnockingResidentsSql({
        district,
        addressKeys: dto.addressKeys,
        residentsCap,
      }),
    )
    return rows.map((row) => {
      const record = toRecord(columns, row)
      const resident: Record<string, string | number | boolean | null> = {
        id: String(record.id),
        firstName: record.firstName ?? null,
        lastName: record.lastName ?? null,
        cellPhone: record.cellPhone ?? null,
        landline: record.landline ?? null,
        addressKey: String(record.addressKey),
        // JSON_ARRAY renders a boolean as the text 'true'/'false'.
        registered: record.registered === 'true',
      }
      for (const column of DOOR_KNOCKING_RESIDENT_COLUMNS) {
        const value = record[column] ?? null
        resident[column] =
          value !== null && NUMERIC_RESIDENT_COLUMNS.has(column)
            ? Number(value)
            : value
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return resident as DbxResidentRow
    })
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
