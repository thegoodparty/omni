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

  // Wait for Clerk to load with debugging
  const emailInput = page.getByRole('textbox', { name: /email/i })

  try {
    await emailInput.waitFor({ state: 'visible', timeout: 30000 })
  } catch {
    // If Clerk doesn't load, capture page content for debugging
    const html = await page.content()
    console.log('Page HTML when Clerk failed to load:', html.slice(0, 2000))
    const consoleMessages = await page.evaluate(() => {
      return (
        (window as unknown as { __playwright_console?: string[] })
          .__playwright_console || []
      )
    })
    console.log('Console messages:', consoleMessages)
    throw new Error('Clerk sign-in form did not load within 30 seconds')
  }

  await emailInput.fill(email)
  await page.getByRole('textbox', { name: /password/i }).fill(password)

  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await page.waitForURL(/\/dashboard/)
}
