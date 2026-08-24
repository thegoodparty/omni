import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import AiChatBody from './AiChatBody'
import type { AiChatClient, AiChatConfig, ChatStreamEvent } from './types'

vi.mock('@shared/sentry', () => ({ reportErrorToSentry: vi.fn() }))

// Dictation touches browser media APIs; stub it so the composer stays inert.
vi.mock('app/dashboard/shared/dictation/useDictationAppend', () => ({
  useDictationAppend: () => ({
    status: 'idle',
    error: null,
    partialTranscript: '',
    active: false,
    busy: false,
    toggle: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }),
}))

const createConversation = vi.fn()
const listMessages = vi.fn()
const listConversations = vi.fn()
const streamMessage = vi.fn()
const softDelete = vi.fn()

const chatApi: AiChatClient = {
  createConversation,
  listMessages,
  listConversations,
  streamMessage,
  softDelete,
}

const config: AiChatConfig = {
  title: 'Test Assistant',
  placeholder: 'How can I help?',
  introSeenKey: 'test-ai-chat-intro',
}

function makeStream(events: ChatStreamEvent[]): AsyncIterable<ChatStreamEvent> {
  return (async function* () {
    for (const ev of events) yield ev
  })()
}

// The composer has no aria-label; it is found by its placeholder.
const composer = (): HTMLElement =>
  screen.getByPlaceholderText(/how can i help/i)

beforeEach(() => {
  createConversation.mockReset()
  listMessages.mockReset()
  listConversations.mockReset()
  streamMessage.mockReset()
  softDelete.mockReset()
  // The engine reconciles against the persisted transcript after a turn, so
  // listMessages must always resolve to an array; individual tests override it
  // with the finished turn where the assertion depends on the reconciled view.
  listMessages.mockResolvedValue([])
  window.localStorage.clear()
})

describe('<AiChatBody>', () => {
  it('does NOT create a conversation on mount (deferred create)', () => {
    render(<AiChatBody chatApi={chatApi} config={config} active />)
    expect(createConversation).not.toHaveBeenCalled()
  })

  it('creates the conversation lazily on first send, then streams the reply', async () => {
    const user = userEvent.setup()
    createConversation.mockResolvedValue({ conversationId: 'conv_1' })
    streamMessage.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Here to help.' },
        { type: 'done', assistantMessageId: 'asst_1' },
      ]),
    )
    // The reconciled transcript the engine swaps in once the turn persists.
    listMessages.mockResolvedValue([
      {
        id: 'u1',
        conversationId: 'conv_1',
        role: 'user',
        content: 'What next?',
        createdAt: '2026-06-14T00:00:00.000Z',
      },
      {
        id: 'asst_1',
        conversationId: 'conv_1',
        role: 'assistant',
        content: 'Here to help.',
        createdAt: '2026-06-14T00:00:01.000Z',
      },
    ])

    render(<AiChatBody chatApi={chatApi} config={config} active />)

    await user.type(composer(), 'What next?')
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(createConversation).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByText('Here to help.')).toBeInTheDocument(),
    )
    expect(streamMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv_1',
        content: 'What next?',
      }),
    )
    // The user's own message bubble is shown.
    expect(screen.getByText('What next?')).toBeInTheDocument()
  })

  it('does not send on the Enter that commits an IME composition', async () => {
    const user = userEvent.setup()
    createConversation.mockResolvedValue({ conversationId: 'conv_1' })
    streamMessage.mockReturnValue(
      makeStream([{ type: 'done', assistantMessageId: 'asst_1' }]),
    )

    render(<AiChatBody chatApi={chatApi} config={config} active />)
    const input = composer()
    await user.type(input, 'partial draft')

    // Enter while an IME candidate is being committed must not send.
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(createConversation).not.toHaveBeenCalled()
    expect(streamMessage).not.toHaveBeenCalled()

    // The plain Enter once composition has finished does send.
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(createConversation).toHaveBeenCalledTimes(1))
    expect(streamMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'partial draft' }),
    )
  })

  it('surfaces a retryable error when the stream errors', async () => {
    const user = userEvent.setup()
    createConversation.mockResolvedValue({ conversationId: 'conv_1' })
    streamMessage.mockReturnValue(
      makeStream([
        {
          type: 'error',
          code: 'rate_limited',
          message: 'slow down',
          retryable: true,
        },
      ]),
    )

    render(<AiChatBody chatApi={chatApi} config={config} active />)

    await user.type(composer(), 'hi')
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('replays prior messages when given a conversationIdOverride', async () => {
    listMessages.mockResolvedValue([
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

    render(
      <AiChatBody
        chatApi={chatApi}
        config={config}
        active
        conversationIdOverride="conv_9"
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('earlier question')).toBeInTheDocument(),
    )
    expect(screen.getByText('earlier answer')).toBeInTheDocument()
    expect(createConversation).not.toHaveBeenCalled()
  })

  it('aborts the in-flight stream when the surface unmounts', async () => {
    const user = userEvent.setup()
    createConversation.mockResolvedValue({ conversationId: 'conv_1' })
    let capturedSignal: AbortSignal | undefined
    streamMessage.mockImplementation(({ signal }: { signal?: AbortSignal }) => {
      capturedSignal = signal
      // Never-ending stream so it is still in flight when we unmount.
      return (async function* () {
        await new Promise(() => undefined)
      })()
    })

    const { unmount } = render(
      <AiChatBody chatApi={chatApi} config={config} active />,
    )

    await user.type(composer(), 'hang on')
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(streamMessage).toHaveBeenCalledTimes(1))
    expect(capturedSignal?.aborted).toBe(false)

    unmount()

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true))
  })
})
