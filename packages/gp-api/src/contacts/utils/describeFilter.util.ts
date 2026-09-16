import { decodePrecinctPair } from '@goodparty_org/contracts'
import { VoterFileFilter } from '../../generated/prisma'
import {
  FILTER_DIMENSIONS,
  type FilterDimension,
} from '../filterDimensions.catalog'

// A saved filter, in words. Ported from the webapp's `buildFilterSummary`
// (crm/lists/ListFilterSummary.tsx), which produces exactly this sentence for
// the list detail sheet and cannot be imported across packages.
//
// The two halves of the port land differently. The clause assembly and
// `joinAsSentence` are the webapp's, transcribed. The label vocabulary is NOT:
// the webapp reads `filters.config.ts`, and gp-api's equivalent is
// `FILTER_DIMENSIONS`, which already exists, is already LLM-facing, and
// already knows which dimensions a Serve org may express. Reading the catalog
// rather than a second copy of the labels is the whole reason this belongs
// server-side.
//
// Synchronous and pure, like its source, so it is cheap to unit test per
// clause combination. One consequence: `activityConditions` is a relation
// rather than a column, so it is not described here — the webapp's version
// reads it off an already-loaded segment response. Nothing that calls this
// needs it (it is excluded from the talking-points allowlist below anyway),
// and loading it would make this async for a clause no caller wants.

// Past this the sentence stops naming individual precincts and reports a
// count instead — a district can hold hundreds, and this is one line.
const MAX_LISTED_PRECINCTS = 5

const isTrue = (value: unknown): value is true => value === true

// Two functions, because two kinds of string arrive here.
//
// Catalog labels are already cased the way product wants them read — 'Voter
// Likelihood', 'Political Party', 'Level of Education' — so only the first
// character is ours to touch. Lowercasing the tail mangles every multi-word
// label in the catalog, and these strings go both to the list detail sheet
// and straight into an LLM prompt.
const capitalizeFirst = (label: string): string =>
  label.charAt(0).toUpperCase() + label.slice(1)

// County names arrive raw from the voter file, in whatever case it stored
// them ('travis', 'TRAVIS'), so here the tail genuinely needs normalizing.
const sentenceCase = (name: string): string =>
  name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()

// The webapp's sentence style, transcribed: "Age 18-24 or 25-34, Language
// Spanish, and Support status Supporter."
const joinAsSentence = (clauses: string[]): string => {
  if (clauses.length === 1) return `${clauses[0]}.`
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}.`
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}.`
}

// Read-only additions to the catalog's vocabulary — deliberately NOT merged
// into FILTER_DIMENSIONS.
//
// That catalog is what `describe_filter_dimensions` advertises to the Chief of
// Staff assistant as WRITABLE, and every entry in it carries a complete value
// vocabulary. These do not qualify: two are retired spellings that only exist
// on rows saved before a rename, and precinct values are enumerated per
// district by an endpoint (a precinct number is unique only within its county,
// and one district can hold 579 of them). Advertising any of them would invite
// the assistant to write a filter nobody can satisfy.
//
// But a saved row can still carry them, and a description that silently drops
// a dimension the list actually filters on describes a narrower audience than
// the list holds — which, for the talking points below, means writing to the
// wrong room.
// Keyed by the retired column; `dimension` is the catalog key the value would
// belong to today, so the allowlist below governs these exactly as it governs
// their current spellings.
const LEGACY_VALUE_LABELS: Record<
  string,
  { dimension: string; label: string; value: string }
> = {
  // Retired by ENG-10752's mutually-exclusive age split. Without these an
  // age-only legacy list describes as unfiltered.
  age18_25: { dimension: 'age', label: 'Age', value: '18-25' },
  age25_35: { dimension: 'age', label: 'Age', value: '25-35' },
  age35_50: { dimension: 'age', label: 'Age', value: '35-50' },
  age50Plus: { dimension: 'age', label: 'Age', value: '50+' },
  // Folded into `homeownerYes` by ENG-10947, still accepted from saved rows.
  homeownerLikely: {
    dimension: 'homeowner',
    label: 'Homeownership',
    value: 'Homeowner',
  },
}

