'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ProBadge } from '@styleguide'
import { ShieldCheckIcon } from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useOutreachProGatingV2Flag } from 'app/shared/experiments/outreachProGatingV2Flag'
import { CAMPAIGN_VERIFICATION_PATH } from 'app/dashboard/campaign-verification/campaignVerificationPath'
import type { MembershipState } from './deriveMembershipState'
import { useMembershipState } from './useMembershipState'
import { MEMBERSHIP_COPY } from './membershipCopy'
import { ProPitchDialog } from './ProPitchDialog'
import { PinDialog } from './PinDialog'
import {
  isMembershipSurfaceVisible,
  resolveMembershipAction,
} from './MembershipBanner'

const chipCopy = (state: MembershipState): string => {
  if (state.tier === 'free') return MEMBERSHIP_COPY.chip.free
  if (state.texting === 'awaiting_pin') return MEMBERSHIP_COPY.chip.awaitingPin
  if (state.texting === 'in_review') return MEMBERSHIP_COPY.chip.inReview
  return MEMBERSHIP_COPY.chip.needsVerification
}

export const MembershipChip = (): React.JSX.Element | null => {
  const router = useRouter()
  const { enabled } = useOutreachProGatingV2Flag(false)
  const { ready, state, tcrCompliance } = useMembershipState({ enabled })
  const [pitchOpen, setPitchOpen] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)

  if (!enabled || !ready || !isMembershipSurfaceVisible(state) || !state) {
    return null
  }

  const action = resolveMembershipAction(state)

  const handleClick = () => {
    trackEvent(EVENTS.ProUpgrade.Membership.ChipClicked, { action })
    if (action === 'pitch') setPitchOpen(true)
    else if (action === 'verify') router.push(CAMPAIGN_VERIFICATION_PATH)
    else if (action === 'pin') setPinOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={!action}
        className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary-light px-2.5 text-xs font-semibold text-primary disabled:cursor-default"
      >
        {state.tier === 'free' ? (
          <ProBadge size="small" />
        ) : (
          <ShieldCheckIcon className="size-3.5" aria-hidden />
        )}
        {chipCopy(state)}
      </button>
      {pitchOpen && <ProPitchDialog open onOpenChange={setPitchOpen} />}
      {pinOpen && (
        <PinDialog
          open
          onOpenChange={setPinOpen}
          tcrCompliance={tcrCompliance}
        />
      )}
    </>
  )
}
