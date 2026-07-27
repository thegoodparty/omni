import type { Person } from '@goodparty_org/contracts'

// Single source of truth reconciling how people-api DISPLAYS a person's
// political party (mapPoliticalParty in transformToPersonOutput.util.ts) with
// how it FILTERS on it (buildPoliticalPartyFilter in filters.sql.utils.ts).
//
// The raw L2 `Parties_Description` column is a free-text party label. The
// display classifier reduces it to a canonical party via CASE-INSENSITIVE
// SUBSTRING matching with a fixed precedence; the filter must select exactly
// the rows that classify to the chosen canonical party. Deriving both from
// this one ordered table keeps them from drifting.
//
// PRECEDENCE: rules are evaluated top-to-bottom and the FIRST party whose any
// token is a case-insensitive substring wins. This order is lifted verbatim
// from the historical mapPoliticalParty if-chain and must not be reordered
// without a matching product decision (e.g. "Independent Democrat" contains
// "democrat", so it classifies as Democratic today — see PR deferred items).

// Canonical parties the display classifier can emit. Mirrors the
// `politicalParty` enum in @goodparty_org/contracts' PersonSchema.
export type CanonicalParty = NonNullable<Person['politicalParty']>

// Party a non-null, non-empty value falls back to when it matches no rule,
// and the value a null/blank `Parties_Description` maps to. Both are 'Other'
// in the current display logic (`if (!value) return 'Other'` + trailing
// `return 'Other'`).
export const POLITICAL_PARTY_FALLBACK = 'Other' satisfies CanonicalParty

export type PoliticalPartyRule = {
  // Canonical party this rule resolves to. 'Other' is intentionally
  // excluded: it is the fallback, never a positively-matched rule.
  readonly party: Exclude<CanonicalParty, typeof POLITICAL_PARTY_FALLBACK>
  // Case-insensitive substrings; a value matches the rule if it contains ANY
  // of them (mirrors the `||`-chained `.includes()` calls in the classifier).
  readonly substrings: readonly string[]
}

// Ordered precedence table — DO NOT REORDER (see note above).
export const POLITICAL_PARTY_RULES: readonly PoliticalPartyRule[] = [
  // v.includes('democratic') || v.includes('democrat')
  { party: 'Democratic', substrings: ['democratic', 'democrat'] },
  // v.includes('republican')
  { party: 'Republican', substrings: ['republican'] },
  // v.includes('independent') || v.includes('declined to state')
  //   || v.includes('non-partisan')
  {
    party: 'Independent',
    substrings: ['independent', 'declined to state', 'non-partisan'],
  },
] as const

// Canonical parties that have positive substring rules, in precedence order.
export const RULED_POLITICAL_PARTIES = POLITICAL_PARTY_RULES.map(
  (rule) => rule.party,
)

// Classify a raw `Parties_Description` value exactly as the display path
// does. This is the shared implementation mapPoliticalParty delegates to, so
// display output is guaranteed identical to the historical inline logic.
export const classifyPoliticalParty = (
  value: string | null | undefined,
): CanonicalParty => {
  if (!value) return POLITICAL_PARTY_FALLBACK
  const v = value.toLowerCase()
  for (const rule of POLITICAL_PARTY_RULES) {
    if (rule.substrings.some((substring) => v.includes(substring))) {
      return rule.party
    }
  }
  return POLITICAL_PARTY_FALLBACK
}
