'use client'

import { useState } from 'react'
import { ChevronDownIcon } from '@styleguide/components/ui/icons'
import {
  useDashboardCards,
  useDismissCard,
  useOnboardingCards,
} from '../data/use-dashboard'
import DashboardTaskCard from './DashboardTaskCard'

const INITIAL_VISIBLE = 3

/**
 * The active task-card list. Shows the first few cards, with a "See more (N)"
 * control revealing the rest, and Skip on each card dismissing it via
 * `PUT /v1/dashboard/cards/:id/dismiss`.
 */
export default function TaskList({
  briefingInFlight = false,
}: {
  /** True while a briefing is generating, so the empty state stays hidden. */
  briefingInFlight?: boolean
}): React.JSX.Element | null {
  const { data: cards, isPending, isError } = useDashboardCards('active')
  const { data: onboarding } = useOnboardingCards()
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
    // Nothing above this list may contradict the empty state. The get-started
    // onboarding cards and the briefing banner both sit above it, and either
    // one showing means there IS something in progress.
    const onboardingActive = onboarding?.some((c) => c.status === 'active')
    if (onboardingActive || onboarding === undefined) return null
    if (briefingInFlight) return null
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="task-list-empty"
      >
        No tasks this week. Ask your chief of staff what is worth moving.
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
