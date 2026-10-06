'use client'

import { useQuery } from '@tanstack/react-query'
import { Spinner } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import PendingMemoList from 'app/dashboard/issue-capture/[outreachId]/review/components/PendingMemoList'
import { whatWeHeardCopy } from 'app/dashboard/issue-capture/copy'

interface VolunteerReviewPageProps {
  turfId: number
  isServe: boolean
}

// The volunteer's "Notes to review" for one turf: the same list and card the
// manager's page shows, which gp-api narrows to the notes this volunteer
// recorded. The turf's envelope comes from the turf read the walk page
// already makes (same key, so coming from the walk costs no request), and
// the arrow leads back to the walk rather than to the report, which is the
// manager's.
const VolunteerReviewPage = ({ turfId, isServe }: VolunteerReviewPageProps) => {
  const copy = whatWeHeardCopy(isServe)
  const turfQuery = useQuery({
    queryKey: ['door-knocking-turf', turfId],
    queryFn: () =>
      clientRequest('GET /v1/door-knocking/turfs/:id', {
        id: String(turfId),
      }).then((res) => res.data),
  })
  const outreachId = turfQuery.data?.outreachId ?? null

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      {outreachId !== null ? (
        <PendingMemoList
          outreachId={outreachId}
          isServe={isServe}
          back={{
            href: `/volunteer/door-knocking/${turfId}`,
            label: copy.backToWalk,
          }}
        />
      ) : turfQuery.isError || turfQuery.data ? (
        <p role="alert" className="text-sm text-destructive">
          {copy.loadFailed}
        </p>
      ) : (
        <div className="flex items-center justify-center gap-3 py-20">
          <Spinner />
          <p className="text-base text-foreground">{copy.loading}</p>
        </div>
      )}
    </div>
  )
}

export default VolunteerReviewPage
