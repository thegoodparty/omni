import { INCOME_RANGE_MAPPING } from '@goodparty_org/contracts'
import { VoterFileFilter } from '../../generated/prisma'

type RangeCondition = {
  gte?: number
  lte?: number
}

type FilterValue =
  | boolean
  | {
      in?: string[] | number[]
      // Only the activity-condition/support-status resolution engine's `id`
      // key uses `notIn` — every other filter value collapses to `in`/`eq`.
      notIn?: string[]
      eq?: string | number
      gte?: number
      lte?: number
      is?: 'not_null' | 'null'
      _includeNull?: boolean
      _or?: RangeCondition[]
    }

export type FilterObject = Record<string, FilterValue>

type NumericRange = { min: number; max: number | null }

const processNumericRanges = (ranges: NumericRange[]): FilterValue => {
  const [firstRange] = ranges
  if (ranges.length === 1 && firstRange) {
    if (firstRange.max === null) {
      return { gte: firstRange.min }
    }
    return { gte: firstRange.min, lte: firstRange.max }
  }

  const sortedRanges = [...ranges].sort((a, b) => a.min - b.min)
  const hasUnbounded = sortedRanges.some((r) => r.max === null)
  const minValue = sortedRanges[0]?.min ?? 0

  const isContiguous = sortedRanges.every((range, index) => {
    if (index === 0) return true
    const prevRange = sortedRanges[index - 1]
    return (
      prevRange != null &&
      prevRange.max !== null &&
      (range.min === prevRange.max || range.min === prevRange.max + 1)
    )
  })

  if (isContiguous) {
    if (hasUnbounded) {
      return { gte: minValue }
    }
    const maxValue = Math.max(...sortedRanges.map((r) => r.max ?? 0))
    return { gte: minValue, lte: maxValue }
  }

  const orConditions: RangeCondition[] = sortedRanges.map((range) => {
    if (range.max === null) {
      return { gte: range.min }
    }
    return { gte: range.min, lte: range.max }
  })

  return { _or: orConditions }
}

const addIncludeNull = (filter: FilterValue): FilterValue => {
  if (typeof filter === 'boolean') return filter
  return { ...filter, _includeNull: true }
}

// Audience boolean -> people-api voterStatus value. Exported so the
// filter-dimensions catalog (filterDimensions.catalog.ts) enumerates the same
// vocabulary this conversion sends, instead of restating it.
export const AUDIENCE_VOTER_STATUS_VALUES = [
  { field: 'audienceSuperVoters', value: 'Super' },
  { field: 'audienceLikelyVoters', value: 'Likely' },
  { field: 'audienceUnreliableVoters', value: 'Unreliable' },
  { field: 'audienceUnlikelyVoters', value: 'Unlikely' },
  { field: 'audienceFirstTimeVoters', value: 'First Time' },
  { field: 'audienceUnknown', value: 'Unknown' },
] as const

// Contacts-made boolean -> bucket (ENG-10839). 5 means "5+" (>= 5 logged
// interactions). Resolved by ContactsMadeResolutionService, never sent to
// people-api as a raw filter key (see fieldsHandledSeparately below) — kept
// here so the filter-dimensions catalog and the resolution service share one
// vocabulary, mirroring AUDIENCE_VOTER_STATUS_VALUES above.
export const CONTACTS_MADE_BUCKET_FIELDS = [
  { field: 'contactsMade0', bucket: 0 },
  { field: 'contactsMade1', bucket: 1 },
  { field: 'contactsMade2', bucket: 2 },
  { field: 'contactsMade3', bucket: 3 },
  { field: 'contactsMade4', bucket: 4 },
  { field: 'contactsMade5Plus', bucket: 5 },
] as const

// languageCodes entry -> the people-api language filter value (also the
// human-readable label the catalog shows for that code).
export const LANGUAGE_CODE_TO_LABEL: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  other: 'Other',
}

