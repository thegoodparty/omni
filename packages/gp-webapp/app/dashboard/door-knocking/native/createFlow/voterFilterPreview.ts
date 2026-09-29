import {
  AGE_DIM_KEY,
  AGE_KEY_TO_PACK_BUCKETS,
  CONTACTS_MADE_BUCKETS,
  CONTACTS_MADE_DIM_KEY,
  DoorKnockingPackManifest,
  PRECINCT_DIM_KEY,
} from '@goodparty_org/contracts'
import { DimSelections } from '../filterEngine'
import {
  INCOME_KEY_TO_RANGE,
  type VoterFileFilters,
} from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'

// Maps saved-list filter option keys onto pack dims so the map can preview a
// step-1 selection. `buckets` is the set of manifest bucket names the key
// selects — EVERY one the manifest carries, not the first match — and the
// names are matched at runtime, so a district whose pack spells a bucket
// differently (or lacks it entirely) degrades to not narrowing rather than to
// narrowing wrongly. Unmatched keys don't narrow the preview at all and are
// reported by `unpreviewableFilterKeys`; the knock-time evaluation stays
// canonical either way.
//
// What each age key matched against a pack built before the re-cut, kept so
// the two vocabularies coexist through a deploy. Retired keys had an exact
// legacy bucket; the current keys were approximations of one, except the two
// with nothing to approximate — see the comment on the age entries below.
const LEGACY_AGE_BUCKETS: Record<string, string[]> = {
  age18_25: ['18_25'],
  age25_35: ['25_35'],
  age35_50: ['35_50'],
  age50Plus: ['50_plus'],
  age18_24: ['18_25'],
  age25_34: ['25_35'],
  age35_49: ['35_50'],
  age50_64: [],
  age65Plus: [],
}

