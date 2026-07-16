import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, waitFor } from '@testing-library/react'
import type { ChatStreamEvent } from '../../shared/agent-chat/chatClient'
import type { Ordinance, OrdinancePresentDraft } from '@goodparty_org/contracts'
import OrdinanceFlowChat from './OrdinanceFlowChat'

// Regression guard for the "draft turn commits to an empty screen" bug. The
// draft turn ends in a present_draft tool call and a large body write, so the
// server persists it a beat later than the stream closes. When the client
// refetched the transcript immediately after `done` and swapped away the live
// turn, that refetch could predate persistence — leaving the finished turn
// showing nothing until a manual reload. The turn must never blank: the live
// render holds until the persisted history actually contains it.

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
  research: null,
  scratchpad: null,
  lastViewedStep: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

const draft: OrdinancePresentDraft = {
  title: 'AN ORDINANCE OF THE CITY TO LIMIT AMPLIFIED NOISE',
  description: 'Adds a permit system and decibel limits for outdoor events.',
  body: 'Section 1. Purpose. The City establishes noise limits...',
  sources: [],
}

const draftTurn = {
  id: 'assistant-draft-1',
  conversationId: 'conv-1',
  role: 'assistant' as const,
  content: '',
  createdAt: '2026-07-01T00:00:02.000Z',
  segments: [
    { kind: 'text' as const, text: 'Here is your first draft.' },
    { kind: 'tool' as const, toolName: 'present_draft', payload: draft },
  ],
}

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

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchOrdinanceBySlug.mockResolvedValue(ordinance)
  mocks.createConversation.mockResolvedValue({ conversationId: 'conv-1' })
  mocks.streamMessage.mockImplementation(async function* (): AsyncGenerator<
    ChatStreamEvent,
    void,
    void
  > {
    yield { type: 'text', delta: 'Here is your first draft.' }
    yield { type: 'tool_call', toolName: 'present_draft', args: draft }
    yield { type: 'done', assistantMessageId: draftTurn.id }
  })
})

describe('OrdinanceFlowChat — draft turn commit', () => {
  it('keeps the draft card visible when the post-stream refetch is a beat behind persistence', async () => {
    // Initial mount load: empty (kickoff streams the draft turn). The first
    // post-stream refetch is still empty (the turn has not persisted yet); only
    // a later refetch returns it — modeling the real persistence lag.
    mocks.listMessages
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([draftTurn])

    render(<OrdinanceFlowChat slug="public-safety-cameras" step="draft" />)

    // The draft card appears during the live turn.
    expect(
      await screen.findByText(draft.title, undefined, { timeout: 8000 }),
    ).toBeVisible()

    // It must still be there after the live turn commits to persisted history —
    // the swap must not blank the turn just because the first refetch missed it.
    await new Promise((resolve) => setTimeout(resolve, 2500))
    expect(screen.getByText(draft.title)).toBeVisible()
    expect(screen.getByText('Draft for attorney')).toBeVisible()
  }, 15000)
})
