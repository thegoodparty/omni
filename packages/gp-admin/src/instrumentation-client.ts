'use client'
import * as Sentry from '@sentry/nextjs'

// Ships dark until NEXT_PUBLIC_SENTRY_DSN is set on the Vercel project.
// Errors only — no tracing, replay, or profiling: the point is that admin
// failures stop being invisible, not performance telemetry.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
