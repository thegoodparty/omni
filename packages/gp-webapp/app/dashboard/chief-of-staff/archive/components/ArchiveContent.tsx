'use client'

import Link from 'next/link'
import { useState } from 'react'
import { FilterPill, FilterPillGroup, IconButton } from '@styleguide'
import { ArrowLeftIcon, SparklesIcon } from '@styleguide/components/ui/icons'
import { chiefOfStaffHref } from '../../routes'
import { useDashboardCards, useOnboardingCards } from '../../data/use-dashboard'
import DashboardTaskCard from '../../components/DashboardTaskCard'
import TaskCard from '../../components/TaskCard'
import {
  ONBOARDING_CARDS,
  ONBOARDING_CARD_ORDER,
} from '../../components/onboardingCardsConfig'
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
  const { data: onboarding } = useOnboardingCards()

  // Skipped onboarding cards live in the Skipped bucket alongside task cards.
  const skippedOnboarding =
    bucket === 'skipped'
      ? ONBOARDING_CARD_ORDER.filter((key) =>
          onboarding?.some((c) => c.key === key && c.status === 'skipped'),
        )
      : []

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
  if ((!cards || cards.length === 0) && skippedOnboarding.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="archive-empty">
        {EMPTY_COPY[bucket]}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {cards?.map((card) => (
        <DashboardTaskCard key={card.id} card={card} />
      ))}
      {skippedOnboarding.map((key) => {
        const config = ONBOARDING_CARDS[key]
        return (
          <TaskCard
            key={key}
            eyebrowLabel={config.eyebrowLabel}
            EyebrowIcon={SparklesIcon}
            title={config.title}
            summary={config.summary}
          />
        )
      })}
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
