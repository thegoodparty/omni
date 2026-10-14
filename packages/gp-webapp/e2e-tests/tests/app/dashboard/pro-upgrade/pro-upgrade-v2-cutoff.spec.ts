import { expect, test } from '@playwright/test'
import { addDays, format } from 'date-fns'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  SEED_VALID_EIN,
  seedFilingComplete,
} from 'src/helpers/pro-upgrade.helper'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'

// Purchase-only (outreach-pro-gating-v2) wizard for a free candidate whose
// general election is inside the SMS compliance cutoff (19 days). gp-api
// reports the window closed but still saves filing details, so the wizard
// keeps every step: guidance explains the cutoff before purchase, and the
// candidate walks status, EIN and filing details to payment. It stops on the
// payment screen without paying, so it needs no Stripe and runs on every PR
// preview. Isolated: it moves the campaign's election date.

const PRO_UPGRADE_PATH = '/dashboard/pro-upgrade'

test.beforeEach(async ({ page }) => {
  await setFlagOverrides(page, { 'outreach-pro-gating-v2': 'on' })
})

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test('keeps the filing steps and explains the cutoff before purchase', async ({
  page,
}) => {
  const { user, client } = await authenticateTestUser(page, {
    isolated: true,
  })
  await client.put('/v1/campaigns/mine', {
    details: { electionDate: format(addDays(new Date(), 10), 'yyyy-MM-dd') },
  })
  // Filing details saved past the cutoff, through the endpoint the form
  // posts to: gp-api accepts them and only skips the paid compliance work.
  await seedFilingComplete(client, user.email)

  await page.goto(PRO_UPGRADE_PATH)
  await NavigationHelper.dismissOverlays(page)
  await page.waitForURL(`**${PRO_UPGRADE_PATH}/guidance`, { timeout: 60_000 })

  await expect(
    page.getByText(/deadline to get verified for texting has passed/),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', {
      name: "Let's gather a few things to unlock Pro",
    }),
  ).toBeVisible()
  for (const row of [
    'Your campaign EIN',
    'Your filing details',
    'Contact details',
    'Payment',
  ]) {
    await expect(page.getByText(row, { exact: true })).toBeVisible()
  }
  // No PIN is coming once texting has closed.
  await expect(
    page.getByText('About 1 to 2 weeks', { exact: true }),
  ).toHaveCount(0)

  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL(`**${PRO_UPGRADE_PATH}/status`)
  await page
    .getByRole('button', { name: 'I have filed with my election authority' })
    .click()
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.waitForURL(`**${PRO_UPGRADE_PATH}/ein`)
  await page.getByPlaceholder('12-3456789').fill(SEED_VALID_EIN)
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.waitForURL(`**${PRO_UPGRADE_PATH}/filing-details`)
  await expect(
    page.getByRole('heading', { name: 'Your details are saved' }),
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    page.getByText('Verification starts when you finish your upgrade.'),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.waitForURL(`**${PRO_UPGRADE_PATH}/payment`, { timeout: 30_000 })
  await expect(
    page.getByRole('heading', { name: 'Complete your upgrade' }),
  ).toBeVisible()
  // Nothing to verify once texting has closed, so no verification line.
  await expect(page.getByText(/Verification starts when you pay/)).toHaveCount(
    0,
  )
})
