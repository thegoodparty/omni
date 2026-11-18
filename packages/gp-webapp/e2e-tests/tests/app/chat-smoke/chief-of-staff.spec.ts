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
import { setupElectedOfficeUser } from 'src/helpers/organizations'

// Chief of Staff rides the `chief_of_staff` chat scope. chief-of-staff.spec.ts
// already asserts a reply streams in; this adds the half it does not cover —
// the history READ path — now that chat is moving its storage to AgentMessage
// behind `chat-agent-message`. A turn that only ever lived in component state
// would pass there and fail here.
test.describe('Chief of Staff chat', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('sends a turn, replies, and reads it back after a reload', async ({
    page,
  }) => {
    test.setTimeout(6 * 60 * 1000)
    // serveAccess() gates the route; the helper satisfies it and lands the
    // browser on /dashboard/chief-of-staff.
    await setupElectedOfficeUser(page)
    await NavigationHelper.dismissOverlays(page)
    await openFooterChat(page, 'Open Chief of Staff chat')

    const conversation = page.getByTestId('cos-conversation')
    const composer = page.getByRole('textbox', { name: 'Ask a question' })
    const prompt = 'What is most urgent this week?'
    const sent = await sendChatTurn({
      conversation,
      composer,
      sendButton: page
        .locator('form')
        .filter({ has: composer })
        .getByRole('button', { name: 'Send', exact: true }),
      prompt,
    })

    // A reload closes the drawer, so a returning user reopens the thread from
    // the chat input's history popover — which can only list this conversation
    // if the server returned it.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)
    await openFooterChat(page, 'Open Chief of Staff chat')
    await reopenFromHistory(page, prompt)

    await expectTurnSurvivesReload(conversation, prompt, sent)
  })
})
