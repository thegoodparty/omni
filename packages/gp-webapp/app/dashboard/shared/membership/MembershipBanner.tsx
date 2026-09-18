'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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
import type { MembershipState } from './deriveMembershipState'
import { useMembershipState } from './useMembershipState'
import { MEMBERSHIP_COPY } from './membershipCopy'
import { ProPitchDialog } from './ProPitchDialog'
import { PinDialog } from './PinDialog'

export type MembershipAction = 'pitch' | 'verify' | 'pin' | null

export const resolveMembershipAction = (
  state: MembershipState,
): MembershipAction => {
  if (state.isElectedOffice) return null
  if (state.tier === 'free') return 'pitch'
  if (state.texting === 'needs_verification') return 'verify'
  if (state.texting === 'awaiting_pin') return 'pin'
  return null
}

export const isMembershipSurfaceVisible = (
  state: MembershipState | null,
): boolean =>
  Boolean(
    state &&
    !state.isElectedOffice &&
    !(state.tier === 'pro' && state.texting === 'cleared'),
  )

const BANNER_CLASS_NAME =
  'mb-2 flex w-full flex-col items-start gap-1.5 rounded-lg bg-primary-light p-3 text-left'

const bannerCopy = (state: MembershipState) => {
  if (state.tier === 'free') return MEMBERSHIP_COPY.banner.free
  if (state.texting === 'awaiting_pin') {
    return MEMBERSHIP_COPY.banner.awaitingPin
  }
  if (state.texting === 'in_review') return MEMBERSHIP_COPY.banner.inReview
  return MEMBERSHIP_COPY.banner.needsVerification
}

export const MembershipBanner = (): React.JSX.Element | null => {
  const router = useRouter()
  const { enabled } = useOutreachProGatingV2Flag(false)
  const { exposure } = useFeatureFlags()
  const { ready, state, tcrCompliance } = useMembershipState({ enabled })
  const [pitchOpen, setPitchOpen] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)

  const visible = Boolean(enabled && ready && isMembershipSurfaceVisible(state))

  // Exposure belongs to the population the experiment can treat, so it waits
  // for a membership surface to actually render. Reading the flag would expose
  // every candidate the flag is on for, Serve orgs and cleared Pro campaigns
  // included, diluting the measured effect.
  useEffect(() => {
    if (!visible) return
    exposure(OUTREACH_PRO_GATING_V2_FLAG_KEY)
  }, [visible, exposure])

  useEffect(() => {
    if (!visible) return
    trackEvent(EVENTS.ProUpgrade.Membership.BannerViewed, {
      tier: state?.tier,
      texting: state?.texting,
    })
  }, [visible, state?.tier, state?.texting])

  if (!visible || !state) return null

  const action = resolveMembershipAction(state)
  const copy = bannerCopy(state)

  const handleClick = () => {
    trackEvent(EVENTS.ProUpgrade.Membership.BannerClicked, { action })
    if (action === 'pitch') setPitchOpen(true)
    else if (action === 'verify') router.push(CAMPAIGN_VERIFICATION_PATH)
    else if (action === 'pin') setPinOpen(true)
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
