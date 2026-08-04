import { type IdOverrides } from '@goodparty_org/contracts'
import { Prisma } from '../../generated/people-prisma'
import { FilterData } from '../schemas/filters.schema'
import { buildVoterWhereSql } from './buildVoterWhereSql.util'

// COUNT/AVG over a list-detail page's membership (see ENG-10706). Shares the
// same WHERE-building family as the list/count paths so a filter resolves to
// the identical membership in both places.
export const buildAggregatesSql = (args: {
  state: string
  districtId?: string | null
  filters: FilterData
  idOverrides?: IdOverrides
  contactsMadeIdOverrides?: IdOverrides
}): Prisma.Sql => {
  const { state, districtId, filters, idOverrides, contactsMadeIdOverrides } =
    args

  const whereClause = buildVoterWhereSql({
    state,
    districtId,
    filters,
    idOverrides,
    contactsMadeIdOverrides,
  })
  const fromSql = districtId
    ? Prisma.sql`FROM "green"."DistrictVoter" dv
        JOIN "green"."Voter" v
          ON v."State" = dv."State" AND v."id" = dv."voter_id"`
    : Prisma.sql`FROM "green"."Voter" v`

  // AVG(integer) returns Postgres NUMERIC, which the driver otherwise
  // surfaces as a string; casting to float8 gets a plain JS number (or null
  // for an empty/all-null aggregate) back from $queryRaw directly.
  return Prisma.sql`SELECT
      COUNT(*)::bigint AS count,
      AVG(v."Age_Int")::float8 AS "avgAge",
      AVG(v."Estimated_Income_Amount_Int")::float8 AS "avgIncome"
    ${fromSql}
    ${whereClause}`
}
