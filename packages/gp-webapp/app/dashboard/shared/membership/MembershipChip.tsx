'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ProBadge } from '@styleguide'
import { ShieldCheckIcon } from '@styleguide/components/ui/icons'
import { trackEvent } from 'helpers/analyticsHelper'
import { CAMPAIGN_VERIFICATION_PATH } from 'app/dashboard/campaign-verification/campaignVerificationPath'
import {
  SMS_CUTOFF_COPY,
  formatSmsCutoffDate,
} from 'app/dashboard/campaign-verification/verificationCopy'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'
import type { MembershipState } from './deriveMembershipState'
import { useMembershipState } from './useMembershipState'
import { MEMBERSHIP_COPY } from './membershipCopy'
import { ProPitchDialog } from './ProPitchDialog'
import { PinDialog } from './PinDialog'
import {
  isMembershipSurfaceVisible,
  MEMBERSHIP_CLICK_EVENTS,
  resolveMembershipAction,
} from './MembershipBanner'

const CHIP_CLASS_NAME =
  'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full bg-info-50 px-2.5 text-xs font-semibold text-primary'

// Same shape as the banner's copy: a countdown while the window is closing,
// and nothing for a cleared or closed Pro campaign, which never shows the
// chip.
const verificationLabel = (
  state: MembershipState,
  countdownCutoff: string | null,
): string | null => {
  switch (state.texting) {
    case 'needs_verification':
      return countdownCutoff
        ? SMS_CUTOFF_COPY.countdownChip(countdownCutoff)
        : MEMBERSHIP_COPY.chip.needsVerification
    case 'in_review':
      return MEMBERSHIP_COPY.chip.inReview
    case 'awaiting_pin':
      return MEMBERSHIP_COPY.chip.awaitingPin
    case 'closed':
    case 'cleared':
      return null
  }
}

export const MembershipChip = (): React.JSX.Element | null => {
  const router = useRouter()
  const pathname = usePathname()
  const { ready, state, tcrCompliance } = useMembershipState()
  const { smsCompliance, smsCutoffDate } = useSmsCompliance()
  const [pitchOpen, setPitchOpen] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)

  const visible = Boolean(ready && isMembershipSurfaceVisible(state))

  if (!visible || !state) return null

  const action = resolveMembershipAction(state)
  const label = verificationLabel(
    state,
    smsCompliance === 'closing' && smsCutoffDate
      ? formatSmsCutoffDate(smsCutoffDate)
      : null,
  )
  if (state.tier === 'pro' && label === null) return null

  const handleClick = () => {
    if (action) {
      trackEvent(MEMBERSHIP_CLICK_EVENTS[action], { path: pathname })
    }
    if (action === 'pitch') setPitchOpen(true)
    else if (action === 'verify') router.push(CAMPAIGN_VERIFICATION_PATH)
    else if (action === 'pin') setPinOpen(true)
  }

  const body =
    state.tier === 'free' ? (
      <>
        <span>{MEMBERSHIP_COPY.chip.joinLead}</span>
        <ProBadge size="small" />
        <span>{MEMBERSHIP_COPY.chip.joinTail}</span>
      </>
    ) : (
      <>
        <ShieldCheckIcon className="size-3.5" aria-hidden />
        {label}
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
      {pitchOpen && (
        <ProPitchDialog
          open
          onOpenChange={setPitchOpen}
          source="navigation"
          channel="generic"
        />
      )}
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
