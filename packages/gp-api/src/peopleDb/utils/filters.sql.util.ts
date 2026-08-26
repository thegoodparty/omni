import { decodePrecinctPair, type IdOverrides } from '@goodparty_org/contracts'
import { Prisma } from '../../generated/people-prisma'
import { FilterData } from '../schemas/filters.schema'
import { FilterOperator } from '../schemas/filters.schema.utils'
import {
  ALL_KNOWN_PARTY_VALUES,
  POLITICAL_PARTY_EXACT_VALUES,
  POLITICAL_PARTY_OTHER,
  RULED_POLITICAL_PARTIES,
  type RuledParty,
} from './politicalParty.rules'

const hasIdOverrides = (
  idOverrides: IdOverrides | undefined,
): idOverrides is IdOverrides =>
  !!idOverrides &&
  ((idOverrides.include?.length ?? 0) > 0 ||
    (idOverrides.exclude?.length ?? 0) > 0)

// Override-aware Voter Likelihood filtering (ENG-10838): wraps ONLY the
// voterStatus clause in an OR against the override include/exclude id sets —
// never the whole filter conjunction. `buildVoterFiltersSql` AND-joins this
// composite alongside every other filter's clause, so age/party/etc still
// apply to an override-included person; only the voterStatus dimension
// itself is override-aware. `baseClause` falls back to TRUE so a caller that
// (incorrectly) sends idOverrides without a voterStatus filter still gets
// well-formed SQL rather than a broken composite.
const composeIdOverridesClause = (
  baseClause: Prisma.Sql | null,
  idOverrides: IdOverrides,
): Prisma.Sql => {
  const base = baseClause ?? Prisma.sql`TRUE`
  const scoped = idOverrides.exclude?.length
    ? Prisma.sql`(${base} AND v."id" != ALL(${idOverrides.exclude}::uuid[]))`
    : base
  return idOverrides.include?.length
    ? Prisma.sql`(${scoped} OR v."id" = ANY(${idOverrides.include}::uuid[]))`
    : scoped
}

// ENG-10839: contacts-made's mixed "0 + a non-zero bucket" selection needs
// an OR-of-id-sets clause with no people-api filter key to scope against
// (unlike voterStatus above) — gp-api resolves it to a plain include/exclude
// pair over the Voter PK with nothing else to AND against, so this composes
// unconditionally (composeIdOverridesClause's baseClause falls back to TRUE)
// as its own top-level AND clause, independent of whichever `filters` keys
// are present. Omitted -> no clause added, SQL byte-identical to before.
export const buildVoterFiltersSql = (
  filterData: FilterData,
  idOverrides?: IdOverrides,
  contactsMadeIdOverrides?: IdOverrides,
): Prisma.Sql | null => {
  const { filters, filterOperators } = filterData
  const andClauses: Prisma.Sql[] = []

  if (hasIdOverrides(contactsMadeIdOverrides)) {
    andClauses.push(composeIdOverridesClause(null, contactsMadeIdOverrides))
  }

  for (const filter of filters) {
    const op = filterOperators[filter]
    let sql: Prisma.Sql | null = null

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
          'Marital_Status',
          op,
          VALUE_MAPPERS.maritalStatus,
        )
        break
      case 'veteranStatus':
        sql = buildMappedFieldFilter(
          'Veteran_Status',
          op,
          VALUE_MAPPERS.veteranStatus,
        )
        break
      case 'educationLevel':
        sql = buildMappedFieldFilter(
          'Education_Of_Person',
          op,
          VALUE_MAPPERS.educationLevel,
        )
        break
      case 'ethnicity':
        sql = buildMappedFieldFilter(
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
          'Presence_Of_Children',
          op,
          VALUE_MAPPERS.presenceOfChildren,
        )
        break
      case 'homeowner':
        sql = buildMappedFieldFilter(
          'Homeowner_Probability_Model',
          op,
          VALUE_MAPPERS.homeowner,
        )
        break
      case 'language':
        sql = buildLanguageFilter(op)
        break
      case 'estimatedIncomeAmountInt':
        sql = buildNumericFilter('Estimated_Income_Amount_Int', op)
        break
      case 'voterStatus': {
        const voterStatusClause = buildFieldFilter('Voter_Status', op)
        sql = hasIdOverrides(idOverrides)
          ? composeIdOverridesClause(voterStatusClause, idOverrides)
          : voterStatusClause
        break
      }
      case 'politicalParty':
        sql = buildPoliticalPartyFilter(op)
        break
      case 'gender':
        sql = buildMappedFieldFilter('Gender', op, VALUE_MAPPERS.gender)
        break
      case 'ageInt':
        sql = buildNumericFilter('Age_Int', op)
        break
      case 'precinct':
        sql = buildPrecinctFilter(op)
        break
    }

    if (sql) {
      andClauses.push(sql)
    }
  }

  if (andClauses.length === 0) return null
  return Prisma.sql`${Prisma.join(andClauses, ' AND ')}`
}

