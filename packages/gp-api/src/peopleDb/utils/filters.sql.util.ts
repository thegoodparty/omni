import { type IdOverrides } from '@goodparty_org/contracts'
import { Prisma } from '../../generated/people-prisma'
import { FilterData } from '../schemas/filters.schema'
import { FilterOperator } from '../schemas/filters.schema.utils'
import {
  POLITICAL_PARTY_RULES,
  RULED_POLITICAL_PARTIES,
  type PoliticalPartyRule,
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
    }

    if (sql) {
      andClauses.push(sql)
    }
  }

  if (andClauses.length === 0) return null
  return Prisma.sql`${Prisma.join(andClauses, ' AND ')}`
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
  homeowner: (value: string): string | null => {
    switch (value) {
      case 'Yes':
        return 'Home Owner'
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

// Filter-side sentinel for "no party on file". The display enum has no
// 'Unknown' (it folds null/blank into 'Other'); the filter enum exposes
// 'Unknown' for the null/blank rows. Reconciling the enum-vs-display structural
// mismatch (and a first-class 'Other' filter value) is a deferred product
// decision — this PR only makes the filter agree with CURRENT display.
const POLITICAL_PARTY_UNKNOWN = 'Unknown'

// (Parties_Description IS NULL OR Parties_Description = '') — the raw values
// mapPoliticalParty treats as falsy via `if (!value)`, which display classifies
// as 'Other'. The filter surfaces these as the 'Unknown' selection.
const buildPartyUnknownPredicate = (): Prisma.Sql =>
  Prisma.sql`(v."Parties_Description" IS NULL OR v."Parties_Description" = '')`

// (ILIKE '%a%' OR ILIKE '%b%' ...) for one rule's substrings — case-insensitive
// to mirror the classifier's `.toLowerCase().includes(...)`. The substrings are
// hardcoded rule tokens (never user input) and carry no LIKE wildcards, yet are
// still bound as parameters so no part of the payload is interpolated.
const buildPartyMatchPredicate = (rule: PoliticalPartyRule): Prisma.Sql => {
  const clauses = rule.substrings.map(
    (substring) =>
      Prisma.sql`v."Parties_Description" ILIKE ${`%${substring}%`}`,
  )
  return Prisma.sql`(${Prisma.join(clauses, ' OR ')})`
}

// Rows that classify to `party`: they must match `party`'s substrings AND NOT
// match any HIGHER-precedence party's substrings, mirroring the classifier's
// first-match-wins order. So a value containing both "democrat" and
// "independent" is returned by a Democratic filter but not an Independent one —
// exactly as display shows it.
const buildRuledPartyPredicate = (
  party: (typeof RULED_POLITICAL_PARTIES)[number],
): Prisma.Sql => {
  const clauses: Prisma.Sql[] = []
  for (const rule of POLITICAL_PARTY_RULES) {
    if (rule.party === party) {
      clauses.unshift(buildPartyMatchPredicate(rule))
      break
    }
    // Higher-precedence party seen before `party`: exclude its matches so a
    // row that would classify to it isn't also returned here.
    clauses.push(Prisma.sql`NOT ${buildPartyMatchPredicate(rule)}`)
  }
  return Prisma.sql`(${Prisma.join(clauses, ' AND ')})`
}

// One selected party value -> its predicate. Ruled parties use precedence-aware
// substring matching; 'Unknown' uses the null/blank predicate. Values outside
// the enum are ignored (the schema already constrains the input — defensive).
const buildPartyValuePredicate = (value: string): Prisma.Sql | null => {
  if (value === POLITICAL_PARTY_UNKNOWN) return buildPartyUnknownPredicate()
  if ((RULED_POLITICAL_PARTIES as readonly string[]).includes(value)) {
    // The `includes` check above confirms membership at runtime; TS can't
    // narrow a plain `string` to the literal union from an `Array#includes`
    // call.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const ruledParty = value as (typeof RULED_POLITICAL_PARTIES)[number]
    return buildRuledPartyPredicate(ruledParty)
  }
  return null
}

// Selects rows whose Parties_Description would DISPLAY as the requested
// party/parties. Replaces the previous exact-equality mapping, which
// under-matched every substring-classified row (e.g. "Citizens Republican").
// Multi-select ORs the per-party predicates; Unknown contributes the
// null/blank predicate.
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
  mapValue: (value: string) => string | null,
): Prisma.Sql | null => {
  if (!op) return null

  if (op.operator === 'eq' && op.value) {
    const mappedValue = mapValue(String(op.value))
    if (mappedValue === null) {
      return Prisma.sql`v."${Prisma.raw(fieldName)}" IS NULL`
    }
    return buildFieldFilter(fieldName, { ...op, value: mappedValue })
  }

  if (op.operator === 'in' && op.values && op.values.length > 0) {
    // FilterOperator.values is string[] | number[]; every mapped field this
    // is called for (gender, homeowner, etc.) is string-valued.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const originalValues = op.values as string[]
    const mappedValues = originalValues
      .map(mapValue)
      .filter((v): v is string => v !== null)
    const hasNull = originalValues.some((v) => mapValue(v) === null)

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
