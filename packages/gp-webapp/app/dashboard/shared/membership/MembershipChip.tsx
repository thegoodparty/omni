'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ProBadge } from '@styleguide'
import { ShieldCheckIcon } from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useFeatureFlags } from 'app/shared/experiments/FeatureFlagsProvider'
import {
  OUTREACH_PRO_GATING_V2_FLAG_KEY,
  useOutreachProGatingV2Flag,
} from 'app/shared/experiments/outreachProGatingV2Flag'
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

const CHIP_CLASS_NAME =
  'inline-flex h-7 items-center gap-1.5 rounded-full bg-primary-light px-2.5 text-xs font-semibold text-primary'

const chipCopy = (state: MembershipState): string => {
  if (state.tier === 'free') return MEMBERSHIP_COPY.chip.free
  if (state.texting === 'awaiting_pin') return MEMBERSHIP_COPY.chip.awaitingPin
  if (state.texting === 'in_review') return MEMBERSHIP_COPY.chip.inReview
  return MEMBERSHIP_COPY.chip.needsVerification
}

export const MembershipChip = (): React.JSX.Element | null => {
  const router = useRouter()
  const { enabled } = useOutreachProGatingV2Flag(false)
  const { exposure } = useFeatureFlags()
  const { ready, state, tcrCompliance } = useMembershipState({ enabled })
  const [pitchOpen, setPitchOpen] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)

  const visible = Boolean(enabled && ready && isMembershipSurfaceVisible(state))

  // The chip is the phone-only half of the same surface, so it takes the
  // exposure too (deduped per flag key by the provider) — otherwise a
  // candidate who never opens the desktop sidebar is treated but uncounted.
  useEffect(() => {
    if (!visible) return
    exposure(OUTREACH_PRO_GATING_V2_FLAG_KEY)
  }, [visible, exposure])

  if (!visible || !state) return null

  const action = resolveMembershipAction(state)

  const handleClick = () => {
    trackEvent(EVENTS.ProUpgrade.Membership.ChipClicked, { action })
    if (action === 'pitch') setPitchOpen(true)
    else if (action === 'verify') router.push(CAMPAIGN_VERIFICATION_PATH)
    else if (action === 'pin') setPinOpen(true)
  }

  const body = (
    <>
      {state.tier === 'free' ? (
        <ProBadge size="small" />
      ) : (
        <ShieldCheckIcon className="size-3.5" aria-hidden />
      )}
      {chipCopy(state)}
    </>
  )

  return (
    <>
      {action ? (
        <button type="button" onClick={handleClick} className={CHIP_CLASS_NAME}>
          {body}
        </button>
      ) : (
        // In review has nothing to click. A disabled button is skipped by
        // screen-reader and keyboard navigation, so the status is announced
        // instead of being unreachable.
        <span role="status" className={CHIP_CLASS_NAME}>
          {body}
        </span>
      )}
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
