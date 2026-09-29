import { NextRequest } from 'next/server'

// Segment's ingestion verbs (track/identify/page/group/alias) plus the batch
// and metrics endpoints. Allowlisted rather than passed straight through, so
// this route can't be used to relay arbitrary requests to api.segment.io from
// our origin.
const SEGMENT_ENDPOINTS = new Set(['t', 'i', 'p', 'g', 'a', 'b', 'm'])

// The CDN half of /mx is a plain next.config rewrite; this half is a route
// handler for one reason: the client's IP. Segment geo-enriches an event from
// the address the ingestion request arrives on, and a rewrite to an external
// host reaches Segment from the platform's egress addresses, so every event
// would land carrying a datacenter location. That trades broken
// city/region/country on 100% of events for recovered delivery on the few
// percent of users behind a privacy browser, which is a worse bug than the one
// this is fixing. Forwarding the address explicitly costs an invocation per
// event and makes the behavior ours rather than the platform's.
export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> => {
  const { path } = await params
  const endpoint = path.join('/')

  if (!SEGMENT_ENDPOINTS.has(endpoint)) {
    return new Response('Not found', { status: 404 })
  }

  const clientIp =
    request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip')
  const userAgent = request.headers.get('user-agent')

  const upstream = await fetch(`https://api.segment.io/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      // analytics-next deliberately sends text/plain to dodge a CORS
      // preflight; preserve whatever it chose rather than imposing JSON.
      'content-type': request.headers.get('content-type') ?? 'text/plain',
      ...(clientIp ? { 'x-forwarded-for': clientIp } : {}),
      ...(userAgent ? { 'user-agent': userAgent } : {}),
    },
    body: await request.text(),
  })

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type':
        upstream.headers.get('content-type') ?? 'application/json',
    },
  })
}
