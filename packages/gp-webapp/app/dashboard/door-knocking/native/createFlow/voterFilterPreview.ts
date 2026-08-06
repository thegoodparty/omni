import { DoorKnockingPackManifest } from '@goodparty_org/contracts'
import { DimSelections } from '../filterEngine'
import {
  INCOME_KEY_TO_RANGE,
  type VoterFileFilters,
} from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'

// Maps saved-list filter option keys onto pack dims so the map can preview a
// step-1 selection. Candidates are matched against the manifest's actual
// bucket names at runtime; unmatched keys simply don't narrow the preview —
// the knock-time evaluation stays canonical. The pack's age buckets predate
// ENG-10752's exclusive split, so the age mapping is the closest legacy
// bucket. Income buckets are named by the shared INCOME_RANGE_MAPPING keys,
// which INCOME_KEY_TO_RANGE already points at.
const FILTER_KEY_TO_DIM: Record<string, { dim: string; candidates: string[] }> =
  {
    partyDemocrat: { dim: 'party', candidates: ['Democratic', 'Democrat'] },
    partyRepublican: { dim: 'party', candidates: ['Republican'] },
    partyIndependent: { dim: 'party', candidates: ['Independent'] },
    partyOther: { dim: 'party', candidates: ['Unknown', 'unknown', 'Other'] },
    age18_24: { dim: 'age', candidates: ['18_25', '18-25'] },
    age25_34: { dim: 'age', candidates: ['25_35', '25-35'] },
    age35_49: { dim: 'age', candidates: ['35_50', '35-50'] },
    age50_64: { dim: 'age', candidates: ['50_plus', '50+'] },
    // The pack's legacy buckets can't distinguish 65+ from 50-64; mapping
    // both to 50_plus would preview identical cohorts for different pills,
    // so 65+ deliberately doesn't narrow (an unmapped pill previews a
    // superset, which is the honest failure mode).
    ageUnknown: { dim: 'age', candidates: ['Unknown', 'unknown'] },
    genderMale: { dim: 'gender', candidates: ['M', 'Male'] },
    genderFemale: { dim: 'gender', candidates: ['F', 'Female'] },
    genderUnknown: { dim: 'gender', candidates: ['Unknown', 'unknown'] },
    audienceSuperVoters: { dim: 'voterStatus', candidates: ['Super'] },
    audienceLikelyVoters: { dim: 'voterStatus', candidates: ['Likely'] },
    audienceUnreliableVoters: {
      dim: 'voterStatus',
      candidates: ['Unreliable'],
    },
    audienceUnlikelyVoters: { dim: 'voterStatus', candidates: ['Unlikely'] },
    audienceFirstTimeVoters: {
      dim: 'voterStatus',
      candidates: ['First Time'],
    },
    audienceUnknown: { dim: 'voterStatus', candidates: ['Unknown', 'unknown'] },
    hasCellPhone: { dim: 'hasCellPhone', candidates: ['Yes', 'true', 'Has'] },
    hasLandline: { dim: 'hasLandline', candidates: ['Yes', 'true', 'Has'] },
    veteranYes: { dim: 'veteranStatus', candidates: ['Yes', 'Veteran'] },
    veteranUnknown: {
      dim: 'veteranStatus',
      candidates: ['Unknown', 'unknown'],
    },
    homeownerYes: { dim: 'homeowner', candidates: ['Home Owner', 'Yes'] },
    homeownerLikely: {
      dim: 'homeowner',
      candidates: ['Probable Home Owner', 'Likely'],
    },
    homeownerNo: { dim: 'homeowner', candidates: ['Renter', 'No'] },
    homeownerUnknown: {
      dim: 'homeowner',
      candidates: ['Unknown', 'unknown'],
    },
    businessOwnerYes: { dim: 'businessOwner', candidates: ['Yes'] },
    businessOwnerUnknown: {
      dim: 'businessOwner',
      candidates: ['Unknown', 'unknown'],
    },
    registeredVoterTrue: { dim: 'registered', candidates: ['Yes', 'true'] },
    registeredVoterFalse: { dim: 'registered', candidates: ['No', 'false'] },
    hasChildrenYes: { dim: 'presenceOfChildren', candidates: ['Yes'] },
    hasChildrenNo: { dim: 'presenceOfChildren', candidates: ['No'] },
    hasChildrenUnknown: {
      dim: 'presenceOfChildren',
      candidates: ['Unknown', 'unknown'],
    },
    languageEnglish: { dim: 'language', candidates: ['English'] },
    languageSpanish: { dim: 'language', candidates: ['Spanish'] },
    languageOther: { dim: 'language', candidates: ['Other'] },
    likelyMarried: {
      dim: 'maritalStatus',
      candidates: ['Inferred Married'],
    },
    likelySingle: { dim: 'maritalStatus', candidates: ['Inferred Single'] },
    married: { dim: 'maritalStatus', candidates: ['Married'] },
    single: { dim: 'maritalStatus', candidates: ['Single'] },
    maritalUnknown: {
      dim: 'maritalStatus',
      candidates: ['Unknown', 'unknown'],
    },
    educationNone: { dim: 'educationLevel', candidates: ['None'] },
    educationHighSchoolDiploma: {
      dim: 'educationLevel',
      candidates: ['High School Diploma'],
    },
    educationTechnicalSchool: {
      dim: 'educationLevel',
      candidates: ['Technical School'],
    },
    educationSomeCollege: {
      dim: 'educationLevel',
      candidates: ['Some College'],
    },
    educationCollegeDegree: {
      dim: 'educationLevel',
      candidates: ['College Degree'],
    },
    educationGraduateDegree: {
      dim: 'educationLevel',
      candidates: ['Graduate Degree'],
    },
    educationUnknown: {
      dim: 'educationLevel',
      candidates: ['Unknown', 'unknown'],
    },
    ethnicityAsian: { dim: 'ethnicity', candidates: ['Asian'] },
    ethnicityEuropean: { dim: 'ethnicity', candidates: ['European'] },
    ethnicityHispanic: { dim: 'ethnicity', candidates: ['Hispanic'] },
    ethnicityAfricanAmerican: {
      dim: 'ethnicity',
      candidates: ['African American'],
    },
    ethnicityOther: { dim: 'ethnicity', candidates: ['Other'] },
    ethnicityUnknown: {
      dim: 'ethnicity',
      candidates: ['Unknown', 'unknown'],
    },
    incomeUnknown: { dim: 'income', candidates: ['Unknown', 'unknown'] },
    ...Object.fromEntries(
      Object.entries(INCOME_KEY_TO_RANGE).map(([key, range]) => [
        key,
        { dim: 'income', candidates: [range] },
      ]),
    ),
  }

// Builds the pack filter selection previewing a saved-list filter draft: for
// each dim with at least one selected option, allow exactly the selected
// buckets; dims untouched by the draft stay fully allowed.
export const filtersToDimSelections = (
  filters: VoterFileFilters,
  manifest: DoorKnockingPackManifest,
): DimSelections => {
  const dimIndex = new Map(manifest.dims.map((dim) => [dim.key, dim]))
  const allowed = new Map<string, Set<number>>()

  for (const [filterKey, value] of Object.entries(filters)) {
    if (!value) continue
    const mapping = FILTER_KEY_TO_DIM[filterKey]
    if (!mapping) continue
    const dim = dimIndex.get(mapping.dim)
    if (!dim) continue
    const index = dim.values.findIndex((bucket) =>
      mapping.candidates.includes(bucket),
    )
    if (index === -1) continue
    const set = allowed.get(mapping.dim) ?? new Set<number>()
    set.add(index)
    allowed.set(mapping.dim, set)
  }

  return allowed
}
