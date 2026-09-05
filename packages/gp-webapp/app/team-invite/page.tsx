'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useClerk, useUser as useClerkUser } from '@clerk/nextjs'
import { isClerkAPIResponseError } from '@clerk/nextjs/errors'
import { useSearchParams } from 'next/navigation'
import { TeamInviteMetadataSchema } from '@goodparty_org/contracts'
import type { TeamInviteRole } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { setCookie } from 'helpers/cookieHelper'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'
import {
  Button,
  GoodPartyOrgLogoWordmark,
  Input,
  Label,
  LoaderCircleIcon,
} from '@styleguide'

// Role label is always "Campaign Manager" — never "Admin" — mirroring the
// same rule in gp-api's team-member-added email content (Phase 1 only ever
// invites campaignAdmin; volunteer is Phase 1.5, kept here so this stays
// exhaustive over TeamInviteRole).
const ROLE_LABELS: Record<TeamInviteRole, string> = {
  campaignAdmin: 'Campaign Manager',
  volunteer: 'Volunteer',
}

// Org slugs are `slugify(campaignName)` plus an optional numeric
// disambiguation suffix (gp-api's buildSlug) — reversing that gives a
// readable approximation of the campaign name for display only. Nothing here
// is trusted: gp-api re-reads the real invite from Clerk at accept.
const formatCampaignName = (slug: string): string => {
  const segments = slug.split('-').filter(Boolean)
  const lastSegment = segments[segments.length - 1]
  const nameSegments =
    segments.length > 1 && lastSegment && /^\d+$/.test(lastSegment)
      ? segments.slice(0, -1)
      : segments
  return nameSegments
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

const ACCEPT_ERROR_MESSAGE =
  'Something went wrong accepting this invitation. Please try again.'

const CONSUMED_TICKET_MESSAGE =
  'This invitation link has already been used or has expired. Ask whoever invited you to send a new one.'

const RETRYABLE_TICKET_MESSAGE =
  'Something went wrong setting up your account. Please try again.'

// The invited email already has an account — the ticket must be redeemed via
// sign-in, not sign-up (a user created after the invite was sent).
const isIdentifierExistsError = (err: unknown): boolean =>
  isClerkAPIResponseError(err) &&
  err.errors.some((e) => e.code === 'form_identifier_exists')

// Mirrors /serve/welcome: only a genuinely dead ticket gets the
// "request a new link" copy — a transient failure must never be mislabeled
// as a consumed invitation.
const isConsumedOrExpiredTicketError = (err: unknown): boolean => {
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

// Clerk's form errors (password strength, etc.) carry actionable
// user-facing copy — surface it instead of a generic failure.
const ticketErrorMessage = (err: unknown): string => {
  if (isConsumedOrExpiredTicketError(err)) return CONSUMED_TICKET_MESSAGE
  if (isClerkAPIResponseError(err)) {
    const first = err.errors[0]
    return first?.longMessage || first?.message || RETRYABLE_TICKET_MESSAGE
  }
  return RETRYABLE_TICKET_MESSAGE
}

type DisplayInvite = { organizationSlug: string; role: TeamInviteRole }

const TeamInvitePage = () => {
  const { isLoaded, user: clerkUser } = useClerkUser()
  const clerk = useClerk()
  const searchParams = useSearchParams()
  // The Clerk-hosted accept URL in the invite email verifies the ticket and
  // redirects here with it. `__clerk_status` is deliberately ignored — it has
  // been observed as `sign_in` for emails with no account, so the strategy
  // choice is made by attempting sign-up and falling back on the specific
  // "identifier exists" error instead.
  const ticket = searchParams?.get('__clerk_ticket') ?? null

  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // A 404 from accept (invite already used/cleared between page load and
  // click) falls back to the same neutral state as no invite at all.
  const [inviteGone, setInviteGone] = useState(false)
  const [fallbackInvite, setFallbackInvite] = useState<DisplayInvite | null>(
    null,
  )
  const [fallbackChecked, setFallbackChecked] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  // Synchronous re-entrancy guard: `setSubmitting(true)` only disables the
  // button after a re-render, so a rapid double-click could otherwise fire
  // two parallel ticket exchanges or accept POSTs.
  const inFlightRef = useRef(false)

  const parsedMetadata = TeamInviteMetadataSchema.safeParse(
    clerkUser?.publicMetadata,
  )
  const metadataInvite = parsedMetadata.success ? parsedMetadata.data : null
  const hasMetadataInvite = parsedMetadata.success

  const isSignedOut = isLoaded && !clerkUser

  // A signed-out visitor with no ticket has nothing to redeem here — keep the
  // pre-ENG-11027 behavior the middleware used to enforce before this route
  // became public.
  useEffect(() => {
    if (isSignedOut && !ticket) {
      window.location.replace(
        `/login?redirect_url=${encodeURIComponent('/team-invite')}`,
      )
    }
  }, [isSignedOut, ticket])

  // An invitee who signed up organically never received Clerk's metadata
  // copy — ask gp-api, which falls back to the pending invitation addressed
  // to their verified email (ENG-11027).
  useEffect(() => {
    if (!isLoaded || !clerkUser || hasMetadataInvite || fallbackChecked) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await clientRequest(
          'GET /v1/organizations/team/invites/mine',
          {},
          { ignoreResponseError: true },
        )
        if (cancelled) return
        setFallbackInvite(res.ok ? res.data.invite : null)
      } catch (err) {
        console.error('team invite lookup error', err)
        if (cancelled) return
        setFallbackInvite(null)
      }
      setFallbackChecked(true)
    })()
    return () => {
      cancelled = true
    }
  }, [isLoaded, clerkUser, hasMetadataInvite, fallbackChecked])

  const postAccept = async () => {
    const res = await clientRequest(
      'POST /v1/organizations/team/invites/accept',
      {},
      { ignoreResponseError: true },
    )
    if (res.ok) {
      setCookie(ORG_SLUG_COOKIE, res.data.organizationSlug)
      // Hard nav, not a client-side push: the dashboard's org list is
      // seeded server-side by PageWrapper, and the membership this call
      // just created isn't visible to that fetch until it re-runs — same
      // constraint /post-auth-redirect documents for its own navigation.
      // A volunteer lands on the reductive /volunteer shell (ENG-11052)
      // rather than the campaign dashboard; /volunteer's own layout is the
      // single source of truth for the win-team-accounts flag check, so
      // this doesn't need to re-check it — a flag-off session bounces
      // straight back to /dashboard from there.
      window.location.href =
        res.data.role === 'volunteer' ? '/volunteer' : '/dashboard'
      return
    }
    if (res.status === 404) {
      setInviteGone(true)
      setSubmitting(false)
      return
    }
    setErrorMessage(ACCEPT_ERROR_MESSAGE)
    setSubmitting(false)
  }

  const handleAccept = async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setErrorMessage(null)
    setSubmitting(true)
    try {
      await postAccept()
    } catch (err) {
      // A network failure (offline, gp-api unreachable) throws instead of
      // resolving — without this, the button would be stuck disabled
      // forever with no way to retry.
      console.error('team invite accept error', err)
      setErrorMessage(ACCEPT_ERROR_MESSAGE)
      setSubmitting(false)
    } finally {
      inFlightRef.current = false
    }
  }

  const handleTicketAccept = async () => {
    if (!ticket || inFlightRef.current) return
    inFlightRef.current = true
    setErrorMessage(null)
    setSubmitting(true)
    try {
      // The form only renders signed-out, but a session can still appear
      // mid-flight (another tab signing in) — clear it so the ticket's own
      // account is the one activated. The no-op callback stops Clerk's
      // default post-sign-out navigation from unloading the page
      // mid-redemption.
      if (clerk.user) {
        try {
          await clerk.signOut(() => undefined)
        } catch (signOutErr) {
          console.warn(
            '[team-invite] sign-out before redemption failed; continuing',
            signOutErr,
          )
        }
      }

      let createdSessionId: string | null = null
      try {
        const signUpResult = await clerk.client.signUp.create({
          strategy: 'ticket',
          ticket,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          password,
        })
        if (
          signUpResult.status === 'complete' &&
          signUpResult.createdSessionId
        ) {
          createdSessionId = signUpResult.createdSessionId
        } else {
          console.error(
            '[team-invite] ticket sign-up did not complete',
            signUpResult.status,
          )
        }
      } catch (signUpErr) {
        if (!isIdentifierExistsError(signUpErr)) {
          throw signUpErr
        }
        const signInResult = await clerk.client.signIn.create({
          strategy: 'ticket',
          ticket,
        })
        if (
          signInResult.status === 'complete' &&
          signInResult.createdSessionId
        ) {
          createdSessionId = signInResult.createdSessionId
        } else {
          console.error(
            '[team-invite] ticket sign-in did not complete',
            signInResult.status,
          )
        }
      }

      if (!createdSessionId) {
        setErrorMessage(RETRYABLE_TICKET_MESSAGE)
        setSubmitting(false)
        return
      }

      await clerk.setActive({ session: createdSessionId })
      // The account now carries the invitation's copied publicMetadata —
      // accept server-side without another click.
      await postAccept()
    } catch (err) {
      console.error('team invite ticket redemption error', err)
      setErrorMessage(ticketErrorMessage(err))
      setSubmitting(false)
    } finally {
      inFlightRef.current = false
    }
  }

  if (!isLoaded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoaderCircleIcon className="animate-spin" />
      </div>
    )
  }

  const invite: DisplayInvite | null = metadataInvite ?? fallbackInvite
  const showInviteCard = !!invite && !inviteGone
  // Redeemable ticket: signed out only. A signed-in session with no invite
  // of its own that lands on someone else's invite link gets the neutral
  // state instead — redeeming would silently sign the current account out
  // and replace it with the ticket's (delegate finding, PR #1692).
  const showTicketForm =
    !showInviteCard && !inviteGone && !!ticket && isSignedOut
  // Redirecting to /login, or waiting on the pending-invite lookup.
  const showLoader =
    !showInviteCard &&
    !showTicketForm &&
    !inviteGone &&
    (isSignedOut || !fallbackChecked)

  if (showLoader) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoaderCircleIcon className="animate-spin" />
      </div>
    )
  }

  const ticketFormValid =
    firstName.trim() !== '' && lastName.trim() !== '' && password !== ''

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="flex items-center border-b border-base-border px-6 py-4">
        <GoodPartyOrgLogoWordmark size="small" textVariant="dark" />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md text-center">
          {showInviteCard ? (
            <>
              <h1
                className="text-3xl leading-tight font-semibold tracking-tight text-foreground md:text-4xl"
                style={{ fontFamily: 'var(--font-geist)' }}
              >
                You’ve been invited to{' '}
                {formatCampaignName(invite.organizationSlug)}
              </h1>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Accept to join as {ROLE_LABELS[invite.role]}.
              </p>
              {errorMessage && (
                <p className="mt-4 text-sm text-destructive" role="alert">
                  {errorMessage}
                </p>
              )}
              <Button
                size="large"
                className="mt-8 px-8"
                onClick={handleAccept}
                disabled={submitting}
                loading={submitting}
                loadingText="Joining…"
              >
                Accept invitation
              </Button>
            </>
          ) : showTicketForm ? (
            <>
              <h1
                className="text-3xl leading-tight font-semibold tracking-tight text-foreground md:text-4xl"
                style={{ fontFamily: 'var(--font-geist)' }}
              >
                You’ve been invited to join a campaign team
              </h1>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Create your account to accept the invitation.
              </p>
              <div className="mt-8 space-y-4 text-left">
                <div className="space-y-2">
                  <Label htmlFor="team-invite-first-name">First name</Label>
                  <Input
                    id="team-invite-first-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="team-invite-last-name">Last name</Label>
                  <Input
                    id="team-invite-last-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="team-invite-password">Password</Label>
                  <Input
                    id="team-invite-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              {errorMessage && (
                <p className="mt-4 text-sm text-destructive" role="alert">
                  {errorMessage}
                </p>
              )}
              <Button
                size="large"
                className="mt-8 w-full px-8"
                onClick={handleTicketAccept}
                disabled={submitting || !ticketFormValid}
                loading={submitting}
                loadingText="Joining…"
              >
                Accept invitation
              </Button>
              <p className="mt-4 text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link
                  href={`/login?redirect_url=${encodeURIComponent(
                    '/team-invite',
                  )}`}
                  className="underline"
                >
                  Sign in
                </Link>
              </p>
            </>
          ) : (
            <>
              <h1
                className="text-3xl leading-tight font-semibold tracking-tight text-foreground"
                style={{ fontFamily: 'var(--font-geist)' }}
              >
                No pending invitation
              </h1>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                We couldn’t find an invitation waiting for you. If you were
                expecting one, ask whoever invited you to send a new link.
              </p>
              <Button size="large" className="mt-8 px-8" asChild>
                <Link href="/dashboard">Go to dashboard</Link>
              </Button>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

export default TeamInvitePage
