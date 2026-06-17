import type { Locator, Page } from '@playwright/test'
import { TestDataHelper } from './data.helper'

export const getClerkContinueButton = (page: Page): Locator =>
  page.getByRole('button', { name: /^continue$/i })

/**
 * After the email/identifier step, ensures Clerk is showing the PASSWORD first
 * factor before the caller fills it. The Clerk instance now offers `email_code`
 * as an additional first factor, so depending on factor ordering Clerk may land
 * on the email-code screen instead of password. If the password field isn't
 * visible quickly, switch to the password method via "Use another method".
 */
export const ensureClerkPasswordFactor = async (page: Page) => {
  const passwordField = page.getByLabel(/password/i).first()
  try {
    await passwordField.waitFor({ state: 'visible', timeout: 3000 })
    return
  } catch {
    // Password isn't the active first factor (Clerk defaulted to email_code).
    // Fall through and select the password method explicitly.
  }
  await page.getByRole('button', { name: /use another method/i }).click()
  await page
    .getByRole('button', { name: /password/i })
    .first()
    .click()
  await passwordField.waitFor({ state: 'visible', timeout: 5000 })
}

export const fillClerkSignUpForm = async (page: Page) => {
  const testUser = TestDataHelper.generateTestUserData()

  await page.locator('input[name=firstName]').fill(testUser.firstName)
  await page.locator('input[name=lastName]').fill(testUser.lastName)
  await page.locator('input[name=emailAddress]').fill(testUser.email)
  await page.locator('input[name=password]').fill(testUser.password)
  await getClerkContinueButton(page).click()

  return testUser
}