// Mirrors buildPrecinctFilter in the Databricks builder. Both stores need
// this branch: PeopleFiltersSchema deliberately strips unknown keys rather
// than rejecting them, so a Databricks-only implementation would let the
// filter vanish whenever a read is served from Postgres — silently WIDENING
// a saved audience rather than failing loudly.
const buildPrecinctFilter = (op?: FilterOperator): Prisma.Sql | null => {
  if (!op || op.operator !== 'in' || !op.values?.length) return null

  const counties: string[] = []
  const precincts: string[] = []
  const unknownCounties: string[] = []

  for (const value of op.values) {
    const { county, precinct } = decodePrecinctPair(String(value))
    if (precinct === '') {
      unknownCounties.push(county)
      continue
    }
    counties.push(county)
    precincts.push(precinct)
  }

  const clauses: Prisma.Sql[] = []
  // Paired arrays unnested into a tuple set rather than a per-pair OR chain:
  // the pair list can reach the 5,000-value cap, and one bound array per side
  // stays clear of PostgreSQL's 65,535 bind-parameter limit.
  if (counties.length > 0) {
    clauses.push(
      Prisma.sql`(v."County", v."Precinct") IN (
        SELECT * FROM unnest(${counties}::text[], ${precincts}::text[])
      )`,
    )
  }
  if (unknownCounties.length > 0) {
    clauses.push(
      Prisma.sql`(v."County" = ANY(${unknownCounties}::text[]) AND v."Precinct" IS NULL)`,
    )
  }
  if (clauses.length === 0) return null
  if (clauses.length === 1) return clauses[0]!
  return Prisma.sql`(${Prisma.join(clauses, ' OR ')})`
}

