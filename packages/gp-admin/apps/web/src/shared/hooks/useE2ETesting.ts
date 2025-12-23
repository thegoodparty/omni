/**
 * Detects if the app is running in E2E testing mode.
 *
 * E2E testing mode requires both:
 * 1. The NEXT_PUBLIC_E2E_TESTING env flag set to 'true'
 * 2. The __e2e_bypass cookie to be present
 *
 * This is used to bypass Clerk authentication during Playwright tests.
 */
export const isE2ETesting = (): boolean =>
  typeof document !== 'undefined' &&
  process.env.NEXT_PUBLIC_E2E_TESTING === 'true' &&
  document.cookie.includes('__e2e_bypass=true')
