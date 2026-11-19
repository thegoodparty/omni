import type { FeedbackReportResponse } from '@goodparty_org/contracts'
import { Card } from '@styleguide'
import { whatWeHeardCopy } from '../../copy'

// Who answered and who left a note, so a theme's count can be read against
// what it came from. Voter Data's stat card (`DistrictStatCard`): one card,
// a row per count with the label left and the number right.
const ReportCounts = ({
  denominators,
  channel,
  isServe,
}: {
  denominators: FeedbackReportResponse['denominators']
  channel: FeedbackReportResponse['channel']
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  const rows: Array<[string, number]> = [
    [copy.countAnswered, denominators.conversations],
    [copy.countNoted, denominators.memos],
  ]

  // A text send keeps the one-line caption it shipped with.
  if (channel === 'text') {
    return (
      <p className="text-sm text-muted-foreground">
        {copy.replyCounts(denominators)}
      </p>
    )
  }

  return (
    <Card className="w-full gap-0 rounded-lg py-0">
      <ul aria-label={copy.countsLabel}>
        {rows.map(([label, value]) => (
          <li
            key={label}
            className="flex items-center justify-between gap-4 border-border px-4 py-3 not-first:border-t"
          >
            <span className="text-sm font-normal">{label}</span>
            <span className="text-lg font-semibold tabular-nums">
              {value.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export default ReportCounts