export const VALUE_MAPPERS = {
  ethnicity: (value: string): string | null => {
    switch (value) {
      case 'Asian':
        return 'East and South Asian'
      case 'European':
        return 'European'
      case 'Hispanic':
        return 'Hispanic and Portuguese'
      case 'African American':
        return 'Likely African-American'
      case 'Other':
        return 'Other'
      case 'Unknown':
        return null
      default:
        return value
    }
  },
  presenceOfChildren: (value: string): string | null => {
    switch (value) {
      case 'Yes':
        return 'Y'
      case 'No':
        return 'N'
      case 'Unknown':
        return null
      default:
        return value
    }
  },
  // 'Yes' is the wire value behind the "Homeowner" pill (ENG-10947) and
  // folds Probable Home Owner in, since the product taxonomy collapsed
  // Yes/Likely into one Homeowner bucket. 'Likely' is kept, unfolded, only
  // for saved filters persisted before the collapse (homeownerLikely).
  homeowner: (value: string): string | string[] | null => {
    switch (value) {
      case 'Yes':
        return ['Home Owner', 'Probable Home Owner']
      case 'Likely':
        return 'Probable Home Owner'
      case 'No':
        return 'Renter'
      case 'Unknown':
        return null
      default:
        return value
    }
  },
  educationLevel: (value: string): string | null => {
    switch (value) {
      case 'None':
        return 'Did Not Complete High School Likely'
      case 'High School Diploma':
        return 'Completed High School Likely'
      case 'Technical School':
        return 'Attended Vocational/Technical School Likely'
      case 'Some College':
        return 'Attended But Did Not Complete College Likely'
      case 'College Degree':
        return 'Completed College Likely'
      case 'Graduate Degree':
        return 'Completed Graduate School Likely'
      case 'Unknown':
        return null
      default:
        return value
    }
  },
  gender: (value: string): string | null => {
    switch (value) {
      case 'M':
        return 'M'
      case 'F':
        return 'F'
      case 'Unknown':
        return null
      default:
        return value
    }
  },
  veteranStatus: (value: string): string | null => {
    switch (value) {
      case 'Yes':
        return 'Yes'
      case 'Unknown':
        return null
      default:
        return value
    }
  },
  maritalStatus: (value: string): string | null => {
    switch (value) {
      case 'Inferred Married':
        return 'Inferred Married'
      case 'Inferred Single':
        return 'Inferred Single'
      case 'Married':
        return 'Married'
      case 'Single':
        return 'Single'
      case 'Unknown':
        return null
      default:
        return value
    }
  },
} as const

const buildBusinessOwnerFilter = (
  op: FilterOperator | undefined,
): Prisma.Sql | null => {
  if (!op) return null

  if (op.operator === 'eq' && op.value === 'Yes') {
    return Prisma.sql`v."Business_Owner" IS NOT NULL`
  } else if (op.operator === 'eq' && op.value === 'Unknown') {
    return Prisma.sql`v."Business_Owner" IS NULL`
  } else if (op.operator === 'in' && op.values && op.values.length > 0) {
    // FilterOperator.values is string[] | number[]; businessOwner is always
    // string-valued (a length check above only confirms it's non-empty).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const values = op.values as string[]
    const hasYes = values.includes('Yes')
    const hasUnknown = values.includes('Unknown')

    if (hasYes && hasUnknown) {
      return null
    } else if (hasYes) {
      return Prisma.sql`v."Business_Owner" IS NOT NULL`
    } else if (hasUnknown) {
      return Prisma.sql`v."Business_Owner" IS NULL`
    }
  } else if (op.operator === 'is' && op.value === 'not_null') {
    return Prisma.sql`v."Business_Owner" IS NOT NULL`
  } else if (op.operator === 'is' && op.value === 'null') {
    return Prisma.sql`v."Business_Owner" IS NULL`
  }

  return null
}

const buildLanguageFilter = (
  op: FilterOperator | undefined,
): Prisma.Sql | null => {
  if (!op) return null

  if (op.operator === 'is' && op.value === 'not_null') {
    return Prisma.sql`v."Language_Code" IS NOT NULL`
  } else if (op.operator === 'is' && op.value === 'null') {
    return Prisma.sql`v."Language_Code" IS NULL`
  }

  const languageValues =
    op.operator === 'in' && op.values
      ? // FilterOperator.values is string[] | number[]; language is
        // always string-valued.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (op.values as string[])
      : op.operator === 'eq' && op.value
        ? [String(op.value)]
        : []

  if (languageValues.length === 0) return null

  const hasEnglish = languageValues.includes('English')
  const hasSpanish = languageValues.includes('Spanish')
  const hasOther = languageValues.includes('Other')

  if (hasEnglish && hasSpanish && hasOther) {
    return null
  }
  const conditions: Prisma.Sql[] = []
  if (hasEnglish) {
    conditions.push(Prisma.sql`v."Language_Code" = 'English'`)
  }
  if (hasSpanish) {
    conditions.push(Prisma.sql`v."Language_Code" = 'Spanish'`)
  }
  if (hasOther) {
    conditions.push(
      Prisma.sql`(v."Language_Code" != ALL(ARRAY['English', 'Spanish']::text[]) OR v."Language_Code" IS NULL)`,
    )
  }

  return Prisma.sql`(${Prisma.join(conditions, ' OR ')})`
}

