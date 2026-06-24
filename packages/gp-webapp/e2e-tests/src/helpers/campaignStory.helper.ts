import type { Page, Route } from '@playwright/test'

// Mirrors the cookie + value shape that gp-webapp's getFlagVariants honors
// (non-prod only) to seed the client flag SDK. Keeps the e2e flag override in
// lockstep with app/shared/experiments/getFlagVariants.ts.
const FLAG_OVERRIDE_COOKIE = 'ff-overrides'

const baseURL = process.env.BASE_URL ?? ''
// Strip protocol, path, AND port: cookie domains never include a port, so
// Playwright's addCookies silently rejects `localhost:4000` and the override
// cookie never gets set.
const host =
  baseURL.replace('http://', '').replace('https://', '').split('/')[0] ?? ''
const COOKIE_DOMAIN = host.split(':')[0] ?? ''

// Forces Amplitude flag variants for this browser context via the non-prod
// `ff-overrides` seam, so flag-gated UX is deterministic without depending on
// Amplitude targeting. The flag reaches the browser only through gp-api's
// server-resolved seed, so this cookie (read in getFlagVariants) is the lever.
export const setFlagOverrides = async (
  page: Page,
  overrides: Record<string, string>,
): Promise<void> => {
  await page.context().addCookies([
    {
      name: FLAG_OVERRIDE_COOKIE,
      value: JSON.stringify(overrides),
      domain: COOKIE_DOMAIN,
      path: '/',
      sameSite: 'Lax',
    },
  ])
}

// Amplitude Experiment's client SDK resolves variants from this endpoint.
const AMPLITUDE_VARDATA = /\/sdk\/v2\/vardata/

// Force `campaign-story: on` deterministically. The flag reaches the browser
// only through gp-api's server-resolved seed, so:
//   1. The `ff-overrides` cookie seam seeds it on (read in getFlagVariants).
//   2. We stub the client SDK's Amplitude fetch to return on. The provider
//      discards the seed and refetches whenever it briefly resolves anonymous
//      (which happens with cookie-injected test auth, since Clerk's server-side
//      auth doesn't see the minted session). Stubbing the refetch populates the
//      client store with on, so the real off value for this out-of-segment test
//      user can never win.
// Call this BEFORE authenticating: sign-in navigates and mounts the flag
// provider, so the route must be live before any vardata request goes out.
export const enableCampaignStoryFlag = async (page: Page): Promise<void> => {
  await setFlagOverrides(page, { 'campaign-story': 'on' })
  await page.route(AMPLITUDE_VARDATA, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      // `key` + `value` covers both shapes the SDK accepts for a variant.
      body: JSON.stringify({ 'campaign-story': { key: 'on', value: 'on' } }),
    }),
  )
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
