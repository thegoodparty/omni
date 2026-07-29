import { describe, expect, it } from 'vitest'
import { buildOverlapCountSql } from './buildOverlapCountSql.utils'
import { FilterData } from '../schemas/filters.schema'

const EMPTY_FILTERS: FilterData = {
  filters: [],
  filterValues: {},
  filterOperators: {},
}

const hasAddressFilter = (): FilterData => ({
  filters: ['hasAddress'],
  filterValues: {},
  filterOperators: { hasAddress: { operator: 'is', value: 'not_null' } },
})

const hasCellPhoneFilter = (): FilterData => ({
  filters: ['hasCellPhone'],
  filterValues: {},
  filterOperators: { hasCellPhone: { operator: 'is', value: 'not_null' } },
})

const sqlTextOf = (query: unknown): string => {
  const strings = (query as { strings?: readonly string[] })?.strings
  return strings ? strings.join('?') : ''
}

describe('buildOverlapCountSql', () => {
  it('ANDs the current-selection WHERE with an OR of the saved filter sets', () => {
    const sql = buildOverlapCountSql({
      state: 'CA',
      filters: hasAddressFilter(),
      savedFilterSets: [hasCellPhoneFilter(), EMPTY_FILTERS],
    })
    const text = sqlTextOf(sql)

    expect(text).toContain('SELECT COUNT(*)::bigint AS overlap_count')
    // Current selection (base) is in the WHERE, ahead of the saved-set OR.
    expect(text).toContain(
      'v."Residence_Addresses_AddressLine" IS NOT NULL AND v."Residence_Addresses_AddressLine" != \'\'',
    )
    // Single query, single COUNT(*): a voter matching more than one saved set
    // still contributes exactly one row to the count (union, not a sum of
    // per-set counts).
    const orIndex = text.indexOf(
      'v."VoterTelephones_CellPhoneFormatted" IS NOT NULL',
    )
    const trueIndex = text.indexOf('TRUE')
    expect(orIndex).toBeGreaterThan(-1)
    expect(trueIndex).toBeGreaterThan(orIndex)
    expect(text).toMatch(/AND \(.*OR.*TRUE\)/s)
  })

  it('treats a saved set with no predicates as unconditionally TRUE, not dropped', () => {
    const sql = buildOverlapCountSql({
      state: 'CA',
      filters: EMPTY_FILTERS,
      savedFilterSets: [EMPTY_FILTERS],
    })

    expect(sqlTextOf(sql)).toContain('AND (TRUE)')
  })

  it('collapses an empty savedFilterSets array to FALSE (union of zero sets)', () => {
    const sql = buildOverlapCountSql({
      state: 'CA',
      filters: EMPTY_FILTERS,
      savedFilterSets: [],
    })

    expect(sqlTextOf(sql)).toContain('AND FALSE')
  })

  it('joins DistrictVoter and scopes to the district when districtId is set', () => {
    const sql = buildOverlapCountSql({
      state: 'CA',
      districtId: 'district-1',
      filters: EMPTY_FILTERS,
      savedFilterSets: [hasCellPhoneFilter()],
    })
    const text = sqlTextOf(sql)

    expect(text).toContain('FROM "green"."DistrictVoter" dv')
    expect(text).toContain('dv."district_id" = ?::uuid')
  })

  it('scopes to the whole state (no DistrictVoter join) when districtId is unset', () => {
    const sql = buildOverlapCountSql({
      state: 'CA',
      filters: EMPTY_FILTERS,
      savedFilterSets: [hasCellPhoneFilter()],
    })

    expect(sqlTextOf(sql)).not.toContain('DistrictVoter')
  })

  it('wraps the fenced shape in an unordered, LIMIT-capped subquery evaluated before the count', () => {
    const sql = buildOverlapCountSql({
      state: 'CA',
      filters: EMPTY_FILTERS,
      savedFilterSets: [hasCellPhoneFilter()],
      fenceLimit: 10000,
    })
    const text = sqlTextOf(sql)

    expect(text).toContain('FROM (SELECT v.* FROM')
    expect(text).toContain('LIMIT')
    expect(sql.values.flat(Infinity)).toContain(10000)
  })

  it('applies a free-text search on the current selection only', () => {
    const sql = buildOverlapCountSql({
      state: 'CA',
      filters: EMPTY_FILTERS,
      search: 'jane',
      savedFilterSets: [hasCellPhoneFilter()],
    })
    const text = sqlTextOf(sql)

    expect(text).toContain('lower(v."FirstName") LIKE')
  })
})
