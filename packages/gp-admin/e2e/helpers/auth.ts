import { BrowserContext } from '@playwright/test'

/**
 * Sets the e2e bypass cookie to skip Clerk authentication during tests
 */
export const setE2EBypassCookie = async (context: BrowserContext) => {
  await context.addCookies([
    {
      name: '__e2e_bypass',
      value: 'true',
      domain: 'localhost',
      path: '/',
    },
  ])
}
