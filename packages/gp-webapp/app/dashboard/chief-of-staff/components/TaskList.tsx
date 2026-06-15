'use client'

import { useState } from 'react'
import { ChevronDownIcon } from '@styleguide/components/ui/icons'
import { useDashboardCards, useDismissCard } from '../data/use-dashboard'
import DashboardTaskCard from './DashboardTaskCard'

const INITIAL_VISIBLE = 3

/**
 * The active task-card list. Shows the first few cards, with a "See more (N)"
 * control revealing the rest, and Skip on each card dismissing it via
 * `PUT /v1/dashboard/cards/:id/dismiss`.
 */
export default function TaskList(): React.JSX.Element {
  const { data: cards, isPending, isError } = useDashboardCards('active')
  const dismissCard = useDismissCard()
  const [expanded, setExpanded] = useState(false)

  if (isPending) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="task-list-loading"
      >
        Loading your tasks...
      </p>
    )
  }

  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">
        We could not load your tasks right now.
      </p>
    )
  }

  if (!cards || cards.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="task-list-empty"
      >
        You&apos;re all caught up. New tasks appear here as your briefings are
        ready.
      </p>
    )
  }

  const visible = expanded ? cards : cards.slice(0, INITIAL_VISIBLE)
  const hiddenCount = cards.length - visible.length

  return (
    <div className="flex flex-col gap-4">
      {visible.map((card) => (
        <DashboardTaskCard
          key={card.id}
          card={card}
          onSkip={(id) => dismissCard.mutate(id)}
          skipDisabled={dismissCard.isPending}
        />
      ))}

      {!expanded && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center justify-center gap-1.5 self-center text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
        >
          See more ({hiddenCount})
          <ChevronDownIcon className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}