// The only incomeRanges strings the conversion below understands; anything
// else is silently dropped, so the catalog advertises exactly these keys.
// Single-sourced from contracts so people-api's pack encoder buckets by the
// same bounds.
export { INCOME_RANGE_MAPPING }

// The people-db ETL's Voter_Status CASE (gp-data-platform,
// m_people_api__voter.sql) has no 'Unreliable' branch: the middle-propensity
// cohort (voted exactly 1 of the last 3 tracked elections) falls into its
// `else` and is stored as 'Unknown', so the literal 'Unreliable' matches
// zero rows in every environment. Until the ETL is fixed and the cluster
// rebuilt, an Unreliable selection must also match 'Unknown' or it selects
// nothing.
const expandUnreliableVoterStatus = (values: string[]): string[] =>
  values.includes('Unreliable') && !values.includes('Unknown')
    ? [...values, 'Unknown']
    : values

// Accepts a full persisted VoterFileFilter (saved-segment path) or the
// unsaved, partial filter set the live count sends (ENG-10517). Only the filter
// fields are read; missing ones are treated as unset, exactly like false/empty.
export const convertVoterFileFilterToFilters = (
  segment: Partial<VoterFileFilter>,
): FilterObject => {
  const filters: FilterObject = {}
  const excludeFields = new Set([
    'id',
    'createdAt',
    'updatedAt',
    'name',
    'search',
    'campaignId',
    'campaign',
    'outreaches',
    'registeredVoterTrue',
    'registeredVoterFalse',
    'registeredVoterUnknown',
    // Resolved by the activity-condition/support-status resolution engine
    // (CRM feature 4 task 05), not this generic key->filter loop — an
    // activityConditions array of objects or a supportStatus string array
    // would otherwise fall into the generic `else` branch below and produce
    // a meaningless FilterObject entry.
    'activityConditions',
    'supportStatus',
  ])

  const fieldsHandledSeparately = new Set([
    'hasCellPhone',
    'hasLandline',
    'audienceSuperVoters',
    'audienceLikelyVoters',
    'audienceUnreliableVoters',
    'audienceUnlikelyVoters',
    'audienceFirstTimeVoters',
    'audienceUnknown',
    'partyIndependent',
    'partyDemocrat',
    'partyRepublican',
    'partyOther',
    'genderMale',
    'genderFemale',
    'genderUnknown',
    'age18_25',
    'age25_35',
    'age35_50',
    'age50Plus',
    'age18_24',
    'age25_34',
    'age35_49',
    'age50_64',
    'age65Plus',
    'ageUnknown',
    'likelyMarried',
    'likelySingle',
    'married',
    'single',
    'maritalUnknown',
    'veteranYes',
    'veteranUnknown',
    'educationNone',
    'educationHighSchoolDiploma',
    'educationTechnicalSchool',
    'educationSomeCollege',
    'educationCollegeDegree',
    'educationGraduateDegree',
    'educationUnknown',
    'ethnicityAsian',
    'ethnicityEuropean',
    'ethnicityHispanic',
    'ethnicityAfricanAmerican',
    'ethnicityOther',
    'ethnicityUnknown',
    'businessOwnerYes',
    'businessOwnerUnknown',
    'hasChildrenYes',
    'hasChildrenNo',
    'hasChildrenUnknown',
    'homeownerYes',
    'homeownerLikely',
    'homeownerNo',
    'homeownerUnknown',
    'incomeUnknown',
    'contactsMade0',
    'contactsMade1',
    'contactsMade2',
    'contactsMade3',
    'contactsMade4',
    'contactsMade5Plus',
  ])

  for (const [key, value] of Object.entries(segment)) {
    if (excludeFields.has(key)) continue

    if (typeof value === 'boolean' && value) {
      if (fieldsHandledSeparately.has(key)) {
        continue
      }
      filters[key] = true
    } else if (Array.isArray(value) && value.length > 0) {
      if (key === 'languageCodes') {
        const filterMap = LANGUAGE_CODE_TO_LABEL
        const normalizedLanguages: string[] = value
          .map((lang: string) => filterMap[lang])
          .filter((lang): lang is string => Boolean(lang))

        filters['language'] =
          normalizedLanguages.length === 1
            ? { eq: normalizedLanguages[0] }
            : { in: normalizedLanguages }
      } else if (key === 'voterStatus') {
        const expanded = expandUnreliableVoterStatus(value.map(String))
        filters['voterStatus'] =
          expanded.length === 1 ? { eq: expanded[0] } : { in: expanded }
      } else if (key === 'incomeRanges') {
        // Income ranges are handled separately after the loop
        // to allow combining with incomeUnknown using _includeNull
      } else {
        filters[key] = value.length === 1 ? { eq: value[0] } : { in: value }
      }
    }
  }

  if (!filters['voterStatus']) {
    const voterStatusValues: string[] = expandUnreliableVoterStatus(
      AUDIENCE_VOTER_STATUS_VALUES.filter(({ field }) => segment[field]).map(
        ({ value }) => value,
      ),
    )
    if (voterStatusValues.length > 0) {
      filters['voterStatus'] =
        voterStatusValues.length === 1
          ? { eq: voterStatusValues[0] }
          : { in: voterStatusValues }
    }
  }

  const politicalPartyValues: string[] = []
  if (segment.partyIndependent) politicalPartyValues.push('Independent')
  if (segment.partyDemocrat) politicalPartyValues.push('Democratic')
  if (segment.partyRepublican) politicalPartyValues.push('Republican')
  if (segment.partyOther) politicalPartyValues.push('Other')
  if (politicalPartyValues.length > 0) {
    filters['politicalParty'] =
      politicalPartyValues.length === 1
        ? { eq: politicalPartyValues[0] }
        : { in: politicalPartyValues }
  }

  const genderValues: string[] = []
  if (segment.genderMale) genderValues.push('M')
  if (segment.genderFemale) genderValues.push('F')
  if (segment.genderUnknown) genderValues.push('Unknown')
  if (genderValues.length > 0) {
    filters['gender'] =
      genderValues.length === 1 ? { eq: genderValues[0] } : { in: genderValues }
  }

  const ageRanges: Array<{ min: number; max: number | null }> = []
  // Retired keys keep the exact bounds they were saved with (ENG-10752) —
  // reinterpreting them would silently change existing lists' membership.
  if (segment.age18_25) ageRanges.push({ min: 18, max: 25 })
  if (segment.age25_35) ageRanges.push({ min: 25, max: 35 })
  if (segment.age35_50) ageRanges.push({ min: 35, max: 50 })
  if (segment.age50Plus) ageRanges.push({ min: 50, max: null })
  if (segment.age18_24) ageRanges.push({ min: 18, max: 24 })
  if (segment.age25_34) ageRanges.push({ min: 25, max: 34 })
  if (segment.age35_49) ageRanges.push({ min: 35, max: 49 })
  if (segment.age50_64) ageRanges.push({ min: 50, max: 64 })
  if (segment.age65Plus) ageRanges.push({ min: 65, max: null })

  if (ageRanges.length > 0) {
    const ageFilter = processNumericRanges(ageRanges)
    filters['ageInt'] = segment.ageUnknown
      ? addIncludeNull(ageFilter)
      : ageFilter
  } else if (segment.ageUnknown) {
    filters['ageInt'] = { is: 'null' }
  }

  const maritalValues: string[] = []
  if (segment.likelyMarried) maritalValues.push('Inferred Married')
  if (segment.likelySingle) maritalValues.push('Inferred Single')
  if (segment.married) maritalValues.push('Married')
  if (segment.single) maritalValues.push('Single')
  if (segment.maritalUnknown) maritalValues.push('Unknown')
  if (maritalValues.length > 0) {
    filters['maritalStatus'] =
      maritalValues.length === 1
        ? { eq: maritalValues[0] }
        : { in: maritalValues }
  }

  const veteranValues: string[] = []
  if (segment.veteranYes) veteranValues.push('Yes')
  if (segment.veteranUnknown) veteranValues.push('Unknown')
  if (veteranValues.length > 0) {
    filters['veteranStatus'] =
      veteranValues.length === 1
        ? { eq: veteranValues[0] }
        : { in: veteranValues }
  }

  const educationValues: string[] = []
  if (segment.educationNone) educationValues.push('None')
  if (segment.educationHighSchoolDiploma)
    educationValues.push('High School Diploma')
  if (segment.educationTechnicalSchool) educationValues.push('Technical School')
  if (segment.educationSomeCollege) educationValues.push('Some College')
  if (segment.educationCollegeDegree) educationValues.push('College Degree')
  if (segment.educationGraduateDegree) educationValues.push('Graduate Degree')
  if (segment.educationUnknown) educationValues.push('Unknown')
  if (educationValues.length > 0) {
    filters['educationLevel'] =
      educationValues.length === 1
        ? { eq: educationValues[0] }
        : { in: educationValues }
  }

  const ethnicityValues: string[] = []
  if (segment.ethnicityAsian) ethnicityValues.push('Asian')
  if (segment.ethnicityEuropean) ethnicityValues.push('European')
  if (segment.ethnicityHispanic) ethnicityValues.push('Hispanic')
  if (segment.ethnicityAfricanAmerican) ethnicityValues.push('African American')
  if (segment.ethnicityOther) ethnicityValues.push('Other')
  if (segment.ethnicityUnknown) ethnicityValues.push('Unknown')
  if (ethnicityValues.length > 0) {
    filters['ethnicity'] =
      ethnicityValues.length === 1
        ? { eq: ethnicityValues[0] }
        : { in: ethnicityValues }
  }

  const businessOwnerValues: string[] = []
  if (segment.businessOwnerYes) businessOwnerValues.push('Yes')
  if (segment.businessOwnerUnknown) businessOwnerValues.push('Unknown')
  if (businessOwnerValues.length > 0) {
    filters['businessOwner'] =
      businessOwnerValues.length === 1
        ? { eq: businessOwnerValues[0] }
        : { in: businessOwnerValues }
  }

  const presenceOfChildrenValues: string[] = []
  if (segment.hasChildrenYes) presenceOfChildrenValues.push('Yes')
  if (segment.hasChildrenNo) presenceOfChildrenValues.push('No')
  if (segment.hasChildrenUnknown) presenceOfChildrenValues.push('Unknown')
  if (presenceOfChildrenValues.length > 0) {
    filters['presenceOfChildren'] =
      presenceOfChildrenValues.length === 1
        ? { eq: presenceOfChildrenValues[0] }
        : { in: presenceOfChildrenValues }
  }

  const homeownerValues: string[] = []
  if (segment.homeownerYes) homeownerValues.push('Yes')
  if (segment.homeownerLikely) homeownerValues.push('Likely')
  if (segment.homeownerNo) homeownerValues.push('No')
  if (segment.homeownerUnknown) homeownerValues.push('Unknown')
  if (homeownerValues.length > 0) {
    filters['homeowner'] =
      homeownerValues.length === 1
        ? { eq: homeownerValues[0] }
        : { in: homeownerValues }
  }

  const incomeRanges: NumericRange[] = []
  if (segment.incomeRanges && Array.isArray(segment.incomeRanges)) {
    for (const rangeStr of segment.incomeRanges) {
      const range = INCOME_RANGE_MAPPING[rangeStr]
      if (range) {
        incomeRanges.push(range)
      }
    }
  }

  if (incomeRanges.length > 0) {
    const incomeFilter = processNumericRanges(incomeRanges)
    filters['estimatedIncomeAmountInt'] = segment.incomeUnknown
      ? addIncludeNull(incomeFilter)
      : incomeFilter
  } else if (segment.incomeUnknown) {
    filters['estimatedIncomeAmountInt'] = { is: 'null' }
  }

  if (segment.hasCellPhone) {
    filters['hasCellPhone'] = true
  }

  if (segment.hasLandline) {
    filters['hasLandline'] = true
  }
  return filters
}
