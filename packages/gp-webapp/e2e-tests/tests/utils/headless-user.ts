import { randomUUID } from 'node:crypto'
import axios, { type AxiosInstance } from 'axios'
import { createClerkClient } from '@clerk/backend'
import { TestDataHelper } from '../../src/helpers/data.helper'
import { clerkThrottle } from './throttle-requests-with-retry'

// Playwright-free test-user creation. Everything here runs against the API with
// a backend-minted Clerk token — no browser, no `page`. api-registration.ts
// imports these primitives for its page-driven flow; cohort/ops scripts import
// createHeadlessTestUser directly so they never spin up Playwright.

// API_BASE_URL alone is sufficient for all cohort/API operations; BASE_URL is
// only the page-driven path's concern (api-registration.ts guards it there for
// cookie domain). Require at least one so the standalone cohort runbook — which
// sets only API_BASE_URL — doesn't throw at import.
const apiBaseURL = process.env.API_BASE_URL || process.env.BASE_URL

if (!apiBaseURL) {
  throw new Error('Set API_BASE_URL or BASE_URL')
}

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY

if (!CLERK_SECRET_KEY) {
  throw new Error('CLERK_SECRET_KEY is not set')
}

export const clerkBackend = createClerkClient({ secretKey: CLERK_SECRET_KEY })

export const apiURL = `${apiBaseURL}/api`

// A cold PR-preview gp-api stack returns gateway 5xx (502/503/504) on its first
// requests until the ECS target passes health checks, and can refuse the
// connection outright. These are pre-backend — the request never got a
// successful response through a healthy task — so re-issuing is safe even for
// the write paths (the users are disposable @test.goodparty.org accounts the
// sweep deletes).
// 401 is retriable here too, and it's the dominant source of setup flakiness:
// the token minted just above is a brand-new Clerk session, and gp-api can
// reject it (401) for the first moment before the session/token propagates to
// Clerk's verification — most visible under the 4 parallel shards hammering a
// cold preview. It's transient, so retrying with backoff lets the session
// settle; a genuinely invalid token just exhausts the attempts and throws the
// same 401. Safe on the write paths for the same reason as the gateway codes —
// the users are disposable @test.goodparty.org accounts the sweep deletes.
const RETRIABLE_STATUSES = new Set([401, 502, 503, 504])

const isRetriableGatewayError = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) return false
  const status = error.response?.status
  if (status === undefined) return true
  return RETRIABLE_STATUSES.has(status)
}

const GATEWAY_RETRY_ATTEMPTS = 5

export const withGatewayRetry = async <T>(
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
          `[headless-user] ${label} transient gateway error on attempt ` +
            `${attempt}/${GATEWAY_RETRY_ATTEMPTS}, retrying in ${backoffMs}ms`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
  throw lastError
}

// Browser-minted Clerk session tokens expire after 60 seconds, so a token baked
// into a static Authorization header dies partway through any long flow. Mint
// the API token from a backend session instead, with a lifetime that outlasts
// the work.
const E2E_TOKEN_TTL_SECONDS = 60 * 60

export const mintApiToken = async (clerkUserId: string): Promise<string> => {
  const session = await clerkThrottle(() =>
    clerkBackend.sessions.createSession({ userId: clerkUserId }),
  )
  const { jwt } = await clerkThrottle(() =>
    clerkBackend.sessions.getToken(
      session.id,
      undefined,
      E2E_TOKEN_TTL_SECONDS,
    ),
  )
  return jwt
}

export type Race = {
  id: string
  brPositionId: string
  filingPeriods?: { startOn: string; endOn: string }[]
  election: {
    id?: string
    electionDay: string
    name?: string
    state?: string
  }
  position: {
    id?: string
    hasPrimary?: boolean
    partisanType?: string
    level: string
    name: string
    state: string
  }
}

export type HeadlessUserProduct = 'win' | 'serve'

export type CreateHeadlessTestUserOptions = {
  product: HeadlessUserProduct
  // win: pick the candidate race by zip + office name (or a predicate).
  race?: {
    zip: string
    office: string | ((office: string) => boolean)
  }
  // win: stop after JIT-provisioning the user (no campaign).
  skipCampaignCreation?: boolean
  // serve: the election-api Position id to bind the elected office to. Stored as
  // org.positionId, which resolveServeContext feeds to getPositionById so the
  // org inherits that position's isServeIcp. (The create DTO field is named
  // ballotReadyPositionId but is stored verbatim as org.positionId.)
  positionId?: string
  termStartDate?: string
  termEndDate?: string
}

