import { expect, test } from 'src/fixtures/test'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  expectTurnSurvivesReload,
  sendChatTurn,
} from 'src/helpers/chatSmoke.helper'
import { setupElectedOfficeUser } from 'src/helpers/organizations'
import { withGatewayRetry } from '@goodparty_org/test-users'

// A priority's workspace IS a chat, on the `priority_flow` scope. The other
// priority specs drive the cards and the send handoffs the model draws, but
// each seeds the priority and then works a neighbouring flow — none sends an
// ordinary turn in the conversation itself. With chat moving its storage to
// AgentMessage behind `chat-agent-message`, this sends one and reads it back
// after a reload.
//
// The workspace opens a conversation per priority, anchored on the priority id,
// so the reload path is the surface's own open: `createConversation` returns
// the same conversation and `listMessages` reads the transcript back.
test.describe('Priority chat', () => {
  test.beforeEach(async ({ page }) => {
    // The priorities segment is flag-gated server-side and redirects to Chief
    // of Staff when it reads off, so force it before the first render.
    await setFlagOverrides(page, { 'serve-priorities': 'on' })
    await blockSlowScripts(page)
  })

  test('sends a turn, replies, and reads it back after a reload', async ({
    page,
  }) => {
    test.setTimeout(6 * 60 * 1000)
    const { client } = await setupElectedOfficeUser(page)
    const { data: priority } = await withGatewayRetry(
      'POST /v1/priorities',
      () =>
        client.post<{ id: string }>('/v1/priorities', {
          title: 'Speeding on residential streets',
          description: 'Residents report cars speeding past the school.',
        }),
    )

    await page.goto(`/dashboard/priorities/${priority.id}`, {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    const conversation = page.getByTestId('priority-conversation')
    const composer = page.getByRole('textbox', {
      name: 'Message about this priority',
    })
    await expect(conversation).toBeVisible({ timeout: 60_000 })

    const prompt = 'A traffic count was done last spring. Where does that fit?'
    const sent = await sendChatTurn({
      conversation,
      composer,
      sendButton: page
        .locator('form')
        .filter({ has: composer })
        .getByRole('button', { name: 'Send', exact: true }),
      prompt,
    })

    await page.reload({ waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    await expectTurnSurvivesReload(conversation, prompt, sent)
  })
})
