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

  await page.goto('/auth/sign-in', { waitUntil: 'domcontentloaded' })

  // Wait for page to be interactive (JavaScript loaded)
  await page.waitForLoadState('load')

  // Additional wait for Clerk's component to render
  await page.waitForTimeout(3000)

  // Wait for Clerk to load
  const emailInput = page.getByRole('textbox', { name: /email/i })

  try {
    await emailInput.waitFor({ state: 'visible', timeout: 30000 })
  } catch {
    // If Clerk doesn't load, log for debugging
    console.error('Clerk sign-in form did not load')
    throw new Error('Clerk sign-in form did not load within 30 seconds')
  }

  await emailInput.fill(email)
  await page.getByRole('textbox', { name: /password/i }).fill(password)

  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await page.waitForURL(/\/dashboard/)
}
