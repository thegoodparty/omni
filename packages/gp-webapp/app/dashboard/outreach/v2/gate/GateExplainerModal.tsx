'use client'

import { useEffect, useRef } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ProBadge,
} from '@styleguide'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { EXPLAINER_COPY, GATE_NOUN, type GateChannel } from './gateCopy'
import { ProPitchPanel } from './ProPitchPanel'
import type { OutreachGateState } from './useOutreachGate'

interface GateExplainerModalProps {
  channel: GateChannel
  state: OutreachGateState
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpgrade: () => void
  onVerify: () => void
  onPin: () => void
}

// The banner's tap target (design: renderComplianceModal): the Pro pitch, or
// — once the candidate is on Pro — what campaign verification still needs
// from them, then the CTA the current requirement calls for.
export const GateExplainerModal = ({
  channel,
  state,
  open,
  onOpenChange,
  onUpgrade,
  onVerify,
  onPin,
}: GateExplainerModalProps): React.JSX.Element | null => {
  const { requirement } = state

  const requirementRef = useRef(requirement)
  requirementRef.current = requirement
  useEffect(() => {
    if (!open || requirementRef.current === null) return
    trackEvent(EVENTS.Outreach.Gate.ExplainerViewed, {
      channel,
      requirement: requirementRef.current,
    })
  }, [open, channel])

  if (requirement === null) return null

  const noun = GATE_NOUN[channel]
  const needsPro = requirement === 'pro'

  const title = needsPro
    ? EXPLAINER_COPY.titleFree
    : requirement === 'in_review'
      ? EXPLAINER_COPY.titleInReview
      : EXPLAINER_COPY.titleVerify(noun)

  const body = needsPro
    ? null
    : requirement === 'in_review'
      ? EXPLAINER_COPY.bodyInReview
      : EXPLAINER_COPY.bodyVerify(noun)

  const cta =
    requirement === 'pro'
      ? {
          kind: 'upgrade',
          label: EXPLAINER_COPY.ctaJoin,
          onClick: onUpgrade,
        }
      : requirement === 'verify'
        ? {
            kind: 'verify',
            label: EXPLAINER_COPY.ctaVerify,
            onClick: onVerify,
          }
        : requirement === 'pin'
          ? { kind: 'pin', label: EXPLAINER_COPY.ctaPin, onClick: onPin }
          : null

  const reportCta = (kind: string): void => {
    trackEvent(EVENTS.Outreach.Gate.ExplainerCta, {
      channel,
      requirement,
      cta: kind,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent's own `sm:max-w-lg` would cap the 640px the design
          draws, so the width is set at the same breakpoint. */}
      <DialogContent className="flex max-h-[88vh] flex-col gap-5 rounded-2xl p-5 sm:max-w-[640px] sm:gap-6 sm:p-8">
        {/* Only the body scrolls: expanding the verification card on a short
            viewport must not carry the CTA off the bottom of the dialog. */}
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto sm:gap-6">
          {/* DialogHeader's own classes end in `sm:text-left`, so centering
              the wrapped lines needs the sm: breakpoint spelled out too. */}
          <DialogHeader className="items-center gap-3 text-center sm:text-center">
            <ProBadge size="large" className="h-[30px] w-[66px]" />
            <DialogTitle className="text-xl font-semibold tracking-tight sm:text-2xl">
              {title}
            </DialogTitle>
            {body && (
              <DialogDescription className="text-base leading-normal">
                {body}
              </DialogDescription>
            )}
          </DialogHeader>
          <ProPitchPanel
            channel={channel}
            hideValue={!needsPro}
            verifyDefaultOpen={!needsPro}
          />
        </div>
        {/* DOM order is primary then ghost, so row-reverse puts Later on the
            left on desktop while mobile stacks the primary on top. */}
        <DialogFooter className="shrink-0 flex-col items-center sm:flex-row-reverse sm:justify-center">
          {cta && (
            <Button
              className="w-full sm:w-auto sm:min-w-[360px]"
              onClick={() => {
                reportCta(cta.kind)
                onOpenChange(false)
                cta.onClick()
              }}
            >
              {cta.label}
            </Button>
          )}
          {!needsPro && (
            <Button
              variant="ghost"
              className="w-full sm:w-auto"
              onClick={() => {
                reportCta('dismiss')
                onOpenChange(false)
              }}
            >
              {EXPLAINER_COPY.dismissPro}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default GateExplainerModal