// Most entries list alternative spellings of ONE bucket, of which a given
// manifest can only ever have one (the pack's vocabularies are closed sets in
// `packEncoder.utils.ts`). Age is the exception and lists real siblings: its
// buckets are cut at every boundary either generation of age key uses, so a
// key that spans several of them selects several. Income buckets are named by
// the shared INCOME_RANGE_MAPPING keys, which INCOME_KEY_TO_RANGE points at.
const FILTER_KEY_TO_DIM: Record<string, { dim: string; buckets: string[] }> = {
  partyDemocrat: { dim: 'party', buckets: ['Democratic', 'Democrat'] },
  partyRepublican: { dim: 'party', buckets: ['Republican'] },
  partyIndependent: { dim: 'party', buckets: ['Independent'] },
  partyOther: { dim: 'party', buckets: ['Unknown', 'unknown', 'Other'] },
  // Age is derived, not written down. The pack cuts its buckets at every
  // boundary BOTH generations of age key use (ENG-10752 re-cut the bands and
  // both are live), so each key is an exact union of them — contracts'
  // PackAgeBuckets.ts owns the derivation and gp-api's encoder reads the same
  // table.
  //
  // The legacy spellings ride along because a pack built before the re-cut
  // still ships them and a browser can hold one across a deploy. No pack has
  // both vocabularies, so listing both never over-selects: on a new pack the
  // legacy names match nothing, on an old one the new names do. `age50_64` and
  // `age65Plus` deliberately have NO legacy fallback — the old buckets stop at
  // 50, so the closest legacy match for either is `50_plus`, which shades 65+
  // people a 50-64 list will not knock. Falling back to the disclosure is the
  // honest answer; `age50_64 -> 50_plus` was the previous behavior and it was
  // a silent superset.
  ...Object.fromEntries(
    Object.entries(AGE_KEY_TO_PACK_BUCKETS).map(([key, buckets]) => [
      key,
      {
        dim: AGE_DIM_KEY,
        buckets: [...buckets, ...(LEGACY_AGE_BUCKETS[key] ?? [])],
      },
    ]),
  ),
  ageUnknown: { dim: AGE_DIM_KEY, buckets: ['Unknown', 'unknown'] },
  genderMale: { dim: 'gender', buckets: ['M', 'Male'] },
  genderFemale: { dim: 'gender', buckets: ['F', 'Female'] },
  genderUnknown: { dim: 'gender', buckets: ['Unknown', 'unknown'] },
  audienceSuperVoters: { dim: 'voterStatus', buckets: ['Super'] },
  audienceLikelyVoters: { dim: 'voterStatus', buckets: ['Likely'] },
  audienceUnreliableVoters: {
    dim: 'voterStatus',
    buckets: ['Unreliable'],
  },
  audienceUnlikelyVoters: { dim: 'voterStatus', buckets: ['Unlikely'] },
  audienceUnknown: { dim: 'voterStatus', buckets: ['Unknown', 'unknown'] },
  hasCellPhone: { dim: 'hasCellPhone', buckets: ['Yes', 'true', 'Has'] },
  hasLandline: { dim: 'hasLandline', buckets: ['Yes', 'true', 'Has'] },
  veteranYes: { dim: 'veteranStatus', buckets: ['Yes', 'Veteran'] },
  veteranUnknown: {
    dim: 'veteranStatus',
    buckets: ['Unknown', 'unknown'],
  },
  // 'Homeowner' folds Probable Home Owner in server-side (ENG-10947), but
  // the pack encodes one bucket per person (packEncoder.utils.ts's
  // invertMapper), so it cannot represent an OR of two buckets under one
  // filter key. The preview therefore only shades the exact-owner bucket
  // here — a known, disclosed undercount (the map preview is a superset
  // OR undercount approximation elsewhere too; knock-time evaluation
  // stays canonical). homeownerLikely still previews its own bucket for a
  // pre-collapse saved list (homeownerLikely=true, no homeownerYes).
  homeownerYes: { dim: 'homeowner', buckets: ['Home Owner', 'Yes'] },
  homeownerLikely: {
    dim: 'homeowner',
    buckets: ['Probable Home Owner', 'Likely'],
  },
  homeownerNo: { dim: 'homeowner', buckets: ['Renter', 'No'] },
  homeownerUnknown: {
    dim: 'homeowner',
    buckets: ['Unknown', 'unknown'],
  },
  businessOwnerYes: { dim: 'businessOwner', buckets: ['Yes'] },
  businessOwnerUnknown: {
    dim: 'businessOwner',
    buckets: ['Unknown', 'unknown'],
  },
  registeredVoterTrue: { dim: 'registered', buckets: ['Yes', 'true'] },
  registeredVoterFalse: { dim: 'registered', buckets: ['No', 'false'] },
  hasChildrenYes: { dim: 'presenceOfChildren', buckets: ['Yes'] },
  hasChildrenNo: { dim: 'presenceOfChildren', buckets: ['No'] },
  hasChildrenUnknown: {
    dim: 'presenceOfChildren',
    buckets: ['Unknown', 'unknown'],
  },
  languageEnglish: { dim: 'language', buckets: ['English'] },
  languageSpanish: { dim: 'language', buckets: ['Spanish'] },
  languageOther: { dim: 'language', buckets: ['Other'] },
  // Both spellings, as the other Unknown buckets above do: the pack's
  // UNKNOWN constant and the lowercase form some dims carry.
  languageUnknown: { dim: 'language', buckets: ['Unknown', 'unknown'] },
  likelyMarried: {
    dim: 'maritalStatus',
    buckets: ['Inferred Married'],
  },
  likelySingle: { dim: 'maritalStatus', buckets: ['Inferred Single'] },
  married: { dim: 'maritalStatus', buckets: ['Married'] },
  single: { dim: 'maritalStatus', buckets: ['Single'] },
  maritalUnknown: {
    dim: 'maritalStatus',
    buckets: ['Unknown', 'unknown'],
  },
  educationNone: { dim: 'educationLevel', buckets: ['None'] },
  educationHighSchoolDiploma: {
    dim: 'educationLevel',
    buckets: ['High School Diploma'],
  },
  educationTechnicalSchool: {
    dim: 'educationLevel',
    buckets: ['Technical School'],
  },
  educationSomeCollege: {
    dim: 'educationLevel',
    buckets: ['Some College'],
  },
  educationCollegeDegree: {
    dim: 'educationLevel',
    buckets: ['College Degree'],
  },
  educationGraduateDegree: {
    dim: 'educationLevel',
    buckets: ['Graduate Degree'],
  },
  educationUnknown: {
    dim: 'educationLevel',
    buckets: ['Unknown', 'unknown'],
  },
  ethnicityAsian: { dim: 'ethnicity', buckets: ['Asian'] },
  ethnicityEuropean: { dim: 'ethnicity', buckets: ['European'] },
  ethnicityHispanic: { dim: 'ethnicity', buckets: ['Hispanic'] },
  ethnicityAfricanAmerican: {
    dim: 'ethnicity',
    buckets: ['African American'],
  },
  ethnicityOther: { dim: 'ethnicity', buckets: ['Other'] },
  ethnicityUnknown: {
    dim: 'ethnicity',
    buckets: ['Unknown', 'unknown'],
  },
  incomeUnknown: { dim: 'income', buckets: ['Unknown', 'unknown'] },
  ...Object.fromEntries(
    Object.entries(INCOME_KEY_TO_RANGE).map(([key, range]) => [
      key,
      { dim: 'income', buckets: [range] },
    ]),
  ),
  // Prior contacts made is the campaign's own outreach history rather than a
  // voter attribute, so it rides its own pack plane, joined per organization
  // from the same grouped count `ContactsMadeResolutionService` resolves the
  // filter with (gp-api). The bucket names ARE the pill labels ('0'…'5+'),
  // and CONTACTS_MADE_BUCKET_FIELDS' order is the plane's byte order, so the
  // Nth field maps to the Nth bucket with no translation table between them.
  //
  // An org with too much outreach to describe in one pack ships no plane at
  // all (PACK_CONTACTS_MADE_MAX), and these keys then fall through to the
  // disclosure below exactly as they did before the plane existed.
  ...Object.fromEntries(
    (
      [
        'contactsMade0',
        'contactsMade1',
        'contactsMade2',
        'contactsMade3',
        'contactsMade4',
        'contactsMade5Plus',
      ] as const
    ).map((key, index) => [
      key,
      { dim: CONTACTS_MADE_DIM_KEY, buckets: [CONTACTS_MADE_BUCKETS[index]] },
    ]),
  ),
}

