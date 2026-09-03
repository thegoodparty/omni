'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useUser as useClerkUser } from '@clerk/nextjs'
import { TeamInviteMetadataSchema } from '@goodparty_org/contracts'
import type { TeamInviteRole } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { setCookie } from 'helpers/cookieHelper'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'
import { Button, GoodPartyOrgLogoWordmark, LoaderCircleIcon } from '@styleguide'

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

type AcceptState = 'idle' | 'submitting' | 'error'

const TeamInvitePage = () => {
  const { isLoaded, user: clerkUser } = useClerkUser()
  const [acceptState, setAcceptState] = useState<AcceptState>('idle')
  // A 404 from accept (invite already used/cleared between page load and
  // click) falls back to the same neutral state as no metadata at all, so
  // it's tracked separately from the parsed invite below.
  const [inviteGone, setInviteGone] = useState(false)

  if (!isLoaded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoaderCircleIcon className="animate-spin" />
      </div>
    )
  }

  const parsedMetadata = TeamInviteMetadataSchema.safeParse(
    clerkUser?.publicMetadata,
  )
  const invite = parsedMetadata.success ? parsedMetadata.data : null
  const showNeutralState = !invite || inviteGone

  const handleAccept = async () => {
    setAcceptState('submitting')
    try {
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
        window.location.href = '/dashboard'
        return
      }
      if (res.status === 404) {
        setInviteGone(true)
        return
      }
      setAcceptState('error')
    } catch (err) {
      // A network failure (offline, gp-api unreachable) throws instead of
      // resolving — without this, the button would be stuck disabled in
      // 'submitting' forever with no way to retry.
      console.error('team invite accept error', err)
      setAcceptState('error')
    }
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="flex items-center border-b border-base-border px-6 py-4">
        <GoodPartyOrgLogoWordmark size="small" textVariant="dark" />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md text-center">
          {showNeutralState ? (
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
          ) : (
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
              {acceptState === 'error' && (
                <p className="mt-4 text-sm text-destructive" role="alert">
                  Something went wrong accepting this invitation. Please try
                  again.
                </p>
              )}
              <Button
                size="large"
                className="mt-8 px-8"
                onClick={handleAccept}
                disabled={acceptState === 'submitting'}
                loading={acceptState === 'submitting'}
                loadingText="Joining…"
              >
                Accept invitation
              </Button>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

export default TeamInvitePage
