import { describe, expect, it } from 'vitest'
import { PeopleFiltersSchema } from '@goodparty_org/contracts'
import { filtersSchema, type FilterData } from '../schemas/filters.schema'
import {
  buildAggregatesSql,
  buildCountSql,
  buildCsvSql,
  buildOverlapCountSql,
  buildPageSql,
  buildScopeSql,
  buildSearchSql,
  buildVoterFiltersSql,
  lit,
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
    const sql = buildScopeSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
    })

    expect(sql).toBe(
      "WHERE v.`State` = 'CA' AND v.`US_Congressional_District` = '29'",
    )
  })

  it('never joins the district-voter junction table', () => {
    const sql = buildCountSql({ district: CONGRESSIONAL, filters: noFilters() })

    expect(sql.toLowerCase()).not.toContain('districtvoter')
    expect(sql.toLowerCase()).not.toContain('join')
  })

  it('drops the district predicate for a state-named State district', () => {
    const sql = buildScopeSql({ district: STATEWIDE, filters: noFilters() })

    expect(sql).toBe("WHERE v.`State` = 'CA'")
  })

  it('keeps the state predicate on every query', () => {
    const withFilters = buildScopeSql({
      district: CONGRESSIONAL,
      filters: parseFilters({ hasCellPhone: true }),
      search: 'smith',
    })

    expect(withFilters.startsWith("WHERE v.`State` = 'CA' AND")).toBe(true)
  })
})

describe('buildSearchSql', () => {
  it('matches a 10-digit phone against both formatted columns', () => {
    expect(buildSearchSql('4155551234')).toBe(
      "(v.`VoterTelephones_CellPhoneFormatted` = '(415) 555-1234'" +
        " OR v.`VoterTelephones_LandlineFormatted` = '(415) 555-1234')",
    )
  })

  it('strips a leading 1 from an 11-digit phone', () => {
    expect(buildSearchSql('14155551234')).toContain("'(415) 555-1234'")
  })

  it('treats a 9-digit number as a name token, not a phone', () => {
    const sql = buildSearchSql('415555123')

    expect(sql).toContain('lower(v.`FirstName`) LIKE')
    expect(sql).toContain("'%415555123%'")
  })

  it('uses an infix pattern for tokens of three or more chars', () => {
    expect(buildSearchSql('smith')).toBe(
      "(lower(v.`FirstName`) LIKE '%smith%' ESCAPE '\\\\'" +
        " OR lower(v.`LastName`) LIKE '%smith%' ESCAPE '\\\\')",
    )
  })

  it('anchors tokens of one or two chars to a prefix', () => {
    const sql = buildSearchSql('li')

    expect(sql).toContain("LIKE 'li%'")
    expect(sql).not.toContain("'%li%'")
  })

  it('AND-joins multiple tokens, each matching either name column', () => {
    const sql = buildSearchSql('jane doe') ?? ''

    expect(sql).toContain("'%jane%'")
    expect(sql).toContain("'%doe%'")
    expect(sql.split(' AND ')).toHaveLength(2)
  })

  it('escapes LIKE metacharacters so they cannot widen the match', () => {
    expect(buildSearchSql('a_b')).toContain("'%a\\\\_b%'")
    expect(buildSearchSql('a%b')).toContain("'%a\\\\%b%'")
  })

  it('escapes a backslash in the token', () => {
    const sql = buildSearchSql('a\\b')

    expect(sql).toContain("'%a\\\\\\\\b%'")
  })

  it('returns null for blank input', () => {
    expect(buildSearchSql('   ')).toBeNull()
  })
})

