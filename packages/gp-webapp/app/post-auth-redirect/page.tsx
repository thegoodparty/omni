'use client'

import { useEffect, useRef } from 'react'
import { useUser as useClerkUser } from '@clerk/nextjs'
import { TeamInviteMetadataSchema } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import type { ElectedOffice, Organization } from 'gpApi/api-endpoints'
import {
  resolvePostAuthRedirectPath,
  CampaignStatus,
  WIN_ONBOARDING_PATH,
} from 'helpers/resolvePostAuthRedirectPath.util'
import { getCookie, setCookie } from 'helpers/cookieHelper'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'
import { resolveSlug } from '@shared/hooks/useSelectedOrgSlug'
import { trackRegistrationCompleted } from 'helpers/analyticsHelper'
import { getReadyAnalytics } from '@shared/utils/analytics'
import { isSafeInternalPath } from 'helpers/isSafeInternalPath'
import { isServeRoutePath } from 'app/dashboard/shared/serveRoutes'
import { useTeamAccountsFlag } from '@shared/experiments/teamAccountsFlag'
import { Spinner } from '@styleguide'

const PostAuthRedirectPage = () => {
  const { isSignedIn, isLoaded, user: clerkUser } = useClerkUser()
  const ranRef = useRef(false)
  // trackExposure=false: a render-decision read for routing, not the
  // experiment's own treatment surface (mirrors every other nav/routing read
  // of this flag — DashboardMenu, the org picker).
  const {
    enabled: teamAccountsEnabled,
    ready: flagReady,
    failed: teamAccountsFlagFailed,
  } = useTeamAccountsFlag(false)

  useEffect(() => {
    if (ranRef.current) return
    if (!isLoaded) return
    if (!isSignedIn) {
      window.location.replace('/login')
      return
    }
    // teamAccountsEnabled is a closed-over render value the async body below
    // reads once and never re-reads. If the SSR flag seed came back null
    // (gp-api hiccup in PageWrapper), FeatureFlagsProvider's async refresh()
    // races Clerk hydration — without this guard, a run that fires before
    // refresh() resolves would permanently close over `false` (ranRef is set
    // right below) and misroute a volunteer into onboarding for the whole
    // visit. `flagReady` is guaranteed to flip true once resolution SETTLES,
    // success or failure (FeatureFlagsProvider's refresh() sets it in a
    // `finally`, and the synchronous seeded/anonymous paths set it
    // immediately) — so this can only stall on an unsettled fetch, the same
    // class of risk every other awaited call below already carries unguarded.
    if (!flagReady) return

    ranRef.current = true
    // Declared outside the try so the catch below can still make a
    // volunteer-aware decision if something later throws — assigned as soon
    // as `organizations`/`slug` resolve, well before any of the riskier
    // Promise.all calls (ENG-11071: onboarding is destructive for a
    // confirmed volunteer, so this can't stay trapped inside the try block).
    let activeOrgIsVolunteer = false
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
        // JIT-provisioning of the local user record; a fresh LOGIN of an
        // EXISTING user (an established volunteer included) can race the same
        // way while Clerk's cookie/JWT is still propagating. An empty result
        // here is indistinguishable from a genuinely org-less new user, and
        // for a volunteer that ambiguity is what misroutes them into
        // candidate onboarding instead of /volunteer (ENG-11071) — so retry
        // with backoff a couple of times before giving up.
        let organizations: Organization[] = []
        const ORG_FETCH_RETRY_DELAYS_MS = [500, 1000]
        for (let attempt = 0; ; attempt++) {
          const res = await clientRequest(
            'GET /v1/organizations',
            {},
            { ignoreResponseError: true },
          )
          if (res.ok) {
            organizations = res.data.organizations
            break
          }
          const delay = ORG_FETCH_RETRY_DELAYS_MS[attempt]
          if (delay === undefined) break
          await new Promise((resolve) => setTimeout(resolve, delay))
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

        // Mirrors the server-side resolution in
        // app/shared/organizations/activeOrgVolunteer.server.ts: the active
        // org is the one `slug` just resolved to (cookie match, else the
        // first org) — re-matching it here rather than trusting `electedOrg`
        // or any other org found above, since none of those are guaranteed
        // to be the one the cookie now points at. This is the raw role fact,
        // independent of the win-team-accounts flag — the flag gate is
        // applied below, where `isActiveOrgVolunteer` feeds the resolver.
        const activeOrg =
          organizations.find((o) => o.slug === slug) ?? organizations[0]
        activeOrgIsVolunteer = activeOrg?.role === 'volunteer'

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
              // Submit the HubSpot registration form BEFORE any Segment
              // identify: whichever call creates the HubSpot contact first
              // locks its original source, and only a Forms API submission
              // carrying the hubspotutk grants web/paid attribution.
              const hutk = getCookie('hubspotutk')
              await clientRequest(
                'POST /v1/users/me/crm-registration',
                hutk ? { hutk } : {},
                { ignoreResponseError: true },
              )
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

        // Nothing client-side is trusted for the accept itself — gp-api
        // re-reads Clerk at accept time — but a successful schema parse is
        // enough to justify a routing detour, so a malformed/absent
        // publicMetadata value can never hijack sign-in routing.
        let hasPendingTeamInvite = TeamInviteMetadataSchema.safeParse(
          clerkUser?.publicMetadata,
        ).success
        // An invitee who signed up organically never received Clerk's
        // metadata copy (ENG-11027) — gp-api resolves their invite from the
        // pending invitation on their verified email instead. Probed only
        // for zero-org sessions: that's every pre-onboarding sign-in (the
        // cohort an unaccepted invite can apply to), and it keeps this
        // Clerk-backed lookup off the hot path of every established user's
        // login.
        if (!hasPendingTeamInvite && organizations.length === 0) {
          try {
            const inviteRes = await clientRequest(
              'GET /v1/organizations/team/invites/mine',
              {},
              { ignoreResponseError: true },
            )
            hasPendingTeamInvite = inviteRes.ok && !!inviteRes.data.invite
          } catch {
            // ignoreResponseError only suppresses HTTP errors — a transport
            // failure here still throws, and letting it reach the outer
            // catch would abandon the whole resolution flow instead of just
            // this best-effort probe.
          }
        }

        const isActiveOrgVolunteer = teamAccountsEnabled && activeOrgIsVolunteer

        const resolvedPath = resolvePostAuthRedirectPath(
          user,
          campaignStatus,
          hasElectedOffice,
          electedOfficeOnboardingComplete,
          hasPendingTeamInvite,
          isActiveOrgVolunteer,
        )
        // A FAILED flag fetch reads exactly like "off" to the resolver above
        // (isActiveOrgVolunteer is false either way), but unlike a genuinely
        // off flag — which is today's accepted status quo for a volunteer-role
        // org, see page.test.tsx's "byte-identical to today" case — a failed
        // fetch tells us nothing about whether the flag is really off. Sending
        // a confirmed volunteer into onboarding is destructive (it creates
        // them a campaign), so fall back to /dashboard instead: its
        // server-side candidateAccess() gate re-checks the flag and volunteer
        // role fresh and still bounces to /volunteer if that's who they are
        // (ENG-11071).
        const finalResolvedPath =
          teamAccountsFlagFailed &&
          activeOrgIsVolunteer &&
          resolvedPath === WIN_ONBOARDING_PATH
            ? '/dashboard'
            : resolvedPath
        // Honor the explicit deep-link destination now that the org slug cookie
        // is set and the session is established — unless a pending team invite
        // demands the acceptance screen: an unaccepted invite must win over any
        // `?next=` a marketing link appended, or the invitee silently lands in
        // a dashboard they aren't a member of yet. Re-derive a same-origin
        // relative path before navigating: `safeNext` is already validated, but
        // rebuilding from `URL().pathname` strips any host an attacker could
        // smuggle in, keeping the redirect provably same-origin.
        const destination = new URL(
          hasPendingTeamInvite
            ? finalResolvedPath
            : (safeNext ?? finalResolvedPath),
          window.location.origin,
        )
        // Hard nav so the destination renders with fresh auth'd server
        // state (PageWrapper re-runs with isAuthed=true and real orgs).
        window.location.replace(
          `${destination.pathname}${destination.search}${destination.hash}`,
        )
      } catch (e) {
        console.error('post-auth-redirect error', e)
        // Don't strand new users on a blank /dashboard if something throws —
        // onboarding is the safe default for unknown state. EXCEPT when
        // `activeOrgIsVolunteer` was already confirmed true before the
        // throw: onboarding there is actively destructive (it creates a
        // campaign for someone who was never meant to have one), while
        // /dashboard's server-side candidateAccess() gate re-checks the org
        // role fresh and still bounces a real volunteer to /volunteer
        // (ENG-11071).
        window.location.replace(
          activeOrgIsVolunteer ? '/dashboard' : WIN_ONBOARDING_PATH,
        )
      }
    })()
  }, [isSignedIn, isLoaded, flagReady])

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner />
    </div>
  )
}

export default PostAuthRedirectPage
