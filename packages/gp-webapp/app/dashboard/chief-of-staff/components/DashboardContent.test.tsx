import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  START_MANAGED_CIVIC_PANEL_MESSAGE,
  pickedNextStepsMessage,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import type {
  ChatMessageDto,
  ChatStreamEvent,
} from '../../shared/agent-chat/chatClient'
import DashboardContent from './DashboardContent'
import {
  NEXT_STEP_MESSAGES,
  buildChiefOfStaffIntro,
} from './chat/chatConstants'

const createMock = vi.fn()
const listMessagesMock = vi.fn()
const listConversationsMock = vi.fn()
const streamMessageMock = vi.fn()

vi.mock('../data/chat-api', () => ({
  chiefOfStaffChatApi: {
    createConversation: (...args: unknown[]) => createMock(...args),
    listMessages: (...args: unknown[]) => listMessagesMock(...args),
    listConversations: (...args: unknown[]) => listConversationsMock(...args),
    streamMessage: (...args: unknown[]) => streamMessageMock(...args),
    softDelete: vi.fn(),
    setMessageFeedback: vi.fn(),
    clearMessageFeedback: vi.fn(),
  },
}))

const panelsFlag = { ready: true, enabled: true }
vi.mock('@shared/experiments/serveCitizenPanelsFlag', () => ({
  useServeCitizenPanelsFlag: () => panelsFlag,
}))

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Jordan' }],
}))
vi.mock('@shared/organization-picker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOrganization: () => ({ slug: 'eo-test-org' }),
}))
vi.mock('@shared/sentry', () => ({ reportErrorToSentry: vi.fn() }))

// The managed panel decides the panel step; nothing else on this page may
// call the API, so a completed get-started card would show up here.
const managed: { panel: { status: string } | null } = { panel: null }
const clientRequestMock = vi.fn()
vi.mock('gpApi/typed-request', () => ({
  clientRequest: (...args: unknown[]) => clientRequestMock(...args),
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  }),
}))

// The deck, the banner and the footer read their own endpoints; the cards'
// buttons are covered in TaskStack.test.tsx. The stand-in deck only presses
// the meet card's button (whose own completion is TaskStack's, not the
// chat's).
vi.mock('./TaskStack', () => ({
  default: ({
    onOpenCard,
  }: {
    onOpenCard?: (key: 'meet' | 'priorities') => void
  }) => (
    <button type="button" onClick={() => onOpenCard?.('meet')}>
      Meet my Chief of Staff
    </button>
  ),
}))
vi.mock('./BriefingDispatchBanner', () => ({ default: () => null }))
vi.mock('./chat/FooterChatBar', () => ({ default: () => null }))
vi.mock('../data/use-briefing-dispatch', () => ({
  useBriefingDispatch: () => ({ inFlight: false }),
}))

const makeStream = (
  events: ChatStreamEvent[],
): AsyncIterable<ChatStreamEvent> =>
  (async function* () {
    for (const event of events) yield event
  })()

const message = (
  id: string,
  role: ChatMessageDto['role'],
  content: string,
): ChatMessageDto => ({
  id,
  conversationId: 'conv-panel',
  role,
  content,
  createdAt: '2026-10-13T00:00:00.000Z',
})

const REPLY =
  'A civic panel is a group of residents who said yes to a text about once a month.'

beforeEach(() => {
  createMock.mockReset().mockResolvedValue({ conversationId: 'conv-panel' })
  listConversationsMock.mockReset().mockResolvedValue([])
  streamMessageMock.mockReset().mockImplementation(() =>
    makeStream([
      { type: 'text', delta: REPLY },
      { type: 'done', assistantMessageId: 'a1' },
    ]),
  )
  managed.panel = null
  clientRequestMock.mockReset().mockImplementation(async (endpoint: string) => {
    if (endpoint === 'GET /v1/contacts/civic-panel/managed') {
      return { ok: true, status: 200, data: { panel: managed.panel } }
    }
    throw new Error(`unexpected request ${endpoint}`)
  })
  listMessagesMock
    .mockReset()
    .mockResolvedValue([
      message('u1', 'user', START_MANAGED_CIVIC_PANEL_MESSAGE),
      message('a1', 'assistant', REPLY),
    ])
  panelsFlag.ready = true
  panelsFlag.enabled = true
  window.localStorage.clear()
})

