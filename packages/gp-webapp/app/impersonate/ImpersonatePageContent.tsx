'use client'

import { useEffect, useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import { useSearchParams } from 'next/navigation'
import { clearElectionResultDismissed } from 'app/dashboard/election-result/dismissal'
import { clientRequest } from 'gpApi/typed-request'
import { setCookie } from 'helpers/cookieHelper'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'
import { resolveOrgSlug } from '@shared/organizations/resolveOrgSlug'

const isSafeRelativePath = (s: string | null): s is string => {
  if (typeof s !== 'string') return false
  if (!s.startsWith('/')) return false
  // Block protocol-relative ("//host") and backslash ("/\host") open redirects.
  return !(s.startsWith('//') || s.startsWith('/\\'))
}

// returnTo is a gp-webapp path, so restrict it to the dashboard.
const isSafeReturnTo = (s: string | null): s is string =>
  isSafeRelativePath(s) && s.startsWith('/dashboard/')

// adminReturnTo is a gp-admin portal path (handed to GP_ADMIN_URL on stop), so
// it must NOT be held to gp-webapp's /dashboard/ allowlist — any safe relative
// path is valid there.
const isSafeAdminReturnTo = (s: string | null): s is string =>
  isSafeRelativePath(s)

/**
 * Point the org-slug cookie at an org the impersonated user actually has.
 *
 * The cookie is host-scoped and long-lived (120 days), so without this the
 * staff member's browser carries their own — or the previously impersonated
 * user's — slug into this session. Every server component reads that cookie for
 * the X-Organization-Slug header, so the first dashboard render answers for an
 * org this user can't see, while the client falls back to a different one: the
 * campaign-manager body under a Serve sidebar, with neither chat dock mounted.
 *
 * Best-effort by design. If the org list can't be read (Clerk's session cookie
 * is still propagating on the very first authenticated call), we leave the
 * cookie alone and let the redirect proceed exactly as it does today — the
 * provider's repair-and-refresh in `organization-picker` is the backstop. A
 * failure here must never block the hand-off into the session.
 */
async function selectOrganizationForSession(): Promise<void> {
  try {
    const res = await clientRequest(
      'GET /v1/organizations',
      {},
      { ignoreResponseError: true },
    )
    if (!res.ok) return
    const slug = resolveOrgSlug(res.data.organizations, null)
    if (slug) setCookie(ORG_SLUG_COOKIE, slug)
  } catch {
    // Non-fatal: see above.
  }
}

export default function ImpersonatePageContent() {
  const { client, setActive, signOut, loaded } = useClerk()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  const ticket = searchParams?.get('__clerk_ticket') ?? null
  const returnTo = searchParams?.get('returnTo') ?? null
  const adminReturnTo = searchParams?.get('adminReturnTo') ?? null

  useEffect(() => {
    if (!loaded) return

    if (!ticket) {
      setError('No ticket provided in URL')
      return
    }

    async function run() {
      try {
        await signOut()

        const result = await client.signIn.create({
          strategy: 'ticket',
          ticket: ticket!,
        })

        if (result.status !== 'complete') {
          throw new Error(
            `Impersonation sign-in not complete (status: ${result.status})`,
          )
        }

        if (!result.createdSessionId) {
          throw new Error(
            `Impersonation did not create a session (status: ${result.status})`,
          )
        }

        await setActive({ session: result.createdSessionId })
        clearElectionResultDismissed()
        // Before the redirect, so the first server render of the destination
        // already sees this user's org rather than the previous session's.
        await selectOrganizationForSession()
        if (isSafeAdminReturnTo(adminReturnTo)) {
          sessionStorage.setItem('gp_admin_return_to', adminReturnTo)
        }
        window.location.href = isSafeReturnTo(returnTo)
          ? returnTo
          : '/dashboard'
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[impersonate] Failed:', err)
        setError(msg)
      }
    }

    run()
  }, [loaded, ticket, returnTo, adminReturnTo])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-red-600 font-semibold">Impersonation failed</p>
        <p className="text-sm text-gray-600 max-w-md text-center break-all">
          {error}
        </p>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p>Setting up impersonation session…</p>
    </div>
  )
}
