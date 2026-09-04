// The one size floor, expressed as a share of the race's vote goal: a list
// holding less than this much of what the candidate needs to win cannot
// move the race, so it is not worth a card. Race-relative rather than
// absolute on purpose -- two candidates needing 400 and 40,000 votes in
// similarly sized districts are not owed the same minimum.
//
// Two families are exempt from it entirely rather than held to a smaller
// number, and RecommendedListsService's `sizeFloor` is where that is
// decided: door knocking, whose lists are three precincts by construction
// (DOOR_PRECINCT_COUNT), so a race-wide floor would suppress nearly all of
// them; and the id'd-supporter variants, which always appear beside a
// larger recommendation for the same intent, so a small supporter list is
// additive rather than the candidate's only option.
//
// Came out of the 26-district sizing eval described in
// docs/features/recommended-lists.md, which is re-runnable -- expect this to
// move when it is re-run.
export const VOTE_GOAL_FLOOR_SHARE = 0.25
