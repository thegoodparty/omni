'use client'

import Link from 'next/link'
import {
  Button,
  Card,
  Overline,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@styleguide'

export interface TaskCardProps {
  overlineLabel: string
  title: string
  /** Optional date / location lines under the title. */
  meta?: string[]
  summary?: string
  /** Omit to render an informational card with no CTA (e.g. an archived item). */
  ctaLabel?: string
  /** When set, the CTA navigates here. */
  ctaHref?: string
  /** Fires on a CTA click; with no href it is the CTA's whole action. */
  onCta?: () => void
  /** When set, the CTA renders disabled with this reason on hover. */
  ctaDisabledReason?: string
  /** When set, renders a secondary "Mark done" action. */
  onComplete?: () => void
  completeDisabled?: boolean
  onSkip?: () => void
  skipDisabled?: boolean
  /** When set, renders "Bring it back" for a card set aside. */
  onRestore?: () => void
  restoreDisabled?: boolean
  /** Subtle top-to-bottom tint, for a featured (top) card. */
  gradient?: boolean
}

// A task action can point off-app (a state SOS page, a form). Those must open
// in a new tab via a plain anchor; internal routes go through the client router.
const isExternalHref = (href: string): boolean =>
  /^(https?:)?\/\//.test(href) ||
  href.startsWith('mailto:') ||
  href.startsWith('tel:')

/**
 * Shared card for the dashboard task list, the onboarding cards, and the
 * Archive list. Overline + title + meta/summary are plain elements; the CTA
 * and Skip use styleguide primitives.
 */
export default function TaskCard({
  overlineLabel,
  title,
  meta,
  summary,
  ctaLabel,
  ctaHref,
  onCta,
  ctaDisabledReason,
  onComplete,
  completeDisabled = false,
  onSkip,
  skipDisabled = false,
  onRestore,
  restoreDisabled = false,
  gradient = false,
}: TaskCardProps): React.JSX.Element {
  return (
    <Card
      className={cn(
        'gap-3 rounded-2xl border border-grayscale-300 p-4 shadow-sm transition-colors lg:p-6',
        gradient && 'bg-gradient-to-b from-primary/5 to-card',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Overline>{overlineLabel}</Overline>
      </div>

      <h3 className="text-lg font-semibold text-card-foreground">{title}</h3>

      {meta && meta.length > 0 && (
        <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">
          {meta.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      )}

      {summary && (
        <p className="line-clamp-2 text-sm text-muted-foreground">{summary}</p>
      )}

      <div className="flex flex-col gap-3 pt-2">
        {ctaLabel &&
          (ctaDisabledReason ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="w-full">
                  <Button type="button" className="w-full" disabled>
                    {ctaLabel}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{ctaDisabledReason}</TooltipContent>
            </Tooltip>
          ) : ctaHref ? (
            isExternalHref(ctaHref) ? (
              <Button asChild className="w-full">
                <a
                  href={ctaHref}
                  target="_blank"
                  rel="noreferrer"
                  onClick={onCta}
                >
                  {ctaLabel}
                </a>
              </Button>
            ) : (
              <Button asChild className="w-full">
                <Link href={ctaHref} onClick={onCta}>
                  {ctaLabel}
                </Link>
              </Button>
            )
          ) : (
            <Button type="button" className="w-full" onClick={onCta}>
              {ctaLabel}
            </Button>
          ))}
        {onComplete && (
          <button
            type="button"
            onClick={onComplete}
            disabled={completeDisabled}
            className="self-center text-sm font-medium text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
          >
            Mark done
          </button>
        )}
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            disabled={skipDisabled}
            className="self-center text-sm font-medium text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
          >
            Skip
          </button>
        )}
        {onRestore && (
          <button
            type="button"
            onClick={onRestore}
            disabled={restoreDisabled}
            className="self-center text-sm font-medium text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
          >
            Bring it back
          </button>
        )}
      </div>
    </Card>
  )
}
