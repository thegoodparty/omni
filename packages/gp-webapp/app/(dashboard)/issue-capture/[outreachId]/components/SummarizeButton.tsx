import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import type { FeedbackReportResponse } from '@goodparty_org/contracts'
import { Button, SparklesIcon } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { outreachProduct } from 'app/(dashboard)/outreach/util/outreachAnalytics'
import { ANALYTICS_CHANNEL } from '../../analytics'
import { whatWeHeardCopy } from '../../copy'
import { reportQueryKey } from '../queries'

interface SummarizeButtonProps {
  outreachId: number
  report: FeedbackReportResponse
  // When the report was last read, so a cooldown refusal can lift on the
  // next read rather than holding until a reload.
  reportUpdatedAt: number
  isServe: boolean
  // Under the floor the page already says why there is nothing to summarize,
  // so the button is off without repeating it.
  underFloor: boolean
}

const statusOf = (error: Error | null): number | undefined =>
  error instanceof FetchError ? error.status : undefined

const SummarizeButton = ({
  outreachId,
  report,
  reportUpdatedAt,
  isServe,
  underFloor,
}: SummarizeButtonProps) => {
  const copy = whatWeHeardCopy(isServe)
  const queryClient = useQueryClient()
  // The report read in hand when the cooldown refused, if it did.
  const [cooledAt, setCooledAt] = useState<number | null>(null)

  const start = useMutation({
    mutationFn: () =>
      clientRequest(
        'POST /v1/constituent-feedback/efforts/:outreachId/synthesize',
        { outreachId: String(outreachId) },
      ).then((res) => res.data),
    // On the press, so a refused press counts as a request too.
    onMutate: () =>
      trackEvent(EVENTS.IssueCapture.SynthesisRequested, {
        scope: 'effort',
        channel: ANALYTICS_CHANNEL[report.channel],
        confirmedCount: report.denominators.confirmed,
        product: outreachProduct(isServe),
      }),
    onError: (error) => {
      if (statusOf(error) === 429) setCooledAt(reportUpdatedAt)
    },
    // A run started, one was already in flight (409), or the counts moved
    // under the button (422): the report knows more now. A cooldown changes
    // nothing on it, so a 429 waits for the next read instead.
    onSettled: (_run, error) => {
      if (statusOf(error) === 429) return
      void queryClient.invalidateQueries({
        queryKey: reportQueryKey(outreachId),
      })
    },
  })
  const { reset } = start

  // A refusal is about the report it was made against. A new run or a new
  // confirmed count is a different report, so the button is on again.
  useEffect(() => {
    reset()
  }, [reset, report.run?.id, report.denominators.confirmed])

  // The cooldown lifts on its own, and nothing on the report says when, so
  // the next read of it is when the button offers itself again.
  useEffect(() => {
    if (cooledAt !== null && reportUpdatedAt > cooledAt) {
      setCooledAt(null)
      reset()
    }
  }, [cooledAt, reportUpdatedAt, reset])

  const status = statusOf(start.error)
  // The two refusals that pressing again cannot fix yet, so the button stays
  // off and says why. The floor comes from the report, which is the same
  // number the 422 carries.
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

export default SummarizeButton
