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
 * Sets the E2E bypass cookie to skip Clerk authentication during tests.
 * Note: Vercel deployment protection bypass is handled via extraHTTPHeaders in playwright.config.ts
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
