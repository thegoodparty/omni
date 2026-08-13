import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { SignIn } from '@clerk/nextjs'
import { getPostAuthRedirectPath } from 'app/dashboard/shared/candidateAccess'
import { isSafeInternalPath } from 'helpers/isSafeInternalPath'
import pageMetaData from 'helpers/metadataHelper'

const meta = pageMetaData({
  title: 'Login',
  description: 'Login to GoodParty.org.',
  slug: '/login',
})
export const metadata = meta

// Mirrors CONSUMED_TICKET_MESSAGE on the /serve/welcome and /win/welcome pages.
// The /s/<slug> short-link handler sends leads here with `magicLinkExpired=1`
// when their texted link is already used, expired, or unknown — without it they
// would land on a bare sign-in form with no idea why.
const MAGIC_LINK_EXPIRED_MESSAGE =
  'This sign-in link has already been used or has expired. Request a new link, or sign in below.'

export default async function LoginPage({
  searchParams,
}: PageProps<any>): Promise<React.JSX.Element> {
  const [{ userId }, { redirect_url: redirectUrlParam, magicLinkExpired }] =
    await Promise.all([auth(), searchParams])

  // When the middleware bounces an unauthenticated deep link (e.g.
  // /dashboard/briefings from a marketing email) through here, it preserves
  // the original path in `redirect_url`. Only same-origin relative paths are
  // honored so the param can't be abused as an open redirect.
  const redirectUrl = isSafeInternalPath(redirectUrlParam)
    ? redirectUrlParam
    : null

  if (userId) {
    // Already signed in: honor an explicit deep link if present, routing it
    // through /post-auth-redirect (same as the unauthenticated path) so the
    // org slug cookie is established before landing on org-scoped pages.
    // Otherwise fall back to the role-aware post-auth resolver.
    redirect(
      redirectUrl
        ? `/post-auth-redirect?next=${encodeURIComponent(redirectUrl)}`
        : await getPostAuthRedirectPath(),
    )
  }

  // We can't send the user straight to the deep link after sign-in:
  // `/post-auth-redirect` is what resolves the user's org and sets the
  // ORG_SLUG_COOKIE that server requests need, so skipping it leaves pages like
  // briefings without org context (blank render / server-side bounce to
  // /dashboard). Route through `/post-auth-redirect` and forward the requested
  // path as `next` so it can land the user there once setup is done. Set both
  // sign-in and sign-up redirect props since the embedded "create account" flow
  // on this page uses the sign-up props; the sign-up variant also carries the
  // `source=signup` hint so registration tracking still fires.
  const nextQuery = redirectUrl
    ? `next=${encodeURIComponent(redirectUrl)}`
    : null
  const redirectProps = nextQuery
    ? {
        forceRedirectUrl: `/post-auth-redirect?${nextQuery}`,
        signUpForceRedirectUrl: `/post-auth-redirect?${nextQuery}&source=signup`,
      }
    : { fallbackRedirectUrl: '/post-auth-redirect' }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] gap-6 py-8">
      {magicLinkExpired ? (
        <p className="max-w-md rounded-lg border border-base-border px-4 py-3 text-center text-sm leading-relaxed text-muted-foreground">
          {MAGIC_LINK_EXPIRED_MESSAGE}
        </p>
      ) : null}
      <SignIn {...redirectProps} routing="hash" />
    </div>
  )
}
