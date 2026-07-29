import { type IdOverrides } from '@goodparty_org/contracts'
import { Prisma, USState } from '../../generated/people-prisma'
import { FilterData } from '../schemas/filters.schema'
import { buildVoterFiltersSql } from './filters.sql.util'

const US_STATE_CODES = new Set<string>(Object.values(USState))

// pg_trgm needs at least one full trigram to extract from the pattern;
// `%ab%` on a 1-2 char token degrades to a near-full GIN scan, so short
// tokens (middle initials, "Li") stay prefix-matched on the b-tree
// functional indexes.
const MIN_SUBSTRING_TOKEN_LENGTH = 3

// v."State" is the USState enum on prisma-managed (green) clusters and plain text on
// loader-built clusters. PEOPLE_STATE_ENUM=false switches the comparison to plain text so
// people-api can query a loader cluster; the default keeps the enum cast (unchanged behavior).
const stateIsEnum = (): boolean =>
  (process.env.PEOPLE_STATE_ENUM ?? 'true').toLowerCase() !== 'false'

// State is inlined as a literal, NOT bound as a parameter. A parameterized State
// (bind or CAST of a bind) breaks equivalence-class constant propagation across the
// v."State" = dv."State" join, so the planner seq-scans the entire state Voter
// partition and hash-joins instead of a nested-loop index probe (~7.5s vs ~1.3s on a
// large district). State comes from the fixed USState allowlist, so inlining is safe;
// the membership check keeps Prisma.raw injection-proof.
export const stateEquals = (alias: 'v' | 'dv', state: string): Prisma.Sql => {
  if (!US_STATE_CODES.has(state)) {
    throw new Error(`stateEquals received a non-USState value: ${state}`)
  }
  const literal = Prisma.raw(`'${state}'`)
  return stateIsEnum()
    ? Prisma.sql`${Prisma.raw(alias)}."State" = ${literal}::"public"."USState"`
    : Prisma.sql`${Prisma.raw(alias)}."State" = ${literal}`
}

export const getNormalizedPhoneNumber = (phone: string): string | null => {
  if (!/^\d+$/.test(phone)) {
    return null
  }

  if (![11, 10].includes(phone.length)) {
    return null
  }

  const digits =
    phone.length === 11 && phone.startsWith('1') ? phone.slice(1) : phone

  const area = digits.slice(0, 3)
  const prefix = digits.slice(3, 6)
  const line = digits.slice(6)
  return `(${area}) ${prefix}-${line}`
}

/**
 * True when `search` will produce name-token LIKE predicates in
 * `buildVoterWhereSql` (as opposed to the phone-equality predicate or no
 * search at all). Callers use this to decide whether the rare-pattern
 * timeout guard applies — only name LIKE patterns can mislead the planner.
 */
export const isNameSearch = (search?: string): boolean => {
  const trimmed = search?.trim()
  if (!trimmed) {
    return false
  }
  return getNormalizedPhoneNumber(trimmed) === null
}

/**
 * Build the WHERE clause shared by the people list, count, and CSV-download
 * SQL. Returns `Prisma.empty` when there are no predicates.
 *
 * When `districtId` is set the caller is expected to have joined
 * `green."DistrictVoter" dv ON v."State" = dv."State" AND v."id" = dv."voter_id"`.
 */
export const buildVoterWhereSql = (args: {
  state: string
  districtId?: string | null
  filters: FilterData
  search?: string
  extraConditions?: Prisma.Sql[]
  idOverrides?: IdOverrides
  contactsMadeIdOverrides?: IdOverrides
}): Prisma.Sql => {
  const { state, districtId } = args

  const parts: Prisma.Sql[] = []
  parts.push(stateEquals('v', state))
  if (districtId) {
    parts.push(stateEquals('dv', state))
    parts.push(Prisma.sql`dv."district_id" = ${districtId}::uuid`)
    parts.push(Prisma.sql`dv."voter_id" IS NOT NULL`)
  }
  const search = args.search?.trim()
  if (search) {
    const phone = getNormalizedPhoneNumber(search)
    if (phone) {
      parts.push(
        Prisma.sql`(v."VoterTelephones_CellPhoneFormatted" = ${phone} OR v."VoterTelephones_LandlineFormatted" = ${phone})`,
      )
    } else {
      const tokens = search.split(/\s+/).filter(Boolean)
      // Case-insensitive match-anywhere per token, AND-joined across tokens,
      // with each token allowed to match either name field. This handles
      // "First Last", "Last First", and middle-name noise.
      // `lower(col) LIKE '%tok%'` is the form the trigram GIN indexes
      // (Voter_firstname_lower_trgm_idx / Voter_lastname_lower_trgm_idx) can
      // serve — the lower() expression must match the index expression
      // exactly. Tokens shorter than MIN_SUBSTRING_TOKEN_LENGTH stay
      // anchored-prefix on the b-tree Voter_firstname_lower_idx /
      // Voter_lastname_lower_idx functional indexes instead. LIKE
      // metacharacters in the user token are escaped so a `_`/`%` can't
      // widen the match.
      for (const token of tokens) {
        const escaped = token.toLowerCase().replace(/[%_\\]/g, '\\$&')
        const pattern =
          token.length >= MIN_SUBSTRING_TOKEN_LENGTH
            ? `%${escaped}%`
            : `${escaped}%`
        parts.push(
          Prisma.sql`(lower(v."FirstName") LIKE ${pattern} ESCAPE '\\' OR lower(v."LastName") LIKE ${pattern} ESCAPE '\\')`,
        )
      }
    }
  }
  const voterFiltersSql = buildVoterFiltersSql(
    args.filters,
    args.idOverrides,
    args.contactsMadeIdOverrides,
  )
  if (voterFiltersSql) {
    parts.push(voterFiltersSql)
  }
  if (args.extraConditions) {
    parts.push(...args.extraConditions)
  }
  return parts.length
    ? Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}`
    : Prisma.empty
}
