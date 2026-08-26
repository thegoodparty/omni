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

  // Reading back while the agent is still typing (pilot feedback: the chat
  // "requires the user to stay with the ai"). The reply is stubbed at the
  // network layer so the reveal runs long enough to scroll into and the
  // assertions don't ride on model latency.
  test.describe('scroll-back during a stream', () => {
    // The Serwist service worker serves same-origin GETs from inside the
    // worker, where page.route never sees them, so the transcript stub would
    // leak to the real gp-api. Same reason as the CRM assistant spec.
    test.use({ serviceWorkers: 'block' })

    const PROMPT = 'Summarize everything on my plate this week'
    const CONVERSATION_ID = 'e2e-cos-scroll'
    const ASSISTANT_MESSAGE_ID = 'e2e-cos-assistant-1'
    // Long enough that the reveal (one step per 24ms frame) types for several
    // seconds and overflows the transcript by many screens.
    const REPLY = Array.from(
      { length: 40 },
      (_, i) =>
        `Item ${i + 1}. This is a long enough paragraph of stubbed assistant text that the transcript overflows its container and keeps growing while the reader tries to scroll back up through it.`,
    ).join('\n\n')

    const sseBody = [
      `data: ${JSON.stringify({ type: 'text', delta: REPLY })}`,
      `data: ${JSON.stringify({ type: 'done', assistantMessageId: ASSISTANT_MESSAGE_ID })}`,
      '',
    ].join('\n\n')

    test('a scroll-up mid-stream holds its position instead of snapping back', async ({
      page,
    }) => {
      test.setTimeout(3 * 60 * 1000)
      await setupElectedOfficeUser(page)

      let transcriptCalls = 0
      await page.route(/\/api\/v1\/chats(\?|$)/, (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({
              json: { conversationId: CONVERSATION_ID, created: true },
            })
          : route.fulfill({ json: { conversations: [] } }),
      )
      await page.route(
        new RegExp(`/api/v1/chats/${CONVERSATION_ID}\\?`),
        (route) => {
          transcriptCalls += 1
          return route.fulfill({
            json: {
              conversationId: CONVERSATION_ID,
              messages:
                transcriptCalls === 1
                  ? []
                  : [
                      {
                        id: 'e2e-cos-user-1',
                        conversationId: CONVERSATION_ID,
                        role: 'user',
                        content: PROMPT,
                        createdAt: new Date().toISOString(),
                      },
                      {
                        id: ASSISTANT_MESSAGE_ID,
                        conversationId: CONVERSATION_ID,
                        role: 'assistant',
                        content: REPLY,
                        createdAt: new Date().toISOString(),
                      },
                    ],
            },
          })
        },
      )
      await page.route(
        new RegExp(`/api/v1/chats/${CONVERSATION_ID}/messages`),
        (route) =>
          route.fulfill({
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
            body: sseBody,
          }),
      )

      await page.goto('/dashboard/chief-of-staff', {
        waitUntil: 'domcontentloaded',
      })
      await NavigationHelper.dismissOverlays(page)

      // Retry the open: a click that lands before the footer bar has hydrated
      // is a no-op, and nothing about the DOM says whether it has.
      const composer = page.getByRole('textbox', { name: 'Ask a question' })
      await expect(async () => {
        await page
          .getByRole('button', { name: 'Open Chief of Staff chat' })
          .click({ timeout: 5_000 })
        await expect(composer).toBeVisible({ timeout: 3_000 })
      }).toPass({ timeout: 45_000 })

      await composer.fill(PROMPT)
      await page.getByRole('button', { name: 'Send' }).click()

      const conversation = page.getByTestId('cos-conversation')
      const metrics = () =>
        conversation.evaluate((el) => ({
          top: el.scrollTop,
          bottomGap: el.scrollHeight - el.scrollTop - el.clientHeight,
          height: el.scrollHeight,
        }))

      // Wait until the reveal has filled the transcript past a screenful, so
      // there is something above the fold to scroll back to.
      await expect
        .poll(async () => (await metrics()).height, {
          timeout: 60_000,
          intervals: [250],
        })
        .toBeGreaterThan(1_200)

      // Scroll back the way a trackpad does — a burst of small deltas across
      // several frames, not one jump — so the gesture overlaps the reveal's
      // follow-scroll writes the way a reader's does.
      await conversation.hover()
      for (let i = 0; i < 8; i++) {
        await page.mouse.wheel(0, -120)
        await page.waitForTimeout(40)
      }
      const afterWheel = await metrics()
      expect(afterWheel.bottomGap).toBeGreaterThan(400)

      // Hold while the reply keeps typing: the transcript must keep growing
      // (proving the stream is still live) without dragging the reader back
      // down to the bottom.
      await page.waitForTimeout(2_000)
      const held = await metrics()
      expect(held.height).toBeGreaterThan(afterWheel.height)
      expect(held.top).toBeLessThanOrEqual(afterWheel.top + 8)

      // Returning to the bottom re-arms the follow-scroll.
      for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 4_000)
      await expect
        .poll(async () => (await metrics()).bottomGap, {
          timeout: 15_000,
          intervals: [250],
        })
        .toBeLessThan(40)
    })
  })
})
