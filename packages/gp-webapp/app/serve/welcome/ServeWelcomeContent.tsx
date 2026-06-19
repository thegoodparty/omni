'use client'

import { useEffect, useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import { useSearchParams } from 'next/navigation'
import { LoaderCircle } from 'lucide-react'
import { SERVE_ONBOARDING_PATH } from 'helpers/resolvePostAuthRedirectPath.util'

/**
 * Magic-link redemption landing page. A sales-sent link carries a Clerk
 * sign-in token as `__clerk_ticket`; we redeem it via the `ticket` strategy
 * (the same mechanism as impersonation), then route through
 * `/post-auth-redirect` so the elected-office org cookie is established before
 * landing the lead in the serve onboarding flow.
 */
export default function ServeWelcomeContent() {
  const clerk = useClerk()
  const { client, setActive, signOut, loaded } = clerk
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
        // If a session is already active in this browser (e.g. a colleague is
        // signed into the same machine, or the recipient has a stale session),
        // clear it BEFORE redeeming the ticket so the lead's own session is the
        // one we activate. We pass a no-op callback to `signOut` so Clerk runs
        // the callback INSTEAD of its default post-sign-out navigation — that
        // redirect (to `afterSignOutUrl`) would unload this page before the
        // ticket could be redeemed, which is exactly why already-logged-in
        // recipients were being bounced to `/login`. When there is no active
        // session, `signOut` is a no-op, so the fresh-browser happy path is
        // unchanged. The ticket is redeemed and `setActive` below switches to
        // the new session, so a same-user session simply re-establishes itself
        // without erroring.
        if (clerk.user) {
          try {
            // The callback runs in place of Clerk's default navigation; it
            // intentionally does nothing so we stay on this page to redeem.
            await signOut(() => undefined)
          } catch (signOutErr) {
            // A transient sign-out hiccup shouldn't strand the recipient — the
            // ticket redemption + setActive below still switches them onto
            // their own session.
            console.warn(
              '[serve/welcome] sign-out before redemption failed; continuing',
              signOutErr,
            )
          }
        }

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
          SERVE_ONBOARDING_PATH,
        )}`
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[serve/welcome] redemption failed:', err)
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
