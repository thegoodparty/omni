import { Prisma } from '../../generated/prisma'
import {
  AggregatesDTO,
  GetPersonQueryDTO,
  ListPeopleDTO,
  SamplePeopleDTO,
} from '../people.schema'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { SampleService } from './sample.service'

import { Injectable, NotFoundException } from '@nestjs/common'
import { DistrictService } from 'src/district/services/district.service'
import { transformToPersonOutput } from '../utils/transformToPersonOutput.utils'
import { FilterData } from '../schemas/filters.schema'
import { StatsService } from './stats.service'
import {
  buildVoterSelectSql,
  BaseDbPerson,
  ExtraSelectedField,
} from '../people.select'
import { resolveDistrict } from '../utils/resolveDistrict.utils'
import {
  buildVoterWhereSql,
  isNameSearch,
  stateEquals,
} from '../utils/buildVoterWhereSql.utils'
import { buildAggregatesSql } from '../utils/buildAggregatesSql.utils'
import { buildHouseholdKeySql } from '../utils/buildHouseholdKeySql.utils'

export type PeopleAggregates = {
  count: number
  avgAge: number | null
  avgIncome: number | null
}

export const DATABASE_SCHEMA = 'green'

const VOTER_TABLENAME = 'Voter'
const DISTRICTVOTER_TABLENAME = 'DistrictVoter'

// Postgres floors LIKE selectivity estimates at ~2000 rows, so for a
// near-zero-match pattern ('%zzq%') the planner walks the ordering index and
// scans the entire state partition (30+ seconds on large states) instead of
// using the trigram indexes; raising statistics targets does not fix it.
// Common patterns resolve in well under a second, so only runaway plans trip
// this timeout.
const NAME_SEARCH_TIMEOUT_MS = 2500
// The fallback wraps the same WHERE in an UNORDERED subquery capped at this
// many rows, which frees the planner to pick the trigram bitmap scan. The
// fallback only runs for patterns that already proved slow — i.e. patterns
// with very few matches, far below this cap — so the fence never truncates
// the ordered, paginated result. Always fencing is NOT safe: above the cap
// the fenced subset is arbitrary and would break deterministic pagination.
const NAME_SEARCH_FENCE_LIMIT = 10000

type RawPeopleQueryArgs = {
  districtId: string | null
  whereClause: Prisma.Sql
  take: number
  skip: number
  extraFields?: ExtraSelectedField[]
  groupByHousehold?: boolean
  fenceLimit?: number
}

const isStatementTimeoutError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  ((error.meta as { code?: unknown } | undefined)?.code === '57014' ||
    error.message.includes('57014'))

@Injectable()
export class PeopleService extends createPrismaBase(MODELS.Voter) {
  constructor(
    private readonly sampleService: SampleService,
    private readonly districtService: DistrictService,
    private readonly statsService: StatsService,
  ) {
    super()
  }

  async findPerson(id: string, query: GetPersonQueryDTO) {
    const resolved = await resolveDistrict(this.districtService, query)
    const { districtId, state, useVoterOnlyPath } = resolved
    const select = buildVoterSelectSql().sql
    const districtExistsClause = !useVoterOnlyPath
      ? Prisma.sql`AND EXISTS (
            SELECT 1
            FROM green."DistrictVoter" dv
            JOIN green."District" d ON d."id" = dv."district_id"
            WHERE dv."voter_id" = v."id"
              AND d."id" = ${districtId}::uuid
          )`
      : Prisma.empty

    const result = await this.client.$queryRaw<BaseDbPerson[]>(
      Prisma.sql`${select} FROM "green"."Voter" v WHERE v."id" = ${id}::uuid AND ${stateEquals('v', state)} ${districtExistsClause}`,
    )
    const [person] = result
    if (!person) {
      if (!useVoterOnlyPath) {
        throw new NotFoundException('Person not found in district')
      }
      throw new NotFoundException(`Person with ID ${id} not found`)
    }
    return transformToPersonOutput(person)
  }

