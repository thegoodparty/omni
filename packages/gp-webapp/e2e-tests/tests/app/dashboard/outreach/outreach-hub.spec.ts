import { expect, test } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'

// The Voter Outreach 2.0 hub is the unconditional outreach page (ENG-11007
// removed voter-outreach-v2/-social/-phone-banking, all at 100% prod default
// since Aug 27-28): every candidate lands on the hub, and the social and
// phone-banking tiles always use their new flows. Robocall and SMS are still
// dark (voter-outreach-v2-robocall/-sms) and keep their own tile-swap gating.
//
// The door-knocking tile's handoff into the native surface is pinned
// separately in dashboard-nav-door-knocking.spec.ts and
// outreach-list-to-door-knocking.spec.ts — this spec covers the rest of the
// hub contract and, in its own describe block, regression-guards that the
// surviving dark swaps still gate.
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

// Regression guard: task 06 (ENG-11007) removed voter-outreach-v2/-social/
// -phone-banking but must not have disturbed the surviving dark swaps.
//
// Non-Pro on purpose: `useTextOutreachGate.runTextGate` opens the legacy
// P2PUpgradeModal for a non-Pro click before it would ever reach a 10DLC
// compliance check, so this is the cleanest way to observe the flag's two
// arms without provisioning TCR-approved compliance in a Pro campaign.
test.describe('outreach hub — sms tile is still flag-controlled (dark flag)', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('voter-outreach-v2-sms off: Text tile shows the legacy upgrade modal', async ({
    page,
  }) => {
    // setFlagOverrides REPLACES the whole cookie, so this is the only key —
    // before auth and navigation, so the first SSR render already sees it.
    await setFlagOverrides(page, { 'voter-outreach-v2-sms': 'off' })
    await authenticateTestUser(page)

    await page.goto('/dashboard/outreach')
    await expect(
      page.getByRole('heading', { name: 'Create an outreach campaign' }),
    ).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /^SMS/ }).click()

    // P2PUpgradeModal's NonProUpgrade variant copy.
    await expect(
      page.getByRole('heading', { name: 'Level the playing field for less' }),
    ).toBeVisible({ timeout: 15_000 })
    expect(page.url()).not.toMatch(/\/dashboard\/pro-upgrade/)
  })

  test('voter-outreach-v2-sms on: Text tile redirects straight to pro-upgrade', async ({
    page,
  }) => {
    await setFlagOverrides(page, { 'voter-outreach-v2-sms': 'on' })
    await authenticateTestUser(page)

    await page.goto('/dashboard/outreach')
    await expect(
      page.getByRole('heading', { name: 'Create an outreach campaign' }),
    ).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /^SMS/ }).click()

    // Upgrade-at-entry: on, a non-Pro click skips the legacy modal entirely.
    await page.waitForURL(/\/dashboard\/pro-upgrade/, { timeout: 30_000 })
  })
})
