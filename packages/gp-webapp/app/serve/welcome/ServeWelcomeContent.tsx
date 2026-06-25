'use client'

import { useEffect, useRef, useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import { isClerkAPIResponseError } from '@clerk/nextjs/errors'
import { useSearchParams } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Button, GoodPartyOrgLogoWordmark } from '@styleguide'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { SERVE_ONBOARDING_PATH } from 'helpers/resolvePostAuthRedirectPath.util'

/**
 * Magic-link redemption landing page. A sales-sent link carries a Clerk
 * sign-in token as `__clerk_ticket`; we redeem it via the `ticket` strategy
 * (the same mechanism as impersonation), then route through
 * `/post-auth-redirect` so the elected-office org cookie is established before
 * landing the lead in the serve onboarding flow.
 *
 * Redemption is **click-driven, never automatic on load**. Sign-in tokens are
 * one-time use, and email-security scanners (Microsoft Safe Links, etc.) and
 * chat unfurlers pre-fetch URLs (GET) — auto-redeeming on mount would let those
 * bots burn the ticket before the human ever opened the link. A button-gated
 * redemption defeats that, because scanners don't click.
 */

const POST_AUTH_REDIRECT = `/post-auth-redirect?next=${encodeURIComponent(
  SERVE_ONBOARDING_PATH,
)}`

const MISSING_TICKET_MESSAGE =
  'This sign-in link is missing its token. Please request a new one.'

const CONSUMED_TICKET_MESSAGE =
  'This sign-in link has already been used or has expired. Request a new link, or sign in below.'

// Shown for transient/recoverable failures (network blips, a post-exchange
// `setActive` hiccup, etc.) — anything that is NOT a genuinely dead ticket.
// Critically distinct from CONSUMED_TICKET_MESSAGE so we never tell a user the
// link is invalid when the real problem was a temporary glitch.
const RETRYABLE_MESSAGE =
  'Something went wrong while signing you in. Please go to login to try again, or request a new link from your GoodParty contact.'

/**
 * Best-effort decode of the `sub` (user id) claim from the sign-in-token JWT so
 * we can tell whether the already-active session belongs to the person the
 * ticket is for. Purely an optimization — if the token can't be decoded we fall
 * through to the normal sign-out + redeem path, which is also correct.
 */
function decodeTicketUserId(ticket: string): string | null {
  try {
    const payload = ticket.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const claims = JSON.parse(atob(padded)) as { sub?: unknown }
    return typeof claims.sub === 'string' ? claims.sub : null
  } catch {
    return null
  }
}

/**
 * Does a thrown error indicate the sign-in token itself is dead (single-use
 * ticket already consumed, expired, or otherwise invalid)? Only those warrant
 * the "request a new link" copy. We inspect the Clerk API error's code/messages
 * for the ticket / sign-in-token / expired signals; a transient network or
 * `setActive` failure won't match and so falls through to the retryable
 * message instead of being mislabeled as a consumed link.
 */
function isConsumedOrExpiredTicketError(err: unknown): boolean {
  if (!isClerkAPIResponseError(err)) return false
  return err.errors.some((e) => {
    const haystack = `${e.code ?? ''} ${e.message ?? ''} ${
      e.longMessage ?? ''
    }`.toLowerCase()
    return (
      haystack.includes('ticket') ||
      haystack.includes('sign-in token') ||
      haystack.includes('sign in token') ||
      haystack.includes('expired') ||
      haystack.includes('already been used') ||
      haystack.includes('consumed')
    )
  })
}

