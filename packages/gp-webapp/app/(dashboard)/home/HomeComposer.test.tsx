import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomeComposer from './HomeComposer'

const mockSend = vi.fn()
const mockOpenManager = vi.fn()
const mockStartNewChat = vi.fn()
vi.mock('../campaign-manager/CampaignManagerChatProvider', () => ({
  useCampaignManagerChat: () => ({
    sendFromComposer: mockSend,
    openManager: mockOpenManager,
    startNewChat: mockStartNewChat,
    openConversation: vi.fn(),
  }),
}))
vi.mock('../chief-of-staff/components/chat/ChatHistoryPopover', () => ({
  default: () => <button type="button">Past chats</button>,
}))

const box = () => screen.getByRole('textbox')

beforeEach(() => {
  mockSend.mockClear()
  mockOpenManager.mockClear()
  mockStartNewChat.mockClear()
})

describe('HomeComposer', () => {
  it('is an open chat box that sends what the candidate wrote, as written', async () => {
    render(<HomeComposer />)

    expect(box()).toHaveAttribute('placeholder', 'How can I help you today?')
    await userEvent.type(box(), 'What is a filing fee?')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(mockSend).toHaveBeenCalledWith('What is a filing fee?')
    expect(box()).toHaveValue('')
  })

  it('sends on Enter and keeps Shift+Enter for a new line', async () => {
    render(<HomeComposer />)

    await userEvent.type(box(), 'Line one{Shift>}{Enter}{/Shift}Line two')
    expect(mockSend).not.toHaveBeenCalled()

    await userEvent.type(box(), '{Enter}')
    expect(mockSend).toHaveBeenCalledWith('Line one\nLine two')
  })

  it('has a tool row: new chat, past chats, attach, voice and send', async () => {
    render(<HomeComposer />)

    expect(
      screen.getByRole('button', { name: 'Past chats' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Record your voice' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Attach a file' }))
    expect(mockOpenManager).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(mockStartNewChat).toHaveBeenCalled()
  })

  it('keeps attach beside the mic, and new chat at the start', () => {
    render(<HomeComposer />)

    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
    expect(names.indexOf('New chat')).toBe(0)
    expect(names.indexOf('Attach a file') + 1).toBe(
      names.indexOf('Record your voice'),
    )
  })

  it.each([
    ['New chat', 'New chat'],
    ['Attach a file', 'Attach a file'],
    ['Record your voice', 'Record your voice'],
  ])('names the %s tool on hover', async (button, tip) => {
    render(<HomeComposer />)

    await userEvent.hover(screen.getByRole('button', { name: button }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(tip)
  })
})
