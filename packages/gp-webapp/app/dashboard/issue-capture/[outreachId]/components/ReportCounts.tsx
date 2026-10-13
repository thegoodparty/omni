import type { FeedbackReportResponse } from '@goodparty_org/contracts'
import { Card } from '@styleguide'
import { whatWeHeardCopy } from '../../copy'

// Who answered and who left a note, so a theme's count can be read against
// what it came from. Each count is its own card on the gray canvas, a number
// over its label as on the theme cards' tiles.
const ReportCounts = ({
  denominators,
  isServe,
}: {
  denominators: FeedbackReportResponse['denominators']
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  const tiles: Array<[string, number]> = [
    [copy.countAnswered, denominators.conversations],
    [copy.countNoted, denominators.memos],
  ]

  return (
    // `block` because globals.css makes every `li` under a data-slot
    // ancestor a row flex box.
    <ul aria-label={copy.countsLabel} className="grid grid-cols-2 gap-3">
      {tiles.map(([label, value]) => (
        <li key={label} className="block">
          <Card className="h-full gap-0 px-4 py-3">
            <span className="text-base font-semibold tabular-nums text-foreground">
              {value.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </Card>
        </li>
      ))}
    </ul>
  )
}

export default ReportCounts