  async findPeople(dto: ListPeopleDTO) {
    const resolved = await resolveDistrict(this.districtService, dto)
    const { state, useVoterOnlyPath, districtId } = resolved
    const { filters, search, resultsPerPage, page, groupByHousehold } = dto
    const effectiveDistrictId = useVoterOnlyPath ? null : districtId

    const whereClause = buildVoterWhereSql({
      state,
      districtId: effectiveDistrictId,
      filters,
      search,
    })
    const buildData = (skip: number) => {
      const queryArgs = {
        districtId: effectiveDistrictId,
        whereClause,
        take: resultsPerPage,
        skip,
        groupByHousehold,
      }
      return isNameSearch(search)
        ? this.queryPeopleWithTimeoutGuard(queryArgs)
        : this.client.$queryRaw<Array<BaseDbPerson>>(
            this.buildRawPeopleQuery(queryArgs),
          )
    }

    const countArgs = {
      state,
      districtId: effectiveDistrictId,
      filters,
      search,
      groupByHousehold,
    }

    let totalResults: number
    let people: Array<BaseDbPerson>
    let currentPage: number

    if (groupByHousehold) {
      // Household counts are small, so the extra round trip is cheap. Resolve
      // the count first, clamp the requested page to the last household page,
      // then fetch at the clamped offset. This is the deliberate door-knocking
      // behavior: a client paging in from the (much longer) voter list lands on
      // the last household page instead of an empty one (no caller clamps
      // `page`), and currentPage matches the rows returned.
      totalResults = await this.rawCountForDistrict(countArgs)
      const householdPages = Math.max(
        1,
        Math.ceil(totalResults / resultsPerPage),
      )
      currentPage = Math.min(Math.max(1, page), householdPages)
      people = await buildData((currentPage - 1) * resultsPerPage)
    } else {
      // The ungrouped voter list is the hot, large-population path. Keep the
      // count and data queries PARALLEL so we neither add a round trip nor
      // serialize behind the count — critically, the count here is usually an
      // O(1) precomputed-stats lookup (see rawCountForDistrict), so folding it
      // into the data query (e.g. COUNT(*) OVER()) would be a regression, not a
      // win. Because we can't clamp the offset without the count, we fetch at
      // the requested offset and report the page we ACTUALLY fetched: an
      // out-of-bounds page returns empty rows with currentPage = the requested
      // page. Metadata never claims a page whose rows we didn't return (the old
      // divergence: clamped currentPage but empty rows). totalPages still tells
      // the client the valid range, and the webapp clamps navigation to it.
      ;[totalResults, people] = await Promise.all([
        this.rawCountForDistrict(countArgs),
        buildData((page - 1) * resultsPerPage),
      ])
      currentPage = Math.max(1, page)
    }

    const totalPages = Math.max(1, Math.ceil(totalResults / resultsPerPage))

    return {
      pagination: {
        totalResults,
        currentPage,
        pageSize: resultsPerPage,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPreviousPage: currentPage > 1,
      },
      people: people.map(transformToPersonOutput),
    }
  }

  // Filtered aggregates (COUNT/AVG age/AVG income) for a list-detail page's
  // membership (ENG-10706) — distinct from StatsService.getStats, which only
  // serves the precomputed, unfiltered DistrictStats row.
  async getAggregates(dto: AggregatesDTO): Promise<PeopleAggregates> {
    const resolved = await resolveDistrict(this.districtService, dto)
    const { state, useVoterOnlyPath, districtId } = resolved
    const effectiveDistrictId = useVoterOnlyPath ? null : districtId

    const sql = buildAggregatesSql({
      state,
      districtId: effectiveDistrictId,
      filters: dto.filters,
    })
    const rows = await this.client.$queryRaw<
      Array<{
        count: bigint
        avgAge: number | null
        avgIncome: number | null
      }>
    >(sql)
    const row = rows[0]
    const count = Number(row?.count ?? 0n)
    if (count === 0 && effectiveDistrictId) {
      await this.warnIfStatsButNoVoterRows(effectiveDistrictId, state)
    }

    return {
      count,
      avgAge: row?.avgAge ?? null,
      avgIncome: row?.avgIncome ?? null,
    }
  }

  async samplePeople(dto: SamplePeopleDTO) {
    return this.sampleService
      .samplePeople(dto)
      .then((people) => people.map(transformToPersonOutput))
  }