// (Parties_Description IS NULL OR Parties_Description NOT IN (<known values>))
// — the display 'Other' bucket: null/blank plus every value that classifies to
// no ruled party. The explicit IS NULL is required because `NOT IN` yields NULL
// (not TRUE) for null rows, which would otherwise drop them.
const buildPartyOtherPredicate = (): Prisma.Sql =>
  Prisma.sql`(v."Parties_Description" IS NULL OR v."Parties_Description" NOT IN (${Prisma.join(
    [...ALL_KNOWN_PARTY_VALUES],
  )}))`

// v."Parties_Description" IN (<exact values>) for one ruled party. Values are
// bound as parameters and case/spelling-exact, so the planner can use the
// Parties_Description btree index instead of a substring scan.
const buildRuledPartyPredicate = (party: RuledParty): Prisma.Sql =>
  Prisma.sql`v."Parties_Description" IN (${Prisma.join([
    ...POLITICAL_PARTY_EXACT_VALUES[party],
  ])})`

// One selected party value -> its predicate. Ruled parties use exact-value IN
// matching; 'Other' uses the null/blank-or-unknown-value predicate. Values
// outside the enum are ignored (the schema already constrains the input).
const buildPartyValuePredicate = (value: string): Prisma.Sql | null => {
  if (value === POLITICAL_PARTY_OTHER) return buildPartyOtherPredicate()
  if ((RULED_POLITICAL_PARTIES as readonly string[]).includes(value)) {
    // The `includes` check above confirms membership at runtime; TS can't
    // narrow a plain `string` to the literal union from an `Array#includes`
    // call.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const ruledParty = value as RuledParty
    return buildRuledPartyPredicate(ruledParty)
  }
  return null
}

// Selects rows whose Parties_Description would DISPLAY as the requested
// party/parties (classifyPoliticalParty). Multi-select ORs the per-party
// predicates; Other contributes the null/blank-or-unknown-value predicate.
const buildPoliticalPartyFilter = (
  op: FilterOperator | undefined,
): Prisma.Sql | null => {
  if (!op) return null

  // `is not_null` / `is null` are column-presence checks, not canonical-party
  // selections — preserve the existing simple semantics.
  if (op.operator === 'is' && op.value === 'not_null') {
    return Prisma.sql`v."Parties_Description" IS NOT NULL`
  }
  if (op.operator === 'is' && op.value === 'null') {
    return Prisma.sql`v."Parties_Description" IS NULL`
  }

  const selected =
    op.operator === 'in' && op.values
      ? // FilterOperator.values is string[] | number[]; politicalParty is
        // always string-valued.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (op.values as string[])
      : op.operator === 'eq' && op.value !== undefined
        ? [String(op.value)]
        : []

  const predicates = selected
    .map(buildPartyValuePredicate)
    .filter((predicate): predicate is Prisma.Sql => predicate !== null)

  if (predicates.length === 0) return null

  return Prisma.sql`(${Prisma.join(predicates, ' OR ')})`
}

const buildBooleanFilter = (
  fieldName: string,
  op: FilterOperator | undefined,
): Prisma.Sql | null => {
  if (!op) return null
  if (op.operator === 'is' && op.value === 'not_null') {
    return Prisma.sql`v."${Prisma.raw(fieldName)}" IS NOT NULL`
  } else if (op.operator === 'is' && op.value === 'null') {
    return Prisma.sql`v."${Prisma.raw(fieldName)}" IS NULL`
  }
  return null
}

