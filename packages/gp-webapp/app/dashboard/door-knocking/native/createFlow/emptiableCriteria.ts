import type {
  VoterFileBackendFilters,
  VoterFileFilters,
} from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'

// The criteria a list can resolve to NOBODY on, as opposed to the ones that
// merely narrow a query.
//
// The distinction is not cosmetic and decides whether the who step asks the
// server anything at all. These three resolve to a person-id set out of our
// own tables before any voter data is read, and an empty set short-circuits
// the whole create — `resolveSavedFilterForQuery` reports it as `empty`.
// Everything else on a filter (party, age, precinct, language) becomes a
// column predicate that the people database evaluates, and a predicate
// matching no rows is a different failure that only a voter-data read can
// discover. So a draft carrying none of these cannot come back empty, and
// asking about one is a round trip whose answer is known in advance.
//
// These are also, not coincidentally, three of the criteria the voter pack
// cannot shade (UNSHADEABLE_LIST_CRITERIA in ../savedListFilters.ts, which
// names precincts in place of contacts-made because it is answering the
// neighbouring question of what the MAP can draw). That overlap is the bug
// this gate exists for: the criteria that can silently empty a list are the
// criteria the map keeps showing the whole district for.
//
// Each is declared against BOTH grammars the create flow holds the same draft
// in, because the two surfaces that need this read different ones. The wire
// payload (`VoterFileBackendFilters`) carries support status and activity
// conditions as value arrays, assembled in `CreateListSurface` from the picked
// row; the flow's own draft (`VoterFileFilters`) is booleans, where those two
// appear only as the marks `savedListFilterKeys` leaves behind. Declaring them
// together is what stops the gate and the sentence explaining it from being
// derived off two independently maintained lists.
const CONTACTS_MADE_KEYS = [
  'contactsMade0',
  'contactsMade1',
  'contactsMade2',
  'contactsMade3',
  'contactsMade4',
  'contactsMade5Plus',
]

// `VoterFileBackendFilters` indexes to `unknown` — it is the wire grammar, not
// a modelled object — so presence is checked rather than asserted.
const hasValues = (value: unknown): boolean =>
  Array.isArray(value) && value.length > 0

const EMPTIABLE_CRITERIA: Array<{
  label: string
  onWire: (filters: VoterFileBackendFilters) => boolean
  inDraft: (filters: VoterFileFilters) => boolean
}> = [
  {
    label: 'support status',
    onWire: (filters) => hasValues(filters.supportStatus),
    inDraft: (filters) => filters.supportStatus === true,
  },
  {
    label: 'previous outreach',
    onWire: (filters) => hasValues(filters.activityConditions),
    inDraft: (filters) => filters.activityConditions === true,
  },
  {
    // Mirrors CONTACTS_MADE_BUCKET_FIELDS in gp-api's voterFileFilter.utils.ts.
    // Unlike the two above, these are ordinary option keys in both grammars —
    // contacts-made is a control the pill builder renders — so one predicate
    // would do. Written twice anyway to keep the shape of the table uniform.
    label: 'contacts made',
    onWire: (filters) =>
      CONTACTS_MADE_KEYS.some((field) => filters[field] === true),
    inDraft: (filters) =>
      CONTACTS_MADE_KEYS.some((field) => filters[field] === true),
  },
]

const joinWithAnd = (labels: string[]): string => {
  if (labels.length <= 1) return labels[0] ?? ''
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}

// Whether asking the server is worth a round trip. False is a definite
// "cannot be empty", not a "don't know".
export const hasEmptiableCriteria = (
  filters: VoterFileBackendFilters,
): boolean => EMPTIABLE_CRITERIA.some((criterion) => criterion.onWire(filters))

// Names the draft's emptiable criteria rather than the one that was decisive.
//
// Which single criterion emptied the set is not knowable from the response and
// is not worth making knowable: the resolution intersects its inputs and
// reports one flag for the result, so pinning the blame would mean threading a
// reason through every id-filter path in the CRM for the sake of one sentence.
// Naming all of them is both true — their intersection is what came back empty
// — and enough to act on, since it points at the pills to go and look at.
//
// `hasSavedList` names the subject the same way `unpreviewableDisclosureSentence`
// does, and for the same reason: the who step reaches this sentence from two
// faces, and "this list" cites a list that does not exist when the candidate is
// building one out of pills.
//
// Null when the draft names none of them, which a proven-empty audience should
// never be — the check is only asked for a draft that carries one. Returning
// null rather than a subjectless sentence keeps that invariant visible instead
// of printing "No contacts match this list's  filters" if it is ever broken.
export const audienceEmptyMessage = (
  filters: VoterFileFilters,
  hasSavedList = true,
): string | null => {
  const labels = EMPTIABLE_CRITERIA.filter((criterion) =>
    criterion.inDraft(filters),
  ).map((criterion) => criterion.label)
  if (labels.length === 0) return null
  const named = joinWithAnd(labels)
  return hasSavedList
    ? `No contacts match this list’s ${named} filters. Pick a different list, or edit it in your contacts.`
    : `No contacts match your ${named} filters. Adjust them to continue.`
}
