import filterSections from '../../[[...attr]]/components/configs/filters.config'
import type { SupportStatusRollup } from './contacts-types'

// Single source of truth for the voter-file filter → backend field mapping
// (ENG-10708): both the wizard's voter-file branch and FiltersSheet import
// these maps so the two surfaces can never send diverging payloads for the
// same selection.
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

const ALL_FILTER_OPTION_KEYS = filterSections.flatMap((section) =>
  section.fields.flatMap((field) => field.options.map((opt) => opt.key)),
)

const ALL_FILTER_FIELDS = filterSections.flatMap((section) => section.fields)
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