// phoneBanking reachability (ENG-10914): any phone number, not landline-only
// — cell OR landline non-null, matching the list builder's any-phone freeze.
const buildHasAnyPhoneFilter = (
  op: FilterOperator | undefined,
): Prisma.Sql | null => {
  if (!op) return null
  if (op.operator === 'is' && op.value === 'not_null') {
    return Prisma.sql`(v."VoterTelephones_CellPhoneFormatted" IS NOT NULL OR v."VoterTelephones_LandlineFormatted" IS NOT NULL)`
  } else if (op.operator === 'is' && op.value === 'null') {
    return Prisma.sql`(v."VoterTelephones_CellPhoneFormatted" IS NULL AND v."VoterTelephones_LandlineFormatted" IS NULL)`
  }
  return null
}

// Door-knocking eligibility (task 07): L2 stores a missing residence line as
// either NULL or '', so both true and false must check both to avoid
// misclassifying blank-string rows as "has an address".
const buildHasAddressFilter = (
  op: FilterOperator | undefined,
): Prisma.Sql | null => {
  if (!op) return null
  if (op.operator === 'is' && op.value === 'not_null') {
    return Prisma.sql`(v."Residence_Addresses_AddressLine" IS NOT NULL AND v."Residence_Addresses_AddressLine" != '')`
  } else if (op.operator === 'is' && op.value === 'null') {
    return Prisma.sql`(v."Residence_Addresses_AddressLine" IS NULL OR v."Residence_Addresses_AddressLine" = '')`
  }
  return null
}

// Person-id sets resolved upstream in gp-api (activity conditions, derived
// support status) — the whole set is bound as ONE array parameter (the
// `sample.service.ts` hashBuckets pattern), never one param per id, so the
// 100k schema cap stays clear of PostgreSQL's 65,535 bind-parameter limit.
const buildIdFilter = (op: FilterOperator | undefined): Prisma.Sql | null => {
  if (!op) return null
  if (
    (op.operator === 'in' || op.operator === 'notIn') &&
    op.values &&
    op.values.length > 0
  ) {
    // FilterOperator.values is string[] | number[]; id is always
    // uuid-string-valued.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const ids = op.values as string[]
    return op.operator === 'in'
      ? Prisma.sql`v."id" = ANY(${ids}::uuid[])`
      : Prisma.sql`v."id" != ALL(${ids}::uuid[])`
  }
  return null
}

const buildFieldFilter = (
  fieldName: string,
  op: FilterOperator | undefined,
): Prisma.Sql | null => {
  if (!op) return null
  if (op.operator === 'in' && op.values && op.values.length > 0) {
    return Prisma.sql`v."${Prisma.raw(fieldName)}" = ANY(ARRAY[${Prisma.join(
      op.values.map((f) => Prisma.sql`${String(f)}`),
      ', ',
    )}]::text[])`
  } else if (op.operator === 'eq' && op.value !== undefined) {
    return Prisma.sql`v."${Prisma.raw(fieldName)}" = ${String(op.value)}`
  } else if (op.operator === 'is' && op.value === 'not_null') {
    return Prisma.sql`v."${Prisma.raw(fieldName)}" IS NOT NULL`
  } else if (op.operator === 'is' && op.value === 'null') {
    return Prisma.sql`v."${Prisma.raw(fieldName)}" IS NULL`
  }
  return null
}

