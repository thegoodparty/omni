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

// Dollars from the server's own cents. The client never derives a money
// figure from a per-contact price of its own — gp-api computes this from the
// same pricing utils the checkout charges from, so the card and the pay step
// cannot disagree.
const formatCents = (cents: number): string =>
  (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

export const RecommendedListCard = ({
  recommendation,
  channel,
  onSelect,
}: RecommendedListCardProps) => {
  const { copy, count, voteGoalShare, estimatedCostCents } = recommendation

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
      {voteGoalShare !== undefined && (
        <p className="text-sm text-muted-foreground">
          {/* A real list rounding to 0% reads as an empty one — and door and
              supporter lists carry no size floor, so a genuinely tiny share
              is reachable here rather than hypothetical. Floored to "<1%"
              rather than printed as zero. */}
          {voteGoalShare > 0 && voteGoalShare < 0.005
            ? '<1'
            : Math.round(voteGoalShare * 100)}
          % of your vote goal
        </p>
      )}
      {estimatedCostCents !== undefined && (
        <p className="text-sm text-muted-foreground">
          About ${formatCents(estimatedCostCents)} to reach them
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
