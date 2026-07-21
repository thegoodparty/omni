import { expect, test } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { waitForDashboardReady } from 'src/helpers/dashboard'

// Scoped to non-Pro (read-only cached user, no paid user minted); the
// Pro/banner-hidden inverse is asserted in the Pro happy-path spec, per
// ENG-10478.
test.describe('Pro upgrade dashboard entry (non-Pro)', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('shows the Get Pro banner and routes locked items into the wizard', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await authenticateTestUser(page)

    await page.goto('/dashboard')
    await page.waitForURL(/\/dashboard/)
    await NavigationHelper.dismissOverlays(page)
    await waitForDashboardReady(page)

    // Banner is the non-Pro dashboard entry point into the wizard.
    await expect(
      page.getByText('76% of candidates who use Pro win'),
    ).toBeVisible()

    // Voter Data routing: a non-Pro Win campaign's "Voter Data" sidebar link
    // targets the Contacts page — the district-aggregate upsell surface
    // (ENG-10495) — not the wizard index. Assert the href (stable route)
    // rather than the lock icon (less stable than the route).
    await expect(
      page.getByRole('link', { name: 'Voter Data' }),
    ).toHaveAttribute('href', '/dashboard/contacts')

    // Get Pro opens the wizard, which re-derives the resume step and lands a
    // zero-progress non-Pro candidate on the value-prop intro.
    await page.getByRole('button', { name: 'Get Pro' }).click()
    await page.waitForURL(/\/dashboard\/pro-upgrade\/value-prop/)
    await expect(page).toHaveURL(/\/dashboard\/pro-upgrade\/value-prop$/)
  })
})
