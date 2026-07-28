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

test.describe('Navigation Menu by Org Type', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('campaign org shows campaign menu items', async ({ page }) => {
    await setupElectedOfficeUser(page)
    await page.goto('/dashboard/polls', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    // Switch to campaign org
    const eoOrgName = await getSelectedOrgName(page)
    const allOrgs = await getOrgPickerOptions(page)
    const campaignOrgName = allOrgs.find((name) => name !== eoOrgName)!
    expect(campaignOrgName).toBeTruthy()

    await switchOrganization(page, campaignOrgName)
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15000 })
    await NavigationHelper.dismissOverlays(page)

    const sidebar = page.locator('[data-sidebar="content"]')

    await expect(sidebar.getByText('Campaign Manager')).toBeVisible({
      timeout: 10000,
    })
    await expect(sidebar.getByText('Voter Outreach')).toBeVisible()
    await expect(sidebar.getByText('Content Builder')).toBeVisible()

    // The Website tab was retired with the new compliance flow (ENG-10505).
    await expect(sidebar.getByText('Website')).not.toBeVisible()
    await expect(sidebar.getByText('Constituent Data')).not.toBeVisible()
    await expect(sidebar.getByText('Polls')).not.toBeVisible()
  })

  test('elected office org shows serve menu items', async ({ page }) => {
    await setupElectedOfficeUser(page)
    await page.goto('/dashboard/polls', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    const sidebar = page.locator('[data-sidebar="content"]')

    await expect(sidebar.getByText('Constituent Data')).toBeVisible({
      timeout: 10000,
    })
    await expect(sidebar.getByText('Polls')).toBeVisible()

    await expect(sidebar.getByText('Campaign Manager')).not.toBeVisible()
    await expect(sidebar.getByText('Voter Outreach')).not.toBeVisible()
    await expect(sidebar.getByText('Website')).not.toBeVisible()
    await expect(sidebar.getByText('Content Builder')).not.toBeVisible()
  })
})
