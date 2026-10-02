import type { StanceCounts } from '@goodparty_org/contracts'
import { STANCE_LABELS, STANCE_ORDER, whatWeHeardCopy } from '../../copy'

// Four counts rather than a chart: on a theme a handful of people fed, a bar
// or a percentage claims a precision the numbers do not have.
export default function StanceSplit({
  counts,
  isServe,
}: {
  counts: StanceCounts
  isServe: boolean
}) {
  const copy = whatWeHeardCopy(isServe)
  const labels = STANCE_LABELS[isServe ? 'serve' : 'win']

  return (
    <ul aria-label={copy.stanceSplit} className="grid grid-cols-4 gap-2">
      {STANCE_ORDER.map((stance) => (
        <li
          key={stance}
          className="flex flex-col rounded-md bg-muted px-2 py-1.5"
        >
          <span className="text-base font-semibold tabular-nums text-foreground">
            {counts[stance].toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground">
            {labels[stance]}
          </span>
        </li>
      ))}
    </ul>
  )
}
