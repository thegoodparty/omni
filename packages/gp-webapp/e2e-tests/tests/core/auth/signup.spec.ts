import { expect, test } from '@playwright/test'
import { setupClerkTestingToken } from '@clerk/testing/playwright'
import {
  blockSlowScripts,
  NavigationHelper,
} from '../../../src/helpers/navigation.helper'
import {
  fillClerkSignUpForm,
  getClerkContinueButton,
} from '../../../src/helpers/clerk.helper'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Sign Up Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await setupClerkTestingToken({ page })
    await blockSlowScripts(page)
    await NavigationHelper.navigateToPage(page, '/sign-up')
    await NavigationHelper.dismissOverlays(page)
    await page.waitForSelector('.cl-signUp-root', { state: 'attached' })
  })

  test('should display sign up form elements', async ({ page }) => {
    await expect(page.locator('.cl-signUp-root')).toBeVisible()

    // Assert only the fields Clerk always renders for this instance. Password is
    // optional now (email_code is an alternative factor) and may not appear, so
    // it is intentionally not required here — the sign-up flow tests cover
    // completing with or without a password.
    await expect(page.locator('input[name=firstName]')).toBeVisible()
    await expect(page.locator('input[name=lastName]')).toBeVisible()
    await expect(page.locator('input[name=emailAddress]')).toBeVisible()
    await expect(getClerkContinueButton(page)).toBeVisible()
  })

  test('should successfully sign up and redirect to onboarding', async ({
    page,
  }) => {
    await fillClerkSignUpForm(page)
    await page.waitForTimeout(2000)
    await page.waitForURL('**/onboarding**', { timeout: 10000 })
  })
})
