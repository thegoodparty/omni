import { expect, test } from '@playwright/test'
import { setupElectedOfficeUser } from 'src/helpers/organizations'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'

// serve-outreach reached 100% and was removed: the Constituent Outreach tab
// and its hub are now gated on elected-office existence alone — the nav item
// on `isElectedOffice`, the route on the server-side `serveAccess()` call.
// These run with ZERO flag overrides, which is the point: while the flag was
// dark, an override cookie was the only way to reach this surface, so nothing
// covered what a real elected official is actually served. The last case is
// the access regression guard — removing the client-side FeatureFlagGuard
// leaves `serveAccess()` as the only thing keeping a Win candidate off the
// route.
test.describe('Constituent Outreach hub — no flag overrides', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('the Serve rail carries the tab and it lands on the hub', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    await setupElectedOfficeUser(page)
    await page.goto('/dashboard/chief-of-staff', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    // Anchor on the Contacts slot: it only resolves to the elected-office
    // item once `useElectedOffice` settles, and every other Serve item —
    // including this one — gates on the same query. Same settle guard as
    // serve-nav.spec.ts.
    await expect(page.locator('#contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })

    await page.locator('#constituent-outreach-dashboard').click()
    await page.waitForURL(/\/dashboard\/constituent-outreach/, {
      timeout: 30_000,
    })

    await expect(
      page.getByRole('heading', { name: 'Outreach channels' }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByRole('button', { name: 'Social media' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Phone banking' }),
    ).toBeVisible()
    // Door knocking has a card here since 3.0, which is the change: it used to
    // get none at all (rather than a disabled one) because it had no serve
    // wiring. It now has both halves it was missing — a Serve outreach row and
    // a turf a Serve org can own — so the card is live. Unlike the two above it
    // navigates instead of opening a flow in place (`/dashboard/door-knocking
    // ?create=1`, the map is its own page), and that push is asserted in
    // ConstituentOutreachPage.test.tsx rather than here: following it would
    // take the district voter pack as a dependency of this spec, and the hub is
    // what this test is about.
    await expect(
      page.getByRole('button', { name: 'Door knocking' }),
    ).toBeVisible()

    // setupElectedOfficeUser provisions an isolated user, so this org's
    // history is genuinely empty. The empty copy renders twice (desktop table
    // + mobile card list, toggled by CSS), so scope to the table cell.
    await expect(
      page.getByRole('cell', {
        name: 'No campaigns yet. Pick a channel above to create your first.',
      }),
    ).toBeVisible({ timeout: 30_000 })
  })

  test('the Social media card opens the serve social flow', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    await setupElectedOfficeUser(page)
    await page.goto('/dashboard/constituent-outreach', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    await page.getByRole('button', { name: 'Social media' }).click()

    // Purpose-step copy from serveSocialPurposes.ts. "Explain a recent
    // decision" exists only in the serve vocabulary and "Persuade likely
    // voters" only in Win's (socialPurposes.ts), so the pair proves
    // SERVE_SOCIAL_SURFACE — not Win's default — is what this hub mounts.
    await expect(
      page.getByRole('button', { name: 'Explain a recent decision' }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByRole('button', { name: 'Persuade likely voters' }),
    ).toHaveCount(0)
  })

  test('the Phone banking card opens the serve phone banking flow', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    await setupElectedOfficeUser(page)
    await page.goto('/dashboard/constituent-outreach', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    await page.getByRole('button', { name: 'Phone banking' }).click()

    // Purpose-step copy from servePhoneBankingPurposes.ts. Serve has NO Pro
    // gate on this channel — the ElectedOffice row is the entitlement — so
    // unlike Win's tile this reaches the purpose step directly, never
    // /dashboard/pro-upgrade.
    await expect(
      page.getByRole('button', { name: 'Introduce myself to constituents' }),
    ).toBeVisible({ timeout: 30_000 })
    expect(page.url()).not.toMatch(/\/dashboard\/pro-upgrade/)
  })

  test('a Win candidate has no tab and is bounced off the route', async ({
    page,
  }) => {
    await authenticateTestUser(page)
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    // Settle guard: the Win Contacts slot only commits once the same
    // elected-office query the Serve items gate on has settled, so asserting
    // absence before it settles would pass against a stale render too.
    await expect(page.locator('#win-contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator('#constituent-outreach-dashboard')).toHaveCount(0)

    await page.goto('/dashboard/constituent-outreach', {
      waitUntil: 'domcontentloaded',
    })
    await page.waitForURL((url) => url.pathname === '/dashboard', {
      timeout: 30_000,
    })
  })
})
