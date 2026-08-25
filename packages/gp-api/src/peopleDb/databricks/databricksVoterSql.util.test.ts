import { describe, expect, it } from 'vitest'
import {
  HOUSEHOLD_KEY_RESIDENCE_COLUMNS,
  PeopleFiltersSchema,
} from '@goodparty_org/contracts'
import { filtersSchema, type FilterData } from '../schemas/filters.schema'
import { ALL_KNOWN_PARTY_VALUES } from '../utils/politicalParty.rules'
import { PEOPLE_DBX_CATALOG, PEOPLE_DBX_SCHEMA } from './peopleDbx.config'
import {
  buildAggregatesSql,
  buildCountSql,
  buildDistrictSql,
  buildCsvSql,
  buildOverlapCountSql,
  buildPageSql,
  buildSampleSql,
  buildScopeSql,
  buildSearchSql,
  buildVoterColumnsSql,
  buildVoterFiltersSql,
  buildPersonSql,
  createBag,
  DISTRICT_TABLE,
  VOTER_TABLE,
  type DbxDistrict,
} from './databricksVoterSql.util'

const CONGRESSIONAL: DbxDistrict = {
  districtId: '635757db-0000-0000-0000-000000000000',
  state: 'CA',
  districtType: 'US_Congressional_District',
  districtName: '29',
  useVoterOnlyPath: false,
}

const STATEWIDE: DbxDistrict = {
  districtId: 'aaaaaaaa-0000-0000-0000-000000000000',
  state: 'CA',
  districtType: 'State',
  districtName: 'CA',
  useVoterOnlyPath: true,
}

const noFilters = (): FilterData => filtersSchema.parse({})

const parseFilters = (
  filters: Record<string, boolean | Record<string, unknown>>,
): FilterData => filtersSchema.parse(filters)

describe('buildScopeSql', () => {
  it('scopes on the voter row L2 district column, not the junction', () => {
    const bag = createBag()
    const sql = buildScopeSql(bag, {
      district: CONGRESSIONAL,
      filters: noFilters(),
    })

    expect(sql).toBe(
      'WHERE v.`State` = :p0 AND v.`US_Congressional_District` = :p1',
    )
    expect(bag.params).toEqual([
      { name: 'p0', value: 'CA', type: 'STRING' },
      { name: 'p1', value: '29', type: 'STRING' },
    ])
  })

  it('never joins the district-voter junction table', () => {
    const { sql } = buildCountSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
    })

    expect(sql.toLowerCase()).not.toContain('districtvoter')
    expect(sql.toLowerCase()).not.toContain('join')
  })

  // The service principal holds a least-privilege grant on exactly two tables.
  // Any other table name reaching a query is a permission error in production,
  // so pin the whole builder surface to those two.
  it('only ever names the two tables the grant covers', () => {
    const scope = { district: CONGRESSIONAL, filters: noFilters() }
    const statements = [
      buildCountSql(scope),
      buildAggregatesSql(scope),
      buildPageSql({ ...scope, columns: ['id'], take: 1, skip: 0 }),
      buildOverlapCountSql({ ...scope, savedFilterSets: [] }),
      buildCsvSql(scope),
      buildDistrictSql(CONGRESSIONAL.districtId),
      buildVoterColumnsSql(),
    ]

    const qualified = new RegExp(
      `${PEOPLE_DBX_CATALOG}\\.${PEOPLE_DBX_SCHEMA}\\.[A-Za-z0-9_]+`,
      'g',
    )
    for (const { sql } of statements) {
      const tables = sql.match(qualified) ?? []
      expect(new Set(tables).size).toBeLessThanOrEqual(1)
      for (const table of tables) {
        expect([VOTER_TABLE, DISTRICT_TABLE]).toContain(table)
      }
    }

    // The column list is the one statement that reads a catalog view, and it
    // names no voter table at all: the table it asks about is a bound value.
    const columns = buildVoterColumnsSql()
    expect(columns.sql).toContain('information_schema.columns')
    expect(columns.sql).not.toContain(VOTER_TABLE)
    expect(columns.params.map(({ value }) => value)).toEqual([
      PEOPLE_DBX_SCHEMA,
      VOTER_TABLE.split('.').at(-1),
    ])
  })

  it('drops the district predicate for a state-named State district', () => {
    const bag = createBag()
    const sql = buildScopeSql(bag, {
      district: STATEWIDE,
      filters: noFilters(),
    })

    expect(sql).toBe('WHERE v.`State` = :p0')
    expect(bag.params).toEqual([{ name: 'p0', value: 'CA', type: 'STRING' }])
  })

  it('keeps the state predicate on every query', () => {
    const bag = createBag()
    const withFilters = buildScopeSql(bag, {
      district: CONGRESSIONAL,
      filters: parseFilters({ hasCellPhone: true }),
      search: 'smith',
    })

    expect(withFilters.startsWith('WHERE v.`State` = :p0 AND')).toBe(true)
    expect(bag.params[0]).toEqual({ name: 'p0', value: 'CA', type: 'STRING' })
  })
})

