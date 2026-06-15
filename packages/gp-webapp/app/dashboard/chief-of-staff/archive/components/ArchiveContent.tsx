'use client'

import Link from 'next/link'
import { useState } from 'react'
import { FilterPill, FilterPillGroup, IconButton } from '@styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import { chiefOfStaffHref } from '../../routes'
import { useDashboardCards } from '../../data/use-dashboard'
import DashboardTaskCard from '../../components/DashboardTaskCard'
import type { DashboardCardBucket } from '../../data/contracts'

type ArchiveBucket = Extract<
  DashboardCardBucket,
  'this_week' | 'skipped' | 'missed'
>

const BUCKETS: { value: ArchiveBucket; label: string }[] = [
  { value: 'this_week', label: 'This week' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'missed', label: 'Missed' },
]

const EMPTY_COPY: Record<ArchiveBucket, string> = {
  this_week: 'Nothing scheduled for this week.',
  skipped: "You haven't skipped any tasks.",
  missed: 'No missed tasks. Nice work staying on top of things.',
}

function ArchiveList({ bucket }: { bucket: ArchiveBucket }): React.JSX.Element {
  const { data: cards, isPending, isError } = useDashboardCards(bucket)

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }
  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">
        We could not load these tasks right now.
      </p>
    )
  }
  if (!cards || cards.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="archive-empty">
        {EMPTY_COPY[bucket]}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {cards.map((card) => (
        <DashboardTaskCard key={card.id} card={card} />
      ))}
    </div>
  )
}

/** The Archive view — This week (default) / Skipped / Missed buckets. */
export default function ArchiveContent(): React.JSX.Element {
  const [bucket, setBucket] = useState<ArchiveBucket>('this_week')

  return (
    <div className="flex min-h-screen flex-col bg-muted pb-20 lg:pb-12">
      <div className="sticky top-0 z-20 border-b border-border bg-sidebar">
        <div className="mx-auto flex w-full max-w-[608px] items-center justify-between gap-4 px-4 py-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <IconButton
              asChild
              size="small"
              variant="ghost"
              aria-label="Back to dashboard"
            >
              <Link href={chiefOfStaffHref()}>
                <ArrowLeftIcon className="size-4" aria-hidden />
              </Link>
            </IconButton>
            <h1 className="text-base font-semibold text-foreground">Archive</h1>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[608px] flex-col gap-6 p-4 pb-40 lg:p-6 lg:pb-40">
        <FilterPillGroup
          value={bucket}
          onValueChange={(value) => {
            // Radix single-toggle emits '' on re-select of the active pill;
            // keep the current bucket so one is always selected.
            if (value) setBucket(value as ArchiveBucket)
          }}
        >
          {BUCKETS.map(({ value, label }) => (
            <FilterPill
              key={value}
              value={value}
              className="border px-3 py-1.5 text-xs font-semibold data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
            >
              {label}
            </FilterPill>
          ))}
        </FilterPillGroup>

        <ArchiveList bucket={bucket} />
      </div>
    </div>
  )
}
