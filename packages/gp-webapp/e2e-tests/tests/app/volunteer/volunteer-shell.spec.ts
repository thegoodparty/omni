import { expect, test, type Page } from '@playwright/test'
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { clerkThrottle } from 'tests/utils/throttle-requests-with-retry'
import { createHeadlessTestUser } from 'tests/utils/headless-user'

// win-team-accounts (ENG-10816/ENG-11044 Phase 1.5). This covers the
// /volunteer shell (app/volunteer/VolunteerSidebar.tsx, AssignmentsPage.tsx,
// AssignmentCard.tsx) and the post-auth routing that lands a volunteer there
// instead of candidate onboarding — none of it had e2e coverage before,
// only unit tests, because the shell's own gate
// (activeOrgVolunteer.server.ts) resolves entirely server-side off the
// viewer's real active-org role. That can't be faked with a page.route
// stub, so every test here seeds a REAL volunteer membership through the
// API first (the same direct-add path team-page.spec.ts's invite drawer
// exercises from the manager side) and only stubs the volunteer's own
// client-side assignments fetch.
//
// The flag is 100% by default, so no test here should need the override
// cookie for gp-api's own server-side flag check (the invite endpoint) —
// but the webapp's SSR reads of the SAME flag (the shell's own gate, the
// post-auth redirect) still go through `setFlagOverrides` as a deterministic
// belt-and-suspenders in case CI's Amplitude evaluation lags the 100%
// rollout. It becomes inert, not broken, once the win-team-accounts
// flag-removal PR lands, and can be dropped then.

const baseURL = process.env.BASE_URL
if (!baseURL) {
  throw new Error('BASE_URL is not set')
}
const COOKIE_DOMAIN =
  baseURL.replace('http://', '').replace('https://', '').split('/')[0] ?? ''

// Mirrors api-registration.ts's private signInUser — duplicated locally
// rather than exported from that shared file, since a parallel PR is
// rewriting its two existing specs and this file may only add new specs.
const signInAsExistingUser = async (
  page: Page,
  email: string,
): Promise<void> => {
  await setupClerkTestingToken({ page })
  await page.goto('/')
  await page.waitForFunction(() => window.Clerk?.loaded, null, {
    timeout: 15_000,
  })
  await clerkThrottle(() => clerk.signIn({ page, emailAddress: email }), 5)
}

type HeadlessOwner = Awaited<ReturnType<typeof createHeadlessTestUser>>

// A real win campaign (the owner) plus a real account with no campaign of
// its own (the volunteer-to-be), joined by a direct-add invite: the target
// email already has an account, so organizationTeam.service.ts's
// addExistingUserAsMember path creates the OrganizationMembership row
// synchronously — no Clerk ticket, no waiting.
const seedVolunteer = async (): Promise<{
  owner: HeadlessOwner
  volunteer: HeadlessOwner
}> => {
  const owner = await createHeadlessTestUser({ product: 'win' })
  const volunteer = await createHeadlessTestUser({
    product: 'win',
    skipCampaignCreation: true,
  })
  await owner.client.post('/v1/organizations/team/invites', {
    name: volunteer.user.name,
    email: volunteer.user.email,
    role: 'volunteer',
  })
  return { owner, volunteer }
}

const stubEmptyAssignments = (page: Page) =>
  page.route(/\/api\/v1\/outreach\/assignments\/mine(\?|$)/, (route) => {
    if (route.request().method() !== 'GET') {
      return route.continue()
    }
    return route.fulfill({ json: { assignments: [] } })
  })

test.describe('Volunteer post-auth routing', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('a volunteer-role user is routed to /volunteer after sign-in, not candidate onboarding', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)
    const { volunteer } = await seedVolunteer()

    await setFlagOverrides(page, { 'win-team-accounts': 'on' })
    await signInAsExistingUser(page, volunteer.user.email)

    // /post-auth-redirect is exactly where <SignIn fallbackRedirectUrl>
    // sends a real login (app/login/page.tsx) — driving it directly
    // exercises ENG-11071's volunteer branch without needing the full
    // /login form.
    await page.goto('/post-auth-redirect', { waitUntil: 'domcontentloaded' })
    await page.waitForURL((url) => url.pathname === '/volunteer', {
      timeout: 30_000,
    })
  })
})

