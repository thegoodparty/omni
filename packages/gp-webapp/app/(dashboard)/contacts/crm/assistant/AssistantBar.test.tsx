import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import AssistantBar from './AssistantBar'
import type { AgentChatClient } from '../../../shared/agent-chat/chatClient'

const chatApi = {
  createConversation: vi.fn(),
  listMessages: vi.fn(),
  listConversations: vi.fn().mockResolvedValue([]),
  streamMessage: vi.fn(),
  softDelete: vi.fn(),
} as unknown as AgentChatClient

const chat = { chatApi, historyKey: ['test', 'chat-history'] as const }

describe('AssistantBar', () => {
  it('renders the list-building placeholder and no mic control', () => {
    render(
      <AssistantBar
        chat={chat}
        onSubmit={vi.fn()}
        onOpenConversation={vi.fn()}
      />,
    )
    expect(
      screen.getByPlaceholderText(
        "Describe the list you want and I'll make it for you",
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /dictate/i }),
    ).not.toBeInTheDocument()
  })

  it('submits the trimmed message and clears the input', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <AssistantBar
        chat={chat}
        onSubmit={onSubmit}
        onOpenConversation={vi.fn()}
      />,
    )
    const input = screen.getByTestId('crm-assistant-input')
    await user.type(input, '  young supporters  ')
    await user.click(screen.getByRole('button', { name: 'Ask the assistant' }))
    expect(onSubmit).toHaveBeenCalledWith('young supporters')
    expect(input).toHaveValue('')
  })

  it('disables submit while the input is empty', () => {
    render(
      <AssistantBar
        chat={chat}
        onSubmit={vi.fn()}
        onOpenConversation={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Ask the assistant' }),
    ).toBeDisabled()
  })
})
