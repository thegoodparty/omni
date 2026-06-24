import { describe, expect, it } from 'vitest'
import { buildVoterWhereSql } from './buildVoterWhereSql.utils'
import { FilterData } from '../schemas/filters.schema'

const EMPTY_FILTERS: FilterData = {
  filters: [],
  filterValues: {},
  filterOperators: {},
}

const build = (search: string) =>
  buildVoterWhereSql({ state: 'CA', filters: EMPTY_FILTERS, search })

describe('buildVoterWhereSql name search', () => {
  it('single lowercase token uses case-insensitive prefix match across both name fields', () => {
    const { sql, values } = build('jane')

    expect(sql).toContain('lower(v."FirstName") LIKE')
    expect(sql).toContain('lower(v."LastName") LIKE')
    expect(sql).toContain(" ESCAPE '\\'")
    expect(sql).toContain(' OR ')
    expect(values).toContain('jane%')
    expect(values).not.toContain('jane')
  })

  it('escapes LIKE metacharacters in the token so they cannot widen the match or defeat the prefix index', () => {
    const underscore = build('o_brien')
    // `_` is escaped to a literal, keeping the pattern an anchored prefix.
    expect(underscore.values).toContain('o\\_brien%')
    expect(underscore.values).not.toContain('o_brien%')
    expect(underscore.sql).toContain(" ESCAPE '\\'")

    const percent = build('50%off')
    expect(percent.values).toContain('50\\%off%')
    expect(percent.values).not.toContain('50%off%')
  })

  it('lowercases the token so an uppercase query still matches via the lower() index', () => {
    const { values } = build('JANE')

    expect(values).toContain('jane%')
    expect(values).not.toContain('JANE%')
  })

  it('"Jane Doe" emits two AND-joined OR-groups, one prefix per token, not the old exact equality', () => {
    const { sql, values } = build('Jane Doe')

    // Each token becomes its own (FirstName OR LastName) prefix group.
    const orGroups = sql.match(
      /lower\(v\."FirstName"\) LIKE \? ESCAPE '\\' OR lower\(v\."LastName"\) LIKE \? ESCAPE '\\'/g,
    )
    expect(orGroups).toHaveLength(2)

    // Both prefix bind values present, lowercased.
    expect(values).toContain('jane%')
    expect(values).toContain('doe%')

    // The old exact-equality, token-dropping behavior is gone.
    expect(sql).not.toContain('v."FirstName" = ?')
    expect(sql).not.toContain('v."LastName" = ?')
  })

  it('applies a prefix group for every token (does not drop tokens past index 1)', () => {
    const { sql, values } = build('mary jane watson')

    const orGroups = sql.match(
      /lower\(v\."FirstName"\) LIKE \? ESCAPE '\\' OR lower\(v\."LastName"\) LIKE \? ESCAPE '\\'/g,
    )
    expect(orGroups).toHaveLength(3)
    expect(values).toEqual(
      expect.arrayContaining(['mary%', 'jane%', 'watson%']),
    )
  })

  it('a 10-digit numeric string routes to the exact phone branch, untouched by the name fix', () => {
    const { sql, values } = build('4155551234')

    expect(sql).toContain('v."VoterTelephones_CellPhoneFormatted" = ?')
    expect(sql).toContain('v."VoterTelephones_LandlineFormatted" = ?')
    expect(sql).not.toContain('LIKE')
    expect(values).toContain('(415) 555-1234')
  })

  it('an 11-digit number with leading 1 also routes to the exact phone branch', () => {
    const { sql, values } = build('14155551234')

    expect(sql).toContain('v."VoterTelephones_CellPhoneFormatted" = ?')
    expect(sql).not.toContain('LIKE')
    expect(values).toContain('(415) 555-1234')
  })
})
