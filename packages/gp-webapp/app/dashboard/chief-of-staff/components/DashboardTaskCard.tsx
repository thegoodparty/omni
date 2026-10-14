'use client'

import { format, parseISO } from 'date-fns'
import { isCivicPanelBuildCard } from '@goodparty_org/contracts'
import TaskCard from './TaskCard'
import { cardCategory } from './cardCategory'
import type { DashboardCard } from '../data/contracts'

interface Props {
  card: DashboardCard
  onSkip?: (id: string) => void
  skipDisabled?: boolean
  onRestore?: (id: string) => void
  restoreDisabled?: boolean
}

function formatDueDate(iso: string): string | null {
  try {
    return format(parseISO(iso), 'EEEE, MMMM d')
  } catch {
    return null
  }
}

/** Adapts a `DashboardCard` DTO onto the shared `TaskCard`. */
export default function DashboardTaskCard({
  card,
  onSkip,
  skipDisabled,
  onRestore,
  restoreDisabled,
}: Props): React.JSX.Element {
  const { label } = cardCategory(card.type)
  // The build card's due date is not a deadline the official has.
  const dueLine = isCivicPanelBuildCard(card)
    ? null
    : formatDueDate(card.dueDate)
  return (
    <TaskCard
      overlineLabel={label}
      title={card.title}
      meta={dueLine ? [dueLine] : undefined}
      summary={card.summary}
      ctaLabel={card.ctaLabel}
      ctaHref={card.ctaHref}
      onSkip={onSkip ? () => onSkip(card.id) : undefined}
      skipDisabled={skipDisabled}
      onRestore={onRestore ? () => onRestore(card.id) : undefined}
      restoreDisabled={restoreDisabled}
    />
  )
}
