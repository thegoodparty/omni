import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatComposer } from './chatUI'
import type { UseDictationAppendResult } from '../dictation/useDictationAppend'
import type { ChatAttachmentState } from './chatAttachments-api'

const makeDictation = (
  over: Partial<UseDictationAppendResult> = {},
): UseDictationAppendResult => ({
  status: 'idle',
  error: null,
  partialTranscript: '',
  active: false,
  busy: false,
  start: vi.fn(),
  stop: vi.fn(),
  toggle: vi.fn(),
  ...over,
})

const baseProps = {
  value: '',
  onChange: vi.fn(),
  onSubmit: vi.fn(),
}

const sendButton = (): HTMLElement =>
  screen.getByRole('button', { name: 'Send' })

describe('ChatComposer', () => {
  it('omits the mic when no dictation is given', () => {
    render(<ChatComposer {...baseProps} />)

    expect(
      screen.queryByRole('button', { name: /dictate/i }),
    ).not.toBeInTheDocument()
  })

  it('sends with the arrow icon when no dictation is given', () => {
    render(<ChatComposer {...baseProps} />)

    expect(sendButton().querySelector('.lucide-send')).toBeInTheDocument()
    expect(
      sendButton().querySelector('.lucide-sparkles'),
    ).not.toBeInTheDocument()
  })

  it('sends with the sparkle icon when dictation is enabled', () => {
    render(<ChatComposer {...baseProps} dictation={makeDictation()} />)

    expect(sendButton().querySelector('.lucide-sparkles')).toBeInTheDocument()
    expect(sendButton().querySelector('.lucide-send')).not.toBeInTheDocument()
  })

  it('renders the mic when dictation is given', () => {
    render(<ChatComposer {...baseProps} dictation={makeDictation()} />)

    expect(
      screen.getByRole('button', { name: 'Dictate a message' }),
    ).toBeInTheDocument()
  })

  it('toggles dictation on mic click', () => {
    const dictation = makeDictation()
    render(<ChatComposer {...baseProps} dictation={dictation} />)

    fireEvent.click(screen.getByRole('button', { name: 'Dictate a message' }))
    expect(dictation.toggle).toHaveBeenCalledTimes(1)
  })

  it('labels the mic as stop while recording', () => {
    render(
      <ChatComposer
        {...baseProps}
        dictation={makeDictation({ status: 'recording', active: true })}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Stop dictation' }),
    ).toBeInTheDocument()
  })

  it('shows a spinner while dictation is busy', () => {
    render(
      <ChatComposer
        {...baseProps}
        dictation={makeDictation({ status: 'connecting', busy: true })}
      />,
    )

    const mic = screen.getByRole('button', { name: 'Dictate a message' })
    expect(mic.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('disables the mic while stopping', () => {
    render(
      <ChatComposer
        {...baseProps}
        dictation={makeDictation({ status: 'stopping' })}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Dictate a message' }),
    ).toBeDisabled()
  })

  it('disables the mic while the composer is disabled', () => {
    render(<ChatComposer {...baseProps} disabled dictation={makeDictation()} />)

    expect(
      screen.getByRole('button', { name: 'Dictate a message' }),
    ).toBeDisabled()
  })

  it('disables the send button while dictation is active', () => {
    render(
      <ChatComposer
        {...baseProps}
        value="hello"
        dictation={makeDictation({ status: 'recording', active: true })}
      />,
    )

    expect(sendButton()).toBeDisabled()
  })

  it('ignores an Enter/form submit while dictation is active', () => {
    const onSubmit = vi.fn()
    const { container } = render(
      <ChatComposer
        {...baseProps}
        onSubmit={onSubmit}
        value="hello"
        dictation={makeDictation({ status: 'recording', active: true })}
      />,
    )

    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits on form submit when dictation is idle', () => {
    const onSubmit = vi.fn()
    const { container } = render(
      <ChatComposer
        {...baseProps}
        onSubmit={onSubmit}
        value="hello"
        dictation={makeDictation()}
      />,
    )

    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('sends on Enter', () => {
    const onSubmit = vi.fn()
    render(<ChatComposer {...baseProps} onSubmit={onSubmit} value="hello" />)

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('inserts a newline on Shift+Enter instead of sending', () => {
    const onSubmit = vi.fn()
    render(<ChatComposer {...baseProps} onSubmit={onSubmit} value="hello" />)

    fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Enter',
      shiftKey: true,
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not send on the Enter that commits an IME composition', () => {
    const onSubmit = vi.fn()
    render(<ChatComposer {...baseProps} onSubmit={onSubmit} value="部分" />)

    fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Enter',
      isComposing: true,
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not send on Enter when the composer is empty or whitespace', () => {
    const onSubmit = vi.fn()
    render(<ChatComposer {...baseProps} onSubmit={onSubmit} value="   " />)

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('ChatComposer — attachment affordance', () => {
  const makeAttachment = (
    over: Partial<ChatAttachmentState> = {},
  ): ChatAttachmentState => ({
    id: 'att-1',
    fileName: 'doc.pdf',
    status: 'ready',
    pageCount: null,
    failureReason: null,
    ...over,
  })

  it('renders the paperclip button when attachments are enabled', () => {
    render(
      <ChatComposer {...baseProps} attachments={[]} onAttachFile={vi.fn()} />,
    )
    expect(
      screen.getByRole('button', { name: 'Attach file or link' }),
    ).toBeInTheDocument()
  })

  it('does not render the paperclip button when attachments are not enabled', () => {
    render(<ChatComposer {...baseProps} />)
    expect(
      screen.queryByRole('button', { name: 'Attach file or link' }),
    ).not.toBeInTheDocument()
  })

  it('calls onAttachLink with the entered URL and closes the input', async () => {
    const user = userEvent.setup()
    const onAttachLink = vi.fn()
    render(
      <ChatComposer
        {...baseProps}
        attachments={[]}
        onAttachFile={vi.fn()}
        onAttachLink={onAttachLink}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Attach file or link' }),
    )
    const urlInput = screen.getByRole('textbox', { name: 'Attachment URL' })
    expect(urlInput).toBeInTheDocument()

    await user.type(urlInput, 'https://example.com')
    await user.click(screen.getByRole('button', { name: 'Attach link' }))

    expect(onAttachLink).toHaveBeenCalledWith('https://example.com')
    expect(
      screen.queryByRole('textbox', { name: 'Attachment URL' }),
    ).not.toBeInTheDocument()
  })

  it('closes the link input on Escape without calling onAttachLink', async () => {
    const user = userEvent.setup()
    const onAttachLink = vi.fn()
    render(
      <ChatComposer
        {...baseProps}
        attachments={[]}
        onAttachFile={vi.fn()}
        onAttachLink={onAttachLink}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Attach file or link' }),
    )
    expect(
      screen.getByRole('textbox', { name: 'Attachment URL' }),
    ).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(onAttachLink).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('textbox', { name: 'Attachment URL' }),
    ).not.toBeInTheDocument()
  })

  it('renders AttachmentChip with the file name and calls onRemoveAttachment on remove', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(
      <ChatComposer
        {...baseProps}
        attachments={[makeAttachment()]}
        onAttachFile={vi.fn()}
        onRemoveAttachment={onRemove}
      />,
    )

    expect(screen.getByText('doc.pdf')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove doc.pdf' }))
    expect(onRemove).toHaveBeenCalledWith('att-1')
  })

  it('shows processing status text on an in-flight attachment chip', () => {
    render(
      <ChatComposer
        {...baseProps}
        attachments={[makeAttachment({ status: 'processing', pageCount: 12 })]}
        onAttachFile={vi.fn()}
        onRemoveAttachment={vi.fn()}
      />,
    )
    expect(screen.getByText('Reading, 12 pages')).toBeInTheDocument()
  })

  it('shows the guard banner when guardAcknowledged is false', () => {
    render(
      <ChatComposer
        {...baseProps}
        attachments={[]}
        onAttachFile={vi.fn()}
        guardAcknowledged={false}
        onGuardAcknowledge={vi.fn()}
      />,
    )
    expect(screen.getByRole('note')).toBeInTheDocument()
    expect(
      screen.getByText(
        /Don't upload closed-session, privileged, or active-litigation material/,
      ),
    ).toBeInTheDocument()
  })

  it('does not show the guard banner when guardAcknowledged is true', () => {
    render(
      <ChatComposer
        {...baseProps}
        attachments={[]}
        onAttachFile={vi.fn()}
        guardAcknowledged={true}
        onGuardAcknowledge={vi.fn()}
      />,
    )
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('calls onGuardAcknowledge when the banner dismiss button is clicked', async () => {
    const user = userEvent.setup()
    const onGuardAcknowledge = vi.fn()
    render(
      <ChatComposer
        {...baseProps}
        attachments={[]}
        onAttachFile={vi.fn()}
        guardAcknowledged={false}
        onGuardAcknowledge={onGuardAcknowledge}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onGuardAcknowledge).toHaveBeenCalledTimes(1)
  })
})
