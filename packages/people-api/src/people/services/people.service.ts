import { Prisma } from '../../generated/prisma'
import {
  type IdOverrides,
  PeopleAggregatesResponse,
  PeopleAggregatesResponseSchema,
  PeopleOverlapCountResponse,
  PeopleOverlapCountResponseSchema,
} from '@goodparty_org/contracts'
import {
  AggregatesDTO,
  GetPersonQueryDTO,
  ListPeopleDTO,
  OverlapCountDTO,
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
import { buildOverlapCountSql } from '../utils/buildOverlapCountSql.utils'
import { buildHouseholdKeySql } from '../utils/buildHouseholdKeySql.utils'

export const DATABASE_SCHEMA = 'green'

const VOTER_TABLENAME = 'Voter'
const DISTRICTVOTER_TABLENAME = 'DistrictVoter'

// Two distinct query shapes can trip a pathological plan: a near-zero-match
// name-search LIKE pattern ('%zzq%') where Postgres floors LIKE selectivity
// estimates at ~2000 rows, so the planner walks the ordering index and scans
// the entire state partition (30+ seconds on large states) instead of using
// the trigram indexes — and, separately, a broad/low-selectivity filter (e.g.
// gender/education not_null) on a large district, which forces a full
// DistrictVoter -> Voter nested loop. Both resolve in well under a second
// when the plan is sane, so only runaway plans trip this timeout.
const SLOW_QUERY_TIMEOUT_MS = 2500
// The fallback wraps the same WHERE in an UNORDERED subquery capped at this
// many rows, which frees the planner to pick an indexed scan instead of the
// pathological plan. For the voter LIST (queryPeopleWithTimeoutGuard), fencing
// is only safe for name-search: it's gated to patterns that already proved
// slow, i.e. patterns matching far fewer rows than this cap, so the fence
// never truncates the ordered, paginated result — fencing a broad filter's
// list would silently drop rows from the page. A COUNT has no ordering to
// preserve, so every count (rawCountForDistrict) can always run through the
// fence: exact when it completes under the timeout, floored at this limit
// when it would be slow.
const FENCE_LIMIT = 10000
// queryWithTimeoutFence's retry still runs a live query (an unordered,
// LIMIT-capped subquery, but a query nonetheless) — it can hit the same
// pathological plan under enough load, so it needs its own bound instead of
// running unfenced and holding a connection open indefinitely. Double the
// primary timeout: the retry already paid the cost of the first attempt, so
// give it real room before giving up.
const FENCE_RETRY_TIMEOUT_MS = SLOW_QUERY_TIMEOUT_MS * 2

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
      idOverrides: dto.idOverrides,
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
      idOverrides: dto.idOverrides,
    }

    let totalResults: number
    let fenced: boolean
    let people: Array<BaseDbPerson>
    let currentPage: number

    if (groupByHousehold) {
      // Household counts are small, so the extra round trip is cheap. Resolve
      // the count first, clamp the requested page to the last household page,
      // then fetch at the clamped offset. This is the deliberate door-knocking
      // behavior: a client paging in from the (much longer) voter list lands on
      // the last household page instead of an empty one (no caller clamps
      // `page`), and currentPage matches the rows returned.
      ;({ count: totalResults, fenced } =
        await this.rawCountForDistrict(countArgs))
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
      const [countResult, peopleResult] = await Promise.all([
        this.rawCountForDistrict(countArgs),
        buildData((page - 1) * resultsPerPage),
      ])
      ;({ count: totalResults, fenced } = countResult)
      people = peopleResult
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
        fenced,
      },
      people: people.map(transformToPersonOutput),
    }
  }

  // Filtered aggregates (COUNT/AVG age/AVG income) for a list-detail page's
  // membership (ENG-10706) — distinct from StatsService.getStats, which only
  // serves the precomputed, unfiltered DistrictStats row.
  async getAggregates(dto: AggregatesDTO): Promise<PeopleAggregatesResponse> {
    const resolved = await resolveDistrict(this.districtService, dto)
    const { state, useVoterOnlyPath, districtId } = resolved
    const effectiveDistrictId = useVoterOnlyPath ? null : districtId

    const sql = buildAggregatesSql({
      state,
      districtId: effectiveDistrictId,
      filters: dto.filters,
      idOverrides: dto.idOverrides,
    })
    // Same DistrictVoter -> Voter join as rawCountForDistrict, so it shares the
    // same pathological-plan exposure; the fenced fallback trades an exact
    // AVG for a sampled one over the capped row set (see buildAggregatesSql).
    const fencedSql = buildAggregatesSql({
      state,
      districtId: effectiveDistrictId,
      filters: dto.filters,
      fenceLimit: FENCE_LIMIT,
      idOverrides: dto.idOverrides,
    })
    const { rows, fenced } = await this.queryWithTimeoutFence<{
      count: bigint
      avgAge: number | null
      avgIncome: number | null
    }>(sql, fencedSql)
    const row = rows[0]
    const count = Number(row?.count ?? 0n)
    if (count === 0 && effectiveDistrictId) {
      await this.warnIfStatsButNoVoterRows(effectiveDistrictId, state)
    }

    // ENG-10775: gp-api/gp-webapp both validate this shape against the same
    // contracts schema — parsing it here keeps the producer honest.
    return PeopleAggregatesResponseSchema.parse({
      count,
      avgAge: row?.avgAge ?? null,
      avgIncome: row?.avgIncome ?? null,
      fenced,
    })
  }

  // Saved-list overlap count (ENG-10840): how many of the current selection
  // also belong to at least one of the org's saved lists. Shares the same
  // pathological-plan exposure as the count/aggregates queries (see
  // SLOW_QUERY_TIMEOUT_MS), so it runs through the identical
  // queryWithTimeoutFence guard rather than a bespoke timeout.
  async getOverlapCount(
    dto: OverlapCountDTO,
  ): Promise<PeopleOverlapCountResponse> {
    const resolved = await resolveDistrict(this.districtService, dto)
    const { state, useVoterOnlyPath, districtId } = resolved
    const effectiveDistrictId = useVoterOnlyPath ? null : districtId

    const baseArgs = {
      state,
      districtId: effectiveDistrictId,
      filters: dto.filters,
      search: dto.search,
      savedFilterSets: dto.savedFilterSets,
      idOverrides: dto.idOverrides,
    }
    const sql = buildOverlapCountSql(baseArgs)
    const fencedSql = buildOverlapCountSql({
      ...baseArgs,
      fenceLimit: FENCE_LIMIT,
    })

    const { rows, fenced } = await this.queryWithTimeoutFence<{
      overlap_count: bigint
    }>(sql, fencedSql)
    const count = Number(rows[0]?.overlap_count ?? 0n)

    // ENG-10775 pattern: the producer validates its own response against the
    // shared contract so gp-api and people-api can't drift on this shape.
    return PeopleOverlapCountResponseSchema.parse({ count, fenced })
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
    idOverrides?: IdOverrides
  }): Promise<{ count: number; fenced: boolean }> {
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
      return { count: totalConstituents, fenced: false }
    }

    const whereClause = buildVoterWhereSql({
      state,
      districtId,
      search,
      filters: args.filters,
      idOverrides: args.idOverrides,
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

    // Any broad/low-selectivity filter (not just a name-search LIKE pattern)
    // can trip the same pathological DistrictVoter -> Voter nested-loop plan,
    // so every count runs through the timeout guard, not just name-search.
    // Exact when the query completes under the timeout; otherwise a floor in
    // the count's own unit: FENCE_LIMIT voters for the plain COUNT(*), or
    // FENCE_LIMIT distinct households for the grouped path. Capping raw voters
    // then COUNT(DISTINCT household) would floor well below FENCE_LIMIT.
    const fencedCountSql = groupByHousehold
      ? Prisma.sql`SELECT COUNT(*)::bigint AS voter_count
      FROM (SELECT DISTINCT ${buildHouseholdKeySql('v')} ${fromSql} ${whereClause} LIMIT ${FENCE_LIMIT}) distinct_hh`
      : Prisma.sql`SELECT ${countExpr} AS voter_count
      FROM (SELECT v.* ${fromSql} ${whereClause} LIMIT ${FENCE_LIMIT}) v`
    const { rows, fenced } = await this.queryWithTimeoutFence<{
      voter_count: bigint
    }>(countSql, fencedCountSql)

    const count = Number(rows[0]?.voter_count ?? 0n)
    if (count === 0 && districtId) {
      await this.warnIfStatsButNoVoterRows(districtId, state)
    }
    return { count, fenced }
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

  // Shared by every guarded raw query (the count and the aggregates): attempt
  // primarySql under a statement timeout; if Postgres cancels it (SQLSTATE
  // 57014), retry once with fencedSql under its own (longer) statement
  // timeout — a fenced retry that also times out fails cleanly instead of
  // running unbounded. SET LOCAL only holds for the transaction it runs in,
  // and Prisma batch transactions execute on a single connection, so each
  // timeout scopes to exactly the query it wraps.
  private async queryWithTimeoutFence<T>(
    primarySql: Prisma.Sql,
    fencedSql: Prisma.Sql,
  ): Promise<{ rows: T[]; fenced: boolean }> {
    const startedAt = Date.now()
    try {
      const [, rows] = await this.client.$transaction([
        this.client.$executeRaw(
          Prisma.raw(
            `SET LOCAL statement_timeout = '${SLOW_QUERY_TIMEOUT_MS}ms'`,
          ),
        ),
        this.client.$queryRaw<T[]>(primarySql),
      ])
      return { rows, fenced: false }
    } catch (error) {
      if (!isStatementTimeoutError(error)) {
        throw error
      }
      this.logger.warn(
        { elapsedMs: Date.now() - startedAt },
        'Query hit the statement timeout; retrying with fenced subquery',
      )
      const [, rows] = await this.client.$transaction([
        this.client.$executeRaw(
          Prisma.raw(
            `SET LOCAL statement_timeout = '${FENCE_RETRY_TIMEOUT_MS}ms'`,
          ),
        ),
        this.client.$queryRaw<T[]>(fencedSql),
      ])
      return { rows, fenced: true }
    }
  }

  // Name-search LIKE patterns can trigger a pathological full-partition plan
  // (see SLOW_QUERY_TIMEOUT_MS). Attempt the normal query under a statement
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
            `SET LOCAL statement_timeout = '${SLOW_QUERY_TIMEOUT_MS}ms'`,
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
          fenceLimit: FENCE_LIMIT,
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