describe('buildSearchSql', () => {
  it('matches a 10-digit phone against both formatted columns', () => {
    const bag = createBag()

    expect(buildSearchSql(bag, '4155551234')).toBe(
      '(v.`VoterTelephones_CellPhoneFormatted` = :p0' +
        ' OR v.`VoterTelephones_LandlineFormatted` = :p0)',
    )
    expect(bag.params).toEqual([
      { name: 'p0', value: '(415) 555-1234', type: 'STRING' },
    ])
  })

  it('strips a leading 1 from an 11-digit phone', () => {
    const bag = createBag()
    buildSearchSql(bag, '14155551234')

    expect(bag.params.map(({ value }) => value)).toEqual(['(415) 555-1234'])
  })

  it('treats a 9-digit number as a name token, not a phone', () => {
    const bag = createBag()
    const sql = buildSearchSql(bag, '415555123')

    expect(sql).toContain('lower(v.`FirstName`) LIKE :p0')
    expect(bag.params.map(({ value }) => value)).toEqual(['%415555123%'])
  })

  it('uses an infix pattern for tokens of three or more chars', () => {
    const bag = createBag()

    expect(buildSearchSql(bag, 'smith')).toBe(
      "(lower(v.`FirstName`) LIKE :p0 ESCAPE '\\\\'" +
        " OR lower(v.`LastName`) LIKE :p0 ESCAPE '\\\\')",
    )
    expect(bag.params).toEqual([
      { name: 'p0', value: '%smith%', type: 'STRING' },
    ])
  })

  it('anchors tokens of one or two chars to a prefix', () => {
    const bag = createBag()
    const sql = buildSearchSql(bag, 'li')

    expect(sql).toContain('LIKE :p0')
    expect(bag.params.map(({ value }) => value)).toEqual(['li%'])
  })

  it('AND-joins multiple tokens, each matching either name column', () => {
    const bag = createBag()
    const sql = buildSearchSql(bag, 'jane doe') ?? ''

    expect(bag.params.map(({ value }) => value)).toEqual(['%jane%', '%doe%'])
    expect(sql).toContain(':p0')
    expect(sql).toContain(':p1')
    expect(sql.split(' AND ')).toHaveLength(2)
  })

  it('escapes LIKE metacharacters so they cannot widen the match', () => {
    const underscore = createBag()
    buildSearchSql(underscore, 'a_b')
    const percent = createBag()
    buildSearchSql(percent, 'a%b')

    expect(underscore.params.map(({ value }) => value)).toEqual(['%a\\_b%'])
    expect(percent.params.map(({ value }) => value)).toEqual(['%a\\%b%'])
  })

  it('escapes a backslash in the token', () => {
    const bag = createBag()
    buildSearchSql(bag, 'a\\b')

    expect(bag.params.map(({ value }) => value)).toEqual(['%a\\\\b%'])
  })

  it('returns null for blank input', () => {
    const bag = createBag()

    expect(buildSearchSql(bag, '   ')).toBeNull()
    expect(bag.params).toEqual([])
  })
})

