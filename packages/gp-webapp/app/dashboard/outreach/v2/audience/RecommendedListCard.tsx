'use client'

import { Card } from '@styleguide'
import type {
  RecommendedList,
  RecommendedListChannel,
} from '@goodparty_org/contracts'

interface RecommendedListCardProps {
  recommendation: RecommendedList
  // Door counts are voters, but the built-in door-knocking segment in the
  // CRM counts households (segmentsToFiltersMap.const.ts's
  // groupByHousehold), so a door-knocking card reads roughly 2x its
  // Contacts counterpart with nothing on screen to explain the gap — this
  // caveat is the fix, not a count change (docs/features/recommended-lists.md).
  channel: RecommendedListChannel
  onSelect: () => void
}

export const RecommendedListCard = ({
  recommendation,
  channel,
  onSelect,
}: RecommendedListCardProps) => {
  const { copy, count, districtShare } = recommendation

  return (
    <Card
      role="button"
      tabIndex={0}
      data-testid="recommended-list-card"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect()
      }}
      className="cursor-pointer gap-1 p-4 text-left transition-colors hover:border-primary/50"
    >
      <p className="font-medium text-foreground">{copy.title}</p>
      <p className="text-sm text-muted-foreground">{copy.criteriaSummary}</p>
      <p className="text-sm text-muted-foreground">
        {count.toLocaleString()} people
      </p>
      {districtShare !== undefined && (
        <p className="text-sm text-muted-foreground">
          {Math.round(districtShare * 100)}% of your district
        </p>
      )}
      {channel === 'doorKnocking' && (
        <p className="text-xs text-muted-foreground">
          Counts individual voters, not households.
        </p>
      )}
    </Card>
  )
}
