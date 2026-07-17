import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
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

  it('reveals streamed text gradually instead of dumping the chunk', async () => {
    const user = userEvent.setup()
    createMock.mockResolvedValue({ conversationId: 'conv_1' })
    const long = 'word '.repeat(120).trim()
    streamMessageMock.mockReturnValue(
      makeStream([{ type: 'text', delta: long }, { type: 'done' }]),
    )

    render(<ChiefOfStaffChatBody active />)

    await user.type(screen.getByLabelText(/ask a question/i), 'go')
    await user.click(screen.getByRole('button', { name: /send/i }))

    // The reply starts appearing before the whole chunk is revealed...
    await waitFor(() => expect(screen.getByText(/^word/)).toBeInTheDocument())
    expect(screen.queryByText(long)).not.toBeInTheDocument()
    // The network phase is over, so the composer unlocks during the drain.
    expect(screen.getByLabelText(/ask a question/i)).toBeEnabled()
    // ...and finishes revealing shortly after.
    await waitFor(() => expect(screen.getByText(long)).toBeInTheDocument(), {
      timeout: 6000,
    })
  })

  it('types in a seeded assistant-only transcript instead of dumping it', async () => {
    const greeting =
      "Hi, I'm your campaign manager. I keep an eye on your plan and tell " +
      'you the two or three things that matter most this week.'
    listMessagesMock.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_greet',
        role: 'assistant',
        content: greeting,
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ])

    render(<ChiefOfStaffChatBody active conversationIdOverride="conv_greet" />)

    // Typing has begun (a prefix is visible) but the full greeting has not
    // been dumped at once.
    await waitFor(() =>
      expect(screen.getByText(/^Hi, I'm your campaign/)).toBeInTheDocument(),
    )
    expect(screen.queryByText(greeting)).not.toBeInTheDocument()
    // It finishes typing and stays (committed to history).
    await waitFor(
      () => expect(screen.getByText(greeting)).toBeInTheDocument(),
      { timeout: 6000 },
    )
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

  it('renders custom suggestions alongside a seeded greeting when showSuggestionsWithGreeting is set', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    listMessagesMock.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_greet',
        role: 'assistant',
        content: 'Welcome back to your campaign.',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ])

    render(
      <ChiefOfStaffChatBody
        active
        conversationIdOverride="conv_greet"
        showSuggestionsWithGreeting
        suggestions={[{ label: 'Tell my story', onSelect }]}
      />,
    )

    // The seeded greeting types in (playback) and the custom chip renders
    // alongside it — the default gate would hide chips while playback runs.
    await waitFor(() =>
      expect(screen.getByText(/^Welcome back/)).toBeInTheDocument(),
    )
    const chip = await screen.findByRole('button', { name: 'Tell my story' })
    await user.click(chip)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('renders the default suggestions only on an empty transcript and sends the label text on click', async () => {
    const user = userEvent.setup()
    listConversationsMock.mockResolvedValue([])
    createMock.mockResolvedValue({ conversationId: 'conv_1' })
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'On it.' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )

    render(<ChiefOfStaffChatBody active />)

    const chip = await screen.findByRole('button', {
      name: "What's most urgent this week?",
    })
    await user.click(chip)

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: "What's most urgent this week?" }),
      ),
    )
    // The clicked label becomes a real user message (default send behavior)...
    expect(
      screen.getByText("What's most urgent this week?"),
    ).toBeInTheDocument()
    // ...and the chips no longer render once the transcript is non-empty.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', {
          name: "What's most urgent this week?",
        }),
      ).not.toBeInTheDocument(),
    )
  })

  it('kicks off a hidden send that streams a reply without adding a user bubble', async () => {
    listConversationsMock.mockResolvedValue([])
    createMock.mockResolvedValue({ conversationId: 'conv_k' })
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Canned kickoff reply.' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )

    render(<ChiefOfStaffChatBody active pendingKickoff="__kickoff__" />)

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: '__kickoff__' }),
      ),
    )
    await waitFor(() =>
      expect(screen.getByText('Canned kickoff reply.')).toBeInTheDocument(),
    )
    // The kickoff message is hidden — no user bubble for it in the transcript.
    expect(screen.queryByText('__kickoff__')).not.toBeInTheDocument()
  })

  it('fires the kickoff into an override conversation without minting a new one', async () => {
    // A fresh create is mocked so that, if the kickoff wrongly raced the load,
    // it would mint this id — the assertions below prove it does not.
    createMock.mockResolvedValue({ conversationId: 'conv_new' })
    listMessagesMock.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_resume',
        role: 'user',
        content: 'earlier question',
        createdAt: '2026-07-10T00:00:00.000Z',
      },
      {
        id: 'm2',
        conversationId: 'conv_resume',
        role: 'assistant',
        content: 'earlier answer',
        createdAt: '2026-07-10T00:00:01.000Z',
      },
    ])
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Kickoff into the resumed chat.' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )

    render(
      <ChiefOfStaffChatBody
        active
        conversationIdOverride="conv_resume"
        pendingKickoff="__kickoff__"
      />,
    )

    // The resumed transcript loads first...
    await waitFor(() =>
      expect(screen.getByText('earlier answer')).toBeInTheDocument(),
    )
    // ...and the kickoff streams its reply.
    await waitFor(() =>
      expect(
        screen.getByText('Kickoff into the resumed chat.'),
      ).toBeInTheDocument(),
    )

    // It never minted a fresh conversation for the override.
    expect(createMock).not.toHaveBeenCalled()
    // The kickoff targeted the resumed conversation, not a new one.
    expect(streamMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv_resume',
        content: '__kickoff__',
      }),
    )
    // It fired exactly once (not re-fired on re-render).
    expect(streamMessageMock).toHaveBeenCalledTimes(1)
    // The hidden kickoff prompt is not shown.
    expect(screen.queryByText('__kickoff__')).not.toBeInTheDocument()
  })

  it('focuses the composer when a suggestion requests it via composerRef', async () => {
    const user = userEvent.setup()
    listConversationsMock.mockResolvedValue([])
    const composerRef = createRef<HTMLInputElement>()

    render(
      <ChiefOfStaffChatBody
        active
        composerRef={composerRef}
        suggestions={[
          {
            label: 'Focus composer',
            onSelect: () => composerRef.current?.focus(),
          },
        ]}
      />,
    )

    const chip = await screen.findByRole('button', { name: 'Focus composer' })
    expect(screen.getByLabelText(/ask a question/i)).not.toHaveFocus()
    await user.click(chip)
    expect(screen.getByLabelText(/ask a question/i)).toHaveFocus()
  })
})
