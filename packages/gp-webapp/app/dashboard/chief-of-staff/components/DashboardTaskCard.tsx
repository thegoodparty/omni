'use client'

import { format, parseISO } from 'date-fns'
import TaskCard from './TaskCard'
import { cardCategory } from './cardCategory'
import type { DashboardCard } from '../data/contracts'

interface Props {
  card: DashboardCard
  onSkip?: (id: string) => void
  skipDisabled?: boolean
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
}: Props): React.JSX.Element {
  const { label, Icon } = cardCategory(card.type)
  const dueLine = formatDueDate(card.dueDate)
  return (
    <TaskCard
      eyebrowLabel={label}
      EyebrowIcon={Icon}
      title={card.title}
      meta={dueLine ? [dueLine] : undefined}
      summary={card.summary}
      ctaLabel={card.ctaLabel}
      ctaHref={card.ctaHref}
      onSkip={onSkip ? () => onSkip(card.id) : undefined}
      skipDisabled={skipDisabled}
    />
  )
}
