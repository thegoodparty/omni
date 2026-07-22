import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import type { ChatStreamEvent } from '../../shared/agent-chat/chatClient'
import type { Ordinance } from '@goodparty_org/contracts'
import OrdinanceFlowChat from './OrdinanceFlowChat'

// End-to-end guard for the "UI stuck while the backend already finished" bug.
// The assistant turn is delivered fast and in full (the backend closes the
// stream), but the advance button is gated behind the smooth-reveal type-out
// (`showOffer = liveOffer && revealDone`). The reveal runs on setInterval,
// which browsers throttle to ~1s in a hidden/backgrounded tab. We simulate the
// throttle by clamping setInterval exactly as Chrome does, and assert the
// button still surfaces in wall-clock time. (The deterministic unit guard for
// the pacing math lives in shared/agent-chat/streaming.test.ts.)

const ordinance: Ordinance = {
  id: 'ord-1',
  slug: 'public-safety-cameras',
  electedOfficeId: 'eo-1',
  status: 'in_progress',
  seedType: 'issue',
  issueSlug: 'public-safety-cameras',
  sourceLink: null,
  goalText: 'Expand public safety cameras with guardrails',
  existingLaw: null,
  clarify: null,
  clarifyAnswers: null,
  authority: null,
  comparables: null,
  draftTitle: null,
  draftBody: null,
  draftSources: null,
  qualityReport: null,
  qualityRunStatus: 'idle',
  qualityLoop: null,
  research: null,
  scratchpad: null,
  lastViewedStep: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

// A realistic recap: a long lead-in, then the offer to advance. Long enough
// that a 1s-per-tick reveal cannot drain it by tick-count alone in the window.
const RECAP =
  'The four core policy choices are now locked in: scope, timing, enforcement, and exemptions. '.repeat(
    5,
  )
// The advance button renders the flow-derived CTA for the next step
// (authority -> current_law), never the agent's offer label, so the throttle
// assertion looks for that CTA. The label fed into the offer segment below is
// deliberately ignored by the component (see the dedicated label test).
const OFFER_LABEL = 'Show me the current law'

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  listMessages: vi.fn(),
  streamMessage: vi.fn(),
  fetchOrdinanceBySlug: vi.fn(),
}))

vi.mock('../data/chat-api', () => ({
  ordinanceFlowChatApi: {
    createConversation: mocks.createConversation,
    listMessages: mocks.listMessages,
    streamMessage: mocks.streamMessage,
  },
}))

vi.mock('../data/ordinances-api', () => ({
  fetchOrdinanceBySlug: mocks.fetchOrdinanceBySlug,
}))

const realSetInterval = globalThis.setInterval
const clampSetIntervalTo = (minMs: number): void => {
  globalThis.setInterval = ((
    handler: TimerHandler,
    delay?: number,
    ...args: unknown[]
  ) =>
    realSetInterval(
      handler,
      Math.max(Number(delay) || 0, minMs),
      ...args,
    )) as typeof globalThis.setInterval
}

// One finished turn: a long recap, then the offer to advance, then `done`.
const streamRecapThenOffer = async function* (): AsyncGenerator<
  ChatStreamEvent,
  void,
  void
> {
  yield { type: 'text', delta: RECAP }
  yield {
    type: 'tool_call',
    toolName: 'offer_next_step',
    args: { label: OFFER_LABEL },
  }
  yield { type: 'done' }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchOrdinanceBySlug.mockResolvedValue(ordinance)
  mocks.createConversation.mockResolvedValue({ conversationId: 'conv-1' })
  mocks.listMessages.mockResolvedValue([])
  mocks.streamMessage.mockImplementation(streamRecapThenOffer)
})

afterEach(() => {
  globalThis.setInterval = realSetInterval
})

describe('OrdinanceFlowChat — reveal keeps up with the backend', () => {
  it('foreground tab: the advance button appears after the turn finishes', async () => {
    render(<OrdinanceFlowChat slug="public-safety-cameras" step="authority" />)
    expect(
      await screen.findByText(OFFER_LABEL, undefined, { timeout: 10000 }),
    ).toBeVisible()
  }, 15000)

  it('hidden/throttled tab: a finished turn still surfaces the advance button in wall-clock time', async () => {
    // Chrome fires setInterval ~1x/second in a backgrounded tab. Before the fix
    // the reveal advanced a fixed slice per tick, so the button stayed gated
    // for tens of seconds after the stream was done. With wall-clock pacing
    // each throttled tick catches up the frames it slept through.
    clampSetIntervalTo(1000)
    render(<OrdinanceFlowChat slug="public-safety-cameras" step="authority" />)
    expect(
      await screen.findByText(OFFER_LABEL, undefined, { timeout: 10000 }),
    ).toBeVisible()
  }, 15000)
})
