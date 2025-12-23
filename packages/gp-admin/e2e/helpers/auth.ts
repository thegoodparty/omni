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
 * Sets up all bypass cookies needed for E2E tests:
 * 1. Vercel Deployment Protection bypass (for accessing preview deployments)
 * 2. E2E bypass cookie (for skipping Clerk authentication)
 */
export const setE2EBypassCookie = async (context: BrowserContext) => {
  const baseURL = process.env.BASE_URL || 'http://localhost:3500'
  const domain = getDomainFromUrl(baseURL)
  const vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

  const cookies: Array<{
    name: string
    value: string
    domain: string
    path: string
  }> = [
    // Clerk/App bypass cookie
    {
      name: '__e2e_bypass',
      value: 'true',
      domain,
      path: '/',
    },
  ]

  // Add Vercel deployment protection bypass if secret is provided
  if (vercelBypassSecret) {
    cookies.push({
      name: 'vercel-protection-bypass',
      value: vercelBypassSecret,
      domain,
      path: '/',
    })
  }

  await context.addCookies(cookies)
}
