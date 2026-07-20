import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, fireEvent } from '@testing-library/react'
import { ChatComposer } from './chatUI'
import type { UseDictationAppendResult } from '../../briefings/shared/useDictationAppend'

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
})