// Nothing a caller supplies is spliced into the statement, which is a stronger
// property than escaping it correctly: a quote or a backslash reaches the
// warehouse as a bound VALUE, and the statement text never carries it at all.
describe('caller values are bound, never spliced into the SQL', () => {
  it('binds a quoted search term instead of escaping it', () => {
    const bag = createBag()
    const sql = buildSearchSql(bag, "O'Brien") ?? ''

    expect(sql).toContain('lower(v.`FirstName`) LIKE :p0')
    expect(sql).not.toContain("O'Brien")
    expect(sql).not.toContain('brien')
    expect(bag.params).toEqual([
      { name: 'p0', value: "%o'brien%", type: 'STRING' },
    ])
  })

  it('binds a backslash search term instead of escaping it', () => {
    const bag = createBag()
    const sql = buildSearchSql(bag, 'a\\b\\c') ?? ''

    expect(sql).toContain('lower(v.`FirstName`) LIKE :p0')
    expect(sql).not.toContain('a\\')
    // The only doubling left is the LIKE escape, which is pattern semantics
    // rather than SQL quoting, and it happens inside the bound value.
    expect(bag.params).toEqual([
      { name: 'p0', value: '%a\\\\b\\\\c%', type: 'STRING' },
    ])
  })

  it('binds a district name carrying a quote, verbatim', () => {
    const bag = createBag()
    const sql = buildScopeSql(bag, {
      district: { ...CONGRESSIONAL, districtName: "O'Brien Township" },
      filters: noFilters(),
    })

    expect(sql).toBe(
      'WHERE v.`State` = :p0 AND v.`US_Congressional_District` = :p1',
    )
    expect(sql).not.toContain("O'Brien")
    expect(bag.params).toEqual([
      { name: 'p0', value: 'CA', type: 'STRING' },
      { name: 'p1', value: "O'Brien Township", type: 'STRING' },
    ])
  })
})

