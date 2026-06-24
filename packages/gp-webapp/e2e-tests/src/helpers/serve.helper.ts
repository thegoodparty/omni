import axios, { type AxiosInstance } from 'axios'
import { createClerkClient } from '@clerk/backend'
import { type Page } from '@playwright/test'
import { setupClerkTestingToken } from '@clerk/testing/playwright'
import { TestDataHelper } from './data.helper'
import { clerkThrottle } from 'tests/utils/throttle-requests-with-retry'

/**
 * Helpers for the elected-official ("serve") magic-link onboarding flow.
 *
 * The real entry point is a Clerk sign-in *ticket* appended to the redemption
 * landing page as `/serve/welcome?__clerk_ticket=<token>`. In production that
 * ticket is minted server-side by `POST /v1/admin/elected-office/magic-link`
 * (gp-api), which is guarded by `AdminOrM2MGuard` — credentials the E2E harness
 * does not hold. The harness *does* hold the Clerk **test instance** secret
 * (`CLERK_SECRET_KEY`, the same key `api-registration.ts` uses to create users
 * and mint API tokens), so we mint the ticket directly with the Clerk backend
 * SDK exactly the way gp-api does internally
 * (`clerkClient.signInTokens.createSignInToken`, see
 * `users.service.ts#provisionMagicLinkUser`). This is the cleanest reliable
 * approach for the harness and avoids depending on admin/M2M auth or a stable
 * BallotReady integration in the ephemeral per-PR preview env.
 *
 * The webapp authenticates browser `/api/v1/*` calls purely from the Clerk
 * session (the Next middleware injects `auth().getToken()` into the rewrite —
 * see `middleware.ts`), so redeeming the ticket in the browser is fully
 * self-authenticating; no manual `token` cookie is needed (unlike
 * `authenticateTestUser`, which sets one for its own long-lived API client).
 */

const baseURL = process.env.BASE_URL
if (!baseURL) {
  throw new Error('BASE_URL is not set')
}

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY
if (!CLERK_SECRET_KEY) {
  throw new Error('CLERK_SECRET_KEY is not set')
}

const clerkBackend = createClerkClient({ secretKey: CLERK_SECRET_KEY })

const apiBaseURL = process.env.API_BASE_URL || baseURL
const apiURL = `${apiBaseURL}/api`

// A cold PR-preview gp-api stack returns gateway 5xx (502/503/504) on its first
// requests until the ECS target passes health checks, and can refuse the
// connection outright. These are pre-backend (the request never reached a
// healthy task), so re-issuing is safe even for the EO seed write. Mirrors the
// retry policy in `tests/utils/api-registration.ts`.
const RETRIABLE_GATEWAY_STATUSES = new Set([502, 503, 504])
const GATEWAY_RETRY_ATTEMPTS = 5

const isRetriableGatewayError = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) return false
  const status = error.response?.status
  if (status === undefined) return true
  return RETRIABLE_GATEWAY_STATUSES.has(status)
}