export type HeadlessTestUser = {
  user: {
    id: number
    firstName: string
    lastName: string
    email: string
    name: string
    zip: string
    phone: string
    password: string
  }
  token: string
  client: AxiosInstance
  clerkUserId: string
  campaignId?: number
  orgSlug?: string
}

export const createHeadlessTestUser = async (
  options: CreateHeadlessTestUserOptions,
): Promise<HeadlessTestUser> => {
  const generated = TestDataHelper.generateTestUserData()
  const password = `Test${randomUUID()}!`
  const zip = options.race?.zip || generated.zipCode

  const clerkUser = await clerkThrottle(() =>
    clerkBackend.users.createUser({
      emailAddress: [generated.email],
      password,
      firstName: generated.firstName,
      lastName: generated.lastName,
      skipPasswordChecks: true,
    }),
  )

  const token = await mintApiToken(clerkUser.id)

  const client = axios.create({
    baseURL: apiURL,
    headers: {
      common: { Authorization: `Bearer ${token}` },
    },
  })

  // First authenticated gp-api call — JIT-provisions the user and doubles as the
  // cold-stack readiness probe so the writes below land on a healthy task.
  const { data: apiUser } = await withGatewayRetry('GET /v1/users/me', () =>
    client.get<{
      id: number
      firstName: string
      lastName: string
      email: string
      phone: string
    }>('/v1/users/me'),
  )

  const user: HeadlessTestUser['user'] = {
    id: apiUser.id,
    firstName: apiUser.firstName,
    lastName: apiUser.lastName,
    email: apiUser.email,
    name: `${apiUser.firstName} ${apiUser.lastName}`,
    zip,
    phone: apiUser.phone || generated.phone,
    password,
  }

  const result: HeadlessTestUser = {
    user,
    token,
    client,
    clerkUserId: clerkUser.id,
  }

  if (options.product === 'serve') {
    const { data: electedOffice } = await withGatewayRetry(
      'POST /v1/elected-office',
      () =>
        client.post<{ id: string }>('/v1/elected-office', {
          ballotReadyPositionId: options.positionId,
          termStartDate: options.termStartDate,
          termEndDate: options.termEndDate,
        }),
    )
    if (!electedOffice?.id) {
      throw new Error('Elected office creation did not return a valid id')
    }
    result.orgSlug = `eo-${electedOffice.id}`
    return result
  }

  if (options.skipCampaignCreation) {
    return result
  }

  const { data: races } = await withGatewayRetry(
    'GET /v1/elections/races-by-year',
    () =>
      client.get<Race[]>('/v1/elections/races-by-year', {
        params: { zipcode: zip },
      }),
  )

  const desiredRace = options.race?.office ?? 'Cheyenne City Council - Ward 1'
  const race = races.find((race) =>
    typeof desiredRace === 'function'
      ? desiredRace(race.position.name)
      : race.position.name === desiredRace,
  )

  if (!race) {
    throw new Error('No race found for the specific office selector')
  }

  const { data: campaign } = await withGatewayRetry('POST /v1/campaigns', () =>
    client.post<{ id: number }>('/v1/campaigns', {
      ballotReadyPositionId: race.brPositionId,
      details: {
        electionId: race.election.id,
        raceId: race.id,
        state: race.position.state,
        ballotLevel: race.position.level?.toUpperCase(),
        electionDate: race.election.electionDay,
        partisanType: race.position.partisanType,
        hasPrimary: race.position.hasPrimary,
        filingPeriodsStart: race.filingPeriods?.[0]?.startOn,
        filingPeriodsEnd: race.filingPeriods?.[0]?.endOn,
      },
      data: { currentStep: 'onboarding-1' },
    }),
  )

  if (!campaign?.id) {
    throw new Error('Campaign creation did not return a valid id')
  }

  result.campaignId = campaign.id
  result.orgSlug = `campaign-${campaign.id}`

  client.defaults.headers.common['x-organization-slug'] =
    `campaign-${campaign.id}`

  await withGatewayRetry('PUT /v1/campaigns/mine', () =>
    client.put('/v1/campaigns/mine', {
      data: { currentStep: 'onboarding-complete' },
      details: { otherParty: 'Independent', pledged: true },
    }),
  )
  await withGatewayRetry('POST /v1/campaigns/launch', () =>
    client.post('/v1/campaigns/launch', {}),
  )

  return result
}
