import { describe, expect, it } from 'vitest'
import { Prisma } from '../../generated/prisma'
import { buildVoterFiltersSql } from './filters.sql.utils'
import { FilterData } from '../schemas/filters.schema'
import {
  classifyPoliticalParty,
  POLITICAL_PARTY_RULES,
  RULED_POLITICAL_PARTIES,
} from './politicalParty.rules'

const sqlToString = (sql: Prisma.Sql | null): string => {
  if (!sql) return ''
  return sql.strings.join('?')
}

const flatValues = (sql: Prisma.Sql | null): unknown[] =>
  sql ? sql.values.flat(Infinity) : []

const partyFilter = (values: string[]): FilterData => ({
  filters: ['politicalParty'],
  filterValues: { politicalParty: values },
  filterOperators: {
    politicalParty: { operator: 'in', values, includeNull: false },
  },
})

// JS reference implementation of the SQL predicate the builder emits, used to
// prove the FILTER selects exactly the rows the DISPLAY classifier
// (classifyPoliticalParty) would label with the same party. ILIKE '%token%'
// <=> value.toLowerCase().includes(token); tokens are already lowercase.
const ilikeMatch = (value: string | null, token: string): boolean =>
  value !== null && value.toLowerCase().includes(token)

const matchesRule = (
  value: string | null,
  substrings: readonly string[],
): boolean => substrings.some((token) => ilikeMatch(value, token))

