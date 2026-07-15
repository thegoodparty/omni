'use client'
import { Button } from '@styleguide'
import Body1 from '@shared/typography/Body1'
import H2 from '@shared/typography/H2'
import { useUser as useClerkUser } from '@clerk/nextjs'
import { useEffect } from 'react'
import Link from 'next/link'
import { reportErrorToSentry } from '@shared/sentry'
import { sendError } from 'app/error'

interface DashboardErrorProps {
  error: Error
  reset: () => void
}

export default function DashboardError({
  error,
  reset,
}: DashboardErrorProps): React.JSX.Element {
  const { user: clerkUser, isLoaded } = useClerkUser()

  useEffect(() => {
    reportErrorToSentry(error)
    if (error?.message?.startsWith('Loading chunk')) {
      window.location.reload()
    }
  }, [error])

  useEffect(() => {
    if (!isLoaded) return
    sendError({
      message: error?.message,
      url: window.location.href,
      userEmail: clerkUser?.primaryEmailAddress?.emailAddress,
      userAgent: window?.navigator?.userAgent,
    })
  }, [isLoaded, error, clerkUser?.primaryEmailAddress?.emailAddress])

  return (
    <div className="flex flex-col items-center justify-center px-3 py-16 lg:px-5">
      <div className="max-w-md text-center">
        <H2>Something went wrong loading this page</H2>
        <Body1 className="my-5">
          Our engineers are blaming the two-party-system. You can try again, or
          head back to your dashboard.
        </Body1>
        <div className="flex items-center justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
        <div className="text-sm italic mt-8">{error?.message}</div>
      </div>
    </div>
  )
}
