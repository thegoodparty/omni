import { expect, test, type Page } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import { NavigationHelper } from 'src/helpers/navigation.helper'

// Fixture member shared by every test below — the single source for its
// userId, so the stats fixtures stay pinned to the member they describe
// instead of a magic number repeated per test.
const FIXTURE_MEMBER = {
  userId: 1,
  name: 'Test Owner',
  email: 'owner@test.goodparty.org',
  role: 'owner',
  createdAt: '2024-01-01T00:00:00.000Z',
}

test.describe('Team page', () => {
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

    // Settle guard: wait for a sibling nav item to resolve before opening
    // the account menu and looking for Team.
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
      page.getByRole('dialog', { name: 'Invite someone' }),
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
