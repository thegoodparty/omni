import { randomUUID } from 'node:crypto'
import type { AxiosInstance } from 'axios'
import type { TestModeElectionPreset } from '@goodparty_org/contracts'
import { createApiClient, withGatewayRetry } from './api'
import { clerkClient, mintApiToken } from './clerk'
import { apiUrlFor, requireClerkSecretKey } from './config'
import { generateTestUserData, uniquePhone } from './identifiers'
import {
  applyElectionPreset,
  DEFAULT_ELECTION_PRESET,
  DEFAULT_TEST_RACE,
  resolveTestRace,
  type TestRace,
} from './race'
import { clerkThrottle } from './throttle'

// One signed-in test user, provisioned entirely through the API. No browser, no
// Playwright: this is everything `api-registration.ts` does before it touches a
// page, plus the same for an elected-official office.
//
// ORDERING CONTRACT: everything gp-api needs (user row, campaign or office) is
// created through the API client FIRST. A browser that still has to be signed
// in is signed in LAST, by whoever holds it. Signing in earlier leaves a window
// where the browser holds a Clerk session for a user gp-api has never seen, and
// every request the app makes in that window races to JIT-provision the same
// identity through Clerk's Backend API. Any new helper that creates a user must
// follow the same order.

export type TestUserProduct = 'win' | 'serve'

export type TestUser = {
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
  // The org this user owns, as gp-api named it: `campaign-<id>` for a Win
  // campaign, `eo-<id>` for a Serve office. Every org-scoped route needs it in
  // `x-organization-slug`.
  orgSlug: string
  campaignId?: number
  electedOfficeId?: string
}

export type CreateTestUserOptions = {
  product: TestUserProduct
  // The gp-api to provision through, as the webapp root. Defaults to
  // API_BASE_URL, then BASE_URL.
  apiBaseUrl?: string
  // Overrides the generated address. Staff-only surfaces need a
  // `qa-<uuid>+clerk_test@goodparty.org` shape, which gp-api's isTestUser and
  // the POTENTIAL_BUYER Amplitude segment both match.
  email?: string
  // Overrides the generated name. A suite gives a case's attempts one profile,
  // so the same person is signing in under three accounts.
  firstName?: string
  lastName?: string
  // win: the office the campaign runs for (default DEFAULT_TEST_RACE).
  race?: TestRace
  // win: the campaign's election state (default DEFAULT_ELECTION_PRESET).
  election?: TestModeElectionPreset
  // win: stop after JIT-provisioning the user (no campaign). The returned org is
  // then absent, and `orgSlug` is empty.
  skipCampaignCreation?: boolean
  // serve: the election-api Position id to bind the elected office to. Stored as
  // org.positionId, which resolveServeContext feeds to getPositionById so the
  // org inherits that position's isServeIcp. (The create DTO field is named
  // ballotReadyPositionId but is stored verbatim as org.positionId.)
  positionId?: string
  // serve: the office name used instead of a bound position, which keeps the
  // org "prefilled" with no BallotReady lookup.
  positionName?: string
  termStartDate?: string
  termEndDate?: string
}

// Creates a brand-new Clerk identity, provisions it through gp-api, and leaves
// it holding a one-hour API token. The user is not deleted afterwards: gp-api's
// scheduled `sweepTestUsers` cron removes stale @test.goodparty.org users older
// than 3 hours.
export const createTestUser = async (
  options: CreateTestUserOptions,
): Promise<TestUser> => {
  requireClerkSecretKey()
  const apiUrl = apiUrlFor(options.apiBaseUrl)
  const generated = generateTestUserData()
  const password = `Test${randomUUID()}!`
  const zip = options.race?.zip || generated.zipCode

  const clerkUser = await clerkThrottle(() =>
    clerkClient().users.createUser({
      emailAddress: [options.email ?? generated.email],
      password,
      firstName: options.firstName ?? generated.firstName,
      lastName: options.lastName ?? generated.lastName,
      skipPasswordChecks: true,
    }),
  )

  const token = await mintApiToken(clerkUser.id)
  const client = createApiClient(token, apiUrl)

  // First authenticated gp-api call — this is what JIT-provisions the local user
  // row, and it is deliberately the ONLY request that does so: it is serial and
  // retried, where a browser's post-sign-in fan-out is neither. It also doubles
  // as the cold-stack readiness probe: retrying it warms the target so the
  // writes below land on a healthy task.
  const { data: apiUser } = await withGatewayRetry('GET /v1/users/me', () =>
    client.get<{
      id: number
      firstName: string
      lastName: string
      email: string
      phone: string
    }>('/v1/users/me'),
  )

  // Post-auth routing sends phone-less users through /sign-up/phone
  // (ENG-11538), so save a phone up front or UI-login flows stop on that page.
  const phone = apiUser.phone || uniquePhone()
  if (!apiUser.phone) {
    await withGatewayRetry('PUT /v1/users/me', () =>
      client.put('/v1/users/me', { phone }),
    )
  }

  const user: TestUser['user'] = {
    id: apiUser.id,
    firstName: apiUser.firstName,
    lastName: apiUser.lastName,
    email: apiUser.email,
    name: `${apiUser.firstName} ${apiUser.lastName}`,
    zip,
    phone,
    password,
  }

  const result: TestUser = {
    user,
    token,
    client,
    clerkUserId: clerkUser.id,
    orgSlug: '',
  }

  if (options.product === 'serve') {
    const { data: electedOffice } = await withGatewayRetry(
      'POST /v1/elected-office',
      () =>
        client.post<{ id: string }>('/v1/elected-office', {
          // A bound position clears customPositionName server-side, so sending
          // both would leave the stale name shadowing the resolved one.
          ...(options.positionId
            ? { ballotReadyPositionId: options.positionId }
            : options.positionName
              ? { customPositionName: options.positionName }
              : {}),
          ...(options.termStartDate
            ? { termStartDate: options.termStartDate }
            : {}),
          ...(options.termEndDate ? { termEndDate: options.termEndDate } : {}),
        }),
    )
    if (!electedOffice?.id) {
      throw new Error('Elected office creation did not return a valid id')
    }
    result.electedOfficeId = electedOffice.id
    result.orgSlug = `eo-${electedOffice.id}`
    client.defaults.headers.common['x-organization-slug'] = result.orgSlug
    return result
  }

  if (options.skipCampaignCreation) return result

  const race = await resolveTestRace(client, {
    zip,
    office: options.race?.office ?? DEFAULT_TEST_RACE.office,
  })

  // The campaign is created through the product's own create route, so every
  // consumer keeps exercising it. The resolved race only places it; its date is
  // replaced by the preset below.
  const { data: campaign } = await withGatewayRetry('POST /v1/campaigns', () =>
    client.post<{ id: number }>('/v1/campaigns', {
      ballotReadyPositionId: race.brPositionId,
      details: {
        raceId: race.id,
        state: race.position.state,
        ballotLevel: race.position.level.toUpperCase(),
        electionDate: race.election.electionDay,
      },
      data: { currentStep: 'onboarding-1' },
    }),
  )

  if (!campaign?.id) {
    throw new Error('Campaign creation did not return a valid id')
  }

  // Before launch, so launch already sees the declared date.
  await applyElectionPreset(
    client,
    campaign.id,
    options.election ?? DEFAULT_ELECTION_PRESET,
  )

  result.campaignId = campaign.id
  result.orgSlug = `campaign-${campaign.id}`

  client.defaults.headers.common['x-organization-slug'] = result.orgSlug

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