  private async rawCountForDistrict(args: {
    state: string
    districtId: string | null
    filters: FilterData
    search?: string
    groupByHousehold?: boolean
  }): Promise<number> {
    const { state, districtId, search, groupByHousehold } = args

    // The pre-computed stats shortcut counts voters; it does not know household
    // counts, so it is only valid for the ungrouped path.
    if (
      districtId &&
      !groupByHousehold &&
      !args.search &&
      args.filters.filters.length === 0
    ) {
      const { totalConstituents } =
        await this.statsService.getTotalCounts(districtId)
      return totalConstituents
    }

    const whereClause = buildVoterWhereSql({
      state,
      districtId,
      search,
      filters: args.filters,
    })

    // COUNT(DISTINCT <household key>) so totalResults/totalPages reflect
    // households, not voters — matching the DISTINCT ON data query.
    const countExpr = groupByHousehold
      ? Prisma.sql`COUNT(DISTINCT ${buildHouseholdKeySql('v')})::bigint`
      : Prisma.sql`COUNT(*)::bigint`

    const fromSql = districtId
      ? Prisma.sql`FROM "green"."DistrictVoter" dv
          JOIN "green"."Voter" v
            ON v."State" = dv."State"
           AND v."id"    = dv."voter_id"`
      : Prisma.sql`FROM "green"."Voter" v`

    const countSql = Prisma.sql`SELECT ${countExpr} AS voter_count
      ${fromSql}
      ${whereClause}`

    let rows: Array<{ voter_count: bigint }>
    if (!isNameSearch(search)) {
      rows = await this.client.$queryRaw<{ voter_count: bigint }[]>(countSql)
    } else {
      // Same pathological-plan exposure as the data query (the count shares the
      // name-LIKE WHERE), same guard. The fenced count re-aliases the capped row
      // set as v so countExpr (including the household key) applies unchanged. A
      // pattern that trips the timeout matches far fewer rows than the fence in
      // practice, so the fallback count is exact; if the cap ever binds, a floor
      // of 10k beats a request that never returns.
      const fencedCountSql = Prisma.sql`SELECT ${countExpr} AS voter_count
      FROM (SELECT v.* ${fromSql} ${whereClause} LIMIT ${NAME_SEARCH_FENCE_LIMIT}) v`
      rows = await this.countWithTimeoutGuard(countSql, fencedCountSql)
    }

    const count = Number(rows[0]?.voter_count ?? 0n)
    if (count === 0 && districtId) {
      await this.warnIfStatsButNoVoterRows(districtId, state)
    }
    return count
  }

  // Partial voter data (dev by construction, or a prod ETL regression) leaves
  // districts with a DistrictStats row but zero DistrictVoter rows: the
  // unfiltered stats shortcut reports a healthy count while any filtered query
  // joins to an empty set and returns 0 — which presents as a filter bug
  // (ENG-10745). Probing only on the zero-result path keeps the hot path free
  // of extra queries.
  private async warnIfStatsButNoVoterRows(
    districtId: string,
    state: string,
  ): Promise<void> {
    const [probe] = await this.client.$queryRaw<{ has_rows: boolean }[]>(
      Prisma.sql`SELECT EXISTS (
        SELECT 1 FROM "green"."DistrictVoter" WHERE "district_id" = ${districtId}::uuid
      ) AS has_rows`,
    )
    if (probe?.has_rows) {
      return
    }
    const totalConstituents =
      await this.statsService.findTotalConstituents(districtId)
    if (!totalConstituents) {
      return
    }
    this.logger.warn(
      { districtId, state, statsTotalConstituents: totalConstituents },
      'District has stats but no DistrictVoter rows; filtered results will be empty',
    )
  }

  private async countWithTimeoutGuard(
    countSql: Prisma.Sql,
    fencedCountSql: Prisma.Sql,
  ): Promise<Array<{ voter_count: bigint }>> {
    const startedAt = Date.now()
    try {
      const [, rows] = await this.client.$transaction([
        this.client.$executeRaw(
          Prisma.raw(
            `SET LOCAL statement_timeout = '${NAME_SEARCH_TIMEOUT_MS}ms'`,
          ),
        ),
        this.client.$queryRaw<Array<{ voter_count: bigint }>>(countSql),
      ])
      return rows
    } catch (error) {
      if (!isStatementTimeoutError(error)) {
        throw error
      }
      this.logger.warn(
        { elapsedMs: Date.now() - startedAt },
        'Name-search count hit the statement timeout; retrying with trigram-fenced subquery',
      )
      return this.client.$queryRaw<Array<{ voter_count: bigint }>>(
        fencedCountSql,
      )
    }
  }

