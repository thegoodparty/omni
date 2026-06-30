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

    if (groupByHousehold) {
      // Household count is far smaller than the voter count, so a client that
      // was on a high voter-list page and switches to door knocking would page
      // past the end. Resolve the count first, clamp the offset to the last
      // household page, then fetch — otherwise the request deterministically
      // returns an empty page (no caller clamps `page`).
      totalResults = await this.rawCountForDistrict(countArgs)
      const totalPages = Math.max(1, Math.ceil(totalResults / resultsPerPage))
      const clampedPage = Math.min(Math.max(1, page), totalPages)
      people = await buildData((clampedPage - 1) * resultsPerPage)
    } else {
      // Ungrouped path keeps the parallel count/data fetch. Its pre-existing
      // out-of-bounds-page divergence (TODO below) is unchanged here.
      // TODO: This executes count and data query in parallel for latency, but
      // the data query uses the requested page offset while currentPage is
      // clamped from totalResults below. If requested page is out of bounds,
      // pagination metadata and returned rows can diverge.
      ;[totalResults, people] = await Promise.all([
        this.rawCountForDistrict(countArgs),
        buildData((page - 1) * resultsPerPage),
      ])
    }

    const totalPages = Math.max(1, Math.ceil(totalResults / resultsPerPage))
    const currentPage = Math.min(Math.max(1, page), totalPages)

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
