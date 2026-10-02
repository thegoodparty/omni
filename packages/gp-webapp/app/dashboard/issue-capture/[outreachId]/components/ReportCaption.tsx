import type { FeedbackReportResponse } from '@goodparty_org/contracts'
import { whatWeHeardCopy } from '../../copy'

// Every denominator, stated, so a theme's count can be read against what it
// came from: who answered, who left a note, and how many of those notes
// somebody who was there has confirmed. Only confirmed ones are counted.
export default function ReportCaption({
  denominators,
  isServe,
}: {
  denominators: FeedbackReportResponse['denominators']
  isServe: boolean
}) {
  return (
    <p className="text-sm text-muted-foreground">
      {whatWeHeardCopy(isServe).caption(denominators)}
    </p>
  )
}