  // Name-search LIKE patterns can trigger a pathological full-partition plan
  // (see NAME_SEARCH_TIMEOUT_MS). Attempt the normal query under a statement
  // timeout; if Postgres cancels it (SQLSTATE 57014), retry once with the
  // trigram-fenced shape. SET LOCAL only holds for the transaction it runs
  // in, and Prisma batch transactions execute on a single connection, so the
  // timeout scopes to exactly this query.
  private async queryPeopleWithTimeoutGuard(
    args: RawPeopleQueryArgs,
  ): Promise<Array<BaseDbPerson>> {
    const startedAt = Date.now()
    try {
      const [, people] = await this.client.$transaction([
        // SET does not accept bind parameters; the interval is a
        // compile-time constant, so Prisma.raw is safe here.
        this.client.$executeRaw(
          Prisma.raw(
            `SET LOCAL statement_timeout = '${NAME_SEARCH_TIMEOUT_MS}ms'`,
          ),
        ),
        this.client.$queryRaw<Array<BaseDbPerson>>(
          this.buildRawPeopleQuery(args),
        ),
      ])
      return people
    } catch (error) {
      if (!isStatementTimeoutError(error)) {
        throw error
      }
      this.logger.warn(
        { elapsedMs: Date.now() - startedAt },
        'Name-search voter query hit the statement timeout; retrying with trigram-fenced subquery',
      )
      return this.client.$queryRaw<Array<BaseDbPerson>>(
        this.buildRawPeopleQuery({
          ...args,
          fenceLimit: NAME_SEARCH_FENCE_LIMIT,
        }),
      )
    }
  }

  private buildRawPeopleQuery(args: RawPeopleQueryArgs): Prisma.Sql {
    const { districtId, whereClause, take, skip, groupByHousehold } = args

    const householdKey = buildHouseholdKeySql('v')
    // Grouped mode: expose the household key + how many of the *matching*
    // voters share the address. The window count is evaluated after the WHERE
    // clause, so when a filter is active (e.g. hasCellPhone) it counts only the
    // voters at that address who match — i.e. how many matching contacts the
    // canvasser will find there, NOT raw occupancy. It runs before DISTINCT ON,
    // so the retained representative row keeps the full partition count.
    // DISTINCT ON keeps one representative voter per household; the leading
    // ORDER BY must match the DISTINCT ON expression, with v."id" as the
    // deterministic tiebreaker that also keeps pagination stable.
    const computedColumns = groupByHousehold
      ? [
          Prisma.sql`${householdKey} AS "householdId"`,
          Prisma.sql`COUNT(*) OVER (PARTITION BY ${householdKey})::bigint AS "householdSize"`,
        ]
      : []
    const distinctClause = groupByHousehold
      ? Prisma.sql`DISTINCT ON (${householdKey}) `
      : Prisma.empty
    const orderByClause = groupByHousehold
      ? Prisma.sql`ORDER BY ${householdKey}, v."id"`
      : Prisma.sql`ORDER BY v."id"`

    const selectSql = buildVoterSelectSql(
      args.extraFields,
      computedColumns,
      distinctClause,
    )
    const voterTable = Prisma.raw(`"${DATABASE_SCHEMA}"."${VOTER_TABLENAME}"`)
    const dvTable = Prisma.raw(
      `"${DATABASE_SCHEMA}"."${DISTRICTVOTER_TABLENAME}"`,
    )
    const joinClause = districtId
      ? Prisma.sql`JOIN ${dvTable} dv
            ON v."State" = dv."State" AND v."id" = dv."voter_id"`
      : Prisma.empty

    // Fenced shape: the inner subquery has no ORDER BY, so the planner is
    // free to serve rare LIKE patterns from the trigram bitmap indexes
    // instead of walking the ordering index across the whole partition.
    // `SELECT v.*` re-exposes every voter column under the same alias, so
    // the outer SELECT / DISTINCT ON / window / ORDER BY run unchanged
    // against the fenced rows.
    const rowSource = args.fenceLimit
      ? Prisma.sql`(SELECT v.* FROM ${voterTable} v
          ${joinClause}
          ${whereClause}
          LIMIT ${args.fenceLimit}) v`
      : Prisma.sql`${voterTable} v
          ${joinClause}
          ${whereClause}`

    return Prisma.sql`${selectSql.sql}
          FROM ${rowSource}
          ${orderByClause}
          LIMIT ${take} OFFSET ${skip}`
  }
}
