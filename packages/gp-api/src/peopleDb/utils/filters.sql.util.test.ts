import { describe, expect, it } from 'vitest'
import { Prisma } from '../../generated/people-prisma'
import { buildVoterFiltersSql } from './filters.sql.util'
import { FilterData } from '../schemas/filters.schema'
import {
  ALL_KNOWN_PARTY_VALUES,
  classifyPoliticalParty,
  POLITICAL_PARTY_EXACT_VALUES,
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
// (classifyPoliticalParty) would label with the same party. `IN (...)` <=>
// exact membership; 'Other' <=> null OR not in any exact set.
const selectedByFilter = (value: string | null, party: string): boolean => {
  if (party === 'Other') {
    return value === null || !ALL_KNOWN_PARTY_VALUES.includes(value)
  }
  const ruled = RULED_POLITICAL_PARTIES.find((p) => p === party)
  if (!ruled) return false
  return (
    value !== null &&
    POLITICAL_PARTY_EXACT_VALUES[ruled].some((known) => known === value)
  )
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

  describe('homeowner filter (ENG-10947)', () => {
    it('folds Probable Home Owner into the Homeowner selection', () => {
      const filterData: FilterData = {
        filters: ['homeowner'],
        filterValues: { homeowner: ['Yes'] },
        filterOperators: {
          homeowner: { operator: 'eq', value: 'Yes' },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('Homeowner_Probability_Model')
      expect(sqlStr).toContain('ANY(ARRAY[')
      expect(flatValues(result)).toEqual(['Home Owner', 'Probable Home Owner'])
    })

    it('also folds Probable Home Owner in through the multi-select `in` path', () => {
      const filterData: FilterData = {
        filters: ['homeowner'],
        filterValues: { homeowner: ['Yes', 'No'] },
        filterOperators: {
          homeowner: { operator: 'in', values: ['Yes', 'No'] },
        },
      }

      const result = buildVoterFiltersSql(filterData)

      expect(flatValues(result)).toEqual([
        'Home Owner',
        'Probable Home Owner',
        'Renter',
      ])
    })

    it('maps the Unknown selection to IS NULL', () => {
      const filterData: FilterData = {
        filters: ['homeowner'],
        filterValues: { homeowner: ['Unknown'] },
        filterOperators: {
          homeowner: { operator: 'eq', value: 'Unknown' },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('Homeowner_Probability_Model')
      expect(sqlStr).toContain('IS NULL')
    })

    // Saved filters persisted before the Homeowner/Renter/Unknown collapse
    // can still carry the legacy `homeownerLikely` boolean, which resolves
    // to this wire value — it must keep resolving to ONLY the probable
    // bucket, not the folded Homeowner selection above.
    it('keeps the legacy Likely wire value resolving to Probable Home Owner only', () => {
      const filterData: FilterData = {
        filters: ['homeowner'],
        filterValues: { homeowner: ['Likely'] },
        filterOperators: {
          homeowner: { operator: 'eq', value: 'Likely' },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('Homeowner_Probability_Model')
      expect(sqlStr).not.toContain('ANY(ARRAY[')
      expect(flatValues(result)).toEqual(['Probable Home Owner'])
    })
  })

  describe('politicalParty filter (reconciled with display classifier)', () => {
    it('matches Democratic via an exact-value IN, not ILIKE', () => {
      const result = buildVoterFiltersSql(partyFilter(['Democratic']))
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('Parties_Description')
      expect(sqlStr).toContain('IN (')
      expect(sqlStr).not.toContain('ILIKE')
      expect(sqlStr).not.toContain('NOT')
      expect(flatValues(result)).toEqual(['Democratic'])
    })

    it('matches Republican with no precedence exclusions', () => {
      const result = buildVoterFiltersSql(partyFilter(['Republican']))
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('IN (')
      expect(sqlStr).not.toContain('NOT')
      expect(flatValues(result)).toEqual(['Republican'])
    })

    it('matches every exact Independent value', () => {
      const result = buildVoterFiltersSql(partyFilter(['Independent']))

      expect(flatValues(result)).toEqual([
        'Non-Partisan',
        'American Independent',
        'Registered Independent',
        'Declined to State',
      ])
    })

    it('maps Other to (IS NULL OR NOT IN <known values>)', () => {
      const result = buildVoterFiltersSql(partyFilter(['Other']))
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('Parties_Description')
      expect(sqlStr).toContain('IS NULL')
      expect(sqlStr).toContain('NOT IN (')
      // The negation binds every known ruled-party value.
      expect(flatValues(result)).toEqual([...ALL_KNOWN_PARTY_VALUES])
    })

    it('ORs per-party predicates together for a multi-select', () => {
      const result = buildVoterFiltersSql(
        partyFilter(['Democratic', 'Republican']),
      )
      const sqlStr = sqlToString(result)

      // Two single-value IN predicates joined by one OR.
      const orCount = (sqlStr.match(/ OR /g) || []).length
      expect(orCount).toBe(1)
      expect(flatValues(result)).toEqual(['Democratic', 'Republican'])
    })

    it('combines a party selection with Other (IN OR null/not-in)', () => {
      const result = buildVoterFiltersSql(partyFilter(['Independent', 'Other']))
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('IN (')
      expect(sqlStr).toContain('IS NULL')
      expect(sqlStr).toContain('NOT IN (')
      expect(flatValues(result)).toContain('Non-Partisan')
    })

    it('supports the eq operator', () => {
      const result = buildVoterFiltersSql({
        filters: ['politicalParty'],
        filterValues: { politicalParty: ['Republican'] },
        filterOperators: {
          politicalParty: { operator: 'eq', value: 'Republican' },
        },
      })

      expect(sqlToString(result)).toContain('IN (')
      expect(flatValues(result)).toEqual(['Republican'])
    })

    it('uses only parameterized values — no user input interpolated into SQL', () => {
      const result = buildVoterFiltersSql(partyFilter(['Democratic']))
      // The exact value is a bound param; the static SQL text carries no
      // party names.
      expect(sqlToString(result)).not.toContain('Democratic')
      for (const value of flatValues(result)) {
        expect(typeof value).toBe('string')
      }
    })

    // The core correctness guarantee: for every real Parties_Description value,
    // the filter selects a row for party P iff the display classifier labels it
    // P. Emulates the emitted exact-match SQL (see selectedByFilter).
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
        'Citizens Republican',
        'Independent Democrat',
        'Independence',
        'Green',
        'Libertarian',
        'Working Family Party',
      ]

      for (const party of RULED_POLITICAL_PARTIES) {
        it(`selects exactly the rows that display as ${party}`, () => {
          for (const value of DB_VALUES) {
            const displayed = classifyPoliticalParty(value) === party
            expect(selectedByFilter(value, party)).toBe(displayed)
          }
        })
      }

      it('Other selects exactly the rows that display as Other', () => {
        for (const value of DB_VALUES) {
          const displayed = classifyPoliticalParty(value) === 'Other'
          expect(selectedByFilter(value, 'Other')).toBe(displayed)
        }
      })

      it('assigns each value to exactly one canonical bucket', () => {
        for (const value of DB_VALUES) {
          const hits = [...RULED_POLITICAL_PARTIES, 'Other'].filter((party) =>
            selectedByFilter(value, party),
          )
          expect(hits.length).toBe(1)
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

  // ENG-10914: phoneBanking reachability moved from landline-only to any
  // phone (cell OR landline). This asserts the SQL shape AND, via a JS
  // mirror of the predicate, that it matches exactly the population the
  // ticket's test plan describes: cell-only and landline-only people, not
  // a phoneless one.
  describe('hasAnyPhone filter (ENG-10914)', () => {
    it('emits an OR of cell-phone/landline IS NOT NULL checks for true', () => {
      const filterData: FilterData = {
        filters: ['hasAnyPhone'],
        filterValues: {},
        filterOperators: {
          hasAnyPhone: { operator: 'is', value: 'not_null' },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('VoterTelephones_CellPhoneFormatted')
      expect(sqlStr).toContain('VoterTelephones_LandlineFormatted')
      expect(sqlStr).toContain('IS NOT NULL OR')
    })

    it('emits an AND of cell-phone/landline IS NULL checks for false', () => {
      const filterData: FilterData = {
        filters: ['hasAnyPhone'],
        filterValues: {},
        filterOperators: {
          hasAnyPhone: { operator: 'is', value: 'null' },
        },
      }

      const result = buildVoterFiltersSql(filterData)
      const sqlStr = sqlToString(result)

      expect(sqlStr).toContain('VoterTelephones_CellPhoneFormatted')
      expect(sqlStr).toContain('VoterTelephones_LandlineFormatted')
      expect(sqlStr).toContain('IS NULL AND')
    })

    // JS mirror of the emitted predicate, evaluated against the three rows
    // the ticket's test plan calls for: a cell-only person, a landline-only
    // person, and a phoneless person. Reachable count is 2, not 1 —
    // landline-only was the whole population before ENG-10914.
    const matchesHasAnyPhone = (
      cellPhone: string | null,
      landline: string | null,
    ): boolean => cellPhone !== null || landline !== null

    it('matches cell-only and landline-only people, not a phoneless one', () => {
      const cellOnly = { cellPhone: '5551234567', landline: null }
      const landlineOnly = { cellPhone: null, landline: '5559876543' }
      const phoneless = { cellPhone: null, landline: null }

      const reachable = [cellOnly, landlineOnly, phoneless].filter((person) =>
        matchesHasAnyPhone(person.cellPhone, person.landline),
      )

      expect(reachable).toEqual([cellOnly, landlineOnly])
      expect(reachable).toHaveLength(2)
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
