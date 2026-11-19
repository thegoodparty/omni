import type { AxiosInstance } from 'axios'
import { createApiClient, withGatewayRetry } from './api'
import { clerkClient, mintApiToken, mintSignInTicket } from './clerk'
import { apiUrlFor, requireClerkSecretKey } from './config'
import { generateTestUserData } from './identifiers'
import { clerkThrottle } from './throttle'

// The elected-official ("serve") side of test-user creation. A serve lead is a
// Clerk user an elected office is attached to; the magic-link entry point is a
// Clerk sign-in ticket appended to the redemption page as
// `/serve/welcome?__clerk_ticket=<token>`.
//
// In production that ticket is minted server-side by
// `POST /v1/admin/elected-office/magic-link` (gp-api), guarded by
// `AdminOrM2MGuard` — credentials a test harness does not hold. The harness
// holds the Clerk test-instance secret, so it mints the ticket directly with the
// Clerk backend SDK, exactly the way gp-api does internally.

export type ServeLeadUser = {
  clerkUserId: string
  email: string
  firstName: string
  lastName: string
}

export type ServeMagicLink = {
  user: ServeLeadUser
  ticket: string
  // Same-origin relative path, e.g. `/serve/welcome?__clerk_ticket=...`.
  welcomeUrl: string
}

// A brand-new passwordless Clerk user standing in for a sales-provisioned EO
// lead, mirroring `provisionMagicLinkUser`'s `skipPasswordRequirement: true`.
// The `@test.goodparty.org` address is matched by gp-api's scheduled
// `deleteTestUsers` sweep (stale users > 3h), so no explicit cleanup is needed.
export const createServeLeadUser = async (
  overrides?: Partial<Pick<ServeLeadUser, 'email' | 'firstName' | 'lastName'>>,
): Promise<ServeLeadUser> => {
  requireClerkSecretKey()
  const generated = generateTestUserData()
  const email = overrides?.email ?? generated.email
  const firstName = overrides?.firstName ?? generated.firstName
  const lastName = overrides?.lastName ?? generated.lastName

  const clerkUser = await clerkThrottle(() =>
    clerkClient().users.createUser({
      emailAddress: [email],
      firstName,
      lastName,
      skipPasswordRequirement: true,
    }),
  )

  return { clerkUserId: clerkUser.id, email, firstName, lastName }
}

export const mintServeTicket = (clerkUserId: string): Promise<string> =>
  mintSignInTicket(clerkUserId)

export const buildServeWelcomeUrl = (ticket: string): string =>
  `/serve/welcome?__clerk_ticket=${encodeURIComponent(ticket)}`

export const createServeMagicLink = async (
  overrides?: Partial<Pick<ServeLeadUser, 'email' | 'firstName' | 'lastName'>>,
): Promise<ServeMagicLink> => {
  const user = await createServeLeadUser(overrides)
  const ticket = await mintServeTicket(user.clerkUserId)
  return { user, ticket, welcomeUrl: buildServeWelcomeUrl(ticket) }
}

export type SeedPrefilledOfficeOptions = {
  // Office name stored as the org's `customPositionName`. The serve flow reads
  // `org.positionName` (= `customPositionName ?? position?.name`), so a custom
  // name alone makes the office "prefilled" and `confirm`-continuable without a
  // BallotReady lookup.
  positionName?: string
  // BallotReady position id to bind the org to. Unset by default, which keeps
  // the prefill-branch spec testing what it is meant to: a sales prefill
  // BallotReady could not match to a position.
  //
  // Set it for any account a human will actually use. Without a position the
  // org has no district, so `resolveDistrictInfoFromOrg` finds nothing and
  // every district-scoped read — `count_contacts`, `describe_filter_dimensions`,
  // `crud_saved_filters`, the constituent data tools — comes back
  // `VOTER_DATA_UNAVAILABLE`. The account looks fine and is inert.
  //
  // `Z2lkOi8vYmFsbG90LWZhY3RvcnkvUG9zaXRpb24vMTczMjcw` is Cheyenne City
  // Council Ward 1, which the e2e specs already lean on because it resolves in
  // every environment and has a populated DistrictStats row.
  ballotReadyPositionId?: string
  // `yyyy-MM-dd`.
  termStartDate?: string
  // `yyyy-MM-dd`.
  termEndDate?: string
  // The gp-api to provision through, as the webapp root.
  apiBaseUrl?: string
}

export type SeededElectedOffice = {
  // Axios client authed as the seeded user (for assertions / cleanup).
  client: AxiosInstance
  electedOfficeId: string
}

// Seed a prefilled `ElectedOffice` for `user` so the serve flow resolves
// `branch === 'prefill'` (and shows the "Does this look right?" Confirm screen
// instead of the net-new office picker). The prefill gate is: office/term data
// present AND the `selfReported` marker absent — `POST /v1/elected-office` never
// sets `selfReported`, so a create with a `customPositionName` + term dates
// lands squarely in the prefill branch with a valid, continuable Confirm step.
//
// Uses a directly-minted backend API token, independent of any browser session,
// so the seed is in place before a lead ever lands on `/serve/welcome`.
export const seedPrefilledElectedOffice = async (
  user: ServeLeadUser,
  options: SeedPrefilledOfficeOptions = {},
): Promise<SeededElectedOffice> => {
  const {
    positionName = 'Governor of Maryland',
    ballotReadyPositionId,
    termStartDate = '2023-01-18',
    termEndDate = '2027-01-20',
  } = options

  const token = await mintApiToken(user.clerkUserId)
  const client = createApiClient(token, apiUrlFor(options.apiBaseUrl))

  // First authenticated gp-api call: JIT-provisions the local user row and
  // doubles as the cold-stack readiness probe (retry warms the target).
  await withGatewayRetry('GET /v1/users/me', () => client.get('/v1/users/me'))

  const { data } = await withGatewayRetry('POST /v1/elected-office', () =>
    client.post<{ id: string }>('/v1/elected-office', {
      // A bound position clears customPositionName server-side, so sending
      // both would leave the stale name shadowing the resolved one.
      ...(ballotReadyPositionId
        ? { ballotReadyPositionId }
        : { customPositionName: positionName }),
      termStartDate,
      termEndDate,
    }),
  )

  return { client, electedOfficeId: data.id }
}
