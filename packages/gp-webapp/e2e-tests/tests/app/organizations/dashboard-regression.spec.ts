import { expect, test } from '@playwright/test'
import {
  setupElectedOfficeUser,
  switchOrganization,
  getSelectedOrgName,
  getOrgPickerOptions,
} from 'src/helpers/organizations'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { WaitHelper } from 'src/helpers/wait.helper'

test.describe('Dashboard Regression with Elected Office', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('campaign pages remain accessible under campaign org', async ({
    page,
  }) => {
    await setupElectedOfficeUser(page)
    await page.goto('/dashboard/polls', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    const eoOrgName = await getSelectedOrgName(page)
    const allOrgs = await getOrgPickerOptions(page)
    const campaignOrgName = allOrgs.find((name) => name !== eoOrgName)!
    expect(campaignOrgName).toBeTruthy()

    await switchOrganization(page, campaignOrgName)
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15000 })
    await WaitHelper.waitForPageReady(page)

    await expect(page.locator('main')).toBeVisible({ timeout: 10000 })

    await page.goto('/dashboard/profile', { waitUntil: 'domcontentloaded' })
    await WaitHelper.waitForPageReady(page)
    await expect(
      page.getByRole('heading', { name: 'Office Details' }).first(),
    ).toBeVisible({ timeout: 10000 })
  })

  test('polls page accessible under elected office org', async ({ page }) => {
    await setupElectedOfficeUser(page)
    await page.goto('/dashboard/polls', { waitUntil: 'domcontentloaded' })
    await WaitHelper.waitForPageReady(page)
    await NavigationHelper.dismissOverlays(page)

    await expect(page).toHaveURL(/\/dashboard\/polls/)
    await expect(page.locator('main')).toBeVisible({ timeout: 10000 })
  })

  test('contacts page loads under elected office org', async ({ page }) => {
    await setupElectedOfficeUser(page)
    await page.goto('/dashboard/contacts', { waitUntil: 'domcontentloaded' })
    await WaitHelper.waitForPageReady(page)
    await NavigationHelper.dismissOverlays(page)

    await expect(
      page.getByRole('heading', { name: 'Constituent Data' }),
    ).toBeVisible({ timeout: 10000 })

    // The CRM contacts surface has no member table by design, so "the page
    // loaded with real data" is proved by the universe card instead. Anchored
    // on 'Records available' (the L2 record count, always rendered) rather
    // than the census population row above it, which hides itself whenever
    // the district has no census figure.
    await expect(
      page.getByRole('heading', { name: 'Your Constituent Universe' }),
    ).toBeVisible({ timeout: 15000 })

    const statRow = page.getByText('Records available').locator('xpath=..')
    await expect(statRow).toBeVisible({ timeout: 15000 })
    // A real count is a formatted integer, never the card's 'Unavailable'
    // fallback. Generous timeout: this waits on GET /v1/contacts/stats, which
    // is a Databricks read.
    await expect(statRow.getByText(/^[\d,]+$/)).toBeVisible({ timeout: 30000 })
  })
})
