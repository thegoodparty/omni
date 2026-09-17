import Link from 'next/link'

const PROFILE_ROUTE = '/dashboard/account'

// The registration isn't at the PIN step at all (no record yet, or it has
// already moved past it).
export default function PinStepUnavailableNotice(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
      <p>
        This step isn’t available yet. Complete the previous steps from your
        account to continue.
      </p>
      <div className="mt-3">
        <Link href={PROFILE_ROUTE} className="text-blue-600 underline">
          Back to account
        </Link>
      </div>
    </div>
  )
}
