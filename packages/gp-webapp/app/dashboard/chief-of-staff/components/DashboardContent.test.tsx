import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  BUILD_CITIZENS_PANEL_MESSAGE,
  EXPLAIN_CIVIC_PANEL_MESSAGE,
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

// The civic panel summary decides the panel step; nothing else on this page
// may call the API, so a completed get-started card would show up here.
const panelSummary = { members: 0 }
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

// The deck, the banner and the footer read their own endpoints; the build
// card's buttons are covered in TaskStack.test.tsx. The stand-in deck only
// presses the build card's What's a civic panel? and the meet card's button
// (whose own completion is TaskStack's, not the chat's).
vi.mock('./TaskStack', async () => {
  const { EXPLAIN_CIVIC_PANEL_MESSAGE: explain } =
    await import('@goodparty_org/contracts')
  return {
    default: ({
      onDiscussCard,
      onOpenCard,
    }: {
      onDiscussCard?: (message: string) => void
      onOpenCard?: (key: 'meet' | 'priorities') => void
    }) => (
      <>
        <button type="button" onClick={() => onDiscussCard?.(explain)}>
          Explain the panel
        </button>
        <button type="button" onClick={() => onOpenCard?.('meet')}>
          Meet my Chief of Staff
        </button>
      </>
    ),
  }
})
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
  panelSummary.members = 0
  clientRequestMock.mockReset().mockImplementation(async (endpoint: string) => {
    if (endpoint === 'GET /v1/contacts/civic-panel') {
      return {
        ok: true,
        status: 200,
        data: {
          members: panelSummary.members,
          reachedRecently: 0,
          askableNow: 0,
          lastOutreachAt: null,
        },
      }
    }
    throw new Error(`unexpected request ${endpoint}`)
  })
  listMessagesMock
    .mockReset()
    .mockResolvedValue([
      message('u1', 'user', BUILD_CITIZENS_PANEL_MESSAGE),
      message('a1', 'assistant', REPLY),
    ])
  panelsFlag.ready = true
  panelsFlag.enabled = true
  window.localStorage.clear()
})

describe("DashboardContent: What's a civic panel? on the build card", () => {
  it('opens the chat on a turn the official never sees', async () => {
    const user = userEvent.setup()
    listMessagesMock.mockResolvedValue([
      message('u1', 'user', EXPLAIN_CIVIC_PANEL_MESSAGE),
      message('a1', 'assistant', REPLY),
    ])
    render(<DashboardContent />)

    await user.click(screen.getByRole('button', { name: 'Explain the panel' }))

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: EXPLAIN_CIVIC_PANEL_MESSAGE }),
      ),
    )
    await waitFor(
      () => {
        expect(listMessagesMock).toHaveBeenCalled()
        expect(screen.getByText(REPLY)).toBeInTheDocument()
      },
      { timeout: 5000 },
    )
    expect(screen.queryByText(/What is a civic panel\?/)).toBeNull()
  })
})

const completedACard = () =>
  clientRequestMock.mock.calls.some(([endpoint]) =>
    String(endpoint).includes('complete'),
  )

describe("DashboardContent: What's a civic panel? ends on its next step", () => {
  const explain = async () => {
    const user = userEvent.setup()
    listMessagesMock.mockResolvedValue([
      message('u1', 'user', EXPLAIN_CIVIC_PANEL_MESSAGE),
      message('a1', 'assistant', REPLY),
    ])
    render(<DashboardContent />)
    await user.click(screen.getByRole('button', { name: 'Explain the panel' }))
    await waitFor(() => expect(screen.getByText(REPLY)).toBeInTheDocument(), {
      timeout: 5000,
    })
    return user
  }

  it('offers Build my panel to an office with no panel, which opens the panel page', async () => {
    vi.mocked(router.push!).mockClear()
    const user = await explain()

    const cta = await screen.findByRole('button', { name: 'Build my panel' })
    await user.click(cta)

    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/contacts/citizens-panel',
    )
    expect(streamMessageMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: BUILD_CITIZENS_PANEL_MESSAGE }),
    )
    expect(completedACard()).toBe(false)
  })

  it('offers to ask the panel when it already has members', async () => {
    panelSummary.members = 12
    const user = await explain()

    expect(screen.queryByRole('button', { name: 'Build my panel' })).toBeNull()
    await user.click(
      await screen.findByRole('button', {
        name: 'Ask your panel about a priority',
      }),
    )
    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          conversationId: 'conv-panel',
          content: NEXT_STEP_MESSAGES.askPanel,
        }),
      ),
    )
  })
})

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

  it('says what the Chief of Staff does and ends on a question with next steps', async () => {
    await meet()

    for (const line of buildChiefOfStaffIntro('Jordan')) {
      expect(screen.getByText(line)).toBeInTheDocument()
    }
    for (const label of [
      'Get ready for your next meeting',
      'See what residents are raising',
      'Move a priority forward',
      'Build your civic panel',
      'Draft an ordinance',
      'Reach your constituents',
    ]) {
      expect(
        screen.getByRole('button', { name: new RegExp(label) }),
      ).toBeInTheDocument()
    }
  })

  it.each([
    ['Get ready for your next meeting', NEXT_STEP_MESSAGES.meeting],
    ['See what residents are raising', NEXT_STEP_MESSAGES.issues],
    ['Move a priority forward', NEXT_STEP_MESSAGES.priority],
    ['Reach your constituents', NEXT_STEP_MESSAGES.outreach],
  ])(
    '%s sends its question as the official’s own message',
    async (label, sent) => {
      listMessagesMock.mockResolvedValue([
        message('u1', 'user', sent),
        message('a1', 'assistant', REPLY),
      ])
      const user = await meet()
      await user.click(screen.getByRole('button', { name: new RegExp(label) }))

      await waitFor(() =>
        expect(streamMessageMock).toHaveBeenCalledWith(
          expect.objectContaining({ content: sent }),
        ),
      )
      await waitFor(() => expect(screen.getByText(sent)).toBeInTheDocument())
      expect(completedACard()).toBe(false)
    },
  )

  it('Build your civic panel opens the panel page', async () => {
    vi.mocked(router.push!).mockClear()
    const user = await meet()
    await user.click(
      screen.getByRole('button', { name: /Build your civic panel/ }),
    )

    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/contacts/citizens-panel',
    )
    expect(streamMessageMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: BUILD_CITIZENS_PANEL_MESSAGE }),
    )
    expect(completedACard()).toBe(false)
  })

  it('asks the panel instead once it has members', async () => {
    panelSummary.members = 5
    const user = await meet()

    const ask = await screen.findByRole('button', {
      name: /Ask your civic panel/,
    })
    expect(
      screen.queryByRole('button', { name: /Build your civic panel/ }),
    ).toBeNull()
    await user.click(ask)
    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: NEXT_STEP_MESSAGES.askPanel }),
      ),
    )
  })

  it('leaves the civic panel out with serve-citizen-panels off', async () => {
    panelsFlag.enabled = false
    await meet()

    expect(screen.queryByRole('button', { name: /civic panel/ })).toBeNull()
    expect(clientRequestMock).not.toHaveBeenCalled()
  })

  it('Draft an ordinance opens the ordinance flow', async () => {
    vi.mocked(router.push!).mockReset()
    const user = await meet()
    await user.click(screen.getByRole('button', { name: /Draft an ordinance/ }))

    expect(router.push).toHaveBeenCalledWith('/dashboard/ordinances/new')
    expect(streamMessageMock).not.toHaveBeenCalled()
    expect(completedACard()).toBe(false)
  })
})
