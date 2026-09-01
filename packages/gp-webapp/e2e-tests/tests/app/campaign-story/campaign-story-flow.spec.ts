import { expect, test } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from '../../../src/helpers/navigation.helper'
import { completeOnboardingUpToPledge } from '../../../src/helpers/onboarding.helper'
import { acceptCookieBanner } from '../../../src/helpers/campaignStory.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'

// The campaign story (three onboarding steps + the "Your story" dashboard page
// + the tracker) is the only experience — no flag override needed, no flag-off
// branch to cover.

// Card question duplicated from STORY_WHY_QUESTION in
// app/onboarding/components/storyStepCopy.ts — e2e-tests can't import from
// app/, so keep this in lockstep with that file.
const STORY_WHY_QUESTION = /why are you running/i

test.describe('campaign story flow', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    await acceptCookieBanner(page)
  })

  test('story steps render for every new candidate and are each skippable', async ({
    page,
  }) => {
    test.setTimeout(120000)
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

    // completeOnboardingUpToPledge drives through all three story steps,
    // asserting each step's heading is visible before clicking Skip — reaching
    // the pledge heading below proves every story step rendered and was
    // skippable.
    await completeOnboardingUpToPledge(page)

    await expect(
      page.getByRole('heading', { level: 1, name: /take our pledge/i }),
    ).toBeVisible()
  })

  test('onboarding pledge step routes to the Campaign Manager', async ({
    page,
  }) => {
    test.setTimeout(120000)
    await authenticateTestUser(page, {
      isolated: true,
      skipCampaignCreation: true,
    })

    await page.goto('/onboarding/office-selection')
    await NavigationHelper.dismissOverlays(page)

    await completeOnboardingUpToPledge(page)

    // The pledge CTA is "Meet your campaign manager"; submitting lands on the
    // Campaign Manager home (/dashboard), which shows the "meet your campaign
    // manager" card for a brand-new candidate (no ?personalize, so the chat
    // does not auto-open here).
    const submit = page
      .getByRole('button', { name: /meet your campaign manager/i })
      .first()
    await expect(submit).toBeVisible({ timeout: 15000 })
    await expect(submit).toBeEnabled()
    await submit.click()

    await page.waitForURL('**/dashboard', { timeout: 30000 })
    await expect(
      page.getByRole('heading', {
        name: 'Meet your virtual Campaign Manager',
        level: 2,
      }),
    ).toBeVisible({ timeout: 30000 })
  })

  test('campaign plan tab gates an incomplete story behind a link to the campaign manager', async ({
    page,
  }) => {
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

    // The gate's incomplete-state CTA links to /dashboard?personalize=1, which
    // opens the Campaign Manager chat straight into the story intake (rather
    // than showing the meet-card home), so assert the intake copy the chat
    // streams, not the meet-card heading (which is hidden once the chat opens).
    await page
      .getByRole('link', { name: /open your campaign manager/i })
      .click()
    await page.waitForURL('**/dashboard**', { timeout: 30000 })
    await expect(page.getByText(/get your Campaign Story down/i)).toBeVisible({
      timeout: 30000,
    })
  })

  test('"Your story" nav item is visible and the plan tab reads "Campaign Tracker"', async ({
    page,
  }) => {
    await authenticateTestUser(page, { isolated: true })

    await page.goto('/dashboard')
    await NavigationHelper.dismissOverlays(page)

    await expect(page.locator('#campaign-story-dashboard')).toBeVisible()
    await expect(page.locator('#campaign-plan-dashboard')).toHaveText(
      /campaign tracker/i,
    )
  })

  test('/dashboard/campaign-story renders the editor and persists a saved answer', async ({
    page,
  }) => {
    await authenticateTestUser(page, { isolated: true })

    await page.goto('/dashboard/campaign-story')

    // No guard redirect: the "Your story" navHeader renders directly.
    await expect(
      page.getByRole('heading', { level: 1, name: 'Your story' }),
    ).toBeVisible({ timeout: 15000 })

    await expect(
      page.getByRole('heading', { level: 2, name: STORY_WHY_QUESTION }),
    ).toBeVisible()

    const whyField = page.getByRole('textbox').first()
    const whyAnswer = `I'm running because my community deserves better — ${Date.now()}`
    await whyField.fill(whyAnswer)

    // The page-level Save button is portaled into the navHeader bar via
    // DashboardNavHeaderAction.
    const saveButton = page.getByRole('button', { name: 'Save' })
    await expect(saveButton).toBeEnabled()
    await saveButton.click()
    await expect(saveButton).toBeDisabled({ timeout: 15000 })

    await page.reload()

    await expect(
      page.getByRole('heading', { level: 1, name: 'Your story' }),
    ).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('textbox').first()).toHaveValue(whyAnswer, {
      timeout: 15000,
    })
  })
})
