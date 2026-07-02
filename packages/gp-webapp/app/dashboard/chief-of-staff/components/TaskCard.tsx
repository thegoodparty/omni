'use client'

import Link from 'next/link'
import { Button, Card } from '@styleguide'
import type { LucideIcon } from 'lucide-react'

export interface TaskCardProps {
  eyebrowLabel: string
  EyebrowIcon: LucideIcon
  title: string
  /** Optional date / location lines under the title. */
  meta?: string[]
  summary?: string
  /** Omit to render an informational card with no CTA (e.g. an archived item). */
  ctaLabel?: string
  /** When set, the CTA navigates here. */
  ctaHref?: string
  /** When set (and no href), the CTA fires this instead. */
  onCta?: () => void
  /** When set, renders a secondary "Mark done" action. */
  onComplete?: () => void
  completeDisabled?: boolean
  onSkip?: () => void
  skipDisabled?: boolean
}

// A task action can point off-app (a state SOS page, a form). Those must open
// in a new tab via a plain anchor; internal routes go through the client router.
const isExternalHref = (href: string): boolean =>
  /^(https?:)?\/\//.test(href) ||
  href.startsWith('mailto:') ||
  href.startsWith('tel:')

/**
 * Shared card for the dashboard task list, the onboarding cards, and the
 * Archive list. Eyebrow + title + meta/summary are plain elements; the CTA
 * and Skip use styleguide primitives.
 */
export default function TaskCard({
  eyebrowLabel,
  EyebrowIcon,
  title,
  meta,
  summary,
  ctaLabel,
  ctaHref,
  onCta,
  onComplete,
  completeDisabled = false,
  onSkip,
  skipDisabled = false,
}: TaskCardProps): React.JSX.Element {
  return (
    <Card className="gap-3 rounded-2xl border border-grayscale-300 bg-gradient-to-b from-primary/5 to-card p-4 shadow-sm transition-colors lg:p-6">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <EyebrowIcon className="size-3.5" aria-hidden />
          {eyebrowLabel}
        </span>
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
          (ctaHref ? (
            isExternalHref(ctaHref) ? (
              <Button asChild className="w-full">
                <a href={ctaHref} target="_blank" rel="noreferrer">
                  {ctaLabel}
                </a>
              </Button>
            ) : (
              <Button asChild className="w-full">
                <Link href={ctaHref}>{ctaLabel}</Link>
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
      </div>
    </Card>
  )
}
