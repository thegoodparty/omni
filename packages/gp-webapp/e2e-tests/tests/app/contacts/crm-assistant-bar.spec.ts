import { expect, test } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  acceptCookieBanner,
  setFlagOverrides,
} from 'src/helpers/campaignStory.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'

// The CRM contacts assistant bar (ENG-10737). Client-side gating (win-voter-
// data + win-crm) is forced via the off-prod flag-override cookie, and the
// whole chat round trip is stubbed at the network layer — the smoke covers the
// surface (bar renders, accepts input, opens the drawer, streams a turn),
// never a live LLM reply. Flag-off behavior stays covered by the existing
// contacts specs, which this file does not touch.
const CONVERSATION_ID = 'e2e-conversation'
const ASSISTANT_MESSAGE_ID = 'e2e-assistant-1'
const USER_PROMPT = 'Build me a list of young supporters'
const ASSISTANT_REPLY = 'Here is your list of young supporters.'

const sseBody = [
  `data: ${JSON.stringify({ type: 'text', delta: ASSISTANT_REPLY })}`,
  `data: ${JSON.stringify({ type: 'done', assistantMessageId: ASSISTANT_MESSAGE_ID })}`,
  '',
].join('\n\n')

test.describe('CRM assistant bar', () => {
  // The production build registers the Serwist service worker (app/layout.tsx
  // -> public/sw.js), and same-origin GETs matched by its runtime caching are
  // fetched from INSIDE the worker — page.route never sees them (documented
  // Playwright limitation), so the transcript-GET stub silently leaked to the
  // real gp-api (404 on the fake conversation id -> drawer error state) once
  // the worker controlled the page. POSTs don't match the worker's caching,
  // which is why only the GET stub broke. Block service workers so every stub
  // intercepts deterministically.
  test.use({ serviceWorkers: 'block' })

  test('flag-on: bar visible, accepts input, streams a stubbed turn', async ({
    page,
  }) => {
    test.setTimeout(2 * 60 * 1000)
    await blockSlowScripts(page)
    await acceptCookieBanner(page)
    await setFlagOverrides(page, { 'win-voter-data': 'on', 'win-crm': 'on' })
    await authenticateTestUser(page)

    // Stub the general-chats endpoints before any navigation. The transcript
    // is empty on the drawer's init load and carries the persisted turn
    // afterwards, mirroring the server's persistence timing so the client's
    // commit poll settles immediately.
    let capturedScope: string | null = null
    let transcriptCalls = 0
    await page.route(/\/api\/v1\/chats(\?|$)/, (route) => {
      if (route.request().method() === 'POST') {
        capturedScope =
          (route.request().postDataJSON() as { scope?: string }).scope ?? null
        return route.fulfill({
          json: { conversationId: CONVERSATION_ID, created: true },
        })
      }
      return route.fulfill({ json: { conversations: [] } })
    })
    await page.route(
      new RegExp(`/api/v1/chats/${CONVERSATION_ID}\\?`),
      (route) => {
        transcriptCalls += 1
        const messages =
          transcriptCalls === 1
            ? []
            : [
                {
                  id: 'e2e-user-1',
                  conversationId: CONVERSATION_ID,
                  role: 'user',
                  content: USER_PROMPT,
                  createdAt: new Date().toISOString(),
                },
                {
                  id: ASSISTANT_MESSAGE_ID,
                  conversationId: CONVERSATION_ID,
                  role: 'assistant',
                  content: ASSISTANT_REPLY,
                  createdAt: new Date().toISOString(),
                },
              ]
        return route.fulfill({
          json: { conversationId: CONVERSATION_ID, messages },
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

    await page.goto('/dashboard/contacts', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    // The bar is the persistent pill pinned to the bottom of the CRM page.
    const bar = page.getByTestId('crm-assistant-bar')
    await expect(bar).toBeVisible({ timeout: 30000 })
    await expect(
      bar.getByRole('button', { name: 'Previous conversations' }),
    ).toBeVisible()

    const input = page.getByTestId('crm-assistant-input')
    await expect(input).toHaveAttribute(
      'placeholder',
      "Describe the list you want and I'll make it for you",
    )
    await input.fill(USER_PROMPT)
    await expect(input).toHaveValue(USER_PROMPT)
    await input.press('Enter')

    // Submitting opens the conversation drawer, echoes the prompt, and streams
    // the (stubbed) assistant reply through the shared SSE client.
    const drawer = page.getByTestId('crm-assistant-drawer')
    await expect(drawer).toBeVisible({ timeout: 15000 })
    await expect(drawer.getByText(USER_PROMPT).first()).toBeVisible({
      timeout: 15000,
    })
    await expect(drawer.getByText(ASSISTANT_REPLY).first()).toBeVisible({
      timeout: 20000,
    })

    // A Win org must ride the campaign_assistant scope (no new ChatScope).
    expect(capturedScope).toBe('campaign_assistant')
  })
})
