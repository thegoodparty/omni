import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSearchParams } from 'next/navigation'
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
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  }),
}))

// The deck, the banner and the footer read their own endpoints; the build
// card's buttons are covered in TaskStack.test.tsx. The stand-in deck only
// presses the build card's What's a civic panel?.
vi.mock('./TaskStack', async () => {
  const { EXPLAIN_CIVIC_PANEL_MESSAGE: explain } =
    await import('@goodparty_org/contracts')
  return {
    default: ({
      onDiscussCard,
    }: {
      onDiscussCard?: (message: string) => void
    }) => (
      <button type="button" onClick={() => onDiscussCard?.(explain)}>
        Explain the panel
      </button>
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

const arriveWith = (params: string) => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(params) as ReturnType<typeof useSearchParams>,
  )
}

beforeEach(() => {
  createMock.mockReset().mockResolvedValue({ conversationId: 'conv-panel' })
  listConversationsMock.mockReset().mockResolvedValue([])
  streamMessageMock.mockReset().mockReturnValue(
    makeStream([
      { type: 'text', delta: REPLY },
      { type: 'done', assistantMessageId: 'a1' },
    ]),
  )
  listMessagesMock
    .mockReset()
    .mockResolvedValue([
      message('u1', 'user', BUILD_CITIZENS_PANEL_MESSAGE),
      message('a1', 'assistant', REPLY),
    ])
  vi.mocked(router.replace!).mockReset()
  panelsFlag.ready = true
  panelsFlag.enabled = true
  window.localStorage.clear()
})

afterEach(() => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams() as ReturnType<typeof useSearchParams>,
  )
})

describe('DashboardContent: Build my panel on the civic panel card', () => {
  it('opens the chat on the home, started by a turn the official never sees', async () => {
    arriveWith('chat=build_citizens_panel')
    render(<DashboardContent />)

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: BUILD_CITIZENS_PANEL_MESSAGE }),
      ),
    )
    // The real chat body mounts here, which is slow on a cold run. Found and
    // checked in one callback: the streamed reply's node is swapped for the
    // saved transcript's once it lands, so an element found a moment earlier
    // can already be detached by the time a separate assertion reads it.
    await waitFor(
      () => {
        expect(listMessagesMock).toHaveBeenCalled()
        expect(screen.getByText(REPLY)).toBeInTheDocument()
      },
      { timeout: 5000 },
    )
    expect(screen.queryByText(/Help me build my civic panel/)).toBeNull()
    expect(router.replace).toHaveBeenCalledWith('/dashboard/chief-of-staff', {
      scroll: false,
    })
  })

  it('opens nothing with serve-citizen-panels off', async () => {
    panelsFlag.enabled = false
    arriveWith('chat=build_citizens_panel')
    render(<DashboardContent />)

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/dashboard/chief-of-staff', {
        scroll: false,
      }),
    )
    expect(streamMessageMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Chief of Staff')).toBeNull()
  })

  it('opens nothing on a plain visit', () => {
    render(<DashboardContent />)

    expect(streamMessageMock).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })
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
