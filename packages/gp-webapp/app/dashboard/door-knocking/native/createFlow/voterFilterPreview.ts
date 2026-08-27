import {
  AGE_DIM_KEY,
  AGE_KEY_TO_PACK_BUCKETS,
  CONTACTS_MADE_BUCKETS,
  CONTACTS_MADE_DIM_KEY,
  DoorKnockingPackManifest,
} from '@goodparty_org/contracts'
import filterSections from 'app/dashboard/contacts/[[...attr]]/components/configs/filters.config'
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

// True when a selected option can't be expressed against the pack's buckets,
// so it leaves the preview unnarrowed. Shared with filtersToDimSelections
// below to keep the two answers from disagreeing.
const narrowsPreview = (
  filterKey: string,
  manifest: DoorKnockingPackManifest,
): boolean => {
  const mapping = FILTER_KEY_TO_DIM[filterKey]
  if (!mapping) return false
  const dim = manifest.dims.find((entry) => entry.key === mapping.dim)
  if (!dim) return false
  return dim.values.some((bucket) => mapping.buckets.includes(bucket))
}

// The selected options the map preview silently ignores: anything whose
// bucket THIS pack lacks. That is a property of the pack in hand rather than a
// fixed list — an organization past PACK_CONTACTS_MADE_MAX gets no
// contacts-made plane and its prior-contacts pills land here, while the same
// pills on the same build shade fine for everyone else. They still apply at
// knock time (evaluation is canonical), so the preview shows a SUPERSET of
// what the list will actually target. Callers surface this rather than letting
// a candidate draw against a shape that quietly disagrees with their own
// filters.
export const unpreviewableFilterKeys = (
  filters: VoterFileFilters,
  manifest: DoorKnockingPackManifest,
): string[] =>
  Object.entries(filters)
    .filter(
      ([filterKey, value]) => value && !narrowsPreview(filterKey, manifest),
    )
    .map(([filterKey]) => filterKey)

const CONTACTS_MADE_FIELD_KEY = 'contacts_made'
// Every other group's option labels stand on their own ("65+", "Renter"), so
// the disclosure names the option. Contacts made's are the bare counts
// '0'…'5+', which turned the sentence into "the map can't shade by 0 yet" — a
// sentence that reads like a bug. Name the group instead, once however many of
// its buckets are selected.
//
// This survives the plane shipping: the plane is omitted for an organization
// with more contacted people than one pack can carry, and that org's pills
// still need naming. It is the group's fallback wording, not a statement that
// the group is permanently unshadeable.
const CONTACTS_MADE_DISCLOSURE_LABEL = 'Prior contacts made'

// The marks `savedListFilterKeys` leaves for a list's non-boolean criteria.
// Every other unshadeable key is an option in filters.config and takes its
// label from there; these three are columns on the list itself, so the config
// has no row to name them and they would drop straight back out of the
// sentence they were just added to. "Past outreach activity" rather than
// "Prior outreach" so it cannot be mistaken for the contacts-made group above,
// which counts door knocks specifically.
const LIST_CRITERION_DISCLOSURE_LABELS: Record<string, string> = {
  supportStatus: 'Support status',
  activityConditions: 'Past outreach activity',
  precincts: 'Precinct',
}

// The disclosure's own vocabulary, beside the keys it describes: the draw step,
// the landing rail and the details sheet all say which filters the map can't
// shade, and a candidate meeting those sentences in one session must not find
// them naming the same filter differently.
export const unpreviewableDisclosureLabels = (keys: string[]): string[] => [
  ...new Set(
    keys
      .map((key) => {
        const criterionLabel = LIST_CRITERION_DISCLOSURE_LABELS[key]
        if (criterionLabel) return criterionLabel
        const field = filterSections
          .flatMap((section) => section.fields)
          .find((entry) => entry.options.some((option) => option.key === key))
        if (!field) return undefined
        if (field.key === CONTACTS_MADE_FIELD_KEY)
          return CONTACTS_MADE_DISCLOSURE_LABEL
        return field.options.find((option) => option.key === key)?.label
      })
      .filter((label): label is string => Boolean(label)),
  ),
]

// "A", "A or B", "A, B, or C". The clause this feeds is negated — the map can
// shade by none of them — so English wants "or" rather than "and", and the
// comma before the final "or" is the thing that stops a three-item list from
// reading as one long filter name.
const joinWithOr = (labels: string[]): string => {
  if (labels.length <= 1) return labels[0] ?? ''
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`
}

// The one wording of the disclosure, for the three surfaces that carry it (the
// draw step, the landing rail and the details sheet). It was assembled inline
// at each of them from `labels.join(', ')` around a sentence written for
// exactly one filter, which two selections turned into "The map can't shade by
// 65+, Prior contacts made yet, so these counts include people that filter
// will exclude" — a comma list a reader parses as a typo, a trailing "yet"
// that glues itself to the last label ("Prior contacts made yet"), and then a
// singular "that filter" / "it" for a plural subject. All three failures are
// properties of the sentence rather than of any one surface, so the sentence
// lives here with the labels it is about.
//
// What it must keep saying is in AGENTS.md and ADR 0010: the map can't SHOW
// the filter, and the list still applies it at knock time. Never that the
// filter isn't applied — a candidate who reads that concludes their targeting
// is silently failing, which is the worse misunderstanding.
// `hasSavedList` names the subject of the closing clause, and only that. The
// create flow reaches this sentence with no list picked — a candidate who
// toggles 65+ from scratch has an unshadeable selection and nothing saved to
// attribute it to — where "Your saved list still applies it" cites a list that
// does not exist. Dropping the clause instead was the obvious repair and is
// the wrong one: what remains ends on "include people that filter will
// exclude", which is the reading ADR 0010 exists to prevent. The reassurance
// is true either way (knock-time evaluation is canonical for a list the flow
// is about to create, exactly as for one already saved), so the fix is to say
// whose list it is. Defaults to the saved wording because the other two
// surfaces — the details sheet and the landing rail — only ever describe a
// list that exists, and neither should have to opt in to being correct.
export const unpreviewableDisclosureSentence = (
  labels: string[],
  hasSavedList = true,
): string | null => {
  if (labels.length === 0) return null
  const plural = labels.length > 1
  return (
    `The map can’t yet shade by ${joinWithOr(labels)}, so these counts ` +
    `include people ${plural ? 'those filters' : 'that filter'} will ` +
    `exclude. Your ${hasSavedList ? 'saved list' : 'list'} still applies ` +
    `${plural ? 'them' : 'it'} when you knock.`
  )
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

  return allowed
}
