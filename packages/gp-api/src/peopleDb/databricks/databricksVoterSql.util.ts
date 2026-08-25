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

const VOTER_TABLE_NAME = 'voters'

export const VOTER_TABLE = TABLE(VOTER_TABLE_NAME)
export const DISTRICT_TABLE = TABLE('districts')

const MIN_SUBSTRING_TOKEN_LENGTH = 3

// Everything a caller supplies is a BOUND parameter, never spliced into the
// statement. Two things cannot be bound and are handled below instead: the L2
// district column, which is an identifier rather than a value, and uuid id
// sets, which can exceed the API's 10,000-parameter ceiling.
export type DbxParamType = 'STRING' | 'INT'

export type DbxParam = {
  name: string
  value: string | null
  type: DbxParamType
}

export type DbxStatement = { sql: string; params: DbxParam[] }

export type Bag = {
  params: DbxParam[]
  bind: (value: string | number | null, type?: DbxParamType) => string
}

export const createBag = (): Bag => {
  const params: DbxParam[] = []
  return {
    params,
    bind: (value, type = 'STRING') => {
      const name = `p${params.length}`
      params.push({
        name,
        value: value === null ? null : String(value),
        type,
      })
      return `:${name}`
    },
  }
}

const ident = (name: string): string => `\`${name.replace(/`/g, '``')}\``

const col = (name: string): string => `v.${ident(name)}`

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// The one value-shaped exception to binding: an id set can carry up to
// MAX_ID_FILTER_VALUES entries per side, well past the API's 10,000-parameter
// ceiling, so these are interpolated. The uuid shape is re-checked HERE rather
// than trusted from the schema, so the thing that makes interpolation safe is
// enforced at the point of interpolation. Lowercased because the column is
// STRING and compares byte-exact, where Postgres compared as `uuid` and
// normalized case — an exclude set that matches nothing silently WIDENS an
// audience.
const idList = (values: ReadonlyArray<string | number>): string =>
  values
    .map((value) => {
      const id = String(value).toLowerCase()
      if (!UUID_RE.test(id)) {
        throw new Error(`Refusing to inline a non-uuid id: ${String(value)}`)
      }
      return `'${id}'`
    })
    .join(', ')

