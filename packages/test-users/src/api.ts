import axios, { type AxiosInstance } from 'axios'
import { vercelBypassHeaders } from './config'

export const createApiClient = (token: string, apiUrl: string): AxiosInstance =>
  axios.create({
    baseURL: apiUrl,
    headers: {
      common: { Authorization: `Bearer ${token}`, ...vercelBypassHeaders() },
    },
  })

// A cold PR-preview gp-api stack returns gateway 5xx (502/503/504) on its first
// requests until the ECS target passes health checks, and can refuse the
// connection outright. These are pre-backend — the request never got a
// successful response through a healthy task — so re-issuing is safe even for
// the write paths (the users are disposable @test.goodparty.org accounts the
// sweep deletes).
// 401 is retriable here too, and it's the dominant source of setup flakiness —
// but not because the token is bad. gp-api's SessionGuard resolves an unknown
// clerkId by asking Clerk's Backend API who it is; when that instance-wide
// budget is exhausted Clerk answers 429, gp-api swallows it, finds no user to
// attach, and returns a bare 401. Nothing about the request is unauthorized, so
// retrying past the rate window is the correct response; a genuinely invalid
// token just exhausts the attempts and throws the same 401. Safe on the write
// paths for the same reason as the gateway codes — the users are disposable
// @test.goodparty.org accounts the sweep deletes.
const RETRIABLE_STATUSES = new Set([401, 502, 503, 504])

const isRetriableGatewayError = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) return false
  const status = error.response?.status
  if (status === undefined) return true
  return RETRIABLE_STATUSES.has(status)
}

// 7 attempts against a 20s ceiling ride out up to ~50s of exhausted Clerk
// budget. The 429 windows this retries through are made by whole concurrent
// E2E runs (another PR's shards, the release train, the test-user sweep), so
// they last tens of seconds, not the ~15s the previous 5x8s schedule could
// survive (ENG-11105). Still well inside the 120s per-test timeout.
const GATEWAY_RETRY_ATTEMPTS = 7

export const withGatewayRetry = async <T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> => {
  let lastError: unknown
  let waitedMs = 0
  for (let attempt = 1; attempt <= GATEWAY_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (
        attempt === GATEWAY_RETRY_ATTEMPTS ||
        !isRetriableGatewayError(error)
      ) {
        // Say so when the schedule ran out, unconditionally rather than under
        // DEBUG. What reaches CI otherwise is a bare `AxiosError: Request
        // failed with status code 401` from somewhere inside setup, which
        // reads as a broken token and sends the next reader looking at auth
        // code. These three numbers are what tells the two apart: an exhausted
        // retry schedule is an instance-wide Clerk rate window that outlasted
        // us, a first-attempt 401 is a real credential problem.
        if (
          attempt === GATEWAY_RETRY_ATTEMPTS &&
          isRetriableGatewayError(error)
        ) {
          const status = axios.isAxiosError(error)
            ? (error.response?.status ?? 'no response')
            : 'non-axios'
          console.warn(
            `[withGatewayRetry] ${label} gave up after ` +
              `${GATEWAY_RETRY_ATTEMPTS} attempts over ${waitedMs}ms of ` +
              `backoff; last status ${status}. A 401 here is usually Clerk's ` +
              `rate limit surfacing as an unauthorized user, not a bad token.`,
          )
        }
        throw error
      }
      // Half-fixed, half-random. Every shard's workers hit the same Clerk rate
      // window at once, so a purely exponential schedule marches them back in
      // lockstep and they collide again on each attempt; the random half
      // decorrelates them without changing the expected wait.
      const ceiling = Math.min(1_000 * 2 ** (attempt - 1), 20_000)
      const backoffMs = Math.round(ceiling / 2 + Math.random() * (ceiling / 2))
      if (process.env.DEBUG) {
        console.log(
          `[withGatewayRetry] ${label} transient gateway error on attempt ` +
            `${attempt}/${GATEWAY_RETRY_ATTEMPTS}, retrying in ${backoffMs}ms`,
        )
      }
      waitedMs += backoffMs
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
  throw lastError
}