describe('lit', () => {
  it('escapes a quote so a name like O’Brien cannot break the SQL', () => {
    expect(lit("O'Brien")).toBe("'O\\'Brien'")
  })

  it('escapes a backslash', () => {
    expect(lit('a\\b')).toBe("'a\\\\b'")
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
        buildVoterFiltersSql(parseFilters({ [key]: value })),
      ).not.toBeNull()
    }
  })

  it('maps homeowner display values to their L2 values', () => {
    const sql = buildVoterFiltersSql(
      parseFilters({ homeowner: { in: ['Yes'] } }),
    )

    expect(sql).toBe("v.`Homeowner_Probability_Model` IN ('Home Owner')")
  })

  it('treats an Unknown selection as a null check', () => {
    const sql = buildVoterFiltersSql(
      parseFilters({ gender: { in: ['Unknown'] } }),
    )

    expect(sql).toBe('v.`Gender` IS NULL')
  })

  it('ORs the null branch when Unknown is mixed with real values', () => {
    const sql = buildVoterFiltersSql(
      parseFilters({ gender: { in: ['F', 'Unknown'] } }),
    )

    expect(sql).toBe("(v.`Gender` IN ('F') OR v.`Gender` IS NULL)")
  })

  it('builds the political-party Other predicate with an explicit null', () => {
    const sql = buildVoterFiltersSql(
      parseFilters({ politicalParty: { in: ['Other'] } }),
    )

    expect(sql).toContain('v.`Parties_Description` IS NULL OR')
    expect(sql).toContain('NOT IN (')
  })

  it('includes nulls in a numeric range when asked', () => {
    const sql = buildVoterFiltersSql(
      parseFilters({ ageInt: { gte: 30, lte: 40, _includeNull: true } }),
    )

    expect(sql).toBe(
      '(v.`Age_Int` >= 30 AND v.`Age_Int` <= 40 OR v.`Age_Int` IS NULL)',
    )
  })

  it('renders hasAnyPhone as cell OR landline', () => {
    expect(buildVoterFiltersSql(parseFilters({ hasAnyPhone: true }))).toBe(
      '(v.`VoterTelephones_CellPhoneFormatted` IS NOT NULL OR ' +
        'v.`VoterTelephones_LandlineFormatted` IS NOT NULL)',
    )
  })

  it('renders an id set as IN / NOT IN over the primary key', () => {
    const id = '11111111-1111-1111-1111-111111111111'

    expect(buildVoterFiltersSql(parseFilters({ id: { in: [id] } }))).toBe(
      `v.\`id\` IN ('${id}')`,
    )
    expect(buildVoterFiltersSql(parseFilters({ id: { notIn: [id] } }))).toBe(
      `v.\`id\` NOT IN ('${id}')`,
    )
  })

  it('scopes idOverrides to the voterStatus clause only', () => {
    const include = ['11111111-1111-1111-1111-111111111111']
    const exclude = ['22222222-2222-2222-2222-222222222222']
    const sql = buildVoterFiltersSql(
      parseFilters({ voterStatus: { in: ['Super'] }, hasCellPhone: true }),
      { include, exclude },
    )

    expect(sql).toContain(
      "((v.`Voter_Status` IN ('Super') AND v.`id` NOT IN " +
        `('${exclude[0]}')) OR v.\`id\` IN ('${include[0]}'))`,
    )
    // The channel filter stays outside the override composite.
    expect(sql).toContain('v.`VoterTelephones_CellPhoneFormatted` IS NOT NULL')
  })

  it('composes contactsMadeIdOverrides as its own top-level clause', () => {
    const include = ['11111111-1111-1111-1111-111111111111']
    const sql = buildVoterFiltersSql(noFilters(), undefined, { include })

    expect(sql).toBe(`(TRUE OR v.\`id\` IN ('${include[0]}'))`)
  })

  it('returns null when nothing is filtered', () => {
    expect(buildVoterFiltersSql(noFilters())).toBeNull()
  })
})

describe('aggregate and page queries', () => {
  it('selects count and both averages', () => {
    const sql = buildAggregatesSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
    })

    expect(sql).toContain('COUNT(*) AS count')
    expect(sql).toContain('AVG(v.`Age_Int`) AS avgAge')
    expect(sql).toContain('AVG(v.`Estimated_Income_Amount_Int`) AS avgIncome')
  })

  it('orders a page by id and applies LIMIT/OFFSET', () => {
    const sql = buildPageSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
      columns: ['id', 'FirstName'],
      take: 50,
      skip: 100,
    })

    expect(sql).toContain('SELECT v.`id` AS `id`, v.`FirstName` AS `FirstName`')
    expect(sql.endsWith('ORDER BY v.`id` LIMIT 50 OFFSET 100')).toBe(true)
  })

  it('ORs the saved sets into the overlap count', () => {
    const sql = buildOverlapCountSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
      savedFilterSets: [parseFilters({ hasCellPhone: true }), parseFilters({})],
    })

    expect(sql).toContain(
      'AND (v.`VoterTelephones_CellPhoneFormatted` IS NOT NULL OR TRUE)',
    )
  })

  it('matches nothing when there are no saved sets', () => {
    const sql = buildOverlapCountSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
      savedFilterSets: [],
    })

    expect(sql).toContain('AND FALSE')
  })
})

describe('buildCsvSql', () => {
  it('null-coalesces every column so NULL is a blank field, not "null"', () => {
    const sql = buildCsvSql({ district: CONGRESSIONAL, filters: noFilters() })

    expect(sql).toContain(
      "nvl(CAST(v.`LALVOTERID` AS STRING), '') AS `Voter ID`",
    )
    expect(sql).toContain(
      "nvl(CAST(v.`FirstName` AS STRING), '') AS `First Name`",
    )
  })

  it('omits excluded columns from the projection', () => {
    const sql = buildCsvSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
      excludeColumns: ['Parties_Description'],
    })

    expect(sql).not.toContain('`Registered Party`')
    expect(sql).toContain('`First Name`')
  })
})
