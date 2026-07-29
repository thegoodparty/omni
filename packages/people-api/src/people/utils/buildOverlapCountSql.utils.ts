import { Prisma } from '../../generated/prisma'
import { FilterData } from '../schemas/filters.schema'
import { buildVoterFiltersSql } from './filters.sql.utils'
import { buildVoterWhereSql } from './buildVoterWhereSql.utils'

// Saved-list overlap count (ENG-10840): the current in-progress selection
// AND'd with the union of the org's saved lists, each built independently via
// buildVoterFiltersSql — identical to the count/aggregates path — then
// OR-joined so a voter matching several saved sets counts once. A saved set
// with no predicates (buildVoterFiltersSql returns null — e.g. an
// activity-only list with no demographic filters) matches every row in
// scope, so it becomes bare TRUE rather than being silently dropped from the
// OR. An empty savedFilterSets array has no saved list to match against —
// the union of zero sets is the empty set — so it becomes FALSE; Prisma.join
// rejects an empty array, so this also sidesteps that.
export const buildOverlapCountSql = (args: {
  state: string
  districtId?: string | null
  filters: FilterData
  search?: string
  savedFilterSets: FilterData[]
  fenceLimit?: number
}): Prisma.Sql => {
  const { state, districtId, filters, search, savedFilterSets, fenceLimit } =
    args

  const whereClause = buildVoterWhereSql({ state, districtId, filters, search })

  const savedClauses = savedFilterSets.map(
    (savedFilters) => buildVoterFiltersSql(savedFilters) ?? Prisma.sql`TRUE`,
  )
  const savedSetsClause =
    savedClauses.length > 0
      ? Prisma.sql`AND (${Prisma.join(savedClauses, ' OR ')})`
      : Prisma.sql`AND FALSE`

  const fromSql = districtId
    ? Prisma.sql`FROM "green"."DistrictVoter" dv
        JOIN "green"."Voter" v
          ON v."State" = dv."State" AND v."id" = dv."voter_id"`
    : Prisma.sql`FROM "green"."Voter" v`

  // Same DistrictVoter -> Voter join as the count/aggregates paths, so an
  // OR-of-saved-sets is prone to the same pathological plan (see
  // SLOW_QUERY_TIMEOUT_MS in people.service.ts). Fenced: cap the row set
  // before evaluating the saved-set OR, trading an exact overlap for a floor.
  const rowSource = fenceLimit
    ? Prisma.sql`FROM (SELECT v.* ${fromSql} ${whereClause} ${savedSetsClause} LIMIT ${fenceLimit}) v`
    : Prisma.sql`${fromSql}
    ${whereClause}
    ${savedSetsClause}`

  return Prisma.sql`SELECT COUNT(*)::bigint AS overlap_count ${rowSource}`
}
