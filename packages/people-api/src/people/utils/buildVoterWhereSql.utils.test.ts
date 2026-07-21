import { describe, expect, it } from 'vitest'
import { buildVoterWhereSql, isNameSearch } from './buildVoterWhereSql.utils'
import { FilterData } from '../schemas/filters.schema'

const EMPTY_FILTERS: FilterData = {
  filters: [],
  filterValues: {},
  filterOperators: {},
}

const build = (search: string) =>
  buildVoterWhereSql({ state: 'CA', filters: EMPTY_FILTERS, search })

describe('buildVoterWhereSql name search', () => {
  it('3+ char token emits case-insensitive substring match across both name fields', () => {
    const { sql, values } = build('mar')

    expect(sql).toContain('lower(v."FirstName") LIKE')
    expect(sql).toContain('lower(v."LastName") LIKE')
    expect(sql).toContain(" ESCAPE '\\'")
    expect(sql).toContain(' OR ')
    expect(values).toContain('%mar%')
    expect(values).not.toContain('mar%')
    expect(values).not.toContain('mar')
  })

  it('1-2 char token keeps the anchored-prefix form for the b-tree indexes', () => {
    const single = build('j')
    expect(single.values).toContain('j%')
    expect(single.values).not.toContain('%j%')

    const double = build('li')
    expect(double.values).toContain('li%')
    expect(double.values).not.toContain('%li%')
  })

  it('mixed-length tokens emit prefix for the short token, substring for the long one, AND-joined', () => {
    const { sql, values } = build('j martinez')

    const orGroups = sql.match(
      /lower\(v\."FirstName"\) LIKE \? ESCAPE '\\' OR lower\(v\."LastName"\) LIKE \? ESCAPE '\\'/g,
    )
    expect(orGroups).toHaveLength(2)
    expect(sql).toContain(') AND (')
    expect(values).toContain('j%')
    expect(values).toContain('%martinez%')
  })

  it('escapes LIKE metacharacters inside the wrapping wildcards so they cannot widen the match', () => {
    const meta = build('ma%r_')
    expect(meta.values).toContain('%ma\\%r\\_%')
    expect(meta.values).not.toContain('%ma%r_%')
    expect(meta.sql).toContain(" ESCAPE '\\'")

    const underscore = build('o_brien')
    expect(underscore.values).toContain('%o\\_brien%')
    expect(underscore.values).not.toContain('%o_brien%')

    const backslash = build('mar\\')
    expect(backslash.values).toContain('%mar\\\\%')
    expect(backslash.values).not.toContain('%mar\\%')
  })

  it('escapes metacharacters in short tokens while keeping the anchored prefix', () => {
    const { values } = build('a_')
    expect(values).toContain('a\\_%')
    expect(values).not.toContain('%a\\_%')
  })

  it('lowercases the token so an uppercase query still matches via the lower() index', () => {
    const { values } = build('MAR')

    expect(values).toContain('%mar%')
    expect(values).not.toContain('%MAR%')
  })

  it('"Jane Doe" emits two AND-joined OR-groups, one substring pattern per token', () => {
    const { sql, values } = build('Jane Doe')

    const orGroups = sql.match(
      /lower\(v\."FirstName"\) LIKE \? ESCAPE '\\' OR lower\(v\."LastName"\) LIKE \? ESCAPE '\\'/g,
    )
    expect(orGroups).toHaveLength(2)

    expect(values).toContain('%jane%')
    expect(values).toContain('%doe%')

    expect(sql).not.toContain('v."FirstName" = ?')
    expect(sql).not.toContain('v."LastName" = ?')
  })

  it('applies a match group for every token (does not drop tokens past index 1)', () => {
    const { sql, values } = build('mary jane watson')

    const orGroups = sql.match(
      /lower\(v\."FirstName"\) LIKE \? ESCAPE '\\' OR lower\(v\."LastName"\) LIKE \? ESCAPE '\\'/g,
    )
    expect(orGroups).toHaveLength(3)
    expect(values).toEqual(
      expect.arrayContaining(['%mary%', '%jane%', '%watson%']),
    )
  })

  it('a 10-digit numeric string routes to the exact phone branch, byte-identical to before', () => {
    const { sql, values } = build('4155551234')

    expect(sql).toBe(
      'WHERE v."State" = CAST(?::text AS "public"."USState") AND (v."VoterTelephones_CellPhoneFormatted" = ? OR v."VoterTelephones_LandlineFormatted" = ?)',
    )
    expect(sql).not.toContain('LIKE')
    expect(values).toEqual(['CA', '(415) 555-1234', '(415) 555-1234'])
  })

  it('an 11-digit number with leading 1 also routes to the exact phone branch', () => {
    const { sql, values } = build('14155551234')

    expect(sql).toContain('v."VoterTelephones_CellPhoneFormatted" = ?')
    expect(sql).not.toContain('LIKE')
    expect(values).toContain('(415) 555-1234')
  })
})

describe('isNameSearch', () => {
  it('is true exactly when the search routes to the name LIKE branch', () => {
    expect(isNameSearch('mar')).toBe(true)
    expect(isNameSearch('  jane doe  ')).toBe(true)
    expect(isNameSearch('j')).toBe(true)
  })

  it('is false for phone searches, empty, and missing input', () => {
    expect(isNameSearch('4155551234')).toBe(false)
    expect(isNameSearch('14155551234')).toBe(false)
    expect(isNameSearch('   ')).toBe(false)
    expect(isNameSearch('')).toBe(false)
    expect(isNameSearch(undefined)).toBe(false)
  })
})
