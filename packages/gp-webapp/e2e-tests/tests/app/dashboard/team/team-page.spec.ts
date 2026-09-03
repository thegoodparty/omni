import { expect, test } from '@playwright/test'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'

// win-team-accounts (ENG-10816/10827). The flag gates only the Team nav item
// and the /dashboard/team route itself (FeatureFlagGuard) — GET
// /v1/organizations/team is otherwise ungated server-side (only invite
// creation is), so a real dev backend answers it once the route is reached.
test.describe('Team page — flag off', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('no nav item, and a direct visit to /dashboard/team redirects away', async ({
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
    await expect(page.locator('#team-dashboard')).toHaveCount(0)

    await page.goto('/dashboard/team', { waitUntil: 'domcontentloaded' })
    await page.waitForURL((url) => url.pathname === '/dashboard', {
      timeout: 30_000,
    })
  })
})

test.describe('Team page — flag forced on', () => {
  // The production build's Serwist service worker intercepts same-origin GETs
  // matched by its runtime caching before page.route ever sees them
  // (documented Playwright limitation, see crm-assistant-bar.spec.ts) — block
  // it so the team-list stub below intercepts deterministically.
  test.use({ serviceWorkers: 'block' })

  test('the nav item renders, the page loads the member list, and the invite modal opens', async ({
    page,
  }) => {
    test.setTimeout(2 * 60 * 1000)
    await setFlagOverrides(page, { 'win-team-accounts': 'on' })
    await authenticateTestUser(page)

    await page.route(/\/api\/v1\/organizations\/team(\?|$)/, (route) => {
      if (route.request().method() !== 'GET') {
        return route.continue()
      }
      return route.fulfill({
        json: {
          members: [
            {
              userId: 1,
              name: 'Test Owner',
              email: 'owner@test.goodparty.org',
              role: 'owner',
              createdAt: '2024-01-01T00:00:00.000Z',
            },
          ],
          pendingInvites: [],
        },
      })
    })

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    await expect(page.locator('#team-dashboard')).toBeVisible({
      timeout: 30_000,
    })
    await page.locator('#team-dashboard').click()
    await page.waitForURL(/\/dashboard\/team/, { timeout: 30_000 })

    await expect(page.getByText('1 person on this campaign')).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: 'Invite' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Invite a team member' }),
    ).toBeVisible()
    await expect(page.getByLabel('Name')).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
  })
})
