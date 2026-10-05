import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, waitFor } from '@testing-library/react'
import type { Ordinance } from '@goodparty_org/contracts'
import DraftChat from './DraftChat'

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  listMessages: vi.fn(),
  streamMessage: vi.fn(),
  dictationStart: vi.fn(),
  dictationStop: vi.fn(),
}))

vi.mock('../data/chat-api', () => ({
  ordinanceFlowChatApi: {
    createConversation: mocks.createConversation,
    listMessages: mocks.listMessages,
    streamMessage: mocks.streamMessage,
  },
}))

// Stub dictation so the auto-start effect can be asserted without touching the
// real getUserMedia/WebSocket stack.
vi.mock('../../shared/dictation/useDictationAppend', () => ({
  useDictationAppend: () => ({
    status: 'idle',
    error: null,
    partialTranscript: '',
    active: false,
    busy: false,
    start: mocks.dictationStart,
    stop: mocks.dictationStop,
    toggle: vi.fn(),
  }),
}))

const ordinance = {
  id: 'ord-1',
  slug: 'public-safety-cameras',
  draftTitle: 'Draft amendment',
  goalText: 'Add camera guardrails',
} as unknown as Ordinance

const message = (id: string, role: 'user' | 'assistant', content: string) => ({
  id,
  conversationId: 'c1',
  role,
  content,
  createdAt: '2026-07-01T00:00:00.000Z',
})

describe('DraftChat', () => {
  beforeEach(() => {
    mocks.createConversation.mockReset()
    mocks.listMessages.mockReset()
    mocks.streamMessage.mockReset()
    mocks.dictationStart.mockReset()
    mocks.dictationStop.mockReset()
  })

  it('starts dictation on mount when autoDictate is set', () => {
    mocks.createConversation.mockResolvedValue({ conversationId: 'c1' })
    mocks.listMessages.mockResolvedValue([])

    render(<DraftChat ordinance={ordinance} autoDictate />)

    expect(mocks.dictationStart).toHaveBeenCalledTimes(1)
  })

  it('does not start dictation on mount without autoDictate', () => {
    mocks.createConversation.mockResolvedValue({ conversationId: 'c1' })
    mocks.listMessages.mockResolvedValue([])

    render(<DraftChat ordinance={ordinance} />)

    expect(mocks.dictationStart).not.toHaveBeenCalled()
  })

  it('renders the conversation history after init', async () => {
    mocks.createConversation.mockResolvedValue({ conversationId: 'c1' })
    mocks.listMessages.mockResolvedValue([
      message('m1', 'user', 'What does section 4 do?'),
      message('m2', 'assistant', 'It sets a 30-day retention limit.'),
    ])

    render(<DraftChat ordinance={ordinance} />)

    expect(await screen.findByText('What does section 4 do?')).toBeVisible()
    expect(screen.getByText('It sets a 30-day retention limit.')).toBeVisible()
    // Its own conversation (step 'review'), separate from the flow's draft step.
    expect(mocks.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'review' }),
    )
  })

  it('keeps the composer disabled when the conversation fails to open', async () => {
    mocks.createConversation.mockRejectedValue(new Error('nope'))

    render(<DraftChat ordinance={ordinance} />)

    const input = screen.getByPlaceholderText(/ask me any questions/i)
    await waitFor(() => expect(input).toBeDisabled())
  })

  it('keeps the composer usable when history fails to load', async () => {
    mocks.createConversation.mockResolvedValue({ conversationId: 'c1' })
    mocks.listMessages.mockRejectedValue(new Error('no history'))

    render(<DraftChat ordinance={ordinance} />)

    const input = screen.getByPlaceholderText(/ask me any questions/i)
    await waitFor(() => expect(input).not.toBeDisabled())
  })

  it('prefills the composer from a seeded passage', async () => {
    mocks.createConversation.mockResolvedValue({ conversationId: 'c1' })
    mocks.listMessages.mockResolvedValue([])

    render(
      <DraftChat
        ordinance={ordinance}
        seedText={'About this passage: "retention"'}
        seedNonce={1}
      />,
    )

    const input = screen.getByPlaceholderText(/ask me any questions/i)
    expect(input).toHaveValue('About this passage: "retention"')
  })
})
