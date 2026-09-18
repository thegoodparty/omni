'use client'

import type { ComponentType } from 'react'
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
import {
  CheckIcon,
  DoorOpenIcon,
  HeadphonesIcon,
  MessageSquareIcon,
  PhoneIcon,
} from '@styleguide/components/ui/icons'
import Body2 from '@shared/typography/Body2'
import {
  EXPLAINER_COPY,
  GATE_CHANNEL_TITLE,
  GATE_NOUN,
  INTERSTITIAL_COPY,
  PRO_CHANNEL_WHY,
  PRO_COPY,
  type GateChannel,
} from './gateCopy'
import type { OutreachGateState } from './useOutreachGate'

const CHANNEL_ICON: Record<
  GateChannel,
  ComponentType<{ className?: string }>
> = {
  sms: MessageSquareIcon,
  robocall: PhoneIcon,
  door: DoorOpenIcon,
  'phone-bank': HeadphonesIcon,
}

interface StepCardProps {
  number?: string
  title: string
  body: string
  rows: string[]
  pill?: string
}

// The design's proStep card, duplicated from InterstitialStep's rather than
// shared — the two are one place each (WET over premature DRY).
const StepCard = ({
  number,
  title,
  body,
  rows,
  pill,
}: StepCardProps): React.JSX.Element => (
  <div className="flex flex-col gap-3 rounded-xl border border-base-border p-4 text-left">
    <div className="flex items-center gap-2.5">
      {number && (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {number}
        </span>
      )}
      <p className="font-semibold">{title}</p>
    </div>
    <Body2 className="text-base-muted-foreground">{body}</Body2>
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li
          key={row}
          className="flex items-start gap-2 text-sm text-base-muted-foreground"
        >
          <CheckIcon
            className="mt-0.5 size-4 shrink-0 text-primary"
            aria-hidden
          />
          {row}
        </li>
      ))}
    </ul>
    {pill && (
      <span className="w-fit rounded-full bg-primary-light px-3 py-1 text-xs font-semibold text-primary">
        {pill}
      </span>
    )}
  </div>
)

interface GateExplainerModalProps {
  channel: GateChannel
  state: OutreachGateState
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpgrade: () => void
  onVerify: () => void
  onPin: () => void
}

// The banner's tap target (design: renderComplianceModal): what Pro and/or
// verification unlock, then the CTA the current requirement calls for.
export const GateExplainerModal = ({
  channel,
  state,
  open,
  onOpenChange,
  onUpgrade,
  onVerify,
  onPin,
}: GateExplainerModalProps): React.JSX.Element | null => {
  const { requirement, twoStep } = state
  if (requirement === null) return null

  const noun = GATE_NOUN[channel]
  const needsPro = requirement === 'pro'
  const ChannelIcon = CHANNEL_ICON[channel]

  const title = !twoStep
    ? EXPLAINER_COPY.titleOneStep(noun)
    : needsPro
      ? EXPLAINER_COPY.titleTwoStep(noun)
      : EXPLAINER_COPY.titleVerifyOnly(noun)

  const body = !twoStep
    ? EXPLAINER_COPY.bodyOneStep
    : needsPro
      ? EXPLAINER_COPY.bodyTwoStep(noun)
      : EXPLAINER_COPY.bodyVerifyOnly(noun)

  const cta =
    requirement === 'pro'
      ? { label: EXPLAINER_COPY.ctaUpgrade, onClick: onUpgrade }
      : requirement === 'verify'
        ? { label: EXPLAINER_COPY.ctaVerify, onClick: onVerify }
        : requirement === 'pin'
          ? { label: EXPLAINER_COPY.ctaPin, onClick: onPin }
          : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[700px]">
        <DialogHeader className="items-start text-left">
          {needsPro && <ProBadge size="large" />}
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
          {needsPro && (
            <div className="flex flex-col gap-2 pt-2">
              <span className="flex size-10 items-center justify-center rounded-full bg-primary-light">
                <ChannelIcon className="size-5 text-foreground" aria-hidden />
              </span>
              <p className="font-semibold">{GATE_CHANNEL_TITLE[channel]}</p>
              <Body2 className="text-base-muted-foreground">
                {PRO_CHANNEL_WHY[channel]}
              </Body2>
            </div>
          )}
        </DialogHeader>
        <div className="flex flex-col gap-6">
          {needsPro && (
            <StepCard
              number={twoStep ? '1' : undefined}
              title={INTERSTITIAL_COPY.proStep.title}
              body={EXPLAINER_COPY.proBody}
              rows={EXPLAINER_COPY.proRows(PRO_COPY[channel].unlock)}
              pill={
                channel === 'sms' ? INTERSTITIAL_COPY.proStep.pill : undefined
              }
            />
          )}
          {twoStep && (
            <StepCard
              number={needsPro ? '2' : undefined}
              title={INTERSTITIAL_COPY.verifyStep.title}
              body={EXPLAINER_COPY.verifyBody}
              rows={EXPLAINER_COPY.verifyRows}
            />
          )}
        </div>
        <DialogFooter className="sm:justify-center">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {needsPro ? EXPLAINER_COPY.dismissFree : EXPLAINER_COPY.dismissPro}
          </Button>
          {cta && (
            <Button
              onClick={() => {
                onOpenChange(false)
                cta.onClick()
              }}
            >
              {cta.label}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default GateExplainerModal
