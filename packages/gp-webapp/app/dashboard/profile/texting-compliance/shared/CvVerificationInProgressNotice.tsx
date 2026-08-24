import Link from 'next/link'

const PROFILE_ROUTE = '/dashboard/account'

// Shown on the full-page PIN surfaces when CampaignVerify has the
// registration but has not issued a PIN yet. Nothing to enter, so there is no
// form — and no wording that implies the candidate is holding something up.
export default function CvVerificationInProgressNotice(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
      <p className="font-medium">Your registration is being verified</p>
      <p className="mt-1">
        CampaignVerify hasn’t issued your PIN yet. We’ll email you as soon as
        it’s on its way — this can take a few business days.
      </p>
      <div className="mt-3">
        <Link href={PROFILE_ROUTE} className="text-blue-600 underline">
          Back to account
        </Link>
      </div>
    </div>
  )
}
