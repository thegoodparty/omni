'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@styleguide'
import { ClockIcon, ShieldCheckIcon } from '@styleguide/components/ui/icons'
import Body2 from '@shared/typography/Body2'
import ProUpgradeFlow, {
  type ProUpgradeFlowPosition,
} from 'app/dashboard/pro-upgrade/components/ProUpgradeFlow'
import { PRO_UPGRADE_STEP } from 'app/dashboard/pro-upgrade/proUpgradeStep'
import CampaignVerificationSteps, {
  type VerificationStep,
} from 'app/dashboard/campaign-verification/components/CampaignVerificationSteps'
import { PinDialog } from 'app/dashboard/shared/membership/PinDialog'
import {
  BANNER_COPY,
  GATE_CHROME_COPY,
  GATE_NOTICE_COPY,
  GATE_NOUN,
  type GateChannel,
} from './gateCopy'
import type { GateRequirement, OutreachGateState } from './useOutreachGate'

interface OutreachGateProps {
  channel: GateChannel
  state: OutreachGateState
  // The gate screens are showing (the flow is paused).
  open: boolean
  onExit: () => void
  onComplete: () => void
  // Whether the Pro screen opens on the "Join Pro to send this campaign"
  // interstitial or straight on the wizard's first step. Only the save that
  // just wrote the draft shows the pitch (design: sgOpen's pause screen);
  // coming back to a saved draft, or pressing Join Pro on the explainer that
  // already made the pitch, skips it (design: sgOpen(..., skipPause)).
  showInterstitial?: boolean
  // What the sheet's header should read while a gate screen is up: the
  // phase overline in place of the channel badge, and the gate's own step
  // position in place of the flow's (design: renderSgModal). `totalSteps`
  // 0 is a screen that draws no header. Null once the gate unmounts.
  onChromeChange?: (chrome: GateChrome | null) => void
}

export interface GateChrome {
  overline: string
  currentStep: number
  totalSteps: number
}

// The gate screens themselves, mounted in place of a paused flow's step body:
// the Pro interstitial, campaign verification, the PIN dialog, or an
// in-review notice. None of them offers Delete (design: no gate screen does)
// — a saved draft is discarded from its history row's drawer.
export const OutreachGate = ({
  channel,
  state,
  open,
  onExit,
  onComplete,
  showInterstitial = true,
  onChromeChange,
}: OutreachGateProps): React.JSX.Element | null => {
  // Read through a ref so the callbacks handed to the wizard and the
  // verification steps stay stable — both re-fire their position effects
  // on a new callback identity, which would loop through the host's state.
  const onChromeChangeRef = useRef(onChromeChange)
  onChromeChangeRef.current = onChromeChange
  useEffect(() => () => onChromeChangeRef.current?.(null), [])

  const reportProPosition = useCallback((position: ProUpgradeFlowPosition) => {
    onChromeChangeRef.current?.({
      overline: GATE_CHROME_COPY.upgrade,
      ...position,
    })
  }, [])
  const reportVerifyStep = useCallback((step: VerificationStep) => {
    onChromeChangeRef.current?.({
      overline: GATE_CHROME_COPY.verification,
      currentStep: step === 'intro' ? 1 : step === 'form' ? 2 : 0,
      totalSteps: step === 'submitted' ? 0 : 3,
    })
  }, [])

  // THE SCREEN IS LATCHED FOR THE LIFE OF ONE OPEN, and must stay that way.
  // `state.requirement` is derived from the same campaign cache
  // ProUpgradeFlow's SuccessStep polls, so it flips the instant payment
  // lands — while the candidate is still looking at the success screen with
  // Continue in front of them. Rendering off the live value pulls the screen
  // out from under them (a cleared requirement renders nothing at all) and
  // the completion they were about to press never fires. So the screen is
  // taken once, on the false -> true transition of `open`, and only
  // `handleProComplete` below moves it.
  const [screen, setScreen] = useState<GateRequirement>(
    open ? state.requirement : null,
  )
  const openRef = useRef(open)
  useEffect(() => {
    if (open === openRef.current) return
    openRef.current = open
    setScreen(open ? state.requirement : null)
  }, [open, state.requirement])

  // The candidate pressed Continue on the upgrade's success screen, so the
  // live requirement is now the authority on what is left: texting's second
  // step moves the latched screen on to it (only `sms` can reach these), and
  // anything else means the flow can have its candidate back.
  const handleProComplete = (): void => {
    const remaining = state.requirement
    if (
      remaining === 'verify' ||
      remaining === 'in_review' ||
      remaining === 'pin'
    ) {
      setScreen(remaining)
      return
    }
    onComplete()
  }

  // The PIN and in-review cards are the verification phase's own notices
  // and draw no header of their own (design: the pending screen).
  useEffect(() => {
    if (!open || (screen !== 'pin' && screen !== 'in_review')) return
    onChromeChangeRef.current?.({
      overline: GATE_CHROME_COPY.verification,
      currentStep: 0,
      totalSteps: 0,
    })
  }, [open, screen])

  if (!open || screen === null) return null

  const noun = GATE_NOUN[channel]

  if (screen === 'pro') {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <ProUpgradeFlow
          initialStep={
            showInterstitial
              ? PRO_UPGRADE_STEP.INTERSTITIAL
              : PRO_UPGRADE_STEP.GUIDANCE
          }
          channel={channel}
          onExit={onExit}
          onComplete={handleProComplete}
          onPositionChange={reportProPosition}
        />
      </div>
    )
  }

  if (screen === 'verify') {
    return (
      <CampaignVerificationSteps
        onExit={onExit}
        onComplete={onComplete}
        onStepChange={reportVerifyStep}
        completeLabel={GATE_NOTICE_COPY.backToNoun(noun)}
      />
    )
  }

  if (screen === 'pin') {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-base-border bg-card p-6 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary-light">
          <ShieldCheckIcon className="size-8 text-primary" aria-hidden />
        </span>
        <Body2 className="text-base-muted-foreground">
          {BANNER_COPY.awaitingPin}
        </Body2>
        <PinDialog
          open
          // A dismissal is the candidate leaving; a verified PIN is the last
          // thing standing between them and their text, so it completes the
          // gate rather than closing the sheet on them.
          onOpenChange={(nextOpen) => {
            if (!nextOpen) onExit()
          }}
          onSuccess={onComplete}
          tcrCompliance={state.tcrCompliance}
        />
      </div>
    )
  }

  // screen === 'in_review'
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-6 rounded-xl border border-base-border bg-card p-6 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary-light">
          <ClockIcon className="size-8 text-primary" aria-hidden />
        </span>
        <div className="flex flex-col gap-2">
          <Body2 className="text-base-muted-foreground">
            {BANNER_COPY.inReview}
          </Body2>
          <Body2 className="text-base-muted-foreground">
            {GATE_NOTICE_COPY.inReviewSavedLine(noun)}
          </Body2>
        </div>
        <Button size="large" className="w-full" onClick={onExit}>
          {GATE_NOTICE_COPY.backToNoun(noun)}
        </Button>
      </div>
    </div>
  )
}

export default OutreachGate
