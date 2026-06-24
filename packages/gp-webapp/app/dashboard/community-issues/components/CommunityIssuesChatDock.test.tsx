import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useRef, type RefObject } from 'react'
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { EVENTS } from 'helpers/analyticsHelper'
import CommunityIssuesChatDock from './CommunityIssuesChatDock'

const createConversationMock = vi.fn()

vi.mock('../../chief-of-staff/data/chat-api', () => ({
  chiefOfStaffChatApi: {
    createConversation: (...args: unknown[]) => createConversationMock(...args),
  },
}))

vi.mock('../../chief-of-staff/components/chat/FooterChatBar', () => ({
  default: () => null,
}))

vi.mock('../../chief-of-staff/components/chat/ChiefOfStaffChatSurface', () => ({
  default: ({
    open,
    initialConversationId,
  }: {
    open: boolean
    initialConversationId?: string | null
  }) =>
    open ? (
      <div data-testid="cos-chat-surface">{initialConversationId}</div>
    ) : null,
}))

vi.mock('@shared/hooks/useUser', () => ({ useUser: () => [null] }))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const issue = {
  id: 'issue-1',
  title: 'Housing Crisis',
  summary: 'Rising rents are a top concern.',
}

const CONTAINER_TEXT = 'Some issue text to highlight'

const Harness = ({ anchorIssue }: { anchorIssue?: typeof issue }) => {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div>
      <div ref={ref}>{CONTAINER_TEXT}</div>
      <CommunityIssuesChatDock
        anchorIssue={anchorIssue}
        selectionContainerRef={ref as RefObject<HTMLElement | null>}
      />
    </div>
  )
}

// Fakes a non-collapsed selection of `text` that lives inside the container,
// then fires the selectionchange event useTextSelection listens for.
const selectInside = (text: string) => {
  const target = screen.getByText(CONTAINER_TEXT)
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: false,
    rangeCount: 1,
    toString: () => text,
    removeAllRanges: vi.fn(),
    getRangeAt: () => ({
      commonAncestorContainer: target,
      getBoundingClientRect: () => ({
        top: 100,
        left: 100,
        width: 40,
        height: 18,
      }),
    }),
  } as unknown as Selection)
  fireEvent(document, new Event('selectionchange'))
}

beforeEach(() => {
  vi.clearAllMocks()
  createConversationMock.mockResolvedValue({ conversationId: 'conv-1' })
})

describe('<CommunityIssuesChatDock>', () => {
  it('creates a conversation with the correct anchor and opens the chat', async () => {
    const user = userEvent.setup()
    render(<Harness anchorIssue={issue} />)

    selectInside('selected text')
    await user.click(await screen.findByRole('button', { name: /ask ai/i }))

    await waitFor(() =>
      expect(createConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'community_issue',
          resourceId: 'issue-1',
          url: expect.any(String),
          snapshot: expect.objectContaining({
            title: 'Housing Crisis',
            summary: 'Rising rents are a top concern.',
          }),
        }),
      ),
    )
    expect(await screen.findByTestId('cos-chat-surface')).toBeInTheDocument()
  })

  it('includes highlightedText in the anchor snapshot when text is selected', async () => {
    const user = userEvent.setup()
    render(<Harness anchorIssue={issue} />)

    selectInside('cameras at Ramsey and 5th')
    await user.click(await screen.findByRole('button', { name: /ask ai/i }))

    await waitFor(() =>
      expect(createConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          snapshot: expect.objectContaining({
            highlightedText: 'cameras at Ramsey and 5th',
          }),
        }),
      ),
    )
  })

  it('fires AskAIStarted on click', async () => {
    const user = userEvent.setup()
    const { trackEvent } = await import('helpers/analyticsHelper')
    render(<Harness anchorIssue={issue} />)

    selectInside('selected text')
    await user.click(await screen.findByRole('button', { name: /ask ai/i }))

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.CommunityIssues.AskAIStarted,
      { issueId: 'issue-1' },
    )
  })

  it('does not fire a second createConversation while one is in flight', async () => {
    let resolveCreate!: (value: { conversationId: string }) => void
    createConversationMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve
      }),
    )
    const user = userEvent.setup()
    render(<Harness anchorIssue={issue} />)

    selectInside('selected text')
    const btn = await screen.findByRole('button', { name: /ask ai/i })
    await user.click(btn)
    await user.click(btn)

    expect(createConversationMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveCreate({ conversationId: 'conv-1' })
    })
  })

  it('renders no Ask AI popover when anchorIssue is absent', () => {
    render(<Harness />)

    selectInside('selected text')

    expect(
      screen.queryByRole('button', { name: /ask ai/i }),
    ).not.toBeInTheDocument()
  })

  it('dismisses the Ask AI popover on scroll', async () => {
    render(<Harness anchorIssue={issue} />)

    selectInside('selected text')
    expect(
      await screen.findByRole('button', { name: /ask ai/i }),
    ).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /ask ai/i }),
      ).not.toBeInTheDocument(),
    )
  })
})
