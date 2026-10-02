import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FooterChatBar from './FooterChatBar'

describe('<FooterChatBar> attach icon', () => {
  it('shows the paperclip when showAttachIcon and opens the chat on click', async () => {
    const onOpen = vi.fn()
    render(
      <FooterChatBar
        onOpen={onOpen}
        onOpenConversation={vi.fn()}
        showAttachIcon
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Attach a file' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('hides the paperclip by default', () => {
    render(<FooterChatBar onOpen={vi.fn()} onOpenConversation={vi.fn()} />)
    expect(
      screen.queryByRole('button', { name: 'Attach a file' }),
    ).not.toBeInTheDocument()
  })
})
