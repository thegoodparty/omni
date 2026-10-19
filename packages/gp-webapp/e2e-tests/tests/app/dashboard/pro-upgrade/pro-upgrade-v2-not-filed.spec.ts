import { expect, test } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'

// Pro upgrade "not filed" dead end: status → No →
// filing instructions → Finish later. No Stripe or webhook, so it runs on
// every PR preview. Isolated: the No answer persists
// details.hasFiledForRace on the campaign.

const PRO_UPGRADE_PATH = '/dashboard/pro-upgrade'

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test('routes "not filed yet" to the filing instructions and exits on Finish later', async ({
  page,
}) => {
  await authenticateTestUser(page, { isolated: true })

  await page.goto(PRO_UPGRADE_PATH)
  await NavigationHelper.dismissOverlays(page)
  await page.waitForURL(`**${PRO_UPGRADE_PATH}/guidance`, { timeout: 60_000 })
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.waitForURL(`**${PRO_UPGRADE_PATH}/status`)
  await expect(
    page.getByRole('heading', { name: 'Are you officially filed?' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'I have not filed yet' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.waitForURL(`**${PRO_UPGRADE_PATH}/filing-instructions`)
  await expect(
    page.getByRole('heading', { name: /You are not eligible for Pro yet/ }),
  ).toBeVisible()
  await expect(page.getByText('Filing window', { exact: true })).toBeVisible()

  // A dead end: nothing here leads on to payment.
  await expect(
    page.getByRole('button', { name: /continue to payment/i }),
  ).toHaveCount(0)

  await page.getByRole('button', { name: 'Finish later' }).click()
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 })
})
