import {
  ROBOCALL_FREE_OFFER_VARIANT,
  type RecommendedList,
} from '@goodparty_org/contracts'

// Candidate-facing copy for the free election-eve robocall offer, in one
// place so every surface says the same thing.

// The headline (product, 2026-10-21; cut to 12 words, 2026-10-26). "Selected
// precincts" is the disclosure: the precincts are chosen for the candidate.
// gp-api's plan task title says the same thing.
export const FREE_OFFER_TITLE =
  'Send a free promotional robocall to landline voters in selected precincts'

// Badge text, sentence case wherever it is a badge. The Home card and list
// card eyebrows render it uppercase, like their "Recommended" siblings.
export const FREE_OFFER_BADGE = 'Free offer'

// Home sells the outcome; the count and the date live in the flow it opens.
export const FREE_OFFER_HOME_BODY =
  'Reach voters the day before Election Day, at no cost to your campaign.'

// Voter data's section heading over the offer's list.
export const FREE_OFFER_SECTION_TITLE = 'Free election-eve robocall'

// Calls rounded down, so "about" never overstates what the offer covers.
const approxCalls = (coveredCalls: number): string =>
  (Math.floor(coveredCalls / 100) * 100).toLocaleString('en-US')

// Counted in voters, like the list card beside it: one call per voter. The
// offer only covers this list as set, so the note says it can't be edited.
export const freeOfferAudienceNote = (
  count: number | null,
  coveredCalls: number | null,
): string => {
  const covered =
    count === null
      ? 'the landline voters'
      : coveredCalls === null || count <= coveredCalls
        ? `all ${count.toLocaleString('en-US')} landline voters`
        : `about ${approxCalls(coveredCalls)} of the ` +
          `${count.toLocaleString('en-US')} landline voters`
  return `Free for ${covered} on this list, which can't be edited.`
}

// What a recommendation is saved as. "Promotional" reads true both while the
// offer runs and after it ends, so the saved list never promises a free call
// it can no longer give.
export const savedRecommendedListName = (
  recommendation: Pick<RecommendedList, 'variant' | 'copy'>,
): string =>
  recommendation.variant === ROBOCALL_FREE_OFFER_VARIANT
    ? FREE_OFFER_LIST_NAME
    : recommendation.copy.title

export const FREE_OFFER_LIST_NAME =
  'Promotional robocall: landline voters in selected precincts'
