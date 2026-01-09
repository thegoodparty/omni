import { Page } from '@playwright/test'

/**
 * Signs in a user using Clerk's email/password authentication.
 */
export const signIn = async (page: Page) => {
  const email = process.env.CLERK_TEST_USER_EMAIL
  const password = process.env.CLERK_TEST_USER_PASSWORD

  if (!email || !password) {
    throw new Error(
      'CLERK_TEST_USER_EMAIL and CLERK_TEST_USER_PASSWORD environment variables are required'
    )
  }

  await page.goto('/auth/sign-in')

  const emailInput = page.getByRole('textbox', { name: /email/i })
  await emailInput.waitFor({ state: 'visible' })

  await emailInput.fill(email)
  await page.getByRole('textbox', { name: /password/i }).fill(password)

  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await page.waitForURL(/\/dashboard/)
}
