import { expect, test } from '@playwright/test'
import { addDays, format } from 'date-fns'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'

// Purchase-only (outreach-pro-gating-v2) wizard for a free candidate whose
// general election is inside the SMS compliance cutoff (19 days). gp-api
// reports the window closed, so the wizard skips the filing steps and goes
// guidance, then payment. It stops on the payment screen without paying, so
// it needs no Stripe and runs on every PR preview. Isolated: it moves the
// campaign's election date.

const PRO_UPGRADE_PATH = '/dashboard/pro-upgrade'

test.beforeEach(async ({ page }) => {
  await setFlagOverrides(page, { 'outreach-pro-gating-v2': 'on' })
})

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test('skips the filing steps once texting has closed for the race', async ({
  page,
}) => {
  const { client } = await authenticateTestUser(page, { isolated: true })
  await client.put('/v1/campaigns/mine', {
    details: { electionDate: format(addDays(new Date(), 10), 'yyyy-MM-dd') },
  })

  const visited: string[] = []
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url())
  })

  await page.goto(PRO_UPGRADE_PATH)
  await NavigationHelper.dismissOverlays(page)
  await page.waitForURL(`**${PRO_UPGRADE_PATH}/guidance`, { timeout: 60_000 })

  await expect(
    page.getByRole('heading', { name: "Here's what you need to unlock Pro" }),
  ).toBeVisible()
  await expect(
    page.getByText("Texting isn't available for this race"),
  ).toBeVisible()
  // Payment is the one thing left to gather.
  await expect(page.getByText('Payment', { exact: true })).toBeVisible()
  for (const row of [
    'Your campaign EIN',
    'Your filing details',
    'Contact details',
    'About 1 to 2 weeks',
  ]) {
    await expect(page.getByText(row, { exact: true })).toHaveCount(0)
  }

  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL(`**${PRO_UPGRADE_PATH}/payment`)
  await expect(
    page.getByRole('heading', { name: 'Complete your upgrade' }),
  ).toBeVisible()
  // Nothing to verify once texting has closed, so no verification line.
  await expect(page.getByText(/Verification starts when you pay/)).toHaveCount(
    0,
  )

  for (const step of ['status', 'ein', 'filing-details']) {
    expect(
      visited.some((url) => url.includes(`${PRO_UPGRADE_PATH}/${step}`)),
    ).toBe(false)
  }
  await expect(
    page.getByRole('heading', {
      name: 'What are your campaign filing details?',
    }),
  ).toHaveCount(0)
})
