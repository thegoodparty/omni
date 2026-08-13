import { expect, test } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from '../../../src/helpers/navigation.helper'
import { WaitHelper } from '../../../src/helpers/wait.helper'
import { waitForDashboardReady } from 'src/helpers/dashboard'

test.describe('Dashboard Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('should access dashboard and navigate to app features', async ({
    page,
  }) => {
    test.setTimeout(120000)
    console.log(
      `🧪 Testing dashboard functionality with pre-authenticated user`,
    )
    await authenticateTestUser(page)
    await page.goto('/dashboard')
    await page.waitForURL(/\/dashboard/)
    await NavigationHelper.dismissOverlays(page)

    await expect(page).toHaveURL(/\/dashboard$/)

    await waitForDashboardReady(page)
    console.log('✅ Dashboard accessible')

    await page.goto('/dashboard/profile')
    await WaitHelper.waitForPageReady(page)
    await expect(
      page.getByRole('heading', { name: 'Office Details' }).first(),
    ).toBeVisible()
    console.log('✅ Profile accessible')
  })
})
