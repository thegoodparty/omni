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

describe('ChatComposer', () => {
  it('omits the mic and sends with the arrow when no dictation is given', () => {
    render(<ChatComposer {...baseProps} />)

    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /dictate/i }),
    ).not.toBeInTheDocument()
  })

  it('renders the mic and toggles dictation on click', () => {
    const dictation = makeDictation()
    render(<ChatComposer {...baseProps} dictation={dictation} />)

    const mic = screen.getByRole('button', { name: 'Dictate a message' })
    fireEvent.click(mic)
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

  it('disables the mic while a request is in flight', () => {
    render(<ChatComposer {...baseProps} disabled dictation={makeDictation()} />)

    expect(
      screen.getByRole('button', { name: 'Dictate a message' }),
    ).toBeDisabled()
  })
})
