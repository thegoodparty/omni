import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import type { FeedbackReportResponse } from '@goodparty_org/contracts'
import { Button, SparklesIcon } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { outreachProduct } from 'app/dashboard/outreach/util/outreachAnalytics'
import { ANALYTICS_CHANNEL } from '../../analytics'
import { whatWeHeardCopy } from '../../copy'
import { reportQueryKey } from '../queries'

interface SummarizeButtonProps {
  outreachId: number
  report: FeedbackReportResponse
  isServe: boolean
  // Under the floor the page already says why there is nothing to summarize,
  // so the button is off without repeating it.
  underFloor: boolean
}

export default function SummarizeButton({
  outreachId,
  report,
  isServe,
  underFloor,
}: SummarizeButtonProps) {
  const copy = whatWeHeardCopy(isServe)
  const queryClient = useQueryClient()

  const start = useMutation({
    mutationFn: () =>
      clientRequest(
        'POST /v1/constituent-feedback/efforts/:outreachId/synthesize',
        { outreachId: String(outreachId) },
      ).then((res) => res.data),
    onMutate: () =>
      trackEvent(EVENTS.IssueCapture.SynthesisRequested, {
        scope: 'effort',
        channel: ANALYTICS_CHANNEL[report.channel],
        confirmedCount: report.denominators.confirmed,
        product: outreachProduct(isServe),
      }),
    // Whatever came back, the report knows more now: a run started, one was
    // already in flight (409), or the counts moved under the button (422).
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: reportQueryKey(outreachId) }),
  })

  const status =
    start.error instanceof FetchError ? start.error.status : undefined
  // The two refusals that pressing again cannot fix, so the button stays off
  // and says why. The floor comes from the report, which is the same number
  // the 422 carries.
  const refusal =
    status === 422
      ? copy.floorLine(report.floor)
      : status === 429
        ? copy.coolingDown
        : null
  const helper =
    refusal ?? (start.isError && status !== 409 ? copy.summarizeFailed : null)

  return (
    <div className="flex flex-col items-start gap-1 md:items-end">
      <Button
        variant="outline"
        disabled={underFloor || refusal !== null || start.isPending}
        onClick={() => start.mutate()}
      >
        <SparklesIcon />
        {copy.summarize}
      </Button>
      {helper !== null && (
        <p className="text-sm text-muted-foreground">{helper}</p>
      )}
    </div>
  )
}