export default function ServeWelcomeContent() {
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

  // Top of the serve onboarding funnel: the recipient clicked the magic link
  // and landed on this redemption page. Landing-based firing is the most
  // reliable signal (the redemption itself is button-gated to defeat email
  // scanners), so fire once on mount — even if the ticket is missing/expired,
  // a human still arrived here. Replaces the former onboarding-flow-mount
  // 'Serve Onboarding - Magic Link Activated' event.
  const magicLinkClickedRef = useRef(false)
  useEffect(() => {
    if (magicLinkClickedRef.current) return
    magicLinkClickedRef.current = true
    trackEvent(EVENTS.Onboarding.MagicLinkClicked, { hasTicket: !!ticket })
  }, [ticket])

  async function redeem() {
    if (!ticket) {
      setError(MISSING_TICKET_MESSAGE)
      return
    }
    if (redeemingRef.current) return

    // Latch the guard for the whole attempt. Once the exchange has been
    // attempted the ticket may already be spent server-side, so we must NEVER
    // re-run `signIn.create` for this mount — even after an error. Any recovery
    // flows through the session-state check below, not a second exchange.
    redeemingRef.current = true
    setError(null)
    setRedeeming(true)

    const ticketUserId = decodeTicketUserId(ticket)
    // Whoever (if anyone) was signed in when this attempt began. Lets us detect
    // a session that appears *during* the redeem even when the ticket's user id
    // can't be decoded from the token.
    const initialUserId = clerk.user?.id ?? null

    // Has redemption effectively succeeded — i.e. is a session for the ticket's
    // user now active? Used as a recovery signal so transient post-exchange
    // failures — and clerk-js's internal FAPI retry of the exchange POST that
    // throws "already consumed" after the first attempt already succeeded —
    // resolve to success instead of a spurious "consumed link" error.
    // `clerk.user` is a live getter on the Clerk singleton, so it reflects a
    // session established mid-redeem.
    const isSignedInAsTicketUser = () => {
      const currentUserId = clerk.user?.id ?? null
      if (!currentUserId) return false
      // Preferred signal: the active session belongs to the ticket's user.
      if (ticketUserId) return currentUserId === ticketUserId
      // Fallback when the token isn't a decodable JWT (no `sub` to compare): a
      // session that appeared (or changed) since this attempt started is the
      // one the exchange just established. Requiring a change from
      // `initialUserId` avoids treating a pre-existing, not-yet-cleared
      // different session as a successful redemption.
      return currentUserId !== initialUserId
    }

    try {
      // Only touch the existing session once the user has explicitly clicked.
      if (clerk.user) {
        if (isSignedInAsTicketUser()) {
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
            '[serve/welcome] sign-out before redemption failed; continuing',
            signOutErr,
          )
        }
      }

      const result = await client.signIn.create({
        strategy: 'ticket',
        ticket,
      })

      if (result.status !== 'complete' || !result.createdSessionId) {
        // Before concluding the ticket is dead, check whether a session for the
        // ticket user already exists: clerk-js's FAPI layer can internally
        // retry the exchange POST, so the first attempt may have established a
        // session even though this (retried) result came back incomplete. Mirror
        // the same recovery the outer catch performs.
        if (isSignedInAsTicketUser()) {
          window.location.href = POST_AUTH_REDIRECT
          return
        }
        // The exchange returned without completing a sign-in and no session
        // exists: the ticket is genuinely invalid/expired/already-consumed.
        // Show the recovery copy; the latched guard prevents a re-attempt.
        setError(CONSUMED_TICKET_MESSAGE)
        setRedeeming(false)
        return
      }

      // The ticket is now irreversibly spent. From here a failure must NEVER be
      // reported as a consumed/expired link. `setActive` only flips the active
      // session client-side, so a transient failure is safe to retry once.
      try {
        await setActive({ session: result.createdSessionId })
      } catch (setActiveErr) {
        console.warn(
          '[serve/welcome] setActive failed after a completed ticket exchange; retrying once',
          setActiveErr,
        )
        try {
          await setActive({ session: result.createdSessionId })
        } catch (retryErr) {
          console.warn(
            '[serve/welcome] setActive retry failed; checking session state before continuing',
            retryErr,
          )
          // setActive establishes the active-session cookie; if it never
          // succeeded we can only proceed when a session for the ticket user is
          // nonetheless active (e.g. an earlier partial activation or clerk-js's
          // internal retry wrote it). Otherwise the user isn't actually signed
          // in — navigating to the post-auth redirect would silently bounce them
          // to login with their ticket already spent, so surface the retryable
          // message instead.
          if (!isSignedInAsTicketUser()) {
            setError(RETRYABLE_MESSAGE)
            setRedeeming(false)
            return
          }
        }
      }

      window.location.href = POST_AUTH_REDIRECT
    } catch (err) {
      console.error('[serve/welcome] redemption failed:', err)

      // The exchange POST can be auto-retried by clerk-js's FAPI layer after a
      // transient blip; the first attempt may have already consumed the ticket
      // AND established the session, so the retry throws "already consumed" even
      // though sign-in actually succeeded. If a session for the ticket user now
      // exists, redemption succeeded — navigate instead of surfacing an error.
      if (isSignedInAsTicketUser()) {
        window.location.href = POST_AUTH_REDIRECT
        return
      }

      // Only a genuinely dead ticket gets the "request a new link" copy.
      // Transient network failures get a distinct, retryable message — never
      // the consumed message.
      setError(
        isConsumedOrExpiredTicketError(err)
          ? CONSUMED_TICKET_MESSAGE
          : RETRYABLE_MESSAGE,
      )
      setRedeeming(false)
      // Intentionally do NOT reset `redeemingRef`: the exchange has been
      // attempted, so a second click must not fire `signIn.create` again on a
      // possibly-spent ticket.
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
                You’ve been invited to set up your elected-official account.
                Click below to securely sign in and get started.
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
