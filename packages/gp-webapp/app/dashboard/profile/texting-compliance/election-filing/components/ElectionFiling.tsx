'use client'
import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ElectionFilingForm from './ElectionFilingForm'

export { getInitialFormState } from './ElectionFilingForm'

export default function ElectionFiling(): React.JSX.Element {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-white pt-2 md:pt-4">
      <div className="mx-auto w-full max-w-2xl p-4">
        <div className="flex items-center justify-between">
          <Link href="/dashboard/account" aria-label="Back to account">
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <div className="font-medium md:text-xl">Election filing</div>
          <div>&nbsp;</div>
        </div>

        <div className="mt-10">
          <ElectionFilingForm
            // Land on the design's submitted-for-verification confirmation
            // (PIN expectations) instead of bouncing to account settings.
            onSubmitted={() =>
              router.push(
                '/dashboard/profile/texting-compliance/verification-submitted',
              )
            }
          />
        </div>
      </div>
    </div>
  )
}
