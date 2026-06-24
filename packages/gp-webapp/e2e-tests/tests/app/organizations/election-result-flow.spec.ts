import { expect, test } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  getSelectedOrgName,
  getOrgPickerOptions,
} from 'src/helpers/organizations'
import { waitForDashboardReady } from 'src/helpers/dashboard'
import { wait } from 'tests/utils/eventually'

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test('"I won my race" creates an EO org and auto-selects it', async ({
  page,
}) => {
  await authenticateTestUser(page, {
    isolated: true,
    race: { zip: '82001', office: 'Cheyenne City Council - Ward 1' },
    // The serve menu (Constituent Data / Polls) asserted below is gated by the
    // serve-access flag; force it on via the server-side e2e override seam.
    flagOverrides: { 'serve-access': 'on' },
  })

  await NavigationHelper.navigateToPage(page, '/dashboard')
  await NavigationHelper.dismissOverlays(page)
  // The dashboard home can have a stray task modal open that aria-hides the
  // sidebar, so the org switcher button isn't in the a11y tree. Settle the
  // dashboard (and close any such modal) before opening the picker.
  await waitForDashboardReady(page)

  const orgsBefore = await getOrgPickerOptions(page)
  expect(orgsBefore).toHaveLength(1)

  await page.goto('/dashboard/election-result')
  await wait(250)
  await page
    .getByRole('button', { name: 'I won my race' })
    .click({ timeout: 10_000 })

  await page.waitForURL('**/dashboard/briefings', { timeout: 15_000 })

  await NavigationHelper.navigateToPage(page, '/dashboard/polls')
  await NavigationHelper.dismissOverlays(page)

  const orgsAfter = await getOrgPickerOptions(page)
  expect(orgsAfter).toHaveLength(2)

  const selectedOrg = await getSelectedOrgName(page)
  expect(selectedOrg).toBeTruthy()

  const sidebar = page.locator('[data-sidebar="content"]')
  await expect(sidebar.getByText('Constituent Data')).toBeVisible({
    timeout: 10_000,
  })
  await expect(sidebar.getByText('Polls')).toBeVisible({ timeout: 10_000 })
})
