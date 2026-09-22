'use client'

import { useState, type ComponentType } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@styleguide'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DoorOpenIcon,
  HeadphonesIcon,
  MessageSquareIcon,
  PhoneIcon,
  ShieldCheckIcon,
} from '@styleguide/components/ui/icons'
import { PITCH_PANEL_COPY, PRO_COPY, type GateChannel } from './gateCopy'

const CHANNEL_ICON: Record<
  GateChannel,
  ComponentType<{ className?: string }>
> = {
  sms: MessageSquareIcon,
  robocall: PhoneIcon,
  door: DoorOpenIcon,
  'phone-bank': HeadphonesIcon,
}

// Each channel's tint. The design paints these cards in the 200-level wash of
// a token family, which is the `-light` step here; the header and the check
// circles sit at fractions of that same wash so the icon circle still reads
// against the header behind it.
const CHANNEL_TINT: Record<
  GateChannel,
  { border: string; header: string; circle: string; check: string }
> = {
  sms: {
    border: 'border-info-light',
    header: 'bg-info-light/45',
    circle: 'bg-info-light',
    check: 'bg-info-light/55',
  },
  robocall: {
    border: 'border-warning-light',
    header: 'bg-warning-light/45',
    circle: 'bg-warning-light',
    check: 'bg-warning-light/55',
  },
  door: {
    border: 'border-success-light',
    header: 'bg-success-light/45',
    circle: 'bg-success-light',
    check: 'bg-success-light/55',
  },
  'phone-bank': {
    border: 'border-destructive-light',
    header: 'bg-destructive-light/45',
    circle: 'bg-destructive-light',
    check: 'bg-destructive-light/55',
  },
}

interface ProPitchPanelProps {
  channel: GateChannel
  hideValue?: boolean
  verifyDefaultOpen?: boolean
}

// The shared Pro pitch (design: proPitchPanel): what the channel unlocks, and
// — for texting only — the campaign verification that comes with it. The gate
// explainer and the wizard's interstitial both render it, so a candidate sees
// the same pitch whichever door they came through.
export const ProPitchPanel = ({
  channel,
  hideValue = false,
  verifyDefaultOpen = false,
}: ProPitchPanelProps): React.JSX.Element | null => {
  const [verifyOpen, setVerifyOpen] = useState(verifyDefaultOpen)
  const tint = CHANNEL_TINT[channel]
  const ChannelIcon = CHANNEL_ICON[channel]
  const showVerify = channel === 'sms'

  if (hideValue && !showVerify) return null

  return (
    <div className="flex w-full flex-col gap-4 text-left">
      {!hideValue && (
        <div className={`overflow-hidden rounded-xl border ${tint.border}`}>
          <div
            className={`flex items-center gap-3.5 p-4 sm:p-5 ${tint.header}`}
          >
            <span
              className={`flex size-11 shrink-0 items-center justify-center rounded-full ${tint.circle}`}
            >
              <ChannelIcon className="size-5 text-foreground" aria-hidden />
            </span>
            <p className="font-semibold">{PRO_COPY[channel].headline}</p>
          </div>
          <div className="flex flex-col gap-3.5 px-5 pt-4 pb-5 sm:px-6 sm:pt-5 sm:pb-6">
            {PRO_COPY[channel].bullets.map((bullet) => (
              <div key={bullet} className="flex items-center gap-3">
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full ${tint.check}`}
                >
                  <CheckIcon className="size-4 text-foreground" aria-hidden />
                </span>
                <span className="text-base leading-normal">{bullet}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {showVerify && (
        <Collapsible
          open={verifyOpen}
          onOpenChange={setVerifyOpen}
          className="overflow-hidden rounded-xl border border-base-border"
        >
          <CollapsibleTrigger className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2.5 px-4">
            <ShieldCheckIcon className="size-[18px] shrink-0" aria-hidden />
            <p className="font-semibold">{PITCH_PANEL_COPY.verifyTitle}</p>
            {verifyOpen ? (
              <ChevronUpIcon
                className="size-4 shrink-0 text-base-muted-foreground"
                aria-hidden
              />
            ) : (
              <ChevronDownIcon
                className="size-4 shrink-0 text-base-muted-foreground"
                aria-hidden
              />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-base-border">
            <div className="flex flex-col gap-3 px-5 pt-4 pb-5 sm:px-6 sm:pt-5 sm:pb-6">
              <p className="text-base leading-normal text-base-muted-foreground">
                {PITCH_PANEL_COPY.verifyBody}
              </p>
              <div className="flex flex-col gap-2.5">
                {PITCH_PANEL_COPY.verifyRows.map((row) => (
                  <div key={row} className="flex items-start gap-2.5">
                    <CheckIcon
                      className="mt-1 size-4 shrink-0 text-primary"
                      aria-hidden
                    />
                    <span className="text-base leading-normal">{row}</span>
                  </div>
                ))}
              </div>
              <span className="w-fit rounded-full bg-info-light px-3 py-1 text-sm font-medium text-primary">
                {PITCH_PANEL_COPY.verifyFeePill}
              </span>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

export default ProPitchPanel