test.describe('Volunteer shell', () => {
  // Same Serwist service-worker gotcha as team-page.spec.ts: block it so the
  // stub below intercepts deterministically instead of the SW's runtime cache.
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('renders the sidebar and the assignments zero-state for a single-campaign volunteer', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)
    const { volunteer } = await seedVolunteer()

    await setFlagOverrides(page, { 'win-team-accounts': 'on' })
    await signInAsExistingUser(page, volunteer.user.email)
    await stubEmptyAssignments(page)

    await page.goto('/volunteer', { waitUntil: 'domcontentloaded' })

    await expect(
      page.getByText(`${volunteer.user.firstName} ${volunteer.user.lastName}`),
    ).toBeVisible({ timeout: 30_000 })

    // A volunteer who only holds this one campaign gets no switch-campaign
    // affordance in the sidebar footer (VolunteerSidebar's canSwitchCampaigns).
    await expect(
      page.getByRole('button', { name: 'Switch campaign' }),
    ).toHaveCount(0)

    await expect(
      page.getByRole('heading', { name: 'Your assignments' }),
    ).toBeVisible()
    await expect(
      page.getByText(/^You have 0 assignments from .+\.$/),
    ).toBeVisible()
    await expect(
      page.getByText(/You do not have any assignments yet\./),
    ).toBeVisible()

    await expect(
      page.getByRole('button', { name: 'Leave campaign' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible()
  })

  test('renders channel-appropriate CTAs and progress for phone banking and door knocking assignments', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)
    const { volunteer } = await seedVolunteer()

    await setFlagOverrides(page, { 'win-team-accounts': 'on' })
    await signInAsExistingUser(page, volunteer.user.email)

    await page.route(
      /\/api\/v1\/outreach\/assignments\/mine(\?|$)/,
      (route) => {
        if (route.request().method() !== 'GET') {
          return route.continue()
        }
        return route.fulfill({
          json: {
            assignments: [
              {
                outreachId: 1,
                outreachType: 'nativePhoneBanking',
                name: 'Ward 1 calls',
                status: 'paid',
                assignedAt: '2026-01-01T00:00:00.000Z',
                phoneBanking: { listId: 10, peopleCalled: 0, peopleTotal: 25 },
              },
              {
                outreachId: 2,
                outreachType: 'nativeDoorKnocking',
                name: 'Ward 1 walk',
                status: 'in_progress',
                assignedAt: '2026-01-01T00:00:00.000Z',
                doorKnocking: { turfId: 20, loggedCount: 4, peopleCount: 12 },
              },
            ],
          },
        })
      },
    )

    await page.goto('/volunteer', { waitUntil: 'domcontentloaded' })

    // Zero logged progress gets the entry-point label ("Call this list");
    // door knocking already under way gets the resume label ("Continue
    // knocking") — AssignmentCard.tsx's resolveAction is what this fixture
    // pair exercises.
    await expect(page.getByText('Ward 1 calls')).toBeVisible({
      timeout: 30_000,
    })
    const callLink = page.getByRole('link', { name: 'Call this list' })
    await expect(callLink).toHaveAttribute(
      'href',
      '/volunteer/phone-banking/10',
    )
    await expect(page.getByText('0 of 25 people reached')).toBeVisible()

    await expect(page.getByText('Ward 1 walk')).toBeVisible()
    const knockLink = page.getByRole('link', { name: 'Continue knocking' })
    await expect(knockLink).toHaveAttribute(
      'href',
      '/volunteer/door-knocking/20',
    )
    await expect(page.getByText('4 of 12 people logged')).toBeVisible()

    // Subtext count + logged-contacts line: 2 assignments, 0 + 4 = 4 logged
    // contacts (AssignmentsPage.tsx sums phoneBanking.peopleCalled and
    // doorKnocking.loggedCount).
    await expect(
      page.getByText(
        /^You have 2 assignments from .+\. You have logged 4 contacts\.$/,
      ),
    ).toBeVisible()
  })
})

test.describe('Volunteer campaign switcher', () => {
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('a multi-campaign volunteer can switch their active org from the sidebar', async ({
    page,
  }) => {
    test.setTimeout(4 * 60 * 1000)
    const ownerA = await createHeadlessTestUser({ product: 'win' })
    const ownerB = await createHeadlessTestUser({ product: 'win' })
    const volunteer = await createHeadlessTestUser({
      product: 'win',
      skipCampaignCreation: true,
    })
    await ownerA.client.post('/v1/organizations/team/invites', {
      name: volunteer.user.name,
      email: volunteer.user.email,
      role: 'volunteer',
    })
    await ownerB.client.post('/v1/organizations/team/invites', {
      name: volunteer.user.name,
      email: volunteer.user.email,
      role: 'volunteer',
    })

    await setFlagOverrides(page, { 'win-team-accounts': 'on' })
    await signInAsExistingUser(page, volunteer.user.email)

    // Pin the active org to A before the first render, so clicking B in the
    // switcher below is a real onValueChange, not a reselect of whatever
    // GET /v1/organizations happened to sort first.
    await page.context().addCookies([
      {
        name: 'organization-slug',
        value: ownerA.orgSlug!,
        domain: COOKIE_DOMAIN,
        path: '/',
        sameSite: 'Lax',
      },
    ])
    await stubEmptyAssignments(page)

    await page.goto('/volunteer', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: 'Switch campaign' }).click()
    await expect(page.getByText(ownerA.user.name, { exact: true })).toBeVisible(
      { timeout: 30_000 },
    )
    await expect(
      page.getByText(ownerB.user.name, { exact: true }),
    ).toBeVisible()

    await page.getByText(ownerB.user.name, { exact: true }).click()

    // The durable signal is the org-slug cookie VolunteerSidebar's
    // handleOrgSelect writes via setOrganizationSlug — visible org-name text
    // can collide when both campaigns resolve to the same default race.
    await expect
      .poll(
        async () => {
          const cookies = await page.context().cookies()
          return cookies.find((cookie) => cookie.name === 'organization-slug')
            ?.value
        },
        { timeout: 15_000 },
      )
      .toBe(ownerB.orgSlug)
  })
})
