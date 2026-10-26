import { CONTACTS_MADE_BUCKET_FIELDS } from '@/contacts/utils/voterFileFilter.utils'
import type { ContactsFilterResolutionInput } from '@/contacts/services/contacts.service'

// Two different failures used to share one sentence, and the sentence
// described only one of them.
//
// A create can find nobody for two unrelated reasons. Either the list's own
// filters resolve to an empty person-id set — which happens before the
// polygon is looked at, and would happen the same way for any polygon — or
// the audience is real and the drawn shape encloses none of it. Both threw
// "No matching voters inside this turf — widen the area or the filters",
// so the first one blamed the boundary, and QA duly reported a valid
// selection being rejected: the area was fine, and redrawing it (the only
// thing the message suggested) could not have helped.
//
// The first case is also the easy one to hit without knowing it, because the
// criteria that cause it are exactly the criteria the map cannot shade. The
// pack encodes no support status, no prior outreach and no contacts-made, so
// a list cut by one of them shades as the whole district: the candidate is
// looking at a map covered in matching voters while the audience behind it
// is empty. See UNSHADEABLE_LIST_CRITERIA in gp-webapp's savedListFilters.ts,
// which exists for the other half of this same gap.

// The criteria that can resolve to nobody, in the words the CRM's own filter
// pills use. Only these three: everything else on a VoterFileFilter becomes a
// column predicate that narrows a query, and a query returning no rows is the
// polygon case below, not this one. These instead resolve to a person-id set
// first, and an empty set short-circuits before any people-db scan happens.
const EMPTIABLE_CRITERIA: Array<{
  label: string
  applies: (filter: ContactsFilterResolutionInput) => boolean
}> = [
  {
    label: 'support status',
    applies: (filter) => (filter.supportStatus?.length ?? 0) > 0,
  },
  {
    label: 'previous outreach',
    applies: (filter) => (filter.activityConditions?.length ?? 0) > 0,
  },
  {
    label: 'contacts made',
    applies: (filter) =>
      CONTACTS_MADE_BUCKET_FIELDS.some(({ field }) => filter[field]),
  },
]

const joinLabels = (labels: string[]): string =>
  labels.length <= 1
    ? (labels[0] ?? '')
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`

// Names the list's criteria rather than the one that was decisive.
//
// Which single criterion emptied the set is not knowable here and is not
// worth making knowable: the resolution intersects its inputs
// (intersectIdFilterResolutions) and reports one 'empty' for the result, so
// pinning the blame would mean threading a reason through every id-filter
// path in the CRM for the sake of one sentence. Naming all of the list's
// emptiable criteria is both true — their intersection is what came back
// empty — and enough to act on, since it points at the pills to go and look
// at. The fallback covers a list that carries none of them, which should not
// reach here but is not worth a crash if it does.
// Serve says "constituents" for all three of these: they are the sentences a
// create failure puts in front of a user, and an elected official is never
// told about voters (docs/product-vocabulary.md). The noun is the only
// difference — the diagnosis each sentence makes is the same on both surfaces.
const people = (isServe: boolean): string =>
  isServe ? 'constituents' : 'voters'

export const emptyAudienceMessage = (
  filter: ContactsFilterResolutionInput,
  isServe: boolean,
): string => {
  const labels = EMPTIABLE_CRITERIA.filter((criterion) =>
    criterion.applies(filter),
  ).map((criterion) => criterion.label)
  const named = joinLabels(labels)
  const noun = people(isServe)
  return named
    ? `No ${noun} match this list's ${named} filters — edit the list or pick a different audience`
    : `No ${noun} match this list's filters — edit the list or pick a different audience`
}

// The polygon case. This one really is about the boundary: the audience
// exists, and the shape encloses none of it.
export const emptyTurfMessage = (isServe: boolean): string =>
  `No matching ${people(isServe)} inside this turf — widen the area or the filters`
