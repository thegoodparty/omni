import type { Locator, Page } from '@playwright/test'
import { TestDataHelper } from './data.helper'

// Clerk verifies any `+clerk_test` email with this fixed code on development
// instances, so sign-up completes deterministically when the instance requires
// email-code verification. See https://clerk.com/docs/testing/test-emails-and-phones
const CLERK_TEST_OTP_CODE = '424242'

export const getClerkContinueButton = (page: Page): Locator =>
  page.getByRole('button', { name: /^continue$/i })

/**
 * After the identifier (email) step, ensures Clerk is showing the PASSWORD first
 * factor before the caller fills it. The Clerk instance now offers `email_code`
 * as an additional first factor, so depending on factor ordering Clerk may land
 * on the email-code screen instead of password. When the password field isn't
 * already visible, switch to the password method via "Use another method".
 */
export const ensureClerkPasswordFactor = async (page: Page): Promise<void> => {
  const passwordField = page.getByLabel(/password/i).first()
  try {
    await passwordField.waitFor({ state: 'visible', timeout: 5000 })
    return
  } catch {
    // Password isn't the active first factor (Clerk defaulted to e.g.
    // email_code). Fall through and select the password method explicitly.
  }

  const useAnotherMethod = page.getByRole('button', {
    name: /use another method/i,
  })
  await useAnotherMethod.waitFor({ state: 'visible', timeout: 5000 })
  await useAnotherMethod.click()

  await page
    .getByRole('button', { name: /password/i })
    .first()
    .click()

  await passwordField.waitFor({ state: 'visible', timeout: 5000 })
}

/**
 * Adds the `+clerk_test` subaddress so Clerk treats the email as a test address
 * verifiable with the fixed OTP. The `@test.goodparty.org` suffix is preserved
 * so gp-api's scheduled test-user cleanup still matches the address.
 */
const toClerkTestEmail = (email: string): string =>
  email.includes('+clerk_test') ? email : email.replace('@', '+clerk_test@')

/**
 * Completes Clerk's email-code verification step when the instance renders one
 * after sign-up. With password now optional, Clerk may require email-code
 * verification instead of (or in addition to) a password, so this fills the test
 * OTP when the code screen appears and is a no-op when it doesn't.
 */
export const completeClerkEmailCodeVerification = async (
  page: Page,
): Promise<void> => {
  // Clerk renders the email code as six per-digit inputs that all share the
  // `aria-label` "Enter verification code. Digit N", so a name-based locator
  // matches all six and trips strict mode. Target the first digit by Clerk's
  // stable class and type the full code — Clerk auto-advances focus.
  const codeInput = page.locator('.cl-otpCodeFieldInput').first()
  try {
    await codeInput.waitFor({ state: 'visible', timeout: 5000 })
  } catch {
    return
  }

  await codeInput.pressSequentially(CLERK_TEST_OTP_CODE)

  // Most configs auto-submit once all digits are entered; click the verify
  // button only when it's still on screen (i.e. submission isn't automatic).
  const verifyButton = page.getByRole('button', { name: /^verify/i })
  if (await verifyButton.isVisible().catch(() => false)) {
    await verifyButton.click()
  }
}

export const fillClerkSignUpForm = async (page: Page) => {
  const generated = TestDataHelper.generateTestUserData()
  const testUser = { ...generated, email: toClerkTestEmail(generated.email) }

  await page.locator('input[name=firstName]').fill(testUser.firstName)
  await page.locator('input[name=lastName]').fill(testUser.lastName)
  await page.locator('input[name=emailAddress]').fill(testUser.email)

  // Password is optional on the instance now (email_code is also offered as a
  // factor), so only fill it when the prebuilt form actually renders the field.
  const passwordField = page.locator('input[name=password]')
  if (await passwordField.isVisible().catch(() => false)) {
    await passwordField.fill(testUser.password)
  }

  await getClerkContinueButton(page).click()

  await completeClerkEmailCodeVerification(page)

  return testUser
}
