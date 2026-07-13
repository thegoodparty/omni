'use client'

import { useState } from 'react'
import Link from 'next/link'
import { differenceInHours, format, formatDistanceToNow } from 'date-fns'
import { Badge, Button, cn } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import type {
  OrdinanceStatus,
  OrdinanceStatusCounts,
  OrdinanceSummary,
} from '@goodparty_org/contracts'
import { ORDINANCE_STATUS_META, ORDINANCE_STATUS_ORDER } from '../data/statuses'
import { isOrdinanceStep } from '../data/steps'

// Where a row opens: the last step the user viewed, else the first working step.
const RESUME_FALLBACK_STEP = 'clarify'

const resumeHref = (o: OrdinanceSummary): string => {
  const step =
    o.lastViewedStep && isOrdinanceStep(o.lastViewedStep)
      ? o.lastViewedStep
      : RESUME_FALLBACK_STEP
  return `/dashboard/ordinances/solve/${o.slug}/${step}`
}

const rowTimestamp = (iso: string): string => {
  const date = new Date(iso)
  return differenceInHours(new Date(), date) < 24
    ? formatDistanceToNow(date, { addSuffix: true })
    : format(date, 'MMM d')
}

export default function MyOrdinancesSection({
  items,
  counts,
}: {
  items: OrdinanceSummary[]
  counts: OrdinanceStatusCounts
}): React.JSX.Element {
  const [filter, setFilter] = useState<OrdinanceStatus | null>(null)
  const visible = filter ? items.filter((o) => o.status === filter) : items

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            My ordinances
          </h2>
          <p className="text-sm text-muted-foreground">
            Ordinances you&apos;re working on.
          </p>
        </div>
        <Button asChild className="rounded-full">
          <Link href="/dashboard/ordinances/new">New ordinance</Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {ORDINANCE_STATUS_ORDER.map((status) => {
          const meta = ORDINANCE_STATUS_META[status]
          const active = filter === status
          return (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(active ? null : status)}
              aria-pressed={active}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide transition-colors',
                active ? meta.filterActiveClass : meta.filterClass,
              )}
            >
              {meta.label} ({counts[status] ?? 0})
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {filter
            ? 'No ordinances with this status.'
            : 'No ordinances yet. Start one from a priority issue below, or create a new one.'}
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {visible.map((o) => {
            const meta = ORDINANCE_STATUS_META[o.status]
            return (
              <Link
                key={o.id}
                href={resumeHref(o)}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {o.draftTitle ?? 'Untitled ordinance'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {rowTimestamp(o.updatedAt)}
                  </p>
                </div>
                <Badge className={cn('shrink-0 rounded-full', meta.pillClass)}>
                  {meta.label}
                </Badge>
                <ChevronRightIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