// Builds the pack filter selection previewing a saved-list filter draft: for
// each dim with at least one selected option, allow exactly the selected
// buckets; dims untouched by the draft stay fully allowed.
export const filtersToDimSelections = (
  filters: VoterFileFilters,
  manifest: DoorKnockingPackManifest,
  // The precinct selection in effect, as encoded `county|precinct` pairs.
  // Separate from `filters` because it is the one selection that is not a
  // boolean: the draft carries only a MARK that precincts are in play, and
  // the values travel beside it from whichever of the three mutually
  // exclusive sources set them (hand-cut, a picked list's clause, or an
  // accepted recommendation's).
  precincts: readonly string[] = [],
): DimSelections => {
  const dimIndex = new Map(manifest.dims.map((dim) => [dim.key, dim]))
  const allowed = new Map<string, Set<number>>()

  for (const [filterKey, value] of Object.entries(filters)) {
    if (!value) continue
    const mapping = FILTER_KEY_TO_DIM[filterKey]
    if (!mapping) continue
    const dim = dimIndex.get(mapping.dim)
    if (!dim) continue
    // Every matching bucket, not the first: an age key spans several of the
    // pack's, and a key whose whole set is missing must add NO entry rather
    // than an empty one — an empty set would allow nothing and shade an empty
    // map, where "we can't express this" has to mean "don't constrain".
    const indexes = dim.values.flatMap((bucket, index) =>
      mapping.buckets.includes(bucket) ? [index] : [],
    )
    if (indexes.length === 0) continue
    const set = allowed.get(mapping.dim) ?? new Set<number>()
    for (const index of indexes) set.add(index)
    allowed.set(mapping.dim, set)
  }

  // Matched directly against the dim's values rather than through
  // FILTER_KEY_TO_DIM: these ARE those values, because the encoder builds
  // the vocabulary out of `encodePrecinctPair` and the saved filter stores
  // the same strings. Same rule as the loop above — a selection this pack
  // cannot express adds NO entry rather than an empty one, since an empty
  // set allows nothing and would shade an empty map where "we can't express
  // this" has to mean "don't constrain".
  if (precincts.length > 0) {
    const dim = dimIndex.get(PRECINCT_DIM_KEY)
    if (dim) {
      const wanted = new Set(precincts)
      const indexes = dim.values.flatMap((pair, index) =>
        wanted.has(pair) ? [index] : [],
      )
      if (indexes.length > 0) {
        allowed.set(PRECINCT_DIM_KEY, new Set(indexes))
      }
    }
  }

  return allowed
}
