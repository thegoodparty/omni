import { NextResponse, NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { timingSafeEqual } from 'node:crypto'

// Cache revalidation is a state-changing, machine-triggered operation. It is
// gated by a shared secret (REVALIDATE_SECRET), NOT a user session, and accepts
// POST only — so a logged-in user or a cross-site request can't force
// invalidation of arbitrary cached pages (CWE-862 / CSRF). The route is public
// in middleware.ts precisely so this secret check is the gate.
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.REVALIDATE_SECRET
  // Fail closed: with no secret configured, the endpoint is unusable rather
  // than open to anyone.
  if (!secret) return false

  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : ''
  if (!provided) return false

  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  // timingSafeEqual throws on length mismatch, so guard length first; the
  // length check leaks only the length, not the contents.
  return a.length === b.length && timingSafeEqual(a, b)
}

export const POST = async (request: NextRequest): Promise<NextResponse> => {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const path = request.nextUrl.searchParams.get('path') || '/'
  // Only same-origin absolute paths — reject full URLs and protocol-relative
  // (`//host`) values.
  if (!path.startsWith('/') || path.startsWith('//')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  revalidatePath(path, 'page')
  return NextResponse.json({ revalidated: true, now: Date.now() })
}
