import Link from 'next/link'
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
    <p className="text-sm text-muted-foreground">
      {copy.captionCounts(denominators)}
      {denominators.pending > 0 ? (
        <>
          {', '}
          <Link
            href={`/dashboard/issue-capture/${outreachId}/review`}
            // The styleguide's link colour and an underline, so the one
            // clause that goes somewhere reads as a link. `underline!`
            // because globals.css strips text-decoration from every anchor
            // inside the dashboard's sidebar wrapper with an unlayered rule,
            // which outranks the plain utility.
            className="text-link underline! underline-offset-4"
          >
            {copy.waitingForReview(denominators.pending)}
          </Link>
          .
        </>
      ) : (
        '.'
      )}
    </p>
  )
}

export default ReportCaption
