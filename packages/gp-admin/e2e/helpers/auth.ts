import { Page } from '@playwright/test'

/**
 * Test user type constants for different organizations and roles.
 * Use these constants instead of string literals when calling signIn().
 */
export const TEST_USERS = {
  DEV_ADMIN: 'dev-admin',
  DEV_SALES: 'dev-sales',
  DEV_READONLY: 'dev-readonly',
  QA_ADMIN: 'qa-admin',
  QA_SALES: 'qa-sales',
  QA_READONLY: 'qa-readonly',
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
const TEST_USER_ENV_MAP: Record<TestUserType, { email: string; password: string }> = {
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
  [TEST_USERS.QA_ADMIN]: {
    email: 'CLERK_TEST_QA_ADMIN_EMAIL',
    password: 'CLERK_TEST_QA_ADMIN_PASSWORD',
  },
  [TEST_USERS.QA_SALES]: {
    email: 'CLERK_TEST_QA_SALES_EMAIL',
    password: 'CLERK_TEST_QA_SALES_PASSWORD',
  },
  [TEST_USERS.QA_READONLY]: {
    email: 'CLERK_TEST_QA_READONLY_EMAIL',
    password: 'CLERK_TEST_QA_READONLY_PASSWORD',
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
  await page.getByRole('textbox', { name: /password/i }).fill(password)

  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await page.waitForURL(/\/dashboard/)
}

/**
 * Switches to a different organization using the OrganizationSwitcher component.
 * @param page - Playwright page object
 * @param orgName - The name of the organization to switch to (e.g., 'Development', 'QA', 'Production')
 */
export async function switchOrganization(page: Page, orgName: string): Promise<void> {
  // Find and click the organization switcher trigger (contains current org name text)
  const orgSwitcher = page.getByText(/Development|QA|Production/).first()
  await orgSwitcher.click()

  // Wait for dropdown to appear and click the organization
  await page.getByRole('menuitem', { name: orgName }).click()

  // Wait briefly for navigation to update
  await page.waitForTimeout(1000)
}
