import { expect, test } from 'src/fixtures/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { WaitHelper } from 'src/helpers/wait.helper'
import {
  expectTurnSurvivesReload,
  sendChatTurn,
} from 'src/helpers/chatSmoke.helper'
import { setupElectedOfficeUser } from 'src/helpers/organizations'

// Briefing chat rides the `briefing_annotation` scope (POST /v1/briefing-chats).
// briefings.spec.ts covers notes only and ordinance/briefing pages have no turn
// tested at all, so this is the first spec to send one — and, with chat moving
// its storage to AgentMessage behind `chat-agent-message`, the first to read one
// back after a reload.
//
// A real briefing comes from a slow, credit-spending agent run, so this seeds
// one through the preview/dev-only POST /v1/meetings/briefings/seed endpoint.
const MEETING_DATE = '2027-04-20'

const seedBody = () => ({
  meetingDate: MEETING_DATE,
  meetingName: 'Cheyenne City Council',
  meetingTime: '19:00',
  meetingTimezone: 'America/Denver',
  location: 'Council Chambers, 2101 O Neil Ave',
  officialName: 'Test Official',
  items: [
    {
      title: 'Downtown rezoning ordinance',
      summary:
        'Staff recommends approving the mixed-use overlay district for the ' +
        'downtown corridor before the spring construction window opens.',
      budgetImpactSummary: 'A one-time $1.25M appropriation from reserves.',
      sentimentSummary: 'Residents lean supportive of denser downtown housing.',
      talkingPoints: [
        { text: 'Housing supply follows zoning', why: 'Ties to the backlog' },
        { text: 'Phase the parking minimums', why: 'Softens the transition' },
      ],
    },
    {
      title: 'Street lighting contract renewal',
      summary:
        'Renewal of the three-year LED streetlight maintenance contract.',
    },
  ],
})

test.describe('Briefing chat', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    // The Assistant button lives in the lg-only bottom bar, and the briefing's
    // scroll-spy picks its active card from the pinned viewport.
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  test('sends a turn, replies, and reads it back after a reload', async ({
    page,
  }) => {
    test.setTimeout(6 * 60 * 1000)
    const { client } = await setupElectedOfficeUser(page)
    await client.post('/v1/meetings/briefings/seed', seedBody())

    await page.goto(`/dashboard/briefings/${MEETING_DATE}`, {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)
    await WaitHelper.waitForPageReady(page)

    // The bottom bar's Assistant opens the card-level chat for whichever card is
    // active, which the layout seeds to the executive summary.
    const openAssistant = page.getByRole('button', {
      name: 'Assistant',
      exact: true,
    })
    await expect(openAssistant).toBeEnabled({ timeout: 30_000 })
    await openAssistant.click()

    const conversation = page.getByTestId('ask-ai-conversation')
    const composer = page.getByRole('textbox', {
      name: 'Ask Assistant message',
    })
    await expect(composer).toBeVisible({ timeout: 30_000 })

    const prompt = 'What is the budget impact of the first agenda item?'
    const sent = await sendChatTurn({
      conversation,
      composer,
      sendButton: page.getByRole('button', { name: 'Ask Assistant' }),
      prompt,
    })

    // The Assistant button reopens the same anchored thread (openCardLevelChat
    // focuses the chat already anchored to the active card's title) and the body
    // loads its transcript by annotation id.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)
    await WaitHelper.waitForPageReady(page)
    await expect(openAssistant).toBeEnabled({ timeout: 30_000 })
    await openAssistant.click()

    await expectTurnSurvivesReload(conversation, prompt, sent)
  })
})
