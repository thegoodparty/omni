import { BrowserContext } from '@playwright/test'

/**
 * Extracts the domain from a URL for cookie setting
 */
const getDomainFromUrl = (url: string): string => {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    return 'localhost'
  }
}

/**
 * Sets the e2e bypass cookie to skip Clerk authentication during tests
 */
export const setE2EBypassCookie = async (context: BrowserContext) => {
  const baseURL = process.env.BASE_URL || 'http://localhost:3500'
  const domain = getDomainFromUrl(baseURL)

  await context.addCookies([
    {
      name: '__e2e_bypass',
      value: 'true',
      domain,
      path: '/',
    },
  ])
}
