import { expect, test } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from '../../../src/helpers/navigation.helper'
import { completeOnboardingUpToPledge } from '../../../src/helpers/onboarding.helper'
import {
  acceptCookieBanner,
  enableCampaignStoryFlag,
} from '../../../src/helpers/campaignStory.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'

// campaign-story is resolved server-side (gp-api -> Amplitude) and seeded into
// the client, so there is no browser network call to stub. enableCampaignStoryFlag
// sets the off-prod `e2e-flag-overrides` cookie that getFlagVariants merges over
// the gp-api result (and surfaces through the SSR seed + /api/feature-flags), so
// the flag is forced on deterministically — independent of Amplitude targeting,
// so these run on every PR (no @dev-only).

// Story authoring moved from the standalone /dashboard/campaign-story route
// (removed) into onboarding, so the "author the story, then generate a plan"
// end-to-end coverage that used to live here (fillStoryCard/STORY_ANSWERS/
// STORY_ISSUE and the addCampaignStoryIssue/blockCampaignPlanGeneration
// helpers) was removed along with it. Onboarding e2e coverage for story
// authoring is a follow-up.

test.describe('campaign-story flag flow', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    await acceptCookieBanner(page)
  })

  test('onboarding pledge step routes campaign-story users to the Campaign Manager', async ({
    page,
  }) => {
    await enableCampaignStoryFlag(page)
    // Set the user up via the backend helper (long-lived 1h token) rather than
    // the Clerk sign-up form: a browser-minted session token expires after 60s
    // and would silently 401 mid-onboarding on a cold runner (see
    // e2e-tests/CLAUDE.md). skipCampaignCreation leaves the user campaign-less
    // so the onboarding flow still runs from the start.
    await authenticateTestUser(page, {
      isolated: true,
      skipCampaignCreation: true,
    })

    // /onboarding/office-selection renders OnboardingFlow from the welcome step
    // (no /onboarding root exists); a campaign-less user starts the flow here,
    // same as the post-sign-up redirect target.
    await page.goto('/onboarding/office-selection')
    await NavigationHelper.dismissOverlays(page)

    await completeOnboardingUpToPledge(page)

    // For campaign-story users the pledge CTA points at writing the story, not
    // generating a plan — and submitting lands on the Campaign Manager home
    // (/dashboard), whose chat opens with the story intake.
    const submit = page
      .getByRole('button', { name: /let's create your story/i })
      .first()
    await expect(submit).toBeVisible({ timeout: 15000 })
    await expect(submit).toBeEnabled()
    await submit.click()

    await page.waitForURL('**/dashboard', { timeout: 30000 })
    await expect(
      page.getByRole('heading', { name: 'Your campaign manager', level: 1 }),
    ).toBeVisible({ timeout: 30000 })
  })

  test('campaign plan tab gates an incomplete story behind a link to the campaign manager', async ({
    page,
  }) => {
    // Set the override cookie before auth so the first SSR render already sees it.
    await enableCampaignStoryFlag(page)
    // Dedicated user: this scenario depends on the story being empty, so it
    // must not share an account another test may have filled in.
    await authenticateTestUser(page, { isolated: true })

    await page.goto('/dashboard/campaign-plan')

    // No plan + incomplete story -> the gate, not a redirect to /dashboard.
    await expect(
      page.getByRole('heading', {
        name: /your campaign plan starts with your story/i,
      }),
    ).toBeVisible({ timeout: 30000 })

    // The gate's incomplete-state CTA now sends the user to the Campaign
    // Manager home to author their story there (onboarding), not to a
    // standalone story route.
    await page
      .getByRole('link', { name: /open your campaign manager/i })
      .click()
    await page.waitForURL('**/dashboard', { timeout: 30000 })
    await expect(
      page.getByRole('heading', { name: 'Your campaign manager', level: 1 }),
    ).toBeVisible({ timeout: 30000 })
  })
})
