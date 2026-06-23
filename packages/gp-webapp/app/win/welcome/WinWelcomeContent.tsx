'use client'

import { useEffect, useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import { useSearchParams } from 'next/navigation'
import { LoaderCircle } from 'lucide-react'
import { WIN_ONBOARDING_PATH } from 'helpers/resolvePostAuthRedirectPath.util'

/**
 * Candidate magic-link redemption landing page. A sales-sent link carries a
 * Clerk sign-in token as `__clerk_ticket`; we redeem it via the `ticket`
 * strategy (the same mechanism as impersonation), then route through
 * `/post-auth-redirect` so the lead — who has no campaign and no elected
 * office — lands in the candidate ("win") onboarding flow.
 */
export default function WinWelcomeContent() {
  const { client, setActive, signOut, loaded } = useClerk()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  const ticket = searchParams?.get('__clerk_ticket') ?? null

  useEffect(() => {
    if (!loaded) return

    if (!ticket) {
      setError('This link is missing its sign-in token.')
      return
    }

    async function run() {
      try {
        // Clear any stale session so the ticket establishes the lead's own.
        await signOut()

        const result = await client.signIn.create({
          strategy: 'ticket',
          ticket: ticket!,
        })

        if (result.status !== 'complete' || !result.createdSessionId) {
          throw new Error(
            `Sign-in not complete (status: ${result.status}). This link may have expired.`,
          )
        }

        await setActive({ session: result.createdSessionId })

        window.location.href = `/post-auth-redirect?next=${encodeURIComponent(
          WIN_ONBOARDING_PATH,
        )}`
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[win/welcome] redemption failed:', err)
        setError(msg)
      }
    }

    run()
  }, [loaded, ticket])

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-semibold text-red-600">We couldn’t sign you in</p>
        <p className="max-w-md text-sm text-gray-600">{error}</p>
        <a className="text-sm underline" href="/login">
          Go to login
        </a>
      </div>
    )
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <LoaderCircle className="animate-spin" />
    </div>
  )
}
