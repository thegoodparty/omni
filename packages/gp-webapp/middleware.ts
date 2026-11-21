import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse, NextRequest } from 'next/server'
import { handleApiRequestRewrite } from 'helpers/handleApiRequestRewrite'
import {
  ANONYMOUS_ID_COOKIE,
  SEGMENT_ANONYMOUS_ID_COOKIE,
  resolveAnonymousId,
} from 'helpers/anonymousId'
import { API_VERSION_PREFIX } from 'appEnv'
import {
  PUBLIC_PATH_PREFIXES,
  publicPathMatcher,
} from '@shared/auth/publicPaths'

const ANONYMOUS_ID_MAX_AGE = 60 * 60 * 24 * 365

// Seeded once, on the visitor's first request, rather than refreshed on every
// response: a `Set-Cookie` on every document response would make Vercel treat
// otherwise-cacheable pages as uncacheable. Applied to the login redirect too,
// so a visitor bounced to sign in still keeps one identity across the round
// trip. Not `httpOnly` — the client reads it to seed Segment.
//
// See `resolveAnonymousId` for why a returning visitor's existing Segment id
// is adopted here rather than replaced.
const seedAnonymousId = (req: NextRequest, res: NextResponse): NextResponse => {
  if (!req.cookies.has(ANONYMOUS_ID_COOKIE)) {
    const segmentAnonymousId = req.cookies.get(
      SEGMENT_ANONYMOUS_ID_COOKIE,
    )?.value

    res.cookies.set(
      ANONYMOUS_ID_COOKIE,
      resolveAnonymousId(segmentAnonymousId),
      {
        maxAge: ANONYMOUS_ID_MAX_AGE,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
      },
    )
  }
  return res
}

// Which routes a visitor with no session may see. The same list tells the client
// not to navigate away from a 401 raised on one of them — see
// `@shared/auth/publicPaths`.
const isPublicRoute = createRouteMatcher([
  '/',
  ...PUBLIC_PATH_PREFIXES.map(publicPathMatcher),
])

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const { pathname, search } = req.nextUrl
  // This is a workaround to pass the pathname to SSR pages. `x-search` carries
  // the query string separately so server components (e.g. serveAccess) can
  // reconstruct the full requested URL without changing the `x-pathname`
  // semantics other consumers rely on.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-pathname', pathname)
  requestHeaders.set('x-search', search)

  // Handle API request rewrites
  const apiRewriteRequest = pathname.startsWith(`/api${API_VERSION_PREFIX}`)
  if (apiRewriteRequest) {
    try {
      const { getToken } = await auth()
      const token = await getToken()
      return await handleApiRequestRewrite(req, token)
    } catch (error) {
      console.error('Error in handleApiRequestRewrite', error)
      throw error
    }
  }

  if (!isPublicRoute(req)) {
    const { userId } = await auth()
    if (!userId) {
      // Redirect unauthenticated users to the sign-in page explicitly instead
      // of relying on `auth.protect()`. When Clerk can't resolve the sign-in
      // URL on the server it responds with a 404 rather than redirecting (see
      // clerk/javascript#8302), which breaks deep links like
      // `/dashboard/briefings` shared in marketing emails. Preserving the
      // original path in `redirect_url` lets `<SignIn>` route the user back to
      // the requested page after they log in.
      const signInUrl = new URL('/login', req.url)
      signInUrl.searchParams.set(
        'redirect_url',
        `${req.nextUrl.pathname}${req.nextUrl.search}`,
      )
      return seedAnonymousId(req, NextResponse.redirect(signInUrl))
    }
  }

  return seedAnonymousId(
    req,
    NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    }),
  )
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params.
    // `mx/` (the first-party Segment proxy, see next.config.ts) and `fx` (the
    // Grafana Faro relay, app/fx/route.ts) are telemetry sinks that must not
    // reach Clerk. Neither is in `isPublicRoute`, so without this they 307
    // logged-out visitors to /login and silently drop exactly the events and
    // errors they exist to carry.
    '/((?!_next|mx/|fx$|[^?]*\\.(?:html?|css|js(?:on)?|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
