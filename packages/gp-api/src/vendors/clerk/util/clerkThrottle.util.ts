import { throttleRequestsWithRetry } from './throttleRequestsWithRetry.util'

// https://clerk.com/docs/guides/how-clerk-works/system-limits#backend-api-requests
const CLERK_DEV_RATE_LIMIT = 100
const CLERK_RATE_WINDOW_MS = 10_000

export const clerkThrottle = throttleRequestsWithRetry({
  rateLimit: CLERK_DEV_RATE_LIMIT,
  windowMs: CLERK_RATE_WINDOW_MS,
  // Each gp-api task holds its own limiter, and dev runs at least two tasks
  // against one shared dev instance (deploy/components/service.ts). Split the
  // budget between those two, so together they take half of it. Autoscaling
  // can run up to 6, but Clerk demand follows requests, not tasks, and
  // job-driven scale-out adds none; the client's retries absorb a 429.
  workerCount: 2,
  safetyFactor: 0.5,
  maxRetries: 3,
  label: 'clerk-api',
})
