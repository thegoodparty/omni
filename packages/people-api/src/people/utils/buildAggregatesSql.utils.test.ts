import { describe, expect, it } from 'vitest'
import { buildAggregatesSql } from './buildAggregatesSql.utils'
import { FilterData } from '../schemas/filters.schema'

const EMPTY_FILTERS: FilterData = {
  filters: [],
  filterValues: {},
  filterOperators: {},
}

describe('buildAggregatesSql', () => {
  it('selects COUNT and AVG(age)/AVG(income) scoped to the state only', () => {
    const { sql, values } = buildAggregatesSql({
      state: 'CA',
      filters: EMPTY_FILTERS,
    })

    expect(sql).toContain('COUNT(*)::bigint AS count')
    expect(sql).toContain('AVG(v."Age_Int")::float8 AS "avgAge"')
    expect(sql).toContain(
      'AVG(v."Estimated_Income_Amount_Int")::float8 AS "avgIncome"',
    )
    expect(sql).toContain('FROM "green"."Voter" v')
    expect(sql).not.toContain('DistrictVoter')
    expect(values).toEqual([])
  })

  it('joins DistrictVoter and scopes to the district when districtId is set', () => {
    const { sql, values } = buildAggregatesSql({
      state: 'CA',
      districtId: 'district-1',
      filters: EMPTY_FILTERS,
    })

    expect(sql).toContain('FROM "green"."DistrictVoter" dv')
    expect(sql).toContain('JOIN "green"."Voter" v')
    expect(sql).toContain('dv."district_id" = ?::uuid')
    expect(values).toEqual(['district-1'])
  })

  it('applies the id filter under the same WHERE the list/count queries use', () => {
    const personId = '11111111-1111-1111-1111-111111111111'
    const filters: FilterData = {
      filters: ['id'],
      filterValues: {},
      filterOperators: {
        id: { operator: 'in', values: [personId] },
      },
    }

    const { sql, values } = buildAggregatesSql({ state: 'CA', filters })

    expect(sql).toContain('v."id" = ANY(?::uuid[])')
    expect(values).toEqual([[personId]])
  })

  it('AND-joins a demographic filter alongside the id filter', () => {
    const personId = '11111111-1111-1111-1111-111111111111'
    const filters: FilterData = {
      filters: ['id', 'hasAddress'],
      filterValues: {},
      filterOperators: {
        id: { operator: 'in', values: [personId] },
        hasAddress: { operator: 'is', value: 'not_null' },
      },
    }

    const { sql, values } = buildAggregatesSql({ state: 'CA', filters })

    expect(sql).toContain(
      'v."id" = ANY(?::uuid[]) AND (v."Residence_Addresses_AddressLine" IS NOT NULL AND v."Residence_Addresses_AddressLine" != \'\')',
    )
    expect(values).toEqual([[personId]])
  })
})
