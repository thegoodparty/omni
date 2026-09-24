'use client'

import { useEffect, useRef, useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import { useSearchParams } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Button, GoodPartyOrgLogoWordmark } from '@styleguide'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { WIN_ONBOARDING_PATH } from 'helpers/resolvePostAuthRedirectPath.util'

/**
 * Candidate magic-link redemption landing page. A sales-sent link carries a
 * Clerk sign-in token as `__clerk_ticket`; we redeem it via the `ticket`
 * strategy (the same mechanism as impersonation), then route through
 * `/post-auth-redirect` so the lead — who has no campaign and no elected
 * office — lands in the candidate ("win") onboarding flow.
 *
 * Redemption is **click-driven, never automatic on load**. Sign-in tokens are
 * one-time use, and email-security scanners (Microsoft Safe Links, etc.) and
 * chat unfurlers pre-fetch URLs (GET) — auto-redeeming on mount would let those
 * bots burn the ticket before the human ever opened the link. A button-gated
 * redemption defeats that, because scanners don't click.
 */

const POST_AUTH_REDIRECT = `/post-auth-redirect?next=${encodeURIComponent(
  WIN_ONBOARDING_PATH,
)}`

const MISSING_TICKET_MESSAGE =
  'This sign-in link is missing its token. Please request a new one.'

const CONSUMED_TICKET_MESSAGE =
  'This sign-in link has already been used or has expired. Request a new link, or sign in below.'

export default function WinWelcomeContent() {
  const clerk = useClerk()
  const { client, setActive, signOut, loaded } = clerk
  const searchParams = useSearchParams()
  const [redeeming, setRedeeming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Synchronous re-entrancy guard: `setRedeeming(true)` only disables the
  // button after a re-render, so a rapid double-click could otherwise fire two
  // parallel `signIn.create` calls against the same one-time ticket — one would
  // consume it while the other failed and surfaced a spurious expired-link
  // error.
  const redeemingRef = useRef(false)

  const ticket = searchParams?.get('__clerk_ticket') ?? null
  // The ticket's Clerk user id, stamped onto the URL by gp-api when it built
  // the link. It CANNOT be read from the token itself — Clerk sign-in-token
  // JWTs carry no `sub`/user claim — and without it a signed-in recipient who
  // re-opens their own link would be signed out and shown "already used"
  // (the ticket is single-use). Advisory only: Clerk re-verifies the token on
  // redemption, so a forged value can't sign anyone in.
  const ticketUserId = searchParams?.get('uid') ?? null

  // Top of the candidate ("win") onboarding funnel: the recipient clicked the
  // magic link and landed on this redemption page. Landing-based firing is the
  // most reliable signal (the redemption itself is button-gated to defeat email
  // scanners), so fire once on mount — even if the ticket is missing/expired, a
  // human still arrived here. Shares the `Onboarding - Magic Link Clicked` event
  // with the serve flow; the `type: 'win'` property mirrors the server-side
  // `Onboarding - Magic Link Sent` so the sent → clicked funnel can be segmented
  // per flow in Amplitude. Without this, the win funnel only ever saw "sent".
  const magicLinkClickedRef = useRef(false)
  useEffect(() => {
    if (magicLinkClickedRef.current) return
    magicLinkClickedRef.current = true
    trackEvent(EVENTS.Onboarding.MagicLinkClicked, {
      hasTicket: !!ticket,
      type: 'win',
    })
  }, [ticket])

  async function redeem() {
    if (!ticket) {
      setError(MISSING_TICKET_MESSAGE)
      return
    }
    if (redeemingRef.current) return

    redeemingRef.current = true
    setError(null)
    setRedeeming(true)
    try {
      // Only touch the existing session once the user has explicitly clicked.
      if (clerk.user) {
        if (ticketUserId && ticketUserId === clerk.user.id) {
          // The person is already signed in as the ticket's user. Don't redeem
          // (that would burn the one-time ticket for no reason) — just continue
          // to the post-auth redirect.
          window.location.href = POST_AUTH_REDIRECT
          return
        }

        // A different (or stale) session is active. Clear it BEFORE redeeming so
        // the lead's own session is the one we activate. We pass a no-op
        // callback to `signOut` so Clerk runs the callback INSTEAD of its
        // default post-sign-out navigation — that redirect (to
        // `afterSignOutUrl`) would unload this page before the ticket could be
        // redeemed.
        try {
          await signOut(() => undefined)
        } catch (signOutErr) {
          // A transient sign-out hiccup shouldn't strand the recipient — the
          // ticket redemption + setActive below still switch them onto their
          // own session.
          console.warn(
            '[win/welcome] sign-out before redemption failed; continuing',
            signOutErr,
          )
        }
      }

      const result = await client.signIn.create({
        strategy: 'ticket',
        ticket,
      })

      if (result.status !== 'complete' || !result.createdSessionId) {
        throw new Error(`Sign-in not complete (status: ${result.status}).`)
      }

      await setActive({ session: result.createdSessionId })

      window.location.href = POST_AUTH_REDIRECT
    } catch (err) {
      console.error('[win/welcome] redemption failed:', err)
      setError(CONSUMED_TICKET_MESSAGE)
      setRedeeming(false)
      redeemingRef.current = false
    }
  }

  const showError = error ?? (ticket ? null : MISSING_TICKET_MESSAGE)

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="flex items-center border-b border-base-border px-6 py-4">
        <GoodPartyOrgLogoWordmark size="small" textVariant="dark" />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md text-center">
          {showError ? (
            <>
              <h1
                className="text-3xl leading-tight font-semibold tracking-tight text-foreground"
                style={{ fontFamily: 'var(--font-geist)' }}
              >
                We couldn’t sign you in
              </h1>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                {showError}
              </p>
              <Button size="large" className="mt-8 px-8" asChild>
                <a href="/login">Go to login</a>
              </Button>
            </>
          ) : (
            <>
              <h1
                className="text-3xl leading-tight font-semibold tracking-tight text-foreground md:text-4xl"
                style={{ fontFamily: 'var(--font-geist)' }}
              >
                Welcome to GoodParty.org
              </h1>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                You’ve been invited to set up your campaign and start building
                your winning plan. Click below to securely sign in and get
                started.
              </p>
              <Button
                size="large"
                className="mt-8 px-8"
                onClick={redeem}
                disabled={!loaded}
                loading={redeeming}
                loadingText="Signing you in…"
                icon={<ArrowRight className="h-4 w-4" />}
                iconPosition="right"
              >
                Continue to GoodParty
              </Button>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
