import { Prisma } from '../../generated/people-prisma'
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
} from '../schemas/people.schema'
import { createPeopleDbBase, PEOPLE_MODELS } from '../peopleDbBase.util'
import { VoterSampleService } from './voterSample.service'
import {
  COMPARISON_STATEMENT_TIMEOUT_MS,
  ShadowReadService,
} from '../shadowRead.service'

import { Injectable, NotFoundException } from '@nestjs/common'
import { DistrictService } from './district.service'
import { transformToPersonOutput } from '../utils/transformToPersonOutput.util'
import { FilterData } from '../schemas/filters.schema'
import { StatsService } from './stats.service'
import {
  buildVoterSelectSql,
  BaseDbPerson,
  ExtraSelectedField,
} from '../voter.select'
import { resolveDistrict } from '../utils/resolveDistrict.util'
import {
  buildVoterWhereSql,
  isNameSearch,
  stateEquals,
} from '../utils/buildVoterWhereSql.util'
import { buildAggregatesSql } from '../utils/buildAggregatesSql.util'
import { buildOverlapCountSql } from '../utils/buildOverlapCountSql.utils'
import { buildHouseholdKeySql } from '../utils/buildHouseholdKeySql.util'
import { runUnderStatementTimeout } from '../utils/statementTimeout.util'

export const DATABASE_SCHEMA = 'green'

const VOTER_TABLENAME = 'Voter'
const DISTRICTVOTER_TABLENAME = 'DistrictVoter'

type RawPeopleQueryArgs = {
  districtId: string | null
  whereClause: Prisma.Sql
  take: number
  skip: number
  extraFields?: ExtraSelectedField[]
  groupByHousehold?: boolean
  // Name-search only: wrap the match set in a MATERIALIZED CTE so the planner
  // resolves the trigram LIKE via the GIN index first, instead of walking the
  // id-ordering index across the whole partition to satisfy ORDER BY + LIMIT
  // (the ~30s pathological plan for a rare pattern). Does not truncate.
  forceTrigramPlan?: boolean
}

@Injectable()
export class VoterQueryService extends createPeopleDbBase(PEOPLE_MODELS.Voter) {
  constructor(
    private readonly shadow: ShadowReadService,
    private readonly sampleService: VoterSampleService,
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
    if (!this.shadow.enabled) return this.findPeopleFromPostgres(dto)
    return this.shadow.compare({
      op: 'list',
      districtId: dto.districtId,
      authoritative: () => this.shadow.databricks.findPeople(dto),
      comparison: () => this.findPeopleFromPostgres(dto),
      fingerprintAuthoritative: (result) => result.pagination.totalResults,
      fingerprintComparison: (result) => result.pagination.totalResults,
    })
  }

