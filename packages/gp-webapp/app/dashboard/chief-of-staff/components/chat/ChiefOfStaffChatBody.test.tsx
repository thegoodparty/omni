import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { makePerson } from '../../../contacts/crm/shared/test-fixtures'
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
const setFeedbackMock = vi.fn()
const clearFeedbackMock = vi.fn()

vi.mock('../../data/chat-api', () => ({
  chiefOfStaffChatApi: {
    createConversation: (...args: unknown[]) => createMock(...args),
    listMessages: (...args: unknown[]) => listMessagesMock(...args),
    listConversations: (...args: unknown[]) => listConversationsMock(...args),
    streamMessage: (...args: unknown[]) => streamMessageMock(...args),
    softDelete: (...args: unknown[]) => softDeleteMock(...args),
    setMessageFeedback: (...args: unknown[]) => setFeedbackMock(...args),
    clearMessageFeedback: (...args: unknown[]) => clearFeedbackMock(...args),
  },
}))

vi.mock('@shared/sentry', () => ({ reportErrorToSentry: vi.fn() }))

// deck.gl and maplibre don't run in jsdom. The stub reports how many people
// the card handed the canvas, so the wiring from a tool payload through to the
// map can be checked without pulling the real one in.
// The boundary drawer reports save outcomes through the snackbar, and this
// suite renders no provider — only reached once the overlay opens, which is
// why every test here passed before the drawer existed.
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  }),
}))

vi.mock('../../../contacts/crm/map/ContactListMap', () => ({
  __esModule: true,
  default: function ContactListMapStub({
    people,
    drawRing,
  }: {
    people?: unknown[]
    drawRing?: Array<[number, number]>
  }) {
    return (
      <div
        data-testid="contact-map-stub"
        data-people={(people ?? []).length}
        data-ring={JSON.stringify(drawRing ?? [])}
      />
    )
  },
}))

// The card reads the list's members through the org-scoped contacts route.
vi.mock('@shared/organization-picker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOrganization: () => ({ slug: 'eo-test-org' }),
}))

const listMapPerson = (id: string) =>
  makePerson({
    id,
    address: {
      ...makePerson().address,
      latitude: '44.7593',
      longitude: '-85.6175',
    },
  })

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
  setFeedbackMock.mockReset().mockResolvedValue(undefined)
  clearFeedbackMock.mockReset().mockResolvedValue(undefined)
  // Default so the engine's post-turn reconcile never throws on an unmocked
  // client; tests that assert the committed transcript override this.
  listMessagesMock.mockResolvedValue([])
  seq = 0
  window.localStorage.clear()
})