describe('buildVoterFiltersSql', () => {
  // Every key the contract accepts has to translate: a missing switch case
  // would silently drop the filter and widen the audience, which is the one
  // failure mode this path can have that nobody sees.
  it('emits a clause for every PeopleFilters key', () => {
    const sample: Record<string, boolean | Record<string, unknown>> = {
      hasCellPhone: true,
      hasLandline: true,
      hasAnyPhone: true,
      hasAddress: true,
      id: { in: ['11111111-1111-1111-1111-111111111111'] },
      maritalStatus: { in: ['Married'] },
      veteranStatus: { in: ['Yes'] },
      educationLevel: { in: ['College Degree'] },
      ethnicity: { in: ['European'] },
      businessOwner: { in: ['Yes'] },
      presenceOfChildren: { in: ['Yes'] },
      homeowner: { in: ['Yes'] },
      gender: { in: ['F'] },
      voterStatus: { in: ['Super'] },
      politicalParty: { in: ['Democratic'] },
      language: { in: ['English'] },
      estimatedIncomeAmountInt: { gte: 50000 },
      ageInt: { gte: 30 },
    }

    expect(Object.keys(sample).sort()).toEqual(
      Object.keys(PeopleFiltersSchema.shape).sort(),
    )
    for (const [key, value] of Object.entries(sample)) {
      expect(
        buildVoterFiltersSql(createBag(), parseFilters({ [key]: value })),
      ).not.toBeNull()
    }
  })

  // 'Yes' (the Homeowner pill's wire value) folds Probable Home Owner in
  // (ENG-10947), so it maps to both L2 values rather than one.
  it('maps homeowner display values to their L2 values', () => {
    const bag = createBag()
    const sql = buildVoterFiltersSql(
      bag,
      parseFilters({ homeowner: { in: ['Yes'] } }),
    )

    expect(sql).toBe('v.`Homeowner_Probability_Model` IN (:p0, :p1)')
    expect(bag.params).toEqual([
      { name: 'p0', value: 'Home Owner', type: 'STRING' },
      { name: 'p1', value: 'Probable Home Owner', type: 'STRING' },
    ])
  })

  it('treats an Unknown selection as a null check', () => {
    const bag = createBag()
    const sql = buildVoterFiltersSql(
      bag,
      parseFilters({ gender: { in: ['Unknown'] } }),
    )

    expect(sql).toBe('v.`Gender` IS NULL')
    expect(bag.params).toEqual([])
  })

  it('ORs the null branch when Unknown is mixed with real values', () => {
    const bag = createBag()
    const sql = buildVoterFiltersSql(
      bag,
      parseFilters({ gender: { in: ['F', 'Unknown'] } }),
    )

    expect(sql).toBe('(v.`Gender` IN (:p0) OR v.`Gender` IS NULL)')
    expect(bag.params).toEqual([{ name: 'p0', value: 'F', type: 'STRING' }])
  })

  it('builds the political-party Other predicate with an explicit null', () => {
    const bag = createBag()
    const sql = buildVoterFiltersSql(
      bag,
      parseFilters({ politicalParty: { in: ['Other'] } }),
    )

    expect(sql).toContain('v.`Parties_Description` IS NULL OR')
    expect(sql).toContain('NOT IN (:p0')
    expect(bag.params.map(({ value }) => value)).toEqual([
      ...ALL_KNOWN_PARTY_VALUES,
    ])
  })

  it('includes nulls in a numeric range when asked', () => {
    const bag = createBag()
    const sql = buildVoterFiltersSql(
      bag,
      parseFilters({ ageInt: { gte: 30, lte: 40, _includeNull: true } }),
    )

    expect(sql).toBe(
      '(v.`Age_Int` >= :p0 AND v.`Age_Int` <= :p1 OR v.`Age_Int` IS NULL)',
    )
    expect(bag.params).toEqual([
      { name: 'p0', value: '30', type: 'INT' },
      { name: 'p1', value: '40', type: 'INT' },
    ])
  })

  it('renders hasAnyPhone as cell OR landline', () => {
    const bag = createBag()

    expect(buildVoterFiltersSql(bag, parseFilters({ hasAnyPhone: true }))).toBe(
      '(v.`VoterTelephones_CellPhoneFormatted` IS NOT NULL OR ' +
        'v.`VoterTelephones_LandlineFormatted` IS NOT NULL)',
    )
    expect(bag.params).toEqual([])
  })

  // Id sets stay interpolated rather than bound: the contract permits 100k ids
  // per set, well past the API's 10,000-parameter ceiling.
  it('renders an id set as IN / NOT IN over the primary key', () => {
    const id = '11111111-1111-1111-1111-111111111111'
    const inBag = createBag()
    const notInBag = createBag()

    expect(
      buildVoterFiltersSql(inBag, parseFilters({ id: { in: [id] } })),
    ).toBe(`v.\`id\` IN ('${id}')`)
    expect(
      buildVoterFiltersSql(notInBag, parseFilters({ id: { notIn: [id] } })),
    ).toBe(`v.\`id\` NOT IN ('${id}')`)
    expect(inBag.params).toEqual([])
    expect(notInBag.params).toEqual([])
  })

  // The comparison here is on STRING, not uuid. Postgres casts to `::uuid[]`,
  // which normalizes case, so an uppercase id has to be lowercased or an
  // exclude set would match nothing and silently widen the audience.
  it('lowercases ids so a mixed-case uuid still matches', () => {
    const mixed = '11111111-1111-4111-A111-111111111111'

    expect(
      buildVoterFiltersSql(createBag(), parseFilters({ id: { in: [mixed] } })),
    ).toBe(`v.\`id\` IN ('${mixed.toLowerCase()}')`)
    expect(
      buildVoterFiltersSql(
        createBag(),
        parseFilters({ id: { notIn: [mixed] } }),
      ),
    ).toBe(`v.\`id\` NOT IN ('${mixed.toLowerCase()}')`)
  })

  it('lowercases override id sets too', () => {
    const include = ['AAAAAAAA-1111-4111-8111-111111111111']
    const exclude = ['BBBBBBBB-2222-4222-8222-222222222222']
    const sql = buildVoterFiltersSql(createBag(), noFilters(), undefined, {
      include,
      exclude,
    })

    expect(sql).toContain(include[0]?.toLowerCase())
    expect(sql).toContain(exclude[0]?.toLowerCase())
    expect(sql).not.toContain('AAAAAAAA')
    expect(sql).not.toContain('BBBBBBBB')
  })

  // The uuid shape is what makes interpolating an id set safe, so it is
  // re-checked at the point of interpolation rather than trusted from the
  // schema: anything else is refused instead of reaching the statement.
  it('refuses to interpolate an id that is not a uuid', () => {
    expect(() =>
      buildVoterFiltersSql(createBag(), noFilters(), undefined, {
        include: ["' OR 1=1 --"],
      }),
    ).toThrow('Refusing to inline a non-uuid id')
    expect(() =>
      buildVoterFiltersSql(
        createBag(),
        parseFilters({ voterStatus: { in: ['Super'] } }),
        { exclude: ['not-a-uuid'] },
      ),
    ).toThrow('Refusing to inline a non-uuid id')
  })

  // Mirrors the Postgres path's `::integer[]` cast, which rounds. Without it a
  // fractional value the contract permits would match zero rows here and some
  // rows there.
  it('rounds a fractional value in a numeric in-list', () => {
    const bag = createBag()

    expect(
      buildVoterFiltersSql(bag, parseFilters({ ageInt: { in: [30.5] } })),
    ).toBe('v.`Age_Int` IN (:p0)')
    expect(bag.params).toEqual([{ name: 'p0', value: '31', type: 'INT' }])
  })

  it('scopes idOverrides to the voterStatus clause only', () => {
    const include = ['11111111-1111-1111-1111-111111111111']
    const exclude = ['22222222-2222-2222-2222-222222222222']
    const bag = createBag()
    const sql = buildVoterFiltersSql(
      bag,
      parseFilters({ voterStatus: { in: ['Super'] }, hasCellPhone: true }),
      { include, exclude },
    )

    expect(sql).toContain(
      '((v.`Voter_Status` IN (:p0) AND v.`id` NOT IN ' +
        `('${exclude[0]}')) OR v.\`id\` IN ('${include[0]}'))`,
    )
    // The channel filter stays outside the override composite.
    expect(sql).toContain('v.`VoterTelephones_CellPhoneFormatted` IS NOT NULL')
    expect(bag.params).toEqual([{ name: 'p0', value: 'Super', type: 'STRING' }])
  })

  it('composes contactsMadeIdOverrides as its own top-level clause', () => {
    const include = ['11111111-1111-1111-1111-111111111111']
    const bag = createBag()
    const sql = buildVoterFiltersSql(bag, noFilters(), undefined, { include })

    expect(sql).toBe(`(TRUE OR v.\`id\` IN ('${include[0]}'))`)
    expect(bag.params).toEqual([])
  })

  it('returns null when nothing is filtered', () => {
    const bag = createBag()

    expect(buildVoterFiltersSql(bag, noFilters())).toBeNull()
    expect(bag.params).toEqual([])
  })
})

