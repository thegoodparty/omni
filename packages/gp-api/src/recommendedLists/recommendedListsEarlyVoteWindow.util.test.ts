import { describe, expect, it } from 'vitest'
import { RECOMMENDED_LIST_VARIANT_VALUES } from '@goodparty_org/contracts'
import {
  globalVariantOrder,
  isEarlyVoteWindowOpen,
} from './recommendedListsEarlyVoteWindow.util'

describe('isEarlyVoteWindowOpen', () => {
  const election = '2026-11-03'

  it('opens on the BallotReady start and closes two days out, inclusive', () => {
    expect(isEarlyVoteWindowOpen('2026-09-23', election, '2026-09-24')).toBe(
      false,
    )
    expect(isEarlyVoteWindowOpen('2026-09-24', election, '2026-09-24')).toBe(
      true,
    )
    expect(isEarlyVoteWindowOpen('2026-11-01', election, '2026-09-24')).toBe(
      true,
    )
    expect(isEarlyVoteWindowOpen('2026-11-02', election, '2026-09-24')).toBe(
      false,
    )
  })

  it('falls back to two weeks out when BallotReady has no start', () => {
    expect(isEarlyVoteWindowOpen('2026-10-19', election, null)).toBe(false)
    expect(isEarlyVoteWindowOpen('2026-10-20', election, null)).toBe(true)
  })

  it('has no window without a usable election date', () => {
    expect(isEarlyVoteWindowOpen('2026-10-20', null, '2026-09-24')).toBe(false)
    expect(isEarlyVoteWindowOpen('2026-10-20', 'soon', '2026-09-24')).toBe(
      false,
    )
  })
})

describe('globalVariantOrder', () => {
  it('leaves the early-vote variants out when the window is closed', () => {
    const order = globalVariantOrder(false)
    expect(order.some((variant) => variant.startsWith('earlyVote'))).toBe(false)
    expect(order).toEqual(
      RECOMMENDED_LIST_VARIANT_VALUES.filter(
        (variant) => !variant.startsWith('earlyVote'),
      ),
    )
  })

  it('ranks them after introduce and ahead of persuade when open', () => {
    expect(globalVariantOrder(true)).toEqual([
      'introNeverIded',
      'earlyVoteSupporters',
      'earlyVoteAffinity',
      'earlyVoteIdeology',
      'persuadeAffinity',
      'persuadeIdeology',
      'persuadeUndecided',
      'eventSupporters',
      'eventAffinity',
      'eventIdeology',
      'electionDaySupporters',
      'electionDayAffinity',
      'electionDayIdeology',
      'freeOfferElectionEveRobocall',
    ])
  })
})
