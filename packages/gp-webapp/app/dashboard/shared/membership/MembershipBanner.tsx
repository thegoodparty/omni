'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ProBadge } from '@styleguide'
import {
  ArrowRightIcon,
  ShieldCheckIcon,
} from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useFeatureFlags } from 'app/shared/experiments/FeatureFlagsProvider'
import {
  OUTREACH_PRO_GATING_V2_FLAG_KEY,
  useOutreachProGatingV2Flag,
} from 'app/shared/experiments/outreachProGatingV2Flag'
import { CAMPAIGN_VERIFICATION_PATH } from 'app/dashboard/campaign-verification/campaignVerificationPath'
import {
  SMS_CUTOFF_COPY,
  formatSmsCutoffDate,
} from 'app/dashboard/campaign-verification/verificationCopy'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'
import { composeOutreachHref } from 'app/dashboard/outreach/util/composeOutreachHref.util'
import type { MembershipState } from './deriveMembershipState'
import { useMembershipState } from './useMembershipState'
import { MEMBERSHIP_COPY } from './membershipCopy'
import { ProPitchDialog } from './ProPitchDialog'
import { PinDialog } from './PinDialog'

export type MembershipAction = 'pitch' | 'verify' | 'pin' | 'schedule' | null

// The unit rotates through these asks, so each press is its own event: the
// upgrade belongs to the Pro funnel, the other three to 10DLC.
export const MEMBERSHIP_CLICK_EVENTS: Record<
  Exclude<MembershipAction, null>,
  string
> = {
  pitch: EVENTS.ProUpgrade.Membership.BannerClicked,
  verify: EVENTS.ProUpgrade.Membership.VerificationBannerClicked,
  pin: EVENTS.ProUpgrade.Membership.PinBannerClicked,
  schedule: EVENTS.ProUpgrade.Membership.ScheduleBannerClicked,
}

export const resolveMembershipAction = (
  state: MembershipState,
): MembershipAction => {
  if (state.isElectedOffice) return null
  if (state.tier === 'free') return 'pitch'
  if (state.texting === 'needs_verification') return 'verify'
  if (state.texting === 'awaiting_pin') return 'pin'
  if (state.texting === 'cleared') return 'schedule'
  return null
}

// The compose link resumes the campaign's saved text draft when there is one
// and starts a new text otherwise, so the banner never has to know which.
export const MEMBERSHIP_SCHEDULE_HREF = composeOutreachHref(
  'text',
  'navigation',
)

// A free campaign with cleared texting is a lapsed Pro subscriber whose 10DLC
// registration is still approved. Cleared texting alone doesn't hide the
// surface: without Pro they can't send, so the upsell stays. A cleared Pro
// campaign gets the ask to schedule its text. A Pro campaign whose texting
// window gp-api has closed has nothing left to do here, so the surface stays
// out of the way rather than announcing the gap; a free one still gets the
// Pro pitch, which is not about texting.
export const isMembershipSurfaceVisible = (
  state: MembershipState | null,
): boolean =>
  Boolean(
    state &&
    !state.isElectedOffice &&
    !(state.tier === 'pro' && state.texting === 'closed'),
  )

const BANNER_CLASS_NAME =
  'mb-2 flex w-full flex-col items-start gap-1.5 rounded-lg bg-info-50 p-3 text-left'

// `countdownCutoff` is the last open day while gp-api reports the window
// closing. A closed Pro campaign never shows the banner
// (isMembershipSurfaceVisible), so it has no copy.
const bannerCopy = (
  state: MembershipState,
  countdownCutoff: string | null,
): { body: string; cta: string | null } | null => {
  if (state.tier === 'free') return MEMBERSHIP_COPY.banner.free
  switch (state.texting) {
    case 'needs_verification':
      return countdownCutoff
        ? {
            body: SMS_CUTOFF_COPY.countdownBanner(countdownCutoff),
            cta: MEMBERSHIP_COPY.banner.needsVerification.cta,
          }
        : MEMBERSHIP_COPY.banner.needsVerification
    case 'in_review':
      return MEMBERSHIP_COPY.banner.inReview
    case 'awaiting_pin':
      return MEMBERSHIP_COPY.banner.awaitingPin
    case 'cleared':
      return MEMBERSHIP_COPY.banner.cleared
    case 'closed':
      return null
  }
}

export const MembershipBanner = (): React.JSX.Element | null => {
  const router = useRouter()
  const pathname = usePathname()
  const { enabled } = useOutreachProGatingV2Flag(false)
  const { exposure } = useFeatureFlags()
  const { ready, state, tcrCompliance } = useMembershipState({ enabled })
  const { smsCompliance, smsCutoffDate } = useSmsCompliance()
  const [pitchOpen, setPitchOpen] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)

  const visible = Boolean(enabled && ready && isMembershipSurfaceVisible(state))

  // Exposure belongs to the population the experiment can treat, so it waits
  // for a membership surface to actually render. Reading the flag would expose
  // every candidate the flag is on for, Serve orgs and closed Pro campaigns
  // included, diluting the measured effect.
  useEffect(() => {
    if (!visible) return
    exposure(OUTREACH_PRO_GATING_V2_FLAG_KEY)
  }, [visible, exposure])

  if (!visible || !state) return null

  const action = resolveMembershipAction(state)
  const copy = bannerCopy(
    state,
    smsCompliance === 'closing' && smsCutoffDate
      ? formatSmsCutoffDate(smsCutoffDate)
      : null,
  )
  if (!copy) return null

  const handleClick = () => {
    if (action) {
      trackEvent(MEMBERSHIP_CLICK_EVENTS[action], { path: pathname })
    }
    if (action === 'pitch') setPitchOpen(true)
    else if (action === 'verify') router.push(CAMPAIGN_VERIFICATION_PATH)
    else if (action === 'pin') setPinOpen(true)
    else if (action === 'schedule') router.push(MEMBERSHIP_SCHEDULE_HREF)
  }

  const body = (
    <>
      {state.tier === 'free' ? (
        <ProBadge size="small" />
      ) : (
        <ShieldCheckIcon className="size-4 text-primary" aria-hidden />
      )}
      <span className="text-[13px] leading-snug text-foreground">
        {copy.body}
      </span>
      {copy.cta && (
        <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary">
          {copy.cta} <ArrowRightIcon className="size-3.5" aria-hidden />
        </span>
      )}
    </>
  )

  return (
    <>
      {action ? (
        <button
          type="button"
          onClick={handleClick}
          className={BANNER_CLASS_NAME}
        >
          {body}
        </button>
      ) : (
        // In review has nothing to click. A disabled button is skipped by
        // screen-reader and keyboard navigation, so the status is announced
        // instead of being unreachable.
        <div role="status" className={BANNER_CLASS_NAME}>
          {body}
        </div>
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
