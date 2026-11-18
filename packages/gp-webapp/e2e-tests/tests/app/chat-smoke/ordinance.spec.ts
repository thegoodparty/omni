import { expect, test } from 'src/fixtures/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  clarifyCard,
  expectTurnSurvivesReload,
  sendChatTurn,
} from 'src/helpers/chatSmoke.helper'
import { setupElectedOfficeUser } from 'src/helpers/organizations'
import { withGatewayRetry } from 'tests/utils/headless-user'

// Ordinance guided flow rides the `ordinance_flow` scope, one conversation per
// (ordinance, step). ordinances.spec.ts stops at creating the record — it
// navigates away from the guided flow on purpose — so no spec has ever sent a
// turn here. With chat moving its storage to AgentMessage behind
// `chat-agent-message`, this drives a real turn on the clarify step and reads
// it back after a reload.
//
// The clarify step is the one step whose whole job is a tool call
// (`ask_clarify_question`), so it is also the cheapest place to prove a turn's
// structured output — not just its prose — is rebuilt from the stored segments.
test.describe('Ordinance flow chat', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('sends a turn, replies, and reads its clarify card back after a reload', async ({
    page,
  }) => {
    test.setTimeout(6 * 60 * 1000)
    const { client } = await setupElectedOfficeUser(page)
    const { data: ordinance } = await withGatewayRetry(
      'POST /v1/ordinances',
      () =>
        client.post<{ slug: string }>('/v1/ordinances', {
          seedType: 'new',
          goalText:
            'Allow corner stores in the residential zone along Grand Avenue',
        }),
    )

    const stepPath = `/dashboard/ordinances/solve/${ordinance.slug}/clarify`
    await page.goto(stepPath, { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    const conversation = page.getByTestId('ordinance-conversation')
    const composer = page.getByRole('textbox', {
      name: 'Ask me any questions about this...',
    })
    await expect(conversation).toBeVisible({ timeout: 60_000 })

    // The step opens by sending its own hidden kickoff so the agent asks the
    // first clarify question without the official having to type anything.
    const prompt = 'Focus on the stretch north of Ninth Street.'
    const sent = await sendChatTurn({
      conversation,
      composer,
      sendButton: page
        .locator('form')
        .filter({ has: composer })
        .getByRole('button', { name: 'Send', exact: true }),
      prompt,
    })

    // A reload rebuilds the step's conversation from the server: the anchored
    // createConversation returns the same conversation, and the transcript —
    // the answer, the reply, and the clarify tool's own payload — is read back
    // by `listMessages`.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    await expectTurnSurvivesReload(conversation, prompt, sent)
    await expect(clarifyCard(conversation).first()).toBeVisible({
      timeout: 30_000,
    })
  })
})
