import { Prisma } from '../../generated/people-prisma'
import {
  type IdOverrides,
  PeopleAggregatesResponse,
  PeopleOverlapCountResponse,
} from '@goodparty_org/contracts'
import {
  AggregatesDTO,
  GetPersonQueryDTO,
  ListPeopleDTO,
  OverlapCountDTO,
  SamplePeopleDTO,
} from '../schemas/people.schema'
import { createPeopleDbBase, PEOPLE_MODELS } from '../peopleDbBase.util'

import { Inject, Injectable, NotFoundException } from '@nestjs/common'
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
import { buildHouseholdKeySql } from '../utils/buildHouseholdKeySql.util'
import { runUnderStatementTimeout } from '../utils/statementTimeout.util'
import { DatabricksVoterService } from '../databricks/databricksVoter.service'

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
  // Property-injected, not constructor-injected: the Postgres path is still
  // the default, and this keeps its constructor (and every test that builds
  // it) untouched while the store is behind a flag.
  @Inject(DatabricksVoterService)
  private readonly databricks!: DatabricksVoterService

  constructor(
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
    // Household de-dup is the one list shape still served from people-db: its
    // DISTINCT ON has no direct equivalent here, and door-knocking is its only
    // caller. Every other list read comes from Databricks.
    if (!dto.groupByHousehold) {
      return this.databricks.findPeople(dto)
    }
    const { state, useVoterOnlyPath, districtId } = await resolveDistrict(
      this.districtService,
      dto,
    )
    const { filters, search, resultsPerPage, page } = dto
    const effectiveDistrictId = useVoterOnlyPath ? null : districtId

    const whereClause = buildVoterWhereSql({
      state,
      districtId: effectiveDistrictId,
      filters,
      search,
      idOverrides: dto.idOverrides,
      contactsMadeIdOverrides: dto.contactsMadeIdOverrides,
    })

    // Household counts are small, so the extra round trip is cheap. Resolve the
    // count first, clamp the requested page to the last household page, then
    // fetch at the clamped offset. This is the deliberate door-knocking
    // behavior: a client paging in from the (much longer) voter list lands on
    // the last household page instead of an empty one (no caller clamps
    // `page`), and currentPage matches the rows returned.
    const totalResults = await this.rawCountForDistrict({
      state,
      districtId: effectiveDistrictId,
      filters,
      search,
      idOverrides: dto.idOverrides,
      contactsMadeIdOverrides: dto.contactsMadeIdOverrides,
    })
    const totalPages = Math.max(1, Math.ceil(totalResults / resultsPerPage))
    const currentPage = Math.min(Math.max(1, page), totalPages)
    const people = await this.runUnderStatementTimeout<BaseDbPerson>(
      this.buildRawPeopleQuery({
        districtId: effectiveDistrictId,
        whereClause,
        take: resultsPerPage,
        skip: (currentPage - 1) * resultsPerPage,
        groupByHousehold: true,
        forceTrigramPlan: isNameSearch(search),
      }),
    )

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
    return this.databricks.getAggregates(dto)
  }

  // Saved-list overlap count (ENG-10840): how many of the current selection
  // also belong to at least one of the org's saved lists. Runs through the
  // same statement-timeout guard as the count/aggregates queries.
  async getOverlapCount(
    dto: OverlapCountDTO,
  ): Promise<PeopleOverlapCountResponse> {
    return this.databricks.getOverlapCount(dto)
  }

  async samplePeople(dto: SamplePeopleDTO) {
    return this.databricks.samplePeople(dto)
  }

  // Households, not voters: COUNT(DISTINCT <household key>) matches the
  // DISTINCT ON data query so totalResults and totalPages agree with the rows.
  private async rawCountForDistrict(args: {
    state: string
    districtId: string | null
    filters: FilterData
    search?: string
    idOverrides?: IdOverrides
    contactsMadeIdOverrides?: IdOverrides
  }): Promise<number> {
    const { state, districtId, search } = args

    const whereClause = buildVoterWhereSql({
      state,
      districtId,
      search,
      filters: args.filters,
      idOverrides: args.idOverrides,
      contactsMadeIdOverrides: args.contactsMadeIdOverrides,
    })

    const countExpr = Prisma.sql`COUNT(DISTINCT ${buildHouseholdKeySql('v')})::bigint`

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

  private async runUnderStatementTimeout<T>(sql: Prisma.Sql): Promise<T[]> {
    return runUnderStatementTimeout<T>(
      this.client,
      sql,
      this.logger,
      'The voter query took too long to run. Narrow the audience and try again.',
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
