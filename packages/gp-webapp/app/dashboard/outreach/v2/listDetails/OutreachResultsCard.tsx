import { ChartColumnIcon } from '@styleguide/components/ui/icons'
import { formatResultCount, percentOf } from '../outreachResultsCopy'

export interface OutreachResultRow {
  label: string
  count: number
  // Names what the share means where it has a name of its own (CTR).
  percentSuffix?: string
}

interface OutreachResultsCardProps {
  basedOn: string
  total: number
  rows: OutreachResultRow[]
  testId?: string
}

// Every channel's results card: the total it is based on, then each outcome
// as a count and its share of that total.
export const OutreachResultsCard = ({
  basedOn,
  total,
  rows,
  testId,
}: OutreachResultsCardProps) => (
  <div
    className="overflow-hidden rounded-lg border border-border"
    data-testid={testId}
  >
    <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
      <ChartColumnIcon className="size-4" />
      {basedOn}
    </div>
    {rows.map((row) => (
      <div
        key={row.label}
        className="flex items-center justify-between border-t border-border px-3 py-2"
      >
        <span className="text-sm">{row.label}</span>
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">
            {formatResultCount(row.count)}
          </span>
          <span className="text-xs text-muted-foreground">
            {percentOf(row.count, total)}%
            {row.percentSuffix ? ` ${row.percentSuffix}` : ''}
          </span>
        </span>
      </div>
    ))}
  </div>
)
