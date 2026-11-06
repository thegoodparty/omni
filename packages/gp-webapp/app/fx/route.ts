import { NextRequest } from 'next/server'

// First-party relay for Grafana Frontend Observability (Faro). Ad blockers
// and privacy browsers block `faro-collector-*.grafana.net` by hostname, which
// drops the errors of exactly the users most likely to hit odd failures. Same
// trick, and the same opaque path naming, as the Segment proxy at /mx (see
// next.config.ts).
//
// The collector authenticates by the app key in its URL, which is not a
// secret, so nothing here holds a credential. Only the headers the Faro
// transport sets are forwarded: the browser's cookies, Clerk session
// included, must never leave for a third party.
const FORWARDED_REQUEST_HEADERS = [
  'content-type',
  'content-encoding',
  'user-agent',
  'x-faro-session-id',
  'idempotency-key',
]

// What the Faro transport reads back: a 429/503 backoff hint, and the signal
// that the collector no longer recognises the session.
const RETURNED_RESPONSE_HEADERS = [
  'content-type',
  'retry-after',
  'x-faro-session-status',
]

export const POST = async (request: NextRequest): Promise<Response> => {
  const collectorUrl = process.env.NEXT_PUBLIC_FARO_COLLECTOR_URL
  if (!collectorUrl) {
    return new Response('Not found', { status: 404 })
  }

  const headers = new Headers()
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  // The collector geolocates a session from the address the beacon arrives
  // on; without this every session would be placed at Vercel's egress.
  const clientIp =
    request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip')
  if (clientIp) headers.set('x-forwarded-for', clientIp)

  const upstream = await fetch(collectorUrl, {
    method: 'POST',
    headers,
    body: await request.arrayBuffer(),
  })

  const responseHeaders = new Headers()
  for (const name of RETURNED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}
