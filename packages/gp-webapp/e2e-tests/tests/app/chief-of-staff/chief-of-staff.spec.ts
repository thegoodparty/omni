import { expect, test } from '@playwright/test'
import { setupElectedOfficeUser } from 'src/helpers/organizations'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'

// The Chief of Staff route is gated by the `chief-of-staff` + `serve-access`
// Amplitude flags (FeatureFlagGuard redirects to /dashboard when off); force
// both on via the override cookie in beforeEach so a preview reaches the route.
// The chat test drives the real Anthropic-backed agent, but that's an OUTBOUND
// call the preview's own gp-api makes (it runs on the dev secret) — not an
// inbound pipeline a preview can't receive — so this runs on PRs.
test.describe('Chief of Staff', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    // Force the gating flags on before the per-test auth navigation.
    await setFlagOverrides(page, {
      'chief-of-staff': 'on',
      'serve-access': 'on',
    })
  })

  test('renders the dashboard for an elected office', async ({ page }) => {
    await setupElectedOfficeUser(page)

    await page.goto('/dashboard/chief-of-staff', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    // The flag guard redirects to /dashboard when the route is gated off, so
    // staying on the route is itself the access assertion.
    await expect(page).toHaveURL(/\/dashboard\/chief-of-staff/, {
      timeout: 15_000,
    })
    await expect(
      page.getByRole('heading', { name: 'Your prioritized tasks this week' }),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('skips a card and finds it in the archive Skipped list', async ({
    page,
  }) => {
    await setupElectedOfficeUser(page)

    await page.goto('/dashboard/chief-of-staff', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    // A fresh elected office has no briefing yet, so the only cards present are
    // the static get-started onboarding cards (briefing task cards need the
    // async pipeline). The "meet" card is active until the user chats, which
    // this isolated user has not done.
    const cardTitle = 'Meet your virtual chief of staff'
    const homeCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: cardTitle })
    await expect(homeCard).toBeVisible({ timeout: 15_000 })

    await homeCard.getByRole('button', { name: 'Skip' }).click()

    // Skip persists via PUT /v1/dashboard/onboarding-cards/:key/skip and the
    // card refetches out of the active set on the home page.
    await expect(homeCard).toBeHidden({ timeout: 15_000 })

    // The skipped card moves to the archive's Skipped bucket (default tab is
    // This week, so select Skipped explicitly).
    await page.goto('/dashboard/chief-of-staff/archive', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)
    // FilterPill is a Radix single-toggle (role="radio", not button); target the
    // stable data-value it exposes for the bucket.
    await page.locator('[data-value="skipped"]').click()

    await expect(
      page.locator('[data-slot="card"]').filter({ hasText: cardTitle }),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('chat streams an assistant reply', async ({ page }) => {
    await setupElectedOfficeUser(page)

    await page.goto('/dashboard/chief-of-staff', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    await page
      .getByRole('button', { name: 'Open Chief of Staff chat' })
      .click({ timeout: 15_000 })

    const composer = page.getByRole('textbox', { name: 'Ask a question' })
    await expect(composer).toBeVisible({ timeout: 10_000 })

    const prompt = 'What is most urgent this week?'
    await composer.fill(prompt)
    await page.getByRole('button', { name: 'Send' }).click()

    const conversation = page.getByTestId('cos-conversation')
    await expect(conversation.getByText(prompt)).toBeVisible({
      timeout: 15_000,
    })

    // Tolerant of model nondeterminism: assert a substantive assistant reply
    // streamed in (the conversation grows well beyond the prompt) rather than
    // matching exact wording. The agent round-trip can be slow, so allow a
    // generous window.
    await expect
      .poll(async () => (await conversation.innerText()).length, {
        timeout: 120_000,
        intervals: [1_000],
      })
      .toBeGreaterThan(prompt.length + 80)
  })
})