const withGatewayRetry = async <T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> => {
  let lastError: unknown
  for (let attempt = 1; attempt <= GATEWAY_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (
        attempt === GATEWAY_RETRY_ATTEMPTS ||
        !isRetriableGatewayError(error)
      ) {
        throw error
      }
      const backoffMs = Math.min(1_000 * 2 ** (attempt - 1), 8_000)
      if (process.env.DEBUG) {
        console.log(
          `[serve.helper] ${label} transient gateway error on attempt ` +
            `${attempt}/${GATEWAY_RETRY_ATTEMPTS}, retrying in ${backoffMs}ms`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
  throw lastError
}

/** A passwordless Clerk lead provisioned for the serve magic-link flow. */
export type ServeLeadUser = {
  clerkUserId: string
  email: string
  firstName: string
  lastName: string
}

/** A minted serve ticket and the URL that redeems it. */
export type ServeMagicLink = {
  user: ServeLeadUser
  ticket: string
  /** Same-origin relative path, e.g. `/serve/welcome?__clerk_ticket=...`. */
  welcomeUrl: string
}

/**
 * Create a brand-new passwordless Clerk user to stand in for a sales-provisioned
 * EO lead. Mirrors `provisionMagicLinkUser`'s `skipPasswordRequirement: true`.
 * The `@test.goodparty.org` address is matched by gp-api's scheduled
 * `deleteTestUsers` sweep (stale users > 3h), so no explicit cleanup is needed.
 */
export const createServeLeadUser = async (
  overrides?: Partial<Pick<ServeLeadUser, 'email' | 'firstName' | 'lastName'>>,
): Promise<ServeLeadUser> => {
  const generated = TestDataHelper.generateTestUserData()
  const email = overrides?.email ?? generated.email
  const firstName = overrides?.firstName ?? generated.firstName
  const lastName = overrides?.lastName ?? generated.lastName

  const clerkUser = await clerkThrottle(() =>
    clerkBackend.users.createUser({
      emailAddress: [email],
      firstName,
      lastName,
      skipPasswordRequirement: true,
    }),
  )

  return { clerkUserId: clerkUser.id, email, firstName, lastName }
}

/**
 * Mint a single-use Clerk sign-in token (the `__clerk_ticket`) for a user,
 * exactly as gp-api does (`signInTokens.createSignInToken`). Default lifetime is
 * short — tests redeem immediately.
 */
export const mintServeTicket = async (
  clerkUserId: string,
  expiresInSeconds = 60 * 30,
): Promise<string> => {
  const signInToken = await clerkThrottle(() =>
    clerkBackend.signInTokens.createSignInToken({
      userId: clerkUserId,
      expiresInSeconds,
    }),
  )
  if (!signInToken.token) {
    throw new Error('Clerk did not return a sign-in token')
  }
  return signInToken.token
}

/** Build the public redemption URL the welcome page reads `__clerk_ticket` from. */
export const buildServeWelcomeUrl = (ticket: string): string =>
  `/serve/welcome?__clerk_ticket=${encodeURIComponent(ticket)}`

/**
 * One-call setup for the magic-link entry: create a lead + mint a ticket +
 * build the welcome URL.
 */
export const createServeMagicLink = async (
  overrides?: Partial<Pick<ServeLeadUser, 'email' | 'firstName' | 'lastName'>>,
): Promise<ServeMagicLink> => {
  const user = await createServeLeadUser(overrides)
  const ticket = await mintServeTicket(user.clerkUserId)
  return { user, ticket, welcomeUrl: buildServeWelcomeUrl(ticket) }
}

// Browser-minted Clerk session tokens expire after 60s; mint the seed API token
// from a backend session with a lifetime that outlasts setup, mirroring
// `api-registration.ts#mintApiToken`.
const SEED_TOKEN_TTL_SECONDS = 60 * 60

const mintApiToken = async (clerkUserId: string): Promise<string> => {
  const session = await clerkThrottle(() =>
    clerkBackend.sessions.createSession({ userId: clerkUserId }),
  )
  const { jwt } = await clerkThrottle(() =>
    clerkBackend.sessions.getToken(
      session.id,
      undefined,
      SEED_TOKEN_TTL_SECONDS,
    ),
  )
  return jwt
}

export type SeedPrefilledOfficeOptions = {
  /**
   * Office name stored as the org's `customPositionName`. The serve flow reads
   * `org.positionName` (= `customPositionName ?? position?.name`), so a custom
   * name alone makes the office "prefilled" and `confirm`-continuable without a
   * BallotReady lookup.
   */
  positionName?: string
  /** `yyyy-MM-dd`. */
  termStartDate?: string
  /** `yyyy-MM-dd`. */
  termEndDate?: string
}

export type SeededElectedOffice = {
  /** Axios client authed as the seeded user (for assertions / cleanup). */
  client: AxiosInstance
  electedOfficeId: string
}

/**
 * Seed a prefilled `ElectedOffice` for `user` so the serve flow resolves
 * `branch === 'prefill'` (and shows the "Does this look right?" Confirm screen
 * instead of the net-new office picker). The prefill gate is: office/term data
 * present AND the `selfReported` marker absent — `POST /v1/elected-office` never
 * sets `selfReported`, so a create with a `customPositionName` + term dates
 * lands squarely in the prefill branch with a valid, continuable Confirm step.
 *
 * Uses a directly-minted backend API token (independent of the browser session
 * the ticket redemption will later establish) so the seed is in place before the
 * lead ever lands on `/serve/welcome`.
 */
export const seedPrefilledElectedOffice = async (
  user: ServeLeadUser,
  options: SeedPrefilledOfficeOptions = {},
): Promise<SeededElectedOffice> => {
  const {
    positionName = 'Governor of Maryland',
    termStartDate = '2023-01-18',
    termEndDate = '2027-01-20',
  } = options

  const token = await mintApiToken(user.clerkUserId)
  const client = axios.create({
    baseURL: apiURL,
    headers: { common: { Authorization: `Bearer ${token}` } },
  })

  // First authenticated gp-api call: JIT-provisions the local user row and
  // doubles as the cold-stack readiness probe (retry warms the target).
  await withGatewayRetry('GET /v1/users/me', () => client.get('/v1/users/me'))

  const { data } = await withGatewayRetry('POST /v1/elected-office', () =>
    client.post<{ id: string }>('/v1/elected-office', {
      customPositionName: positionName,
      termStartDate,
      termEndDate,
    }),
  )

  return { client, electedOfficeId: data.id }
}

/**
 * Drive the public redemption landing page: navigate to the ticketed welcome
 * URL and click the button that redeems the ticket. Resolves once the redeemed
 * session lands the lead on `/serve/onboarding`.
 *
 * `setupClerkTestingToken` is required first because the page performs a real
 * frontend `client.signIn.create({ strategy: 'ticket' })`, which Clerk bot
 * protection would otherwise block.
 */
export const redeemServeTicket = async (
  page: Page,
  welcomeUrl: string,
): Promise<void> => {
  await setupClerkTestingToken({ page })
  // The cookie-consent snackbar (`app/shared/layouts/CookiesSnackbar.tsx`)
  // renders `fixed bottom-4 … w-full` on every page and overlays the onboarding
  // footer, intercepting the welcome step's Continue click. Pre-seed the
  // accepted cookie so the banner never mounts (it reads `cookiesAccepted` from
  // document.cookie once on mount) — more robust than racing a dismiss click
  // after each navigation.
  await page
    .context()
    .addCookies([{ name: 'cookiesAccepted', value: 'true', url: baseURL }])
  await page.goto(welcomeUrl)
  await page
    .getByRole('button', { name: /continue to goodparty/i })
    .click({ timeout: 30_000 })
  await page.waitForURL((url) => url.pathname.startsWith('/serve/onboarding'), {
    timeout: 45_000,
  })
}
