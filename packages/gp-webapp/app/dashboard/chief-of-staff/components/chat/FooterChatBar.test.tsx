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
