import filterSections, { legacyAgeOptions } from '../../shared/filters.config'
import {
  ANY_PHONE_FIELD,
  RECOMMENDED_LIST_FILTER_FIELDS,
  RECOMMENDED_LIST_FILTER_OPTION_KEYS,
} from './recommendedListFilters.config'
import type { SupportStatusRollup } from './contacts-types'

// Single source of truth for the voter-file filter → backend field mapping
// (ENG-10708): every surface that builds a filter payload imports these maps
// rather than restating them, so two surfaces can never send diverging
// payloads for the same selection.
export interface VoterFileFilters {
  [key: string]: boolean
}

export interface VoterFileBackendFilters extends Record<string, unknown> {
  languageCodes?: string[]
  incomeRanges?: string[]
  incomeUnknown?: boolean
}

export const INCOME_KEY_TO_RANGE: Record<string, string> = {
  incomeUnder25k: 'Under $25k',
  income25kTo35k: '$25k - $35k',
  income35kTo50k: '$35k - $50k',
  income50kTo75k: '$50k - $75k',
  income75kTo100k: '$75k - $100k',
  income100kTo125k: '$100k - $125k',
  income125kTo150k: '$125k - $150k',
  income150kTo200k: '$150k - $200k',
  income200kPlus: '$200k+',
}

export const LANGUAGE_KEY_TO_CODE: Record<string, string> = {
  languageEnglish: 'en',
  languageSpanish: 'es',
  languageOther: 'other',
}

const LANGUAGE_KEYS = new Set(Object.keys(LANGUAGE_KEY_TO_CODE))
const INCOME_KEYS = new Set([
  ...Object.keys(INCOME_KEY_TO_RANGE),
  'incomeUnknown',
])

// The recommended-lists keys are merged in UNGATED, unlike their rendering:
// the transform emits an explicit boolean per key, which is what lets an
// edit clear a filter, so a payload that omits them would leave a saved
// list's stale value in place the moment the flag flips off.
const ALL_FILTER_OPTION_KEYS = [
  ...filterSections.flatMap((section) =>
    section.fields.flatMap((field) => field.options.map((opt) => opt.key)),
  ),
  ...RECOMMENDED_LIST_FILTER_OPTION_KEYS,
]

const ALL_FILTER_FIELDS = [
  ...filterSections.flatMap((section) => section.fields),
  ...RECOMMENDED_LIST_FILTER_FIELDS,
  ANY_PHONE_FIELD,
]
const PARTY_FIELD = ALL_FILTER_FIELDS.find(
  (field) => field.key === 'political_party',
)

// ENG-10709: `variableCount` for the wizard's List Created event — the number
// of filter categories (each `field` in filters.config.ts) with at least one
// selected option. Single source with the wizard so a future filters.config
// change can't silently drift the two.
export const countSelectedFilterCategories = (
  filters: VoterFileFilters,
): number =>
  ALL_FILTER_FIELDS.filter((field) =>
    field.options.some((option) => filters[option.key]),
  ).length

// `hasParty` — Win-only property on List Created. Serve never renders the
// Political Party section (VoterFileStep strips it for isElectedOfficial),
// so this always evaluates false there.
export const hasPartyFilterSelection = (filters: VoterFileFilters): boolean =>
  PARTY_FIELD?.options.some((option) => filters[option.key]) ?? false

// ENG-10751: the wizard's build-CTA gate (CreateListWizard) and the "Clear
// filters" affordance (VoterFileStep) must agree on what counts as a
// selection — one formula so the two can't drift. The outreach v2 builder
// gate reads it too. Precinct is part of it: a precinct-only selection is a
// real list, so it has to enable the CTA and the Clear affordance like any
// other filter.
export const hasAnyVoterFileSelection = (
  filters: VoterFileFilters,
  supportStatus: SupportStatusRollup[],
  precincts: string[] = [],
): boolean =>
  Object.values(filters).some(Boolean) ||
  supportStatus.length > 0 ||
  precincts.length > 0

export const transformVoterFileFiltersForBackend = (
  filters: VoterFileFilters,
): VoterFileBackendFilters => {
  const result: VoterFileBackendFilters = {}

  for (const key of ALL_FILTER_OPTION_KEYS) {
    if (LANGUAGE_KEYS.has(key) || INCOME_KEYS.has(key)) continue
    result[key] = !!filters[key]
  }

  const languageCodes: string[] = []
  for (const [key, code] of Object.entries(LANGUAGE_KEY_TO_CODE)) {
    if (filters[key]) languageCodes.push(code)
  }
  result.languageCodes = languageCodes

  const incomeRanges: string[] = []
  for (const [key, range] of Object.entries(INCOME_KEY_TO_RANGE)) {
    if (filters[key]) incomeRanges.push(range)
  }
  result.incomeRanges = incomeRanges
  result.incomeUnknown = !!filters.incomeUnknown

  return result
}

// Inverse of transformVoterFileFiltersForBackend: rehydrates a saved list's
// persisted columns into the wizard's pill state so Edit opens on the
// selection the list was built from. Only `true` seeds a pill — the persisted
// shape writes an explicit `false` for every unselected key, and a segment
// also carries plenty of non-filter fields (id, name, search, counts), so
// anything that isn't a literal `true` is skipped rather than coerced.
export const segmentToVoterFileFilters = (
  segment: Record<string, unknown>,
): VoterFileFilters => {
  const filters: VoterFileFilters = {}

  for (const key of ALL_FILTER_OPTION_KEYS) {
    if (LANGUAGE_KEYS.has(key) || INCOME_KEYS.has(key)) continue
    if (segment[key] === true) filters[key] = true
  }

  const languageCodes = Array.isArray(segment.languageCodes)
    ? segment.languageCodes
    : []
  for (const [key, code] of Object.entries(LANGUAGE_KEY_TO_CODE)) {
    if (languageCodes.includes(code)) filters[key] = true
  }

  const incomeRanges = Array.isArray(segment.incomeRanges)
    ? segment.incomeRanges
    : []
  for (const [key, range] of Object.entries(INCOME_KEY_TO_RANGE)) {
    if (incomeRanges.includes(range)) filters[key] = true
  }
  if (segment.incomeUnknown === true) filters.incomeUnknown = true

  return filters
}

// ENG-10752's retired age buckets straddle the current ones (legacy 18-25
// covers part of 25-34), so there's no honest remap — an edit drops them
// instead. Without this a legacy list would keep filtering on an age range
// the wizard can't render and the live count doesn't include, so the saved
// list would silently disagree with the count shown on the Save button.
export const LEGACY_AGE_CLEARED: VoterFileBackendFilters = Object.fromEntries(
  legacyAgeOptions.map((option) => [option.key, false]),
)

// Every voter-file column the wizard can express, at its empty value. An edit
// PUT is a partial update, so any key it omits keeps whatever the row already
// holds — while the live count is keyed on the payload, so an omitted key is a
// filter that narrows the saved list without appearing in the number on the
// Save button. A list can carry both kinds of criteria (the assistant's
// crud_saved_filters tool takes the whole filter schema flat, with no
// mutual-exclusion constraint), so the activity branch sends this entire
// baseline and the voter-file branch overlays its own selection on top.
// Deliberately limited to what the wizard renders: `voterStatus` and the
// legacy registration keys belong to other surfaces, and clearing a filter no
// one here can see would be its own silent edit.
export const CLEARED_VOTER_FILE_FILTERS: VoterFileBackendFilters = {
  ...transformVoterFileFiltersForBackend({}),
  ...LEGACY_AGE_CLEARED,
  supportStatus: [],
  precincts: [],
}
