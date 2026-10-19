import { expect, test } from '@playwright/test'
import { addDays, format } from 'date-fns'
import { authenticateTestUser } from 'tests/utils/api-registration'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'

// The SMS tile is disabled once the general election is inside the texting
// cutoff (19 days). The shared test candidate's election date is real, so the
// SMS tests move an isolated candidate's election safely out of the window
// instead of depending on the calendar. The non-Pro phone-banking tests use it
// too: they wait on the signed-in nav, and the shared candidate is only signed
// in for the first test in a worker that creates it, so a later one in the
// same worker lands on the sign-in page.
const authenticateOutsideSmsCutoff = async (
  page: Parameters<typeof authenticateTestUser>[0],
) => {
  const { client } = await authenticateTestUser(page, { isolated: true })
  await client.put('/v1/campaigns/mine', {
    details: { electionDate: format(addDays(new Date(), 90), 'yyyy-MM-dd') },
  })
}

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
      page.getByRole('heading', { name: 'Create a campaign' }),
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
      page.getByRole('heading', { name: 'Create a campaign' }),
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

// A non-Pro click opens the flow instead of leaving the hub, and the shell's
// banner (GateBanner, copy from gateCopy.ts BANNER_COPY)
// says what is still needed. The banner is a button because it opens the
// explainer.
test.describe('outreach hub — in-flow gate', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('phone-banking tile, non-Pro: opens the flow with the Pro banner', async ({
    page,
  }) => {
    await authenticateOutsideSmsCutoff(page)

    await page.goto('/dashboard/outreach')
    await expect(page.locator('#win-contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: /^Phone banking/ }).click()

    await expect(
      page.getByRole('button', {
        name: /Pro is needed to see voter names and phone numbers/,
      }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page).not.toHaveURL(/\/dashboard\/pro-upgrade/)
  })

  test('Text tile, non-Pro: opens the flow with the two-step banner', async ({
    page,
  }) => {
    await authenticateOutsideSmsCutoff(page)

    await page.goto('/dashboard/outreach')
    await expect(
      page.getByRole('heading', { name: 'Create a campaign' }),
    ).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: /^SMS/ }).click()

    // A fresh campaign is free and unverified, so texting needs both.
    await expect(
      page.getByRole('button', {
        name: /Two things are needed before this text can send/,
      }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page).not.toHaveURL(/\/dashboard\/pro-upgrade/)
  })
})
