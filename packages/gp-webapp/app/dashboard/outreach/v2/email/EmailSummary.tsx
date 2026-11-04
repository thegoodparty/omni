import type { ReactNode } from 'react'
import { formatCount, formatDollars } from './emailFlow.util'
import type { EmailSurface } from './emailSurface'

interface EmailSummaryProps {
  surface: EmailSurface
  subject: string
  // How many this send reaches, and how many are on the list when that is
  // more than the send can reach.
  reach: { count: number; outOf: number } | null
  reachNote?: ReactNode
  priceCents: number | null
  when: string
  children?: ReactNode
}

// The rows Review shows and the status page repeats, so a sent email reads
// back exactly as it was confirmed.
export const EmailSummary = ({
  surface,
  subject,
  reach,
  reachNote,
  priceCents,
  when,
  children,
}: EmailSummaryProps) => (
  <dl className="space-y-3 text-sm" data-testid="email-summary">
    <div>
      <dt className="text-muted-foreground">Subject</dt>
      <dd className="font-medium text-foreground">{subject}</dd>
    </div>
    {reach && (
      <div data-testid="email-reach">
        <dt className="text-muted-foreground">Reaches</dt>
        <dd className="font-medium text-foreground">
          {reach.outOf > reach.count
            ? `${formatCount(reach.count)} of ${formatCount(reach.outOf)}`
            : `${formatCount(reach.count)} ${surface.recipientsNoun}`}
        </dd>
        {reachNote}
      </div>
    )}
    {priceCents !== null && (
      <div data-testid="email-price">
        <dt className="text-muted-foreground">Price</dt>
        <dd className="font-medium text-foreground">
          Up to {formatDollars(priceCents)}
        </dd>
        <dd className="text-muted-foreground">
          You are charged only for emails that go out.
        </dd>
      </div>
    )}
    <div>
      <dt className="text-muted-foreground">When</dt>
      <dd className="font-medium text-foreground">{when}</dd>
    </div>
    {children}
  </dl>
)
