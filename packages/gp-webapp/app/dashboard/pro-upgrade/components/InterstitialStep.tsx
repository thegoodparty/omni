'use client'

import { Button } from '@styleguide'
import { CheckCircleIcon, CheckIcon } from '@styleguide/components/ui/icons'
import Body2 from '@shared/typography/Body2'
import {
  GATE_CHANNEL_LABEL,
  INTERSTITIAL_COPY,
  PRO_COPY,
  type GateChannel,
} from 'app/dashboard/outreach/v2/gate/gateCopy'
import { useProUpgradeWizard } from './ProUpgradeWizard'

interface StepCardProps {
  number?: string
  title: string
  body: string
  rows: string[]
  pill?: string
}

// The prototype's "proStep" card: a numbered (or, for a single-step channel,
// unnumbered) card with a title, body, checked rows, and an optional pill —
// the pill only ever appears on the texting flow's first card.
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

const bodyForChannel = (channel: GateChannel): string => {
  if (channel === 'sms') return INTERSTITIAL_COPY.bodyTexting
  if (channel === 'robocall') return INTERSTITIAL_COPY.bodyRobocall
  return INTERSTITIAL_COPY.bodyOther
}

// The "your first {noun} has been made" pause screen (milestone 2): reached
// only via ProUpgradeFlow's initialStep, ahead of the guidance step, when a
// candidate is gated out of an outreach channel mid-draft.
const InterstitialStep = (): React.JSX.Element => {
  const { channel, goToNextStep, exit } = useProUpgradeWizard()
  // No caller has mounted this off a channel-less surface — channel is set
  // whenever an outreach flow launches the wizard on this step — but sms is
  // the safest fallback shape (the two-step texting-plus-verification copy).
  const gateChannel: GateChannel = channel ?? 'sms'
  const isTexting = gateChannel === 'sms'
  const proCopy = PRO_COPY[gateChannel]

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-primary-light">
        <CheckCircleIcon className="size-8 text-primary" aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold">
          {INTERSTITIAL_COPY.title(GATE_CHANNEL_LABEL[gateChannel])}
        </h3>
        <Body2 className="text-base-muted-foreground">
          {bodyForChannel(gateChannel)}
        </Body2>
      </div>
      <div className="flex w-full flex-col gap-4">
        <StepCard
          number={isTexting ? '1' : undefined}
          title={INTERSTITIAL_COPY.proStep.title}
          body={INTERSTITIAL_COPY.proStep.body}
          rows={INTERSTITIAL_COPY.proStep.rows(proCopy.unlock)}
          pill={isTexting ? INTERSTITIAL_COPY.proStep.pill : undefined}
        />
        {isTexting && (
          <StepCard
            number="2"
            title={INTERSTITIAL_COPY.verifyStep.title}
            body={INTERSTITIAL_COPY.verifyStep.body}
            rows={INTERSTITIAL_COPY.verifyStep.rows}
          />
        )}
      </div>
      <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button
          variant="ghost"
          size="large"
          className="w-full sm:w-auto"
          onClick={exit}
        >
          {INTERSTITIAL_COPY.finishLater}
        </Button>
        <Button
          size="large"
          className="w-full sm:w-auto"
          onClick={goToNextStep}
        >
          {proCopy.cta}
        </Button>
      </div>
    </div>
  )
}

export default InterstitialStep
