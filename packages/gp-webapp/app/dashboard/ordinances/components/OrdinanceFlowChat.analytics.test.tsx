import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EVENTS } from 'helpers/analyticsHelper'
import type {
  ChatMessageDto,
  ChatStreamEvent,
} from '../../shared/agent-chat/chatClient'
import type { Ordinance, OrdinancePresentDraft } from '@goodparty_org/contracts'
import OrdinanceFlowChat from './OrdinanceFlowChat'

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  listMessages: vi.fn(),
  streamMessage: vi.fn(),
  fetchOrdinanceBySlug: vi.fn(),
  trackEvent: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return {
    ...actual,
    trackEvent: (...args: unknown[]) => {
      mocks.trackEvent(...args)
      return Promise.resolve()
    },
  }
})

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

const assistantTurn = (
  id: string,
  segments: ChatMessageDto['segments'],
): ChatMessageDto => ({
  id,
  conversationId: 'conv-1',
  role: 'assistant',
  content: '',
  createdAt: '2026-07-01T00:00:01.000Z',
  segments,
})

const draftPayload = {
  title: 'Draft amendment to Chapter 12',
  body: 'Section 12.20  Retention.\n\n(a) Recordings shall be deleted.',
} satisfies OrdinancePresentDraft

const eventCalls = (name: string): unknown[][] =>
  mocks.trackEvent.mock.calls.filter(([n]) => n === name)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchOrdinanceBySlug.mockResolvedValue(ordinance)
  mocks.createConversation.mockResolvedValue({ conversationId: 'conv-1' })
  mocks.listMessages.mockResolvedValue([
    assistantTurn('m1', [{ kind: 'text', text: 'Welcome back.' }]),
  ])
})

describe('OrdinanceFlowChat step Viewed events', () => {
  it.each([
    ['clarify', EVENTS.Ordinances.ClarifyViewed],
    ['authority', EVENTS.Ordinances.AuthorityViewed],
    ['current_law', EVENTS.Ordinances.CurrentLawViewed],
    ['comparables', EVENTS.Ordinances.HowOthersSolvedItViewed],
    ['draft', EVENTS.Ordinances.DraftCreationViewed],
  ])('fires the %s step Viewed event once on entry', async (step, event) => {
    render(<OrdinanceFlowChat slug="public-safety-cameras" step={step} />)

    await waitFor(() => expect(eventCalls(event)).toHaveLength(1))
  })

  it.each(['intro', 'review'])(
    'fires no Ordinances Viewed event on the %s step',
    async (step) => {
      render(<OrdinanceFlowChat slug="public-safety-cameras" step={step} />)

      await screen.findByText('Welcome back.')
      const ordinanceCalls = mocks.trackEvent.mock.calls.filter(([n]) =>
        String(n).startsWith('Ordinances -'),
      )
      expect(ordinanceCalls).toHaveLength(0)
    },
  )
})

describe('OrdinanceFlowChat step Completed events', () => {
  const offerTurn = assistantTurn('m1', [
    { kind: 'text', text: 'Ready to move on.' },
    { kind: 'tool', toolName: 'offer_next_step', payload: {} },
  ])

  it.each([
    [
      'clarify',
      'Check our legal authority',
      EVENTS.Ordinances.ClarifyCompleted,
    ],
    [
      'authority',
      'Show me the current law',
      EVENTS.Ordinances.AuthorityCompleted,
    ],
    [
      'current_law',
      'See how others solved it',
      EVENTS.Ordinances.CurrentLawCompleted,
    ],
    [
      'comparables',
      'Write the first draft',
      EVENTS.Ordinances.HowOthersSolvedItCompleted,
    ],
  ])(
    'fires the %s step Completed event when advancing to the next step',
    async (step, cta, event) => {
      const user = userEvent.setup()
      mocks.listMessages.mockResolvedValue([offerTurn])

      render(<OrdinanceFlowChat slug="public-safety-cameras" step={step} />)

      await user.click(await screen.findByRole('button', { name: cta }))
      expect(eventCalls(event)).toHaveLength(1)
    },
  )
})

describe('OrdinanceFlowChat draft creation Completed', () => {
  it('fires when the draft finishes being made in chat', async () => {
    mocks.listMessages.mockResolvedValue([])
    mocks.streamMessage.mockImplementation(async function* (): AsyncGenerator<
      ChatStreamEvent,
      void,
      void
    > {
      yield {
        type: 'tool_call',
        toolName: 'present_draft',
        args: draftPayload,
      }
      yield { type: 'done' }
    })

    render(<OrdinanceFlowChat slug="public-safety-cameras" step="draft" />)

    await waitFor(() =>
      expect(eventCalls(EVENTS.Ordinances.DraftCreationCompleted)).toHaveLength(
        1,
      ),
    )
  })

  it('does not re-fire when a finished draft replays from history', async () => {
    mocks.listMessages.mockResolvedValue([
      assistantTurn('m1', [
        { kind: 'tool', toolName: 'present_draft', payload: draftPayload },
      ]),
    ])

    render(<OrdinanceFlowChat slug="public-safety-cameras" step="draft" />)

    expect(
      await screen.findByText('Draft amendment to Chapter 12'),
    ).toBeVisible()
    expect(eventCalls(EVENTS.Ordinances.DraftCreationCompleted)).toHaveLength(0)
  })
})
