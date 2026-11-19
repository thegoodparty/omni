import { format, parseISO, subDays } from 'date-fns'
import {
  RECOMMENDED_LIST_VARIANT_VALUES,
  type RecommendedListVariant,
} from '@goodparty_org/contracts'
import { RECOMMENDED_LISTS_REGISTRY } from './recommendedLists.registry'

// When BallotReady has no early-voting milestone for the election, assume it
// opens two weeks out -- the same fallback the campaign plan document uses
// for its "Early voting begins" row, so the two never disagree.
export const EARLY_VOTE_FALLBACK_START_DAYS = 14

// Chasing an early vote stops two days before Election Day: what is left of
// early voting by then is too short for a contact to turn into a ballot, and
// the election-day lists take over.
export const EARLY_VOTE_CHASE_END_DAYS = 2

const isoDay = (date: Date): string => format(date, 'yyyy-MM-dd')

// Whether the campaign is inside its early-vote chase window on `today`, all
// three as yyyy-MM-dd strings (string comparison is chronological for that
// format). Inclusive at both ends. No election date means no window: there
// is nothing to count back from, and showing the cards to a campaign whose
// election we do not know would put them in front of the persuade lists for
// no reason.
export const isEarlyVoteWindowOpen = (
  today: string,
  electionDate: string | null,
  earlyVotingStart: string | null,
): boolean => {
  if (!electionDate) return false
  const election = parseISO(electionDate)
  if (Number.isNaN(election.getTime())) return false
  const start =
    earlyVotingStart ??
    isoDay(subDays(election, EARLY_VOTE_FALLBACK_START_DAYS))
  const end = isoDay(subDays(election, EARLY_VOTE_CHASE_END_DAYS))
  return today >= start && today <= end
}

const isEarlyVote = (variant: RecommendedListVariant): boolean =>
  RECOMMENDED_LISTS_REGISTRY[variant].intent === 'earlyVote'

const isIntroduce = (variant: RecommendedListVariant): boolean =>
  RECOMMENDED_LISTS_REGISTRY[variant].intent === 'introduce'

// The global set (the "recommended for you" cards, no channel or intent
// picked) is the only surface the window governs. Outside it the early-vote
// variants are left out; inside it they move up to sit right after the
// introduce list and ahead of persuade. Everything else keeps registry order.
// A candidate who asks for early voting by purpose, or arrives on a variant
// from the voter data page, is not routed through here and always gets the
// lists.
export const globalVariantOrder = (
  windowOpen: boolean,
): RecommendedListVariant[] => {
  const all = [...RECOMMENDED_LIST_VARIANT_VALUES]
  if (!windowOpen) return all.filter((variant) => !isEarlyVote(variant))
  return [
    ...all.filter(isIntroduce),
    ...all.filter(isEarlyVote),
    ...all.filter((variant) => !isIntroduce(variant) && !isEarlyVote(variant)),
  ]
}
