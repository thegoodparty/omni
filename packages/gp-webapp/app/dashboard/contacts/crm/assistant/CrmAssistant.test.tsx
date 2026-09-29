import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import CrmAssistant from './CrmAssistant'
import { useContactsTable } from '../ContactsTableProvider'
import { campaignManagerChatApi } from '../../../campaign-manager/campaignManagerChat'
import { chiefOfStaffChatApi } from '../../../chief-of-staff/data/chat-api'
import { CAMPAIGN_MANAGER_HISTORY_KEY } from '../../../campaign-manager/campaignManagerChat'
import { HISTORY_KEY } from '../../../chief-of-staff/data/use-chat-history'
import type { AssistantChatBinding } from './assistantChat'

vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

interface BarProps {
  chat: AssistantChatBinding
  onSubmit: (message: string) => void
  onOpenConversation: (conversationId: string) => void
}
let lastBarProps: BarProps | null = null
vi.mock('./AssistantBar', () => ({
  default: (props: BarProps) => {
    lastBarProps = props
    return (
      <button onClick={() => props.onSubmit('young supporters')}>
        submit assistant
      </button>
    )
  },
}))

interface SurfaceProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialConversationId?: string | null
  pendingMessage?: string
  title?: string
  subtitle?: string
  chatApi?: unknown
  historyKey?: readonly unknown[]
  scope?: string
  onMessageSent?: () => void
}
let lastSurfaceProps: SurfaceProps | null = null
vi.mock(
  '../../../chief-of-staff/components/chat/ChiefOfStaffChatSurface',
  () => ({
    default: (props: SurfaceProps) => {
      lastSurfaceProps = props
      return props.open ? <div data-testid="assistant-surface" /> : null
    },
  }),
)

const mockedUseContactsTable = vi.mocked(useContactsTable)

const setContext = (isWinContext: boolean, isWinContextReady = true) => {
  mockedUseContactsTable.mockReturnValue({
    isWinContext,
    isWinContextReady,
  } as ReturnType<typeof useContactsTable>)
}

beforeEach(() => {
  lastBarProps = null
  lastSurfaceProps = null
  vi.mocked(trackEvent).mockClear()
})

describe('CrmAssistant', () => {
  it('renders nothing until the Win/Serve mode settles', () => {
    setContext(false, false)
    render(<CrmAssistant />)
    expect(screen.queryByText('submit assistant')).not.toBeInTheDocument()
  })

  // The consolidation's load-bearing assertion: the contacts entry point opens
  // the scope's OWN chat surface, so there is one assistant per product rather
  // than a list-shaped second one. A regression here is a second agent
  // reappearing, not a cosmetic change.
  it('binds Win to the campaign_assistant surface and names that agent', () => {
    setContext(true)
    render(<CrmAssistant />)
    expect(lastBarProps?.chat.chatApi).toBe(campaignManagerChatApi)
    expect(lastSurfaceProps?.chatApi).toBe(campaignManagerChatApi)
    expect(lastSurfaceProps?.historyKey).toBe(CAMPAIGN_MANAGER_HISTORY_KEY)
    expect(lastSurfaceProps?.scope).toBe('campaign_assistant')
    expect(lastSurfaceProps?.title).toBe('Campaign manager')
  })

  it('binds Serve to the chief_of_staff surface and names that agent', () => {
    setContext(false)
    render(<CrmAssistant />)
    expect(lastBarProps?.chat.chatApi).toBe(chiefOfStaffChatApi)
    expect(lastSurfaceProps?.chatApi).toBe(chiefOfStaffChatApi)
    expect(lastSurfaceProps?.historyKey).toBe(HISTORY_KEY)
    expect(lastSurfaceProps?.scope).toBe('chief_of_staff')
    expect(lastSurfaceProps?.title).toBe('Chief of Staff')
  })

  it('keeps the list-building framing in the subtitle', () => {
    setContext(false)
    render(<CrmAssistant />)
    expect(lastSurfaceProps?.subtitle).toBe(
      "Describe the list you want and I'll make it for you",
    )
  })

  it('opens the surface with the submitted message as a visible first turn', async () => {
    const user = userEvent.setup()
    setContext(true)
    render(<CrmAssistant />)
    expect(lastSurfaceProps?.open).toBe(false)
    await user.click(screen.getByText('submit assistant'))
    expect(screen.getByTestId('assistant-surface')).toBeInTheDocument()
    expect(lastSurfaceProps?.pendingMessage).toBe('young supporters')
    expect(lastSurfaceProps?.initialConversationId).toBeNull()
  })

  it('reopens a past conversation without re-sending a message', () => {
    setContext(false)
    render(<CrmAssistant />)
    act(() => lastBarProps?.onOpenConversation('conv-1'))
    expect(lastSurfaceProps?.initialConversationId).toBe('conv-1')
    expect(lastSurfaceProps?.pendingMessage).toBeUndefined()
  })

  // Closing has to drop it: the prop is a one-shot instruction, and reopening
  // from the clock popover with it still set would re-send the last request.
  it('drops the pending message when the surface closes', async () => {
    const user = userEvent.setup()
    setContext(true)
    render(<CrmAssistant />)
    await user.click(screen.getByText('submit assistant'))
    expect(lastSurfaceProps?.pendingMessage).toBe('young supporters')
    act(() => lastSurfaceProps?.onOpenChange(false))
    expect(lastSurfaceProps?.pendingMessage).toBeUndefined()
  })

  // ENG-10767: chat opened + message sent, so open-to-send drop-off is
  // visible in Amplitude.
  it('fires Assistant Chat Opened on a bar submit (Win)', async () => {
    const user = userEvent.setup()
    setContext(true)
    render(<CrmAssistant />)
    await user.click(screen.getByText('submit assistant'))

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.AssistantChatOpened,
      { context: 'win', source: 'message' },
    )
  })

  it('fires only Assistant Chat Opened with source history on a history pick (Serve)', () => {
    setContext(false)
    render(<CrmAssistant />)
    lastBarProps?.onOpenConversation('conv-1')

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.AssistantChatOpened,
      { context: 'serve', source: 'history' },
    )
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Contacts.AssistantMessageSent,
      expect.anything(),
    )
  })

  // Every message is counted once, by the surface — including the bar's first
  // one, which now rides the surface's own visible send path. CrmAssistant
  // firing Sent itself would double-count it.
  it('counts each message once, through the surface callback', async () => {
    const user = userEvent.setup()
    setContext(true)
    render(<CrmAssistant />)
    await user.click(screen.getByText('submit assistant'))
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Contacts.AssistantMessageSent,
      expect.anything(),
    )

    lastSurfaceProps?.onMessageSent?.()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.AssistantMessageSent,
      { context: 'win' },
    )
    expect(
      vi
        .mocked(trackEvent)
        .mock.calls.filter(
          (c) => c[0] === EVENTS.Contacts.AssistantMessageSent,
        ),
    ).toHaveLength(1)
  })
})
