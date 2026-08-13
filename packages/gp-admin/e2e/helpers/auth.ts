import { expect, Locator, Page } from '@playwright/test'

/**
 * Test user type constants for different organizations and roles.
 * Use these constants instead of string literals when calling signIn().
 */
export const TEST_USERS = {
  DEV_ADMIN: 'dev-admin',
  DEV_SALES: 'dev-sales',
  DEV_READONLY: 'dev-readonly',
  PROD_ADMIN: 'prod-admin',
  PROD_SALES: 'prod-sales',
  PROD_READONLY: 'prod-readonly',
  MULTI_ORG: 'multi-org',
} as const

/**
 * Test user types for different organizations and roles.
 * Format: {environment}-{role}
 */
export type TestUserType = (typeof TEST_USERS)[keyof typeof TEST_USERS]

/**
 * Environment variable mapping for test users.
 */
const TEST_USER_ENV_MAP: Record<
  TestUserType,
  { email: string; password: string }
> = {
  [TEST_USERS.DEV_ADMIN]: {
    email: 'CLERK_TEST_DEV_ADMIN_EMAIL',
    password: 'CLERK_TEST_DEV_ADMIN_PASSWORD',
  },
  [TEST_USERS.DEV_SALES]: {
    email: 'CLERK_TEST_DEV_SALES_EMAIL',
    password: 'CLERK_TEST_DEV_SALES_PASSWORD',
  },
  [TEST_USERS.DEV_READONLY]: {
    email: 'CLERK_TEST_DEV_READONLY_EMAIL',
    password: 'CLERK_TEST_DEV_READONLY_PASSWORD',
  },
  [TEST_USERS.PROD_ADMIN]: {
    email: 'CLERK_TEST_PROD_ADMIN_EMAIL',
    password: 'CLERK_TEST_PROD_ADMIN_PASSWORD',
  },
  [TEST_USERS.PROD_SALES]: {
    email: 'CLERK_TEST_PROD_SALES_EMAIL',
    password: 'CLERK_TEST_PROD_SALES_PASSWORD',
  },
  [TEST_USERS.PROD_READONLY]: {
    email: 'CLERK_TEST_PROD_READONLY_EMAIL',
    password: 'CLERK_TEST_PROD_READONLY_PASSWORD',
  },
  [TEST_USERS.MULTI_ORG]: {
    email: 'CLERK_TEST_MULTI_ORG_EMAIL',
    password: 'CLERK_TEST_MULTI_ORG_PASSWORD',
  },
}

/**
 * Gets the email and password for a test user from environment variables.
 */
export function getTestUserCredentials(userType: TestUserType): {
  email: string
  password: string
} {
  const envKeys = TEST_USER_ENV_MAP[userType]

  const email = process.env[envKeys.email]
  const password = process.env[envKeys.password]

  if (!email || !password) {
    throw new Error(
      `${envKeys.email} and ${envKeys.password} environment variables are required for user type "${userType}"`
    )
  }

  return { email, password }
}

/**
 * Ensures Clerk is showing an EDITABLE PASSWORD first factor before it is
 * filled. The Clerk instance can offer `email_code` as an additional first
 * factor (with password optional), so depending on factor ordering the password
 * field may not be on the initial screen — and when it is, Clerk often renders
 * it `disabled` until the password method is explicitly chosen. A visibility
 * check passes for that disabled field while the subsequent fill() times out, so
 * every password check here requires editability, not mere visibility. Handles
 * both the single-screen form (email + password together) and a stepped flow,
 * switching to the password method via "Use another method" when Clerk defaults
 * to a different factor.
 */
async function ensurePasswordField(page: Page): Promise<void> {
  // Match by label, not role: an `<input type="password">` has no `textbox`
  // role, so getByRole('textbox') would never match Clerk's password field.
  const passwordInput = page.getByLabel(/password/i).first()

  // Resolve a locator's visibility via waitFor rather than a point-in-time
  // isVisible() snapshot, so slow CI hydration / Clerk screen transitions can't
  // send us down the wrong branch. Used for buttons (clicked, not filled).
  const becomesVisible = (
    locator: Locator,
    timeout: number
  ): Promise<boolean> =>
    locator
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false)

  // Editability — not mere visibility — is what fill() requires: Clerk can
  // render the password input visible but `disabled`, which passes a visibility
  // check yet rejects fill().
  const becomesEditable = (
    locator: Locator,
    timeout: number
  ): Promise<boolean> =>
    expect(locator)
      .toBeEditable({ timeout })
      .then(() => true)
      .catch(() => false)

  // Matches a clickable Clerk control by accessible name whether Clerk renders
  // it as a `<button>` or an `<a>`. The "Use another method" affordance and the
  // factor-selection options are links when `email_code` is the default first
  // factor (e.g. OTP enabled) and buttons otherwise, so a button-only locator
  // misses them and the password method is never selected.
  const clerkControl = (name: RegExp): Locator =>
    page
      .getByRole('button', { name })
      .or(page.getByRole('link', { name }))
      .first()

  // Single-screen flow: password is already on the identifier screen.
  if (await becomesEditable(passwordInput, 5000)) return

  // Stepped (identifier-first) flow: advance past the email step, then re-check.
  const continueBtn = page.getByRole('button', {
    name: 'Continue',
    exact: true,
  })
  if (await becomesVisible(continueBtn, 3000)) {
    await continueBtn.click()
    if (await becomesEditable(passwordInput, 3000)) return
  }

  // Clerk defaulted to another first factor (e.g. email_code), or rendered the
  // password input disabled — pick the password method explicitly. Match the
  // controls as link OR button, since Clerk renders them as links in the
  // email-code-default flow.
  const useAnotherMethod = clerkControl(/use another method/i)
  if (await becomesVisible(useAnotherMethod, 3000)) {
    await useAnotherMethod.click()
    await clerkControl(/password/i).click()
  }
  // The field must be genuinely editable before the caller fills it; otherwise
  // fill() times out on a visible-but-disabled input.
  await expect(passwordInput).toBeEditable({ timeout: 5000 })
}

/**
 * Signs in a user using Clerk's email/password authentication.
 * @param page - Playwright page object
 * @param userType - The type of test user to sign in as (defaults to 'dev-admin')
 */
export async function signIn(
  page: Page,
  userType: TestUserType = TEST_USERS.DEV_ADMIN
): Promise<void> {
  const { email, password } = getTestUserCredentials(userType)

  await page.goto('/auth/sign-in')

  const emailInput = page.getByRole('textbox', { name: /email/i })
  await emailInput.waitFor({ state: 'visible' })

  await emailInput.fill(email)
  await ensurePasswordField(page)
  await page
    .getByLabel(/password/i)
    .first()
    .fill(password)

  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await page.waitForURL(/\/dashboard/)
}

/**
 * Switches to a different organization using the OrganizationSwitcher component.
 * @param page - Playwright page object
 * @param orgName - The name of the organization to switch to (e.g., 'Development', 'Production')
 */
export async function switchOrganization(
  page: Page,
  orgName: string
): Promise<void> {
  // Find and click the organization switcher trigger (contains current org name text)
  const orgSwitcher = page.getByText(/Development|Production/).first()
  await orgSwitcher.click()

  // Wait for dropdown to appear and click the organization
  await page.getByRole('menuitem', { name: orgName }).click()

  // Wait for the organization name to appear in the switcher, indicating the switch completed
  await page.getByText(orgName).first().waitFor({ state: 'visible' })
}
