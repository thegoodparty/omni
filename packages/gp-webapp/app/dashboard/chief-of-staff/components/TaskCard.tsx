'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button, Card } from '@styleguide'
import { cn } from '@styleguide/lib/utils'
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
  onSkip?: () => void
  skipDisabled?: boolean
  /** Active onboarding card emphasis. */
  highlighted?: boolean
  /** Outline the card in blue while it's the one centered in the viewport. */
  scrollSpy?: boolean
}

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
  onSkip,
  skipDisabled = false,
  highlighted = false,
  scrollSpy = false,
}: TaskCardProps): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [centered, setCentered] = useState(false)

  useEffect(() => {
    if (!scrollSpy) return
    const el = cardRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    // Only the card crossing the middle ~10% band of the viewport counts as
    // centered, so exactly one lights up as you scroll.
    const observer = new IntersectionObserver(
      ([entry]) => setCentered(entry?.isIntersecting ?? false),
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollSpy])

  return (
    <Card
      ref={cardRef}
      className={cn(
        'gap-3 rounded-2xl border border-border p-4 shadow-sm transition-colors lg:p-6',
        highlighted &&
          'border-primary ring-2 ring-primary/40 bg-gradient-to-br from-primary/10 to-card',
        scrollSpy && centered && !highlighted && 'ring-2 ring-info',
      )}
    >
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
            <Button asChild className="w-full">
              <Link href={ctaHref}>{ctaLabel}</Link>
            </Button>
          ) : (
            <Button type="button" className="w-full" onClick={onCta}>
              {ctaLabel}
            </Button>
          ))}
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
