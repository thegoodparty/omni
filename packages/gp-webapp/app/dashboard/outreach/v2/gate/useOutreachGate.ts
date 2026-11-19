'use client'

import type { TcrCompliance } from 'helpers/types'
import { useMembershipState } from 'app/dashboard/shared/membership/useMembershipState'
import type { MembershipState } from 'app/dashboard/shared/membership/deriveMembershipState'
import type { GateChannel } from './gateCopy'

export type GateRequirement =
  | 'pro'
  | 'verify'
  | 'in_review'
  | 'pin'
  | 'closed'
  | null

export interface OutreachGateState {
  // Membership is ready — the flow can trust `requirement`.
  enabled: boolean
  // Membership has loaded, so `requirement` is final rather than a
  // placeholder null.
  resolved: boolean
  requirement: GateRequirement
  // Texting channels (sms only) need Pro AND verification; every other
  // channel needs Pro alone.
  twoStep: boolean
  membership: MembershipState | null
  tcrCompliance: TcrCompliance | null
}

// A Serve org is never gated (milestone 1's MembershipBanner reads the same
// way — see isMembershipSurfaceVisible), regardless of tier or texting state.
// Closed texting comes before the Pro check: Pro cannot reopen it, so a free
// candidate's text gets the cutoff notice rather than a pitch for a send
// that could never go out.
const deriveRequirement = (
  channel: GateChannel,
  membership: MembershipState,
): GateRequirement => {
  if (membership.isElectedOffice) return null
  if (channel === 'sms' && membership.texting === 'closed') return 'closed'
  if (membership.tier === 'free') return 'pro'
  if (channel !== 'sms') return null
  switch (membership.texting) {
    case 'needs_verification':
      return 'verify'
    case 'in_review':
      return 'in_review'
    case 'awaiting_pin':
      return 'pin'
    case 'closed':
      return 'closed'
    case 'cleared':
      return null
  }
}

// Thin over the membership hook: maps it to what a channel flow needs to
// decide whether it must pause, and on which screen.
export const useOutreachGate = (channel: GateChannel): OutreachGateState => {
  const { ready: membershipReady, state, tcrCompliance } = useMembershipState()

  const twoStep = channel === 'sms'

  return {
    enabled: membershipReady,
    resolved: membershipReady,
    requirement:
      membershipReady && state ? deriveRequirement(channel, state) : null,
    twoStep,
    membership: state,
    tcrCompliance,
  }
}
