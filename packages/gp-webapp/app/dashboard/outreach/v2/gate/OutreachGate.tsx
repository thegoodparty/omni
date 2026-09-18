'use client'

import { Button } from '@styleguide'
import {
  ClockIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from '@styleguide/components/ui/icons'
import Body2 from '@shared/typography/Body2'
import ProUpgradeFlow from 'app/dashboard/pro-upgrade/components/ProUpgradeFlow'
import { PRO_UPGRADE_STEP } from 'app/dashboard/pro-upgrade/proUpgradeStep'
import CampaignVerificationSteps from 'app/dashboard/campaign-verification/components/CampaignVerificationSteps'
import { PinDialog } from 'app/dashboard/shared/membership/PinDialog'
import {
  BANNER_COPY,
  GATE_NOTICE_COPY,
  GATE_NOUN,
  type GateChannel,
} from './gateCopy'
import type { OutreachGateState } from './useOutreachGate'

interface OutreachGateProps {
  channel: GateChannel
  state: OutreachGateState
  // The gate screens are showing (the flow is paused).
  open: boolean
  onExit: () => void
  onComplete: () => void
  onDelete?: () => void
  deleting?: boolean
}

const DeleteButton = ({
  onDelete,
  deleting,
}: {
  onDelete: () => void
  deleting?: boolean
}): React.JSX.Element => (
  <div className="mb-4 flex justify-end">
    <Button
      type="button"
      variant="ghost"
      size="small"
      className="text-destructive hover:bg-destructive/10"
      loading={deleting}
      onClick={onDelete}
    >
      <Trash2Icon className="size-4" aria-hidden />
      Delete
    </Button>
  </div>
)

// The gate screens themselves, mounted in place of a paused flow's step body:
// the Pro interstitial, campaign verification, the PIN dialog, or an
// in-review notice. Only the first gate screen a candidate can land on
// (interstitial or in-review) offers Delete — verification renders its own,
// and PIN has nothing left to abandon.
export const OutreachGate = ({
  channel,
  state,
  open,
  onExit,
  onComplete,
  onDelete,
  deleting,
}: OutreachGateProps): React.JSX.Element | null => {
  if (!open || state.requirement === null) return null

  const noun = GATE_NOUN[channel]

  // Safe to read `state.membership` fresh here rather than re-deriving it:
  // ProUpgradeFlow's SuccessStep (the screen right before this fires) holds
  // its own Continue button disabled until the shared CAMPAIGN_QUERY_KEY
  // query cache reports `isPro: true` (it polls that cache after payment).
  // useMembershipState derives `membership.tier` from the same cache via
  // useCampaign, so by the time a candidate can click through to fire this,
  // the caller's `useOutreachGate()` has already re-rendered with the
  // post-upgrade `state` this component receives as a prop — no separate
  // re-fetch or local state needed. Texting still needing verification
  // means the gate stays open — `state.requirement` has already moved from
  // 'pro' to 'verify' by then, so simply not completing is what shows the
  // next screen.
  const handleProComplete = (): void => {
    if (channel === 'sms' && state.membership?.texting !== 'cleared') return
    onComplete()
  }

  if (state.requirement === 'pro') {
    return (
      <div>
        {onDelete && <DeleteButton onDelete={onDelete} deleting={deleting} />}
        <ProUpgradeFlow
          initialStep={PRO_UPGRADE_STEP.INTERSTITIAL}
          channel={channel}
          onExit={onExit}
          onComplete={handleProComplete}
        />
      </div>
    )
  }

  if (state.requirement === 'verify') {
    return (
      <CampaignVerificationSteps
        onExit={onExit}
        onComplete={onComplete}
        onDelete={onDelete}
        completeLabel={GATE_NOTICE_COPY.backToNoun(noun)}
      />
    )
  }

  if (state.requirement === 'pin') {
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
          onOpenChange={(nextOpen) => {
            if (!nextOpen) onExit()
          }}
          tcrCompliance={state.tcrCompliance}
        />
      </div>
    )
  }

  // requirement === 'in_review'
  return (
    <div className="flex flex-col gap-4">
      {onDelete && <DeleteButton onDelete={onDelete} deleting={deleting} />}
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
