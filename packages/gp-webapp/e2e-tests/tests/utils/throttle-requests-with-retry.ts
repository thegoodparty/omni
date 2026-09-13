import Bottleneck from 'bottleneck'

type ThrottleConfig = {
  rateLimit: number
  windowMs: number
  workerCount?: number
  safetyFactor?: number
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
    maxRetries = 3,
    label = 'throttle',
  } = config

  const perWorkerLimit = Math.floor((rateLimit * safetyFactor) / workerCount)
  const minTimeMs = Math.ceil(windowMs / perWorkerLimit)

  const limiter = new Bottleneck({
    reservoir: perWorkerLimit,
    reservoirRefreshAmount: perWorkerLimit,
    reservoirRefreshInterval: windowMs,
    maxConcurrent: null,
    minTime: minTimeMs,
  })

  limiter.on(
    'failed',
    async (error: RateLimitError, jobInfo): Promise<number | void> => {
      if (jobInfo.retryCount < maxRetries && is429(error)) {
        const retryAfter = error.retryAfter || 1
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

  return <T>(fn: () => Promise<T>, weight?: number): Promise<T> =>
    limiter.schedule({ weight: weight ?? 1 }, fn)
}

// https://clerk.com/docs/guides/how-clerk-works/system-limits#backend-api-requests
const CLERK_DEV_RATE_LIMIT = 100
const CLERK_RATE_WINDOW_MS = 10_000

// The 100-req/10s budget is per Clerk INSTANCE, and every process that holds
// the dev secret key spends from it: all of this run's workers, any other E2E
// run in flight at the same time (another PR, the release train, a re-run),
// gp-api dev's own provisioning lookups (capped at 50/10s in its
// clerkThrottle.util.ts), preview-stack gp-apis, and the 6-hourly test-user
// sweep. workerCount must therefore count every worker of a whole CI run —
// 4 shards x 4 playwright workers (gp-webapp.yml matrix x playwright.config
// workers), not one shard's 4 — or a single run budgets itself the entire
// instance and any concurrency at all tips Clerk into 429s, which gp-api
// surfaces as bare 401s on test setup (ENG-11105). Locally there is one
// unsharded 4-worker process. The 0.5 safety factor then caps one full run
// at ~48 req/10s, leaving the other half of the budget for everything else;
// residual bursts are absorbed by withGatewayRetry's backoff.
const TOTAL_RUN_WORKERS = process.env.CI ? 16 : 4

export const clerkThrottle = throttleRequestsWithRetry({
  rateLimit: CLERK_DEV_RATE_LIMIT,
  windowMs: CLERK_RATE_WINDOW_MS,
  workerCount: TOTAL_RUN_WORKERS,
  safetyFactor: 0.5,
  maxRetries: 3,
  label: 'clerk-limiter',
})
