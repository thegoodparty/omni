import type { Person } from '@goodparty_org/contracts'

// Single source of truth reconciling how a person's political party is
// DISPLAYED (mapPoliticalParty in transformToPersonOutput.util.ts) with how it
// is FILTERED (buildPoliticalPartyFilter in
// databricks/databricksVoterSql.util.ts).
//
// `Parties_Description` is a free-text L2 column, but >98% of ~218M rows carry
// one of a handful of exact values. We classify by EXACT, case- and
// spelling-sensitive match against those values so the SQL filter uses `=`/`IN`
// on the `Parties_Description` btree index instead of a non-sargable
// `ILIKE '%x%'` substring scan. Everything not in a set below — null/blank and
// the long tail of minor parties (Libertarian, Green, …) — is 'Other'.

export type CanonicalParty = NonNullable<Person['politicalParty']>

// The bucket for a value matching no exact set, and for null/blank.
export const POLITICAL_PARTY_OTHER = 'Other' satisfies CanonicalParty

export type RuledParty = Exclude<CanonicalParty, typeof POLITICAL_PARTY_OTHER>

// Exact `Parties_Description` values per canonical party, spelled and cased as
// stored in L2. Editing these changes display and filter results in sync.
//
// These are the empirically dominant values, not a guess — measured against
// databricks `goodparty_data_catalog.dbt.m_people_api__voter` (~218M rows,
// 2026-07). The five listed values cover 98.6% of all rows:
//   Democratic 37.9% · Republican 31.9% · Non-Partisan 27.7%
//   American Independent 0.52% · Registered Independent 0.49%
//   Declined to State 0.17%
// The remaining ~1.4% is the minor-party long tail (Libertarian, Green,
// Conservative, Independence, …) plus a literal "Unknown" — all intentionally
// 'Other'. Notes on the independent labels:
//   - "Non-Partisan" is L2's single normalized label for unaffiliated voters
//     in all 50 states — CA "No Party Preference", "undeclared", etc. are
//     already folded into it upstream, so no per-state variants are needed.
//   - "Declined to State" is New Mexico's distinct unaffiliated label (370k
//     rows); without it every NM independent would fall into 'Other'.
// Re-run the GROUP BY on that table before adding a value — a state-specific
// label can be <1% nationally but ~100% within one pruned partition.
export const POLITICAL_PARTY_EXACT_VALUES = {
  Democratic: ['Democratic'],
  Republican: ['Republican'],
  Independent: [
    'Non-Partisan',
    'American Independent',
    'Registered Independent',
    'Declined to State',
  ],
} as const satisfies Record<RuledParty, readonly string[]>

// Stable order — drives packEncoder byte assignment.
export const RULED_POLITICAL_PARTIES: readonly RuledParty[] = [
  'Democratic',
  'Republican',
  'Independent',
]

// Flat union of every exact value mapping to a ruled party. The 'Other' filter
// is the negation of this set (plus null/blank).
export const ALL_KNOWN_PARTY_VALUES: readonly string[] =
  RULED_POLITICAL_PARTIES.flatMap(
    (party) => POLITICAL_PARTY_EXACT_VALUES[party],
  )

const VALUE_TO_PARTY = new Map<string, RuledParty>(
  RULED_POLITICAL_PARTIES.flatMap((party) =>
    POLITICAL_PARTY_EXACT_VALUES[party].map((value) => [value, party] as const),
  ),
)

// Classify a raw `Parties_Description` exactly as the display path does — the
// shared implementation mapPoliticalParty delegates to.
export const classifyPoliticalParty = (
  value: string | null | undefined,
): CanonicalParty =>
  value
    ? (VALUE_TO_PARTY.get(value) ?? POLITICAL_PARTY_OTHER)
    : POLITICAL_PARTY_OTHER
