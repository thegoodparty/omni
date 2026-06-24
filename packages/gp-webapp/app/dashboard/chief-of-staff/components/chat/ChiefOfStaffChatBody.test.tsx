import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { ChatStreamEvent } from '../../data/contracts'
import ChiefOfStaffChatBody from './ChiefOfStaffChatBody'
import { COS_INTRO_MESSAGES } from './chatConstants'

const createMock = vi.fn()
const listMessagesMock = vi.fn()
const listConversationsMock = vi.fn()
const streamMessageMock = vi.fn()
const softDeleteMock = vi.fn()

vi.mock('../../data/chat-api', () => ({
  chiefOfStaffChatApi: {
    createConversation: (...args: unknown[]) => createMock(...args),
    listMessages: (...args: unknown[]) => listMessagesMock(...args),
    listConversations: (...args: unknown[]) => listConversationsMock(...args),
    streamMessage: (...args: unknown[]) => streamMessageMock(...args),
    softDelete: (...args: unknown[]) => softDeleteMock(...args),
  },
}))

vi.mock('@shared/sentry', () => ({ reportErrorToSentry: vi.fn() }))

function makeStream(events: ChatStreamEvent[]): AsyncIterable<ChatStreamEvent> {
  return (async function* () {
    for (const ev of events) yield ev
  })()
}

beforeEach(() => {
  createMock.mockReset()
  listMessagesMock.mockReset()
  listConversationsMock.mockReset()
  streamMessageMock.mockReset()
  softDeleteMock.mockReset()
  window.localStorage.clear()
})

describe('<ChiefOfStaffChatBody>', () => {
  it('streams the intro on the first chat', async () => {
    listConversationsMock.mockResolvedValue([])
    render(<ChiefOfStaffChatBody active />)
    // The first intro message types in (over ~1s); waiting for the full short
    // string confirms it streamed rather than being dumped at once.
    await waitFor(
      () =>
        expect(screen.getByText(COS_INTRO_MESSAGES[0]!)).toBeInTheDocument(),
      { timeout: 4000 },
    )
  })

  it('does not play the intro once the user has prior conversations', async () => {
    listConversationsMock.mockResolvedValue([
      {
        conversationId: 'c1',
        title: 'Old chat',
        createdAt: '2026-06-14T00:00:00.000Z',
      },
    ])
    render(<ChiefOfStaffChatBody active />)
    await waitFor(() => expect(listConversationsMock).toHaveBeenCalled())
    expect(screen.queryByText(COS_INTRO_MESSAGES[0]!)).not.toBeInTheDocument()
  })

  it('does NOT create a conversation on mount (deferred create)', () => {
    render(<ChiefOfStaffChatBody active />)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('creates the conversation lazily on first send, then streams', async () => {
    const user = userEvent.setup()
    createMock.mockResolvedValue({ conversationId: 'conv_1' })
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Here to help.' },
        { type: 'done', assistantMessageId: 'asst_1' },
      ]),
    )

    render(<ChiefOfStaffChatBody active />)

    await user.type(
      screen.getByLabelText(/ask a question/i),
      'What is on my agenda?',
    )
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByText('Here to help.')).toBeInTheDocument(),
    )
    expect(streamMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv_1',
        content: 'What is on my agenda?',
      }),
    )
    // The user's own message bubble is shown.
    expect(screen.getByText('What is on my agenda?')).toBeInTheDocument()
  })

  it('renders tool calls as human-readable status lines', async () => {
    const user = userEvent.setup()
    createMock.mockResolvedValue({ conversationId: 'conv_1' })
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'tool_call', toolName: 'web_search' },
        { type: 'text', delta: 'Found it.' },
        { type: 'done' },
      ]),
    )

    render(<ChiefOfStaffChatBody active />)

    await user.type(screen.getByLabelText(/ask a question/i), 'latest news?')
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() =>
      expect(screen.getByText('Searching the web')).toBeInTheDocument(),
    )
  })

  it('replays prior messages when given a conversationIdOverride', async () => {
    listMessagesMock.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_9',
        role: 'user',
        content: 'earlier question',
        createdAt: '2026-06-14T00:00:00.000Z',
      },
      {
        id: 'm2',
        conversationId: 'conv_9',
        role: 'assistant',
        content: 'earlier answer',
        createdAt: '2026-06-14T00:00:01.000Z',
      },
    ])

    render(<ChiefOfStaffChatBody active conversationIdOverride="conv_9" />)

    await waitFor(() =>
      expect(screen.getByText('earlier question')).toBeInTheDocument(),
    )
    expect(screen.getByText('earlier answer')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
    // Intro messages are not shown when replaying an existing conversation.
    expect(screen.queryByText(COS_INTRO_MESSAGES[0]!)).not.toBeInTheDocument()
  })

  it('replays persisted tool segments in order on reload', async () => {
    listMessagesMock.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_seg',
        role: 'assistant',
        content: 'Looking... Found it.',
        createdAt: '2026-06-20T00:00:00.000Z',
        segments: [
          { kind: 'text', text: 'Looking...' },
          { kind: 'tool', toolName: 'web_search' },
          { kind: 'text', text: 'Found it.' },
        ],
      },
    ])

    render(<ChiefOfStaffChatBody active conversationIdOverride="conv_seg" />)

    await waitFor(() =>
      expect(screen.getByText('Looking...')).toBeInTheDocument(),
    )
    // Tool pill rendered between the two text blocks (base label, no args).
    expect(screen.getByText('Searching the web')).toBeInTheDocument()
    expect(screen.getByText('Found it.')).toBeInTheDocument()
  })

  it('surfaces a retryable error when the stream errors', async () => {
    const user = userEvent.setup()
    createMock.mockResolvedValue({ conversationId: 'conv_1' })
    streamMessageMock.mockReturnValue(
      makeStream([
        {
          type: 'error',
          code: 'rate_limited',
          message: 'slow down',
          retryable: true,
        },
      ]),
    )

    render(<ChiefOfStaffChatBody active />)

    await user.type(screen.getByLabelText(/ask a question/i), 'hi')
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
