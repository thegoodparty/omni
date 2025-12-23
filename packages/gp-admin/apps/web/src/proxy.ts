import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isPublicRoute = createRouteMatcher(['/auth(.*)'])

export default clerkMiddleware(async (auth, req) => {
  // Check if we're NOT in production:
  // - On Vercel: use VERCEL_ENV (preview deployments have NODE_ENV=production but VERCEL_ENV=preview)
  // - Locally: use NODE_ENV
  const isNotProductionEnv = process.env.VERCEL_ENV
    ? process.env.VERCEL_ENV !== 'production'
    : process.env.NODE_ENV !== 'production'

  const isE2ETesting =
    isNotProductionEnv &&
    process.env.NEXT_PUBLIC_E2E_TESTING === 'true' &&
    req.cookies.get('__e2e_bypass')?.value === 'true'

  if (isE2ETesting) {
    return NextResponse.next()
  }

  if (!isPublicRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
