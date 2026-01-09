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

  const failedRequests: string[] = []
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.url()} - ${request.failure()?.errorText}`)
  })

  await page.goto('/auth/sign-in', {
    waitUntil: 'load',
    timeout: 30000,
  })

  const emailInput = page.getByRole('textbox', { name: /email/i })

  try {
    await emailInput.waitFor({
      state: 'visible',
      timeout: process.env.CI ? 60000 : 30000,
    })
  } catch (error) {
    console.error('Failed to find Clerk sign-in form')
    console.error('Failed requests:', failedRequests)
    console.error('Page URL:', page.url())
    const html = await page.content()
    console.error('Page HTML length:', html.length)
    console.error('Has body content:', html.includes('<body'))
    throw error
  }

  await emailInput.fill(email)
  await page.getByRole('textbox', { name: /password/i }).fill(password)

  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await page.waitForURL(/\/dashboard/, { timeout: 30000 })
}
