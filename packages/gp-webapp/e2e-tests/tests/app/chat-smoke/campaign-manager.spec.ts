import { test } from 'src/fixtures/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  expectTurnSurvivesReload,
  openFooterChat,
  reopenFromHistory,
  sendChatTurn,
} from 'src/helpers/chatSmoke.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'

// The Campaign Manager's own chat scope, `campaign_assistant`. Chat is moving
// its storage to AgentMessage behind `chat-agent-message`, so this drives a
// real turn and then reads it back after a reload — the write AND read paths,
// which campaign-manager-attachments.spec.ts does not reach (it stops at the
// attachment round trip).
//
// The live model round-trip is an OUTBOUND call the preview's own gp-api makes,
// so this runs on PRs, like the Chief of Staff chat spec.
test.describe('Campaign Manager chat', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('sends a turn, replies, and reads it back after a reload', async ({
    page,
  }) => {
    test.setTimeout(6 * 60 * 1000)
    await authenticateTestUser(page, { isolated: true })

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)
    await openFooterChat(page, 'Open campaign manager chat')

    const conversation = page.getByTestId('cos-conversation')
    const composer = page.getByRole('textbox', { name: 'Ask a question' })
    const prompt = 'What should I focus on this week?'
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
    await openFooterChat(page, 'Open campaign manager chat')
    await reopenFromHistory(page, prompt)

    await expectTurnSurvivesReload(conversation, prompt, sent)
  })
})
