import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import AskAiButton from './AskAiButton'

const createConversationMock = vi.fn()

vi.mock('../../chief-of-staff/data/chat-api', () => ({
  chiefOfStaffChatApi: {
    createConversation: (...args: unknown[]) => createConversationMock(...args),
  },
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

beforeEach(() => {
  vi.clearAllMocks()
  createConversationMock.mockResolvedValue({ conversationId: 'conv-1' })
})

describe('<AskAiButton>', () => {
  it('calls createConversation with the correct anchor on click', async () => {
    const user = userEvent.setup()
    render(<AskAiButton issue={issue} />)

    await user.click(screen.getByRole('button', { name: /ask ai/i }))

    await waitFor(() =>
      expect(createConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'community_issue_feed',
          resourceId: 'issue-1',
        }),
      ),
    )
    expect(screen.getByTestId('cos-chat-surface')).toBeInTheDocument()
  })

  it('includes highlightedText in the anchor snapshot when text is selected', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'selected text',
    } as Selection)

    const user = userEvent.setup()
    render(<AskAiButton issue={issue} />)

    await user.click(screen.getByRole('button', { name: /ask ai/i }))

    await waitFor(() =>
      expect(createConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          snapshot: expect.objectContaining({
            highlightedText: 'selected text',
          }),
        }),
      ),
    )
  })

  it('fires AskAIStarted event on click', async () => {
    const user = userEvent.setup()
    const { trackEvent } = await import('helpers/analyticsHelper')
    render(<AskAiButton issue={issue} />)

    await user.click(screen.getByRole('button', { name: /ask ai/i }))

    expect(trackEvent).toHaveBeenCalledWith(expect.stringContaining('Ask AI'), {
      issueId: 'issue-1',
    })
  })
})