const completedACard = () =>
  clientRequestMock.mock.calls.some(([endpoint]) =>
    String(endpoint).includes('complete'),
  )

describe('DashboardContent: Meet my Chief of Staff', () => {
  const meet = async () => {
    const user = userEvent.setup()
    render(<DashboardContent />)
    await user.click(
      screen.getByRole('button', { name: 'Meet my Chief of Staff' }),
    )
    // The intro types in on a real interval.
    await waitFor(
      () =>
        expect(
          screen.getByText('What would you like to start with?'),
        ).toBeInTheDocument(),
      { timeout: 8000 },
    )
    return user
  }
  type User = Awaited<ReturnType<typeof meet>>
  const start = () => screen.getByRole('button', { name: 'Start' })
  const pickAndStart = async (user: User, ...labels: string[]) => {
    for (const label of labels) {
      await user.click(
        screen.getByRole('checkbox', { name: new RegExp(label) }),
      )
    }
    await user.click(start())
  }

  it('says what the Chief of Staff does and ends on a question with next steps', async () => {
    await meet()

    for (const line of buildChiefOfStaffIntro('Jordan')) {
      expect(screen.getByText(line)).toBeInTheDocument()
    }
    for (const label of [
      'See what matters in your community',
      'Build my civic panel',
      'Get ready for your next meeting',
      'Something else',
    ]) {
      expect(
        screen.getByRole('checkbox', { name: new RegExp(label) }),
      ).not.toBeChecked()
    }
    expect(
      screen.queryByRole('button', { name: /Draft an ordinance/ }),
    ).toBeNull()
  })

  it.each([
    ['See what matters in your community', NEXT_STEP_MESSAGES.priorities],
    ['Get ready for your next meeting', NEXT_STEP_MESSAGES.meeting],
  ])(
    '%s alone sends its question as the official’s own message',
    async (label, sent) => {
      listMessagesMock.mockResolvedValue([
        message('u1', 'user', sent),
        message('a1', 'assistant', REPLY),
      ])
      const user = await meet()
      await pickAndStart(user, label)

      await waitFor(() =>
        expect(streamMessageMock).toHaveBeenCalledWith(
          expect.objectContaining({ content: sent }),
        ),
      )
      await waitFor(() => expect(screen.getByText(sent)).toBeInTheDocument())
      expect(completedACard()).toBe(false)
    },
  )

  it('Build my civic panel alone starts the managed setup in this chat, as a hidden turn', async () => {
    listMessagesMock.mockResolvedValue([
      message('u1', 'user', START_MANAGED_CIVIC_PANEL_MESSAGE),
      message('a1', 'assistant', REPLY),
    ])
    vi.mocked(router.push!).mockClear()
    const user = await meet()
    await pickAndStart(user, 'Build my civic panel')

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: START_MANAGED_CIVIC_PANEL_MESSAGE,
        }),
      ),
    )
    expect(router.push).not.toHaveBeenCalled()
    expect(screen.queryByText(START_MANAGED_CIVIC_PANEL_MESSAGE)).toBeNull()
    expect(completedACard()).toBe(false)
  })

  it('still offers to build the panel when the enrollment cannot be read', async () => {
    const answer = clientRequestMock.getMockImplementation()
    clientRequestMock.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'GET /v1/contacts/civic-panel/managed') {
        throw new Error('read failed')
      }
      return answer?.(endpoint)
    })
    await meet()

    expect(
      await screen.findByRole('checkbox', { name: /Build my civic panel/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: /Hear from your constituents/ }),
    ).toBeNull()
  })

  it('offers hearing from constituents once GoodParty is building the panel', async () => {
    managed.panel = { status: 'building' }
    await meet()

    await screen.findByRole('checkbox', {
      name: /Hear from your constituents/,
    })
    for (const label of [
      /Build my civic panel/,
      /Build your civic panel/,
      /Grow your civic panel/,
    ]) {
      expect(screen.queryByRole('checkbox', { name: label })).toBeNull()
    }
  })

  it('Start waits for a pick, and the picks toggle', async () => {
    const user = await meet()
    expect(start()).toBeDisabled()

    const meeting = screen.getByRole('checkbox', {
      name: /Get ready for your next meeting/,
    })
    await user.click(meeting)
    expect(meeting).toBeChecked()
    expect(start()).toBeEnabled()

    await user.click(meeting)
    expect(meeting).not.toBeChecked()
    expect(start()).toBeDisabled()
    expect(streamMessageMock).not.toHaveBeenCalled()
  })

  it('works on the keyboard', async () => {
    const user = await meet()
    screen.getByRole('checkbox', { name: /See what matters/ }).focus()
    await user.keyboard(' ')
    expect(
      screen.getByRole('checkbox', { name: /See what matters/ }),
    ).toBeChecked()
    expect(start()).toBeEnabled()
  })

  it('sends several picks as one message, in the order shown', async () => {
    const sent = pickedNextStepsMessage([
      'See what matters in your community',
      'Build my civic panel',
      'Get ready for your next meeting',
    ])
    listMessagesMock.mockResolvedValue([
      message('u1', 'user', sent),
      message('a1', 'assistant', REPLY),
    ])
    const user = await meet()
    // Clicked out of order: the turn still lists them as the cards do.
    await pickAndStart(
      user,
      'Get ready for your next meeting',
      'See what matters in your community',
      'Build my civic panel',
    )

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: sent }),
      ),
    )
    expect(streamMessageMock).toHaveBeenCalledTimes(1)
    expect(streamMessageMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: START_MANAGED_CIVIC_PANEL_MESSAGE }),
    )
    await waitFor(() =>
      expect(
        screen.getByText(/Let's work through these, one at a time:/),
      ).toBeInTheDocument(),
    )
    expect(completedACard()).toBe(false)
  })

  it('Something else alone opens a box and sends what they write as their own message', async () => {
    const written = 'Help me plan a town hall.'
    listMessagesMock.mockResolvedValue([
      message('u1', 'user', written),
      message('a1', 'assistant', REPLY),
    ])
    const user = await meet()
    await user.click(screen.getByRole('checkbox', { name: /Something else/ }))

    const box = screen.getByRole('textbox', { name: 'Write your own' })
    expect(box).toHaveFocus()
    expect(start()).toBeDisabled()
    await user.type(box, written)
    expect(start()).toBeEnabled()
    await user.click(start())

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: written }),
      ),
    )
    await waitFor(() => expect(screen.getByText(written)).toBeInTheDocument())
    expect(completedACard()).toBe(false)
  })

  it('Something else combines with the steps, their own item last', async () => {
    const written = 'Help me plan a town hall.'
    const sent = pickedNextStepsMessage([
      'See what matters in your community',
      'Get ready for your next meeting',
      written,
    ])
    listMessagesMock.mockResolvedValue([
      message('u1', 'user', sent),
      message('a1', 'assistant', REPLY),
    ])
    const user = await meet()
    await user.click(screen.getByRole('checkbox', { name: /Something else/ }))
    await user.click(
      screen.getByRole('checkbox', { name: /Get ready for your next meeting/ }),
    )
    await user.click(screen.getByRole('checkbox', { name: /See what matters/ }))

    // Picked, but nothing typed yet.
    expect(start()).toBeDisabled()
    expect(
      screen.getByRole('checkbox', { name: /See what matters/ }),
    ).toBeChecked()
    await user.type(
      screen.getByRole('textbox', { name: 'Write your own' }),
      `${written}{Enter}`,
    )

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: sent }),
      ),
    )
    expect(streamMessageMock).toHaveBeenCalledTimes(1)
  })

  it('leaves the civic panel out with serve-citizen-panels off', async () => {
    panelsFlag.enabled = false
    await meet()

    expect(screen.queryByRole('checkbox', { name: /civic panel/ })).toBeNull()
    expect(clientRequestMock).not.toHaveBeenCalled()
  })

  it('offers outreach in the panel slot with serve-citizen-panels off', async () => {
    panelsFlag.enabled = false
    listMessagesMock.mockResolvedValue([
      message('u1', 'user', NEXT_STEP_MESSAGES.outreach),
      message('a1', 'assistant', REPLY),
    ])
    const user = await meet()
    await pickAndStart(user, 'Hear from your constituents')

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: NEXT_STEP_MESSAGES.outreach }),
      ),
    )
  })
})
