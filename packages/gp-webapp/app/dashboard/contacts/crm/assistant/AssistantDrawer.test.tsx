import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import AssistantDrawer from './AssistantDrawer'
import type {
  AgentChatClient,
  ChatMessageDto,
  ChatStreamEvent,
} from '../../../shared/agent-chat/chatClient'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))

async function* streamOf(
  events: ChatStreamEvent[],
): AsyncGenerator<ChatStreamEvent> {
  for (const event of events) yield event
}

const userTurn: ChatMessageDto = {
  id: 'u1',
  conversationId: 'c1',
  role: 'user',
  content: 'Build me a list of young supporters',
  createdAt: new Date().toISOString(),
}

const assistantTurn: ChatMessageDto = {
  id: 'a1',
  conversationId: 'c1',
  role: 'assistant',
  content: 'Created your list.',
  createdAt: new Date().toISOString(),
}

// listMessages returns empty on the init load and the persisted transcript
// once the turn has streamed, mirroring the server's persistence timing.
const buildChatApi = (events: ChatStreamEvent[]): AgentChatClient => {
  let listCalls = 0
  return {
    createConversation: vi.fn().mockResolvedValue({ conversationId: 'c1' }),
    listMessages: vi.fn().mockImplementation(() => {
      listCalls += 1
      return Promise.resolve(listCalls === 1 ? [] : [userTurn, assistantTurn])
    }),
    listConversations: vi.fn().mockResolvedValue([]),
    streamMessage: vi.fn().mockImplementation(() => streamOf(events)),
    softDelete: vi.fn(),
  }
}

const renderDrawer = (chatApi: AgentChatClient) =>
  render(
    <AssistantDrawer
      open
      onOpenChange={vi.fn()}
      request={{
        kind: 'new',
        initialMessage: 'Build me a list of young supporters',
      }}
      requestKey={1}
      chat={{ chatApi, historyKey: ['test', 'chat-history'] }}
      title="Voter list assistant"
      subtitle="Describe the list you want and I'll make it for you"
    />,
  )

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AssistantDrawer', () => {
  it('creates the scoped conversation and streams the first turn', async () => {
    const chatApi = buildChatApi([
      { type: 'text', delta: 'Created your list.' },
      { type: 'done', assistantMessageId: 'a1' },
    ])
    renderDrawer(chatApi)

    await waitFor(() => expect(chatApi.createConversation).toHaveBeenCalled())
    expect(
      await screen.findByText('Build me a list of young supporters'),
    ).toBeInTheDocument()
    // Re-query inside waitFor rather than holding a findBy's element across
    // the live-render -> persisted-history swap: the swap replaces the node
    // carrying this text, so a reference captured mid-stream can be detached
    // by assertion time (the CI-consistent failure mode of this test).
    await waitFor(
      () => expect(screen.getByText('Created your list.')).toBeInTheDocument(),
      { timeout: 15_000 },
    )
    expect(chatApi.streamMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'c1',
        content: 'Build me a list of young supporters',
      }),
    )
  }, 20_000)

  it('invalidates the lists queries when a saved-filter tool call finishes', async () => {
    const invalidate = vi.spyOn(testQueryClient, 'invalidateQueries')
    const chatApi = buildChatApi([
      {
        type: 'tool_call',
        toolName: 'crud_saved_filters',
        args: { action: 'create' },
      },
      {
        type: 'tool_result',
        toolName: 'crud_saved_filters',
        result: { id: 5 },
      },
      { type: 'text', delta: 'Created your list.' },
      { type: 'done', assistantMessageId: 'a1' },
    ])
    renderDrawer(chatApi)

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['custom-segments', 'test-org'],
      }),
    )
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['list-detail', 'test-org'],
    })
  })

  it('does not invalidate the lists queries on unrelated tool events', async () => {
    const invalidate = vi.spyOn(testQueryClient, 'invalidateQueries')
    const chatApi = buildChatApi([
      { type: 'tool_call', toolName: 'count_contacts', args: {} },
      { type: 'tool_result', toolName: 'count_contacts', result: { count: 3 } },
      { type: 'text', delta: 'Created your list.' },
      { type: 'done', assistantMessageId: 'a1' },
    ])
    renderDrawer(chatApi)

    await screen.findByText('Created your list.', undefined, { timeout: 5000 })
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ['custom-segments', 'test-org'],
    })
  })

  it('renders the error state when the conversation fails to open', async () => {
    const chatApi = buildChatApi([])
    ;(chatApi.createConversation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network down'),
    )
    renderDrawer(chatApi)

    expect(
      await screen.findByText(
        'Something went wrong opening this chat. Close it and try again.',
      ),
    ).toBeInTheDocument()
    expect(chatApi.streamMessage).not.toHaveBeenCalled()
  })

  it('surfaces a streamed error event as an alert and keeps the composer usable', async () => {
    const chatApi = buildChatApi([
      {
        type: 'error',
        code: 'upstream_unavailable',
        message: 'Chat is temporarily unavailable.',
        retryable: true,
      },
    ])
    renderDrawer(chatApi)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Chat is temporarily unavailable.')
    // The optimistic user turn survives (no history swap reverted it) and the
    // composer is re-enabled for a retry.
    expect(
      screen.getByText('Build me a list of young supporters'),
    ).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Ask a follow-up or refine your list'),
    ).toBeEnabled()
  })

  it('replays an existing conversation without creating one', async () => {
    const chatApi = buildChatApi([])
    ;(chatApi.listMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      userTurn,
      assistantTurn,
    ])
    render(
      <AssistantDrawer
        open
        onOpenChange={vi.fn()}
        request={{ kind: 'existing', conversationId: 'c1' }}
        requestKey={2}
        chat={{ chatApi, historyKey: ['test', 'chat-history'] }}
        title="Voter list assistant"
        subtitle="Describe the list you want and I'll make it for you"
      />,
    )

    expect(await screen.findByText('Created your list.')).toBeInTheDocument()
    expect(chatApi.createConversation).not.toHaveBeenCalled()
    expect(chatApi.streamMessage).not.toHaveBeenCalled()
  })
})