const buildNumericFilter = (
  fieldName: string,
  op: FilterOperator | undefined,
): Prisma.Sql | null => {
  if (!op) return null

  let baseSql: Prisma.Sql | null = null

  if (op.operator === 'in' && op.values && op.values.length > 0) {
    baseSql = Prisma.sql`v."${Prisma.raw(fieldName)}" = ANY(ARRAY[${Prisma.join(
      op.values.map((f) => Prisma.sql`${Number(f)}`),
      ', ',
    )}]::integer[])`
  } else if (op.operator === 'eq' && op.value !== undefined) {
    baseSql = Prisma.sql`v."${Prisma.raw(fieldName)}" = ${Number(op.value)}`
  } else if (
    op.operator === 'range' &&
    op.gte !== undefined &&
    op.lte !== undefined
  ) {
    baseSql = Prisma.sql`v."${Prisma.raw(fieldName)}" >= ${Number(op.gte)} AND v."${Prisma.raw(fieldName)}" <= ${Number(op.lte)}`
  } else if (op.operator === 'gte' && op.value !== undefined) {
    baseSql = Prisma.sql`v."${Prisma.raw(fieldName)}" >= ${Number(op.value)}`
  } else if (op.operator === 'lte' && op.value !== undefined) {
    baseSql = Prisma.sql`v."${Prisma.raw(fieldName)}" <= ${Number(op.value)}`
  } else if (op.operator === 'or' && op.orRanges) {
    const orClauses = op.orRanges
      .map((range) => {
        const hasGte = range.gte !== undefined && range.gte !== null
        const hasLte = range.lte !== undefined && range.lte !== null
        if (hasGte && hasLte) {
          return Prisma.sql`(v."${Prisma.raw(fieldName)}" >= ${Number(range.gte)} AND v."${Prisma.raw(fieldName)}" <= ${Number(range.lte)})`
        } else if (hasGte) {
          return Prisma.sql`v."${Prisma.raw(fieldName)}" >= ${Number(range.gte)}`
        } else if (hasLte) {
          return Prisma.sql`v."${Prisma.raw(fieldName)}" <= ${Number(range.lte)}`
        }
        return null
      })
      .filter((clause): clause is Prisma.Sql => clause !== null)

    if (orClauses.length > 0) {
      baseSql = Prisma.sql`(${Prisma.join(orClauses, ' OR ')})`
    } else if (op.includeNull) {
      return Prisma.sql`v."${Prisma.raw(fieldName)}" IS NULL`
    }
  } else if (op.operator === 'is' && op.value === 'not_null') {
    return Prisma.sql`v."${Prisma.raw(fieldName)}" IS NOT NULL`
  } else if (op.operator === 'is' && op.value === 'null') {
    return Prisma.sql`v."${Prisma.raw(fieldName)}" IS NULL`
  }

  if (baseSql && op.includeNull) {
    return Prisma.sql`(${baseSql} OR v."${Prisma.raw(fieldName)}" IS NULL)`
  }

  return baseSql
}

const buildMappedFieldFilter = (
  fieldName: string,
  op: FilterOperator | undefined,
  mapValue: (value: string) => string | string[] | null,
): Prisma.Sql | null => {
  if (!op) return null

  if (op.operator === 'eq' && op.value) {
    const mappedValue = mapValue(String(op.value))
    if (mappedValue === null) {
      return Prisma.sql`v."${Prisma.raw(fieldName)}" IS NULL`
    }
    // A one-to-many mapping (homeowner's 'Yes' folding in Probable Home
    // Owner) needs an `in` clause even though the caller asked `eq`.
    return Array.isArray(mappedValue)
      ? buildFieldFilter(fieldName, { operator: 'in', values: mappedValue })
      : buildFieldFilter(fieldName, { ...op, value: mappedValue })
  }

  if (op.operator === 'in' && op.values && op.values.length > 0) {
    // FilterOperator.values is string[] | number[]; every mapped field this
    // is called for (gender, homeowner, etc.) is string-valued.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const originalValues = op.values as string[]
    const mappedResults = originalValues.map(mapValue)
    const mappedValues = mappedResults.flatMap((v) =>
      v === null ? [] : Array.isArray(v) ? v : [v],
    )
    const hasNull = mappedResults.some((v) => v === null)

    if (hasNull && mappedValues.length > 0) {
      const sql = buildFieldFilter(fieldName, { ...op, values: mappedValues })
      if (sql) {
        return Prisma.sql`(${sql} OR v."${Prisma.raw(fieldName)}" IS NULL)`
      }
    } else if (hasNull) {
      return Prisma.sql`v."${Prisma.raw(fieldName)}" IS NULL`
    } else if (mappedValues.length > 0) {
      return buildFieldFilter(fieldName, { ...op, values: mappedValues })
    }
  }

  return buildFieldFilter(fieldName, op)
}