// In the column set but absent from the catalog, so the catalog loop below
// cannot reach them.
const REGISTERED_VOTER_LABELS: Record<string, string> = {
  registeredVoterTrue: 'Yes',
  registeredVoterFalse: 'No',
  registeredVoterUnknown: 'Unknown',
}

// Dimensions that may steer WHICH of the candidate's own priorities to lead
// with at a door. Everything absent from this list is excluded on purpose, in
// three groups:
//
//  - `party`, and the two electoral-behaviour models beside it (`ideology`,
//    `independentAffinity`). Every compose prompt in this product ends with
//    "Stay strictly non-partisan. No party labels, no attacks." Passing a
//    party label in would hand the model that label and the rule forbidding it
//    in the same breath.
//  - Targeting mechanics with no conversational content: voter likelihood,
//    prior contacts made, support status, previous activity, phone presence,
//    registration. A canvasser cannot say any of them out loud, and a model
//    handed them will try.
//  - `ethnicity`. It is modeled rather than observed, and unlike the
//    life-circumstance dimensions here it maps to no local issue without going
//    through a stereotype. Left out pending a product decision rather than
//    included with a warning attached.
//
// What survives is life circumstance, which is what actually decides whether a
// candidate leads with schools, property taxes, or transit. The prompt still
// forbids ASSERTING any of it about the person who opened the door — see the
// Context rule in outreachDoorKnockingGeneration.service.ts. This list selects
// and orders; it never licenses a claim.
const TALKING_POINT_DIMENSION_KEYS: readonly string[] = [
  'age',
  'gender',
  'homeowner',
  'children',
  'veteran',
  'businessOwner',
  'education',
  'maritalStatus',
  'languageCodes',
  'incomeRanges',
  'income',
]

const dimensionApplies = (
  dimension: FilterDimension,
  isServe: boolean,
): boolean =>
  dimension.modes === 'both' || dimension.modes === (isServe ? 'serve' : 'win')

// A dimension's label and the values the row selected under it, kept apart
// from the rendered string so the legacy spellings below can merge into the
// same clause instead of adding a second one for the same label.
interface LabelledValues {
  label: string
  values: string[]
}

// One group per dimension the row actually sets, in catalog order.
const catalogClauses = (
  filter: Partial<VoterFileFilter>,
  isServe: boolean,
  allowed: readonly string[] | null,
): LabelledValues[] => {
  const clauses: LabelledValues[] = []
  const row = filter as Record<string, unknown>

  for (const dimension of FILTER_DIMENSIONS) {
    if (allowed && !allowed.includes(dimension.key)) continue
    // The same Win/Serve split the catalog already encodes, so a Serve org
    // cannot be described by a dimension it is forbidden to filter on.
    if (!dimensionApplies(dimension, isServe)) continue

    if (dimension.kind === 'boolean-group') {
      // Each value key is its own boolean column set to true.
      const matched = dimension.values.filter((value) => isTrue(row[value.key]))
      if (matched.length > 0) {
        clauses.push({
          label: dimension.label,
          values: matched.map((value) => value.label),
        })
      }
      continue
    }

    if (dimension.kind === 'multi-value') {
      // The dimension key is an array column; each entry is one of its values.
      // `String(entry)` rather than asserting the array's element type: the
      // row is read as `unknown` and a saved column could hold anything, so
      // the fallback below has to survive a non-string rather than trust one.
      const raw: unknown = row[dimension.key]
      const selected = Array.isArray(raw) ? raw : []
      if (selected.length > 0) {
        const labels = selected.map(
          (entry) =>
            dimension.values.find((value) => value.key === entry)?.label ??
            String(entry),
        )
        clauses.push({ label: dimension.label, values: labels })
      }
      continue
    }

    // 'activity' — a relation, not a column. See the header note.
  }

  return clauses
}

const legacyClauses = (
  filter: Partial<VoterFileFilter>,
  allowed: readonly string[] | null,
): LabelledValues[] => {
  const row = filter as Record<string, unknown>
  const byLabel = new Map<string, string[]>()

  for (const [key, { dimension, label, value }] of Object.entries(
    LEGACY_VALUE_LABELS,
  )) {
    if (allowed && !allowed.includes(dimension)) continue
    if (!isTrue(row[key])) continue
    byLabel.set(label, [...(byLabel.get(label) ?? []), value])
  }

  return [...byLabel.entries()].map(([label, values]) => ({ label, values }))
}

