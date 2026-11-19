import { type BrowserContext, type Page, test } from '@playwright/test'
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'
import {
  createTestUser,
  DEFAULT_ELECTION_PRESET,
  mintSignInTicket,
  type CreateTestUserOptions,
  type TestUser,
} from '@goodparty_org/test-users'

const baseURL = process.env.BASE_URL

if (!baseURL) {
  throw new Error('BASE_URL is not set')
}

const COOKIE_DOMAIN =
  baseURL.replace('http://', '').replace('https://', '').split('/')[0] ?? ''

type BaseTestUserOptions = {
  /**
   * If true, a dedicated user will be created for the test.
   * Otherwise, the user will be shared with other tests.
   *
   * Either way, the user is not deleted after the test — gp-api's
   * scheduled `deleteTestUsers` sweep removes stale @test.goodparty.org
   * users older than 3 hours.
   */
  isolated?: boolean
  user?: Partial<{ email: string }>
  /**
   * The office the campaign runs for. Defaults to DEFAULT_TEST_RACE. Only the
   * office is taken from the real race; the date comes from `election`.
   */
  race?: CreateTestUserOptions['race']
  /**
   * The campaign's election state, computed by gp-api from its own clock.
   * Defaults to `in_8_weeks`, outside the 19-day texting cutoff. Any other
   * preset needs `isolated: true`, so the per-worker cached user keeps the
   * default.
   */
  election?: CreateTestUserOptions['election']
}

export type TestUserOptions =
  | (BaseTestUserOptions & { skipCampaignCreation?: false })
  | (BaseTestUserOptions & {
      /**
       * If true, automated campaign onboarding will be skipped.
       * Requires isolated: true to prevent caching an incomplete user.
       */
      skipCampaignCreation: true
      isolated: true
    })

export type AuthenticatedUser = TestUser['user']

type BootstrappedUser = TestUser

type PlaywrightCookie = Parameters<BrowserContext['addCookies']>[0][0]

// Global cache for shared users per worker
let cachedUser: BootstrappedUser | null = null

// Establish the browser's Clerk session. Deliberately the LAST step of
// bootstrapping (see bootstrapTestUser): the moment a Clerk session exists in
// the browser, the app fans out ~8 concurrent authenticated calls
// (/v1/campaigns/mine, /v1/organizations, /v1/experiment/variants, …). For a
// user gp-api has never seen, each of those independently asks Clerk's Backend
// API to resolve the identity so it can JIT-provision the row, and Clerk's
// per-instance budget answers 429 — which gp-api turns into a 401.
//
// The ticket is minted from the Clerk user id we already hold. Passing
// clerk.signIn an email instead makes it look the user up first, a second
// Backend API call against the shared rate budget for an id we never lost.
async function signInUser(page: Page, clerkUserId: string): Promise<void> {
  await setupClerkTestingToken({ page })
  await page.goto('/')
  await page.waitForFunction(() => window.Clerk?.loaded, null, {
    timeout: 15000,
  })

  const ticket = await mintSignInTicket(clerkUserId)
  await clerk.signIn({ page, signInParams: { strategy: 'ticket', ticket } })
  await page.waitForFunction(() => window.Clerk?.user !== null)
}

// Ordering contract: everything gp-api needs (user row, campaign) is created
// through the API client FIRST, and the browser is signed in LAST. Signing in
// earlier leaves a window where the browser holds a Clerk session for a user
// gp-api has never seen, and every request the app makes in that window races
// to JIT-provision the same identity through Clerk's Backend API. Do not move
// signInUser back up.
const bootstrapTestUser = async (
  page: Page,
  options?: TestUserOptions,
): Promise<BootstrappedUser> => {
  const election = options?.election ?? DEFAULT_ELECTION_PRESET
  if (election !== DEFAULT_ELECTION_PRESET && !options?.isolated) {
    throw new Error(
      `election: '${election}' needs isolated: true; the cached user is shared`,
    )
  }

  if (!options?.isolated && cachedUser) {
    // The user is cached per worker, but every test gets a fresh browser
    // context with no Clerk session. Without signing this page in, the
    // middleware's Clerk handshake bounces the first dashboard navigation to
    // /login, so only the first cached-user test on each worker was ever
    // authenticated. The user is already provisioned, so the ordering
    // contract below still holds.
    await signInUser(page, cachedUser.clerkUserId)
    return cachedUser
  }

  const result: BootstrappedUser = await createTestUser({
    product: 'win',
    race: options?.race,
    election,
    skipCampaignCreation: options?.skipCampaignCreation,
    ...(options?.user?.email && { email: options.user.email }),
  })

  if (process.env.DEBUG) {
    console.log(
      `[${test.info().title}] Created user ${result.user.email} ` +
        `(id: ${result.user.id}, clerk: ${result.clerkUserId}) ` +
        `campaign: ${result.campaignId ?? 'none'}`,
    )
  }

  if (!options?.isolated) {
    cachedUser = result
  }

  await signInUser(page, result.clerkUserId)

  return result
}

// biome-ignore lint/correctness/noEmptyPattern: Playwright forces us to use destructuring here.
test.afterAll(async ({}) => {
  cachedUser = null
})

export const authenticateTestUser = async (
  page: Page,
  options?: TestUserOptions,
) => {
  const { user, token, client, campaignId } = await bootstrapTestUser(
    page,
    options,
  )

  const cookies: PlaywrightCookie[] = [
    {
      name: 'token',
      value: token,
      domain: COOKIE_DOMAIN,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: 'user',
      value: JSON.stringify(user),
      domain: COOKIE_DOMAIN,
      path: '/',
      sameSite: 'Lax',
    },
    // The cookie notice floats above the dashboard's chat dock and intercepts
    // clicks on whatever page control sits under it. It reads this cookie
    // once on mount, so seeding it keeps the notice from ever rendering.
    {
      name: 'cookiesAccepted',
      value: 'true',
      domain: COOKIE_DOMAIN,
      path: '/',
      sameSite: 'Lax',
    },
  ]

  if (campaignId) {
    cookies.push({
      name: 'organization-slug',
      value: `campaign-${campaignId}`,
      domain: COOKIE_DOMAIN,
      path: '/',
      sameSite: 'Lax',
    })
  }
  await page.context().addCookies(cookies)

  return { user, client }
}
