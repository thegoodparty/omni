import { describe, expect, it } from 'vitest'
import { Prisma } from '../../generated/prisma'
import { buildVoterFiltersSql } from './filters.sql.utils'
import { FilterData } from '../schemas/filters.schema'

const sqlToString = (sql: Prisma.Sql | null): string => {
  if (!sql) return ''
  return sql.strings.join('?')
}

describe('buildVoterFiltersSql', () => {
  describe('_or operator for numeric filters', () => {
    it('builds OR clause for multiple non-contiguous ranges', () => {
      const filterData: FilterData = {
        filters: ['estimatedIncomeAmountInt'],
        filterValues: {},
        filterOperators: {
          estimatedIncomeAmountInt: {
            operator: 'or',
            orRanges: [{ gte: 0, lte: 24999 }, { gte: 200000 }],
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('Estimated_Income_Amount_Int')
      expect(sqlStr).toContain('OR')
      expect(sqlStr).toContain('>=')
      expect(sqlStr).toContain('<=')
    })

    it('builds OR clause with _includeNull', () => {
      const filterData: FilterData = {
        filters: ['estimatedIncomeAmountInt'],
        filterValues: {},
        filterOperators: {
          estimatedIncomeAmountInt: {
            operator: 'or',
            orRanges: [
              { gte: 0, lte: 24999 },
              { gte: 50000, lte: 74999 },
            ],
            includeNull: true,
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('OR')
      expect(sqlStr).toContain('IS NULL')
    })

    it('handles gte-only range in _or', () => {
      const filterData: FilterData = {
        filters: ['estimatedIncomeAmountInt'],
        filterValues: {},
        filterOperators: {
          estimatedIncomeAmountInt: {
            operator: 'or',
            orRanges: [{ gte: 200000 }],
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('>=')
      expect(sqlStr).not.toContain('<=')
    })

    it('handles lte-only range in _or', () => {
      const filterData: FilterData = {
        filters: ['estimatedIncomeAmountInt'],
        filterValues: {},
        filterOperators: {
          estimatedIncomeAmountInt: {
            operator: 'or',
            orRanges: [{ lte: 24999 }],
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('<=')
      expect(sqlStr).not.toContain('>=')
    })

    it('handles empty orRanges array', () => {
      const filterData: FilterData = {
        filters: ['estimatedIncomeAmountInt'],
        filterValues: {},
        filterOperators: {
          estimatedIncomeAmountInt: {
            operator: 'or',
            orRanges: [],
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      expect(result).toBeNull()
    })

    it('handles range with neither gte nor lte', () => {
      const filterData: FilterData = {
        filters: ['estimatedIncomeAmountInt'],
        filterValues: {},
        filterOperators: {
          estimatedIncomeAmountInt: {
            operator: 'or',
            orRanges: [{}],
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      expect(result).toBeNull()
    })

    it('filters out invalid ranges but keeps valid ones', () => {
      const filterData: FilterData = {
        filters: ['estimatedIncomeAmountInt'],
        filterValues: {},
        filterOperators: {
          estimatedIncomeAmountInt: {
            operator: 'or',
            orRanges: [{}, { gte: 100000 }, {}],
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('>=')
    })

    it('handles three or more ranges', () => {
      const filterData: FilterData = {
        filters: ['estimatedIncomeAmountInt'],
        filterValues: {},
        filterOperators: {
          estimatedIncomeAmountInt: {
            operator: 'or',
            orRanges: [
              { gte: 0, lte: 24999 },
              { gte: 50000, lte: 74999 },
              { gte: 200000 },
            ],
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      const orCount = (sqlStr.match(/OR/g) || []).length
      expect(orCount).toBe(2)
    })

    it('returns IS NULL when orRanges empty but includeNull is true', () => {
      const filterData: FilterData = {
        filters: ['estimatedIncomeAmountInt'],
        filterValues: {},
        filterOperators: {
          estimatedIncomeAmountInt: {
            operator: 'or',
            orRanges: [],
            includeNull: true,
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('IS NULL')
    })

    it('returns IS NULL when all orRanges invalid but includeNull is true', () => {
      const filterData: FilterData = {
        filters: ['estimatedIncomeAmountInt'],
        filterValues: {},
        filterOperators: {
          estimatedIncomeAmountInt: {
            operator: 'or',
            orRanges: [{}],
            includeNull: true,
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('IS NULL')
    })

    it('handles null gte in orRanges as unbounded lower', () => {
      const filterData: FilterData = {
        filters: ['estimatedIncomeAmountInt'],
        filterValues: {},
        filterOperators: {
          estimatedIncomeAmountInt: {
            operator: 'or',
            orRanges: [{ gte: null as unknown as number, lte: 100 }],
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('<=')
      expect(sqlStr).not.toContain('>=')
    })
  })

  describe('existing operators still work', () => {
    it('builds simple range filter', () => {
      const filterData: FilterData = {
        filters: ['ageInt'],
        filterValues: {},
        filterOperators: {
          ageInt: {
            operator: 'range',
            gte: 18,
            lte: 25,
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('Age_Int')
      expect(sqlStr).toContain('>=')
      expect(sqlStr).toContain('<=')
    })

    it('builds gte-only filter', () => {
      const filterData: FilterData = {
        filters: ['ageInt'],
        filterValues: {},
        filterOperators: {
          ageInt: {
            operator: 'gte',
            value: 50,
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('>=')
    })

    it('builds is null filter', () => {
      const filterData: FilterData = {
        filters: ['estimatedIncomeAmountInt'],
        filterValues: {},
        filterOperators: {
          estimatedIncomeAmountInt: {
            operator: 'is',
            value: 'null',
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('IS NULL')
    })
  })

  describe('id filter', () => {
    it('emits = ANY with ::uuid[] for the in operator', () => {
      const filterData: FilterData = {
        filters: ['id'],
        filterValues: {},
        filterOperators: {
          id: {
            operator: 'in',
            values: ['11111111-1111-1111-1111-111111111111'],
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('v."id"')
      expect(sqlStr).toContain('= ANY(')
      expect(sqlStr).toContain('::uuid[]')
    })

    it('emits != ALL with ::uuid[] for the notIn operator', () => {
      const filterData: FilterData = {
        filters: ['id'],
        filterValues: {},
        filterOperators: {
          id: {
            operator: 'notIn',
            values: ['11111111-1111-1111-1111-111111111111'],
          },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('v."id"')
      expect(sqlStr).toContain('!= ALL(')
      expect(sqlStr).toContain('::uuid[]')
    })

    it('combines with a demographic filter via AND', () => {
      const filterData: FilterData = {
        filters: ['id', 'gender'],
        filterValues: {},
        filterOperators: {
          id: {
            operator: 'in',
            values: ['11111111-1111-1111-1111-111111111111'],
          },
          gender: { operator: 'eq', value: 'M' },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('v."id"')
      expect(sqlStr).toContain('Gender')
      expect(sqlStr).toContain('AND')
    })

    it('returns null when values are empty', () => {
      const filterData: FilterData = {
        filters: ['id'],
        filterValues: {},
        filterOperators: {
          id: { operator: 'in', values: [] },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      expect(result).toBeNull()
    })
  })

  describe('hasAddress filter', () => {
    it('emits an IS NOT NULL + != empty check for true', () => {
      const filterData: FilterData = {
        filters: ['hasAddress'],
        filterValues: {},
        filterOperators: {
          hasAddress: { operator: 'is', value: 'not_null' },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('Residence_Addresses_AddressLine')
      expect(sqlStr).toContain('IS NOT NULL')
      expect(sqlStr).toContain("!= ''")
    })

    it('emits an IS NULL OR empty check for false', () => {
      const filterData: FilterData = {
        filters: ['hasAddress'],
        filterValues: {},
        filterOperators: {
          hasAddress: { operator: 'is', value: 'null' },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('Residence_Addresses_AddressLine')
      expect(sqlStr).toContain('IS NULL')
      expect(sqlStr).toContain("= ''")
    })
  })
})
