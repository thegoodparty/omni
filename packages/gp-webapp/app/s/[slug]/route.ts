import { serverRequest } from 'gpApi/server-request'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Short-link resolver for texted magic links.
 *
 * The ticketed redemption URL runs to ~743 characters (Clerk sign-in tokens are
 * RS256 JWTs, so the signature alone is 342 chars), which is five SMS segments
 * and a query string that reads as phishing to carrier link filters. gp-api
 * therefore mints a 12-character slug per link and texts `/s/<slug>`; this
 * handler exchanges it for the real URL and forwards.
 *
 * It only forwards — it never redeems. The button gate on /serve/welcome and
 * /win/welcome is what stops link scanners burning the one-time ticket, so this
 * must stay a plain redirect.
 */

// Never cache: the response embeds a single-use sign-in ticket, so a cached
// redirect would hand one lead's credential to the next visitor. GET handlers
// are dynamic by default, but the cost of that changing under us is a session
// hijack, so pin it.
export const dynamic = 'force-dynamic'

const EXPIRED_PATH = '/login?magicLinkExpired=1'

/**
 * The redemption URL comes from our own database, but it is still user-facing
 * input to a redirect, so constrain it to our own hosts. gp-api's APP_ROOT
 * legitimately differs from this origin (dev/qa links point at
 * dev.goodparty.org so env-scoped Clerk tickets resolve against the right
 * instance), so this is a host allowlist rather than a same-origin check.
 */
function isAllowedRedirectTarget(rawUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  const { hostname } = parsed
  return (
    hostname === 'localhost' ||
    hostname === 'goodparty.org' ||
    hostname.endsWith('.goodparty.org')
  )
}

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> => {
  const { slug } = await params

  let url: string | null = null
  try {
    const { data } = await serverRequest('GET /v1/magic-link/resolve/:slug', {
      slug,
    })
    url = data?.url ?? null
  } catch {
    // gp-api returns a non-2xx for a malformed slug and ofetch throws on it.
    // An unusable slug and an unreachable gp-api land the lead in the same
    // place, so there is nothing to distinguish here.
    url = null
  }

  if (!url || !isAllowedRedirectTarget(url)) {
    return NextResponse.redirect(new URL(EXPIRED_PATH, request.url))
  }

  return NextResponse.redirect(url, 307)
}
