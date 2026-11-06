import type { ReactNode } from 'react'
import { PRICE_PER_EMAIL_TENTH_CENTS } from '@goodparty_org/contracts'
import { Card, cn } from '@styleguide'
import { CHANNEL_META } from '../channelMeta'
import { formatCount, formatDollars } from './emailFlow.util'
import type { EmailSurface } from './emailSurface'

interface EmailSummaryProps {
  surface: EmailSurface
  // The line under the channel name, as a text send shows its campaign name.
  subtitle?: string
  // The saved list's name, when the caller knows it.
  audienceName?: string | null
  // How many this send reaches, and how many are on the list when that is
  // more than the send can reach.
  reach: { count: number; outOf: number } | null
  reachNote?: ReactNode
  priceCents: number | null
  when: string
  children?: ReactNode
}

// The card Review shows and the status page repeats, so a sent email reads
// back exactly as it was confirmed. Laid out like a text send's review card.
export const EmailSummary = ({
  surface,
  subtitle,
  audienceName,
  reach,
  reachNote,
  priceCents,
  when,
  children,
}: EmailSummaryProps) => {
  const meta = CHANNEL_META.email
  return (
    <Card className="gap-0 overflow-hidden p-0" data-testid="email-summary">
      <div className="flex items-center gap-3 px-4 py-4">
        <span
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-full [&_svg]:size-6 [&_svg]:text-foreground',
            meta.iconTint,
          )}
        >
          {meta.icon}
        </span>
        <div className="min-w-0">
          <p className="font-medium text-foreground">{meta.label}</p>
          {subtitle && (
            <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="border-t border-border px-4 py-4">
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">When</dt>
            <dd className="text-right text-foreground">{when}</dd>
          </div>
          {audienceName && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Audience</dt>
              <dd className="truncate text-foreground">{audienceName}</dd>
            </div>
          )}
          {reach && (
            <div data-testid="email-reach">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">People</dt>
                <dd className="text-foreground">
                  {reach.outOf > reach.count
                    ? `${formatCount(reach.count)} of ${formatCount(reach.outOf)}`
                    : `${formatCount(reach.count)} ${surface.recipientsNoun}`}
                </dd>
              </div>
              {reachNote}
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Price per email</dt>
            <dd className="text-foreground">
              {formatDollars(PRICE_PER_EMAIL_TENTH_CENTS / 10)}
            </dd>
          </div>
        </dl>
      </div>
      {children && (
        <dl className="space-y-3 border-t border-border px-4 py-4 text-sm">
          {children}
        </dl>
      )}
      {priceCents !== null && (
        <div
          className="space-y-1 border-t border-border px-4 py-4"
          data-testid="email-price"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">Total</span>
            <span className="font-semibold text-foreground">
              Up to {formatDollars(priceCents)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            You are charged only for emails that go out.
          </p>
        </div>
      )}
    </Card>
  )
}
