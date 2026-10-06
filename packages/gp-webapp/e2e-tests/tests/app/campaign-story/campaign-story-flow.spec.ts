import { expect, test } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from '../../../src/helpers/navigation.helper'
import { completeOnboardingUpToPledge } from '../../../src/helpers/onboarding.helper'
import { acceptCookieBanner } from '../../../src/helpers/campaignStory.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'

// The campaign story (three onboarding steps + the "Your Story" dashboard page
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

  test('onboarding pledge step routes to Home', async ({ page }) => {
    test.setTimeout(120000)
    await authenticateTestUser(page, {
      isolated: true,
      skipCampaignCreation: true,
    })

    await page.goto('/onboarding/office-selection')
    await NavigationHelper.dismissOverlays(page)

    await completeOnboardingUpToPledge(page)

    // The pledge CTA is "Get started"; submitting lands on Home (/home), whose
    // headline renders in every state (no ?personalize, so the chat does not
    // auto-open here).
    const submit = page.getByRole('button', { name: /^get started$/i }).first()
    await expect(submit).toBeVisible({ timeout: 15000 })
    await expect(submit).toBeEnabled()
    await submit.click()

    await page.waitForURL('**/home', { timeout: 30000 })
    await expect(page.locator('#next-thing-heading')).toBeVisible({
      timeout: 30000,
    })
  })

  test('campaign plan tab generates without asking, and invites the story alongside it', async ({
    page,
  }) => {
    // Dedicated user: this scenario depends on the story being empty, so it
    // must not share an account another test may have filled in.
    await authenticateTestUser(page, { isolated: true })

    await page.goto('/campaign-plan')

    // The story-pinned card is on the plan itself, so reaching it proves the
    // plan rendered rather than a gate standing in front of it.
    const storyLink = page.getByRole('link', { name: /add your story/i })
    await expect(storyLink).toBeVisible({ timeout: 30000 })

    // Nobody generates their own plan: opening the tab is the request, so
    // there is nothing here to press. Asserted by role+name rather than by
    // the old gate's heading, which would pass simply by having been deleted.
    await expect(
      page.getByRole('button', { name: /generate my campaign plan/i }),
    ).toHaveCount(0)

    // The story is still invited, via the same /home?personalize=1 deep
    // link, which opens chat straight into the story intake, so assert the
    // intake copy the chat streams.
    await storyLink.click()
    await page.waitForURL('**/home**', { timeout: 30000 })
    await expect(page.getByText(/get your Campaign Story down/i)).toBeVisible({
      timeout: 30000,
    })
  })

  test('Your story opens from the Game Plan, and the plan tab reads "Game Plan"', async ({
    page,
  }) => {
    await authenticateTestUser(page, { isolated: true })

    await page.goto('/home')
    await NavigationHelper.dismissOverlays(page)

    await expect(page.locator('#campaign-plan-dashboard')).toHaveText(
      /^game plan$/i,
    )
    await expect(page.locator('#campaign-story-dashboard')).toHaveCount(0)

    await page.goto('/campaign-plan')
    await page.getByRole('link', { name: /Your story/ }).click()
    await page.waitForURL('**/campaign-story')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Your story' }),
    ).toBeVisible({ timeout: 15000 })
  })

  test('/campaign-story renders the editor and persists a saved answer', async ({
    page,
  }) => {
    await authenticateTestUser(page, { isolated: true })

    await page.goto('/campaign-story')

    // No guard redirect: the page's own header renders directly.
    await expect(
      page.getByRole('heading', { level: 1, name: 'Your story' }),
    ).toBeVisible({ timeout: 15000 })

    await expect(
      page.getByRole('heading', { level: 2, name: STORY_WHY_QUESTION }),
    ).toBeVisible()

    const whyField = page.getByRole('textbox').first()
    const whyAnswer = `I'm running because my community deserves better — ${Date.now()}`
    await whyField.fill(whyAnswer)

    // The page-level Save sits in the header beside the title.
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
