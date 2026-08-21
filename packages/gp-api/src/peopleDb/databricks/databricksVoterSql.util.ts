import { type IdOverrides } from '@goodparty_org/contracts'
import { FilterData, type FilterOperator } from '../schemas/filters.schema'
import { VALUE_MAPPERS } from '../utils/filters.sql.util'
import {
  ALL_KNOWN_PARTY_VALUES,
  POLITICAL_PARTY_EXACT_VALUES,
  POLITICAL_PARTY_OTHER,
  RULED_POLITICAL_PARTIES,
  type RuledParty,
} from '../utils/politicalParty.rules'
import { DOWNLOAD_COLUMNS, type ExcludableVoterColumn } from '../voter.select'
import { PEOPLE_DBX_CATALOG, PEOPLE_DBX_SCHEMA } from './peopleDbx.config'

const TABLE = (name: string): string =>
  `${PEOPLE_DBX_CATALOG}.${PEOPLE_DBX_SCHEMA}.${name}`

export const VOTER_TABLE = TABLE('m_people_api__voter')
export const DISTRICT_TABLE = TABLE('m_people_api__district')

const MIN_SUBSTRING_TOKEN_LENGTH = 3

// Spark string literals treat backslash as an escape character, so both the
// backslash and the quote have to be escaped — doubling quotes alone would
// leave a `\` in a name able to swallow the following character.
export const lit = (value: string): string =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

const ident = (name: string): string => `\`${name.replace(/`/g, '``')}\``

const col = (name: string): string => `v.${ident(name)}`

