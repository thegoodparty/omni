'use client'

import type { TcrCompliance } from 'helpers/types'
import { useOutreachProGatingV2Flag } from 'app/shared/experiments/outreachProGatingV2Flag'
import { useMembershipState } from 'app/dashboard/shared/membership/useMembershipState'
import type { MembershipState } from 'app/dashboard/shared/membership/deriveMembershipState'
import type { GateChannel } from './gateCopy'

export type GateRequirement = 'pro' | 'verify' | 'in_review' | 'pin' | null

export interface OutreachGateState {
  // Flag on and membership ready — the flow can trust `requirement`.
  enabled: boolean
  requirement: GateRequirement
  // Texting channels (sms only) need Pro AND verification; every other
  // channel needs Pro alone.
  twoStep: boolean
  membership: MembershipState | null
  tcrCompliance: TcrCompliance | null
}

// A Serve org is never gated (milestone 1's MembershipBanner reads the same
// way — see isMembershipSurfaceVisible), regardless of tier or texting state.
const deriveRequirement = (
  channel: GateChannel,
  membership: MembershipState,
): GateRequirement => {
  if (membership.isElectedOffice) return null
  if (membership.tier === 'free') return 'pro'
  if (channel !== 'sms') return null
  if (membership.texting === 'needs_verification') return 'verify'
  if (membership.texting === 'in_review') return 'in_review'
  if (membership.texting === 'awaiting_pin') return 'pin'
  return null
}

// Thin over the flag + membership hooks: maps them to what a channel flow
// needs to decide whether it must pause, and on which screen. A later task
// mounts this inside each channel flow alongside GateBanner/OutreachGate.
export const useOutreachGate = (channel: GateChannel): OutreachGateState => {
  const { enabled: flagEnabled } = useOutreachProGatingV2Flag(false)
  const {
    ready: membershipReady,
    state,
    tcrCompliance,
  } = useMembershipState({
    enabled: flagEnabled,
  })

  const enabled = flagEnabled && membershipReady
  const twoStep = channel === 'sms'

  return {
    enabled,
    requirement: enabled && state ? deriveRequirement(channel, state) : null,
    twoStep,
    membership: state,
    tcrCompliance,
  }
}
