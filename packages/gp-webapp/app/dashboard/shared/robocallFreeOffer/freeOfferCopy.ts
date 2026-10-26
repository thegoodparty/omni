import {
  ROBOCALL_FREE_OFFER_VARIANT,
  type RecommendedList,
} from '@goodparty_org/contracts'

// Candidate-facing copy for the free election-eve robocall offer, in one
// place so every surface says the same thing.

// The one fixed line (product, 2026-10-21). "A selection of precincts" is
// the disclosure: the precincts are chosen for the candidate.
export const FREE_OFFER_TITLE =
  'Send a free promotional election-eve robocall to landlines in a selection of precincts'

// Badge text: the tile and the Home card eyebrow are uppercase by design,
// the purpose option and the section heading are not.
export const FREE_OFFER_BADGE = 'Free offer'

// Calls rather than dollars (product, 2026-10-26), rounded down so "about"
// never overstates what the offer covers.
const approxCalls = (coveredCalls: number): string =>
  (Math.floor(coveredCalls / 100) * 100).toLocaleString('en-US')

export const freeOfferHomeBody = (
  count: number,
  coveredCalls: number,
): string =>
  count <= coveredCalls
    ? `Free for all ${count.toLocaleString('en-US')} landline voters on this ` +
      'list, called on Nov 2, the day before Election Day.'
    : `Free for about ${approxCalls(coveredCalls)} of the ` +
      `${count.toLocaleString('en-US')} landline voters on this list, called ` +
      'on Nov 2, the day before Election Day.'

// What a recommendation is saved as. The offer's list is named as free, so
// the candidate can tell it apart among their saved lists without a badge.
export const savedRecommendedListName = (
  recommendation: Pick<RecommendedList, 'variant' | 'copy'>,
): string =>
  recommendation.variant === ROBOCALL_FREE_OFFER_VARIANT
    ? FREE_OFFER_LIST_NAME
    : recommendation.copy.title

export const FREE_OFFER_LIST_NAME =
  'Free robocall: landline voters in a selection of precincts'

export const freeOfferAudienceNote = (coveredCalls: number | null): string =>
  `Free for up to about ${approxCalls(coveredCalls ?? 0)} calls. This list ` +
  "is set for you and can't be edited."
