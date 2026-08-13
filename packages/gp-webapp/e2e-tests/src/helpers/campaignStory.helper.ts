import type { Page } from '@playwright/test'

// Mirrors the cookie name + variant shape that gp-webapp's server-side resolver
// honors off-prod (app/shared/experiments/flagOverrides.ts) to force flag
// variants. Kept in lockstep with that file; e2e-tests can't import from app/.
const FLAG_OVERRIDE_COOKIE = 'e2e-flag-overrides'

const baseURL = process.env.BASE_URL
if (!baseURL) {
  throw new Error('BASE_URL is not set')
}
// Derive the cookie domain exactly as api-registration.ts does, so the override
// cookie shares scope with the auth cookies and is sent on the same requests.
const COOKIE_DOMAIN =
  baseURL.replace('http://', '').replace('https://', '').split('/')[0] ?? ''

// Force Amplitude flag variants for this browser context via the off-prod
// override seam, so flag-gated UX is deterministic without depending on
// Amplitude targeting for synthetic test users. Resolution is server-side
// (gp-api → Amplitude) and the browser never calls Amplitude, so this cookie —
// merged in getFlagVariants and surfaced through the SSR seed + /api/feature-flags
// — is the only lever. Maps each flag to the contract variant shape ({ value }).
export const setFlagOverrides = async (
  page: Page,
  overrides: Record<string, string>,
): Promise<void> => {
  await page.context().addCookies([
    {
      name: FLAG_OVERRIDE_COOKIE,
      value: JSON.stringify(
        Object.fromEntries(
          Object.entries(overrides).map(([key, value]) => [key, { value }]),
        ),
      ),
      domain: COOKIE_DOMAIN,
      path: '/',
      secure: true,
      sameSite: 'Lax',
    },
  ])
}

// Force `campaign-story: on`. Call BEFORE navigating/authenticating so the cookie
// is set before the first SSR render reads it.
export const enableCampaignStoryFlag = async (page: Page): Promise<void> => {
  await setFlagOverrides(page, { 'campaign-story': 'on' })
}

// Pre-accept the cookie-consent banner so its snackbar (fixed bottom-4,
// pointer-events-auto) never mounts and intercepts clicks on bottom-of-page
// controls. The banner reads `cookiesAccepted` from document.cookie once on
// mount. Mirrors serve.helper.ts.
export const acceptCookieBanner = async (page: Page): Promise<void> => {
  await page
    .context()
    .addCookies([{ name: 'cookiesAccepted', value: 'true', url: baseURL }])
}

// addCampaignStoryIssue and blockCampaignPlanGeneration were removed here.
// They existed only to author the story at the standalone
// /dashboard/campaign-story route, which no longer exists (story authoring
// moved into onboarding). Onboarding e2e coverage for story authoring is a
// follow-up; reintroduce equivalent helpers there if needed.