describe('buildDistrictSql', () => {
  it('binds the district id rather than splicing it in', () => {
    const districtId = CONGRESSIONAL.districtId
    const { sql, params } = buildDistrictSql(districtId)

    expect(sql).toContain('SELECT id, state, type, name FROM')
    expect(sql.endsWith('WHERE id = :p0')).toBe(true)
    expect(sql).not.toContain(districtId)
    expect(params).toEqual([{ name: 'p0', value: districtId, type: 'STRING' }])
  })
})

describe('aggregate and page queries', () => {
  it('selects count and both averages', () => {
    const { sql } = buildAggregatesSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
    })

    expect(sql).toContain('COUNT(*) AS count')
    expect(sql).toContain('AVG(v.`Age_Int`) AS avgAge')
    expect(sql).toContain('AVG(v.`Estimated_Income_Amount_Int`) AS avgIncome')
  })

  it('orders a page by id and applies LIMIT/OFFSET', () => {
    const { sql, params } = buildPageSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
      columns: ['id', 'FirstName'],
      take: 50,
      skip: 100,
    })

    expect(sql).toContain('SELECT v.`id` AS `id`, v.`FirstName` AS `FirstName`')
    expect(sql.endsWith('ORDER BY v.`id` LIMIT :p2 OFFSET :p3')).toBe(true)
    expect(params).toEqual([
      { name: 'p0', value: 'CA', type: 'STRING' },
      { name: 'p1', value: '29', type: 'STRING' },
      { name: 'p2', value: '50', type: 'INT' },
      { name: 'p3', value: '100', type: 'INT' },
    ])
  })

  it('cuts the sample to a hash slice and binds size, seed and divisor', () => {
    const { sql, params } = buildSampleSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
      columns: ['id'],
      size: 500,
      seed: 7,
      hashDivisor: 400,
      hasCellPhone: true,
    })

    expect(sql).toContain(
      'AND v.`VoterTelephones_CellPhoneFormatted` IS NOT NULL',
    )
    expect(sql).toContain('AND pmod(xxhash64(v.`id`, :p2), :p3) = 0')
    expect(sql.endsWith('LIMIT :p4')).toBe(true)
    // No ORDER BY: sorting the population was 3-6s where the slice is ~2s.
    expect(sql).not.toContain('ORDER BY')
    expect(params).toEqual([
      { name: 'p0', value: 'CA', type: 'STRING' },
      { name: 'p1', value: '29', type: 'STRING' },
      { name: 'p2', value: '7', type: 'INT' },
      { name: 'p3', value: '400', type: 'INT' },
      { name: 'p4', value: '500', type: 'INT' },
    ])
  })

  it('drops the hash cut when the divisor is 1, rather than emitting pmod', () => {
    const { sql } = buildSampleSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
      columns: ['id'],
      size: 500,
      seed: 7,
      hashDivisor: 1,
    })

    expect(sql).not.toContain('pmod')
  })

  it('excludes the requested ids and negates hasCellPhone', () => {
    const id = '0ac8551e-b5ab-2ef0-a941-94e8b43b1e1e'
    const { sql } = buildSampleSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
      columns: ['id'],
      size: 10,
      seed: 1,
      hashDivisor: 1,
      hasCellPhone: false,
      excludeIds: [id],
    })

    expect(sql).toContain('AND v.`VoterTelephones_CellPhoneFormatted` IS NULL')
    expect(sql).toContain(`AND v.\`id\` NOT IN ('${id}')`)
  })

  it('refuses to inline a non-uuid exclude id', () => {
    expect(() =>
      buildSampleSql({
        district: CONGRESSIONAL,
        filters: noFilters(),
        columns: ['id'],
        size: 10,
        seed: 1,
        hashDivisor: 1,
        excludeIds: ["' OR 1=1 --"],
      }),
    ).toThrow(/non-uuid/)
  })

  it('ORs the saved sets into the overlap count', () => {
    const { sql, params } = buildOverlapCountSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
      savedFilterSets: [parseFilters({ hasCellPhone: true }), parseFilters({})],
    })

    expect(sql).toContain(
      'AND (v.`VoterTelephones_CellPhoneFormatted` IS NOT NULL OR TRUE)',
    )
    expect(params.map(({ value }) => value)).toEqual(['CA', '29'])
  })

  it('matches nothing when there are no saved sets', () => {
    const { sql } = buildOverlapCountSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
      savedFilterSets: [],
    })

    expect(sql).toContain('AND FALSE')
  })
})

