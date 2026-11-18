import { expect, type Locator, type Page } from '@playwright/test'

// Chat is moving its storage to AgentMessage behind the `chat-agent-message`
// flag, so these smoke tests prove each chat agent still sends, replies and
// reads its history back. A stubbed reply would skip the store they exist to
// prove, so every assertion rides on a LIVE model turn and is tolerant of its
// wording: a reply is measured by how much the transcript grew, never by what
// it says.

const transcriptLength = async (conversation: Locator): Promise<number> =>
  (await conversation.innerText()).length

// A surface that opens with its own turn (an ordinance step's kickoff, a typed
// greeting) is still writing when its composer first enables. Measure from a
// transcript that has stopped growing, so that opening text can never stand in
// for the reply a spec asserts on.
const settledTranscriptLength = async (
  conversation: Locator,
): Promise<number> => {
  let length = 0
  await expect(async () => {
    const before = await transcriptLength(conversation)
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const after = await transcriptLength(conversation)
    expect(after).toBe(before)
    length = after
  }).toPass({ timeout: 240_000 })
  return length
}

export interface SentTurn {
  // The transcript length the turn started from — the surface's own opening
  // text, before the prompt.
  baseline: number
  // The transcript length once the reply had settled, live.
  liveLength: number
}

// Send one visible message the way a user does, prove the message landed and a
// substantive reply streamed in, and hand back what the transcript looked like
// before and after.
export const sendChatTurn = async (args: {
  conversation: Locator
  composer: Locator
  sendButton: Locator
  prompt: string
  timeout?: number
}): Promise<SentTurn> => {
  const { conversation, composer, sendButton, prompt, timeout = 180_000 } = args

  // Every surface disables its composer while a turn is in flight, and a send
  // during one is dropped rather than queued. Read enabled twice a few seconds
  // apart, so the gap between mount and a kickoff's own send is not mistaken
  // for idle.
  await expect(async () => {
    await expect(composer).toBeEnabled({ timeout: 240_000 })
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    await expect(composer).toBeEnabled({ timeout: 5_000 })
  }).toPass({ timeout: 300_000 })

  const baseline = await settledTranscriptLength(conversation)

  await composer.fill(prompt)
  await sendButton.click()
  await expect(conversation.getByText(prompt).first()).toBeVisible({
    timeout: 30_000,
  })

  // Tolerant of model nondeterminism, the way the Chief of Staff spec is: once
  // a real reply lands, the transcript has grown well beyond the prompt.
  await expect
    .poll(() => transcriptLength(conversation), {
      timeout,
      intervals: [1_000],
    })
    .toBeGreaterThan(baseline + prompt.length + 80)

  return { baseline, liveLength: await settledTranscriptLength(conversation) }
}

// The history READ path: after the caller has reloaded and reopened the thread
// the way a user does, both the message and a reply as substantial as the live
// one are on screen. The conversation was created by the first send, so neither
// can come from component state — only from the store.
//
// The reply is measured, never matched: the model's wording is not reproducible
// from one page load to the next, and a stored turn renders through the same
// components either way. Two floors, both inside one poll so a mid-stream read
// can never be the operand:
//
// - the live turn's own growth over the pre-turn baseline, which is what
//   `sendChatTurn` asserted. A surface that opens with its own turn clears this
//   from its opening text, so it only rules out an empty reload;
// - 70% of the live transcript, which is what actually catches a lost reply,
//   while leaving room for the legitimate differences: the live-only working
//   row is gone, and a card the turn had not finished by may now be present.
export const expectTurnSurvivesReload = async (
  conversation: Locator,
  prompt: string,
  { baseline, liveLength }: SentTurn,
): Promise<void> => {
  await expect(conversation.getByText(prompt).first()).toBeVisible({
    timeout: 30_000,
  })
  await expect
    .poll(() => transcriptLength(conversation), {
      timeout: 60_000,
      intervals: [1_000],
    })
    .toBeGreaterThan(Math.max(baseline + prompt.length + 80, liveLength * 0.7))
}

// A turn's structured output, which is the part of a stored turn the read path
// rebuilds from its segments rather than its prose: a clarify question's
// options (Radix's RadioGroup renders `role="radiogroup"`, the multi-select
// variant `role="group"`).
export const clarifyCard = (conversation: Locator): Locator =>
  conversation.locator('[role="radiogroup"], [role="group"][aria-labelledby]')

// Reopen a past conversation the way a user does: the clock control in the
// footer chat pill lists the scope's conversations, titled from the first
// message sent in one, and picking one opens it.
export const reopenFromHistory = async (
  page: Page,
  title: string,
): Promise<void> => {
  await page
    .getByRole('button', { name: 'Previous conversations' })
    .click({ timeout: 15_000 })
  const thread = page.getByRole('button', { name: title, exact: true })
  await expect(thread).toBeVisible({ timeout: 30_000 })
  await thread.click()
}

// The footer chat pill's open control. Retried because a click that lands
// before the bar hydrates is a no-op, and nothing in the DOM says whether it
// has (the same retry chatAttachments.helper makes).
export const openFooterChat = async (
  page: Page,
  openLabel: string,
): Promise<void> => {
  const composer = page.getByRole('textbox', { name: 'Ask a question' })
  await expect(async () => {
    if (await composer.isVisible()) return
    await page
      .getByRole('button', { name: openLabel })
      .click({ timeout: 5_000 })
    await expect(composer).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 45_000 })
}
