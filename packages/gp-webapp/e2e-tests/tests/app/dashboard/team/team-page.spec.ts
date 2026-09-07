import { expect, test, type Page } from '@playwright/test'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'

// win-team-accounts (ENG-10816/10827). The flag gates only the Team
// account-menu item (ENG-11061 moved it out of the primary nav) and the
// /dashboard/team route itself (FeatureFlagGuard) — GET
// /v1/organizations/team is otherwise ungated server-side (only invite
// creation is), so a real dev backend answers it once the route is reached.
test.describe('Team page — flag off', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('no account-menu item, and a direct visit to /dashboard/team redirects away', async ({
    page,
  }) => {
    test.setTimeout(2 * 60 * 1000)
    await setFlagOverrides(page, { 'win-team-accounts': 'off' })
    await authenticateTestUser(page)

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    // Settle guard: the Win Contacts slot resolves once the elected-office
    // query settles, and the Team item's own visibility depends on nothing
    // else — waiting on this sibling item is what makes the absence
    // assertion below meaningful rather than a race against an unsettled menu.
    await expect(page.locator('#win-contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })
    await page.getByText('Manage account').click()
    // Anchor on an unconditional dropdown item first: with the Radix content
    // closed, #nav-dash-team is never mounted and toHaveCount(0) would pass
    // vacuously even if the menu failed to open.
    await expect(page.locator('#nav-dash-profile')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.locator('#nav-dash-team')).toHaveCount(0)

    await page.goto('/dashboard/team', { waitUntil: 'domcontentloaded' })
    await page.waitForURL((url) => url.pathname === '/dashboard', {
      timeout: 30_000,
    })
  })
})

// Fixture member shared by every test in "flag forced on" — the single
// source for its userId, so the stats fixtures below stay pinned to the
// member they describe instead of a magic number repeated per test.
const FIXTURE_MEMBER = {
  userId: 1,
  name: 'Test Owner',
  email: 'owner@test.goodparty.org',
  role: 'owner',
  createdAt: '2024-01-01T00:00:00.000Z',
}

test.describe('Team page — flag forced on', () => {
  // The production build's Serwist service worker intercepts same-origin GETs
  // matched by its runtime caching before page.route ever sees them
  // (documented Playwright limitation, see crm-assistant-bar.spec.ts) — block
  // it so the team-list stub below intercepts deterministically.
  test.use({ serviceWorkers: 'block' })

  const stubTeamMembers = (page: Page) =>
    page.route(/\/api\/v1\/organizations\/team(\?|$)/, (route) => {
      if (route.request().method() !== 'GET') {
        return route.continue()
      }
      return route.fulfill({
        json: {
          members: [FIXTURE_MEMBER],
          pendingInvites: [],
        },
      })
    })

  test('the account-menu item renders, the page loads the member list, and the invite drawer opens', async ({
    page,
  }) => {
    test.setTimeout(2 * 60 * 1000)
    await setFlagOverrides(page, { 'win-team-accounts': 'on' })
    await authenticateTestUser(page)

    await stubTeamMembers(page)

    // ENG-11080/ENG-11082: the team page's stats query is a separate request
    // the above regex doesn't intercept (it only matches .../team itself,
    // not .../team/stats) — stub it too so the spec stays deterministic
    // instead of hitting a live stats endpoint. A zero-filled row (rather
    // than an empty stats array) matches how the real API responds — it
    // zero-fills every member instead of omitting rows with no activity —
    // so the zero-state assertions below exercise the same code path
    // production takes, not just the `stats?.x ?? 0` fallback for a member
    // absent from the response.
    await page.route(/\/api\/v1\/organizations\/team\/stats(\?|$)/, (route) => {
      if (route.request().method() !== 'GET') {
        return route.continue()
      }
      return route.fulfill({
        json: {
          stats: [
            {
              userId: FIXTURE_MEMBER.userId,
              doorsKnocked: 0,
              callsMade: 0,
              totalLogged: 0,
              lastActivityAt: null,
            },
          ],
        },
      })
    })

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    // Same settle guard as the flag-off spec: wait for a sibling nav item to
    // resolve before opening the account menu and looking for Team.
    await expect(page.locator('#win-contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })
    await page.getByText('Manage account').click()
    await expect(page.locator('#nav-dash-team')).toBeVisible({
      timeout: 30_000,
    })
    await page.locator('#nav-dash-team').click()
    await page.waitForURL(/\/dashboard\/team/, { timeout: 30_000 })

    await expect(page.getByText('1 person on this campaign')).toBeVisible({
      timeout: 30_000,
    })

    // ENG-11080 results columns (ENG-11082 coverage): headers render, and
    // the fixture member's zero-filled stats row renders 0 / 0 / 0 / — .
    await expect(page.getByTestId('team-stat-header-doors')).toHaveText('Doors')
    await expect(page.getByTestId('team-stat-header-calls')).toHaveText('Calls')
    await expect(page.getByTestId('team-stat-header-total')).toHaveText('Total')
    await expect(page.getByTestId('team-stat-header-last-active')).toHaveText(
      'Last active',
    )

    await expect(page.getByTestId('team-stat-doors')).toHaveText('0')
    await expect(page.getByTestId('team-stat-calls')).toHaveText('0')
    await expect(page.getByTestId('team-stat-total')).toHaveText('0')
    await expect(page.getByTestId('team-stat-last-active')).toHaveText('—')

    await page.getByRole('button', { name: 'Invite' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Who do you want to invite?' }),
    ).toBeVisible()
    await expect(page.getByLabel('Name')).toBeVisible()
    await expect(page.getByLabel('Phone number')).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
  })

  // ENG-11082: a stats failure must never take down member management — the
  // stats query is independent of the members query (ENG-11080's
  // isStatsError branch), so the members table and its primary action
  // (Invite) must survive a 500 on /team/stats untouched.
  test('a stats 500 leaves the member list and Invite button intact', async ({
    page,
  }) => {
    test.setTimeout(2 * 60 * 1000)
    await setFlagOverrides(page, { 'win-team-accounts': 'on' })
    await authenticateTestUser(page)

    await stubTeamMembers(page)

    await page.route(/\/api\/v1\/organizations\/team\/stats(\?|$)/, (route) => {
      if (route.request().method() !== 'GET') {
        return route.continue()
      }
      return route.fulfill({
        status: 500,
        json: { message: 'Internal server error' },
      })
    })

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    await expect(page.locator('#win-contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })
    await page.getByText('Manage account').click()
    await expect(page.locator('#nav-dash-team')).toBeVisible({
      timeout: 30_000,
    })
    await page.locator('#nav-dash-team').click()
    await page.waitForURL(/\/dashboard\/team/, { timeout: 30_000 })

    await expect(page.getByText('1 person on this campaign')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText(FIXTURE_MEMBER.email)).toBeVisible()

    await expect(page.getByTestId('team-stat-doors')).toHaveText('—')
    await expect(page.getByTestId('team-stat-calls')).toHaveText('—')
    await expect(page.getByTestId('team-stat-total')).toHaveText('—')
    await expect(page.getByTestId('team-stat-last-active')).toHaveText('—')

    await expect(page.getByRole('button', { name: 'Invite' })).toBeEnabled()
  })
})