describe('buildCsvSql', () => {
  it('null-coalesces every column so NULL is a blank field, not "null"', () => {
    const { sql, params } = buildCsvSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
    })

    expect(sql).toContain(
      "nvl(CAST(v.`LALVOTERID` AS STRING), '') AS `Voter ID`",
    )
    expect(sql).toContain(
      "nvl(CAST(v.`FirstName` AS STRING), '') AS `First Name`",
    )
    expect(params.map(({ value }) => value)).toEqual(['CA', '29'])
  })

  it('omits excluded columns from the projection', () => {
    const { sql } = buildCsvSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
      excludeColumns: ['Parties_Description'],
    })

    expect(sql).not.toContain('`Registered Party`')
    expect(sql).toContain('`First Name`')
  })
})

describe('household grouping', () => {
  const scope = { district: CONGRESSIONAL, filters: noFilters() }

  it('counts households rather than voters when grouping', () => {
    const plain = buildCountSql(scope)
    const grouped = buildCountSql({ ...scope, groupByHousehold: true })

    expect(plain.sql).toContain('COUNT(*)')
    expect(grouped.sql).toContain('COUNT(DISTINCT concat_ws')
    // Every component normalized, or one household splits into several rows.
    for (const column of HOUSEHOLD_KEY_RESIDENCE_COLUMNS) {
      expect(grouped.sql).toContain(`upper(trim(coalesce(v.\`${column}\``)
    }
  })

  it('keeps one representative row per household, sized by matching voters', () => {
    const { sql } = buildPageSql({
      ...scope,
      columns: ['id'],
      take: 20,
      skip: 0,
      groupByHousehold: true,
    })

    // Spark has no DISTINCT ON; the dedupe is ROW_NUMBER filtered to 1.
    expect(sql).toContain('ROW_NUMBER() OVER (PARTITION BY')
    expect(sql).toContain('WHERE rn = 1')
    expect(sql).not.toContain('DISTINCT ON')
    expect(sql).toContain('COUNT(*) OVER (PARTITION BY')
    expect(sql).toContain('AS `householdId`')
    expect(sql).toContain('AS `householdSize`')
    // rn is scaffolding for the dedupe, not part of the row contract.
    expect(sql).toContain('EXCEPT (rn)')
  })

  it('leaves the ungrouped page query undeduped', () => {
    const { sql } = buildPageSql({
      ...scope,
      columns: ['id'],
      take: 20,
      skip: 0,
    })

    expect(sql).not.toContain('ROW_NUMBER')
    expect(sql).not.toContain('householdId')
  })
})

