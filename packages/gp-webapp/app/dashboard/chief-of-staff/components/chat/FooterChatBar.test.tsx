import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FooterChatBar from './FooterChatBar'

describe('<FooterChatBar> paperclip', () => {
  it('opens the chat with the picked file, not before', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const onAttachFile = vi.fn()
    render(
      <FooterChatBar
        onOpen={onOpen}
        onOpenConversation={vi.fn()}
        onAttachFile={onAttachFile}
      />,
    )
    const file = new File(['hi'], 'notes.pdf', { type: 'application/pdf' })

    await user.click(screen.getByRole('button', { name: 'Attach a file' }))
    expect(onOpen).not.toHaveBeenCalled()
    await user.upload(screen.getByTestId('footer-chat-file-input'), file)

    expect(onAttachFile).toHaveBeenCalledWith(file)
  })
})

describe('<FooterChatBar> placeholder', () => {
  it('greets by name by default, on one line', () => {
    render(
      <FooterChatBar
        firstName="Ana"
        onOpen={vi.fn()}
        onOpenConversation={vi.fn()}
        onAttachFile={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Hi, Ana, how can I help?' }),
    ).toHaveClass('truncate')
  })

  it("shows a page's own question, which may wrap to two lines", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(
      <FooterChatBar
        firstName="Ana"
        onOpen={onOpen}
        onOpenConversation={vi.fn()}
        onAttachFile={vi.fn()}
        placeholder="Ask who still needs to join your civic panel"
      />,
    )

    const question = screen.getByRole('button', {
      name: 'Ask who still needs to join your civic panel',
    })
    expect(question).toHaveClass('line-clamp-2')
    expect(screen.queryByText('Hi, Ana, how can I help?')).toBeNull()
    await user.click(question)
    expect(onOpen).toHaveBeenCalled()
  })
})
