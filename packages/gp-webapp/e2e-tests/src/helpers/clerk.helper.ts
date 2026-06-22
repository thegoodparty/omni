import { expect, type Locator, type Page } from '@playwright/test'
import { TestDataHelper } from './data.helper'

// Clerk verifies any `+clerk_test` email with this fixed code on development
// instances, so sign-up completes deterministically when the instance requires
// email-code verification. See https://clerk.com/docs/testing/test-emails-and-phones
const CLERK_TEST_OTP_CODE = '424242'

export const getClerkContinueButton = (page: Page): Locator =>
  page.getByRole('button', { name: /^continue$/i })

/**
 * Resolves true if `locator` becomes editable within `timeout`, false otherwise.
 * Editability — not mere visibility — is the property fill() requires: Clerk can
 * render a field that is visible but `disabled`, which passes a visibility check
 * yet rejects fill().
 */
const becomesEditable = (locator: Locator, timeout: number): Promise<boolean> =>
  expect(locator)
    .toBeEditable({ timeout })
    .then(() => true)
    .catch(() => false)

/**
 * Resolves true if `locator` becomes visible within `timeout`, false otherwise.
 * Uses a bounded `waitFor` rather than a point-in-time `isVisible()` snapshot, so
 * a control that Clerk renders a moment later (slow screen transition) is still
 * caught instead of being missed by a single check.
 */
const becomesVisible = (locator: Locator, timeout: number): Promise<boolean> =>
  locator
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false)

/**
 * Matches a clickable Clerk control by accessible name regardless of whether
 * Clerk renders it as a `<button>` or an `<a>`. Clerk's "Use another method"
 * affordance and the strategy options on the factor-selection screen are links
 * in some flows (e.g. when `email_code` is the default first factor) and buttons
 * in others, so a single `getByRole('button', …)` misses them.
 */
const clerkControl = (page: Page, name: RegExp): Locator =>
  page
    .getByRole('button', { name })
    .or(page.getByRole('link', { name }))
    .first()

/**
 * After the identifier (email) step, ensures Clerk is showing an EDITABLE
 * password first factor before the caller fills it. When password is optional
 * and `email_code` is also a first factor, Clerk defaults to the email-code
 * ("Check your email") screen — which has no password field at all — and in some
 * flows renders a `disabled` password input instead. In both cases the password
 * method must be selected explicitly via "Use another method" (rendered as a
 * link or a button) before the field becomes editable; a visibility check is not
 * enough, since a disabled field is still "visible" and fill() would time out.
 */
export const ensureClerkPasswordFactor = async (page: Page): Promise<void> => {
  const passwordField = page.getByLabel(/password/i).first()

  // Fast path: password is the active first factor and ready to type into.
  if (await becomesEditable(passwordField, 5000)) {
    return
  }

  // Password isn't the active/editable first factor (Clerk defaulted to e.g.
  // email_code, or rendered the password input disabled). Open the method
  // picker and select password explicitly.
  const useAnotherMethod = clerkControl(page, /use another method/i)
  if (await becomesVisible(useAnotherMethod, 5000)) {
    await useAnotherMethod.click()
    await clerkControl(page, /password/i).click()
  }

  // The field must be genuinely editable before the caller fills it; otherwise
  // fill() times out on a visible-but-disabled (or absent) input.
  await expect(passwordField).toBeEditable({ timeout: 10000 })
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

  // Most configs auto-submit once all digits are entered; for manual-submit
  // configs the verify button may take a render cycle to appear, so wait for it
  // rather than snapshotting and treat a timeout as "auto-submitted".
  const verifyButton = page.getByRole('button', { name: /^verify/i })
  try {
    await verifyButton.waitFor({ state: 'visible', timeout: 3000 })
    await verifyButton.click()
  } catch {
    // Button never appeared — Clerk auto-submitted when the last digit was entered.
  }
}

export const fillClerkSignUpForm = async (page: Page) => {
  const generated = TestDataHelper.generateTestUserData()
  const testUser = { ...generated, email: toClerkTestEmail(generated.email) }

  await page.locator('input[name=firstName]').fill(testUser.firstName)
  await page.locator('input[name=lastName]').fill(testUser.lastName)
  await page.locator('input[name=emailAddress]').fill(testUser.email)

  // Password is optional on the instance now (email_code is also offered as a
  // factor), so only fill it when the prebuilt form actually renders an
  // editable field. Check editability (not just visibility), since Clerk can
  // render the password input disabled when password isn't required — a
  // visibility-only check would then pass and the fill() would time out.
  const passwordField = page.locator('input[name=password]')
  if (await becomesEditable(passwordField, 3000)) {
    await passwordField.fill(testUser.password)
  }

  await getClerkContinueButton(page).click()

  await completeClerkEmailCodeVerification(page)

  return testUser
}
