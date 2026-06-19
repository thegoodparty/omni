import { expect, test } from '@playwright/test'
import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'
import { clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright'
import { NavigationHelper } from '../../src/helpers/navigation.helper'
import {
  ensureClerkPasswordFactor,
  getClerkContinueButton,
} from '../../src/helpers/clerk.helper'
import type { Page } from '@playwright/test'

// @dev-only: needs a real logged-in user enabled for campaign-story and a gp-api
// that resolves Amplitude flags server-side (PageWrapper seeds the client). Runs
// locally / against dev, not the standard CI suite. See e2e-tests/CLAUDE.md.
//
// Guards the fix for the campaign-story flag: gp-api resolves variants server
// side and PageWrapper seeds the client SDK, so the gated page renders even when
// the browser cannot reach Amplitude (ad blocker / blocked network) and without
// the pre-hydration userless evaluation that used to bounce enabled users.
//
// Worker processes don't reliably inherit the config's top-level dotenv, so load
// the e2e env here with an absolute path (worker cwd is not guaranteed).
loadEnv({ path: resolve(__dirname, '../../.env.local'), override: true })

const BASE = (process.env.BASE_URL || 'http://localhost:4000/').replace(
  /\/?$/,
  '/',
)
const STORY_PATH = '/dashboard/campaign-story'
const STORY_URL = `${BASE}dashboard/campaign-story`

const login = async (page: Page): Promise<void> => {
  const email = process.env.E2E_USER_EMAIL
  const password = process.env.E2E_USER_PASSWORD
  if (!email || !password)
    throw new Error('E2E_USER_EMAIL / E2E_USER_PASSWORD not set in env')
  await setupClerkTestingToken({ page })
  await NavigationHelper.navigateToPage(page, `${BASE}login`)
  await NavigationHelper.dismissOverlays(page)
  await page.getByLabel(/email/i).first().fill(email)
  await getClerkContinueButton(page).click()
  await ensureClerkPasswordFactor(page)
  await page
    .getByLabel(/password/i)
    .first()
    .fill(password, { timeout: 10000 })
  await getClerkContinueButton(page).click()
  await page.waitForURL('**/dashboard', { timeout: 30000 })
}

const storyHeading = (page: Page) =>
  page.getByRole('heading', { name: 'Campaign Story', level: 2 })

test.describe('campaign-story renders via server-resolved flags @dev-only', () => {
  // globalSetup discards clerkSetup()'s return and env doesn't cross into the
  // worker, so derive CLERK_FAPI / token here where setupClerkTestingToken runs.
  test.beforeAll(async () => {
    const env = (await clerkSetup()) as
      | { CLERK_FAPI?: string; CLERK_TESTING_TOKEN?: string }
      | undefined
    if (env?.CLERK_FAPI) process.env.CLERK_FAPI = env.CLERK_FAPI
    if (env?.CLERK_TESTING_TOKEN)
      process.env.CLERK_TESTING_TOKEN = env.CLERK_TESTING_TOKEN
  })

  test('renders even when the browser cannot reach Amplitude @dev-only', async ({
    page,
  }) => {
    let blocked = 0
    await page.route(/amplitude\.com/, (route) => {
      blocked += 1
      return route.abort()
    })

    await login(page)
    await page.goto(STORY_URL)

    await expect(storyHeading(page)).toBeVisible({ timeout: 30000 })
    expect(new URL(page.url()).pathname).toBe(STORY_PATH)
    // Confirms the render did not depend on the browser reaching Amplitude.
    expect(blocked).toBeGreaterThan(0)
  })

  test('renders on a cold load without bouncing @dev-only', async ({
    page,
  }) => {
    await login(page)
    await page.goto(STORY_URL)

    await expect(storyHeading(page)).toBeVisible({ timeout: 30000 })
    expect(new URL(page.url()).pathname).toBe(STORY_PATH)
  })
})
