// TEMPORARY diagnostic — remove before finalizing the PR. Nested under /login so
// the public route matcher (/login(.*)) lets us read it without auth. Returns
// only non-secret environment markers so we can see which signal reliably
// identifies prod vs preview in gp-webapp's Vercel runtime.
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return Response.json({
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    VERCEL_TARGET_ENV: process.env.VERCEL_TARGET_ENV ?? null,
    NEXT_PUBLIC_VERCEL_TARGET_ENV:
      process.env.NEXT_PUBLIC_VERCEL_TARGET_ENV ?? null,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV ?? null,
    OTEL_SERVICE_ENVIRONMENT: process.env.OTEL_SERVICE_ENVIRONMENT ?? null,
    NODE_ENV: process.env.NODE_ENV ?? null,
  })
}
