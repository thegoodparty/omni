import { expect, test } from '@playwright/test'
import { setupClerkTestingToken } from '@clerk/testing/playwright'
import {
  blockSlowScripts,
  NavigationHelper,
} from '../../../src/helpers/navigation.helper'
import { fillClerkSignUpForm } from '../../../src/helpers/clerk.helper'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Sign Up Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await setupClerkTestingToken({ page })
    await blockSlowScripts(page)
    await NavigationHelper.navigateToPage(page, '/sign-up')
    await NavigationHelper.dismissOverlays(page)
    await page.waitForSelector('[data-testid=signup-form]', {
      state: 'attached',
    })
  })

  test('should display sign up form elements', async ({ page }) => {
    await expect(page.getByTestId('signup-form')).toBeVisible()

    // The custom form always renders all four fields plus a required password.
    await expect(page.locator('input[name=firstName]')).toBeVisible()
    await expect(page.locator('input[name=lastName]')).toBeVisible()
    await expect(page.locator('input[name=emailAddress]')).toBeVisible()
    await expect(page.locator('input[name=password]')).toBeVisible()
    await expect(page.getByTestId('signup-submit')).toBeVisible()
  })

  test('should successfully sign up and redirect to onboarding', async ({
    page,
  }) => {
    await fillClerkSignUpForm(page)
    await page.waitForTimeout(2000)
    await page.waitForURL('**/onboarding**', { timeout: 10000 })
  })
})
