import { expect, test } from '@playwright/test'
import { setupElectedOfficeUser } from 'src/helpers/organizations'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'

// Pins the invariant ENG-11003 introduced: the Serve left rail gates on
// elected-office existence alone (mirroring the server-side serveAccess()
// check), with no Amplitude flag anywhere in the path. Before that change,
// `serve-access` and `serve-community-issues-v1` could hide the Chief of
// Staff / Community Issues tabs from a legitimate elected official during an
// Amplitude outage or a misconfigured rollout — a regression that only a
// zero-override run like this one catches, since every other Serve spec
// forces its flags on via the override cookie and would mask exactly this
// bug. `DashboardMenu.test.tsx` covers the gating arithmetic in isolation;
// this spec pins that the rail a real candidate is served agrees with it.
test.describe('Serve nav renders without flag overrides', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('an elected office sees the complete Serve rail with no overrides', async ({
    page,
  }) => {
    // TODO(ENG-11004 task 04 — serve-ordinances removal): the Ordinances tab
    // is still gated behind serve-ordinances, which hasn't been retired yet.
    // Force it on so this spec can assert the full rail today; drop this
    // override once that task lands and the tab is unconditional.
    await setFlagOverrides(page, { 'serve-ordinances': 'on' })

    await setupElectedOfficeUser(page)
    await page.goto('/dashboard/chief-of-staff', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    // Anchor on the Contacts slot first: it only resolves to the
    // elected-office item once `useElectedOffice` settles, so waiting on it
    // before asserting the rest of the rail avoids a false read against a
    // not-yet-settled render.
    await expect(page.locator('#contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })

    await expect(page.locator('#chief-of-staff-dashboard')).toBeVisible()
    await expect(page.locator('#community-issues-dashboard')).toBeVisible()
    await expect(page.locator('#briefings-dashboard')).toBeVisible()
    await expect(page.locator('#ordinances-dashboard')).toBeVisible()
    await expect(page.locator('#public-profile-dashboard')).toBeVisible()
  })

  test('the Community Issues tab navigates to the Community Issues page', async ({
    page,
  }) => {
    await setupElectedOfficeUser(page)
    await page.goto('/dashboard/chief-of-staff', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    await expect(page.locator('#contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })

    await page.locator('#community-issues-dashboard').click()
    await page.waitForURL(/\/dashboard\/community-issues/, {
      timeout: 15_000,
    })
    // Deep page behavior (seeded issues, prioritize, chat) is covered by
    // tests/app/community-issues/community-issues.spec.ts — this only proves
    // the nav link lands on the right page.
    await expect(
      page.getByRole('heading', { level: 1, name: 'Community Issues' }),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('a Win candidate sees no Serve tabs', async ({ page }) => {
    await authenticateTestUser(page)
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    // Settle guard: the Win Contacts slot only commits once the same
    // elected-office query the Serve items gate on has settled, so asserting
    // absence before it settles would pass against a stale render too.
    await expect(page.locator('#win-contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })

    await expect(page.locator('#chief-of-staff-dashboard')).toHaveCount(0)
    await expect(page.locator('#community-issues-dashboard')).toHaveCount(0)
  })
})
