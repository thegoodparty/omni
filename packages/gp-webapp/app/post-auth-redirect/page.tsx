'use client'

import { useEffect, useRef } from 'react'
import { useUser as useClerkUser } from '@clerk/nextjs'
import { clientRequest } from 'gpApi/typed-request'
import type { ElectedOffice, Organization } from 'gpApi/api-endpoints'
import {
  resolvePostAuthRedirectPath,
  CampaignStatus,
} from 'helpers/resolvePostAuthRedirectPath.util'
import { setCookie } from 'helpers/cookieHelper'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'
import { resolveSlug } from '@shared/hooks/useSelectedOrgSlug'
import { trackRegistrationCompleted } from 'helpers/analyticsHelper'
import { getReadyAnalytics } from '@shared/utils/analytics'
import { isSafeInternalPath } from 'helpers/isSafeInternalPath'
import { isServeRoutePath } from 'app/dashboard/shared/serveRoutes'
import { LoaderCircle } from 'lucide-react'

const PostAuthRedirectPage = () => {
  const { isSignedIn, isLoaded, user: clerkUser } = useClerkUser()
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    if (!isLoaded) return
    if (!isSignedIn) {
      window.location.replace('/login')
      return
    }

    ranRef.current = true
    ;(async () => {
      try {
        // An explicit deep-link destination forwarded by the login flow when
        // the middleware bounced an unauthenticated deep link (e.g.
        // /dashboard/briefings from a marketing email). Only same-origin
        // relative paths are honored so this can't be an open redirect.
        const nextParam = new URLSearchParams(window.location.search).get(
          'next',
        )
        const safeNext = isSafeInternalPath(nextParam) ? nextParam : null

        // First authenticated call after a fresh sign-up may race the gp-api
        // JIT-provisioning of the local user record. Retry once on failure
        // before falling back to an empty list.
        let organizations: Organization[] = []
        const orgsRes = await clientRequest(
          'GET /v1/organizations',
          {},
          { ignoreResponseError: true },
        )
        if (orgsRes.ok) {
          organizations = orgsRes.data.organizations
        } else {
          await new Promise((resolve) => setTimeout(resolve, 500))
          const retry = await clientRequest(
            'GET /v1/organizations',
            {},
            { ignoreResponseError: true },
          )
          if (retry.ok) organizations = retry.data.organizations
        }

        // The "serve" experience (briefings, polls) is scoped to the org that
        // owns the user's elected office (the gp-api elected-office + meetings
        // endpoints resolve by the X-Organization-Slug header). When the deep
        // link points there, select that org explicitly — otherwise
        // `resolveSlug` falls back to the first org and those pages can't find
        // the elected office, bouncing the user to /dashboard.
        const electedOrg = organizations.find((o) => o.electedOfficeId)
        // Only switch to the elected-office org for actual serve routes. The
        // public /serve/welcome redemption page is deliberately excluded by
        // isServeRoutePath so landing there can't overwrite the org-slug cookie
        // for a user who also owns a campaign org.
        const wantsServe = !!safeNext && isServeRoutePath(safeNext)
        const slug =
          wantsServe && electedOrg
            ? electedOrg.slug
            : resolveSlug(organizations)
        if (slug) {
          setCookie(ORG_SLUG_COOKIE, slug)
        }

        const [userRes, statusRes, electedRes, electedMineRes] =
          await Promise.all([
            clientRequest(
              'GET /v1/users/me',
              {},
              { ignoreResponseError: true },
            ),
            clientRequest(
              'GET /v1/campaigns/mine/status',
              {},
              { ignoreResponseError: true },
            ),
            clientRequest(
              'GET /v1/elected-office/current',
              {},
              { ignoreResponseError: true },
            ),
            // `current` resolves only the active-slug org's office, so it 404s
            // when a campaign org sorts first. `mine` lists every office the
            // user holds so we don't misclassify a provisioned EO as net-new.
            clientRequest(
              'GET /v1/elected-office/mine',
              {},
              { ignoreResponseError: true },
            ),
          ])

        const user = userRes.ok ? (userRes.data as { roles?: string[] }) : null
        const campaignStatus = statusRes.ok
          ? (statusRes.data as CampaignStatus)
          : null

        const currentEO = electedRes.ok
          ? (electedRes.data as ElectedOffice)
          : null
        const myElectedOffices = electedMineRes.ok
          ? (electedMineRes.data as ElectedOffice[])
          : []
        // Serve onboarding is for genuine serve LEADS only — a sales/magic-link/
        // BallotReady official who was never a GoodParty.org candidate. An office
        // created by winning a campaign (the "I won" flow) carries a `campaignId`
        // and has ALREADY onboarded as a candidate, so it must never be dragged
        // into serve onboarding merely for a missing onboardingCompletedAt/term
        // date — that's the just-won routing bug. Such a win-origin office is
        // routed to the dashboard, where the lightweight term-dates modal
        // collects any missing dates. Term-date-less, campaign-less, not-yet-
        // completed offices are the only ones that still need serve onboarding.
        const needsServeOnboarding = (eo: ElectedOffice): boolean =>
          !eo.onboardingCompletedAt && eo.campaignId == null
        // Route to serve onboarding whenever ANY office the user holds still needs
        // it (scan all orgs, not just the slug-resolved one). An office that needs
        // onboarding wins over a completed `current` so a not-yet-onboarded serve
        // lead behind a campaign org isn't stranded on /dashboard.
        const incompleteEO = myElectedOffices.find(needsServeOnboarding)
        const relevantEO =
          incompleteEO ?? currentEO ?? myElectedOffices[0] ?? null
        const hasElectedOffice = !!relevantEO || !!electedOrg
        // Default to "complete" when we can't resolve a concrete EO record
        // (e.g. `/mine` returns empty and `/current` 404s behind a campaign
        // org) — matching resolvePostAuthRedirectPath's own default so a legacy
        // win→serve user lands on /dashboard instead of being looped back into
        // /serve/onboarding on every login.
        const electedOfficeOnboardingComplete = relevantEO
          ? !needsServeOnboarding(relevantEO)
          : true

        // Fire the registration event only on a true fresh sign-up. The
        // ?source=signup hint set by <SignUp /> is just a re-fire guard for
        // back-to-back logout/login; the authoritative gate is the gp-api
        // user record's createdAt, which is server-set at JIT-provisioning
        // and cannot be forged by crafting a URL.
        const REGISTRATION_FRESHNESS_MS = 5 * 60 * 1000
        const sourceIsSignup =
          new URLSearchParams(window.location.search).get('source') === 'signup'
        if (userRes.ok && sourceIsSignup) {
          try {
            const userData = userRes.data as {
              id: number
              email?: string
              createdAt: string | Date
            }
            const createdAtMs = new Date(userData.createdAt).getTime()
            const isFreshlyCreated =
              Number.isFinite(createdAtMs) &&
              Date.now() - createdAtMs < REGISTRATION_FRESHNESS_MS
            if (isFreshlyCreated) {
              await trackRegistrationCompleted({
                analytics: getReadyAnalytics(),
                userId: String(userData.id),
                email:
                  userData.email ||
                  clerkUser?.primaryEmailAddress?.emailAddress ||
                  '',
              })
            }
          } catch (e) {
            console.error('registration tracking error', e)
          }
        }

        const resolvedPath = resolvePostAuthRedirectPath(
          user,
          campaignStatus,
          hasElectedOffice,
          electedOfficeOnboardingComplete,
        )
        // Honor the explicit deep-link destination now that the org slug cookie
        // is set and the session is established. Re-derive a same-origin
        // relative path before navigating: `safeNext` is already validated, but
        // rebuilding from `URL().pathname` strips any host an attacker could
        // smuggle in, keeping the redirect provably same-origin.
        const destination = new URL(
          safeNext ?? resolvedPath,
          window.location.origin,
        )
        // Hard nav so the destination renders with fresh auth'd server
        // state (PageWrapper re-runs with isAuthed=true and real orgs).
        window.location.replace(
          `${destination.pathname}${destination.search}${destination.hash}`,
        )
      } catch (e) {
        console.error('post-auth-redirect error', e)
        // Don't strand new users on a blank /dashboard if the resolver
        // throws — onboarding is the safe default for unknown state.
        window.location.replace('/onboarding/office-selection')
      }
    })()
  }, [isSignedIn, isLoaded])

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <LoaderCircle className="animate-spin" />
    </div>
  )
}

export default PostAuthRedirectPage
