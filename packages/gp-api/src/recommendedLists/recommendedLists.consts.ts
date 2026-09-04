// Both numbers below came out of the 26-district sizing eval described in
// docs/features/recommended-lists.md. That eval is re-runnable and these
// will move when it is re-run, so they live together in one file rather
// than beside the code that reads them.

// The smallest list worth recommending, as an ABSOLUTE count. Not a share
// of the district: the share barely moves across district size -- it is a
// property of the L2 turnout model, not of the district -- so a percentage
// floor would pass everything or fail everything. The count spans four
// orders of magnitude across real users, 320 people in Campti Town, LA
// against 16.9M in California statewide.
export const RECOMMENDED_LIST_SIZE_FLOOR = 250

// How many doors a door-knocking recommendation aims to cover. Precinct
// size, not district size, sets what the top precincts hold, so this is a
// door count rather than a percentage: roughly a week of canvassing almost
// anywhere.
export const DOOR_TARGET_VOTERS = 10_000

// Widening steps for a door list that lands under the floor. See
// RecommendedListsService.sizeDoorDraft for why the retry rarely runs.
export const DOOR_WIDENING_FACTOR = 2
export const MAX_DOOR_WIDENING_PASSES = 3
