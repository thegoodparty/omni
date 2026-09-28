import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'

// Does this saved list carry no narrowing criteria at all — i.e. is it, in
// substance, everyone?
//
// Every voter-file criterion is a boolean column defaulting to false
// (`prisma/schema/voterFileFilter.prisma`), so "no criterion is set" is
// checkable without naming a single one. That is what makes this drift-proof:
// a criterion added to that table later is a boolean too and is caught by the
// same test, where an allowlist of key names would quietly go stale and start
// reusing a filtered list as the universe.
//
// The non-boolean carriers below are listed because they are not booleans,
// not because the list is exhaustive. An unrecognized one leaves us treating
// a criteria-free list as filtered, so we create a fresh universe list — a
// duplicate the candidate can see and delete, rather than a silently wrong
// audience. That is the direction to be wrong in.
export const isCriteriaFreeList = (list: SegmentResponse): boolean =>
  Object.values(list).every((value) => typeof value !== 'boolean' || !value) &&
  !list.search &&
  !list.geoPoly &&
  !list.supportStatus?.length &&
  !list.activityConditions?.length &&
  !(Array.isArray(list.precincts) && list.precincts.length > 0)

// Which saved list IS the universe row.
//
// BOTH halves are load-bearing, and each one alone is wrong.
//
// Criteria alone is not enough: ENG-10960 lets a candidate save a
// criteria-free list under any name they like, and matching on criteria only
// would co-opt "Everyone on my street" as the universe — hiding their list
// from the picker's rows and relabelling their audience as the whole
// district.
//
// Name alone is not enough either, and that is the sharper failure: a
// candidate may name a FILTERED list "All voters", and reusing it would send
// a campaign that promised everyone to a subset, with nothing on screen
// saying so.
//
// So this only ever recognizes a list that looks like the one this feature
// creates: our label, and no criteria on it.
export const isUniverseList = (
  list: SegmentResponse,
  universeName: string,
): boolean => list.name === universeName && isCriteriaFreeList(list)