const num = (value: string | number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Non-finite numeric filter value: ${String(value)}`)
  }
  return parsed
}

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
  bag: Bag,
  field: string,
  op?: FilterOperator,
): string | null => {
  if (!op) return null
  const target = col(field)
  if (op.operator === 'in' && op.values && op.values.length > 0) {
    const markers = op.values.map((value) => bag.bind(String(value)))
    return `${target} IN (${markers.join(', ')})`
  }
  if (op.operator === 'eq' && op.value !== undefined) {
    return `${target} = ${bag.bind(String(op.value))}`
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
  bag: Bag,
  field: string,
  op: FilterOperator | undefined,
  mapValue: (value: string) => string | null,
): string | null => {
  if (!op) return null
  const target = col(field)
  if (op.operator === 'eq' && op.value) {
    const mapped = mapValue(String(op.value))
    if (mapped === null) return `${target} IS NULL`
    return buildFieldFilter(bag, field, { ...op, value: mapped })
  }
  if (op.operator === 'in' && op.values && op.values.length > 0) {
    const original = op.values.map(String)
    const mapped = original
      .map(mapValue)
      .filter((value): value is string => value !== null)
    const hasNull = original.some((value) => mapValue(value) === null)
    if (hasNull && mapped.length > 0) {
      const sql = buildFieldFilter(bag, field, { ...op, values: mapped })
      if (sql) return `(${sql} OR ${target} IS NULL)`
    } else if (hasNull) {
      return `${target} IS NULL`
    } else if (mapped.length > 0) {
      return buildFieldFilter(bag, field, { ...op, values: mapped })
    }
  }
  return buildFieldFilter(bag, field, op)
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

const buildLanguageFilter = (bag: Bag, op?: FilterOperator): string | null => {
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
  if (hasEnglish) conditions.push(`${target} = ${bag.bind('English')}`)
  if (hasSpanish) conditions.push(`${target} = ${bag.bind('Spanish')}`)
  if (hasOther) {
    const known = [bag.bind('English'), bag.bind('Spanish')].join(', ')
    conditions.push(`(${target} NOT IN (${known}) OR ${target} IS NULL)`)
  }
  return `(${conditions.join(' OR ')})`
}

const buildPartyValuePredicate = (bag: Bag, value: string): string | null => {
  const target = col('Parties_Description')
  if (value === POLITICAL_PARTY_OTHER) {
    const known = ALL_KNOWN_PARTY_VALUES.map((party) => bag.bind(party))
    return `(${target} IS NULL OR ${target} NOT IN (${known.join(', ')}))`
  }
  if ((RULED_POLITICAL_PARTIES as readonly string[]).includes(value)) {
    // The includes() check above confirms membership at runtime; TS cannot
    // narrow a plain string to the literal union from Array#includes.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const party = value as RuledParty
    const exact = POLITICAL_PARTY_EXACT_VALUES[party].map((v) => bag.bind(v))
    return `${target} IN (${exact.join(', ')})`
  }
  return null
}

const buildPoliticalPartyFilter = (
  bag: Bag,
  op?: FilterOperator,
): string | null => {
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
    .map((value) => buildPartyValuePredicate(bag, value))
    .filter((predicate): predicate is string => predicate !== null)
  if (predicates.length === 0) return null
  return `(${predicates.join(' OR ')})`
}

const buildNumericFilter = (
  bag: Bag,
  field: string,
  op?: FilterOperator,
): string | null => {
  if (!op) return null
  const target = col(field)
  let base: string | null = null

  const bindInt = (value: string | number): string =>
    bag.bind(num(value), 'INT')

  if (op.operator === 'in' && op.values && op.values.length > 0) {
    // Rounded to mirror the Postgres path's `::integer[]` cast. Both numeric
    // columns are non-negative, so half-away-from-zero and Math.round agree.
    const markers = op.values.map((value) =>
      bag.bind(Math.round(num(value)), 'INT'),
    )
    base = `${target} IN (${markers.join(', ')})`
  } else if (op.operator === 'eq' && op.value !== undefined) {
    base = `${target} = ${bindInt(op.value)}`
  } else if (
    op.operator === 'range' &&
    op.gte !== undefined &&
    op.lte !== undefined
  ) {
    base = `${target} >= ${bindInt(op.gte)} AND ${target} <= ${bindInt(op.lte)}`
  } else if (op.operator === 'gte' && op.value !== undefined) {
    base = `${target} >= ${bindInt(op.value)}`
  } else if (op.operator === 'lte' && op.value !== undefined) {
    base = `${target} <= ${bindInt(op.value)}`
  } else if (op.operator === 'or' && op.orRanges) {
    const orClauses = op.orRanges
      .map((range) => {
        const hasGte = range.gte !== undefined && range.gte !== null
        const hasLte = range.lte !== undefined && range.lte !== null
        if (hasGte && hasLte) {
          return (
            `(${target} >= ${bindInt(range.gte ?? 0)}` +
            ` AND ${target} <= ${bindInt(range.lte ?? 0)})`
          )
        }
        if (hasGte) return `${target} >= ${bindInt(range.gte ?? 0)}`
        if (hasLte) return `${target} <= ${bindInt(range.lte ?? 0)}`
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
const buildIdFilter = (op?: FilterOperator): string | null => {
  if (!op) return null
  if (
    (op.operator === 'in' || op.operator === 'notIn') &&
    op.values &&
    op.values.length > 0
  ) {
    const ids = idList(op.values)
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
    ? `(${base} AND ${col('id')} NOT IN (${idList(idOverrides.exclude)}))`
    : base
  return idOverrides.include?.length
    ? `(${scoped} OR ${col('id')} IN (${idList(idOverrides.include)}))`
    : scoped
}

export const buildVoterFiltersSql = (
  bag: Bag,
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
          bag,
          'Marital_Status',
          op,
          VALUE_MAPPERS.maritalStatus,
        )
        break
      case 'veteranStatus':
        sql = buildMappedFieldFilter(
          bag,
          'Veteran_Status',
          op,
          VALUE_MAPPERS.veteranStatus,
        )
        break
      case 'educationLevel':
        sql = buildMappedFieldFilter(
          bag,
          'Education_Of_Person',
          op,
          VALUE_MAPPERS.educationLevel,
        )
        break
      case 'ethnicity':
        sql = buildMappedFieldFilter(
          bag,
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
          bag,
          'Presence_Of_Children',
          op,
          VALUE_MAPPERS.presenceOfChildren,
        )
        break
      case 'homeowner':
        sql = buildMappedFieldFilter(
          bag,
          'Homeowner_Probability_Model',
          op,
          VALUE_MAPPERS.homeowner,
        )
        break
      case 'language':
        sql = buildLanguageFilter(bag, op)
        break
      case 'estimatedIncomeAmountInt':
        sql = buildNumericFilter(bag, 'Estimated_Income_Amount_Int', op)
        break
      case 'voterStatus': {
        const voterStatusClause = buildFieldFilter(bag, 'Voter_Status', op)
        sql = hasIdOverrides(idOverrides)
          ? composeIdOverridesClause(voterStatusClause, idOverrides)
          : voterStatusClause
        break
      }
      case 'politicalParty':
        sql = buildPoliticalPartyFilter(bag, op)
        break
      case 'gender':
        sql = buildMappedFieldFilter(bag, 'Gender', op, VALUE_MAPPERS.gender)
        break
      case 'ageInt':
        sql = buildNumericFilter(bag, 'Age_Int', op)
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
export const buildSearchSql = (bag: Bag, search: string): string | null => {
  const trimmed = search.trim()
  if (!trimmed) return null

  const phone = getNormalizedPhoneNumber(trimmed)
  if (phone) {
    const marker = bag.bind(phone)
    return (
      `(${col('VoterTelephones_CellPhoneFormatted')} = ${marker}` +
      ` OR ${col('VoterTelephones_LandlineFormatted')} = ${marker})`
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
      const marker = bag.bind(pattern)
      return (
        `(lower(${col('FirstName')}) LIKE ${marker} ESCAPE '\\\\'` +
        ` OR lower(${col('LastName')}) LIKE ${marker} ESCAPE '\\\\')`
      )
    })
  return clauses.length ? clauses.join(' AND ') : null
}

// FROM/WHERE for one district-scoped population. The state and district NAME
// are bound; only the district COLUMN is interpolated, because it is an
// identifier. `DatabricksVoterService.resolveDistrict` validates that column
// against the voter table's real column set before it ever reaches here.
export const buildScopeSql = (bag: Bag, args: DbxScopeArgs): string => {
  const { district, filters, search, idOverrides } = args
  const parts: string[] = [`${col('State')} = ${bag.bind(district.state)}`]

  // A State district whose name is the state has no membership rows at all,
  // which is why resolveDistrict special-cases it; scoping on State alone is
  // the same population.
  if (!district.useVoterOnlyPath) {
    parts.push(
      `${col(district.districtType)} = ${bag.bind(district.districtName)}`,
    )
  }

  if (search) {
    const searchSql = buildSearchSql(bag, search)
    if (searchSql) parts.push(searchSql)
  }

  const filterSql = buildVoterFiltersSql(
    bag,
    filters,
    idOverrides,
    args.contactsMadeIdOverrides,
  )
  if (filterSql) parts.push(filterSql)

  return `WHERE ${parts.join(' AND ')}`
}

export const buildDistrictSql = (districtId: string): DbxStatement => {
  const bag = createBag()
  const sql =
    `SELECT id, state, type, name FROM ${DISTRICT_TABLE}` +
    ` WHERE id = ${bag.bind(districtId)}`
  return { sql, params: bag.params }
}

// The voter table's column set, used to validate a district `type` before it is
// interpolated as an identifier. Filtered by grant, so it also proves the
// principal can see the table at all.
export const buildVoterColumnsSql = (): DbxStatement => {
  const bag = createBag()
  const sql =
    `SELECT column_name FROM ${PEOPLE_DBX_CATALOG}.information_schema.columns` +
    ` WHERE table_schema = ${bag.bind(PEOPLE_DBX_SCHEMA)}` +
    ` AND table_name = ${bag.bind(VOTER_TABLE_NAME)}`
  return { sql, params: bag.params }
}

export const buildAggregatesSql = (args: DbxScopeArgs): DbxStatement => {
  const bag = createBag()
  const sql =
    `SELECT COUNT(*) AS count,` +
    ` AVG(${col('Age_Int')}) AS avgAge,` +
    ` AVG(${col('Estimated_Income_Amount_Int')}) AS avgIncome` +
    ` FROM ${VOTER_TABLE} v ${buildScopeSql(bag, args)}`
  return { sql, params: bag.params }
}

export const buildCountSql = (args: DbxScopeArgs): DbxStatement => {
  const bag = createBag()
  const sql =
    `SELECT COUNT(*) AS voter_count FROM ${VOTER_TABLE} v` +
    ` ${buildScopeSql(bag, args)}`
  return { sql, params: bag.params }
}

export const buildOverlapCountSql = (
  args: DbxScopeArgs & { savedFilterSets: FilterData[] },
): DbxStatement => {
  const bag = createBag()
  const scope = buildScopeSql(bag, args)
  // A saved set with no predicates matches every row in scope, so it becomes
  // bare TRUE rather than being dropped from the OR; zero saved sets is the
  // union of nothing, so it becomes FALSE.
  const savedClauses = args.savedFilterSets.map(
    (saved) => buildVoterFiltersSql(bag, saved) ?? 'TRUE',
  )
  const savedSetsClause =
    savedClauses.length > 0 ? `(${savedClauses.join(' OR ')})` : 'FALSE'
  const sql =
    `SELECT COUNT(*) AS overlap_count FROM ${VOTER_TABLE} v` +
    ` ${scope} AND ${savedSetsClause}`
  return { sql, params: bag.params }
}

export const buildPageSql = (
  args: DbxScopeArgs & {
    columns: readonly string[]
    take: number
    skip: number
  },
): DbxStatement => {
  const bag = createBag()
  const projection = args.columns
    .map((column) => `${col(column)} AS ${ident(column)}`)
    .join(', ')
  const scope = buildScopeSql(bag, args)
  const sql =
    `SELECT ${projection} FROM ${VOTER_TABLE} v ${scope}` +
    ` ORDER BY ${col('id')}` +
    ` LIMIT ${bag.bind(num(args.take), 'INT')}` +
    ` OFFSET ${bag.bind(num(args.skip), 'INT')}`
  return { sql, params: bag.params }
}

// CSV export projection. Every column is cast to string and null-coalesced
// because the Statement Execution API renders a SQL NULL as the literal text
// `null` in CSV, where Postgres COPY writes an empty field — without this the
// download would be full of the word "null".
// Sampling keeps Postgres's hash pre-cut, for a different reason. There it
// existed to keep the planner off a sequential scan; here it exists to avoid a
// sort. Ordering the whole population by a seeded hash and taking the top N
// measured 3-6s because it sorts every matching row, while cutting to a
// 1/divisor slice and letting LIMIT terminate early measured a flat 2.1-2.3s
// from a 7.8k-voter ward to a 23M-voter state. The seed rotates which slice is
// taken, so successive calls return different people.
export const buildSampleSql = (
  args: DbxScopeArgs & {
    columns: readonly string[]
    size: number
    seed: number
    hashDivisor: number
    hasCellPhone?: boolean
    excludeIds?: readonly string[]
  },
): DbxStatement => {
  const bag = createBag()
  const projection = args.columns
    .map((column) => `${col(column)} AS ${ident(column)}`)
    .join(', ')
  const parts = [buildScopeSql(bag, args)]

  const cell = col('VoterTelephones_CellPhoneFormatted')
  if (args.hasCellPhone === true) parts.push(`AND ${cell} IS NOT NULL`)
  if (args.hasCellPhone === false) parts.push(`AND ${cell} IS NULL`)

  const excludeIds = args.excludeIds ?? []
  if (excludeIds.length > 0) {
    parts.push(`AND ${col('id')} NOT IN (${idList(excludeIds)})`)
  }

  const divisor = Math.max(1, Math.trunc(num(args.hashDivisor)))
  if (divisor > 1) {
    parts.push(
      `AND pmod(xxhash64(${col('id')}, ${bag.bind(num(args.seed), 'INT')}),` +
        ` ${bag.bind(divisor, 'INT')}) = 0`,
    )
  }

  const sql =
    `SELECT ${projection} FROM ${VOTER_TABLE} v ${parts.join(' ')}` +
    ` LIMIT ${bag.bind(num(args.size), 'INT')}`
  return { sql, params: bag.params }
}

export const buildCsvSql = (
  args: DbxScopeArgs & { excludeColumns?: ExcludableVoterColumn[] },
): DbxStatement => {
  const bag = createBag()
  const excluded = new Set<string>(args.excludeColumns ?? [])
  const projection = DOWNLOAD_COLUMNS.filter(
    ({ column }) => !excluded.has(column),
  )
    .map(
      ({ column, header }) =>
        `nvl(CAST(${col(column)} AS STRING), '') AS ${ident(header)}`,
    )
    .join(', ')
  const sql = `SELECT ${projection} FROM ${VOTER_TABLE} v ${buildScopeSql(bag, args)}`
  return { sql, params: bag.params }
}
