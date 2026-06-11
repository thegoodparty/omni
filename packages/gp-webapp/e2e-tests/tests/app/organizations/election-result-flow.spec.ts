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
import { eventually, wait } from 'tests/utils/eventually'

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test('"I won my race" creates an EO org and auto-selects it', async ({
  page,
}) => {
  await authenticateTestUser(page, {
    isolated: true,
    race: { zip: '82001', office: 'Cheyenne City Council - Ward 1' },
  })

  await NavigationHelper.navigateToPage(page, '/dashboard')
  await NavigationHelper.dismissOverlays(page)

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

  // EO org creation is async server-side — the picker may not reflect it
  // immediately after the briefings redirect. Retry until it appears.
  let orgsAfter: string[] = []
  await eventually(
    { that: 'org picker shows 2 organizations after EO org creation' },
    async () => {
      orgsAfter = await getOrgPickerOptions(page)
      if (orgsAfter.length !== 2) {
        throw new Error(
          `Expected 2 orgs in picker, got ${orgsAfter.length}: ${orgsAfter.join(', ')}`,
        )
      }
    },
  )

  const selectedOrg = await getSelectedOrgName(page)
  expect(selectedOrg).toBeTruthy()

  const sidebar = page.locator('[data-sidebar="content"]')
  await expect(sidebar.getByText('Constituents')).toBeVisible({
    timeout: 10_000,
  })
  await expect(sidebar.getByText('Polls')).toBeVisible({ timeout: 10_000 })
})