const selectedByFilter = (value: string | null, party: string): boolean => {
  if (party === 'Unknown') return value === null || value === ''
  const index = POLITICAL_PARTY_RULES.findIndex((rule) => rule.party === party)
  const rule = POLITICAL_PARTY_RULES[index]
  if (!rule) return false
  const own = matchesRule(value, rule.substrings)
  const noHigher = POLITICAL_PARTY_RULES.slice(0, index).every(
    (higher) => !matchesRule(value, higher.substrings),
  )
  return own && noHigher
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

  describe('politicalParty filter (reconciled with display classifier)', () => {
    it('matches Democratic via case-insensitive substrings (not exact equality)', () => {
      const result = buildVoterFiltersSql(partyFilter(['Democratic']))
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('Parties_Description')
      expect(sqlStr).toContain('ILIKE')
      // Highest precedence: no exclusion of any other party.
      expect(sqlStr).not.toContain('NOT')
      expect(flatValues(result)).toEqual(['%democratic%', '%democrat%'])
    })

    it('excludes higher-precedence parties when matching Republican', () => {
      const result = buildVoterFiltersSql(partyFilter(['Republican']))
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('ILIKE')
      // Republican rows must NOT also match the Democratic rule.
      expect(sqlStr).toContain('NOT')
      expect(flatValues(result)).toEqual([
        '%republican%',
        '%democratic%',
        '%democrat%',
      ])
    })

    it('excludes both Democratic and Republican when matching Independent', () => {
      const result = buildVoterFiltersSql(partyFilter(['Independent']))

      expect(flatValues(result)).toEqual([
        '%independent%',
        '%declined to state%',
        '%non-partisan%',
        // higher precedence exclusions, in order
        '%democratic%',
        '%democrat%',
        '%republican%',
      ])
    })

    it('maps Unknown to (IS NULL OR blank), never a literal string match', () => {
      const result = buildVoterFiltersSql(partyFilter(['Unknown']))
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('Parties_Description')
      expect(sqlStr).toContain('IS NULL')
      expect(sqlStr).toContain("= ''")
      expect(flatValues(result)).not.toContain('Unknown')
    })

    it('ORs per-party predicates together for a multi-select', () => {
      const result = buildVoterFiltersSql(
        partyFilter(['Democratic', 'Republican']),
      )
      const sqlStr = sqlToString(result)

      const orCount = (sqlStr.match(/ OR /g) || []).length
      // Democratic (1 internal OR) + Republican (1 internal OR) + 1 joining OR.
      expect(orCount).toBe(3)
      expect(flatValues(result)).toEqual([
        '%democratic%',
        '%democrat%',
        '%republican%',
        '%democratic%',
        '%democrat%',
      ])
    })

    it('combines a party selection with Unknown (party predicate OR null/blank)', () => {
      const result = buildVoterFiltersSql(
        partyFilter(['Independent', 'Unknown']),
      )
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('ILIKE')
      expect(sqlStr).toContain('IS NULL')
      expect(sqlStr).toContain("= ''")
      expect(flatValues(result)).toContain('%independent%')
      expect(flatValues(result)).not.toContain('Non-Partisan')
    })

    it('supports the eq operator', () => {
      const result = buildVoterFiltersSql({
        filters: ['politicalParty'],
        filterValues: { politicalParty: ['Republican'] },
        filterOperators: {
          politicalParty: { operator: 'eq', value: 'Republican' },
        },
      })

      expect(sqlToString(result)).toContain('ILIKE')
      expect(flatValues(result)).toEqual([
        '%republican%',
        '%democratic%',
        '%democrat%',
      ])
    })

    it('uses only parameterized values — no user input interpolated into SQL', () => {
      const result = buildVoterFiltersSql(partyFilter(['Democratic']))
      // Every dynamic token is a bound `%rule%` param; the static SQL text
      // carries no party names.
      expect(sqlToString(result)).not.toContain('democrat')
      for (const value of flatValues(result)) {
        expect(typeof value).toBe('string')
        expect(String(value).startsWith('%')).toBe(true)
      }
    })

    // The core correctness guarantee: for every real Parties_Description value,
    // the filter selects a row for party P iff the display classifier labels it
    // P. Emulates the emitted ILIKE/precedence SQL (see selectedByFilter).
    describe('filter selection agrees with display classification', () => {
      const DB_VALUES: Array<string | null> = [
        null,
        '',
        'Democratic',
        'Republican',
        'Non-Partisan',
        'Declined to State',
        'American Independent',
        'Registered Independent',
        'Harold Washington Democrat',
        'Harold Washington Republican',
        'Social Democrat',
        'Citizens Republican',
        'Independent Democrat',
        'Independent Republican',
        'Independence',
        'Green',
        'Libertarian',
        'Working Family Party',
        'Independent Democratic Coalition',
        'REPUBLICAN democrat',
      ]

      for (const party of RULED_POLITICAL_PARTIES) {
        it(`selects exactly the rows that display as ${party}`, () => {
          for (const value of DB_VALUES) {
            const displayed = classifyPoliticalParty(value) === party
            expect(selectedByFilter(value, party)).toBe(displayed)
          }
        })
      }

      it('Unknown selects exactly the null/blank rows (subset of display Other)', () => {
        for (const value of DB_VALUES) {
          const expected = value === null || value === ''
          expect(selectedByFilter(value, 'Unknown')).toBe(expected)
          if (expected) {
            expect(classifyPoliticalParty(value)).toBe('Other')
          }
        }
      })

      it('assigns each non-null value to at most one ruled party (precedence is exclusive)', () => {
        for (const value of DB_VALUES) {
          if (value === null) continue
          const hits = RULED_POLITICAL_PARTIES.filter((party) =>
            selectedByFilter(value, party),
          )
          expect(hits.length).toBeLessThanOrEqual(1)
        }
      })
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

    it('binds the whole id set as one array parameter, not one per id', () => {
      const ids = [
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333',
      ]
      const filterData: FilterData = {
        filters: ['id'],
        filterValues: {},
        filterOperators: {
          id: { operator: 'in', values: ids },
        },
      }

      const result = buildVoterFiltersSql(filterData)

      expect(result?.values).toHaveLength(1)
      expect(result?.values[0]).toEqual(ids)
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

  describe('idOverrides composition (ENG-10838)', () => {
    const voterStatusFilter = (values: string[]): FilterData => ({
      filters: ['voterStatus'],
      filterValues: {},
      filterOperators: {
        voterStatus: { operator: 'in', values },
      },
    })

    it('is byte-identical to today when idOverrides is omitted', () => {
      const withoutArg = buildVoterFiltersSql(voterStatusFilter(['Unlikely']))
      const withUndefined = buildVoterFiltersSql(
        voterStatusFilter(['Unlikely']),
        undefined,
      )
      expect(sqlToString(withUndefined)).toBe(sqlToString(withoutArg))
      expect(flatValues(withUndefined)).toEqual(flatValues(withoutArg))
    })

    it('is byte-identical to today when include/exclude are both empty', () => {
      const withoutOverrides = buildVoterFiltersSql(
        voterStatusFilter(['Unlikely']),
      )
      const withEmptyOverrides = buildVoterFiltersSql(
        voterStatusFilter(['Unlikely']),
        {},
      )
      expect(sqlToString(withEmptyOverrides)).toBe(
        sqlToString(withoutOverrides),
      )
    })

    it('excludes an id even though it matches the seed voterStatus', () => {
      const excludedId = '11111111-1111-1111-1111-111111111111'
      const result = buildVoterFiltersSql(voterStatusFilter(['Unlikely']), {
        exclude: [excludedId],
      })
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('Voter_Status')
      expect(sqlStr).toContain('AND')
      expect(sqlStr).toContain('v."id" != ALL(')
      expect(flatValues(result)).toContain(excludedId)
    })

    it('includes an id even though it fails the seed voterStatus', () => {
      const includedId = '22222222-2222-2222-2222-222222222222'
      const result = buildVoterFiltersSql(voterStatusFilter(['Unlikely']), {
        include: [includedId],
      })
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('Voter_Status')
      expect(sqlStr).toContain('OR')
      expect(sqlStr).toContain('v."id" = ANY(')
      expect(flatValues(result)).toContain(includedId)
    })

    it('combines include and exclude: (voterStatus AND NOT excl) OR incl', () => {
      const includedId = '22222222-2222-2222-2222-222222222222'
      const excludedId = '11111111-1111-1111-1111-111111111111'
      const result = buildVoterFiltersSql(voterStatusFilter(['Unlikely']), {
        include: [includedId],
        exclude: [excludedId],
      })
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('v."id" != ALL(')
      expect(sqlStr).toContain('v."id" = ANY(')
      expect(sqlStr).toMatch(/AND.*OR/)
    })

    it('binds include and exclude as one array parameter each', () => {
      const includeIds = [
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333',
      ]
      const excludeIds = ['11111111-1111-1111-1111-111111111111']
      const result = buildVoterFiltersSql(voterStatusFilter(['Unlikely']), {
        include: includeIds,
        exclude: excludeIds,
      })

      includeIds.forEach((id) => expect(flatValues(result)).toContain(id))
      excludeIds.forEach((id) => expect(flatValues(result)).toContain(id))
      // The result?.values array itself (not fully flattened) has exactly one
      // entry per array-bound parameter: the voterStatus 'in' array, the
      // exclude array, and the include array — never one entry per id.
      expect(result?.values).toHaveLength(3)
    })

    // The critical composition-correctness case (ENG-10838): the OR must
    // scope to ONLY the voterStatus clause. An override-included person must
    // still be excluded by every other selected filter (age/party/gender/…) —
    // the OR can never bubble up to wrap the whole filter conjunction.
    it('scopes the OR to voterStatus only — other filters still AND at the top level', () => {
      const includedId = '22222222-2222-2222-2222-222222222222'
      const filterData: FilterData = {
        filters: ['voterStatus', 'gender'],
        filterValues: {},
        filterOperators: {
          voterStatus: { operator: 'in', values: ['Unlikely'] },
          gender: { operator: 'eq', value: 'M' },
        },
      }

      const result = buildVoterFiltersSql(filterData, { include: [includedId] })
      const sqlStr = sqlToString(result)

      // buildVoterFiltersSql AND-joins one clause per filter key: the
      // voterStatus/id OR-composite (its own parenthesized clause) is one
      // item, gender is a second, sibling item — `(<composite>) AND <gender>`.
      // So the OR never becomes the outermost operator of the whole
      // expression, and gender still filters an override-included row. The
      // composite's closing paren is immediately followed by the top-level
      // AND join to the gender clause, not swallowed inside the OR.
      expect(sqlStr).toContain('OR v."id" = ANY(')
      expect(sqlStr).toContain(') AND v."Gender" = ')
    })
  })

  describe('contactsMadeIdOverrides composition (ENG-10839)', () => {
    const noFilters: FilterData = {
      filters: [],
      filterValues: {},
      filterOperators: {},
    }

    it('is byte-identical to today when contactsMadeIdOverrides is omitted', () => {
      const withoutArg = buildVoterFiltersSql(noFilters)
      const withUndefined = buildVoterFiltersSql(
        noFilters,
        undefined,
        undefined,
      )
      expect(sqlToString(withUndefined)).toBe(sqlToString(withoutArg))
      expect(withUndefined).toEqual(withoutArg)
    })

    it('is byte-identical to today when include/exclude are both empty', () => {
      const withoutOverrides = buildVoterFiltersSql(noFilters)
      const withEmptyOverrides = buildVoterFiltersSql(noFilters, undefined, {})
      expect(sqlToString(withEmptyOverrides)).toBe(
        sqlToString(withoutOverrides),
      )
    })

    // The "0 contacts" + a non-zero bucket case (ENG-10839): notIn contacted
    // OR in the selected bucket — no people-api filter key backs this (there
    // is no `contactsMade` FilterData entry), so with an empty `filters`
    // array this must still produce a well-formed standalone clause rather
    // than returning null.
    it('composes an unconditional clause even with zero other filters', () => {
      const excludedId = '11111111-1111-1111-1111-111111111111'
      const includedId = '22222222-2222-2222-2222-222222222222'
      const result = buildVoterFiltersSql(noFilters, undefined, {
        include: [includedId],
        exclude: [excludedId],
      })
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('v."id" != ALL(')
      expect(sqlStr).toContain('v."id" = ANY(')
      expect(sqlStr).toMatch(/AND.*OR/)
      expect(flatValues(result)).toContain(excludedId)
      expect(flatValues(result)).toContain(includedId)
    })

    it('a notIn-only selection ("0" alone) composes without an OR', () => {
      const excludedId = '11111111-1111-1111-1111-111111111111'
      const result = buildVoterFiltersSql(noFilters, undefined, {
        exclude: [excludedId],
      })
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('v."id" != ALL(')
      expect(sqlStr).not.toContain('v."id" = ANY(')
    })

    it('AND-composes with an unrelated demographic filter at the top level', () => {
      const includedId = '22222222-2222-2222-2222-222222222222'
      const genderFilter: FilterData = {
        filters: ['gender'],
        filterValues: {},
        filterOperators: { gender: { operator: 'eq', value: 'M' } },
      }
      const result = buildVoterFiltersSql(genderFilter, undefined, {
        include: [includedId],
      })
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('v."Gender" = ')
      expect(sqlStr).toContain('v."id" = ANY(')
      expect(sqlStr).toMatch(/AND/)
    })

    // The two override channels are independent (ENG-10838's voterStatus-scoped
    // idOverrides vs ENG-10839's unconditional contactsMadeIdOverrides) — a
    // request selecting both a Voter Likelihood override AND a contacts-made
    // mixed bucket must apply both without either clobbering the other.
    it('composes independently alongside the voterStatus-scoped idOverrides', () => {
      const likelihoodIncludedId = '33333333-3333-3333-3333-333333333333'
      const contactsExcludedId = '44444444-4444-4444-4444-444444444444'
      const voterStatusFilter: FilterData = {
        filters: ['voterStatus'],
        filterValues: {},
        filterOperators: {
          voterStatus: { operator: 'in', values: ['Unlikely'] },
        },
      }
      const result = buildVoterFiltersSql(
        voterStatusFilter,
        { include: [likelihoodIncludedId] },
        { exclude: [contactsExcludedId] },
      )
      const sqlStr = sqlToString(result)

      expect(flatValues(result)).toContain(likelihoodIncludedId)
      expect(flatValues(result)).toContain(contactsExcludedId)
      // Two independent parenthesized composites, top-level AND-joined.
      expect(sqlStr).toContain('v."id" = ANY(')
      expect(sqlStr).toContain('v."id" != ALL(')
    })

    it('binds include and exclude as one array parameter each', () => {
      const includeIds = [
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333',
      ]
      const excludeIds = ['11111111-1111-1111-1111-111111111111']
      const result = buildVoterFiltersSql(noFilters, undefined, {
        include: includeIds,
        exclude: excludeIds,
      })

      includeIds.forEach((id) => expect(flatValues(result)).toContain(id))
      excludeIds.forEach((id) => expect(flatValues(result)).toContain(id))
      expect(result?.values).toHaveLength(2)
    })
  })
})