describe('buildPersonSql', () => {
  const scope = { district: CONGRESSIONAL, filters: noFilters() }
  const ID = '001252fe-fada-36f5-8fac-1044a4341bd5'

  it('keeps the district scope on a single-voter read', () => {
    const { sql, params } = buildPersonSql({
      ...scope,
      columns: ['id'],
      id: ID,
    })

    // Without the scope an id from another office would resolve through this
    // district's drawer.
    expect(sql).toContain('v.`State` = :p0')
    expect(sql).toContain('v.`US_Congressional_District` = :p1')
    expect(sql).toContain('v.`id` = :p2')
    expect(sql).toContain('LIMIT 1')
    expect(params.map(({ value }) => value)).toEqual(['CA', '29', ID])
  })

  // Postgres cast to `uuid` and folded case; this column is a STRING that does
  // not, and z.guid() hands the id through in whatever case it arrived.
  it('folds a mixed-case guid to match the stored value', () => {
    const { params } = buildPersonSql({
      ...scope,
      columns: ['id'],
      id: ID.toUpperCase(),
    })

    expect(params.at(-1)?.value).toBe(ID)
  })

  it('binds the id rather than splicing it', () => {
    const { sql } = buildPersonSql({
      ...scope,
      columns: ['id'],
      id: "' OR 1=1 --",
    })

    expect(sql).not.toContain('OR 1=1')
  })
})