describe('<ChiefOfStaffChatBody>', () => {
  describe('message action bar', () => {
    const replayOneTurn = () => {
      listConversationsMock.mockResolvedValue([])
      listMessagesMock.mockResolvedValue([
        msg('user', 'What is on my agenda?'),
        msg('assistant', 'Three items.', { id: 'asst_1' }),
      ])
    }

    it('renders under a persisted assistant turn when enabled', async () => {
      replayOneTurn()
      render(
        <ChiefOfStaffChatBody
          active
          conversationIdOverride="c1"
          showMessageActions
        />,
      )

      await waitFor(() =>
        expect(screen.getByText('Three items.')).toBeInTheDocument(),
      )
      expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Good response' }),
      ).toBeInTheDocument()
    })

    it('renders no action bar by default', async () => {
      replayOneTurn()
      render(<ChiefOfStaffChatBody active conversationIdOverride="c1" />)

      await waitFor(() =>
        expect(screen.getByText('Three items.')).toBeInTheDocument(),
      )
      expect(
        screen.queryByRole('button', { name: 'Copy' }),
      ).not.toBeInTheDocument()
    })

    it('never rates a user turn', async () => {
      replayOneTurn()
      render(
        <ChiefOfStaffChatBody
          active
          conversationIdOverride="c1"
          showMessageActions
        />,
      )

      await waitFor(() =>
        expect(screen.getByText('Three items.')).toBeInTheDocument(),
      )
      expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(1)
    })
  })

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

    // A prefix appears first (the smooth reveal types the chunk out) but the
    // full text is NOT dumped in one paint. The negative assertion is what
    // distinguishes a real gradual reveal from an immediate dump — `/^word/`
    // alone also matches the full string, so it can't tell them apart.
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

  it('hides the Retry button for a non-retryable stream error', async () => {
    const user = userEvent.setup()
    createMock.mockResolvedValue({ conversationId: 'conv_1' })
    streamMessageMock.mockReturnValue(
      makeStream([
        {
          type: 'error',
          code: 'conversation_not_found',
          message: 'This chat is no longer available.',
          retryable: false,
        },
      ]),
    )

    render(<ChiefOfStaffChatBody active />)

    await user.type(screen.getByLabelText(/ask a question/i), 'hi')
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    // The message shows, but a terminal error offers no (guaranteed-failing) retry.
    expect(
      screen.getByText('This chat is no longer available.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /retry/i }),
    ).not.toBeInTheDocument()
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

  describe('list map card', () => {
    const LIST = { listId: 16, name: 'Traverse Heights renters, 25-40' }

    const mockListPeople = (count: number) => {
      const people = Array.from({ length: count }, (_, i) =>
        listMapPerson(`p${i}`),
      )
      api.mock('GET /v1/contacts', {
        status: 200,
        data: {
          people,
          pagination: {
            totalResults: count,
            currentPage: 1,
            pageSize: count,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        },
      })
    }

    // The tool's ARGS are the payload, so the card can render from the live
    // event before anything is persisted.
    it('renders the card from a show_list_map call as the turn streams', async () => {
      const user = userEvent.setup()
      mockListPeople(3)
      listConversationsMock.mockResolvedValue([])
      createMock.mockResolvedValue({ conversationId: 'conv_map' })
      // Held open after the tool call, so the assertions below run while the
      // turn is still streaming. With a stream that closes immediately the
      // card on screen is the committed transcript's, and the test passes
      // whether or not the live event ever rendered anything — which is the
      // whole of what this test is for.
      let endTurn: () => void
      const turnEnded = new Promise<void>((resolve) => {
        endTurn = resolve
      })
      streamMessageMock.mockReturnValue(
        (async function* () {
          yield { type: 'tool_call', toolName: 'show_list_map', args: LIST }
          await turnEnded
          yield { type: 'done' }
        })(),
      )
      // The engine swaps the live row for the server transcript once the turn
      // settles, and the live copy is dropped at that point — so without the
      // committed turn here the card would appear and then vanish, and this
      // would be asserting the gap rather than the feature.
      listMessagesMock.mockResolvedValue([
        msg('user', 'where are they?'),
        msg('assistant', 'Here they are.', {
          id: 'a_stream',
          segments: [
            { kind: 'text', text: 'Here they are.' },
            { kind: 'tool', toolName: 'show_list_map', payload: LIST },
          ],
        }),
      ])

      render(<ChiefOfStaffChatBody active />)

      await user.type(
        screen.getByLabelText(/ask a question/i),
        'where are they?',
      )
      await user.click(screen.getByRole('button', { name: /send/i }))

      // Mid-stream: nothing is persisted yet, so this card can only have come
      // from the live tool_call.
      expect(await screen.findByText(LIST.name)).toBeInTheDocument()
      expect(await screen.findByText('3 constituents')).toBeInTheDocument()
      expect(
        await screen.findByRole('link', { name: 'Open list' }),
      ).toHaveAttribute('href', '/dashboard/contacts/lists/16')

      endTurn!()

      // Anchored on text only the committed turn carries, because the count
      // is already 1 while the turn is live — asserting it without waiting
      // for the commit passes before the duplicate can appear.
      expect(await screen.findByText('Here they are.')).toBeInTheDocument()

      // And still exactly one: the live row and the persisted turn carry the
      // same payload, so a live copy left behind after the settle draws the
      // card twice.
      await waitFor(() =>
        expect(screen.getAllByTestId('contact-map-stub')).toHaveLength(1),
      )
    })

    const mockSavedList = (
      over: Record<string, unknown> = {},
    ): Record<string, unknown> => {
      const row = { id: LIST.listId, name: LIST.name, ...over }
      api.mock('GET /v1/voters/voter-file/filters', {
        status: 200,
        data: [row] as never,
      })
      return row
    }

    it('offers the draw CTA on the card and opens the overlay', async () => {
      const user = userEvent.setup()
      mockListPeople(2)
      mockSavedList()
      listConversationsMock.mockResolvedValue([])
      listMessagesMock.mockResolvedValue([
        msg('user', 'map it'),
        msg('assistant', 'Here.', {
          id: 'a_map',
          segments: [
            { kind: 'text', text: 'Here.' },
            { kind: 'tool', toolName: 'show_list_map', payload: LIST },
          ],
        }),
      ])

      render(<ChiefOfStaffChatBody active conversationIdOverride="c_map" />)

      await user.click(
        await screen.findByRole('button', { name: /draw an area/i }),
      )

      expect(await screen.findByTestId('boundary-overlay')).toBeInTheDocument()
    })

    // Outreach locks a list permanently and the write behind this button
    // 409s once it has. Offering it anyway sends the holder to a refusal.
    it('hides the draw CTA once the list is locked by outreach', async () => {
      mockListPeople(2)
      mockSavedList({ firstUsedForOutreachAt: '2026-09-01T00:00:00.000Z' })
      listConversationsMock.mockResolvedValue([])
      listMessagesMock.mockResolvedValue([
        msg('user', 'map it'),
        msg('assistant', 'Here.', {
          id: 'a_locked',
          segments: [
            { kind: 'text', text: 'Here.' },
            { kind: 'tool', toolName: 'show_list_map', payload: LIST },
          ],
        }),
      ])

      render(<ChiefOfStaffChatBody active conversationIdOverride="c_locked" />)

      expect(await screen.findByTestId('contact-map-stub')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /draw an area|edit area/i }),
      ).not.toBeInTheDocument()
    })

    // The reason the overlay is mounted by this component and not by the
    // card. The live row is dropped and rebuilt under a history key the
    // moment the turn settles, so an overlay owned by the card would unmount
    // mid-draw and take the holder's ring with it.
    it('keeps the drawing surface open when the streaming turn commits', async () => {
      const user = userEvent.setup()
      mockListPeople(2)
      mockSavedList()
      listConversationsMock.mockResolvedValue([])
      createMock.mockResolvedValue({ conversationId: 'conv_draw' })
      let endTurn: () => void
      const turnEnded = new Promise<void>((resolve) => {
        endTurn = resolve
      })
      streamMessageMock.mockReturnValue(
        (async function* () {
          yield { type: 'tool_call', toolName: 'show_list_map', args: LIST }
          await turnEnded
          yield { type: 'done' }
        })(),
      )
      listMessagesMock.mockResolvedValue([
        msg('user', 'map it'),
        msg('assistant', 'Here they are.', {
          id: 'a_commit',
          segments: [
            { kind: 'text', text: 'Here they are.' },
            { kind: 'tool', toolName: 'show_list_map', payload: LIST },
          ],
        }),
      ])

      render(<ChiefOfStaffChatBody active />)
      await user.type(screen.getByLabelText(/ask a question/i), 'map it')
      await user.click(screen.getByRole('button', { name: /send/i }))

      // Opened while the turn is still streaming, off the live card.
      await user.click(
        await screen.findByRole('button', { name: /draw an area/i }),
      )
      expect(await screen.findByTestId('boundary-overlay')).toBeInTheDocument()

      endTurn!()
      await screen.findByText('Here they are.')

      expect(screen.getByTestId('boundary-overlay')).toBeInTheDocument()
    })

    // And again from the transcript, which is the case the args-not-results
    // design exists for: a reloaded conversation never passes through onEvent.
    it('replays the card from a persisted show_list_map segment', async () => {
      mockListPeople(2)
      listConversationsMock.mockResolvedValue([])
      listMessagesMock.mockResolvedValue([
        msg('user', 'where are they?'),
        msg('assistant', 'Here they are.', {
          id: 'a_map',
          segments: [
            { kind: 'text', text: 'Here they are.' },
            { kind: 'tool', toolName: 'show_list_map', payload: LIST },
          ],
        }),
      ])

      render(<ChiefOfStaffChatBody active conversationIdOverride="conv_map" />)

      expect(await screen.findByText(LIST.name)).toBeInTheDocument()
      expect(await screen.findByText('2 constituents')).toBeInTheDocument()
      expect(await screen.findByTestId('contact-map-stub')).toHaveAttribute(
        'data-people',
        '2',
      )
    })

    // The card IS the output, so the tool call must not also render as a
    // status pill above it. Live the event is consumed before a pill exists;
    // only the replayed transcript still carries the segment.
    it('does not also show a tool pill for the replayed map segment', async () => {
      mockListPeople(1)
      listConversationsMock.mockResolvedValue([])
      listMessagesMock.mockResolvedValue([
        msg('assistant', 'Here they are.', {
          id: 'a_pill',
          segments: [
            { kind: 'text', text: 'Here they are.' },
            { kind: 'tool', toolName: 'show_list_map', payload: LIST },
          ],
        }),
      ])

      render(<ChiefOfStaffChatBody active conversationIdOverride="conv_map" />)

      expect(await screen.findByText(LIST.name)).toBeInTheDocument()
      expect(screen.queryByText('show_list_map')).not.toBeInTheDocument()
    })
  })
})
