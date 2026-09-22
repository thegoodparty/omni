'use client'

import { useEffect, useRef, useState } from 'react'
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
import type { GateRequirement, OutreachGateState } from './useOutreachGate'

interface OutreachGateProps {
  channel: GateChannel
  state: OutreachGateState
  // The gate screens are showing (the flow is paused).
  open: boolean
  onExit: () => void
  onComplete: () => void
  onDelete?: () => void
  deleting?: boolean
  // A delete that failed. Silence here left the candidate looking at a draft
  // they had already asked twice to discard.
  deleteError?: boolean
  // Whether a draft row stands behind this gate. With none the Pro screen
  // cannot open on the interstitial — its copy says the campaign has been
  // made and will be kept for 90 days, which would be a lie.
  hasDraft?: boolean
}

const DeleteButton = ({
  onDelete,
  deleting,
  deleteError,
}: {
  onDelete: () => void
  deleting?: boolean
  deleteError?: boolean
}): React.JSX.Element => (
  <div className="mb-4 flex flex-col items-end gap-1">
    <Button
      type="button"
      variant="ghost"
      size="small"
      className="text-destructive hover:bg-destructive/10"
      loading={deleting}
      onClick={onDelete}
    >
      <Trash2Icon className="size-4" aria-hidden />
      {GATE_NOTICE_COPY.delete}
    </Button>
    {deleteError && (
      <p className="text-sm text-destructive">{GATE_NOTICE_COPY.deleteError}</p>
    )}
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
  deleteError,
  hasDraft = true,
}: OutreachGateProps): React.JSX.Element | null => {
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

  if (!open || screen === null) return null

  const noun = GATE_NOUN[channel]

  if (screen === 'pro') {
    return (
      <div>
        {onDelete && (
          <DeleteButton
            onDelete={onDelete}
            deleting={deleting}
            deleteError={deleteError}
          />
        )}
        <ProUpgradeFlow
          // With no draft behind the gate the interstitial's "send this
          // campaign" copy has nothing to describe, so the wizard opens on
          // the first step of its own purchase-only order instead.
          initialStep={
            hasDraft ? PRO_UPGRADE_STEP.INTERSTITIAL : PRO_UPGRADE_STEP.GUIDANCE
          }
          channel={channel}
          onExit={onExit}
          onComplete={handleProComplete}
        />
      </div>
    )
  }

  if (screen === 'verify') {
    return (
      <CampaignVerificationSteps
        onExit={onExit}
        onComplete={onComplete}
        onDelete={onDelete}
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
      {onDelete && (
        <DeleteButton
          onDelete={onDelete}
          deleting={deleting}
          deleteError={deleteError}
        />
      )}
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
