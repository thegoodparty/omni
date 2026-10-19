import { expect, test } from '@playwright/test'
import { addDays, format } from 'date-fns'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'

// Pro upgrade wizard entry. Nothing here pays, so
// it runs on every PR preview: a free candidate opens on the guidance
// overview, and a candidate who is already Pro with no filing on record (the
// cohort who paid before the wizard asked for filing details) is routed to
// the success screen and on to campaign verification. isPro is flipped
// through the test-only endpoint, no Stripe.

const PRO_UPGRADE_PATH = '/dashboard/pro-upgrade'

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test.describe('Pro upgrade v2 entry', () => {
  test('opens a free candidate on the guidance overview', async ({ page }) => {
    const { client } = await authenticateTestUser(page, { isolated: true })
    // Move the election out of the 19-day texting cutoff so the copy below
    // does not depend on the calendar.
    await client.put('/v1/campaigns/mine', {
      details: { electionDate: format(addDays(new Date(), 90), 'yyyy-MM-dd') },
    })

    await page.goto(PRO_UPGRADE_PATH)
    await NavigationHelper.dismissOverlays(page)
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/guidance`, {
      timeout: 60_000,
    })

    await expect(
      page.getByRole('heading', {
        name: "Let's gather a few things to unlock Pro",
      }),
    ).toBeVisible()
    // Filing details are gathered before payment now, so the list names them.
    for (const row of [
      'Your campaign EIN',
      'Your filing details',
      'Contact details',
      'Payment',
      'About 1 to 2 weeks',
    ]) {
      await expect(page.getByText(row, { exact: true })).toBeVisible()
    }

    // The cookie banner can mount after the dismissal above, which ran before
    // the redirect to guidance, and it sits over the footer's Continue.
    await NavigationHelper.dismissCookieBanner(page)
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/status`)
  })

  test('sends an already-Pro candidate with no filing on to campaign verification', async ({
    page,
  }) => {
    const { client } = await setupProCampaignUser(page)
    // Move the election out of the 19-day texting cutoff so the copy below
    // does not depend on the calendar.
    await client.put('/v1/campaigns/mine', {
      details: { electionDate: format(addDays(new Date(), 90), 'yyyy-MM-dd') },
    })

    await page.goto(PRO_UPGRADE_PATH)
    await NavigationHelper.dismissOverlays(page)
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/success`, {
      timeout: 60_000,
    })

    await expect(
      page.getByRole('heading', { name: 'Welcome to Pro' }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Still to do: verification')).toBeVisible()
    await expect(page.getByText('A PIN is on its way')).toHaveCount(0)

    const startVerification = page.getByRole('button', {
      name: 'Start verification',
    })
    await expect(startVerification).toBeEnabled({ timeout: 30_000 })
    await startVerification.click()

    await page.waitForURL('**/dashboard/campaign-verification', {
      timeout: 30_000,
    })
    await expect(
      page.getByRole('heading', {
        name: 'Verify your campaign to text voters',
      }),
    ).toBeVisible({ timeout: 30_000 })
  })
})
