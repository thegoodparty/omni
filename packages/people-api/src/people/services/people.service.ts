import { Prisma } from '../../generated/prisma'
import {
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
import { buildVoterWhereSql } from '../utils/buildVoterWhereSql.utils'
import { buildHouseholdKeySql } from '../utils/buildHouseholdKeySql.utils'

export const DATABASE_SCHEMA = 'green'

const VOTER_TABLENAME = 'Voter'
const DISTRICTVOTER_TABLENAME = 'DistrictVoter'

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
      Prisma.sql`${select} FROM "green"."Voter" v WHERE v."id" = ${id}::uuid AND v."State" = CAST(${state}::text AS "public"."USState") ${districtExistsClause}`,
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

    const buildData = (skip: number) =>
      this.client.$queryRaw<Array<BaseDbPerson>>(
        this.buildRawPeopleQuery({
          districtId: effectiveDistrictId,
          whereClause: buildVoterWhereSql({
            state,
            districtId: effectiveDistrictId,
            filters,
            search,
          }),
          take: resultsPerPage,
          skip,
          groupByHousehold,
        }),
      )

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

    if (districtId) {
      const rows = await this.client.$queryRaw<{ voter_count: bigint }[]>(
        Prisma.sql`SELECT ${countExpr} AS voter_count
          FROM "green"."DistrictVoter" dv
          JOIN "green"."Voter" v
            ON v."State" = dv."State"
           AND v."id"    = dv."voter_id"
          ${whereClause}`,
      )
      const count = rows[0]?.voter_count ?? 0n
      return Number(count)
    }
    const rows = await this.client.$queryRaw<{ voter_count: bigint }[]>(
      Prisma.sql`SELECT ${countExpr} AS voter_count
        FROM "green"."Voter" v
        ${whereClause}`,
    )
    const count = rows[0]?.voter_count ?? 0n
    return Number(count)
  }

  private buildRawPeopleQuery(args: {
    districtId: string | null
    whereClause: Prisma.Sql
    take: number
    skip: number
    extraFields?: ExtraSelectedField[]
    groupByHousehold?: boolean
  }): Prisma.Sql {
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

    return Prisma.sql`${selectSql.sql}
          FROM ${voterTable} v
          ${joinClause}
          ${whereClause}
          ${orderByClause}
          LIMIT ${take} OFFSET ${skip}`
  }
}
