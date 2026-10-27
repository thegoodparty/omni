import Bottleneck from 'bottleneck'
import { WORKERS_PER_SHARD } from '../../workers'

type ThrottleConfig = {
  rateLimit: number
  windowMs: number
  workerCount?: number
  safetyFactor?: number
  burst?: number
  maxRetries?: number
  label?: string
}

type RateLimitError = Error & { status?: number; retryAfter?: number }

const is429 = (error: RateLimitError): boolean =>
  error.status === 429 || error.message.includes('Too Many Requests')

export const throttleRequestsWithRetry = (
  config: ThrottleConfig,
): (<T>(fn: () => Promise<T>, weight?: number) => Promise<T>) => {
  const {
    rateLimit,
    windowMs,
    workerCount = 1,
    safetyFactor = 0.5,
    burst = 4,
    maxRetries = 3,
    label = 'throttle',
  } = config

  // A token bucket, not a fixed window. Each worker earns its exact share of
  // the budget one token at a time and may bank up to `burst` of them while
  // its test body runs, so a test's setup calls go out back to back instead
  // of being spaced across several windows. The long-run rate is the same
  // share the fixed window gave; only the waiting moved. The bucket starts
  // at one window's share so a run's first tests, which every worker starts
  // at once, still ramp up rather than spending the whole bank together.
  const perWorkerPerWindow = (rateLimit * safetyFactor) / workerCount
  const capacity = Math.max(1, burst)

  const limiter = new Bottleneck({
    reservoir: Math.min(capacity, Math.max(1, Math.floor(perWorkerPerWindow))),
    reservoirIncreaseInterval: Math.ceil(windowMs / perWorkerPerWindow),
    reservoirIncreaseAmount: 1,
    reservoirIncreaseMaximum: capacity,
    maxConcurrent: null,
  })

  limiter.on(
    'failed',
    async (error: RateLimitError, jobInfo): Promise<number | void> => {
      if (jobInfo.retryCount < maxRetries && is429(error)) {
        // A missing Retry-After must still wait out the whole rate window:
        // a 1s fallback would re-hammer an exhausted budget seven times in
        // one window and burn every retry inside the same burst.
        const retryAfter = error.retryAfter || 10
        const waitMs = retryAfter * 1000
        console.log(
          `[${label}] 429 hit — attempt ` +
            `${jobInfo.retryCount + 1}/${maxRetries}, ` +
            `waiting ${retryAfter}s`,
        )
        return waitMs
      }

      return undefined
    },
  )

  // Bottleneck never launches a job whose weight exceeds the bucket's
  // capacity, so the job would wait forever (ENG-11105 deadlocked every
  // browser sign-in for 120s that way). Clamp instead: an over-weighted job
  // drains the whole bucket, slightly under-counting its true cost rather
  // than hanging.
  return <T>(fn: () => Promise<T>, weight?: number): Promise<T> =>
    limiter.schedule({ weight: Math.min(weight ?? 1, capacity) }, fn)
}

// https://clerk.com/docs/guides/how-clerk-works/system-limits#backend-api-requests
const CLERK_DEV_RATE_LIMIT = 100
const CLERK_RATE_WINDOW_MS = 10_000

// The 100-req/10s budget is per Clerk INSTANCE, and every process that holds
// the dev secret key spends from it: all of this run's workers, any other E2E
// run in flight at the same time (another PR, the release train, a re-run),
// gp-api dev's own provisioning lookups, and the hourly test-user sweep.
// Note that gp-api's provisioning lookups are UNTHROTTLED and un-retried: its
// own clerkThrottle.util.ts wraps only the test-fixture and test-user-sweep
// calls, never the hot auth path, where ClerkAuthService.getUser goes straight
// out via clerkCall — an OTel span plus a timeout, no rate limiting. The sweep
// is gated to the dev and prod deploys, so preview stacks no longer each run
// one. workerCount must therefore count every worker of a whole CI run —
// E2E_SHARD_TOTAL shards x WORKERS_PER_SHARD playwright workers (the
// workflow's shard matrix x workers.ts), not one shard's — or a single run
// budgets itself the entire instance and any concurrency at all tips Clerk
// into 429s, which gp-api surfaces as bare 401s on test setup (ENG-11105).
// Locally there is one unsharded process. The 0.5 safety factor then caps
// one full run at ~50 req/10s, leaving the other half of the budget for
// everything else.
// Residual bursts are absorbed by retries on both paths: withGatewayRetry
// covers the gp-api HTTP calls, and this limiter's own 429 retry covers the
// direct Clerk SDK calls (createUser, createSession, getToken) — Clerk
// errors are not axios errors, so withGatewayRetry never sees them. 7
// retries x 10s Retry-After give the SDK path a window comparable to
// withGatewayRetry's ~51s.
const TOTAL_RUN_WORKERS = process.env.CI
  ? Number(process.env.E2E_SHARD_TOTAL ?? 4) * WORKERS_PER_SHARD
  : WORKERS_PER_SHARD

export const clerkThrottle = throttleRequestsWithRetry({
  rateLimit: CLERK_DEV_RATE_LIMIT,
  windowMs: CLERK_RATE_WINDOW_MS,
  workerCount: TOTAL_RUN_WORKERS,
  safetyFactor: 0.5,
  maxRetries: 7,
  label: 'clerk-limiter',
})
