import filterSections from '../../[[...attr]]/components/configs/filters.config'

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
