'use client'

import { useState, type ComponentType } from 'react'
import {
  Badge,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@styleguide'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DoorOpenIcon,
  HeadsetIcon,
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
  'phone-bank': HeadsetIcon,
}

// Each channel's tint: the design's `CHANNEL_TINT`, a brand-palette 200 step
// (gp-blue-200 for texting, not the theme's Tailwind-blue `info-light`), the
// same wash `channelMeta.tsx` paints the channel badge and tile with. The
// header and the check circles sit at fractions of it so the icon circle
// still reads against the header behind it.
const CHANNEL_TINT: Record<
  GateChannel,
  { border: string; header: string; circle: string; check: string }
> = {
  sms: {
    border: 'border-brand-blue-200',
    header: 'bg-brand-blue-200/45',
    circle: 'bg-brand-blue-200',
    check: 'bg-brand-blue-200/55',
  },
  robocall: {
    border: 'border-brand-waxflower-200',
    header: 'bg-brand-waxflower-200/45',
    circle: 'bg-brand-waxflower-200',
    check: 'bg-brand-waxflower-200/55',
  },
  door: {
    border: 'border-brand-halo-green-200',
    header: 'bg-brand-halo-green-200/45',
    circle: 'bg-brand-halo-green-200',
    check: 'bg-brand-halo-green-200/55',
  },
  'phone-bank': {
    border: 'border-brand-red-200',
    header: 'bg-brand-red-200/45',
    circle: 'bg-brand-red-200',
    check: 'bg-brand-red-200/55',
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
            <ShieldCheckIcon
              className="size-[18px] shrink-0 text-primary"
              aria-hidden
            />
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
              {/* Design: DS.Badge, variant info, shape pill — a badge, not a
                  button-sized chip. */}
              <Badge className="w-fit border-transparent bg-brand-blue-100 text-primary">
                {PITCH_PANEL_COPY.verifyFeePill}
              </Badge>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

export default ProPitchPanel
