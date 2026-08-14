import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type {
  ChatMessageDto,
  ChatMessageSegment,
  ChatStreamEvent,
} from '../../../shared/agent-chat/chatClient'
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

// Build a persisted transcript row. The engine reconciles against the server
// transcript once a turn's stream ends (listMessages), so streaming tests must
// resolve listMessages to the finished turn or the commit has nothing to swap in.
let seq = 0
function msg(
  role: ChatMessageDto['role'],
  content: string,
  extra?: { id?: string; segments?: ChatMessageSegment[] },
): ChatMessageDto {
  seq += 1
  return {
    id: extra?.id ?? `m${seq}`,
    conversationId: 'conv',
    role,
    content,
    createdAt: `2026-07-01T00:00:0${seq % 10}.000Z`,
    ...(extra?.segments ? { segments: extra.segments } : {}),
  }
}

beforeEach(() => {
  createMock.mockReset()
  listMessagesMock.mockReset()
  listConversationsMock.mockReset()
  streamMessageMock.mockReset()
  softDeleteMock.mockReset()
  // Default so the engine's post-turn reconcile never throws on an unmocked
  // client; tests that assert the committed transcript override this.
  listMessagesMock.mockResolvedValue([])
  seq = 0
  window.localStorage.clear()
})

describe('<ChiefOfStaffChatBody>', () => {
  it('streams the intro on the first chat', async () => {
    listConversationsMock.mockResolvedValue([])
    render(<ChiefOfStaffChatBody active />)
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
    listMessagesMock.mockResolvedValue([
      msg('user', 'What is on my agenda?'),
      msg('assistant', 'Here to help.', { id: 'asst_1' }),
    ])

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
    // The user's own message bubble is shown. Scoped to the transcript: the
    // composer is a textarea, and React keeps a controlled textarea's
    // textContent in sync with its value, so an unscoped text query would also
    // match the draft still sitting in the composer.
    expect(
      within(screen.getByTestId('cos-conversation')).getByText(
        'What is on my agenda?',
      ),
    ).toBeInTheDocument()
  })

  it('returns focus to the composer after a turn completes', async () => {
    const user = userEvent.setup()
    createMock.mockResolvedValue({ conversationId: 'conv_1' })
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'All set.' },
        { type: 'done', assistantMessageId: 'asst_1' },
      ]),
    )
    listMessagesMock.mockResolvedValue([
      msg('user', 'anything?'),
      msg('assistant', 'All set.', { id: 'asst_1' }),
    ])

    render(<ChiefOfStaffChatBody active />)

    const input = screen.getByLabelText(/ask a question/i)
    await user.type(input, 'anything?')
    // Clicking send moves focus off the input; the composer also disables while
    // the turn runs. Once it completes the input should regain focus so the
    // candidate can keep chatting without clicking back in.
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() =>
      expect(screen.getByText('All set.')).toBeInTheDocument(),
    )
    await waitFor(() => expect(input).toHaveFocus())
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
    listMessagesMock.mockResolvedValue([
      msg('user', 'latest news?'),
      msg('assistant', 'Found it.', {
        id: 'a1',
        segments: [
          { kind: 'tool', toolName: 'web_search' },
          { kind: 'text', text: 'Found it.' },
        ],
      }),
    ])

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
    listMessagesMock.mockResolvedValue([
      msg('user', 'go'),
      msg('assistant', long, { id: 'a1' }),
    ])

    render(<ChiefOfStaffChatBody active />)

    await user.type(screen.getByLabelText(/ask a question/i), 'go')
    await user.click(screen.getByRole('button', { name: /send/i }))

    // The reply starts appearing before the whole chunk is revealed...
    await waitFor(() => expect(screen.getByText(/^word/)).toBeInTheDocument())
    expect(screen.queryByText(long)).not.toBeInTheDocument()
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
      {
        timeout: 6000,
      },
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

    await waitFor(() =>
      expect(screen.getByText(/^Welcome back/)).toBeInTheDocument(),
    )
    const chip = await screen.findByRole('button', { name: 'Tell my story' })
    await user.click(chip)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('does not render suggestions with a greeting once the transcript has a real user turn (resumed conversation)', async () => {
    const onSelect = vi.fn()
    listMessagesMock.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_resume',
        role: 'assistant',
        content: 'Welcome back to your campaign.',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'm2',
        conversationId: 'conv_resume',
        role: 'user',
        content: 'earlier question',
        createdAt: '2026-07-01T00:00:01.000Z',
      },
      {
        id: 'm3',
        conversationId: 'conv_resume',
        role: 'assistant',
        content: 'earlier answer',
        createdAt: '2026-07-01T00:00:02.000Z',
      },
    ])

    render(
      <ChiefOfStaffChatBody
        active
        conversationIdOverride="conv_resume"
        showSuggestionsWithGreeting
        suggestions={[{ label: 'Tell my story', onSelect }]}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('earlier answer')).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('button', { name: 'Tell my story' }),
    ).not.toBeInTheDocument()
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
    listMessagesMock.mockResolvedValue([
      msg('user', "What's most urgent this week?"),
      msg('assistant', 'On it.', { id: 'a1' }),
    ])

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
    listMessagesMock.mockResolvedValue([
      msg('user', '__kickoff__'),
      msg('assistant', 'Canned kickoff reply.', { id: 'a1' }),
    ])

    render(<ChiefOfStaffChatBody active pendingKickoff="__kickoff__" />)

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: '__kickoff__' }),
      ),
    )
    await waitFor(() =>
      expect(screen.getByText('Canned kickoff reply.')).toBeInTheDocument(),
    )
    // The kickoff message is hidden, no user bubble for it in the transcript.
    expect(screen.queryByText('__kickoff__')).not.toBeInTheDocument()
  })

  it('fires the kickoff into an override conversation without minting a new one', async () => {
    // A fresh create is mocked so that, if the kickoff wrongly raced the load,
    // it would mint this id; the assertions below prove it does not.
    createMock.mockResolvedValue({ conversationId: 'conv_new' })
    const reload = [
      {
        id: 'm1',
        conversationId: 'conv_resume',
        role: 'user' as const,
        content: 'earlier question',
        createdAt: '2026-07-10T00:00:00.000Z',
      },
      {
        id: 'm2',
        conversationId: 'conv_resume',
        role: 'assistant' as const,
        content: 'earlier answer',
        createdAt: '2026-07-10T00:00:01.000Z',
      },
    ]
    // First call is the reload; the post-kickoff reconcile adds the hidden
    // kickoff turn and its reply.
    listMessagesMock
      .mockResolvedValueOnce(reload)
      .mockResolvedValue([
        ...reload,
        msg('user', '__kickoff__'),
        msg('assistant', 'Kickoff into the resumed chat.', { id: 'a1' }),
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

  it('re-fires the kickoff when pendingKickoff is cleared then re-set to the same value (close/reopen)', async () => {
    listConversationsMock.mockResolvedValue([])
    createMock.mockResolvedValue({ conversationId: 'conv_k' })
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Kickoff reply.' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )
    listMessagesMock.mockResolvedValue([
      msg('user', '__kickoff__'),
      msg('assistant', 'Kickoff reply.', { id: 'a1' }),
    ])

    const { rerender } = render(
      <ChiefOfStaffChatBody active pendingKickoff="__kickoff__" />,
    )

    await waitFor(() => expect(streamMessageMock).toHaveBeenCalledTimes(1))

    // Parent clears the kickoff on close (surface still mounted)...
    rerender(<ChiefOfStaffChatBody active={false} />)
    // ...then re-opens with the SAME sentinel on the still-mounted body.
    rerender(<ChiefOfStaffChatBody active pendingKickoff="__kickoff__" />)

    // The kickoff fires a second time, so the story flow can restart.
    await waitFor(() => expect(streamMessageMock).toHaveBeenCalledTimes(2))
  })

  it('does not fire the kickoff twice on a re-render that keeps pendingKickoff set', async () => {
    listConversationsMock.mockResolvedValue([])
    createMock.mockResolvedValue({ conversationId: 'conv_k' })
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Kickoff reply.' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )
    listMessagesMock.mockResolvedValue([
      msg('user', '__kickoff__'),
      msg('assistant', 'Kickoff reply.', { id: 'a1' }),
    ])

    const { rerender } = render(
      <ChiefOfStaffChatBody active pendingKickoff="__kickoff__" />,
    )

    await waitFor(() => expect(streamMessageMock).toHaveBeenCalledTimes(1))

    // A re-render with the same value must not re-fire it.
    rerender(<ChiefOfStaffChatBody active pendingKickoff="__kickoff__" />)
    await waitFor(() =>
      expect(screen.getByText('Kickoff reply.')).toBeInTheDocument(),
    )
    expect(streamMessageMock).toHaveBeenCalledTimes(1)
  })

  it('hides the with-greeting chips after a hidden kickoff send (no user turn)', async () => {
    const user = userEvent.setup()
    createMock.mockResolvedValue({ conversationId: 'conv_greet' })
    const greeting = {
      id: 'm1',
      conversationId: 'conv_greet',
      role: 'assistant' as const,
      content: 'Welcome back to your campaign.',
      createdAt: '2026-07-01T00:00:00.000Z',
    }
    listMessagesMock
      .mockResolvedValueOnce([greeting])
      .mockResolvedValue([
        greeting,
        msg('user', '__kick__'),
        msg('assistant', 'Tell me your why.', { id: 'a1' }),
      ])
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Tell me your why.' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )

    render(
      <ChiefOfStaffChatBody
        active
        conversationIdOverride="conv_greet"
        showSuggestionsWithGreeting
        suggestions={[{ label: 'Personalize', kickoff: '__kick__' }]}
      />,
    )

    // The chip renders alongside the seeded greeting...
    const chip = await screen.findByRole('button', { name: 'Personalize' })
    await user.click(chip)

    // ...the hidden kickoff streams its reply (no user bubble)...
    await waitFor(() =>
      expect(screen.getByText('Tell me your why.')).toBeInTheDocument(),
    )
    // ...and the chips are gone even though there is still no user turn.
    expect(
      screen.queryByRole('button', { name: 'Personalize' }),
    ).not.toBeInTheDocument()
  })

  it('does not show with-greeting chips when resuming a conversation that already has a kickoff reply (assistant-only, no user turn)', async () => {
    listMessagesMock.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_prior',
        role: 'assistant',
        content: 'Welcome back to your campaign.',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'm2',
        conversationId: 'conv_prior',
        role: 'assistant',
        content: 'Here is what I found for your week.',
        createdAt: '2026-07-01T00:00:01.000Z',
      },
    ])

    render(
      <ChiefOfStaffChatBody
        active
        conversationIdOverride="conv_prior"
        showSuggestionsWithGreeting
        suggestions={[{ label: 'Personalize', kickoff: '__kick__' }]}
      />,
    )

    // The prior kickoff reply loads (assistant messages, no user turn). Both
    // bubbles type in on a real interval (~900ms), overrunning waitFor's 1s
    // default on a loaded CI box.
    await waitFor(
      () =>
        expect(
          screen.getByText('Here is what I found for your week.'),
        ).toBeInTheDocument(),
      { timeout: 6000 },
    )
    // ...and the starter chips do not re-appear.
    expect(
      screen.queryByRole('button', { name: 'Personalize' }),
    ).not.toBeInTheDocument()
  })

  it('renders a suggestion description as a secondary line, and label-only when absent', async () => {
    listConversationsMock.mockResolvedValue([])

    render(
      <ChiefOfStaffChatBody
        active
        suggestions={[
          {
            label: 'Draft a fundraising email',
            description: 'A short pitch for your next event',
            onSelect: vi.fn(),
          },
          { label: 'Plain chip', onSelect: vi.fn() },
        ]}
      />,
    )

    await screen.findByRole('button', { name: /Draft a fundraising email/ })
    expect(screen.getByText('Draft a fundraising email')).toBeInTheDocument()
    expect(
      screen.getByText('A short pitch for your next event'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Plain chip' }),
    ).toBeInTheDocument()
  })

  it('fires a hidden kickoff send when a suggestion with `kickoff` is clicked', async () => {
    const user = userEvent.setup()
    listConversationsMock.mockResolvedValue([])
    createMock.mockResolvedValue({ conversationId: 'conv_kick' })
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Kicked off reply.' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )
    listMessagesMock.mockResolvedValue([
      msg('user', '__story_kickoff__'),
      msg('assistant', 'Kicked off reply.', { id: 'a1' }),
    ])

    render(
      <ChiefOfStaffChatBody
        active
        suggestions={[
          { label: 'Start my story', kickoff: '__story_kickoff__' },
        ]}
      />,
    )

    const chip = await screen.findByRole('button', { name: 'Start my story' })
    await user.click(chip)

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: '__story_kickoff__' }),
      ),
    )
    await waitFor(() =>
      expect(screen.getByText('Kicked off reply.')).toBeInTheDocument(),
    )
    // The kickoff content is hidden, no user bubble for it in the transcript.
    expect(screen.queryByText('__story_kickoff__')).not.toBeInTheDocument()
  })

  it('calls onSelect and does not send when a suggestion has no kickoff', async () => {
    const user = userEvent.setup()
    listConversationsMock.mockResolvedValue([])
    const onSelect = vi.fn()

    render(
      <ChiefOfStaffChatBody
        active
        suggestions={[{ label: 'Just select', onSelect }]}
      />,
    )

    const chip = await screen.findByRole('button', { name: 'Just select' })
    await user.click(chip)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(streamMessageMock).not.toHaveBeenCalled()
  })

  it('DEFAULT: built-in chips still render label-only and visibly send on click (regression)', async () => {
    const user = userEvent.setup()
    listConversationsMock.mockResolvedValue([])
    createMock.mockResolvedValue({ conversationId: 'conv_1' })
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'On it.' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )
    listMessagesMock.mockResolvedValue([
      msg('user', "What's most urgent this week?"),
      msg('assistant', 'On it.', { id: 'a1' }),
    ])

    render(<ChiefOfStaffChatBody active />)

    const chip = await screen.findByRole('button', {
      name: "What's most urgent this week?",
    })
    // Label-only: no extra secondary-line text node beyond the label itself.
    expect(chip.textContent).toBe("What's most urgent this week?")

    await user.click(chip)

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: "What's most urgent this week?" }),
      ),
    )
    expect(
      screen.getByText("What's most urgent this week?"),
    ).toBeInTheDocument()
  })

  it('hides a sentinel user turn from a reloaded transcript but keeps its assistant reply', async () => {
    listMessagesMock.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_hide',
        role: 'assistant',
        content: 'Welcome back to your campaign.',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'm2',
        conversationId: 'conv_hide',
        role: 'user',
        content: '__start_story__',
        createdAt: '2026-07-01T00:00:01.000Z',
      },
      {
        id: 'm3',
        conversationId: 'conv_hide',
        role: 'assistant',
        content: 'Tell me your why.',
        createdAt: '2026-07-01T00:00:02.000Z',
      },
    ])

    render(
      <ChiefOfStaffChatBody
        active
        conversationIdOverride="conv_hide"
        hiddenMessageContents={['__start_story__']}
      />,
    )

    // The assistant turns render (typed in — only assistant turns remain visible
    // once the sentinel user turn is filtered)...
    await waitFor(
      () =>
        expect(
          screen.getByText('Welcome back to your campaign.'),
        ).toBeInTheDocument(),
      { timeout: 6000 },
    )
    // ...the raw sentinel user turn is never shown as a bubble...
    expect(screen.queryByText('__start_story__')).not.toBeInTheDocument()
    // ...but its assistant reply still renders (the engine reconciles against
    // the server transcript, so only the raw sentinel string is hidden).
    await waitFor(
      () => expect(screen.getByText('Tell me your why.')).toBeInTheDocument(),
      { timeout: 6000 },
    )
  })

  it('hides the product-overview sentinel user turn but keeps its canned reply', async () => {
    listMessagesMock.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_po',
        role: 'assistant',
        content: 'Welcome back to your campaign.',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'm2',
        conversationId: 'conv_po',
        role: 'user',
        content: '__product_overview__',
        createdAt: '2026-07-01T00:00:01.000Z',
      },
      {
        id: 'm3',
        conversationId: 'conv_po',
        role: 'assistant',
        content: 'Here is what your campaign manager can do.',
        createdAt: '2026-07-01T00:00:02.000Z',
      },
    ])

    render(
      <ChiefOfStaffChatBody
        active
        conversationIdOverride="conv_po"
        hiddenMessageContents={['__start_story__', '__product_overview__']}
      />,
    )

    await waitFor(
      () =>
        expect(
          screen.getByText('Here is what your campaign manager can do.'),
        ).toBeInTheDocument(),
      { timeout: 6000 },
    )
    expect(screen.queryByText('__product_overview__')).not.toBeInTheDocument()
  })

  it('renders all messages including a sentinel when hiddenMessageContents is unset (default)', async () => {
    listMessagesMock.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_show',
        role: 'assistant',
        content: 'Welcome back to your campaign.',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'm2',
        conversationId: 'conv_show',
        role: 'user',
        content: '__start_story__',
        createdAt: '2026-07-01T00:00:01.000Z',
      },
    ])

    render(<ChiefOfStaffChatBody active conversationIdOverride="conv_show" />)

    // No filtering prop: the raw sentinel renders as a user bubble.
    await waitFor(() =>
      expect(screen.getByText('__start_story__')).toBeInTheDocument(),
    )
  })

  it('focuses the composer when a suggestion requests it via composerRef', async () => {
    const user = userEvent.setup()
    listConversationsMock.mockResolvedValue([])
    const composerRef = createRef<HTMLTextAreaElement>()

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
