import { expect, test } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'

// The Voter Outreach 2.0 hub is the unconditional outreach page: every
// candidate lands on the hub and every channel tile opens its new flow.
//
// The door-knocking tile's handoff into the native surface is pinned
// separately in dashboard-nav-door-knocking.spec.ts and
// outreach-list-to-door-knocking.spec.ts — this spec covers the rest of the
// hub contract.
test.describe('outreach hub — default-on channel tiles', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('renders with no overrides: heading + five channel tiles', async ({
    page,
  }) => {
    await authenticateTestUser(page)

    await page.goto('/dashboard/outreach')
    await expect(
      page.getByRole('heading', { name: 'Create an outreach campaign' }),
    ).toBeVisible({ timeout: 30_000 })

    for (const name of [
      /^Social media/,
      /^SMS/,
      /^Robocall/,
      /^Phone banking/,
      /^Door knocking/,
    ]) {
      await expect(page.getByRole('button', { name })).toBeVisible()
    }
  })

  test('social tile always opens the new SocialFlow, never the legacy TaskFlow', async ({
    page,
  }) => {
    await authenticateTestUser(page)

    await page.goto('/dashboard/outreach')
    await expect(
      page.getByRole('heading', { name: 'Create an outreach campaign' }),
    ).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /^Social media/ }).click()

    // Purpose-step card copy from socialPurposes.ts.
    await expect(
      page.getByRole('button', { name: 'Introduce myself' }),
    ).toBeVisible({ timeout: 15_000 })
    // The legacy TaskFlow's own first screen — never reached on this tile.
    await expect(
      page.getByRole('heading', { name: 'How this works' }),
    ).toHaveCount(0)
  })

  test('phone-banking tile, non-Pro: redirects to pro-upgrade', async ({
    page,
  }) => {
    await authenticateTestUser(page)

    await page.goto('/dashboard/outreach')
    // The tile ignores clicks while the elected-office query is pending —
    // wait for it to settle first, anchored on the Voter Data nav entry
    // (same technique as dashboard-nav-door-knocking.spec.ts).
    await expect(page.locator('#win-contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: /^Phone banking/ }).click()
    await page.waitForURL(/\/dashboard\/pro-upgrade/, { timeout: 30_000 })
  })

  test('phone-banking tile, Pro: opens PhoneBankingFlow', async ({ page }) => {
    test.setTimeout(3 * 60 * 1000)
    await setupProCampaignUser(page)

    await page.goto('/dashboard/outreach')
    await expect(page.locator('#win-contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: /^Phone banking/ }).click()
    // Purpose-step card copy from phoneBankingPurposes.ts.
    await expect(
      page.getByRole('button', { name: 'Write my own script' }),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('empty history table renders, proving the hub is the unconditional page', async ({
    page,
  }) => {
    // Isolated: this asserts zero rows, so it needs a campaign nothing else
    // in the suite has touched.
    await authenticateTestUser(page, { isolated: true })

    await page.goto('/dashboard/outreach')
    // The empty message is rendered twice (desktop table cell + mobile
    // card layout, toggled by CSS breakpoint) — scope to the table cell so
    // this doesn't hit a strict-mode ambiguity.
    await expect(
      page.getByRole('cell', {
        name: 'No campaigns yet. Pick a channel above to create your first.',
      }),
    ).toBeVisible({ timeout: 30_000 })
  })
})

// Non-Pro on purpose: `useTextOutreachGate.runTextGate` would open the legacy
// P2PUpgradeModal for a non-Pro click, so this pins that upgrade-at-entry
// beats the gate and the candidate reaches the wizard instead.
test.describe('outreach hub — sms tile upgrade-at-entry', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('non-Pro: Text tile redirects straight to pro-upgrade', async ({
    page,
  }) => {
    await authenticateTestUser(page)

    await page.goto('/dashboard/outreach')
    await expect(
      page.getByRole('heading', { name: 'Create an outreach campaign' }),
    ).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /^SMS/ }).click()

    await page.waitForURL(/\/dashboard\/pro-upgrade/, { timeout: 30_000 })
    // The legacy marketing modal must not be what a non-Pro click gets.
    await expect(
      page.getByRole('heading', { name: 'Level the playing field for less' }),
    ).toBeHidden()
  })
})
