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

  const emailInput = page.getByLabel('Email address')
  await emailInput.waitFor({ state: 'visible', timeout: 60000 })

  await emailInput.fill(email)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  const passwordInput = page.getByLabel('Password', { exact: true })
  await passwordInput.waitFor({ state: 'visible', timeout: 60000 })

  await passwordInput.fill(password)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await page.waitForURL(/\/dashboard/, { timeout: 60000 })
}
