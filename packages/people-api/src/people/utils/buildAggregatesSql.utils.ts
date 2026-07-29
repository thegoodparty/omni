import { type IdOverrides } from '@goodparty_org/contracts'
import { Prisma } from '../../generated/prisma'
import { FilterData } from '../schemas/filters.schema'
import { buildVoterWhereSql } from './buildVoterWhereSql.utils'

// COUNT/AVG over a list-detail page's membership (see ENG-10706). Shares the
// same WHERE-building family as the list/count paths so a filter resolves to
// the identical membership in both places.
export const buildAggregatesSql = (args: {
  state: string
  districtId?: string | null
  filters: FilterData
  fenceLimit?: number
  idOverrides?: IdOverrides
}): Prisma.Sql => {
  const { state, districtId, filters, fenceLimit, idOverrides } = args

  const whereClause = buildVoterWhereSql({
    state,
    districtId,
    filters,
    idOverrides,
  })
  const fromSql = districtId
    ? Prisma.sql`FROM "green"."DistrictVoter" dv
        JOIN "green"."Voter" v
          ON v."State" = dv."State" AND v."id" = dv."voter_id"`
    : Prisma.sql`FROM "green"."Voter" v`

  // Same DistrictVoter -> Voter join as the count/list paths, so it is prone
  // to the same pathological plan (see SLOW_QUERY_TIMEOUT_MS in
  // people.service.ts). When fenceLimit is set, the aggregates compute over an
  // unordered, capped row set instead of the full match: count/avgAge/avgIncome
  // become a sample, not an exact figure, but the plan stays sane.
  const rowSource = fenceLimit
    ? Prisma.sql`FROM (SELECT v.* ${fromSql} ${whereClause} LIMIT ${fenceLimit}) v`
    : Prisma.sql`${fromSql}
    ${whereClause}`

  // AVG(integer) returns Postgres NUMERIC, which the driver otherwise
  // surfaces as a string; casting to float8 gets a plain JS number (or null
  // for an empty/all-null aggregate) back from $queryRaw directly.
  return Prisma.sql`SELECT
      COUNT(*)::bigint AS count,
      AVG(v."Age_Int")::float8 AS "avgAge",
      AVG(v."Estimated_Income_Amount_Int")::float8 AS "avgIncome"
    ${rowSource}`
}