  private async findPeopleFromPostgres(dto: ListPeopleDTO) {
    const resolved = await resolveDistrict(this.districtService, dto)
    const { state, useVoterOnlyPath, districtId } = resolved
    const {
      filters,
      search,
      resultsPerPage,
      page,
      groupByHousehold,
      skipCount,
    } = dto
    const effectiveDistrictId = useVoterOnlyPath ? null : districtId

    const whereClause = buildVoterWhereSql({
      state,
      districtId: effectiveDistrictId,
      filters,
      search,
      idOverrides: dto.idOverrides,
      contactsMadeIdOverrides: dto.contactsMadeIdOverrides,
    })
    const buildData = (skip: number) =>
      this.runUnderStatementTimeout<BaseDbPerson>(
        this.buildRawPeopleQuery({
          districtId: effectiveDistrictId,
          whereClause,
          take: resultsPerPage,
          skip,
          groupByHousehold,
          forceTrigramPlan: isNameSearch(search),
        }),
      )

    const countArgs = {
      state,
      districtId: effectiveDistrictId,
      filters,
      search,
      groupByHousehold,
      idOverrides: dto.idOverrides,
      contactsMadeIdOverrides: dto.contactsMadeIdOverrides,
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
      if (skipCount) {
        // Phone-list build: page the audience to completion off the rows
        // returned, never the count. totalResults is unused by that caller.
        people = await buildData((page - 1) * resultsPerPage)
        totalResults = 0
      } else {
        const [countResult, peopleResult] = await Promise.all([
          this.rawCountForDistrict(countArgs),
          buildData((page - 1) * resultsPerPage),
        ])
        totalResults = countResult
        people = peopleResult
      }
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
  async getAggregates(dto: AggregatesDTO): Promise<PeopleAggregatesResponse> {
    if (!this.shadow.enabled) return this.getAggregatesFromPostgres(dto)
    return this.shadow.compare({
      op: 'aggregates',
      districtId: dto.districtId,
      authoritative: () => this.shadow.databricks.getAggregates(dto),
      comparison: () => this.getAggregatesFromPostgres(dto),
      fingerprintAuthoritative: (result) => result.count,
      fingerprintComparison: (result) => result.count,
    })
  }

  private async getAggregatesFromPostgres(
    dto: AggregatesDTO,
  ): Promise<PeopleAggregatesResponse> {
    const resolved = await resolveDistrict(this.districtService, dto)
    const { state, useVoterOnlyPath, districtId } = resolved
    const effectiveDistrictId = useVoterOnlyPath ? null : districtId

    const sql = buildAggregatesSql({
      state,
      districtId: effectiveDistrictId,
      filters: dto.filters,
      idOverrides: dto.idOverrides,
      contactsMadeIdOverrides: dto.contactsMadeIdOverrides,
    })
    const rows = await this.runUnderStatementTimeout<{
      count: bigint
      avgAge: number | null
      avgIncome: number | null
    }>(sql)
    const row = rows[0]
    const count = Number(row?.count ?? 0n)
    if (count === 0 && effectiveDistrictId) {
      this.probeStatsWithoutVoterRows(effectiveDistrictId, state)
    }

    // ENG-10775: gp-api/gp-webapp both validate this shape against the same
    // contracts schema — parsing it here keeps the producer honest.
    return PeopleAggregatesResponseSchema.parse({
      count,
      avgAge: row?.avgAge ?? null,
      avgIncome: row?.avgIncome ?? null,
    })
  }

  // Saved-list overlap count (ENG-10840): how many of the current selection
  // also belong to at least one of the org's saved lists. Runs through the
  // same statement-timeout guard as the count/aggregates queries.
  async getOverlapCount(
    dto: OverlapCountDTO,
  ): Promise<PeopleOverlapCountResponse> {
    if (!this.shadow.enabled) return this.getOverlapCountFromPostgres(dto)
    return this.shadow.compare({
      op: 'overlap',
      districtId: dto.districtId,
      authoritative: () => this.shadow.databricks.getOverlapCount(dto),
      comparison: () => this.getOverlapCountFromPostgres(dto),
      fingerprintAuthoritative: (result) => result.count,
      fingerprintComparison: (result) => result.count,
    })
  }

  private async getOverlapCountFromPostgres(
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
      contactsMadeIdOverrides: dto.contactsMadeIdOverrides,
    }
    const rows = await this.runUnderStatementTimeout<{
      overlap_count: bigint
    }>(buildOverlapCountSql(baseArgs))
    const count = Number(rows[0]?.overlap_count ?? 0n)

    // ENG-10775 pattern: the producer validates its own response against the
    // shared contract so gp-api and people-api can't drift on this shape.
    return PeopleOverlapCountResponseSchema.parse({ count })
  }

  async samplePeople(dto: SamplePeopleDTO) {
    if (!this.shadow.enabled) return this.samplePeopleFromPostgres(dto)
    return this.shadow.compare({
      op: 'sample',
      districtId: dto.districtId,
      authoritative: () => this.shadow.databricks.samplePeople(dto),
      comparison: () => this.samplePeopleFromPostgres(dto),
      // A sample is deliberately non-deterministic, so the row count is the
      // only thing worth comparing: identical ids would mean the seed had
      // stopped rotating, not that the stores agreed.
      fingerprintAuthoritative: (people) => people.length,
      fingerprintComparison: (people) => people.length,
    })
  }

  private async samplePeopleFromPostgres(dto: SamplePeopleDTO) {
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
    contactsMadeIdOverrides?: IdOverrides
  }): Promise<number> {
    const { state, districtId, search, groupByHousehold } = args

    // The pre-computed stats shortcut counts voters; it does not know household
    // counts, so it is only valid for the ungrouped path.
    if (
      districtId &&
      !groupByHousehold &&
      !args.search &&
      args.filters.filters.length === 0 &&
      (args.idOverrides?.include?.length ?? 0) === 0 &&
      (args.idOverrides?.exclude?.length ?? 0) === 0 &&
      (args.contactsMadeIdOverrides?.include?.length ?? 0) === 0 &&
      (args.contactsMadeIdOverrides?.exclude?.length ?? 0) === 0
    ) {
      // A district with no pre-computed stats row has no shortcut, not no
      // voters — fall through to the real count instead of failing the
      // request.
      const totalCounts = await this.statsService.findTotalCounts(districtId)
      if (totalCounts) {
        return totalCounts.totalConstituents
      }
    }

    const whereClause = buildVoterWhereSql({
      state,
      districtId,
      search,
      filters: args.filters,
      idOverrides: args.idOverrides,
      contactsMadeIdOverrides: args.contactsMadeIdOverrides,
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

    // A broad/low-selectivity filter on a large district can be a genuine
    // multi-second full scan; we return the true count and only fail if it
    // exceeds the hard statement timeout (a pathological plan, not a big
    // audience). No floor — an honest number or a loud 504.
    const rows = await this.runUnderStatementTimeout<{
      voter_count: bigint
    }>(countSql)

    const count = Number(rows[0]?.voter_count ?? 0n)
    if (count === 0 && districtId) {
      this.probeStatsWithoutVoterRows(districtId, state)
    }
    return count
  }

  // Partial voter data (dev by construction, or a prod ETL regression) leaves
  // districts with a DistrictStats row but zero DistrictVoter rows: the
  // unfiltered stats shortcut reports a healthy count while any filtered query
  // joins to an empty set and returns 0 — which presents as a filter bug
  // (ENG-10745). Probing only on the zero-result path keeps the hot path free
  // of extra queries.
  // The probe below is a logging side-effect, so it must never decide what the
  // caller gets back. Awaited, a statement or pool timeout inside it turned a
  // legitimate zero-result into an error response; in dual-read mode the
  // comparison ceiling is tighter than the user-facing one, which makes that
  // more likely rather than less. Failure to explain an empty district is not
  // a failure to answer the request.
  private probeStatsWithoutVoterRows(districtId: string, state: string): void {
    void this.warnIfStatsButNoVoterRows(districtId, state).catch(
      (err: unknown) => {
        this.logger.warn(
          { err, districtId, state },
          'stats-without-voter-rows probe failed; skipping the diagnostic',
        )
      },
    )
  }

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

  private async runUnderStatementTimeout<T>(sql: Prisma.Sql): Promise<T[]> {
    return runUnderStatementTimeout<T>(
      this.client,
      sql,
      this.logger,
      'The voter query took too long to run. Narrow the audience and try again.',
      // In dual-read mode these queries are comparison-only — Databricks
      // serves the request — so they get a tighter ceiling than a user-facing
      // 25s. A slow comparison must not hold a pooled connection when nothing
      // is waiting on its answer. SET LOCAL means Postgres cancels the query
      // itself rather than us abandoning it client-side and letting it burn
      // CPU for another 17 seconds.
      this.shadow.enabled ? COMPARISON_STATEMENT_TIMEOUT_MS : undefined,
    )
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

    // Name-search forces the trigram plan: a MATERIALIZED CTE resolves the
    // LIKE match set up front via the trigram GIN index, so the planner can't
    // instead walk the id-ordering index across the whole partition to satisfy
    // the outer ORDER BY + LIMIT (the ~30s plan for a rare pattern). `SELECT
    // v.*` re-exposes every voter column under the same alias, so the outer
    // SELECT / DISTINCT ON / window / ORDER BY run unchanged. Unlike a plain
    // subquery MATERIALIZED is not inlined, and there is no LIMIT, so it never
    // truncates the result.
    const matchedCte = args.forceTrigramPlan
      ? Prisma.sql`WITH matched AS MATERIALIZED (
          SELECT v.* FROM ${voterTable} v
          ${joinClause}
          ${whereClause}
        ) `
      : Prisma.empty
    const rowSource = args.forceTrigramPlan
      ? Prisma.sql`matched v`
      : Prisma.sql`${voterTable} v
          ${joinClause}
          ${whereClause}`

    return Prisma.sql`${matchedCte}${selectSql.sql}
          FROM ${rowSource}
          ${orderByClause}
          LIMIT ${take} OFFSET ${skip}`
  }
}
