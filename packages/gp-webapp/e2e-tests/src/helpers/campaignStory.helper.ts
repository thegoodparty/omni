import { expect, type Page, type Route } from '@playwright/test'

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
// controls (the "Add a policy priority" button, the story-ready footer). The
// banner reads `cookiesAccepted` from document.cookie once on mount. Mirrors
// serve.helper.ts.
export const acceptCookieBanner = async (page: Page): Promise<void> => {
  await page
    .context()
    .addCookies([{ name: 'cookiesAccepted', value: 'true', url: baseURL }])
}

// Add one issue via the shared PolicyPriorities editor on the story page. The
// story's issues are no longer free text — they're the Pro-upgrade editor that
// persists to the candidate's website — so a single issue is what makes the
// issues section "answered" and surfaces the story-ready footer. Waits for the
// async persist to settle so the campaign-plan gate's on-mount refetch sees it.
export const addCampaignStoryIssue = async (
  page: Page,
  issue: { title: string; description: string },
): Promise<void> => {
  await page.getByRole('button', { name: 'Add a policy priority' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('#policy-title').fill(issue.title)
  const editor = dialog.locator('.ql-editor')
  await editor.click()
  await editor.pressSequentially(issue.description)
  await dialog.getByRole('button', { name: /^Save$/ }).click()
  await expect(dialog).toBeHidden()
  await page.waitForLoadState('networkidle')
}

// The campaign plan view fires the CAP/PMF generation as same-origin client
// POSTs; gp-api only enqueues the background (SQS) generation job when those
// land. Fulfilling them in the browser means the queue dispatch never goes out,
// while the UI still sees a valid `generating` response and shows the plan view.
// Returns a counter so a test can assert generation was actually triggered
// (and thus blocked) rather than silently skipped.
export const blockCampaignPlanGeneration = async (
  page: Page,
): Promise<{ strategyPostCount: () => number }> => {
  let strategyPosts = 0

  const generating = (route: Route): Promise<void> =>
    route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'generating' }),
    })

  await page.route(
    '**/api/v1/campaignStrategy/mine/strategic-landscape',
    (route) => {
      strategyPosts += 1
      return generating(route)
    },
  )
  await page.route(
    '**/api/v1/campaignStrategy/mine/community-events',
    generating,
  )
  // The remaining plan resources are not the queue trigger, but stub them too
  // so the plan view never depends on the dev backend for unrelated sections.
  await page.route('**/api/v1/onboarding/local-news**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'pending' }),
    }),
  )

  return { strategyPostCount: () => strategyPosts }
}
