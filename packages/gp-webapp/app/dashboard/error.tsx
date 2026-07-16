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

  const isChunkLoadError = error?.message?.startsWith('Loading chunk')

  useEffect(() => {
    reportErrorToSentry(error)
    if (error?.message?.startsWith('Loading chunk')) {
      // Flush telemetry before navigating away — the reload would abort an
      // in-flight fetch. Not gated on Clerk's isLoaded (the failed chunk may
      // be Clerk's own), so userEmail may be undefined. sendError catches
      // internally, so the reload always happens.
      sendError({
        message: error?.message,
        url: window.location.href,
        userEmail: clerkUser?.primaryEmailAddress?.emailAddress,
        userAgent: window?.navigator?.userAgent,
      }).then(() => {
        window.location.reload()
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per error with a best-effort user snapshot; must not re-run (or wait) on Clerk state
  }, [error])

  useEffect(() => {
    if (!isLoaded || isChunkLoadError) return
    sendError({
      message: error?.message,
      url: window.location.href,
      userEmail: clerkUser?.primaryEmailAddress?.emailAddress,
      userAgent: window?.navigator?.userAgent,
    })
  }, [
    isLoaded,
    isChunkLoadError,
    error,
    clerkUser?.primaryEmailAddress?.emailAddress,
  ])

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
