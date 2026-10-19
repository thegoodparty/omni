import { expect, test, type Page } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  SEED_VALID_EIN,
  seedCandidateProfileComplete,
  seedEinAndFiled,
} from 'src/helpers/pro-upgrade.helper'

// Pro upgrade front-end gates in the live wizard:
// the EIN sanity check and the filing form's field validation, which are
// the only checks before the data reaches the TCR/Peerly pipeline. Both stop
// before payment (a valid filing submit creates the record, but a free
// campaign's compliance agent waits for the payment webhook), so this runs on
// every PR preview. Isolated: each test writes campaign state.

const PRO_UPGRADE_PATH = '/dashboard/pro-upgrade'

type CampaignEinState = { details?: { einNumber?: string | null } }

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
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

test.describe('Pro upgrade v2 validation gates', () => {
  test('EIN step rejects a placeholder EIN and advances on a real one', async ({
    page,
  }) => {
    const { client } = await authenticateTestUser(page, { isolated: true })
    await walkToEin(page)

    const einField = page.getByPlaceholder('12-3456789')
    await einField.fill('12-3456789')
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(
      page.getByText('That looks like a placeholder, not a real EIN.'),
    ).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(`${PRO_UPGRADE_PATH}/ein`)
    const { data } = await client.get<CampaignEinState>('/v1/campaigns/mine')
    expect(data.details?.einNumber ?? null).toBeNull()

    await einField.fill(SEED_VALID_EIN)
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/filing-details`, {
      timeout: 30_000,
    })
  })

  test('filing form names the invalid fields and advances once they are fixed', async ({
    page,
  }) => {
    const { client } = await authenticateTestUser(page, { isolated: true })
    // EIN and a complete candidate profile on record, so the form asks only
    // for the filing itself.
    await seedEinAndFiled(client)
    await seedCandidateProfileComplete(client)

    await walkToEin(page)
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/filing-details`)
    await expect(
      page.getByText('What are your campaign filing details?'),
    ).toBeVisible({ timeout: 30_000 })

    // A freshly created test campaign can arrive with no office level.
    const officeTrigger = page
      .getByRole('combobox')
      .filter({ hasText: 'Select an office level' })
    if (await officeTrigger.count()) {
      await officeTrigger.click()
      await page.getByRole('option', { name: 'Local' }).click()
    }

    await page.getByPlaceholder('Jane Smith').fill('Jane Smith')
    await page.getByPlaceholder('Jane for Council').fill('N/A')
    await page
      .getByPlaceholder('https://')
      .fill('https://sos.wyo.gov/filing/jane-for-council')
    await page.getByPlaceholder('you@campaign.org').fill('jane@')
    await page.getByPlaceholder('123 Main St').fill('1700 Capitol Ave')
    await page.getByPlaceholder('Seattle').fill('Cheyenne')
    await page.getByRole('combobox').filter({ hasText: 'State' }).click()
    await page.getByRole('option', { name: 'WY' }).click()
    await page.getByPlaceholder('98103').fill('82001')

    // The submit holds until every field has a value; the phone is missing.
    const submit = page.getByRole('button', { name: 'Continue' })
    await expect(submit).toBeDisabled()
    await page.getByPlaceholder('(555) 123-4567').fill('(307) 555-1234')
    await expect(submit).toBeEnabled()

    // Filled but invalid: a placeholder committee name (ENG-11228) and a
    // malformed email are named, and the step does not advance.
    await submit.click()
    await expect(
      page.getByText('Please fix the following fields:'),
    ).toBeVisible()
    await expect(
      page.getByText(/Placeholders like "N\/A" are not accepted/),
    ).toBeVisible()
    await expect(page.getByText('Filing Email', { exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(
      `${PRO_UPGRADE_PATH}/filing-details`,
    )

    await page.getByPlaceholder('Jane for Council').fill('Jane for Council')
    await page.getByPlaceholder('you@campaign.org').fill('jane@example.com')
    await submit.click()
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/payment`, { timeout: 60_000 })
  })
})
