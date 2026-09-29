import { expect, test } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { waitForDashboardReady } from 'src/helpers/dashboard'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'

// Scoped to non-Pro (read-only cached user, no paid user minted); the
// Pro/banner-hidden inverse is asserted in the Pro happy-path spec, per
// ENG-10478.
// The legacy wizard these specs assert only renders while
// outreach-pro-gating-v2 is off — pinned here so the suite reads the same
// whatever the flag's live dev rollout is (the 2026-09-28 dev ramp turned
// every PR's shard red when these ran against the v2 purchase-only flow).
// The v2 flow needs its own specs pinned on; tracked as follow-up.
test.beforeEach(async ({ page }) => {
  await setFlagOverrides(page, { 'outreach-pro-gating-v2': 'off' })
})

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
