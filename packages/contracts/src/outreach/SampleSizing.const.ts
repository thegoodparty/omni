import { MAX_LIST_SAMPLE_SIZE } from '../people/ListSample.schema'

/**
 * How GoodParty sizes a text send that only needs a read, not everyone.
 * Polls set these first (ENG-4825, ENG-4771); priorities, the Chief of Staff
 * and the Campaign Manager size their samples the same way.
 */

/** The replies a send is sized to bring back. */
export const SAMPLE_TARGET_REPLIES = 83

/** The reply rate a text is sized with when there is no history to go on. */
export const DEFAULT_TEXT_REPLY_RATE = 0.03

/** A read is high confidence past this many replies... */
export const HIGH_CONFIDENCE_MIN_REPLIES = 75

/** ...or once the replies reach this share of everyone who could have been asked. */
export const HIGH_CONFIDENCE_MIN_SHARE = 0.1

/** Billing works in tenths of a cent, so a text's price stays an integer. */
export const PRICE_PER_TEXT_TENTH_CENTS = 35

/** In dollars. */
export const PRICE_PER_TEXT = PRICE_PER_TEXT_TENTH_CENTS / 1000

/**
 * The people to text for `SAMPLE_TARGET_REPLIES` replies, less any already
 * in hand. Never more than the audience holds or one draw can take.
 */
export const recommendedSampleSize = (params: {
  audience: number
  replyRate?: number
  repliesAlready?: number
}): number => {
  const usable = Math.min(params.audience, MAX_LIST_SAMPLE_SIZE)
  const needed =
    (SAMPLE_TARGET_REPLIES - (params.repliesAlready ?? 0)) /
    (params.replyRate ?? DEFAULT_TEXT_REPLY_RATE)
  return Math.max(0, Math.ceil(Math.min(needed, usable)))
}

export const isHighConfidence = (params: {
  replies: number
  population: number
}): boolean =>
  params.replies > HIGH_CONFIDENCE_MIN_REPLIES ||
  (params.population > 0 &&
    params.replies / params.population >= HIGH_CONFIDENCE_MIN_SHARE)
