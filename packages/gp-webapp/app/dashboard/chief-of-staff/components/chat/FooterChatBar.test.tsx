import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FooterChatBar from './FooterChatBar'

describe('<FooterChatBar> toolbar', () => {
  it('shows the paperclip and opens the chat on click', async () => {
    const onOpen = vi.fn()
    render(<FooterChatBar onOpen={onOpen} onOpenConversation={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Attach a file' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
