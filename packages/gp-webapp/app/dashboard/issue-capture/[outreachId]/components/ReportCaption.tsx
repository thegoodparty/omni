import Link from 'next/link'
import { Button } from '@styleguide'
import type { FeedbackReportResponse } from '@goodparty_org/contracts'
import { whatWeHeardCopy } from '../../copy'

// Every denominator, stated, so a theme's count can be read against what it
// came from: who answered, who left a note, and how many of those notes
// somebody who was there has confirmed. Only confirmed ones are counted.
// The ones still waiting link to the list where they get confirmed.
const ReportCaption = ({
  denominators,
  outreachId,
  isServe,
}: {
  denominators: FeedbackReportResponse['denominators']
  outreachId: number
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  return (
    <div className="flex flex-col items-start gap-1">
      <p className="text-sm text-muted-foreground">
        {copy.captionCounts(denominators)}.
      </p>
      {/* The styleguide has no inline text link, so the way to the review
          list is its link button on a line of its own, used as documented. */}
      {denominators.pending > 0 && (
        <Button asChild variant="link" size="small">
          <Link href={`/dashboard/issue-capture/${outreachId}/review`}>
            {copy.waitingForReview(denominators.pending)}
          </Link>
        </Button>
      )}
    </div>
  )
}

export default ReportCaption
