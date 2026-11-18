import { expect, test } from 'src/fixtures/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  clarifyCards,
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

    // The clarify question is a tool call, so its options are the part of a turn
    // that is structured rather than prose. The step's own kickoff already asked
    // one question, and this turn asks another, so two cards is the floor that
    // separates "the typed turn's tool segments rendered" from "only the
    // kickoff's did". Higher is fine — the model may ask more than one.
    await expect
      .poll(() => clarifyCards(conversation).count(), {
        timeout: 60_000,
        intervals: [1_000],
      })
      .toBeGreaterThanOrEqual(2)
    // `sendChatTurn` returns only once the turn has stopped writing, so this
    // count cannot be overtaken by a card still arriving.
    const cardsLive = await clarifyCards(conversation).count()

    // A reload rebuilds the step's conversation from the server: the anchored
    // createConversation returns the same conversation, and the transcript —
    // the answer, the reply, and each clarify tool's own payload — is read back
    // by `listMessages`.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    await expectTurnSurvivesReload(conversation, prompt, sent)
    // Every clarify card the live turn showed, no more and no fewer: a stored
    // turn whose tool segments were dropped loses its card and fails here,
    // which is the half of this spec the kickoff's own card cannot cover.
    await expect
      .poll(() => clarifyCards(conversation).count(), {
        timeout: 30_000,
        intervals: [1_000],
      })
      .toBe(cardsLive)
  })
})
