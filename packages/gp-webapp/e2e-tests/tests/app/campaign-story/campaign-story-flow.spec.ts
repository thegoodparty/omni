import { expect, type Page, test } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from '../../../src/helpers/navigation.helper'
import { completeOnboardingUpToPledge } from '../../../src/helpers/onboarding.helper'
import {
  acceptCookieBanner,
  addCampaignStoryIssue,
  blockCampaignPlanGeneration,
  enableCampaignStoryFlag,
} from '../../../src/helpers/campaignStory.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'

// campaign-story is resolved server-side (gp-api -> Amplitude) and seeded into
// the client, so there is no browser network call to stub. enableCampaignStoryFlag
// sets the off-prod `e2e-flag-overrides` cookie that getFlagVariants merges over
// the gp-api result (and surfaces through the SSR seed + /api/feature-flags), so
// the flag is forced on deterministically — independent of Amplitude targeting,
// so these run on every PR (no @dev-only).

const STORY_ANSWERS = {
  why: 'I am running because our roads have been neglected for a decade and my neighbors deserve a council member who answers the phone.',
  background:
    'I grew up here, taught at the local high school for fifteen years, and have volunteered on the parks board since 2019.',
} as const

// Issues are no longer a free-text story field — they're structured website
// issues (title + rich-text description) edited via the shared PolicyPriorities
// editor. One issue is what makes the issues section "answered".
const STORY_ISSUE = {
  title: 'Fix the roads',
  // The PolicyPriorities "policy focus" requires a 100-character (plain-text)
  // minimum, so keep this comfortably above it.
  description:
    'Repave Main Street and replace the aging water lines before they fail, then fund the after-school programs and neighborhood street lighting residents have gone without for years.',
} as const

// Fill one story card and trigger its save via the explicit Save button (more
// deterministic than relying on the blur autosave), then wait for the persisted
// "Saved" state so the answer is durable before we navigate to the plan tab.
// Scoped by the card's stable data-testid (campaign-story-card-<field>) so the
// Save button relabeling to "Saved" mid-flow can't shift the card locator.
//
// `why` is the candidate's website bio now, edited via a RichEditor (Quill) that
// persists with saveAboutFields — so it has no plain textbox; type into the
// `.ql-editor` contenteditable. `background` is still a plain-text story field.
const fillStoryCard = async (
  page: Page,
  field: 'why' | 'background',
  value: string,
): Promise<void> => {
  const card = page.getByTestId(`campaign-story-card-${field}`)
  if (field === 'why') {
    const editor = card.locator('.ql-editor')
    await editor.click()
    await editor.pressSequentially(value)
  } else {
    await card.getByRole('textbox').fill(value)
  }
  await card.getByRole('button', { name: /^Save$/ }).click()
  await expect(card.getByRole('button', { name: /^Saved$/ })).toBeVisible()
}

test.describe('campaign-story flag flow', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    await acceptCookieBanner(page)
  })

  test('onboarding pledge step routes campaign-story users to their story', async ({
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
    // generating a plan — and submitting lands on the Campaign Story page.
    const submit = page
      .getByRole('button', { name: /let's create your story/i })
      .first()
    await expect(submit).toBeVisible({ timeout: 15000 })
    await expect(submit).toBeEnabled()
    await submit.click()

    await page.waitForURL('**/dashboard/campaign-story', { timeout: 30000 })
    await expect(
      page.getByRole('heading', { name: 'Campaign Story', level: 2 }),
    ).toBeVisible({ timeout: 30000 })
  })

  test('campaign plan tab gates an incomplete story behind a link to it', async ({
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

    await page.getByRole('link', { name: /go to campaign story/i }).click()
    await page.waitForURL('**/dashboard/campaign-story', { timeout: 30000 })
    await expect(
      page.getByRole('heading', { name: 'Campaign Story', level: 2 }),
    ).toBeVisible()
  })

  test('completing the story unlocks generation without enqueuing a job', async ({
    page,
  }) => {
    // Set the override cookie before auth so the first SSR render already sees it.
    await enableCampaignStoryFlag(page)
    await authenticateTestUser(page, { isolated: true })
    const generation = await blockCampaignPlanGeneration(page)

    await page.goto('/dashboard/campaign-story')
    await expect(
      page.getByRole('heading', { name: 'Campaign Story', level: 2 }),
    ).toBeVisible({ timeout: 30000 })

    // No footer until why + background are written AND at least one issue exists.
    const readyFooter = page.getByText(/your campaign story is ready/i)
    await expect(readyFooter).toBeHidden()

    await fillStoryCard(page, 'why', STORY_ANSWERS.why)
    await fillStoryCard(page, 'background', STORY_ANSWERS.background)
    // Issues are the website-issues editor now — add one through it.
    await addCampaignStoryIssue(page, STORY_ISSUE)

    // The "story ready" footer appears and sends the user to the plan tab.
    await expect(readyFooter).toBeVisible()
    await page.getByRole('link', { name: /generate my campaign plan/i }).click()
    await page.waitForURL('**/dashboard/campaign-plan', { timeout: 30000 })

    // The plan gate now shows the completed-story review: the why/background
    // answers plus the issue (by title) under "Your issues", and a real CTA.
    await expect(
      page.getByRole('heading', { name: /ready to build your campaign plan/i }),
    ).toBeVisible({ timeout: 30000 })
    await expect(page.getByText(STORY_ANSWERS.why).first()).toBeVisible()
    await expect(page.getByText(STORY_ISSUE.title).first()).toBeVisible()

    // Generating goes through a confirm dialog before kicking off.
    await page
      .getByRole('button', { name: /generate my campaign plan/i })
      .click()
    await page.getByRole('button', { name: /yes, generate my plan/i }).click()

    // Generation started — the plan view replaces the gate — and the CAP/PMF
    // POST was attempted but fulfilled in-browser, so no SQS job was enqueued.
    await expect(
      page.getByRole('heading', { name: /ready to build your campaign plan/i }),
    ).toBeHidden({ timeout: 30000 })
    await expect
      .poll(() => generation.strategyPostCount(), { timeout: 30000 })
      .toBeGreaterThan(0)
  })
})