// One clause per label, not one per source.
//
// A row can hold both spellings of the same dimension — a list saved before
// ENG-10752's age split and edited after it carries `age35_50` alongside
// `age65Plus` — and rendering each source on its own produced "Age 65+ and
// Age 35-50.", which reads as two competing filters rather than one bucket
// list. Merging is what the webapp's `buildFilterSummary` does by unioning
// `legacyAgeOptions` into the age field's own options before matching, and
// this is the same result reached from the other direction. Dropping the
// legacy values instead would be worse than duplicating them: the row really
// does select that range, and the sentence is meant to say what the list is.
//
// Catalog order is preserved, and a value present in both spellings is
// stated once.
const renderClauses = (groups: LabelledValues[]): string[] => {
  const byLabel = new Map<string, string[]>()

  for (const { label, values } of groups) {
    const merged = byLabel.get(label) ?? []
    for (const value of values) {
      if (!merged.includes(value)) merged.push(value)
    }
    byLabel.set(label, merged)
  }

  return [...byLabel.entries()].map(
    ([label, values]) => `${capitalizeFirst(label)} ${values.join(' or ')}`,
  )
}

/**
 * Every dimension a saved filter sets, as one plain sentence.
 *
 * Returns the "no filters" sentence rather than an empty string when the row
 * expresses nothing, matching the webapp's list detail sheet — "unfiltered" is
 * a fact about the list, not the absence of one.
 */
export const describeFilter = (
  filter: Partial<VoterFileFilter>,
  { isServe }: { isServe: boolean },
): string => {
  const row = filter as Record<string, unknown>
  const clauses = renderClauses([
    ...catalogClauses(filter, isServe, null),
    ...legacyClauses(filter, null),
  ])

  const registered = Object.entries(REGISTERED_VOTER_LABELS)
    .filter(([key]) => isTrue(row[key]))
    .map(([, label]) => label)
  if (registered.length > 0) {
    clauses.push(`Registered voter ${registered.join(' or ')}`)
  }

  // Enumerated per district, so there is no label map to look values up in:
  // the encoded `county|precinct` pair is decoded for display. Win-only, like
  // the webapp's version — a Serve org's constituent file is not districted
  // this way.
  const precincts =
    !isServe && Array.isArray(filter.precincts) ? filter.precincts : []
  if (precincts.length > 0) {
    const labels = precincts.map((encoded) => {
      const { county, precinct } = decodePrecinctPair(encoded)
      return precinct === ''
        ? `${sentenceCase(county)} (no precinct)`
        : `${sentenceCase(county)} ${precinct}`
    })
    clauses.push(
      labels.length > MAX_LISTED_PRECINCTS
        ? `in ${labels.length} precincts`
        : `in precinct${labels.length === 1 ? '' : 's'} ${labels.join(' or ')}`,
    )
  }

  if (typeof filter.search === 'string' && filter.search.trim()) {
    clauses.push(`matching search "${filter.search.trim()}"`)
  }

  if (clauses.length === 0) {
    return 'Everyone in your file — no filters applied.'
  }

  return joinAsSentence(clauses)
}

/**
 * The same sentence, narrowed to the dimensions that may steer which of the
 * candidate's own priorities to lead with at a door.
 *
 * Null — never a sentence saying so — when nothing survives the allowlist. A
 * list cut only by party and voter likelihood has plenty of filters and
 * nothing this feature is allowed to say about them, and "no filters applied"
 * would be a lie the model would then write around.
 *
 * @see TALKING_POINT_DIMENSION_KEYS for what is excluded, and why.
 */
export const describeFilterForTalkingPoints = (
  filter: Partial<VoterFileFilter>,
  { isServe }: { isServe: boolean },
): string | null => {
  const clauses = renderClauses([
    ...catalogClauses(filter, isServe, TALKING_POINT_DIMENSION_KEYS),
    // Age and homeownership are both on the allowlist, so their retired
    // spellings come through with them — a list saved before ENG-10752 would
    // otherwise be described as having no audience at all. Both merge into
    // the dimension's own clause rather than adding a second one.
    ...legacyClauses(filter, TALKING_POINT_DIMENSION_KEYS),
  ])

  return clauses.length > 0 ? joinAsSentence(clauses) : null
}
