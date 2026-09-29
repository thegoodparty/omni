'use client'

import { useEffect, useRef } from 'react'
import { InfoIcon } from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { BANNER_COPY, GATE_NOUN, type GateChannel } from './gateCopy'
import type { OutreachGateState } from './useOutreachGate'

interface GateBannerProps {
  channel: GateChannel
  state: OutreachGateState
  onOpenExplainer: () => void
}

// Texting (sms) covers every gate requirement; every other channel only
// ever reaches 'pro' (see useOutreachGate's deriveRequirement).
const bannerLine = (
  channel: GateChannel,
  state: OutreachGateState,
): string | null => {
  const { requirement } = state
  if (requirement === null) return null

  if (channel === 'sms') {
    const noun = GATE_NOUN.sms
    if (requirement === 'pro') return BANNER_COPY.twoStepFree(noun)
    if (requirement === 'verify') return BANNER_COPY.needsVerification(noun)
    if (requirement === 'in_review') return BANNER_COPY.inReview
    return BANNER_COPY.awaitingPin
  }

  if (channel === 'door') return BANNER_COPY.door
  if (channel === 'phone-bank') return BANNER_COPY.phoneBank
  return BANNER_COPY.robocall
}

// The footer's tinted, tappable one-liner (design: complianceBanner). A
// React element is truthy even when it renders null, so OutreachFlowShell's
// `showFooter` can't tell a gated banner from an ungated one by the prop
// alone — callers must gate the JSX itself:
// `banner={state.requirement ? <GateBanner ... /> : undefined}`. The null
// return below is a defensive fallback for a caller that doesn't, not the
// mechanism a mounting flow should rely on.
export const GateBanner = ({
  channel,
  state,
  onOpenExplainer,
}: GateBannerProps): React.JSX.Element | null => {
  const line = bannerLine(channel, state)
  const visible = line !== null

  // One view per appearance: a requirement moving on while the banner stays
  // on screen (PIN issued, review cleared) is not a second view.
  const requirementRef = useRef(state.requirement)
  requirementRef.current = state.requirement
  useEffect(() => {
    if (!visible) return
    trackEvent(EVENTS.Outreach.Gate.BannerViewed, {
      channel,
      requirement: requirementRef.current,
    })
  }, [visible, channel])

  if (line === null) return null

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenExplainer}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenExplainer()
        }
      }}
      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-light px-4 py-2.5"
    >
      <p className="min-w-0 text-center text-sm leading-snug">{line}</p>
      <InfoIcon className="size-[15px] shrink-0 text-primary" aria-hidden />
    </div>
  )
}

export default GateBanner
