import { expect, test, type Page } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  SEED_VALID_EIN,
  seedEinAndFiled,
  seedFilingComplete,
} from 'src/helpers/pro-upgrade.helper'
import {
  acceptCookieBanner,
  setFlagOverrides,
} from 'src/helpers/campaignStory.helper'
import { openSmsWindow } from 'src/helpers/smsWindow.helper'

// Purchase-only (outreach-pro-gating-v2) resume. The derivation is flat — a
// candidate who is not Pro always re-enters on the guidance overview — so
// resume means the steps carry what was saved: the EIN fills in, and a filing
// already on record shows the submitted notice instead of a form whose
// resubmit would save nothing (createAgentic returns an existing record
// unchanged). createAgentic accepts a free campaign and defers the compliance
// agent to the payment webhook, so nothing here reaches Peerly or Stripe and
// it runs on every PR preview. Isolated: both tests write campaign state.

const PRO_UPGRADE_PATH = '/dashboard/pro-upgrade'

type CampaignWizardState = {
  details?: {
    einNumber?: string | null
    hasFiledForRace?: boolean | null
  }
}

test.beforeEach(async ({ page }) => {
  await setFlagOverrides(page, { 'outreach-pro-gating-v2': 'on' })
})

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
  await acceptCookieBanner(page)
})

const walkToEin = async (page: Page): Promise<void> => {
  await page.goto(PRO_UPGRADE_PATH)
  await NavigationHelper.dismissOverlays(page)
  await page.waitForURL(`**${PRO_UPGRADE_PATH}/guidance`, { timeout: 60_000 })
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.waitForURL(`**${PRO_UPGRADE_PATH}/status`)
  await page
    .getByRole('button', { name: 'I have filed with my election authority' })
    .click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL(`**${PRO_UPGRADE_PATH}/ein`)
}

test.describe('Pro upgrade v2 resume', () => {
  test('re-enters on guidance with the saved EIN filled in', async ({
    page,
  }) => {
    const { client } = await authenticateTestUser(page, { isolated: true })
    await openSmsWindow(client)

    await walkToEin(page)
    await page.getByPlaceholder('12-3456789').fill(SEED_VALID_EIN)
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/filing-details`)

    await page.getByRole('button', { name: 'Exit', exact: true }).click()
    await page.waitForURL(/\/dashboard$/, { timeout: 30_000 })

    const { data } = await client.get<CampaignWizardState>('/v1/campaigns/mine')
    expect(data.details?.hasFiledForRace).toBe(true)
    expect(data.details?.einNumber).toBe(SEED_VALID_EIN)

    // Re-entry opens on the overview, never mid-flow.
    await walkToEin(page)
    await expect(page.getByPlaceholder('12-3456789')).toHaveValue(
      SEED_VALID_EIN,
    )
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/filing-details`)
  })

  test('confirms a filing submitted before payment instead of asking again', async ({
    page,
  }) => {
    const { user, client } = await authenticateTestUser(page, {
      isolated: true,
    })
    await openSmsWindow(client)
    // The filing a free candidate submitted on an earlier visit, through the
    // endpoint the form posts to, before leaving at payment.
    await seedEinAndFiled(client)
    await seedFilingComplete(client, user.email)

    await walkToEin(page)
    await page.getByRole('button', { name: 'Continue' }).click()

    await page.waitForURL(`**${PRO_UPGRADE_PATH}/filing-details`)
    await expect(
      page.getByRole('heading', { name: 'Your details are saved' }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByText('Verification starts when you finish your upgrade.'),
    ).toBeVisible()
    await expect(
      page.getByText('What are your campaign filing details?'),
    ).toHaveCount(0)

    await page.getByRole('button', { name: 'Back' }).click()
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/ein`)
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/filing-details`)
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/payment`, { timeout: 30_000 })
  })
})
