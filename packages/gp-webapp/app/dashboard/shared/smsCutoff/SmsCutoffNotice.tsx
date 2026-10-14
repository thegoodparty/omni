'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { MessageSquareOff } from 'lucide-react'
import { Button, cn } from '@styleguide'
import {
  CalendarClockIcon,
  ChevronRightIcon,
  DoorOpenIcon,
  HeadsetIcon,
  PhoneIcon,
  Share2Icon,
} from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import {
  SMS_CUTOFF_COPY,
  formatSmsCutoffDate,
} from 'app/dashboard/campaign-verification/verificationCopy'
import { useSmsCompliance } from './useSmsCompliance'

const OTHER_CHANNELS = [
  {
    channel: OUTREACH_TYPES.doorKnocking,
    label: SMS_CUTOFF_COPY.channels.doorKnocking,
    icon: DoorOpenIcon,
    tint: 'bg-brand-halo-green-200',
    href: '/dashboard/door-knocking?create=1',
  },
  {
    channel: OUTREACH_TYPES.robocall,
    label: SMS_CUTOFF_COPY.channels.robocalls,
    icon: PhoneIcon,
    tint: 'bg-brand-waxflower-200',
    href: '/dashboard/outreach?compose=robocall',
  },
  {
    channel: OUTREACH_TYPES.phoneBanking,
    label: SMS_CUTOFF_COPY.channels.phoneBanking,
    icon: HeadsetIcon,
    tint: 'bg-brand-red-200',
    href: '/dashboard/outreach?compose=phoneBanking',
  },
  {
    channel: OUTREACH_TYPES.socialMedia,
    label: SMS_CUTOFF_COPY.channels.socialMedia,
    icon: Share2Icon,
    tint: 'bg-brand-lavender-200',
    href: '/dashboard/outreach?compose=social',
  },
]

interface SmsCutoffNoticeProps {
  variant: 'screen' | 'card'
  surface: string
  onBack?: () => void
  backLabel?: string
  // A host on the outreach hub (a dialog, a flow sheet) closes itself here:
  // the robocall, phone banking and social links reopen the hub with
  // `?compose=`, which would open that flow on top of the host.
  onPick?: () => void
}

// The one cutoff notice: 'screen' is the full info screen that replaces a
// texting or compliance surface, 'card' the compact version for cards and
// wizard steps. It fires the Outreach SMS cutoff events itself, so a host
// renders it and fires nothing.
export const SmsCutoffNotice = ({
  variant,
  surface,
  onBack,
  backLabel = SMS_CUTOFF_COPY.backToOutreach,
  onPick,
}: SmsCutoffNoticeProps): React.JSX.Element => {
  const { smsCutoffDate, generalElectionDate } = useSmsCompliance()
  const title = SMS_CUTOFF_COPY.closedReason(
    smsCutoffDate ? formatSmsCutoffDate(smsCutoffDate) : null,
  )

  useEffect(() => {
    trackEvent(EVENTS.Outreach.SmsCutoff.NoticeViewed, {
      surface,
      cutoffDate: smsCutoffDate,
      generalElectionDate,
    })
  }, [surface, smsCutoffDate, generalElectionDate])

  const trackPick = (channel: string) => {
    trackEvent(EVENTS.Outreach.SmsCutoff.NoticeCompleted, { surface, channel })
    onPick?.()
  }

  if (variant === 'card') {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-grayscale-200">
            <MessageSquareOff className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-lg font-semibold">{title}</p>
            <p className="text-sm text-muted-foreground">{SMS_CUTOFF_COPY.body}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:pl-13">
          {OTHER_CHANNELS.map(({ channel, label, icon: Icon, href }) => (
            <Button key={channel} asChild variant="outline" size="small">
              <Link href={href} onClick={() => trackPick(channel)}>
                <Icon aria-hidden />
                {label}
              </Link>
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground sm:pl-13">
          {SMS_CUTOFF_COPY.support}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-grayscale-200">
          <CalendarClockIcon className="size-8" aria-hidden />
        </span>
        <div className="flex max-w-md flex-col gap-2">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="text-base text-muted-foreground">{SMS_CUTOFF_COPY.body}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold">
          {SMS_CUTOFF_COPY.channelsQuestion}
        </p>
        {OTHER_CHANNELS.map(({ channel, label, icon: Icon, tint, href }) => (
          <Link
            key={channel}
            href={href}
            onClick={() => trackPick(channel)}
            className="flex items-center gap-3 rounded-2xl border border-base-border bg-card px-4 py-3 text-left no-underline transition-colors hover:border-primary"
          >
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full',
                tint,
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="flex-1 text-sm font-semibold text-foreground">
              {label}
            </span>
            <ChevronRightIcon
              className="size-5 text-muted-foreground"
              aria-hidden
            />
          </Link>
        ))}
      </div>
      <p className="text-center text-sm text-muted-foreground">
        {SMS_CUTOFF_COPY.support}
      </p>
      {onBack && (
        <Button size="large" variant="outline" onClick={onBack}>
          {backLabel}
        </Button>
      )}
    </div>
  )
}