const num = (value: string | number): string => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Non-finite numeric filter value: ${String(value)}`)
  }
  return String(parsed)
}

const inList = (values: readonly string[]): string => values.map(lit).join(', ')

export type DbxDistrict = {
  districtId: string
  state: string
  districtType: string
  districtName: string
  useVoterOnlyPath: boolean
}

export type DbxScopeArgs = {
  district: DbxDistrict
  filters: FilterData
  search?: string
  idOverrides?: IdOverrides
  contactsMadeIdOverrides?: IdOverrides
}

const hasIdOverrides = (
  idOverrides: IdOverrides | undefined,
): idOverrides is IdOverrides =>
  !!idOverrides &&
  ((idOverrides.include?.length ?? 0) > 0 ||
    (idOverrides.exclude?.length ?? 0) > 0)

const buildBooleanFilter = (
  field: string,
  op?: FilterOperator,
): string | null => {
  if (!op || op.operator !== 'is') return null
  if (op.value === 'not_null') return `${col(field)} IS NOT NULL`
  if (op.value === 'null') return `${col(field)} IS NULL`
  return null
}

const buildHasAnyPhoneFilter = (op?: FilterOperator): string | null => {
  if (!op || op.operator !== 'is') return null
  const cell = col('VoterTelephones_CellPhoneFormatted')
  const landline = col('VoterTelephones_LandlineFormatted')
  if (op.value === 'not_null') {
    return `(${cell} IS NOT NULL OR ${landline} IS NOT NULL)`
  }
  if (op.value === 'null') {
    return `(${cell} IS NULL AND ${landline} IS NULL)`
  }
  return null
}

const buildHasAddressFilter = (op?: FilterOperator): string | null => {
  if (!op || op.operator !== 'is') return null
  const target = col('Residence_Addresses_AddressLine')
  if (op.value === 'not_null') {
    return `(${target} IS NOT NULL AND ${target} != '')`
  }
  if (op.value === 'null') return `(${target} IS NULL OR ${target} = '')`
  return null
}

const buildFieldFilter = (
  field: string,
  op?: FilterOperator,
): string | null => {
  if (!op) return null
  const target = col(field)
  if (op.operator === 'in' && op.values && op.values.length > 0) {
    return `${target} IN (${inList(op.values.map(String))})`
  }
  if (op.operator === 'eq' && op.value !== undefined) {
    return `${target} = ${lit(String(op.value))}`
  }
  if (op.operator === 'is' && op.value === 'not_null') {
    return `${target} IS NOT NULL`
  }
  if (op.operator === 'is' && op.value === 'null') {
    return `${target} IS NULL`
  }
  return null
}

const buildMappedFieldFilter = (
  field: string,
  op: FilterOperator | undefined,
  mapValue: (value: string) => string | null,
): string | null => {
  if (!op) return null
  const target = col(field)
  if (op.operator === 'eq' && op.value) {
    const mapped = mapValue(String(op.value))
    if (mapped === null) return `${target} IS NULL`
    return buildFieldFilter(field, { ...op, value: mapped })
  }
  if (op.operator === 'in' && op.values && op.values.length > 0) {
    const original = op.values.map(String)
    const mapped = original
      .map(mapValue)
      .filter((value): value is string => value !== null)
    const hasNull = original.some((value) => mapValue(value) === null)
    if (hasNull && mapped.length > 0) {
      const sql = buildFieldFilter(field, { ...op, values: mapped })
      if (sql) return `(${sql} OR ${target} IS NULL)`
    } else if (hasNull) {
      return `${target} IS NULL`
    } else if (mapped.length > 0) {
      return buildFieldFilter(field, { ...op, values: mapped })
    }
  }
  return buildFieldFilter(field, op)
}

const buildBusinessOwnerFilter = (op?: FilterOperator): string | null => {
  if (!op) return null
  const target = col('Business_Owner')
  if (op.operator === 'eq' && op.value === 'Yes') {
    return `${target} IS NOT NULL`
  }
  if (op.operator === 'eq' && op.value === 'Unknown') {
    return `${target} IS NULL`
  }
  if (op.operator === 'in' && op.values && op.values.length > 0) {
    const values = op.values.map(String)
    const hasYes = values.includes('Yes')
    const hasUnknown = values.includes('Unknown')
    if (hasYes && hasUnknown) return null
    if (hasYes) return `${target} IS NOT NULL`
    if (hasUnknown) return `${target} IS NULL`
  }
  if (op.operator === 'is' && op.value === 'not_null') {
    return `${target} IS NOT NULL`
  }
  if (op.operator === 'is' && op.value === 'null') return `${target} IS NULL`
  return null
}

const buildLanguageFilter = (op?: FilterOperator): string | null => {
  if (!op) return null
  const target = col('Language_Code')
  if (op.operator === 'is' && op.value === 'not_null') {
    return `${target} IS NOT NULL`
  }
  if (op.operator === 'is' && op.value === 'null') return `${target} IS NULL`

  const values =
    op.operator === 'in' && op.values
      ? op.values.map(String)
      : op.operator === 'eq' && op.value
        ? [String(op.value)]
        : []
  if (values.length === 0) return null

  const hasEnglish = values.includes('English')
  const hasSpanish = values.includes('Spanish')
  const hasOther = values.includes('Other')
  if (hasEnglish && hasSpanish && hasOther) return null

  const conditions: string[] = []
  if (hasEnglish) conditions.push(`${target} = 'English'`)
  if (hasSpanish) conditions.push(`${target} = 'Spanish'`)
  if (hasOther) {
    conditions.push(
      `(${target} NOT IN ('English', 'Spanish') OR ${target} IS NULL)`,
    )
  }
  return `(${conditions.join(' OR ')})`
}

const buildPartyValuePredicate = (value: string): string | null => {
  const target = col('Parties_Description')
  if (value === POLITICAL_PARTY_OTHER) {
    const known = inList([...ALL_KNOWN_PARTY_VALUES])
    return `(${target} IS NULL OR ${target} NOT IN (${known}))`
  }
  if ((RULED_POLITICAL_PARTIES as readonly string[]).includes(value)) {
    // The includes() check above confirms membership at runtime; TS cannot
    // narrow a plain string to the literal union from Array#includes.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const party = value as RuledParty
    return `${target} IN (${inList([...POLITICAL_PARTY_EXACT_VALUES[party]])})`
  }
  return null
}

const buildPoliticalPartyFilter = (op?: FilterOperator): string | null => {
  if (!op) return null
  const target = col('Parties_Description')
  if (op.operator === 'is' && op.value === 'not_null') {
    return `${target} IS NOT NULL`
  }
  if (op.operator === 'is' && op.value === 'null') return `${target} IS NULL`

  const selected =
    op.operator === 'in' && op.values
      ? op.values.map(String)
      : op.operator === 'eq' && op.value !== undefined
        ? [String(op.value)]
        : []
  const predicates = selected
    .map(buildPartyValuePredicate)
    .filter((predicate): predicate is string => predicate !== null)
  if (predicates.length === 0) return null
  return `(${predicates.join(' OR ')})`
}

const buildNumericFilter = (
  field: string,
  op?: FilterOperator,
): string | null => {
  if (!op) return null
  const target = col(field)
  let base: string | null = null

  if (op.operator === 'in' && op.values && op.values.length > 0) {
    // Rounded to mirror the Postgres path's `::integer[]` cast. Both numeric
    // columns are non-negative, so half-away-from-zero and Math.round agree.
    base = `${target} IN (${op.values
      .map((value) => Math.round(Number(num(value))))
      .join(', ')})`
  } else if (op.operator === 'eq' && op.value !== undefined) {
    base = `${target} = ${num(op.value)}`
  } else if (
    op.operator === 'range' &&
    op.gte !== undefined &&
    op.lte !== undefined
  ) {
    base = `${target} >= ${num(op.gte)} AND ${target} <= ${num(op.lte)}`
  } else if (op.operator === 'gte' && op.value !== undefined) {
    base = `${target} >= ${num(op.value)}`
  } else if (op.operator === 'lte' && op.value !== undefined) {
    base = `${target} <= ${num(op.value)}`
  } else if (op.operator === 'or' && op.orRanges) {
    const orClauses = op.orRanges
      .map((range) => {
        const hasGte = range.gte !== undefined && range.gte !== null
        const hasLte = range.lte !== undefined && range.lte !== null
        if (hasGte && hasLte) {
          return (
            `(${target} >= ${num(range.gte ?? 0)}` +
            ` AND ${target} <= ${num(range.lte ?? 0)})`
          )
        }
        if (hasGte) return `${target} >= ${num(range.gte ?? 0)}`
        if (hasLte) return `${target} <= ${num(range.lte ?? 0)}`
        return null
      })
      .filter((clause): clause is string => clause !== null)
    if (orClauses.length > 0) {
      base = `(${orClauses.join(' OR ')})`
    } else if (op.includeNull) {
      return `${target} IS NULL`
    }
  } else if (op.operator === 'is' && op.value === 'not_null') {
    return `${target} IS NOT NULL`
  } else if (op.operator === 'is' && op.value === 'null') {
    return `${target} IS NULL`
  }

  if (base && op.includeNull) return `(${base} OR ${target} IS NULL)`
  return base
}

// The whole id set is inlined rather than bound: the Statement Execution API
// has no array parameter type. MAX_ID_FILTER_VALUES (100k per set, and
// IdOverridesSchema allows that per side) is what bounds the size, and the
// statement client enforces the API's 16 MiB ceiling on the result.
//
// Ids are lowercased because the comparison here is on STRING, not uuid: the
// Postgres path casts to `::uuid[]`, which normalizes case, so an uppercase id
// that matched there would match nothing here — and an exclude set that
// matches nothing silently WIDENS the audience.
const normalizedIds = (values: ReadonlyArray<string | number>): string =>
  inList(values.map((value) => String(value).toLowerCase()))

const buildIdFilter = (op?: FilterOperator): string | null => {
  if (!op) return null
  if (
    (op.operator === 'in' || op.operator === 'notIn') &&
    op.values &&
    op.values.length > 0
  ) {
    const ids = normalizedIds(op.values)
    return op.operator === 'in'
      ? `${col('id')} IN (${ids})`
      : `${col('id')} NOT IN (${ids})`
  }
  return null
}

// Mirrors composeIdOverridesClause: the override pair wraps ONLY the clause it
// is scoped to, never the whole conjunction, so every other filter still
// applies to an override-included person.
const composeIdOverridesClause = (
  baseClause: string | null,
  idOverrides: IdOverrides,
): string => {
  const base = baseClause ?? 'TRUE'
  const scoped = idOverrides.exclude?.length
    ? `(${base} AND ${col('id')} NOT IN (${normalizedIds(idOverrides.exclude)}))`
    : base
  return idOverrides.include?.length
    ? `(${scoped} OR ${col('id')} IN (${normalizedIds(idOverrides.include)}))`
    : scoped
}

export const buildVoterFiltersSql = (
  filterData: FilterData,
  idOverrides?: IdOverrides,
  contactsMadeIdOverrides?: IdOverrides,
): string | null => {
  const { filters, filterOperators } = filterData
  const andClauses: string[] = []

  if (hasIdOverrides(contactsMadeIdOverrides)) {
    andClauses.push(composeIdOverridesClause(null, contactsMadeIdOverrides))
  }

  for (const filter of filters) {
    const op = filterOperators[filter]
    let sql: string | null = null
    switch (filter) {
      case 'hasCellPhone':
        sql = buildBooleanFilter('VoterTelephones_CellPhoneFormatted', op)
        break
      case 'hasLandline':
        sql = buildBooleanFilter('VoterTelephones_LandlineFormatted', op)
        break
      case 'hasAnyPhone':
        sql = buildHasAnyPhoneFilter(op)
        break
      case 'hasAddress':
        sql = buildHasAddressFilter(op)
        break
      case 'id':
        sql = buildIdFilter(op)
        break
      case 'maritalStatus':
        sql = buildMappedFieldFilter(
          'Marital_Status',
          op,
          VALUE_MAPPERS.maritalStatus,
        )
        break
      case 'veteranStatus':
        sql = buildMappedFieldFilter(
          'Veteran_Status',
          op,
          VALUE_MAPPERS.veteranStatus,
        )
        break
      case 'educationLevel':
        sql = buildMappedFieldFilter(
          'Education_Of_Person',
          op,
          VALUE_MAPPERS.educationLevel,
        )
        break
      case 'ethnicity':
        sql = buildMappedFieldFilter(
          'EthnicGroups_EthnicGroup1Desc',
          op,
          VALUE_MAPPERS.ethnicity,
        )
        break
      case 'businessOwner':
        sql = buildBusinessOwnerFilter(op)
        break
      case 'presenceOfChildren':
        sql = buildMappedFieldFilter(
          'Presence_Of_Children',
          op,
          VALUE_MAPPERS.presenceOfChildren,
        )
        break
      case 'homeowner':
        sql = buildMappedFieldFilter(
          'Homeowner_Probability_Model',
          op,
          VALUE_MAPPERS.homeowner,
        )
        break
      case 'language':
        sql = buildLanguageFilter(op)
        break
      case 'estimatedIncomeAmountInt':
        sql = buildNumericFilter('Estimated_Income_Amount_Int', op)
        break
      case 'voterStatus': {
        const voterStatusClause = buildFieldFilter('Voter_Status', op)
        sql = hasIdOverrides(idOverrides)
          ? composeIdOverridesClause(voterStatusClause, idOverrides)
          : voterStatusClause
        break
      }
      case 'politicalParty':
        sql = buildPoliticalPartyFilter(op)
        break
      case 'gender':
        sql = buildMappedFieldFilter('Gender', op, VALUE_MAPPERS.gender)
        break
      case 'ageInt':
        sql = buildNumericFilter('Age_Int', op)
        break
    }
    if (sql) andClauses.push(sql)
  }

  if (andClauses.length === 0) return null
  return andClauses.join(' AND ')
}

export const getNormalizedPhoneNumber = (phone: string): string | null => {
  if (!/^\d+$/.test(phone)) return null
  if (![11, 10].includes(phone.length)) return null
  const digits =
    phone.length === 11 && phone.startsWith('1') ? phone.slice(1) : phone
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

// Token splitting matches buildVoterWhereSql exactly so a search resolves to
// the identical match set in both stores. `lower(col) LIKE` rather than
// isearch(): the latter is equally fast but its only documentation sits inside
// a Beta feature page, so we take no dependency on it.
//
// The doubled backslash in `ESCAPE '\\'` is deliberate — it renders as a
// one-character escape only while spark.sql.parser.escapedStringLiterals is
// false, which is the default. Do not "simplify" it to a single backslash.
export const buildSearchSql = (search: string): string | null => {
  const trimmed = search.trim()
  if (!trimmed) return null

  const phone = getNormalizedPhoneNumber(trimmed)
  if (phone) {
    return (
      `(${col('VoterTelephones_CellPhoneFormatted')} = ${lit(phone)}` +
      ` OR ${col('VoterTelephones_LandlineFormatted')} = ${lit(phone)})`
    )
  }

  const clauses = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const escaped = token.toLowerCase().replace(/[%_\\]/g, '\\$&')
      const pattern =
        token.length >= MIN_SUBSTRING_TOKEN_LENGTH
          ? `%${escaped}%`
          : `${escaped}%`
      const value = lit(pattern)
      return (
        `(lower(${col('FirstName')}) LIKE ${value} ESCAPE '\\\\'` +
        ` OR lower(${col('LastName')}) LIKE ${value} ESCAPE '\\\\')`
      )
    })
  return clauses.length ? clauses.join(' AND ') : null
}

// District scoping goes through the L2 district column already on the voter
// row, and NEVER through a district-membership join: that table is clustered
// by voter id, so a district filter prunes nothing in it and runs in seconds
// regardless of district size — and it is outside this principal's grant.
// `districtType` IS the voter column name and `districtName` is its value. The
// State predicate stays on every query: the voter table is liquid-clustered by
// State, so that is what prunes.
export const buildScopeSql = (args: DbxScopeArgs): string => {
  const { district, filters, search, idOverrides } = args
  const parts: string[] = [`${col('State')} = ${lit(district.state)}`]

  // A State district whose name is the state has no junction rows at all,
  // which is why resolveDistrict special-cases it; scoping on State alone is
  // the same population.
  if (!district.useVoterOnlyPath) {
    parts.push(`${col(district.districtType)} = ${lit(district.districtName)}`)
  }

  if (search) {
    const searchSql = buildSearchSql(search)
    if (searchSql) parts.push(searchSql)
  }

  const filterSql = buildVoterFiltersSql(
    filters,
    idOverrides,
    args.contactsMadeIdOverrides,
  )
  if (filterSql) parts.push(filterSql)

  return `WHERE ${parts.join(' AND ')}`
}

export const buildDistrictSql = (districtId: string): string =>
  `SELECT id, state, type, name FROM ${DISTRICT_TABLE}` +
  ` WHERE id = ${lit(districtId)}`

export const buildAggregatesSql = (args: DbxScopeArgs): string =>
  `SELECT COUNT(*) AS count,` +
  ` AVG(${col('Age_Int')}) AS avgAge,` +
  ` AVG(${col('Estimated_Income_Amount_Int')}) AS avgIncome` +
  ` FROM ${VOTER_TABLE} v ${buildScopeSql(args)}`

export const buildCountSql = (args: DbxScopeArgs): string =>
  `SELECT COUNT(*) AS voter_count FROM ${VOTER_TABLE} v` +
  ` ${buildScopeSql(args)}`

export const buildOverlapCountSql = (
  args: DbxScopeArgs & { savedFilterSets: FilterData[] },
): string => {
  // A saved set with no predicates matches every row in scope, so it becomes
  // bare TRUE rather than being dropped from the OR; zero saved sets is the
  // union of nothing, so it becomes FALSE.
  const savedClauses = args.savedFilterSets.map(
    (saved) => buildVoterFiltersSql(saved) ?? 'TRUE',
  )
  const savedSetsClause =
    savedClauses.length > 0 ? `(${savedClauses.join(' OR ')})` : 'FALSE'
  return (
    `SELECT COUNT(*) AS overlap_count FROM ${VOTER_TABLE} v` +
    ` ${buildScopeSql(args)} AND ${savedSetsClause}`
  )
}

export const buildPageSql = (
  args: DbxScopeArgs & {
    columns: readonly string[]
    take: number
    skip: number
  },
): string => {
  const projection = args.columns
    .map((column) => `${col(column)} AS ${ident(column)}`)
    .join(', ')
  return (
    `SELECT ${projection} FROM ${VOTER_TABLE} v ${buildScopeSql(args)}` +
    ` ORDER BY ${col('id')} LIMIT ${num(args.take)} OFFSET ${num(args.skip)}`
  )
}

// CSV export projection. Every column is cast to string and null-coalesced
// because the Statement Execution API renders a SQL NULL as the literal text
// `null` in CSV, where Postgres COPY writes an empty field — without this the
// download would be full of the word "null".
export const buildCsvSql = (
  args: DbxScopeArgs & { excludeColumns?: ExcludableVoterColumn[] },
): string => {
  const excluded = new Set<string>(args.excludeColumns ?? [])
  const projection = DOWNLOAD_COLUMNS.filter(
    ({ column }) => !excluded.has(column),
  )
    .map(
      ({ column, header }) =>
        `nvl(CAST(${col(column)} AS STRING), '') AS ${ident(header)}`,
    )
    .join(', ')
  return `SELECT ${projection} FROM ${VOTER_TABLE} v ${buildScopeSql(args)}`
}
